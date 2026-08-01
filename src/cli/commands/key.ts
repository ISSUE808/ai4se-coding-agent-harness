import { Command } from 'commander';
import type { Config } from '../../types.js';
import type { CredentialStore } from '../../credentials/store.js';
import { loadConfig } from '../../config/loader.js';
import type { LoadConfigOptions } from '../../config/loader.js';
import { defaultConfigOptions } from '../options.js';
import { promptHidden, readKeyWithConfirm } from '../prompt.js';
import { adviceFor } from '../errors.js';
import { maskSecret } from '../../credentials/mask.js';

/**
 * `key` commands (SPEC §4.2/§4.3/§8.2-8.3): status shows only a masked
 * suffix, update takes hidden input, reset clears the key for re-recording.
 * Every operation flows through CredentialStore — never a new storage
 * implementation — and all IO (store, hidden reader, printers) is injectable
 * so tests never touch a real keychain.
 */

export interface KeyCommandDeps {
  storeFactory: () => Promise<CredentialStore>;
  /** Credential service (default: merged config llm.apiKeyService). */
  service?: string;
  /** Credential account (default: merged config llm.provider). */
  account?: string;
  loadConfig?: (options?: LoadConfigOptions) => Config;
  readHidden?: (label: string) => Promise<string>;
  print?: (line: string) => void;
  errPrint?: (line: string) => void;
}

interface KeyIdentity {
  service: string;
  account: string;
}

/** Resolve the credential identity, reading the merged config only if needed. */
function keyIdentity(deps: KeyCommandDeps): KeyIdentity {
  if (deps.service && deps.account) {
    return { service: deps.service, account: deps.account };
  }
  const config = (deps.loadConfig ?? loadConfig)(defaultConfigOptions());
  return {
    service: deps.service ?? config.llm.apiKeyService,
    account: deps.account ?? config.llm.provider,
  };
}

async function runKeyAction(
  deps: KeyCommandDeps,
  action: (store: CredentialStore, identity: KeyIdentity) => Promise<string>,
): Promise<void> {
  try {
    const identity = keyIdentity(deps);
    const store = await deps.storeFactory();
    const line = await action(store, identity);
    (deps.print ?? console.log)(line);
  } catch (err) {
    (deps.errPrint ?? console.error)(`codeharness key: ${adviceFor(err)}`);
    process.exitCode = 1;
  }
}

/** Masked status line, e.g. `API key for deepseek: ****-c123`. */
export async function keyStatus(
  store: CredentialStore,
  service: string,
  account: string,
): Promise<string> {
  const status = await store.status(service, account);
  return `API key for ${account}: ${status}`;
}

/** Hidden input + confirm → save; returns a masked confirmation only. */
export async function keyUpdate(
  store: CredentialStore,
  service: string,
  account: string,
  readHidden: (label: string) => Promise<string>,
): Promise<string> {
  const key = await readKeyWithConfirm(readHidden);
  await store.save(service, account, key);
  return `API key for ${account} saved: ${maskSecret(key)}`;
}

/** Clear the key (SPEC §4.2: reset then re-record); actionable when unset. */
export async function keyReset(
  store: CredentialStore,
  service: string,
  account: string,
): Promise<string> {
  const removed = await store.delete(service, account);
  return removed
    ? `API key for ${account} removed. Run 'codeharness key update' to add a new one.`
    : `No API key was set for ${account}; nothing to remove. Run 'codeharness key update' to add one.`;
}

export function createKeyCommand(deps: KeyCommandDeps): Command {
  const readHidden = deps.readHidden ?? promptHidden;

  const cmd = new Command('key');
  cmd.description('Manage the LLM API key');

  cmd
    .command('status')
    .description('Show the API key status (masked, never plaintext)')
    .action(() => runKeyAction(deps, (store, id) => keyStatus(store, id.service, id.account)));

  cmd
    .command('update')
    .description('Set or overwrite the API key (hidden input)')
    .action(() =>
      runKeyAction(deps, (store, id) => keyUpdate(store, id.service, id.account, readHidden)),
    );

  cmd
    .command('reset')
    .description('Remove the stored API key')
    .action(() => runKeyAction(deps, (store, id) => keyReset(store, id.service, id.account)));

  return cmd;
}
