import type { Validator, Action, ToolResult, ValidatorContext, FeedbackResult } from '../../types.js';

export class ShellCheckValidator implements Validator {
  name = 'shell-check';

  async validate(_action: Action, result: ToolResult, _context: ValidatorContext): Promise<FeedbackResult> {
    const hasBadExitCode = result.exitCode != null && result.exitCode !== 0;
    const hasStderr = typeof result.error === 'string' && result.error.length > 0;

    if (hasBadExitCode || hasStderr) {
      const parts: string[] = [];
      if (hasBadExitCode) {
        parts.push(`exit code ${result.exitCode}`);
      }
      if (hasStderr) {
        parts.push(result.error!);
      }
      return {
        passed: false,
        validator: 'shell-check',
        failureCategory: 'command',
        evidence: `Shell command failed: ${parts.join('; ')}`,
      };
    }

    return {
      passed: true,
      validator: 'shell-check',
      evidence: 'Shell command completed successfully',
    };
  }
}
