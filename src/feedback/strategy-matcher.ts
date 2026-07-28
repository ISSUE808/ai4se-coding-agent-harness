export type FailureClassification = 'syntax' | 'type' | 'logic' | 'command' | 'timeout' | 'parse_error';
export type Strategy = 'auto_fix' | 'targeted_fix' | 'logic_fix' | 'command_fix' | 'split_task' | 'format_retry';

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
