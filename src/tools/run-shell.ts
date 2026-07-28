import { execSync } from 'child_process';
import type { Tool, ToolContext, ToolResult } from '../types.js';

/** Environment variable whitelist (SPEC §3.4). Applies cross-platform. */
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

interface RunShellParams {
  command: string;
  timeout?: number;
}

export const runShellTool: Tool = {
  name: 'run_shell',
  description:
    'Executes a bash / shell command. The working directory is locked to the workspace root. Only a whitelist of environment variables (PATH, HOME, USER, TEMP, TMP) is forwarded. Default timeout is 60 seconds.',
  parameters: {
    command: {
      type: 'string',
      description: 'The shell command to execute.',
    },
    timeout: {
      type: 'number',
      description: 'Timeout in milliseconds (default: 60000).',
    },
  },
  async execute(
    params: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const start = Date.now();
    try {
      const p = params as unknown as RunShellParams;

      if (typeof p.command !== 'string' || p.command.trim().length === 0) {
        return {
          success: false,
          error: 'command is required and must be a non-empty string',
          duration_ms: Date.now() - start,
        };
      }

      const timeout = typeof p.timeout === 'number' && p.timeout > 0 ? p.timeout : 60000;

      const stdout = execSync(p.command, {
        cwd: context.workspaceRoot,
        timeout,
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
      // execSync throws on non-zero exit or timeout; extract stderr/stdout from the error
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
