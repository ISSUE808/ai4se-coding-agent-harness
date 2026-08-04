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
  formatMessageLine,
} from '../../../src/cli/commands/start.js';
import { createProgram } from '../../../src/cli/index.js';
import { mockBackend, parseCaptured } from './helpers.js';

/**
 * Task 26: capture every DeepSeekProvider constructed by createLLMProvider so
 * tests can assert which model the session override produced. A subclass is
 * used instead of a complete spy because the provider is constructed inside
 * the SecureHandle closure — `complete` is never called at build time.
 */
const { capturedProviders } = vi.hoisted(() => ({
  capturedProviders: [] as Array<{ model: string }>,
}));

vi.mock('../../../src/llm/deepseek-provider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/llm/deepseek-provider.js')>();
  return {
    ...actual,
    DeepSeekProvider: class extends actual.DeepSeekProvider {
      constructor(config: { model: string }) {
        super(config as never);
        capturedProviders.push(this);
      }
    },
  };
});

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
    // 降噪：纯工具调用的 assistant 消息（无文本）不打空头（CR Minor 5）
    expect(printed.filter((l) => l.trim() === '[assistant]')).toHaveLength(0);
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
      { toolCalls: [{ id: 'call_push', name: 'run_shell', arguments: { command: 'git push --force origin feature/x' } }] },
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
    // a git repo — but it RAN): the paused tool message was rewritten with
    // the real execution result, visible to the LLM.
    const executed = session.messages.filter(
      (m) =>
        m.role === 'tool' &&
        ((m.metadata?.toolResult?.error as string | undefined) ?? '').includes('fatal'),
    );
    expect(executed.length).toBeGreaterThanOrEqual(1);
  });

  it('CLI interactive approval: deny records the decision and continues', async () => {
    const responses: LLMResponse[] = [
      { toolCalls: [{ id: 'call_push', name: 'run_shell', arguments: { command: 'git push --force origin feature/x' } }] },
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

  it('does not re-ask an approved command when the resumed run hits maxRounds (I1 CR)', async () => {
    // maxRounds = 1: the resumed run upgrades (triggerHITL pause, no
    // requestApproval) — HITL state is EXECUTING, so the approval loop must
    // NOT ask again (approve() would throw in EXECUTING state).
    const responses: LLMResponse[] = [
      { toolCalls: [{ id: 'call_push', name: 'run_shell', arguments: { command: 'git push --force origin feature/x' } }] },
      { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
    ];
    const ask = vi.fn(async () => true);
    const session = await runStartTask({
      task: 'push',
      config: { ...makeConfig(), agent: { ...makeConfig().agent, maxRounds: 1 } },
      buildAgentLoop: buildMockAgentLoop(responses),
      hitl: new HITLManager(),
      promptApproval: ask,
    });
    expect(ask).toHaveBeenCalledTimes(1);
    // The upgrade pause is reported cleanly instead of crashing mid-loop.
    expect(session.status).toBe('paused');
  });

  it('prints actionable resume guidance when the run ends paused (KNOWN_ISSUES 1)', async () => {
    // Upgrade pause (maxRounds reached): no pending command, so no stdin
    // approval is possible — the run exits paused with only "[session]
    // paused" today, and the user has no idea how to continue.
    const printed: string[] = [];
    const responses: LLMResponse[] = [
      { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
      { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
    ];
    const session = await runStartTask({
      task: 'read test.ts',
      config: { ...makeConfig(), agent: { ...makeConfig().agent, maxRounds: 1 } },
      buildAgentLoop: buildMockAgentLoop(responses),
      hitl: new HITLManager(),
      print: (line) => printed.push(line),
    });
    expect(session.status).toBe('paused');
    const guidance = printed.find((l) => l.includes('已暂停'));
    expect(guidance).toBeDefined();
    expect(guidance ?? '').toContain('--web');
    expect(guidance ?? '').toContain('maxRounds');
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

describe('formatMessageLine', () => {
  it('着色模式给标签加 ANSI 色（user 绿 / assistant 青 / tool 灰），正文不着色', () => {
    expect(formatMessageLine({ id: 'm1', role: 'user', content: 'hello', timestamp: 't' }, true)).toBe(
      '\x1b[32m[user]\x1b[0m hello',
    );
    expect(
      formatMessageLine({ id: 'm2', role: 'assistant', content: 'hi', timestamp: 't' }, true),
    ).toBe('\x1b[36m[assistant]\x1b[0m hi');
    expect(
      formatMessageLine(
        { id: 'm3', role: 'tool', content: 'out', metadata: { toolName: 'run_shell' }, timestamp: 't' },
        true,
      ),
    ).toBe('\x1b[90m[tool:run_shell]\x1b[0m out');
  });

  it('无色模式输出纯文本（默认；管道/重定向与测试注入场景）', () => {
    expect(formatMessageLine({ id: 'm1', role: 'user', content: 'hello', timestamp: 't' })).toBe(
      '[user] hello',
    );
  });

  it('空内容消息（纯工具调用的 assistant 消息）返回 null——不打印空头', () => {
    expect(
      formatMessageLine({ id: 'm1', role: 'assistant', content: '', timestamp: 't' }),
    ).toBeNull();
  });

  it('feedback 消息（系统类）标签灰色（CR Minor 1）', () => {
    expect(
      formatMessageLine({ id: 'm4', role: 'feedback', content: 'x', timestamp: 't' }, true),
    ).toBe('\x1b[90m[feedback]\x1b[0m x');
  });

  it('color: true 时着色标签到达打印流（TTY 模式端到端，CR Minor 3）', async () => {
    const printed: string[] = [];
    const responses: LLMResponse[] = [
      { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
      { content: 'Task complete.' },
    ];
    await runStartTask({
      task: 'read test.ts',
      config: makeConfig(),
      buildAgentLoop: buildMockAgentLoop(responses),
      print: (line) => printed.push(line),
      color: true,
    });
    const out = printed.join('\n');
    expect(out).toContain('\x1b[32m[user]\x1b[0m read test.ts');
    expect(out).toContain('\x1b[36m[assistant]\x1b[0m Task complete.');
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

  it('an explicit model override wins over config.llm.model (Task 26 session override)', async () => {
    const backend = mockBackend('mock', { secret: 'sk-abc' });
    const store = new CredentialStore([backend.backend]);
    capturedProviders.length = 0;
    const provider = await createLLMProvider(deepseekConfig(), store, { model: 'deepseek-v3' });
    expect(provider).toBeInstanceOf(DeepSeekProvider);
    // The DeepSeekProvider was constructed with the session's model.
    expect(capturedProviders).toHaveLength(1);
    expect(capturedProviders[0].model).toBe('deepseek-v3');
  });

  it('without a model override the provider uses config.llm.model (CLI sessions unaffected)', async () => {
    const backend = mockBackend('mock', { secret: 'sk-abc' });
    const store = new CredentialStore([backend.backend]);
    capturedProviders.length = 0;
    await createLLMProvider(deepseekConfig(), store, {});
    expect(capturedProviders[0].model).toBe(DEFAULT_CONFIG.llm.model);
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
    // CI regression fix: runWebAction 不给 createWebHarness 传 staticDir，走
    // resolveStaticDir 的 env 覆盖路径（CODEHARNESS_WEBUI_DIR，生产/Electron 同
    // 机制）。CI 的 unit-test job 不构建 client（dist 被 gitignore），真实 dist
    // 缺失时 createWebHarness 抛"请先构建前端"→ 测试在 CI 红、本机绿。指向
    // fixture 静态目录使测试自给自足。
    const webuiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-cli-webui-'));
    fs.writeFileSync(path.join(webuiDir, 'index.html'), '<!doctype html><title>CodeHarness</title>');
    const originalWebuiDir = process.env.CODEHARNESS_WEBUI_DIR;
    try {
      // runWebAction 只在失败时写 exitCode=1，成功路径不触碰——测试必须自己
      // 播种 0，否则单独跑（-t 过滤）时 worker 里 exitCode 是 undefined（Node
      // 默认值），断言依赖前一个测试的 afterEach 才成立（顺序耦合）。
      process.exitCode = 0;
      process.env.CODEHARNESS_WEBUI_DIR = webuiDir;
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
    } finally {
      if (originalWebuiDir === undefined) {
        delete process.env.CODEHARNESS_WEBUI_DIR;
      } else {
        process.env.CODEHARNESS_WEBUI_DIR = originalWebuiDir;
      }
      fs.rmSync(webuiDir, { recursive: true, force: true });
    }
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
