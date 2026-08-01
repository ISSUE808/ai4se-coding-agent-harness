/**
 * CredentialBackend interface — SPI for credential storage backends.
 *
 * Backend priority chain (SPEC §3.7): keytar → encrypted file → env.
 * All read/write operations are async (keytar is promise-based); `isAvailable`
 * is an async probe used by the CredentialStore (Task 15) to pick a backend —
 * async because keytar must be loaded dynamically to detect native-binding
 * failures (Task 14 CR).
 */
export interface CredentialBackend {
  readonly name: string;
  /** Asynchronous probe: can this backend be used right now? */
  isAvailable(): Promise<boolean>;
  save(service: string, account: string, secret: string): Promise<void>;
  read(service: string, account: string): Promise<string | null>;
  delete(service: string, account: string): Promise<boolean>;
  exists(service: string, account: string): Promise<boolean>;
}
