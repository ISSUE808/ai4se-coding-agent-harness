import { describe, it, expect } from 'vitest';
import { StrategyMatcher } from '../../../src/feedback/strategy-matcher.js';

describe('StrategyMatcher', () => {
  const matcher = new StrategyMatcher();

  it('matches "syntax" classification to "auto_fix" strategy', () => {
    expect(matcher.match('syntax')).toBe('auto_fix');
  });

  it('matches "type" classification to "targeted_fix" strategy', () => {
    expect(matcher.match('type')).toBe('targeted_fix');
  });

  it('matches "logic" classification to "logic_fix" strategy', () => {
    expect(matcher.match('logic')).toBe('logic_fix');
  });

  it('matches "command" classification to "command_fix" strategy', () => {
    expect(matcher.match('command')).toBe('command_fix');
  });

  it('matches "timeout" classification to "split_task" strategy', () => {
    expect(matcher.match('timeout')).toBe('split_task');
  });

  it('matches "parse_error" classification to "format_retry" strategy', () => {
    expect(matcher.match('parse_error')).toBe('format_retry');
  });
});
