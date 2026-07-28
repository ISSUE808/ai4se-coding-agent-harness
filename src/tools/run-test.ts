import { execSync } from 'child_process';
import type { Tool, ToolContext, ToolResult } from '../types.js';

/** Environment variable whitelist — matches run_shell (SPEC §3.4). */
const ENV_WHITELIST = ['PATH', 'HOME', 'USER', 'TEMP', 'TMP'];

function buildWhitelistedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_WHITELIST) {
    const val = process.env[key];
    if (val !== undefined) {
      env[key] = val;
    }
  }
  return env;
}

interface RunTestParams {
  pattern?: string;
}

export const runTestTool: Tool = {
  name: 'run_test',
  description:
    'Runs vitest tests within the workspace. This is syntax sugar that delegates to "npx vitest run". An optional pattern filters which test files to execute.',
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

      const pattern = typeof p.pattern === 'string' && p.pattern.trim().length > 0
        ? p.pattern.trim()
        : '';

      const cmd = pattern
        ? `npx vitest run ${pattern}`
        : `npx vitest run`;

      const stdout = execSync(cmd, {
        cwd: context.workspaceRoot,
        timeout: 120000, // 2 minutes for test runs
        env: buildWhitelistedEnv(),
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      return {
        success: true,
        output: stdout,
        exitCode: 0,
        duration_ms: Date.now() - start,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const execError = err as { stdout?: string; stderr?: string; status?: number };
      const output = (execError.stdout || '') + (execError.stderr || '');
      return {
        success: false,
        output: output || undefined,
        error: message,
        exitCode: execError.status ?? null,
        duration_ms: Date.now() - start,
      };
    }
  },
};
