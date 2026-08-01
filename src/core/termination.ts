import type { LLMResponse } from '../types.js';

/**
 * 停机判断器 — SPEC §3.1 主循环第8步
 *
 * 规则（优先级从高到低）：
 * 1. currentRound > maxRounds → true（升级触发 / 强制终止）
 * 2. 无 toolCall（仅有 content）→ true（LLM 完成输出）
 * 3. 任一 toolCall 名为 FINISHED → true（显式完成信号）
 * 4. 其他情况 → false（待继续执行）
 *
 * 纯确定性函数 — 不依赖 LLM。
 */
export function shouldTerminate(
  response: LLMResponse,
  currentRound: number,
  maxRounds: number,
): boolean {
  // 超过最大轮数 → 强制终止 / 升级触发
  if (currentRound > maxRounds) {
    return true;
  }

  const hasToolCalls = response.toolCalls && response.toolCalls.length > 0;

  // 无 tool call → LLM 文本完成
  if (!hasToolCalls) {
    return true;
  }

  // FINISHED 工具调用 → 显式完成
  if (response.toolCalls!.some((tc) => tc.name === 'FINISHED')) {
    return true;
  }

  // 仍有待执行工具
  return false;
}
