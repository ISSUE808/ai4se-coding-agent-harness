import {
  CredentialNotFoundError,
  NoBackendAvailableError,
} from '../credentials/store.js';

/**
 * Actionable error advice (SPEC §4.3: CLI errors carry actionable
 * suggestions, never raw stack traces).
 */
export function adviceFor(err: unknown): string {
  if (err instanceof NoBackendAvailableError) {
    return 'No credential backend is available. Run `codeharness key update` to configure a key, or set the CODEHARNESS_API_KEY environment variable.';
  }
  if (err instanceof CredentialNotFoundError) {
    return 'No API key is set. Run `codeharness key update` to add one.';
  }
  return err instanceof Error ? err.message : String(err);
}
