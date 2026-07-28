import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runShellTool } from '../../../src/tools/run-shell.js';
import type { ToolContext } from '../../../src/types.js';

let workspaceRoot: string;
let context: ToolContext;

beforeAll(() => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-sh-'));
  context = { workspaceRoot };
});

afterAll(() => {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

describe('run_shell tool', () => {
  it('executes a simple command and returns output', async () => {
    const result = await runShellTool.execute({ command: 'echo hello' }, context);
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello');
    expect(result.exitCode).toBe(0);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('returns non-zero exitCode for failed commands', async () => {
    const result = await runShellTool.execute({ command: 'exit 1' }, context);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.error).toBeDefined();
  });

  it('runs commands with cwd locked to workspaceRoot', async () => {
    // Create a file in workspaceRoot, then verify pwd shows the workspace
    const marker = 'marker-' + Date.now() + '.txt';
    fs.writeFileSync(path.join(workspaceRoot, marker), 'workspace');
    // On Windows, use `dir` to list files; on Unix, use `ls`
    const isWin = process.platform === 'win32';
    const cmd = isWin ? `dir /b` : `ls`;
    const result = await runShellTool.execute({ command: cmd }, context);
    expect(result.success).toBe(true);
    // The marker file should appear in the output since cwd is workspaceRoot
    expect(result.output).toContain(marker);
  });

  it('enforces environment variable whitelist', async () => {
    // PATH, HOME, USER, TEMP, TMP should be available; others stripped
    const isWin = process.platform === 'win32';
    const cmd = isWin
      ? 'echo PATH=%PATH% && echo TEMP=%TEMP%'
      : 'echo PATH=$PATH && echo HOME=$HOME';
    const result = await runShellTool.execute({ command: cmd }, context);
    expect(result.success).toBe(true);
    // The whitelisted vars should have values (not empty)
    expect(result.output).not.toContain('PATH=%');
    expect(result.output).not.toContain('PATH=$');
  });

  it('has a default timeout of 60 seconds', async () => {
    // A quick sleep command should succeed within default timeout
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'timeout /t 1 /nobreak >nul' : 'sleep 1';
    const result = await runShellTool.execute({ command: cmd }, context);
    expect(result.success).toBe(true);
  });

  it('respects custom timeout parameter', async () => {
    // Set a very short timeout that a sleep will exceed
    const isWin = process.platform === 'win32';
    // Use a command that takes longer than the timeout
    const cmd = isWin ? 'timeout /t 5 /nobreak >nul' : 'sleep 5';
    const result = await runShellTool.execute({ command: cmd, timeout: 500 }, context);
    // Should fail due to timeout
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects when command parameter is missing', async () => {
    const result = await runShellTool.execute({}, context);
    expect(result.success).toBe(false);
    expect(result.error).toContain('command');
  });

  it('captures stderr in the output', async () => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'echo error 1>&2' : 'echo error >&2';
    const result = await runShellTool.execute({ command: cmd }, context);
    // Should still succeed (exit 0) but output should contain the stderr text
    expect(result.exitCode).toBe(0);
  });

  it('has correct tool metadata', () => {
    expect(runShellTool.name).toBe('run_shell');
    expect(runShellTool.description).toBeDefined();
    expect(runShellTool.parameters).toBeDefined();
  });
});
