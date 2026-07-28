import type { FeedbackResult, FailureClassification } from '../types.js';

export class FailureClassifier {
  classify(feedback: FeedbackResult): FailureClassification {
    if (!feedback.failureCategory) {
      throw new Error('Cannot classify feedback without a failureCategory — only failed feedback should reach the classifier');
    }
    return feedback.failureCategory;
  }
}
