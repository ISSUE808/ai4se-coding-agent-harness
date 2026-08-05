#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { createKeyCommand } from './commands/key.js';
import type { KeyCommandDeps } from './commands/key.js';
import { createConfigCommand } from './commands/config.js';
import type { ConfigCommandDeps } from './commands/config.js';
import { createStartCommand, runReplAction } from './commands/start.js';
import type { StartCommandDeps } from './commands/start.js';
import { buildCredentialStore } from './store.js';
import { promptHidden } from './prompt.js';

/**
 * CLI entry (SPEC §5.1): `codeharness` with `start`, `key status|update|reset`
 * and `config show` subcommands. `createProgram` takes injectable deps per
 * command so tests exercise the whole program deterministically.
 */

export interface ProgramDeps {
  key?: Partial<KeyCommandDeps>;
  config?: Partial<ConfigCommandDeps>;
  start?: Partial<StartCommandDeps>;
}

export interface ProgramOptions {
  /** Test-only: commander throws instead of process.exit (safe in vitest). */
  exitOverride?: boolean;
}

/** Version comes from package.json — single source of truth. */
export function readVersion(): string {
  const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
  return pkg.version ?? '0.0.0';
}

export function createProgram(deps: ProgramDeps = {}, options: ProgramOptions = {}): Command {
  const program = new Command();
  program
    .name('codeharness')
    .description('CodeHarness — an AI coding agent harness')
    .version(readVersion());
  if (options.exitOverride) {
    program.exitOverride();
  }

  program.addCommand(
    createKeyCommand({
      storeFactory: async () => buildCredentialStore({ readHidden: promptHidden }),
      readHidden: promptHidden,
      print: console.log,
      errPrint: console.error,
      ...deps.key,
    }),
  );

  program.addCommand(
    createConfigCommand({
      print: console.log,
      errPrint: console.error,
      ...deps.config,
    }),
  );

  program.addCommand(
    createStartCommand({
      readHidden: promptHidden,
      print: console.log,
      errPrint: console.error,
      ...deps.start,
    }),
  );

  // Task 27 (SPEC §4.3/§5.1): `codeharness` with no arguments enters the
  // interactive REPL — a task input runs the agent, later inputs inject new
  // instructions into the same conversation, /exit /help /model /clear
  // /status drive the session. Subcommands (start/key/config) still dispatch
  // normally.
  program.action(() => runReplAction({ ...deps.start }));

  return program;
}

/** Run only when executed directly (`node dist/cli/index.js`), never on import. */
const isDirectExecution = ((): boolean => {
  if (!process.argv[1]) return false;
  try {
    // realpath on both sides — under npm -g the bin is a symlink and
    // argv[1] may resolve differently from import.meta.url (C2 CR)
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  createProgram()
    .parseAsync(process.argv)
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`codeharness: ${message}`);
      process.exitCode = 1;
    });
}
