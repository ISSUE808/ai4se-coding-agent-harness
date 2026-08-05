/**
 * Task 20 演示 3：主力维度确定性行为（PLAN §A.6）
 *
 * 完整链路（全部真实模块、mock 校验器、零 LLM/HTTP/I/O）：
 * ActionClassifier（write_file 代码文件 → file_write）
 * → ValidatorSelector（file_write → [eslint, tsc]）
 * → ValidatorChain fail_fast（eslint 失败 → tsc 跳过）vs collect_all（eslint 失败 → tsc 仍调用）
 * → FailureClassifier（eslint → syntax, tsc → type）
 * → StrategyMatcher（syntax → auto_fix）
 * → RoundManager（3 次失败 → shouldUpgrade）
 */
import { describe, it, expect } from 'vitest';
import { ActionClassifier } from '../../src/feedback/action-classifier.js';
import { ValidatorSelector } from '../../src/feedback/validator-selector.js';
import { ValidatorChain } from '../../src/feedback/validator-chain.js';
import { FailureClassifier } from '../../src/feedback/failure-classifier.js';
import { StrategyMatcher } from '../../src/feedback/strategy-matcher.js';
import { RoundManager } from '../../src/feedback/round-manager.js';
import { DEFAULT_CONFIG } from '../../src/config/schema.js';
import type {
  Action,
  ActionType,
  FailureClassification,
  FeedbackResult,
  Strategy,
  Validator,
} from '../../src/types.js';

const config = DEFAULT_CONFIG;

/** 演示用校验器桩——语义与真实 eslint/tsc 一致（eslint → syntax / tsc → type），但不 spawn 子进程。 */
const callLog: string[] = [];
function validatorByName(name: string): Validator {
  return {
    name,
    validate: async (): Promise<FeedbackResult> => {
      callLog.push(name);
      return name === 'eslint'
        ? { passed: false, validator: 'eslint', failureCategory: 'syntax', evidence: 'eslint error' }
        : { passed: false, validator: 'tsc', failureCategory: 'type', evidence: 'tsc error' };
    },
  };
}

interface DeepChainResult {
  actionType: ActionType;
  names: string[];
  results: FeedbackResult[];
  classification: FailureClassification | null;
  strategy: Strategy | null;
}

/** 深链路驱动器——镜像 main-loop runFeedback 的 分类→选器→链→失败分类→策略 全过程。 */
async function deepChain(action: Action, mode: 'fail_fast' | 'collect_all'): Promise<DeepChainResult> {
  // RED: 链路尚未接线——返回占位结果
  return {
    actionType: 'shell_command',
    names: [],
    results: [{ passed: false, validator: 'demo', failureCategory: 'logic', evidence: 'placeholder' }],
    classification: 'logic',
    strategy: 'logic_fix',
  };
}

const action: Action = { tool: 'write_file', params: { path: 'src/index.ts', content: 'const n = 1;' } };

describe('演示 3：主力维度确定性行为（深链路）', () => {
  it('ActionClassifier：write_file 代码文件 → file_write', () => {
    const actionType = new ActionClassifier().classify(action);
    expect(actionType).toBe('file_write');
  });

  it('ValidatorSelector：file_write → [eslint, tsc]', () => {
    const names = new ValidatorSelector().select('file_write', config);
    expect(names).toEqual(['eslint', 'tsc']);
  });

  it('ValidatorChain fail_fast：eslint 失败 → tsc 跳过（只调用 1 个校验器）', async () => {
    callLog.length = 0;
    const result = await deepChain(action, 'fail_fast');
    expect(result.names).toEqual(['eslint', 'tsc']);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].validator).toBe('eslint');
    expect(callLog).toEqual(['eslint']); // tsc 未被调用
  });

  it('ValidatorChain collect_all：eslint 失败 → tsc 仍调用（2 个校验器全部执行）', async () => {
    callLog.length = 0;
    const result = await deepChain(action, 'collect_all');
    expect(result.results).toHaveLength(2);
    expect(result.results[1].validator).toBe('tsc');
    expect(callLog).toEqual(['eslint', 'tsc']);
  });

  it('FailureClassifier：eslint 失败 → syntax，tsc 失败 → type', () => {
    const classifier = new FailureClassifier();
    const eslintFailure: FeedbackResult = {
      passed: false,
      validator: 'eslint',
      failureCategory: 'syntax',
      evidence: 'e',
    };
    const tscFailure: FeedbackResult = {
      passed: false,
      validator: 'tsc',
      failureCategory: 'type',
      evidence: 't',
    };
    expect(classifier.classify(eslintFailure)).toBe('syntax');
    expect(classifier.classify(tscFailure)).toBe('type');
  });

  it('StrategyMatcher：syntax → auto_fix（type → targeted_fix 对照）', () => {
    const matcher = new StrategyMatcher();
    expect(matcher.match('syntax')).toBe('auto_fix');
    expect(matcher.match('type')).toBe('targeted_fix');
  });

  it('端到端：深链路 fail_fast 下 返回 file_write + [eslint, tsc] + syntax + auto_fix', async () => {
    const result = await deepChain(action, 'fail_fast');
    expect(result.actionType).toBe('file_write');
    expect(result.names).toEqual(['eslint', 'tsc']);
    expect(result.classification).toBe('syntax');
    expect(result.strategy).toBe('auto_fix');
  });

  it('RoundManager：3 次失败 → shouldUpgrade（超过 maxRounds 触发升级）', () => {
    const rm = new RoundManager(3);
    expect(rm.currentRound).toBe(1);

    // 3 个失败轮次：每轮结束后 nextRound()
    rm.nextRound();
    expect(rm.shouldUpgrade()).toBe(false);
    rm.nextRound();
    expect(rm.shouldUpgrade()).toBe(false);
    rm.nextRound();

    expect(rm.currentRound).toBe(4);
    expect(rm.shouldUpgrade()).toBe(true); // 超过 maxRounds → harness 升级暂停（main-loop: triggerHITL）
  });
});
