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

// Real vitest output (even piped, on Windows and CI alike) is interleaved with
// ANSI SGR color codes: `\x1b[32m✓\x1b[39m path` and `\x1b[1m\x1b[32m48 passed\x1b[39m`.
// Match on the stripped text — the codes are display noise, not data, and
// matching against them made every real invocation resolve to
// `{passed:false, results:[]}` (KNOWN_ISSUES 9.6).
function stripAnsi(input: string): string {
  return input.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

function parseVitestOutput(
  output: string,
): { passed: boolean; results: TestResult[]; rawOutput?: string } {
  const clean = stripAnsi(output);
  const results: TestResult[] = [];
  // Parse vitest per-file lines: "✓ file.test.ts (N tests) Xms" or "❯ file.test.ts (N tests | M failed) Xms"
  const summaryRe = /([✓❯])\s+(.+?\.test\.\w+)\s+\((\d+)\s+tests?(?:\s*\|\s*(\d+)\s+failed)?\)\s+(\d+)ms/g;
  let match;
  while ((match = summaryRe.exec(clean)) !== null) {
    const [, _icon, name, _total, failed, duration] = match;
    results.push({
      name,
      status: failed && parseInt(failed) > 0 ? 'failed' : 'passed',
      duration: parseInt(duration),
    });
  }

  if (results.length > 0) {
    return { passed: results.every(r => r.status === 'passed'), results };
  }

  // No per-file lines — fall back to the "Test Files" summary line. Vitest
  // prints failures as `2 failed | 46 passed (48)` and a green run as
  // `48 passed (48)`; treat it as passed only when something passed and
  // nothing failed.
  const testFilesLine = clean.split('\n').find(l => l.includes('Test Files'));
  if (testFilesLine) {
    const passedMatch = /(\d+)\s+passed/.exec(testFilesLine);
    const failedMatch = /(\d+)\s+failed/.exec(testFilesLine);
    const passed =
      passedMatch !== null && parseInt(passedMatch[1]) > 0 && failedMatch === null;
    return { passed, results: [] };
  }

  // Nothing recognizable (new vitest version, locale, or a wrapper around
  // vitest) — do not silently report a bare `{passed:false}`. Hand the raw
  // stdout to the agent so it can interpret the run itself.
  const truncated =
    output.length > 4000
      ? output.slice(0, 4000) + '\n…(output truncated at 4000 chars)'
      : output;
  return { passed: false, results: [], rawOutput: truncated };
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
    let cmd = '';
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

      cmd = pattern
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
        // Include the executed command so the agent knows what actually ran
        // (KNOW_ISSUES 9.6: a bare `run_test` runs ALL tests).
        output: JSON.stringify({ command: cmd, ...parsed }),
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
        output: JSON.stringify({ command: cmd, ...parsed }),
        error: message,
        exitCode: execError.status ?? null,
        duration_ms: Date.now() - start,
      };
    }
  },
};
