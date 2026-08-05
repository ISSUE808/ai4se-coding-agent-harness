import { describe, it, expect, vi, beforeEach } from 'vitest';

// keytar is a native module (real OS keychain); never load it in tests —
// the backend must be fully testable against a mock (SPEC §A.4-C).
const keytarMock = vi.hoisted(() => ({
  getPassword: vi.fn(),
  setPassword: vi.fn(),
  deletePassword: vi.fn(),
  findCredentials: vi.fn(),
}));

vi.mock('keytar', () => ({ default: keytarMock }));

import { KeytarBackend } from '../../../src/credentials/backends/keytar-backend.js';

describe('KeytarBackend', () => {
  const backend = new KeytarBackend();
  const service = 'codeharness';
  const account = 'openai';
  const secret = 'sk-test-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has name "keytar"', () => {
    expect(backend.name).toBe('keytar');
  });

  it('isAvailable resolves true when the keytar module loads', async () => {
    await expect(backend.isAvailable()).resolves.toBe(true);
  });

  it('isAvailable resolves false when the keytar native binding fails to load (Task 14 CR fix)', async () => {
    // Simulate a broken native binding: the keytar module itself must not load.
    vi.doMock('keytar', () => {
      throw new Error('keytar native binding load failed');
    });
    const probing = new KeytarBackend();
    await expect(probing.isAvailable()).resolves.toBe(false);
    // Restore the shared mock for the remaining tests.
    vi.doMock('keytar', () => ({ default: keytarMock }));
  });

  it('save stores the secret via keytar.setPassword', async () => {
    keytarMock.setPassword.mockResolvedValue(undefined);
    await backend.save(service, account, secret);
    expect(keytarMock.setPassword).toHaveBeenCalledWith(service, account, secret);
  });

  it('read returns the secret from keytar.getPassword', async () => {
    keytarMock.getPassword.mockResolvedValue(secret);
    await expect(backend.read(service, account)).resolves.toBe(secret);
    expect(keytarMock.getPassword).toHaveBeenCalledWith(service, account);
  });

  it('read returns null when the keychain has no entry', async () => {
    keytarMock.getPassword.mockResolvedValue(null);
    await expect(backend.read(service, account)).resolves.toBeNull();
  });

  it('exists is true when an entry is present and false when missing', async () => {
    keytarMock.getPassword.mockResolvedValue(secret);
    await expect(backend.exists(service, account)).resolves.toBe(true);
    keytarMock.getPassword.mockResolvedValue(null);
    await expect(backend.exists(service, account)).resolves.toBe(false);
  });

  it('delete returns the keytar result and passes arguments through', async () => {
    keytarMock.deletePassword.mockResolvedValue(true);
    await expect(backend.delete(service, account)).resolves.toBe(true);
    expect(keytarMock.deletePassword).toHaveBeenCalledWith(service, account);
  });

  it('list enumerates accounts via keytar.findCredentials', async () => {
    keytarMock.findCredentials.mockResolvedValue([
      { account: 'deepseek', password: 'sk-a' },
      { account: 'groq', password: 'sk-b' },
    ]);
    await expect(backend.list(service)).resolves.toEqual(['deepseek', 'groq']);
    expect(keytarMock.findCredentials).toHaveBeenCalledWith(service);
  });

  it('list returns an empty array when the keychain has no entries for the service', async () => {
    keytarMock.findCredentials.mockResolvedValue([]);
    await expect(backend.list(service)).resolves.toEqual([]);
  });
});
