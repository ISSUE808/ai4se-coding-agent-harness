import type { CredentialBackend } from './backend.js';

/**
 * KeytarBackend — delegates to the OS keychain
 * (Windows Credential Manager / macOS Keychain / Linux libsecret), SPEC §3.7.
 *
 * keytar is a native module: loading it can fail (missing/incompatible
 * binding). The module is therefore loaded with a lazy dynamic `import()`
 * inside a try/catch. A static import would make `typeof keytar !== 'undefined'`
 * an always-true tautology — the module either loads or the whole import
 * throws at module-load time (Task 14 CR fix). `isAvailable()` reports whether
 * the module actually loaded.
 */
export class KeytarBackend implements CredentialBackend {
  readonly name = 'keytar';

  async isAvailable(): Promise<boolean> {
    try {
      await loadKeytar();
      return true;
    } catch {
      return false;
    }
  }

  async save(service: string, account: string, secret: string): Promise<void> {
    const keytar = await loadKeytar();
    await keytar.setPassword(service, account, secret);
  }

  async read(service: string, account: string): Promise<string | null> {
    const keytar = await loadKeytar();
    return keytar.getPassword(service, account);
  }

  async delete(service: string, account: string): Promise<boolean> {
    const keytar = await loadKeytar();
    return keytar.deletePassword(service, account);
  }

  async exists(service: string, account: string): Promise<boolean> {
    const keytar = await loadKeytar();
    return (await keytar.getPassword(service, account)) !== null;
  }
}

/** The subset of the keytar API used by this backend. */
interface KeytarModule {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

/**
 * Lazy-load the keytar module. keytar is CJS: under NodeNext the dynamic
 * import namespace exposes its exports object as `default` (esModuleInterop);
 * vitest mocks use the same `{ default }` shape.
 */
async function loadKeytar(): Promise<KeytarModule> {
  const namespace = (await import('keytar')) as { default?: KeytarModule };
  if (!namespace.default) {
    throw new Error('keytar module loaded without exports');
  }
  return namespace.default;
}
