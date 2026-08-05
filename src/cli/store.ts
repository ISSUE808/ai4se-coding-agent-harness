import { CredentialStore } from '../credentials/store.js';
import { KeytarBackend } from '../credentials/backends/keytar-backend.js';
import { EncryptedFileBackend } from '../credentials/backends/encrypted-file-backend.js';
import { EnvBackend } from '../credentials/backends/env-backend.js';
import type { Config, CredentialBackend } from '../types.js';

/**
 * CLI-side CredentialStore factory — wires the SPEC §3.7 backend priority
 * chain (keytar → encrypted file → env) without adding any new storage
 * implementation. All credential logic stays in src/credentials/store.ts.
 *
 * The keytar probe runs eagerly here so the master password is only prompted
 * (hidden input) when the encrypted-file fallback is actually needed
 * (SPEC §8.5: keytar unavailable → encrypted file).
 *
 * `apiKeySource` (SPEC §4.2/§8.1) selects which storage is consulted:
 * - `'keytar'` (default): keytar when available, else encrypted file.
 * - `'encrypted_file'`: encrypted file only.
 * - `'env'`: env only — SPEC §4.2: `.env` is only read when the user
 *   explicitly opts in, never silently.
 */

export interface BuildCredentialStoreOptions {
  /** Mock/probe override for tests; `undefined` = real KeytarBackend, `null` = skip. */
  keytarBackend?: CredentialBackend | null;
  /** Pre-supplied master password (tests, Docker) — skips the prompt. */
  masterPassword?: string;
  /** Secrets file path for the encrypted-file backend (tests). */
  filePath?: string;
  /** Hidden input used to prompt for the master password when needed. */
  readHidden?: (label: string) => Promise<string>;
  /** Explicit credential source selection (SPEC §4.2/§8.1); default 'keytar'. */
  apiKeySource?: 'keytar' | 'encrypted_file' | 'env';
}

export async function buildCredentialStore(
  options: BuildCredentialStoreOptions = {},
): Promise<CredentialStore> {
  const source = options.apiKeySource ?? 'keytar';
  const backends: CredentialBackend[] = [];

  if (source === 'env') {
    backends.push(new EnvBackend());
    return new CredentialStore(backends);
  }

  if (source === 'keytar') {
    const keytar =
      options.keytarBackend === undefined ? new KeytarBackend() : options.keytarBackend;
    if (keytar) {
      let available = false;
      try {
        available = await keytar.isAvailable();
      } catch {
        // Throwing probe = unavailable (keytar native binding failure, Task 14 CR)
        available = false;
      }
      if (available) {
        backends.push(keytar);
      }
    }
  }

  // Encrypted file — used when source is 'encrypted_file', or as the fallback
  // when keytar is unavailable/not selected.
  if (backends.length === 0) {
    let masterPassword = options.masterPassword;
    if (masterPassword === undefined && options.readHidden) {
      masterPassword = await options.readHidden(
        'Master password for encrypted key storage: ',
      );
    }
    if (masterPassword) {
      backends.push(new EncryptedFileBackend(masterPassword, options.filePath));
    }
  }

  return new CredentialStore(backends);
}

/**
 * buildStoreFromConfig — config 驱动的 CLI 凭据存储工厂（方案 B）。
 * 读取 merged config 的 `apiKeySource`（SPEC §4.2）与 `masterPassword`
 * （Docker/headless 预置口令，SPEC §8.5）构建 CredentialStore：keytar 不可用
 * 且口令已预置 → encrypted-file 后端直接激活，无交互提示。
 * `options` 仅供测试注入（keytarBackend / filePath）。
 */
export async function buildStoreFromConfig(
  config: Config,
  readHidden: (label: string) => Promise<string>,
  options: { keytarBackend?: CredentialBackend | null; filePath?: string } = {},
): Promise<CredentialStore> {
  return buildCredentialStore({
    readHidden,
    apiKeySource: config.llm.apiKeySource, // SPEC §4.2: explicit source only
    masterPassword: config.llm.masterPassword,
    ...options,
  });
}
