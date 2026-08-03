import { describe, it, expect, vi } from 'vitest';
import {
  CredentialStore,
  NoBackendAvailableError,
  CredentialNotFoundError,
} from '../../../src/credentials/store.js';
import { SecureHandle } from '../../../src/credentials/secure-handle.js';
import type { CredentialBackend } from '../../../src/credentials/backends/backend.js';

/**
 * CredentialStore is tested exclusively against mock backends (SPEC §A.4-C):
 * no real keychain, no real encrypted file, no real env var.
 */
function mockBackend(
  name: string,
  opts: { available?: boolean; secret?: string | null } = {},
) {
  const available = opts.available ?? true;
  const secret = 'secret' in opts ? opts.secret : null;
  const isAvailable = vi.fn(async () => available);
  const read = vi.fn(async () => secret);
  const save = vi.fn(async () => undefined);
  const remove = vi.fn(async () => true);
  const exists = vi.fn(async () => secret !== null);
  const list = vi.fn(async () => []);
  const backend: CredentialBackend = {
    name,
    isAvailable,
    read,
    save,
    delete: remove,
    exists,
    list,
  };
  return { backend, isAvailable, read, save, remove, list };
}

const service = 'codeharness';
const account = 'openai';
const secret = 'sk-test-abc123';

describe('CredentialStore backend priority chain (SPEC §3.7: keytar → encrypted-file → env)', () => {
  it('throws when constructed without any backends', () => {
    expect(() => new CredentialStore([])).toThrow(/at least one backend/i);
  });

  it('uses the first available backend in priority order', async () => {
    const keytar = mockBackend('keytar');
    const file = mockBackend('encrypted-file');
    const env = mockBackend('env');
    const store = new CredentialStore([keytar.backend, file.backend, env.backend]);

    await expect(store.getActiveBackend()).resolves.toBe(keytar.backend);
  });

  it('probing short-circuits: later backends are not probed once one is available', async () => {
    const keytar = mockBackend('keytar');
    const file = mockBackend('encrypted-file');
    const env = mockBackend('env');
    const store = new CredentialStore([keytar.backend, file.backend, env.backend]);

    await store.getActiveBackend();
    expect(keytar.isAvailable).toHaveBeenCalledTimes(1);
    expect(file.isAvailable).not.toHaveBeenCalled();
    expect(env.isAvailable).not.toHaveBeenCalled();
  });

  it('falls back to the encrypted-file backend when keytar is unavailable', async () => {
    const keytar = mockBackend('keytar', { available: false });
    const file = mockBackend('encrypted-file', { secret });
    const env = mockBackend('env');
    const store = new CredentialStore([keytar.backend, file.backend, env.backend]);

    const handle = await store.get(service, account);
    expect(handle.use((key) => key)).toBe(secret);
    expect(keytar.isAvailable).toHaveBeenCalled();
    expect(env.isAvailable).not.toHaveBeenCalled();
  });

  it('throws NoBackendAvailableError when every backend is unavailable', async () => {
    const keytar = mockBackend('keytar', { available: false });
    const file = mockBackend('encrypted-file', { available: false });
    const env = mockBackend('env', { available: false });
    const store = new CredentialStore([keytar.backend, file.backend, env.backend]);

    await expect(store.getActiveBackend()).rejects.toBeInstanceOf(NoBackendAvailableError);
    await expect(store.status(service, account)).rejects.toBeInstanceOf(NoBackendAvailableError);
  });

  it('caches the active backend after the first probe', async () => {
    const keytar = mockBackend('keytar', { secret });
    const file = mockBackend('encrypted-file', { secret });
    const store = new CredentialStore([keytar.backend, file.backend]);

    const first = await store.getActiveBackend();
    const second = await store.getActiveBackend();
    expect(first).toBe(second);
    expect(keytar.isAvailable).toHaveBeenCalledTimes(1);
  });
});

describe('CredentialStore get/status/save/delete', () => {
  it('get returns a SecureHandle, never a raw string (SPEC §3.7)', async () => {
    const keytar = mockBackend('keytar', { secret });
    const store = new CredentialStore([keytar.backend]);

    const handle = await store.get(service, account);
    expect(handle).toBeInstanceOf(SecureHandle);
    expect(handle).not.toBe(secret);
    expect(keytar.read).toHaveBeenCalledWith(service, account);
  });

  it('get throws CredentialNotFoundError when no credential exists', async () => {
    const keytar = mockBackend('keytar', { secret: null });
    const store = new CredentialStore([keytar.backend]);

    await expect(store.get(service, account)).rejects.toBeInstanceOf(CredentialNotFoundError);
    await expect(store.get(service, account)).rejects.toThrow(/codeharness\/openai/);
  });

  it('status masks the key, showing only the last 4 characters (SPEC §4.3)', async () => {
    const keytar = mockBackend('keytar', { secret: 'sk-test-abc123' });
    const store = new CredentialStore([keytar.backend]);

    await expect(store.status(service, account)).resolves.toBe('****-c123');
  });

  it('status never reveals the key or its first characters', async () => {
    const keytar = mockBackend('keytar', { secret });
    const store = new CredentialStore([keytar.backend]);

    const status = await store.status(service, account);
    expect(status).not.toContain(secret);
    expect(status).not.toContain('sk-test');
  });

  it('status fully masks keys of 4 or fewer characters', async () => {
    const short = mockBackend('keytar', { secret: 'abcd' });
    const storeShort = new CredentialStore([short.backend]);
    await expect(storeShort.status(service, account)).resolves.toBe('****');

    const tiny = mockBackend('keytar', { secret: 'ab' });
    const storeTiny = new CredentialStore([tiny.backend]);
    await expect(storeTiny.status(service, account)).resolves.toBe('****');
  });

  it('status reports "not set" when no credential exists', async () => {
    const keytar = mockBackend('keytar', { secret: null });
    const store = new CredentialStore([keytar.backend]);

    await expect(store.status(service, account)).resolves.toBe('not set');
  });

  it('save delegates to the active backend', async () => {
    const keytar = mockBackend('keytar');
    const store = new CredentialStore([keytar.backend]);

    await store.save(service, account, 'sk-new-secret');
    expect(keytar.save).toHaveBeenCalledWith(service, account, 'sk-new-secret');
  });

  it('delete delegates to the active backend and returns its result', async () => {
    const keytar = mockBackend('keytar');
    keytar.remove.mockResolvedValue(true);
    const store = new CredentialStore([keytar.backend]);

    await expect(store.delete(service, account)).resolves.toBe(true);
    expect(keytar.remove).toHaveBeenCalledWith(service, account);
  });

  it('list delegates to the active backend, returning configured account names', async () => {
    const keytar = mockBackend('keytar');
    keytar.list.mockResolvedValue(['deepseek', 'groq']);
    const store = new CredentialStore([keytar.backend]);

    await expect(store.list(service)).resolves.toEqual(['deepseek', 'groq']);
    expect(keytar.list).toHaveBeenCalledWith(service);
  });
});
