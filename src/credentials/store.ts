import type { CredentialBackend } from '../types.js';
import { SecureHandle } from './secure-handle.js';
import { maskSecret } from './mask.js';

/** Thrown when no configured backend passes its availability probe. */
export class NoBackendAvailableError extends Error {
  constructor() {
    super('No credential backend available');
    this.name = 'NoBackendAvailableError';
  }
}

/** Thrown by `get()` when the active backend has no entry for the key. */
export class CredentialNotFoundError extends Error {
  constructor(service: string, account: string) {
    super(`No credential found for ${service}/${account}`);
    this.name = 'CredentialNotFoundError';
  }
}

/**
 * CredentialStore — routes all credential operations through the first
 * available backend of the priority chain (SPEC §3.7: keytar → encrypted
 * file → env).
 *
 * Probing is async: keytar is a native module and must be loaded dynamically
 * to detect binding failures (Task 14 CR), so the active backend is resolved
 * lazily on first use and cached. `get()` returns a SecureHandle — the secret
 * never leaves the store as a bare string (§3.7); `status()` returns a masked
 * view of it (§4.3).
 */
export class CredentialStore {
  private readonly backends: readonly CredentialBackend[];
  private activeBackend: CredentialBackend | null = null;

  /** `backends` are in priority order: the first available one is used. */
  constructor(backends: readonly CredentialBackend[]) {
    if (backends.length === 0) {
      throw new Error('CredentialStore requires at least one backend');
    }
    this.backends = backends;
  }

  /** Resolve (and cache) the first backend whose availability probe passes. */
  async getActiveBackend(): Promise<CredentialBackend> {
    if (this.activeBackend) {
      return this.activeBackend;
    }
    for (const backend of this.backends) {
      let available = false;
      try {
        available = await backend.isAvailable();
      } catch {
        // A throwing probe = unavailable; degrade to the next backend (§3.7)
        available = false;
      }
      if (available) {
        this.activeBackend = backend;
        return backend;
      }
    }
    throw new NoBackendAvailableError();
  }

  /** Read the secret for service/account as a SecureHandle, never a string. */
  async get(service: string, account: string): Promise<SecureHandle> {
    const backend = await this.getActiveBackend();
    const key = await backend.read(service, account);
    if (key === null) {
      throw new CredentialNotFoundError(service, account);
    }
    return new SecureHandle(key);
  }

  /** Masked presence/status of a credential, e.g. `****-c123` (SPEC §4.3). */
  async status(service: string, account: string): Promise<string> {
    const backend = await this.getActiveBackend();
    const key = await backend.read(service, account);
    return key === null ? 'not set' : maskSecret(key);
  }

  /** Persist a secret via the active backend. */
  async save(service: string, account: string, secret: string): Promise<void> {
    const backend = await this.getActiveBackend();
    await backend.save(service, account, secret);
  }

  /** Remove a secret via the active backend; true if an entry was deleted. */
  async delete(service: string, account: string): Promise<boolean> {
    const backend = await this.getActiveBackend();
    return backend.delete(service, account);
  }
}
