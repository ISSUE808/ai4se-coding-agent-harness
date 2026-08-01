import type { CredentialBackend } from './backend.js';

/**
 * EnvBackend — reads `CODEHARNESS_API_KEY` from the environment (SPEC §3.7).
 *
 * Explicit-choice fallback: plaintext in the environment is a known risk
 * (SPEC §4.2), so the backend is read-only — save/delete throw.
 */
const ENV_KEY = 'CODEHARNESS_API_KEY';

export class EnvBackend implements CredentialBackend {
  readonly name = 'env';

  async isAvailable(): Promise<boolean> {
    return Boolean(process.env[ENV_KEY]);
  }

  async save(_service: string, _account: string, _secret: string): Promise<void> {
    throw new Error('EnvBackend is read-only: credentials come from CODEHARNESS_API_KEY');
  }

  async read(_service: string, _account: string): Promise<string | null> {
    const value = process.env[ENV_KEY];
    return value ? value : null;
  }

  async delete(_service: string, _account: string): Promise<boolean> {
    throw new Error('EnvBackend is read-only: cannot delete from the environment');
  }

  async exists(_service: string, _account: string): Promise<boolean> {
    return Boolean(process.env[ENV_KEY]);
  }
}
