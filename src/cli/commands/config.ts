import { Command } from 'commander';
import type { Config } from '../../types.js';
import { loadConfig } from '../../config/loader.js';
import type { LoadConfigOptions } from '../../config/loader.js';
import { defaultConfigOptions } from '../options.js';
import { adviceFor } from '../errors.js';

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

/** Mask a secret to its last 4 characters — never echoes plaintext. */
function maskSecret(secret: string): string {
  return secret.length > 4 ? `****-${secret.slice(-4)}` : '****';
}

/** Pretty-printed merged config JSON; the webui token is masked. */
export function showConfig(config: Config): string {
  const redacted: Config = {
    ...config,
    webui: {
      ...config.webui,
      token: config.webui.token ? maskSecret(config.webui.token) : 'not set',
    },
  };
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
