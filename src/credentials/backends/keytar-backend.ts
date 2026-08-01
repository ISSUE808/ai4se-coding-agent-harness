import keytar from 'keytar';
import type { CredentialBackend } from './backend.js';

/**
 * KeytarBackend — delegates to the OS keychain
 * (Windows Credential Manager / macOS Keychain / Linux libsecret), SPEC §3.7.
 */
export class KeytarBackend implements CredentialBackend {
  readonly name = 'keytar';

  isAvailable(): boolean {
    return typeof keytar !== 'undefined';
  }

  async save(service: string, account: string, secret: string): Promise<void> {
    await keytar.setPassword(service, account, secret);
  }

  async read(service: string, account: string): Promise<string | null> {
    return keytar.getPassword(service, account);
  }

  async delete(service: string, account: string): Promise<boolean> {
    return keytar.deletePassword(service, account);
  }

  async exists(service: string, account: string): Promise<boolean> {
    return (await keytar.getPassword(service, account)) !== null;
  }
}
