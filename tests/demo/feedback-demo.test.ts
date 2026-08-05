/**
 * Task 20 演示 2：反馈闭环自我修正（PLAN §A.6）
 *
 * 故事线：agent 连续 3 轮修复代码——MockProvider 注入：
 *   第 1 轮：类型错误代码 → 反馈 failureCategory='type' → 策略 targeted_fix
 *   第 2 轮：语法错误代码 → 反馈 failureCategory='syntax' → 策略 auto_fix
 *   第 3 轮：正确代码 → 反馈通过 → agent 完成
 * RoundManager 逐轮递增；每轮产生正确的 FeedbackResult。
 * 评审用 mock 校验器（替代真实 eslint/tsc 子进程）——零外部依赖、零网络。
 */
import { describe, it, expect } from 'vitest';
import { MockProvider } from '../../src/llm/mock-provider.js';
import { ValidatorChain } from '../../src/feedback/validator-chain.js';
import { FailureClassifier } from '../../src/feedback/failure-classifier.js';
import { StrategyMatcher } from '../../src/feedback/strategy-matcher.js';
import { RoundManager } from '../../src/feedback/round-manager.js';
import type { Action, FeedbackResult, ToolResult, Validator } from '../../src/types.js';

/** 演示用"静态评审器"——按代码内容确定性判定，替代 eslint/tsc 子进程（零外部依赖）。 */
const demoReviewer: Validator = {
  name: 'demoReviewer',
  validate: async (_action: Action, result: ToolResult): Promise<FeedbackResult> => {
    const code = String(result.output ?? '');
    if (code.includes('const n: number = "str"')) {
      return {
        passed: false,
        validator: 'tsc',
        failureCategory: 'type',
        evidence: 'Type mismatch: number vs string',
        details: [{ file: 'src/index.ts', line: 1, expected: 'number', actual: 'string' }],
      };
    }
    if (code.includes('function (')) {
      return {
        passed: false,
        validator: 'eslint',
        failureCategory: 'syntax',
        evidence: 'Unexpected token',
        details: [{ file: 'src/index.ts', line: 1 }],
      };
    }
    return { passed: true, validator: 'eslint', evidence: 'OK' };
  },
};

/**
 * 反馈步骤（demo 驱动器）：
 * 1. 从 MockProvider 取下一轮修复代码
 * 2. 跑 ValidatorChain（mock 评审器）→ FeedbackResult
 */
async function runFeedbackRound(provider: MockProvider): Promise<FeedbackResult> {
  // RED: 反馈闭环尚未接线——消耗一个响应但跳过评审（恒返回通过）
  await provider.complete([], []);
  return { passed: true, validator: 'demo', evidence: 'ok' };
}

interface RoundRecord {
  round: number;
  feedback: FeedbackResult;
  strategy: string | null;
}

/**
 * agent 主循环（demo 驱动器）：逐轮取代码 → 评审 → 失败则 nextRound 再试，
 * 通过则完成。镜像 main-loop.ts 的 round 递增语义。
 */
async function simulateAgentLoop(provider: MockProvider): Promise<{
  history: RoundRecord[];
  completed: boolean;
  finalRound: number;
}> {
  const rm = new RoundManager(10);
  const history: RoundRecord[] = [];
  const classifier = new FailureClassifier();
  const matcher = new StrategyMatcher();
  let completed = false;

  while (provider.remaining > 0) {
    const feedback = await runFeedbackRound(provider);
    const strategy = feedback.passed ? null : matcher.match(classifier.classify(feedback));
    history.push({ round: rm.currentRound, feedback, strategy });
    if (feedback.passed) {
      completed = true;
      break;
    }
    rm.nextRound(); // 失败 → 进入下一轮
  }
  return { history, completed, finalRound: rm.currentRound };
}

describe('演示 2：反馈闭环自我修正（3 轮：类型错误 → 语法错误 → 正确代码）', () => {
  it('agent 在第 3 轮完成：RoundManager 正确递增，每轮 FeedbackResult 正确', async () => {
    // MockProvider 注入 3 个响应——全部确定性，零真实 LLM
    const provider = new MockProvider([
      { content: 'const n: number = "str";' }, // 第 1 轮：类型错误
      { content: 'function (' },               // 第 2 轮：语法错误
      { content: 'export const n = 1;' },      // 第 3 轮：正确代码
    ]);

    const result = await simulateAgentLoop(provider);

    expect(result.history).toHaveLength(3);

    // 第 1 轮：类型错误 → targeted_fix
    expect(result.history[0].round).toBe(1);
    expect(result.history[0].feedback.passed).toBe(false);
    expect(result.history[0].feedback.validator).toBe('tsc');
    expect(result.history[0].feedback.failureCategory).toBe('type');
    expect(result.history[0].strategy).toBe('targeted_fix');

    // 第 2 轮：语法错误 → auto_fix
    expect(result.history[1].round).toBe(2);
    expect(result.history[1].feedback.passed).toBe(false);
    expect(result.history[1].feedback.validator).toBe('eslint');
    expect(result.history[1].feedback.failureCategory).toBe('syntax');
    expect(result.history[1].strategy).toBe('auto_fix');

    // 第 3 轮：正确代码 → 通过 → agent 完成
    expect(result.history[2].round).toBe(3);
    expect(result.history[2].feedback.passed).toBe(true);

    expect(result.completed).toBe(true);
    expect(result.finalRound).toBe(3);
    expect(provider.remaining).toBe(0); // 3 个注入响应全部消费，零外部依赖
  });
});
