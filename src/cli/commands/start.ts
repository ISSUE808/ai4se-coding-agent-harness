import { Command } from 'commander';
import type { Config, LLMProvider, Session, Validator } from '../../types.js';
import { AgentLoop } from '../../core/main-loop.js';
import { MockProvider } from '../../llm/mock-provider.js';
import { DeepSeekProvider } from '../../llm/deepseek-provider.js';
import { ToolRegistry } from '../../tools/tool.js';
import { readFileTool } from '../../tools/read-file.js';
import { writeFileTool } from '../../tools/write-file.js';
import { editFileTool } from '../../tools/edit-file.js';
import { listDirectoryTool } from '../../tools/list-directory.js';
import { searchContentTool } from '../../tools/search-content.js';
import { runShellTool } from '../../tools/run-shell.js';
import { runTestTool } from '../../tools/run-test.js';
import { ActionClassifier } from '../../feedback/action-classifier.js';
import { ValidatorSelector } from '../../feedback/validator-selector.js';
import { FailureClassifier } from '../../feedback/failure-classifier.js';
import { StrategyMatcher } from '../../feedback/strategy-matcher.js';
import { RoundManager } from '../../feedback/round-manager.js';
import { FormatValidator } from '../../feedback/validators/format-validator.js';
import { EslintValidator } from '../../feedback/validators/eslint-validator.js';
import { TscValidator } from '../../feedback/validators/tsc-validator.js';
import { ShellCheckValidator } from '../../feedback/validators/shell-check-validator.js';
import { TestResultValidator } from '../../feedback/validators/test-result-validator.js';
import { PatternGuard } from '../../guardrail/pattern-guard.js';
import { ScopeFence } from '../../guardrail/scope-fence.js';
import { HITLManager } from '../../guardrail/hitl-manager.js';
import { SessionMemory } from '../../memory/session-memory.js';
import { createEventBus } from '../../events.js';
import type { HarnessEvents, HarnessEventMap } from '../../events.js';
import type { CredentialStore } from '../../credentials/store.js';
import { CredentialNotFoundError } from '../../credentials/store.js';
import type { SecureHandle } from '../../credentials/secure-handle.js';
import { loadConfig } from '../../config/loader.js';
import type { LoadConfigOptions } from '../../config/loader.js';
import { defaultConfigOptions } from '../options.js';
import { buildCredentialStore } from '../store.js';
import { promptHidden, readKeyWithConfirm } from '../prompt.js';
import { adviceFor } from '../errors.js';

/**
 * `start <task>` (SPEC §4.3, §5.1, §8.2): initializes a session, runs the
 * AgentLoop, and streams messages to stdout. The loop factory and credential
 * store are injectable — tests run the real AgentLoop against MockProvider
 * (SPEC §A.4-C) with zero network access.
 */

export interface BuildAgentLoopOptions {
  config: Config;
  events: HarnessEvents;
}

export type BuildAgentLoop = (
  opts: BuildAgentLoopOptions,
) => AgentLoop | Promise<AgentLoop>;

export interface StartCommandDeps {
  config?: LoadConfigOptions;
  loadConfig?: (options?: LoadConfigOptions) => Config;
  buildAgentLoop?: BuildAgentLoop;
  storeFactory?: () => Promise<CredentialStore>;
  readHidden?: (label: string) => Promise<string>;
  print?: (line: string) => void;
  errPrint?: (line: string) => void;
}

export interface RunStartTaskOptions {
  task: string;
  config: Config;
  buildAgentLoop: BuildAgentLoop;
  events?: HarnessEvents;
  print?: (line: string) => void;
}

function formatMessageLine(data: HarnessEventMap['message:added']): string {
  const toolName =
    typeof data.metadata?.toolName === 'string' ? `:${data.metadata.toolName}` : '';
  return `[${data.role}${toolName}] ${data.content}`;
}

/**
 * Run the loop, streaming every message to stdout as it is produced
 * (message:added / session:status events). Listeners are always removed
 * after the run.
 */
export async function runStartTask(opts: RunStartTaskOptions): Promise<Session> {
  const print = opts.print ?? console.log;
  const events = opts.events ?? createEventBus();

  const onMessage = (data: HarnessEventMap['message:added']): void => {
    print(formatMessageLine(data));
  };
  const onStatus = (data: HarnessEventMap['session:status']): void => {
    print(`[session] ${data.status}`);
  };

  events.on('message:added', onMessage);
  events.on('session:status', onStatus);
  try {
    const loop = await opts.buildAgentLoop({ config: opts.config, events });
    const session = await loop.run(opts.task);
    print(
      `[session] done: ${session.id} status=${session.status} rounds=${session.currentRound}`,
    );
    return session;
  } finally {
    events.off('message:added', onMessage);
    events.off('session:status', onStatus);
  }
}

