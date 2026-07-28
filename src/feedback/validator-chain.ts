import type { Action, ToolResult, ValidatorContext, FeedbackResult, Validator } from '../types.js';

export class ValidatorChain {
  private validators: Validator[];
  private mode: 'fail_fast' | 'collect_all';

  constructor(validators: Validator[], mode: 'fail_fast' | 'collect_all') {
    this.validators = validators;
    this.mode = mode;
  }

  async run(action: Action, result: ToolResult, context: ValidatorContext): Promise<FeedbackResult[]> {
    const results: FeedbackResult[] = [];
    for (const validator of this.validators) {
      const feedback = await validator.validate(action, result, context);
      results.push(feedback);
      if (this.mode === 'fail_fast' && !feedback.passed) {
        break;
      }
    }
    return results;
  }
}
