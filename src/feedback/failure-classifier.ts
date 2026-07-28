import type { FeedbackResult } from '../types.js';

export type FailureClassification = 'syntax' | 'type' | 'logic' | 'command' | 'timeout' | 'parse_error';

export class FailureClassifier {
  classify(feedback: FeedbackResult): FailureClassification {
    return feedback.failureCategory!;
  }
}