export interface CreateProviderOptions {
  readHidden?: (label: string) => Promise<string>;
  print?: (line: string) => void;
}

/**
 * Build the LLM provider from config.llm.provider ('deepseek' | 'mock').
 *
 * The DeepSeek API key is read strictly inside a SecureHandle closure and is
 * consumed at construction — the plaintext never leaves that scope
 * (SPEC §3.7). When the key is missing, first-run bootstrap prompts hidden
 * input, confirms, and auto-stores it (SPEC §4.3/§8.2).
 */
export async function createLLMProvider(
  config: Config,
  store: CredentialStore,
  opts: CreateProviderOptions = {},
): Promise<LLMProvider> {
  const print = opts.print ?? console.log;

  if (config.llm.provider === 'mock') {
    return new MockProvider([]);
  }

  const service = config.llm.apiKeyService;
  const account = config.llm.provider;

  let handle: SecureHandle;
  try {
    handle = await store.get(service, account);
  } catch (err) {
    if (!(err instanceof CredentialNotFoundError)) {
      throw err;
    }
    // First-run bootstrap: hidden input → confirm → auto-store
    if (!opts.readHidden) {
      throw new Error(
        `No API key found for ${account}. Run 'codeharness key update' to add one.`,
      );
    }
    print(`No API key found for ${account}.`);
    const key = await readKeyWithConfirm(opts.readHidden);
    await store.save(service, account, key);
    handle = await store.get(service, account);
  }

  return handle.use(
    (key) =>
      new DeepSeekProvider({
        baseUrl: config.llm.baseUrl,
        apiKey: key,
        model: config.llm.model,
        maxTokens: config.llm.maxTokens,
      }),
  );
}

/** Default production wiring: real tools, real validators, configured provider. */
function buildDefaultAgentLoop(deps: StartCommandDeps): BuildAgentLoop {
  return async ({ config, events }) => {
    const readHidden = deps.readHidden ?? promptHidden;
    const storeFactory =
      deps.storeFactory ??
      (() =>
        buildCredentialStore({
          readHidden,
          apiKeySource: config.llm.apiKeySource, // SPEC §4.2: explicit source only
        }));
    const store = await storeFactory();
    const llm = await createLLMProvider(config, store, { readHidden });

    const tools = new ToolRegistry();
    tools.register(readFileTool);
    tools.register(writeFileTool);
    tools.register(editFileTool);
    tools.register(listDirectoryTool);
    tools.register(searchContentTool);
    tools.register(runShellTool);
    tools.register(runTestTool);

    const memory = new SessionMemory(config);
    const guard = {
      patternGuard: new PatternGuard(),
      scopeFence: new ScopeFence(),
      hitl: new HITLManager(),
    };
    const validatorMap = new Map<string, Validator>();
    validatorMap.set('eslint', new EslintValidator());
    validatorMap.set('tsc', new TscValidator());
    validatorMap.set('stderrChecker', new ShellCheckValidator());
    validatorMap.set('formatChecker', new FormatValidator());
    validatorMap.set('testResultParser', new TestResultValidator());
    const feedback = {
      classifier: new ActionClassifier(),
      selector: new ValidatorSelector(),
      failureClassifier: new FailureClassifier(),
      strategyMatcher: new StrategyMatcher(),
      roundManager: new RoundManager(config.agent.maxRounds),
    };

    return new AgentLoop(llm, tools, guard, feedback, validatorMap, memory, events, config);
  };
}

export function createStartCommand(deps: StartCommandDeps = {}): Command {
  const cmd = new Command('start');
  cmd.description('Run the coding agent on a task');
  cmd.argument('<task>', 'the task to complete');
  cmd.action(async (task: string) => {
    try {
      const options: LoadConfigOptions = { ...defaultConfigOptions() };
      if (deps.config) {
        if (deps.config.userConfigPath !== undefined) {
          options.userConfigPath = deps.config.userConfigPath;
        }
        if (deps.config.projectConfigPath !== undefined) {
          options.projectConfigPath = deps.config.projectConfigPath;
        }
        if (deps.config.cliArgs !== undefined) options.cliArgs = deps.config.cliArgs;
      }
      const config = (deps.loadConfig ?? loadConfig)(options);
      const buildAgentLoop = deps.buildAgentLoop ?? buildDefaultAgentLoop(deps);
      const session = await runStartTask({
        task,
        config,
        buildAgentLoop,
        print: deps.print,
      });
      // I3 (CR): failed/paused sessions exit non-zero so scripts can detect
      // "the task did not complete" (key/config already use exit code 1).
      if (session.status !== 'completed') {
        process.exitCode = 1;
      }
    } catch (err) {
      (deps.errPrint ?? console.error)(`codeharness start: ${adviceFor(err)}`);
      process.exitCode = 1;
    }
  });
  return cmd;
}
