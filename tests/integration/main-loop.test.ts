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

  it('解析错误恢复：收到垃圾 JSON 后正确重试', async () => {
    const harness = createTestHarness(
      [
        { content: 'not valid json {{{}' },
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
});
