import { describe, it, expect, vi, beforeEach } from 'vitest';

// keytar is a native module (real OS keychain); never load it in tests —
// the backend must be fully testable against a mock (SPEC §A.4-C).
const keytarMock = vi.hoisted(() => ({
  getPassword: vi.fn(),
  setPassword: vi.fn(),
  deletePassword: vi.fn(),
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

  it('has name "keytar" and is available when keytar module is present', () => {
    expect(backend.name).toBe('keytar');
    expect(backend.isAvailable()).toBe(true);
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
});
