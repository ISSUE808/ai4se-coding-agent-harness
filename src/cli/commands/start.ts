import * as crypto from 'node:crypto';
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
import { createWebUIServer } from '../../webui/server.js';
import type { WebUIServer } from '../../webui/server.js';
import { InMemorySessionStore } from '../../webui/session-store.js';
import type { SessionStore } from '../../webui/session-store.js';

/**
 * `start <task>` (SPEC §4.3, §5.1, §8.2): initializes a session, runs the
 * AgentLoop, and streams messages to stdout. `start --web` (Task 19, SPEC §9)
 * starts the WebUI server and the real agent loop in the same process —
 * sessions created in the browser run on the live loop. The loop factory and
 * credential store are injectable — tests run the real AgentLoop against
 * MockProvider (SPEC §A.4-C) with zero network access.
 */

export interface BuildAgentLoopOptions {
  config: Config;
  events: HarnessEvents;
  /**
   * Task 19: the harness's shared HITLManager. The loop's guardrail decision
   * (requestApproval) and the WebUI approvals API gate the SAME instance, so
   * "approve in the browser → the paused session resumes" works end-to-end.
   */
  hitl?: HITLManager;
}

export type BuildAgentLoop = (
  opts: BuildAgentLoopOptions,
) => AgentLoop | Promise<AgentLoop>;

