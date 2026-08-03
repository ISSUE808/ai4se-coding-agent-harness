import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EncryptedFileBackend } from '../../../src/credentials/backends/encrypted-file-backend.js';

describe('EncryptedFileBackend', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    // Credentials must never land in the repo (SPEC §4.2) — use a tmpdir file.
    dir = mkdtempSync(join(tmpdir(), 'codeharness-secrets-'));
    filePath = join(dir, 'secrets.enc');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const masterPassword = 'correct horse battery staple';
  const service = 'codeharness';
  const account = 'openai';
  const secret = 'sk-test-abc123';

  it('has name "encrypted-file" and is always available', async () => {
    const backend = new EncryptedFileBackend(masterPassword, filePath);
    expect(backend.name).toBe('encrypted-file');
    await expect(backend.isAvailable()).resolves.toBe(true);
  });

  it('save writes an encrypted file, not plaintext', async () => {
    const backend = new EncryptedFileBackend(masterPassword, filePath);
    await backend.save(service, account, secret);
    expect(existsSync(filePath)).toBe(true);
    const raw = readFileSync(filePath, 'utf8');
    // The secret and even the service/account metadata must not appear in the clear.
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain(service);
    expect(raw).not.toContain(account);
    // The file must be a structured cipher payload, not plaintext JSON.
    expect(raw).toMatch(/"ciphertext"/);
  });

  it('read returns the original secret after save', async () => {
    const backend = new EncryptedFileBackend(masterPassword, filePath);
    await backend.save(service, account, secret);
    await expect(backend.read(service, account)).resolves.toBe(secret);
  });

  it('read returns null for an unknown account', async () => {
    const backend = new EncryptedFileBackend(masterPassword, filePath);
    await backend.save(service, account, secret);
    await expect(backend.read(service, 'other-account')).resolves.toBeNull();
  });

  it('exists reflects saved entries', async () => {
    const backend = new EncryptedFileBackend(masterPassword, filePath);
    await expect(backend.exists(service, account)).resolves.toBe(false);
    await backend.save(service, account, secret);
    await expect(backend.exists(service, account)).resolves.toBe(true);
  });

  it('read with a wrong password fails (AES-GCM tag verification)', async () => {
    const backend = new EncryptedFileBackend(masterPassword, filePath);
    await backend.save(service, account, secret);
    const wrong = new EncryptedFileBackend('wrong-password', filePath);
    await expect(wrong.read(service, account)).rejects.toThrow();
  });

  it('delete removes the entry and returns true; false when absent', async () => {
    const backend = new EncryptedFileBackend(masterPassword, filePath);
    await backend.save(service, account, secret);
    await expect(backend.delete(service, account)).resolves.toBe(true);
    await expect(backend.read(service, account)).resolves.toBeNull();
    await expect(backend.delete(service, account)).resolves.toBe(false);
  });

  it('a repeated save overwrites the stored secret', async () => {
    const backend = new EncryptedFileBackend(masterPassword, filePath);
    await backend.save(service, account, 'first-secret');
    await backend.save(service, account, 'second-secret');
    await expect(backend.read(service, account)).resolves.toBe('second-secret');
  });

  it('list returns the accounts stored under a service, ignoring other services', async () => {
    const backend = new EncryptedFileBackend(masterPassword, filePath);
    await backend.save(service, account, secret);
    await backend.save(service, 'groq', 'sk-groq-123');
    await backend.save('other-service', 'nested', 'sk-nested-1');
    await expect(backend.list(service)).resolves.toEqual([account, 'groq']);
  });

  it('list returns an empty array for a service with no entries', async () => {
    const backend = new EncryptedFileBackend(masterPassword, filePath);
    await expect(backend.list(service)).resolves.toEqual([]);
  });
});
