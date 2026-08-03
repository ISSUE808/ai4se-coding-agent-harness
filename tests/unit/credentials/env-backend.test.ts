import { describe, it, expect, afterEach, vi } from 'vitest';
import { EnvBackend } from '../../../src/credentials/backends/env-backend.js';

describe('EnvBackend', () => {
  const backend = new EnvBackend();
  const envKey = 'CODEHARNESS_API_KEY';

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('has name "env"', () => {
    expect(backend.name).toBe('env');
  });

  it('isAvailable is false when the env var is missing and true when set', async () => {
    vi.stubEnv(envKey, '');
    await expect(backend.isAvailable()).resolves.toBe(false);
    vi.stubEnv(envKey, 'sk-env-test');
    await expect(backend.isAvailable()).resolves.toBe(true);
  });

  it('read returns the env var value when set', async () => {
    vi.stubEnv(envKey, 'sk-env-test');
    await expect(backend.read('codeharness', 'openai')).resolves.toBe('sk-env-test');
  });

  it('read returns null when the env var is not set', async () => {
    vi.stubEnv(envKey, '');
    await expect(backend.read('codeharness', 'openai')).resolves.toBeNull();
  });

  it('exists is false when unset and true when set', async () => {
    vi.stubEnv(envKey, '');
    await expect(backend.exists('codeharness', 'openai')).resolves.toBe(false);
    vi.stubEnv(envKey, 'sk-env-test');
    await expect(backend.exists('codeharness', 'openai')).resolves.toBe(true);
  });

  it('save throws — env backend is read-only (SPEC §3.7 explicit-choice fallback)', async () => {
    await expect(backend.save('codeharness', 'openai', 'sk-secret')).rejects.toThrow(/read-only/i);
  });

  it('delete throws — env backend is read-only', async () => {
    await expect(backend.delete('codeharness', 'openai')).rejects.toThrow(/read-only/i);
  });

  it('list returns an empty array — the environment has no account namespace to enumerate', async () => {
    vi.stubEnv(envKey, 'sk-env-test');
    await expect(backend.list('codeharness')).resolves.toEqual([]);
  });
});
