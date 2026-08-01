/**
 * Shared secret masking (SPEC §4.2/§4.3: status output never echoes
 * plaintext). Single definition point for all CLI/credential surfaces —
 * credentials/store.ts, cli/commands/key.ts and cli/commands/config.ts all
 * use this instead of duplicating the mask logic.
 */

/** Mask a secret to its last 4 characters, e.g. `****-c123`; short → `****`. */
export function maskSecret(secret: string): string {
  return secret.length > 4 ? `****-${secret.slice(-4)}` : '****';
}
