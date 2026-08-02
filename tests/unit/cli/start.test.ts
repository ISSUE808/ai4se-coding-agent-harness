import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentLoop } from '../../../src/core/main-loop.js';
import { MockProvider } from '../../../src/llm/mock-provider.js';
import { DeepSeekProvider } from '../../../src/llm/deepseek-provider.js';
import { ToolRegistry } from '../../../src/tools/tool.js';
import { readFileTool } from '../../../src/tools/read-file.js';
import { ActionClassifier } from '../../../src/feedback/action-classifier.js';
import { ValidatorSelector } from '../../../src/feedback/validator-selector.js';
import { FailureClassifier } from '../../../src/feedback/failure-classifier.js';
import { StrategyMatcher } from '../../../src/feedback/strategy-matcher.js';
import { RoundManager } from '../../../src/feedback/round-manager.js';
import { FormatValidator } from '../../../src/feedback/validators/format-validator.js';
import { EslintValidator } from '../../../src/feedback/validators/eslint-validator.js';
import { TscValidator } from '../../../src/feedback/validators/tsc-validator.js';
import { ShellCheckValidator } from '../../../src/feedback/validators/shell-check-validator.js';
import { PatternGuard } from '../../../src/guardrail/pattern-guard.js';
import { ScopeFence } from '../../../src/guardrail/scope-fence.js';
import { HITLManager } from '../../../src/guardrail/hitl-manager.js';
import { SessionMemory } from '../../../src/memory/session-memory.js';
import { createEventBus } from '../../../src/events.js';
import type { HarnessEvents } from '../../../src/events.js';
import { DEFAULT_CONFIG } from '../../../src/config/schema.js';
import type { Config } from '../../../src/types.js';
import type { LLMResponse, Validator } from '../../../src/types.js';
import { CredentialStore } from '../../../src/credentials/store.js';
import {
  createStartCommand,
  runStartTask,
  createLLMProvider,
} from '../../../src/cli/commands/start.js';
import { createProgram } from '../../../src/cli/index.js';
import { mockBackend, parseCaptured } from './helpers.js';

/**
 * start command (SPEC §4.3, §8.2): runs the AgentLoop, streams messages to
 * stdout, bootstraps the API key on first run. All loops use MockProvider —
 * deterministic, zero network.
 */

afterEach(() => {
  process.exitCode = 0;
});

let workspaceRoot: string;

function makeConfig(root = workspaceRoot): Config {
  return {
    ...DEFAULT_CONFIG,
    agent: { ...DEFAULT_CONFIG.agent, workspaceRoot: root },
  };
}

/** Real AgentLoop wired with MockProvider (mirrors the integration harness). */
function buildMockAgentLoop(responses: LLMResponse[]) {
  return async ({
    config,
    events,
    hitl,
  }: {
    config: Config;
    events: HarnessEvents;
    hitl?: HITLManager;
  }) => {
    const mockLLM = new MockProvider(responses);
    const tools = new ToolRegistry();
    tools.register(readFileTool);
    const memory = new SessionMemory(config);
    const guard = {
      patternGuard: new PatternGuard(),
      scopeFence: new ScopeFence(),
      hitl: hitl ?? new HITLManager(),
    };
    const validatorMap = new Map<string, Validator>();
    validatorMap.set('eslint', new EslintValidator());
    validatorMap.set('tsc', new TscValidator());
    validatorMap.set('stderrChecker', new ShellCheckValidator());
    validatorMap.set('formatChecker', new FormatValidator());
    const feedback = {
      classifier: new ActionClassifier(),
      selector: new ValidatorSelector(),
      failureClassifier: new FailureClassifier(),
      strategyMatcher: new StrategyMatcher(),
      roundManager: new RoundManager(config.agent.maxRounds),
    };
    return new AgentLoop(mockLLM, tools, guard, feedback, validatorMap, memory, events, config);
  };
}

beforeAll(() => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-cli-start-'));
  fs.writeFileSync(path.join(workspaceRoot, 'test.ts'), 'const answer = 42;\n');
});

