import { homedir } from 'node:os';
import { join } from 'node:path';
import type { LoadConfigOptions } from '../config/loader.js';

/**
 * Default config file locations (SPEC §3.6):
 * `~/.codeharness/config.json` (user) → `.codeharness.json` (project root) →
 * CLI args. Injectable per command for deterministic tests.
 */
export function defaultConfigOptions(): LoadConfigOptions {
  return {
    userConfigPath: join(homedir(), '.codeharness', 'config.json'),
    projectConfigPath: join(process.cwd(), '.codeharness.json'),
  };
}
