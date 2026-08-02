import type { Validator, Action, ToolResult, ValidatorContext, FeedbackResult } from '../../types.js';
import { execSync as nodeExecSync } from 'child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

function defaultHasTsConfig(root: string): boolean {
  return existsSync(path.join(root, 'tsconfig.json'));
}

export class TscValidator implements Validator {
  name = 'tsc';
  private _exec: typeof nodeExecSync;
  private _hasConfig: (root: string) => boolean;

  constructor(exec?: typeof nodeExecSync, hasConfig?: (root: string) => boolean) {
    this._exec = exec ?? nodeExecSync;
    this._hasConfig = hasConfig ?? defaultHasTsConfig;
  }

  async validate(_action: Action, _result: ToolResult, context: ValidatorContext): Promise<FeedbackResult> {
    // Environment prerequisite (SPEC §10 未决问题 2): without a tsconfig.json
    // `npx tsc` installs a bogus npm package named `tsc` — skip instead of
    // feeding that noise back to the LLM as a code error.
    if (!this._hasConfig(context.workspaceRoot)) {
      return {
        passed: true,
        validator: 'tsc',
        evidence: 'tsc skipped: no tsconfig.json in workspace',
      };
    }

    try {
      const raw = this._exec('npx tsc --noEmit', {
        cwd: context.workspaceRoot,
        stdio: 'pipe',
      });
      return this.parseOutput(raw.toString(), true);
    } catch (err) {
      const error = err as Error & { stdout?: Buffer; stderr?: Buffer; status?: number };
      const output = (error.stdout?.toString() || '').trim();

      if (output && output.includes('error TS')) {
        return this.parseOutput(output, false);
      }

      return {
        passed: false,
        validator: 'tsc',
        failureCategory: 'command',
        evidence: `tsc error: ${error.message}`,
      };
    }
  }

  private parseOutput(output: string, defaultPassed: boolean): FeedbackResult {
    const trimmed = output.trim();
    if (trimmed.includes('error TS')) {
      const errorLines = trimmed.split('\n').filter(line => line.includes('error TS'));
      return {
        passed: false,
        validator: 'tsc',
        failureCategory: 'type',
        evidence: `tsc: ${errorLines.join('; ')}`,
        details: errorLines.map(line => {
          const match = line.match(/^(.+)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s*(.+)/);
          return match ? { file: match[1], line: parseInt(match[2], 10) } : {};
        }),
      };
    }
    if (defaultPassed) {
      return {
        passed: true,
        validator: 'tsc',
        evidence: 'No type errors',
      };
    }
    return {
      passed: false,
      validator: 'tsc',
      failureCategory: 'command',
      evidence: 'tsc exited with error but no TS errors found in output',
    };
  }
}
