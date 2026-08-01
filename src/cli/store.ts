import { CredentialStore } from '../credentials/store.js';
import { KeytarBackend } from '../credentials/backends/keytar-backend.js';
import { EncryptedFileBackend } from '../credentials/backends/encrypted-file-backend.js';
import { EnvBackend } from '../credentials/backends/env-backend.js';
import type { CredentialBackend } from '../types.js';

/**
 * CLI-side CredentialStore factory — wires the SPEC §3.7 backend priority
 * chain (keytar → encrypted file → env) without adding any new storage
 * implementation. All credential logic stays in src/credentials/store.ts.
 *
 * The keytar probe runs eagerly here so the master password is only prompted
 * (hidden input) when the encrypted-file fallback is actually needed
 * (SPEC §8.5: keytar unavailable → encrypted file).
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
}

export async function buildCredentialStore(
  options: BuildCredentialStoreOptions = {},
): Promise<CredentialStore> {
  const backends: CredentialBackend[] = [];

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

  let masterPassword = options.masterPassword;
  if (backends.length === 0 && masterPassword === undefined && options.readHidden) {
    masterPassword = await options.readHidden(
      'Master password for encrypted key storage: ',
    );
  }
  if (masterPassword) {
    backends.push(new EncryptedFileBackend(masterPassword, options.filePath));
  }

  backends.push(new EnvBackend());
  return new CredentialStore(backends);
}
