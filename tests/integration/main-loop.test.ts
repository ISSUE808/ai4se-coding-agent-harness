import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AgentLoop } from '../../src/core/main-loop.js';
import { MockProvider } from '../../src/llm/mock-provider.js';
import { ToolRegistry } from '../../src/tools/tool.js';
import { readFileTool } from '../../src/tools/read-file.js';
import { writeFileTool } from '../../src/tools/write-file.js';
import { ActionClassifier } from '../../src/feedback/action-classifier.js';
import { ValidatorSelector } from '../../src/feedback/validator-selector.js';
import { FailureClassifier } from '../../src/feedback/failure-classifier.js';
import { StrategyMatcher } from '../../src/feedback/strategy-matcher.js';
import { RoundManager } from '../../src/feedback/round-manager.js';
import { FormatValidator } from '../../src/feedback/validators/format-validator.js';
import { EslintValidator } from '../../src/feedback/validators/eslint-validator.js';
import { TscValidator } from '../../src/feedback/validators/tsc-validator.js';
import { ShellCheckValidator } from '../../src/feedback/validators/shell-check-validator.js';
import type { Validator } from '../../src/types.js';
import type { LLMResponse } from '../../src/types.js';
import { PatternGuard } from '../../src/guardrail/pattern-guard.js';
import { ScopeFence } from '../../src/guardrail/scope-fence.js';
import { HITLManager } from '../../src/guardrail/hitl-manager.js';
import { SessionMemory } from '../../src/memory/session-memory.js';
import { createEventBus } from '../../src/events.js';
import { DEFAULT_CONFIG } from '../../src/config/schema.js';
import type { Config } from '../../src/types.js';
import { InMemorySessionStore } from '../../src/webui/session-store.js';

function createMockExec() {
  return () => {
    throw new Error('mock exec: tool not available in test');
  };
}

function createTestHarness(
  mockResponses: LLMResponse[],
  workspaceRoot: string,
  overrides?: { maxRounds?: number },
) {
  const mockLLM = new MockProvider(mockResponses);
  const tools = new ToolRegistry();
  tools.register(readFileTool);
  tools.register(writeFileTool);

  const events = createEventBus();
  const config: Config = {
    ...DEFAULT_CONFIG,
    agent: {
      ...DEFAULT_CONFIG.agent,
      workspaceRoot,
      maxRounds: overrides?.maxRounds ?? 3,
    },
  };
  const memory = new SessionMemory(config);

  const guard = {
    patternGuard: new PatternGuard(),
    scopeFence: new ScopeFence(),
    hitl: new HITLManager(),
  };

  const mockExec = createMockExec();
  const validatorMap = new Map<string, Validator>();
  validatorMap.set('eslint', new EslintValidator(mockExec as any));
  validatorMap.set('tsc', new TscValidator(mockExec as any));
  validatorMap.set('stderrChecker', new ShellCheckValidator());
  validatorMap.set('formatChecker', new FormatValidator());

  const feedback = {
    classifier: new ActionClassifier(),
    selector: new ValidatorSelector(),
    failureClassifier: new FailureClassifier(),
    strategyMatcher: new StrategyMatcher(),
    roundManager: new RoundManager(config.agent.maxRounds),
  };

  return new AgentLoop(
    mockLLM,
    tools,
    guard,
    feedback,
    validatorMap,
    memory,
    events,
    config,
  );
}

