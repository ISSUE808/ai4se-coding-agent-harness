import { execSync } from 'child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { Tool, ToolContext, ToolResult } from '../types.js';
import { buildWhitelistedEnv } from './env-utils.js';

/**
 * On Windows, run shell commands through Git Bash when available — LLMs emit
 * POSIX/bash syntax (`/c/Users/...`, `ls`, `cat`) which cmd.exe cannot run
 * (`'cat' is not recognized`, `/c/...` paths are invalid). Falls back to the
 * default shell (cmd) when Git Bash is not installed.
 */
function resolveShell(): string | undefined {
  if (process.platform !== 'win32') {
    return undefined;
  }
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
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
        shell: resolveShell(),
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