afterAll(() => {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

describe('runStartTask', () => {
  it('runs an AgentLoop with MockProvider and streams messages to stdout in order', async () => {
    const printed: string[] = [];
    const responses: LLMResponse[] = [
      { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
      { content: 'Task complete.' },
    ];
    const session = await runStartTask({
      task: 'read test.ts',
      config: makeConfig(),
      buildAgentLoop: buildMockAgentLoop(responses),
      print: (line) => printed.push(line),
    });
    expect(session.status).toBe('completed');
    // User message arrives before the assistant's final answer (streaming order)
    const userIdx = printed.findIndex((l) => l.includes('[user] read test.ts'));
    const assistantIdx = printed.findIndex((l) => l.includes('Task complete.'));
    expect(userIdx).toBeGreaterThanOrEqual(0);
    expect(assistantIdx).toBeGreaterThan(userIdx);
    // Final status line
    expect(printed.some((l) => l.includes('status=completed'))).toBe(true);
  });

  it('prints a failed status when the loop fails (no more mock responses)', async () => {
    const printed: string[] = [];
    const session = await runStartTask({
      task: 'explode',
      config: makeConfig(),
      buildAgentLoop: buildMockAgentLoop([]),
      print: (line) => printed.push(line),
    });
    expect(session.status).toBe('failed');
    expect(printed.some((l) => l.includes('status=failed'))).toBe(true);
  });

  it('CLI interactive approval: approve executes the operation and resumes', async () => {
    const responses: LLMResponse[] = [
      { toolCalls: [{ name: 'run_shell', arguments: { command: 'git push --force origin feature/x' } }] },
      { content: 'done' },
    ];
    const session = await runStartTask({
      task: 'push',
      config: makeConfig(),
      buildAgentLoop: buildMockAgentLoop(responses),
      hitl: new HITLManager(),
      promptApproval: async () => true, // user says yes
    });
    expect(session.status).toBe('completed');
    // The approved shell command was executed by the harness (it fails — not
    // a git repo — but it RAN), and the loop resumed to completion.
    expect(session.messages.some((m) => m.content.includes('Approved operation executed: git push --force origin feature/x'))).toBe(true);
    expect(session.messages.some((m) => m.content.includes('fatal'))).toBe(true);
  });

  it('CLI interactive approval: deny records the decision and continues', async () => {
    const responses: LLMResponse[] = [
      { toolCalls: [{ name: 'run_shell', arguments: { command: 'git push --force origin feature/x' } }] },
      { content: 'done' },
    ];
    const session = await runStartTask({
      task: 'push',
      config: makeConfig(),
      buildAgentLoop: buildMockAgentLoop(responses),
      hitl: new HITLManager(),
      promptApproval: async () => false, // user says no
    });
    expect(session.status).toBe('completed');
    expect(session.messages.some((m) => m.content.includes('Command denied'))).toBe(true);
    // The command was NOT executed.
    expect(session.messages.some((m) => m.content.includes('Approved operation executed'))).toBe(false);
  });

  it('sets exit code 1 when the session ends without completing (I3 CR)', async () => {
    const printed: string[] = [];
    const cmd = createStartCommand({
      config: {
        userConfigPath: path.join(workspaceRoot, 'missing-user.json'),
        projectConfigPath: path.join(workspaceRoot, 'missing-project.json'),
      },
      buildAgentLoop: buildMockAgentLoop([]), // no responses → loop fails
      print: (line) => printed.push(line),
    });
    await parseCaptured(cmd, ['start', 'explode']);
    expect(printed.some((l) => l.includes('status=failed'))).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('unsubscribes event listeners after the run (no leaked output)', async () => {
    const printed: string[] = [];
    const events = createEventBus();
    await runStartTask({
      task: 'read test.ts',
      config: makeConfig(),
      buildAgentLoop: buildMockAgentLoop([
        { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
        { content: 'Done.' },
      ]),
      events,
      print: (line) => printed.push(line),
    });
    const before = printed.length;
    expect(before).toBeGreaterThan(0);
    // Emitting after the run must not reach the removed listeners
    events.emit('message:added', {
      id: 'post-run',
      role: 'assistant',
      content: 'leaked line',
      timestamp: 't',
    });
    events.emit('session:status', { sessionId: 'post-run', status: 'completed' });
    expect(printed.length).toBe(before);
    expect(printed.some((l) => l.includes('leaked line'))).toBe(false);
  });
});

describe('createLLMProvider', () => {
  const service = 'codeharness/deepseek';
  const account = 'deepseek';

  function deepseekConfig(): Config {
    return { ...makeConfig(), llm: { ...DEFAULT_CONFIG.llm, provider: 'deepseek' } };
  }

  it('returns a MockProvider for llm.provider=mock without touching credentials', async () => {
    const config = { ...makeConfig(), llm: { ...DEFAULT_CONFIG.llm, provider: 'mock' } };
    const backend = mockBackend('mock', { secret: 'sk-mock' });
    const store = new CredentialStore([backend.backend]);
    const provider = await createLLMProvider(config, store, {});
    expect(provider).toBeInstanceOf(MockProvider);
    expect(backend.read).not.toHaveBeenCalled();
  });

  it('bootstraps a missing key: hidden input → confirm → auto-store → DeepSeekProvider (SPEC §4.3)', async () => {
    const backend = mockBackend('mock', { secret: null });
    const store = new CredentialStore([backend.backend]);
    const readHidden = vi
      .fn()
      .mockResolvedValueOnce('sk-boot-123')
      .mockResolvedValueOnce('sk-boot-123');
    const print = vi.fn();
    const provider = await createLLMProvider(deepseekConfig(), store, { readHidden, print });
    expect(backend.save).toHaveBeenCalledWith(service, account, 'sk-boot-123');
    expect(print).toHaveBeenCalledWith(expect.stringContaining('No API key found'));
    // The key is consumed inside the SecureHandle closure — provider is constructed
    expect(provider).toBeInstanceOf(DeepSeekProvider);
  });

  it('fails with actionable advice when the key is missing and no interactive input is available', async () => {
    const backend = mockBackend('mock', { secret: null });
    const store = new CredentialStore([backend.backend]);
    await expect(createLLMProvider(deepseekConfig(), store, {})).rejects.toThrow(
      /key update/i,
    );
  });
});

describe('createStartCommand wiring', () => {
  it('`start <task>` loads config and runs the loop, printing messages to stdout', async () => {
    const out: string[] = [];
    const responses: LLMResponse[] = [
      { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
      { content: 'All done.' },
    ];
    const cmd = createStartCommand({
      config: {
        userConfigPath: path.join(workspaceRoot, 'missing-user.json'),
        projectConfigPath: path.join(workspaceRoot, 'missing-project.json'),
      },
      buildAgentLoop: buildMockAgentLoop(responses),
      print: (line) => out.push(line),
    });
    const result = await parseCaptured(cmd, ['start', 'read test.ts']);
    const printed = out.join('');
    expect(printed).toContain('All done.');
    expect(printed).toContain('status=completed');
    expect(result.err).toBe('');
  });

  it('prints actionable advice and sets exit code 1 when the config is broken', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-cli-badcfg-'));
    const badPath = path.join(dir, 'config.json');
    fs.writeFileSync(badPath, '{ not valid json');
    const errLines: string[] = [];
    const cmd = createStartCommand({
      config: {
        userConfigPath: badPath,
        projectConfigPath: path.join(dir, 'missing.json'),
      },
      errPrint: (line) => errLines.push(line),
    });
    await parseCaptured(cmd, ['start', 'any task']);
    expect(errLines.join('')).toMatch(/Failed to parse config/i);
    expect(process.exitCode).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('`start --web` starts the server in-process and prints the URL (no task needed)', async () => {
    const printed: string[] = [];
    const cmd = createStartCommand({
      config: {
        userConfigPath: path.join(workspaceRoot, 'missing-user.json'),
        projectConfigPath: path.join(workspaceRoot, 'missing-project.json'),
        cliArgs: { webui: { port: 0 } }, // ephemeral port — no collision with other servers
      },
      storeFactory: async () => new CredentialStore([mockBackend('mem', { secret: 'sk-mock' }).backend]),
      buildAgentLoop: buildMockAgentLoop([{ content: 'done' }]),
      print: (line) => printed.push(line),
      waitForShutdown: async () => {
        // Test-only: resolve immediately so the command exits.
      },
    });
    const result = await parseCaptured(cmd, ['start', '--web']);
    expect(printed.some((l) => l.includes('[web] WebUI'))).toBe(true);
    expect(result.err).toBe('');
    expect(process.exitCode).toBe(0);
  });

  it('`start` without a task and without --web exits 1 with a task-required error', async () => {
    // Parse through createProgram (as the real CLI does) so `start` is
    // dispatched as the subcommand name instead of a positional task.
    const errLines: string[] = [];
    const program = createProgram(
      {
        start: {
          config: {
            userConfigPath: path.join(workspaceRoot, 'missing-user.json'),
            projectConfigPath: path.join(workspaceRoot, 'missing-project.json'),
          },
          buildAgentLoop: buildMockAgentLoop([]),
          errPrint: (line) => errLines.push(line),
        },
      },
      { exitOverride: true },
    );
    await parseCaptured(program, ['start']);
    expect(errLines.join('')).toMatch(/task/i);
    expect(process.exitCode).toBe(1);
  });

  it('`start --help` displays usage and exits cleanly (M1: no exitOverride in production)', async () => {
    // Production (no deps.exitOverride): commander's help path is untouched —
    // `start --help` must NOT throw a helpDisplayed error for index.ts to catch.
    const cmd = createStartCommand({
      config: {
        userConfigPath: path.join(workspaceRoot, 'missing-user.json'),
        projectConfigPath: path.join(workspaceRoot, 'missing-project.json'),
      },
    }) as unknown as { _exitCallback?: unknown };
    expect(cmd._exitCallback).toBeNull();

    // Test-injected exitOverride: help still displays, and the help exit
    // surfaces as a distinguishable code-0 throw instead of process.exit.
    const injected = createStartCommand({
      config: {
        userConfigPath: path.join(workspaceRoot, 'missing-user.json'),
        projectConfigPath: path.join(workspaceRoot, 'missing-project.json'),
      },
      exitOverride: true,
    });
    const result = await parseCaptured(injected, ['start', '--help']);
    expect(result.out).toContain('Usage');
    const thrown = result.thrown as { code?: string; exitCode?: number };
    expect(thrown?.code).toBe('commander.helpDisplayed');
    expect(thrown?.exitCode).toBe(0);
  });
});
