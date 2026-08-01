import { Command } from 'commander';
import type { Config } from '../../types.js';
import { loadConfig } from '../../config/loader.js';
import type { LoadConfigOptions } from '../../config/loader.js';
import { defaultConfigOptions } from '../options.js';
import { adviceFor } from '../errors.js';
import { maskSecret } from '../../credentials/mask.js';

/**
 * `config` commands: `config show` prints the merged configuration
 * (SPEC §3.6: user → project → CLI args) with secrets masked
 * (SPEC §4.2: never echo tokens).
 */

export interface ConfigCommandDeps {
  loadConfig?: (options?: LoadConfigOptions) => Config;
  userConfigPath?: string;
  projectConfigPath?: string;
  cliArgs?: LoadConfigOptions['cliArgs'];
  print?: (line: string) => void;
  errPrint?: (line: string) => void;
}

/**
 * Known secret field paths that must be masked in `config show` output
 * (SPEC §4.2: never echo tokens to terminal/logs). An explicit whitelist —
 * a name-based regex like `/key/` would falsely match `apiKeyService`.
 */
const SECRET_FIELDS: ReadonlyArray<{ path: string[]; kind: 'mask' | 'hide' }> = [
  { path: ['webui', 'token'], kind: 'mask' },
  { path: ['llm', 'apiKey'], kind: 'mask' },
];

/** Pretty-printed merged config JSON; secrets are masked (never plaintext). */
export function showConfig(config: Config): string {
  const redacted = structuredClone(config) as unknown as Record<string, unknown>;
  for (const { path } of SECRET_FIELDS) {
    let node: Record<string, unknown> = redacted;
    for (let i = 0; i < path.length - 1; i++) {
      const part = path[i];
      const next = node[part];
      if (typeof next !== 'object' || next === null) break;
      node = next as Record<string, unknown>;
    }
    const leaf = path[path.length - 1];
    const value = node[leaf];
    if (typeof value === 'string' && value.length > 0) {
      node[leaf] = maskSecret(value);
    }
  }
  // Absent token reads as "not set" (undefined or empty string)
  const webui = redacted.webui as Record<string, unknown>;
  if (webui.token === undefined || webui.token === '') {
    webui.token = 'not set';
  }
  return JSON.stringify(redacted, null, 2);
}

export function createConfigCommand(deps: ConfigCommandDeps = {}): Command {
  const cmd = new Command('config');
  cmd.description('Show configuration');

  cmd
    .command('show')
    .description('Print the merged configuration with secrets masked')
    .action(async () => {
      try {
        const options: LoadConfigOptions = { ...defaultConfigOptions() };
        if (deps.userConfigPath !== undefined) options.userConfigPath = deps.userConfigPath;
        if (deps.projectConfigPath !== undefined) {
          options.projectConfigPath = deps.projectConfigPath;
        }
        if (deps.cliArgs !== undefined) options.cliArgs = deps.cliArgs;
        const config = (deps.loadConfig ?? loadConfig)(options);
        (deps.print ?? console.log)(showConfig(config));
      } catch (err) {
        (deps.errPrint ?? console.error)(`codeharness config: ${adviceFor(err)}`);
        process.exitCode = 1;
      }
    });

  return cmd;
}