describe('Agent Main Loop (integration)', () => {
  let workspaceRoot: string;

  beforeAll(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-test-'));
    // Create a minimal file for read_file to succeed
    fs.writeFileSync(path.join(workspaceRoot, 'test.ts'), 'const answer = 42;\n');
  });

  afterAll(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('简单任务：读取文件后完成', async () => {
    const harness = createTestHarness(
      [
        { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
        { content: '任务已完成。文件已读取。' },
      ],
      workspaceRoot,
    );
    const session = await harness.run('读取 test.ts 文件');
    expect(session.status).toBe('completed');
    expect(session.messages.length).toBeGreaterThan(0);

    // Verify read_file tool was executed and produced a tool message
    const toolMessages = session.messages.filter((m) => m.role === 'tool');
    expect(toolMessages.length).toBe(1);
    expect(toolMessages[0].metadata?.toolName).toBe('read_file');
    expect(toolMessages[0].metadata?.toolResult?.success).toBe(true);

    // Check that the user task was recorded
    const userMessages = session.messages.filter((m) => m.role === 'user');
    expect(userMessages.length).toBe(1);
    expect(userMessages[0].content).toContain('读取 test.ts 文件');
  });

  it.each([
    // Fixtures must genuinely LOOK like an inline-JSON tool call (start with
    // '{' or '[') — prose garbage like 'not valid json {{{}' is treated as
    // plain text, not a JSON attempt (KNOWN_ISSUES 9.5 heuristic).
    { name: '以 { 开头', malformed: '{"tool": "read_file", "params": {' },
    { name: '以 [ 开头', malformed: '[{"tool": "read_file", "params": {' },
  ])('解析错误恢复：收到残缺 JSON（$name）后正确重试', async ({ malformed }) => {
    const harness = createTestHarness(
      [
        { content: malformed },
        { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
        { content: 'done' },
      ],
      workspaceRoot,
    );
    const session = await harness.run('读取文件');

    // Should have a parse_error feedback message
    const feedbackMessages = session.messages.filter((m) => m.role === 'feedback');
    expect(feedbackMessages.length).toBeGreaterThan(0);
    expect(
      feedbackMessages.some(
        (f) => f.metadata?.feedbackResult?.failureCategory === 'parse_error',
      ),
    ).toBe(true);

    // Agent should recover and complete
    expect(session.status).toBe('completed');

    // Should have executed read_file after recovery
    const toolMessages = session.messages.filter((m) => m.role === 'tool');
    expect(toolMessages.length).toBe(1);
    expect(toolMessages[0].metadata?.toolName).toBe('read_file');
  });

  it.skipIf(process.platform !== 'win32')('injects Windows platform guidance as a system message (KNOWN_ISSUES 5)', async () => {
    const harness = createTestHarness([{ content: 'done' }], workspaceRoot);
    const session = await harness.run('随便');
    const guidance = session.messages.find(
      (m) => m.role === 'system' && m.content.includes('Git Bash'),
    );
    expect(guidance).toBeDefined();
  });

  it.skipIf(process.platform !== 'win32')('resuming a session does not duplicate the platform guidance (reviewer regression)', async () => {
    const harness = createTestHarness([{ content: 'done' }, { content: 'done' }], workspaceRoot);
    let session = await harness.run('随便');
    const guidanceCount = (): number =>
      session.messages.filter(
        (m) => m.role === 'system' && m.content.includes('Git Bash'),
      ).length;
    expect(guidanceCount()).toBe(1);
    session = await harness.run(session.task, { session });
    expect(guidanceCount()).toBe(1);
  });

  it('Markdown 含链接（方括号在文本中间）不触发 parse_error（KNOWN_ISSUES 9.5）', async () => {
    // Real-test regression: a plain Markdown answer with a link
    // `[文字](URL)` contains `[`, and the old "content includes '{' or '['"
    // heuristic misjudged it as an attempted inline-JSON tool call →
    // parse_error feedback → the LLM had to rewrite the same answer 3 times.
    const markdown =
      '当然可以！这里是一段用 Markdown 格式写的话：\n\n## 关于 Markdown\n\n' +
      '- 强调：**加粗** 和 *斜体*\n' +
      '- [链接](https://www.markdownguide.org)：用 `[文字](URL)` 插入超链接\n' +
      // A code block puts '{' mid-text too — the ORIGINAL 9.5 repro was a
      // markdown summary with a TS snippet; both bracket chars must stay inert.
      '\n```ts\nfunction add(a: number, b: number) { return a + b; }\n```\n\n' +
      '> 小贴士：Markdown 语法简洁、上手快。';
    const harness = createTestHarness([{ content: markdown }], workspaceRoot);
    const session = await harness.run('用md格式写一段话');

    // Plain-text completion: no parse_error feedback, completed on round 1.
    expect(session.status).toBe('completed');
    expect(session.currentRound).toBe(1);
    const feedbackMessages = session.messages.filter((m) => m.role === 'feedback');
    expect(feedbackMessages.length).toBe(0);
    expect(session.messages.some((m) => m.role === 'assistant' && m.content.includes('markdownguide'))).toBe(true);
  });

  it('MaxRounds 升级：3 轮反馈失败后，第 4 轮进入前触发 HITL', async () => {
    const harness = createTestHarness(
      [
        { toolCalls: [{ name: 'write_file', arguments: { path: 'test.ts', content: 'const x: number = "str"' } }] },
        { toolCalls: [{ name: 'write_file', arguments: { path: 'test.ts', content: 'const x: number = "str2"' } }] },
        { toolCalls: [{ name: 'write_file', arguments: { path: 'test.ts', content: 'const x: number = "str3"' } }] },
        { toolCalls: [{ name: 'write_file', arguments: { path: 'test.ts', content: 'const x: number = "str4"' } }] },
      ],
      workspaceRoot,
      { maxRounds: 3 },
    );

    const session = await harness.run('修复 test.ts 的类型错误');

    // Should have reached round 4 (upgrade should trigger at round 4)
    expect(session.currentRound).toBe(4);

    // Should have approvalRequired message for HITL
    expect(session.messages.some((m) => m.metadata?.approvalRequired === true)).toBe(true);

    // Should NOT be completed (needs human intervention)
    expect(session.status).not.toBe('completed');

    // Should have 3 rounds of tool execution before upgrade
    const toolMessages = session.messages.filter((m) => m.role === 'tool');
    expect(toolMessages.length).toBe(3);
  });

  it('run 支持会话级 workspaceRoot：工具在该目录执行，默认回退 config 值（Task 19）', async () => {
    const sessionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-sess-'));
    try {
      fs.writeFileSync(path.join(sessionRoot, 'only-here.txt'), 'session file');
      // The file exists ONLY in sessionRoot — reading it proves the tool ran
      // against the session root, not the config root (where it is absent).
      const harness = createTestHarness(
        [
          { toolCalls: [{ name: 'read_file', arguments: { paths: ['only-here.txt'] } }] },
          { content: 'done' },
        ],
        workspaceRoot,
      );
      const session = await harness.run('读取会话目录文件', { workspaceRoot: sessionRoot });
      expect(session.status).toBe('completed');
      expect(session.workspaceRoot).toBe(sessionRoot);
      const toolMessages = session.messages.filter((m) => m.role === 'tool');
      expect(toolMessages).toHaveLength(1);
      expect(toolMessages[0].metadata?.toolResult?.success).toBe(true);
    } finally {
      fs.rmSync(sessionRoot, { recursive: true, force: true });
    }
  });

  it('run 默认回退 config.agent.workspaceRoot（未传会话根时）', async () => {
    const harness = createTestHarness(
      [
        { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
        { content: 'done' },
      ],
      workspaceRoot,
    );
    const session = await harness.run('默认根');
    expect(session.workspaceRoot).toBe(workspaceRoot);
    const toolMessages = session.messages.filter((m) => m.role === 'tool');
    expect(toolMessages[0].metadata?.toolResult?.success).toBe(true);
  });

  it('run 可附加既有 session（WebUI 创建的）：原地更新状态与消息（Task 19）', async () => {
    const store = new InMemorySessionStore(3, workspaceRoot);
    const stored = store.create('读取 test.ts', undefined, workspaceRoot);
    store.appendMessage(stored.id, { role: 'user', content: '读取 test.ts' });

    const harness = createTestHarness(
      [
        { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
        { content: 'Task complete.' },
      ],
      workspaceRoot,
    );
    const result = await harness.run(stored.task, { session: stored });

    // Same object mutated in place — the SessionStore sees every update.
    expect(result).toBe(stored);
    expect(stored.status).toBe('completed');
    expect(stored.workspaceRoot).toBe(workspaceRoot);
    // Initial user message (store-appended) + assistant + tool + assistant.
    expect(stored.messages.length).toBeGreaterThan(1);
    expect(stored.messages.some((m) => m.role === 'tool' && m.metadata?.toolName === 'read_file')).toBe(true);
  });

  it('scope-fence 越界基准跟随会话 workspaceRoot（Task 19）', async () => {
    const sessionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-sess-'));
    try {
      const sneakPath = path.join(workspaceRoot, 'sneak.txt'); // inside CONFIG root, outside SESSION root
      const harness = createTestHarness(
        [
          { toolCalls: [{ name: 'write_file', arguments: { path: sneakPath, content: 'x' } }] },
          { content: 'done' },
        ],
        workspaceRoot,
      );
      const session = await harness.run('写会话目录外', { workspaceRoot: sessionRoot });
      // Human-in-the-loop supervision: an out-of-workspace write pauses for
      // a decision (it is not silently blocked anymore).
      expect(session.status).toBe('paused');
      expect(session.messages.some((m) => m.metadata?.approvalRequired === true)).toBe(true);
      // Not executed until a human approves.
      expect(fs.existsSync(sneakPath)).toBe(false);
    } finally {
      fs.rmSync(sessionRoot, { recursive: true, force: true });
    }
  });
});
