import type { Validator, Action, ToolResult, ValidatorContext, FeedbackResult } from '../../types.js';

export class FormatValidator implements Validator {
  name = 'formatChecker';

  async validate(action: Action, _result: ToolResult, _context: ValidatorContext): Promise<FeedbackResult> {
    if (action == null) {
      return {
        passed: false,
        validator: 'formatChecker',
        failureCategory: 'parse_error',
        evidence: 'Action is null or undefined',
      };
    }

    const missing: string[] = [];

    if (typeof action.tool !== 'string' || action.tool.length === 0) {
      missing.push('tool');
    }

    if (action.params == null || typeof action.params !== 'object' || Array.isArray(action.params)) {
      missing.push('params');
    }

    if (missing.length > 0) {
      return {
        passed: false,
        validator: 'formatChecker',
        failureCategory: 'parse_error',
        evidence: `Action format invalid: missing required field: ${missing.join(', ')}`,
      };
    }

    return {
      passed: true,
      validator: 'formatChecker',
      evidence: 'Action format is valid',
    };
  }
}
