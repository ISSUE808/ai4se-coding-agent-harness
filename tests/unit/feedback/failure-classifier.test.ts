import { describe, it, expect } from 'vitest';
import { FailureClassifier } from '../../../src/feedback/failure-classifier.js';
import type { FeedbackResult } from '../../../src/types.js';

function makeFeedback(overrides: Partial<FeedbackResult> = {}): FeedbackResult {
  return {
    passed: false,
    validator: 'test',
    evidence: '',
    ...overrides,
  };
}

describe('FailureClassifier', () => {
  const classifier = new FailureClassifier();

  it('classifies syntax failureCategory as "syntax"', () => {
    const fb = makeFeedback({ failureCategory: 'syntax' });
    expect(classifier.classify(fb)).toBe('syntax');
  });

  it('classifies type failureCategory as "type"', () => {
    const fb = makeFeedback({ failureCategory: 'type' });
    expect(classifier.classify(fb)).toBe('type');
  });

  it('classifies logic failureCategory as "logic"', () => {
    const fb = makeFeedback({ failureCategory: 'logic' });
    expect(classifier.classify(fb)).toBe('logic');
  });

  it('classifies command failureCategory as "command"', () => {
    const fb = makeFeedback({ failureCategory: 'command' });
    expect(classifier.classify(fb)).toBe('command');
  });

  it('classifies timeout failureCategory as "timeout"', () => {
    const fb = makeFeedback({ failureCategory: 'timeout' });
    expect(classifier.classify(fb)).toBe('timeout');
  });

  it('classifies parse_error failureCategory as "parse_error"', () => {
    const fb = makeFeedback({ failureCategory: 'parse_error' });
    expect(classifier.classify(fb)).toBe('parse_error');
  });
});