export interface StartCommandDeps {
  config?: LoadConfigOptions;
  loadConfig?: (options?: LoadConfigOptions) => Config;
  buildAgentLoop?: BuildAgentLoop;
  storeFactory?: () => Promise<CredentialStore>;
  /** Pre-built credential store shared by the server and every loop build. */
  store?: CredentialStore;
  readHidden?: (label: string) => Promise<string>;
  print?: (line: string) => void;
  errPrint?: (line: string) => void;
  /** Task 19: config persistence for PUT /api/config (defaults to project file). */
  persistConfig?: (config: Config) => Promise<void>;
  /** Task 19: how `start --web` blocks; injectable so tests don't hang. */
  waitForShutdown?: () => Promise<void>;
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
  return async ({ config, events, hitl }) => {
    const readHidden = deps.readHidden ?? promptHidden;
    const store =
      deps.store ??
      (await (deps.storeFactory ??
        (() =>
          buildCredentialStore({
            readHidden,
            apiKeySource: config.llm.apiKeySource, // SPEC §4.2: explicit source only
          })))());
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
      // Task 19: reuse the harness's HITLManager (see BuildAgentLoopOptions).
      hitl: hitl ?? new HITLManager(),
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

/**
 * Task 19 `start --web` (SPEC §5.1, §9): the WebUI server and the real agent
 * loop in a single process. Sessions created via POST /api/sessions are run
 * by the loop on the very object the SessionStore holds — store state and
 * loop state stay in sync, and every harness event is broadcast over the
 * same-process WebSocket channel. A fresh loop is built per session/resume
 * (per-session memory and round state); HITL decisions resume paused sessions
 * with their history re-seeded into the loop's memory.
 */
export interface CreateWebHarnessOptions {
  config: Config;
  events: HarnessEvents;
  credentialStore: CredentialStore;
  buildAgentLoop: BuildAgentLoop;
  /** Injectable store; defaults to InMemorySessionStore(config defaults). */
  sessionStore?: SessionStore;
  /** Config persistence for PUT /api/config (defaults to the project file). */
  persistConfig?: (config: Config) => Promise<void>;
}

export interface WebHarness {
  web: WebUIServer;
  /** Actual listening port (0 = ephemeral). */
  port: number;
  close(): Promise<void>;
}

export async function createWebHarness(opts: CreateWebHarnessOptions): Promise<WebHarness> {
  const { config, events, credentialStore, buildAgentLoop } = opts;
  const hitl = new HITLManager();
  const sessionStore =
    opts.sessionStore ?? new InMemorySessionStore(config.agent.maxRounds, config.agent.workspaceRoot);

  const runSession = async (session: Session): Promise<void> => {
    try {
      const loop = await buildAgentLoop({ config, events, hitl });
      await loop.run(session.task, { session });
    } catch (err) {
      // The loop never throws for LLM/tool failures, but guard against
      // wiring errors so the session is not left in 'running' forever.
      const message = err instanceof Error ? err.message : String(err);
      session.status = 'failed';
      session.updatedAt = new Date().toISOString();
      session.messages.push({
        id: crypto.randomUUID(),
        role: 'system',
        content: `Harness wiring failed: ${message}`,
        timestamp: new Date().toISOString(),
      });
      events.emit('session:status', { sessionId: session.id, status: 'failed' });
    }
  };

  const web = createWebUIServer({
    sessionStore,
    events,
    credentialStore,
    config,
    hitl,
    persistConfig: opts.persistConfig,
    onSessionCreated: (session) => {
      void runSession(session);
    },
    onApprovalResolved: (session) => {
      // Only HITL-paused sessions are candidates for continuation — the loop
      // is idle exactly when the store says 'paused'.
      if (session.status === 'paused') {
        void runSession(session);
      }
    },
  });
  const port = await web.listen(config.webui.port);
  return { web, port, close: () => web.close() };
}

/** Default `start --web` shutdown: wait for Ctrl+C (SIGINT). */
function waitForSigint(): Promise<void> {
  return new Promise((resolve) => {
    const onSigint = (): void => {
      process.removeListener('SIGINT', onSigint);
      resolve();
    };
    process.on('SIGINT', onSigint);
  });
}

/** Merge injectable config paths/cliArgs onto the CLI defaults. */
function loadStartConfig(deps: StartCommandDeps): Config {
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
  return (deps.loadConfig ?? loadConfig)(options);
}

/**
 * `start --web` (Task 19, SPEC §9): same-process WebUI + real agent loop.
 * Sessions created in the browser run on the live loop; the process stays
 * up until Ctrl+C (injectable for tests).
 */
async function runWebAction(deps: StartCommandDeps): Promise<void> {
  try {
    const config = loadStartConfig(deps);
    const events = createEventBus();
    const readHidden = deps.readHidden ?? promptHidden;
    // One credential store shared by the server AND every loop build.
    const credentialStore = await (deps.storeFactory ??
      (() =>
        buildCredentialStore({
          readHidden,
          apiKeySource: config.llm.apiKeySource, // SPEC §4.2: explicit source only
        })))();
    const buildAgentLoop =
      deps.buildAgentLoop ?? buildDefaultAgentLoop({ ...deps, store: credentialStore });
    const print = deps.print ?? console.log;

    const harness = await createWebHarness({
      config,
      events,
      credentialStore,
      buildAgentLoop,
      persistConfig: deps.persistConfig,
    });
    print(`[web] WebUI on http://localhost:${harness.port} — Ctrl+C to stop`);
    await (deps.waitForShutdown ?? waitForSigint)();
    await harness.close();
  } catch (err) {
    (deps.errPrint ?? console.error)(`codeharness start: ${adviceFor(err)}`);
    process.exitCode = 1;
  }
}

export function createStartCommand(deps: StartCommandDeps = {}): Command {
  const cmd = new Command('start');
  cmd.description('Run the coding agent on a task (or start the WebUI with --web)');
  cmd.argument('[task]', 'the task to complete (required without --web)');
  cmd.option('--web', 'start the WebUI server and run sessions from the browser (no task needed)');
  // Commander errors throw instead of process.exit so tests can assert them.
  cmd.exitOverride();
  cmd.action(async (task: string | undefined, flags: { web?: boolean }) => {
    if (flags.web) {
      await runWebAction(deps);
      return;
    }
    if (!task) {
      (deps.errPrint ?? console.error)(
        'codeharness start: a task is required (or pass --web to start the server)',
      );
      process.exitCode = 1;
      return;
    }
    try {
      const config = loadStartConfig(deps);
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
