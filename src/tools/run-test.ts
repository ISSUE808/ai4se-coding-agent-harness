import { execSync } from 'child_process';
import type { Tool, ToolContext, ToolResult } from '../types.js';
import { hasLocalBin } from '../utils/env-prereq.js';
import { buildWhitelistedEnv } from './env-utils.js';

interface RunTestParams {
  pattern?: string;
}

interface TestResult {
  name: string;
  status: 'passed' | 'failed';
  duration: number;
}

function parseVitestOutput(output: string): { passed: boolean; results: TestResult[] } {
  const results: TestResult[] = [];
  // Parse vitest summary lines: "✓ file.test.ts (N tests) Xms" or "❯ file.test.ts (N tests | M failed) Xms"
  const summaryRe = /([✓❯])\s+(.+?\.test\.\w+)\s+\((\d+)\s+tests?(?:\s*\|\s*(\d+)\s+failed)?\)\s+(\d+)ms/g;
  let match;
  while ((match = summaryRe.exec(output)) !== null) {
    const [, _icon, name, _total, failed, duration] = match;
    results.push({
      name,
      status: failed && parseInt(failed) > 0 ? 'failed' : 'passed',
      duration: parseInt(duration),
    });
  }

  // If no structured matches found, fallback: check for overall pass/fail lines
  if (results.length === 0) {
    const allPassed = /Test Files\s+\d+ passed/.test(output);
    const anyFailed = /Test Files\s+.*\d+ failed/.test(output);
    return { passed: allPassed && !anyFailed, results: [] };
  }

  const passed = results.every(r => r.status === 'passed');
  return { passed, results };
}

export const runTestTool: Tool = {
  name: 'run_test',
  description:
    'Runs vitest tests within the workspace. Returns structured test results with per-file pass/fail status and duration. Delegates to "npx vitest run".',
  parameters: {
    pattern: {
      type: 'string',
      description: 'Optional test file pattern to pass to vitest (e.g. "write-file"). When omitted, all tests are run.',
    },
  },
  async execute(
    params: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const start = Date.now();
    try {
      const p = params as unknown as RunTestParams;

      // Env prerequisite (KNOWN_ISSUES 3): without a LOCAL vitest, `npx vitest`
      // would download it — fail with an actionable message instead of
      // triggering a network install mid-task.
      if (!hasLocalBin(context.workspaceRoot, 'vitest')) {
        return {
          success: false,
          error:
            'vitest is not installed in the workspace (node_modules/.bin/vitest missing). ' +
            'Install it with `npm i -D vitest` (run_shell), or run tests via run_shell directly.',
          duration_ms: Date.now() - start,
        };
      }

      const pattern = typeof p.pattern === 'string' && p.pattern.trim().length > 0
        ? p.pattern.trim()
        : '';

      const cmd = pattern
        ? `npx vitest run ${pattern}`
        : `npx vitest run`;

      const stdout = execSync(cmd, {
        cwd: context.workspaceRoot,
        timeout: 120000,
        env: buildWhitelistedEnv(),
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const parsed = parseVitestOutput(stdout);

      return {
        success: true,
        output: JSON.stringify(parsed),
        exitCode: 0,
        duration_ms: Date.now() - start,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const execError = err as { stdout?: string; stderr?: string; status?: number };
      const rawOutput = (execError.stdout || '') + (execError.stderr || '');
      const parsed = parseVitestOutput(rawOutput);

      return {
        success: false,
        output: JSON.stringify(parsed),
        error: message,
        exitCode: execError.status ?? null,
        duration_ms: Date.now() - start,
      };
    }
  },
};
