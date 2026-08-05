import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildCredentialStore,
  buildStoreFromConfig,
} from '../../../src/cli/store.js';
import { CredentialStore } from '../../../src/credentials/store.js';
import { DEFAULT_CONFIG } from '../../../src/config/schema.js';
import type { Config, CredentialBackend } from '../../../src/types.js';

/**
 * buildCredentialStore — CLI-side wiring of the SPEC §3.7 backend priority
 * chain (keytar → encrypted file → env). Tests never touch a real keychain:
 * keytar is a mock, the encrypted file lands in a temp dir.
 */

const tmpDirs: string[] = [];

function tmpSecretsPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-cli-store-'));
  tmpDirs.push(dir);
  return path.join(dir, 'secrets.enc');
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
  delete process.env.CODEHARNESS_API_KEY;
});

function fakeKeytar(available: boolean): CredentialBackend {
  return {
    name: 'keytar',
    isAvailable: vi.fn(async () => available),
    read: vi.fn(async () => null),
    save: vi.fn(async () => undefined),
    delete: vi.fn(async () => false),
    exists: vi.fn(async () => false),
    list: vi.fn(async () => []),
  };
}

describe('buildCredentialStore (SPEC §3.7 priority chain from the CLI)', () => {
  it('prioritizes keytar when it is available, without prompting for a master password', async () => {
    const keytar = fakeKeytar(true);
    const readHidden = vi.fn(async () => {
      throw new Error('must not prompt when keytar is available');
    });
    const store = await buildCredentialStore({ keytarBackend: keytar, readHidden });
    expect(store).toBeInstanceOf(CredentialStore);
    await expect(store.getActiveBackend()).resolves.toBe(keytar);
    expect(readHidden).not.toHaveBeenCalled();
  });

  it('degrades to the encrypted-file backend when keytar is unavailable, prompting for the master password', async () => {
    const keytar = fakeKeytar(false);
    const readHidden = vi.fn(async () => 'master-pass-123');
    const store = await buildCredentialStore({
      keytarBackend: keytar,
      readHidden,
      filePath: tmpSecretsPath(),
    });
    const backend = await store.getActiveBackend();
    expect(backend.name).toBe('encrypted-file');
    expect(readHidden).toHaveBeenCalledTimes(1);

    // Real encrypted-file roundtrip through the CLI store (temp path only)
    await store.save('codeharness/deepseek', 'deepseek', 'sk-roundtrip');
    await expect(store.status('codeharness/deepseek', 'deepseek')).resolves.toBe(
      '****-trip',
    );
  });

  it('uses a provided master password without prompting', async () => {
    const readHidden = vi.fn(async () => {
      throw new Error('must not prompt when a password is provided');
    });
    const store = await buildCredentialStore({
      keytarBackend: null,
      masterPassword: 'provided-pass',
      filePath: tmpSecretsPath(),
      readHidden,
    });
    expect((await store.getActiveBackend()).name).toBe('encrypted-file');
    expect(readHidden).not.toHaveBeenCalled();
  });

  it('does NOT consult env unless apiKeySource is explicitly "env" (I2 CR, SPEC §4.2)', async () => {
    // SPEC §4.2: `.env` is only read when the user explicitly sets
    // apiKeySource: 'env' — never silently. With keytar unavailable and no
    // master password, the chain must be empty (throws) instead of falling
    // back to the environment.
    process.env.CODEHARNESS_API_KEY = 'sk-env-test';
    const readHidden = vi.fn(async () => '');
    await expect(
      buildCredentialStore({ keytarBackend: null, readHidden }),
    ).rejects.toThrow(/at least one backend/);
  });

  it('uses the env backend when apiKeySource is explicitly "env"', async () => {
    process.env.CODEHARNESS_API_KEY = 'sk-env-test';
    const store = await buildCredentialStore({
      keytarBackend: null,
      apiKeySource: 'env',
    });
    expect((await store.getActiveBackend()).name).toBe('env');
    // Env backend is read-only but serves the key (masked status)
    await expect(store.status('codeharness/deepseek', 'deepseek')).resolves.toBe(
      '****-test',
    );
  });

  it('uses only the encrypted-file backend when apiKeySource is "encrypted_file"', async () => {
    const keytar = fakeKeytar(true); // must NOT be probed for 'encrypted_file'
    const store = await buildCredentialStore({
      keytarBackend: keytar,
      apiKeySource: 'encrypted_file',
      masterPassword: 'provided-pass',
      filePath: tmpSecretsPath(),
    });
    expect((await store.getActiveBackend()).name).toBe('encrypted-file');
    expect(keytar.isAvailable).not.toHaveBeenCalled();
  });

  it('handles a throwing keytar probe by degrading (Task 14 CR behavior)', async () => {
    const keytar = {
      name: 'keytar',
      isAvailable: vi.fn(async () => {
        throw new Error('keytar native binding load failed');
      }),
      read: vi.fn(),
      save: vi.fn(),
      delete: vi.fn(),
      exists: vi.fn(),
      list: vi.fn(async () => []),
    } as CredentialBackend;
    const readHidden = vi.fn(async () => 'pw');
    const store = await buildCredentialStore({
      keytarBackend: keytar,
      readHidden,
      filePath: tmpSecretsPath(),
    });
    expect((await store.getActiveBackend()).name).toBe('encrypted-file');
  });
});

describe('buildStoreFromConfig — config 驱动的凭据存储（方案 B：Docker 预置口令）', () => {
  it('keytar 不可用 + config.llm.masterPassword 预置 → encrypted-file 激活，零交互（容器场景）', async () => {
    const readHidden = vi.fn(async () => {
      throw new Error('容器无 TTY，不得提示交互输入');
    });
    const store = await buildStoreFromConfig(
      {
        ...DEFAULT_CONFIG,
        llm: { ...DEFAULT_CONFIG.llm, masterPassword: 'docker-master-pass' },
      } as Config,
      readHidden,
      { keytarBackend: null, filePath: tmpSecretsPath() },
    );
    expect((await store.getActiveBackend()).name).toBe('encrypted-file');
    expect(readHidden).not.toHaveBeenCalled();

    // 真实读写 roundtrip：线上 WebUI /api/keys 链路可用
    await store.save('codeharness/deepseek', 'deepseek', 'sk-live');
    await expect(store.status('codeharness/deepseek', 'deepseek')).resolves.toBe(
      '****-live',
    );
  });

  it('透传 config.llm.apiKeySource（显式 env 时不需要口令）', async () => {
    const readHidden = vi.fn(async () => {
      throw new Error('env 模式不得提示口令');
    });
    process.env.CODEHARNESS_API_KEY = 'sk-env-test';
    const store = await buildStoreFromConfig(
      { ...DEFAULT_CONFIG, llm: { ...DEFAULT_CONFIG.llm, apiKeySource: 'env' } } as Config,
      readHidden,
      { keytarBackend: null },
    );
    expect((await store.getActiveBackend()).name).toBe('env');
    expect(readHidden).not.toHaveBeenCalled();
  });
});
