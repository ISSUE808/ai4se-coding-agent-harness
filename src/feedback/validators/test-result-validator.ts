import type { Validator, Action, ToolResult, ValidatorContext, FeedbackResult } from '../../types.js';
import { execSync as nodeExecSync } from 'child_process';

interface VitestResult {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  success: boolean;
  testResults: Array<{
    name: string;
    status: string;
    assertionResults: Array<{
      ancestorTitles: string[];
      title: string;
      status: string;
      failureMessages: string[];
    }>;
  }>;
}

export class TestResultValidator implements Validator {
  name = 'test-runner';
  private _exec: typeof nodeExecSync;

  constructor(exec?: typeof nodeExecSync) {
    this._exec = exec ?? nodeExecSync;
  }

  async validate(_action: Action, _result: ToolResult, context: ValidatorContext): Promise<FeedbackResult> {
    try {
      const raw = this._exec('npx vitest run --reporter json', {
        cwd: context.workspaceRoot,
        stdio: 'pipe',
      });
      return this.parseOutput(raw.toString(), context.workspaceRoot);
    } catch (err) {
      const error = err as Error & { stdout?: Buffer; stderr?: Buffer; status?: number };

      const stdout = error.stdout?.toString() || '';
      if (stdout) {
        try {
          return this.parseOutput(stdout, context.workspaceRoot);
        } catch {
          // fall through to command failure
        }
      }

      return {
        passed: false,
        validator: 'test-runner',
        failureCategory: 'command',
        evidence: `Test runner error: ${error.message}`,
      };
    }
  }

  private parseOutput(output: string, workspaceRoot: string): FeedbackResult {
    let parsed: VitestResult;
    try {
      parsed = JSON.parse(output.trim()) as VitestResult;
    } catch {
      return {
        passed: false,
        validator: 'test-runner',
        failureCategory: 'command',
        evidence: 'Failed to parse test runner output',
      };
    }

    const { numTotalTests, numPassedTests, numFailedTests, testResults } = parsed;

    if (numFailedTests === 0) {
      return {
        passed: true,
        validator: 'test-runner',
        evidence: `All ${numTotalTests} tests passed`,
      };
    }

    const details: FeedbackResult['details'] = [];
    for (const suite of testResults) {
      for (const assertion of suite.assertionResults) {
        if (assertion.status === 'failed') {
          const normalizedSuite = suite.name.replace(/\\/g, '/');
          const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '');
          const fileName = normalizedSuite.startsWith(normalizedRoot + '/')
            ? normalizedSuite.slice(normalizedRoot.length + 1)
            : normalizedSuite.split('/').pop() || normalizedSuite;
          details.push({
            file: fileName,
            expected: assertion.failureMessages?.[0] || 'Test failed',
          });
        }
      }
    }

    return {
      passed: false,
      validator: 'test-runner',
      failureCategory: 'logic',
      evidence: `${numFailedTests} of ${numTotalTests} tests failed`,
      details,
    };
  }
}
