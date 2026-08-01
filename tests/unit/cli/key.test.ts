import { describe, it, expect, vi, afterEach } from 'vitest';
import { CredentialStore } from '../../../src/credentials/store.js';
import {
  createKeyCommand,
  keyStatus,
  keyUpdate,
  keyReset,
} from '../../../src/cli/commands/key.js';
import { mockBackend, parseCaptured } from './helpers.js';

/**
 * CLI key commands (SPEC §4.2/§4.3): masked status, hidden input, reset with
 * actionable advice. All tests run against mock backends — no real keychain.
 */

const service = 'codeharness/deepseek';
const account = 'deepseek';

function storeWith(secret: string | null) {
  const mock = mockBackend('mock', secret === null ? {} : { secret });
  return { store: new CredentialStore([mock.backend]), mock };
}

afterEach(() => {
  process.exitCode = 0;
});

describe('keyStatus', () => {
  it('returns the masked status and never the plaintext (SPEC §4.3)', async () => {
    const { store } = storeWith('sk-test-abc123');
    const line = await keyStatus(store, service, account);
    expect(line).toContain('****-c123');
    expect(line).not.toContain('sk-test');
    expect(line).not.toContain('abc123');
  });

  it('reports "not set" when no key exists', async () => {
    const { store } = storeWith(null);
    await expect(keyStatus(store, service, account)).resolves.toContain('not set');
  });
});

describe('keyUpdate', () => {
  it('saves the key after hidden input + confirm, reporting only a masked confirmation', async () => {
    const { store, mock } = storeWith(null);
    const readHidden = vi
      .fn()
      .mockResolvedValueOnce('sknewxyz')
      .mockResolvedValueOnce('sknewxyz');
    const line = await keyUpdate(store, service, account, readHidden);
    expect(readHidden).toHaveBeenCalledTimes(2);
    expect(mock.save).toHaveBeenCalledWith(service, account, 'sknewxyz');
    expect(line).toContain('****-wxyz');
    expect(line).not.toContain('sknewxyz');
  });

  it('throws an actionable error when the confirmation does not match', async () => {
    const { store, mock } = storeWith(null);
    const readHidden = vi
      .fn()
      .mockResolvedValueOnce('sk-a')
      .mockResolvedValueOnce('sk-b');
    await expect(keyUpdate(store, service, account, readHidden)).rejects.toThrow(
      /do not match/i,
    );
    expect(mock.save).not.toHaveBeenCalled();
  });

  it('throws when no key is entered', async () => {
    const { store } = storeWith(null);
    const readHidden = vi.fn().mockResolvedValueOnce('');
    await expect(keyUpdate(store, service, account, readHidden)).rejects.toThrow(
      /no api key entered/i,
    );
  });
});

describe('keyReset (SPEC §4.2: reset clears the key for re-recording)', () => {
  it('removes the stored key and reports it', async () => {
    const { store, mock } = storeWith('sk-test-abc123');
    mock.delete.mockResolvedValue(true);
    const line = await keyReset(store, service, account);
    expect(mock.delete).toHaveBeenCalledWith(service, account);
    expect(line).toMatch(/removed/i);
    expect(line).toMatch(/key update/);
  });

  it('reports nothing-to-remove with actionable advice when no key exists', async () => {
    const { store } = storeWith(null);
    const line = await keyReset(store, service, account);
    expect(line).toMatch(/nothing to remove/i);
    expect(line).toMatch(/key update/);
  });
});

describe('createKeyCommand wiring', () => {
  it('`key status` prints the masked key through the CLI', async () => {
    const { store } = storeWith('sk-test-abc123');
    const out: string[] = [];
    const cmd = createKeyCommand({
      storeFactory: async () => store,
      service,
      account,
      print: (line) => out.push(line),
    });
    const result = await parseCaptured(cmd, ['status']);
    expect(out.join('')).toContain('****-c123');
    expect(out.join('')).not.toContain('sk-test');
    expect(result.err).toBe('');
  });

  it('`key update` reads hidden input and saves', async () => {
    const { store, mock } = storeWith(null);
    const out: string[] = [];
    const readHidden = vi
      .fn()
      .mockResolvedValueOnce('sk-new-xyz')
      .mockResolvedValueOnce('sk-new-xyz');
    const cmd = createKeyCommand({
      storeFactory: async () => store,
      service,
      account,
      readHidden,
      print: (line) => out.push(line),
    });
    await parseCaptured(cmd, ['update']);
    expect(mock.save).toHaveBeenCalledWith(service, account, 'sk-new-xyz');
    expect(out.join('')).toMatch(/saved/i);
    expect(out.join('')).not.toContain('sk-new-xyz');
  });

  it('`key reset` removes the key', async () => {
    const { store, mock } = storeWith('sk-test-abc123');
    mock.delete.mockResolvedValue(true);
    const out: string[] = [];
    const cmd = createKeyCommand({
      storeFactory: async () => store,
      service,
      account,
      print: (line) => out.push(line),
    });
    await parseCaptured(cmd, ['reset']);
    expect(mock.delete).toHaveBeenCalledWith(service, account);
    expect(out.join('')).toMatch(/removed/i);
  });

  it('prints actionable advice and sets exit code 1 on backend failure', async () => {
    const unavailable = mockBackend('mock', { available: false });
    const store = new CredentialStore([unavailable.backend]);
    const errLines: string[] = [];
    const cmd = createKeyCommand({
      storeFactory: async () => store,
      service,
      account,
      errPrint: (line) => errLines.push(line),
    });
    await parseCaptured(cmd, ['status']);
    expect(errLines.join('')).toMatch(/no credential backend is available/i);
    expect(errLines.join('')).toMatch(/key update/);
    expect(process.exitCode).toBe(1);
  });
});
