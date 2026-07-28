import type { FailureClassification, Strategy } from '../types.js';

const STRATEGY_MAP: Record<FailureClassification, Strategy> = {
  syntax: 'auto_fix',
  type: 'targeted_fix',
  logic: 'logic_fix',
  command: 'command_fix',
  timeout: 'split_task',
  parse_error: 'format_retry',
};

export class StrategyMatcher {
  match(classification: FailureClassification): Strategy {
    return STRATEGY_MAP[classification];
  }
}
