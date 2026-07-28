import type { Validator, Action, ToolResult, ValidatorContext, FeedbackResult } from '../../types.js';
import { execSync as nodeExecSync } from 'child_process';

export class EslintValidator implements Validator {
  name = 'eslint';
  private _exec: typeof nodeExecSync;

  constructor(exec?: typeof nodeExecSync) {
    this._exec = exec ?? nodeExecSync;
  }

  async validate(action: Action, result: ToolResult, context: ValidatorContext): Promise<FeedbackResult> {
    const files = result.filesChanged ?? [];

    try {
      const output = this._exec(`npx eslint --format json ${files.join(' ')}`, {
        cwd: context.workspaceRoot,
        stdio: 'pipe',
      });

      const results: Array<{
        filePath: string;
        messages: Array<{ ruleId: string | null; severity: number; message: string; line: number; column: number }>;
      }> = JSON.parse(output.toString());

      const errors = results.flatMap(r =>
        r.messages.filter(m => m.severity >= 2).map(m => ({ ...m, _filePath: r.filePath })),
      );

      if (errors.length === 0) {
        return {
          passed: true,
          validator: 'eslint',
          evidence: 'No lint errors',
        };
      }

      return {
        passed: false,
        validator: 'eslint',
        failureCategory: 'syntax',
        evidence: `ESLint: ${errors.map(e => `${e.ruleId}: ${e.message}`).join('; ')}`,
        details: errors.map(e => ({ file: e._filePath, line: e.line, rule: e.ruleId ?? undefined })),
      };
    } catch (err) {
      const error = err as Error;
      return {
        passed: false,
        validator: 'eslint',
        failureCategory: 'command',
        evidence: `ESLint error: ${error.message}`,
      };
    }
  }
}
