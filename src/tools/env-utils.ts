export const ENV_WHITELIST = ['PATH', 'HOME', 'USER', 'TEMP', 'TMP'];

export function buildWhitelistedEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const key of ENV_WHITELIST) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  return env;
}
