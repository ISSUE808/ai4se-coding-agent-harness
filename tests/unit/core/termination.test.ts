import { describe, it, expect } from 'vitest';
import { shouldTerminate } from '../../../src/core/termination.js';
import type { LLMResponse } from '../../../src/types.js';

describe('shouldTerminate', () => {
  it('LLM 输出无 tool call → 完成', () => {
    const resp: LLMResponse = { content: '任务已完成。' };
    expect(shouldTerminate(resp, 1, 3)).toBe(true);
  });

  it('有 tool call → 未完成', () => {
    const resp: LLMResponse = { content: null, toolCalls: [{ name: 'read_file', arguments: { path: 'test.ts' } }] };
    expect(shouldTerminate(resp, 1, 3)).toBe(false);
  });

  it('FINISHED 工具调用 → 完成', () => {
    const resp: LLMResponse = { content: null, toolCalls: [{ name: 'FINISHED', arguments: {} }] };
    expect(shouldTerminate(resp, 1, 3)).toBe(true);
  });

  it('超过 maxRounds → 完成（升级触发）', () => {
    const resp: LLMResponse = { content: null, toolCalls: [{ name: 'write_file', arguments: { path: 'a.ts', content: 'x' } }] };
    expect(shouldTerminate(resp, 4, 3)).toBe(true);
  });

  it('第 maxRounds 轮仍在执行', () => {
    const resp: LLMResponse = { content: null, toolCalls: [{ name: 'write_file', arguments: { path: 'a.ts', content: 'x' } }] };
    expect(shouldTerminate(resp, 3, 3)).toBe(false);
  });

  it('maxRounds = 0（无上限）→ 轮数不触发终止', () => {
    const resp: LLMResponse = { content: null, toolCalls: [{ name: 'write_file', arguments: { path: 'a.ts', content: 'x' } }] };
    expect(shouldTerminate(resp, 999, 0)).toBe(false);
  });
});
