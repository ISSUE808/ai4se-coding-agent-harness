/**
 * Task 20 演示 1：护栏拦截（PLAN §A.6）
 *
 * 故事线：MockProvider 提议执行危险命令 `rm -rf /`（run_shell 工具调用）→
 * 护栏层必须拦截 → 命令绝不到达执行器 → agent 收到拦截通知。
 * 零网络调用：全程只使用 MockProvider + PatternGuard，无任何真实 shell/HTTP。
 */
import { describe, it, expect } from 'vitest';
import { MockProvider } from '../../src/llm/mock-provider.js';
import { PatternGuard } from '../../src/guardrail/pattern-guard.js';
import type { Action, Message, ToolResult } from '../../src/types.js';

/** 护栏判定结果——镜像 main-loop.ts Step 4（runGuardrails → guardMsg）。 */
interface GuardrailDecision {
  blocked: boolean;
  level: 'block' | 'warn' | 'allow';
  rule?: string;
  /** 拦截时投递给 agent 的 system 通知消息（与 main-loop 的 guardMsg 同构）。 */
  noticeMessage?: Message;
  /** 放行时执行器的真实结果。 */
  result?: ToolResult;
}

/**
 * 护栏步骤（demo 驱动器）：
 * 1. 从 action 提取 shell 命令
 * 2. PatternGuard.check() 判定
 * 3. blocked → 绝不执行，构造拦截通知；allow → 交给执行器
 */
async function runGuardrailStep(
  action: Action,
  executor: (a: Action) => Promise<ToolResult>,
): Promise<GuardrailDecision> {
  const command = String(action.params.command ?? '');
  const guard = new PatternGuard().check(command);
  if (guard.blocked) {
    // 绝不执行——直接构造拦截通知（与 main-loop 的 guardMsg 同构）
    return {
      blocked: true,
      level: guard.level,
      rule: guard.rule,
      noticeMessage: {
        id: 'guard-msg',
        role: 'system',
        content: `Operation paused for human approval: ${guard.rule}`,
        metadata: {
          guardrailRule: guard.rule,
          guardrailCommand: command,
        },
        approvalRequired: false, // 与 main-loop guardMsg 同构：block 时 needsApproval=false
        timestamp: '2026-08-05T00:00:00.000Z',
      },
    };
  }
  // 放行 → 交给执行器
  return { blocked: false, level: 'allow', result: await executor(action) };
}

describe('演示 1：护栏拦截（MockProvider → PatternGuard → 拦截通知）', () => {
  it('MockProvider 提议 rm -rf / → PatternGuard 判定 block，命令绝不执行，agent 收到拦截通知', async () => {
    // 1. MockProvider 注入危险命令工具调用（零真实 LLM）
    const provider = new MockProvider([
      {
        content: null,
        toolCalls: [{ id: 'call_danger', name: 'run_shell', arguments: { command: 'rm -rf /' } }],
      },
    ]);
    const response = await provider.complete([], []);
    const action: Action = {
      tool: response.toolCalls![0].name,
      params: response.toolCalls![0].arguments,
      id: response.toolCalls![0].id,
    };

    // 2. 执行器 spy——真实 harness 在这里会 spawn shell；demo 只记录调用
    const executed: Action[] = [];
    const executor = async (a: Action): Promise<ToolResult> => {
      executed.push(a);
      return { success: true, output: 'ok', duration_ms: 1 };
    };

    // 3. 护栏步骤
    const decision = await runGuardrailStep(action, executor);

    // 4. 断言：拦截、命令绝不执行、通知送达
    expect(decision.blocked).toBe(true);
    expect(decision.level).toBe('block');
    expect(decision.rule).toBe('recursive_delete_root');
    expect(executed).toHaveLength(0);
    expect(provider.remaining).toBe(0);
    expect(decision.noticeMessage).toBeDefined();
    expect(decision.noticeMessage!.role).toBe('system');
    expect(decision.noticeMessage!.content).toContain('Operation paused for human approval');
    expect(decision.noticeMessage!.metadata?.guardrailRule).toBe('recursive_delete_root');
    expect(decision.noticeMessage!.metadata?.guardrailCommand).toBe('rm -rf /');
  });

  it('良性命令放行并执行——证明护栏只拦危险命令', async () => {
    const provider = new MockProvider([
      { content: null, toolCalls: [{ name: 'run_shell', arguments: { command: 'ls -la' } }] },
    ]);
    const response = await provider.complete([], []);
    const action: Action = {
      tool: response.toolCalls![0].name,
      params: response.toolCalls![0].arguments,
    };

    const executed: Action[] = [];
    const executor = async (a: Action): Promise<ToolResult> => {
      executed.push(a);
      return { success: true, output: 'ok', duration_ms: 1 };
    };

    const decision = await runGuardrailStep(action, executor);

    expect(decision.blocked).toBe(false);
    expect(decision.level).toBe('allow');
    expect(executed).toHaveLength(1);
    expect(executed[0].params.command).toBe('ls -la');
  });
});
