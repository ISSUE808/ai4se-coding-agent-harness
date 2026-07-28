import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ToolContext } from '../../../src/types.js';

// Mock child_process before importing the tool
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'child_process';
import { runTestTool } from '../../../src/tools/run-test.js';

const mockedExecSync = vi.mocked(execSync);

let workspaceRoot: string;
let context: ToolContext;

beforeAll(() => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-rt-'));
  context = { workspaceRoot };
});

afterAll(() => {
  try {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  } catch {
    // Windows may hold handles
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('run_test tool', () => {
  it('delegates to npx vitest run with the given pattern', async () => {
    mockedExecSync.mockReturnValue('Tests  1 passed (1)');
    const result = await runTestTool.execute({ pattern: 'my-test' }, context);

    expect(result.success).toBe(true);
    expect(result.output).toContain('Tests  1 passed');
    expect(result.exitCode).toBe(0);
    expect(mockedExecSync).toHaveBeenCalledWith(
      'npx vitest run my-test',
      expect.objectContaining({ cwd: context.workspaceRoot, encoding: 'utf-8' }),
    );
  });

  it('delegates to npx vitest run without a pattern when none is given', async () => {
    mockedExecSync.mockReturnValue('Tests  5 passed (5)');
    const result = await runTestTool.execute({}, context);

    expect(result.success).toBe(true);
    expect(result.output).toContain('5 passed');
    expect(mockedExecSync).toHaveBeenCalledWith(
      'npx vitest run',
      expect.objectContaining({ cwd: context.workspaceRoot }),
    );
  });

  it('delegates to npx vitest run with empty string pattern (runs all)', async () => {
    mockedExecSync.mockReturnValue('Tests  3 passed (3)');
    const result = await runTestTool.execute({ pattern: '' }, context);

    expect(result.success).toBe(true);
    expect(mockedExecSync).toHaveBeenCalledWith(
      'npx vitest run',
      expect.objectContaining({ cwd: context.workspaceRoot }),
    );
  });

  it('returns failure when vitest exits with non-zero code', async () => {
    const execError = Object.assign(new Error('Command failed'), {
      stdout: 'Tests  1 failed',
      stderr: '',
      status: 1,
    });
    mockedExecSync.mockImplementation(() => {
      throw execError;
    });
    const result = await runTestTool.execute({ pattern: 'failing-test' }, context);

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Tests  1 failed');
  });

  it('passes the workspaceRoot as cwd to vitest', async () => {
    mockedExecSync.mockReturnValue('ok');
    await runTestTool.execute({ pattern: 'check-cwd' }, context);

    expect(mockedExecSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ cwd: context.workspaceRoot }),
    );
  });

  it('applies the whitelisted environment variables', async () => {
    mockedExecSync.mockReturnValue('ok');
    await runTestTool.execute({ pattern: 'check-env' }, context);

    expect(mockedExecSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ env: expect.any(Object) }),
    );
    const callArgs = mockedExecSync.mock.calls[0];
    const options = callArgs[1] as { env?: Record<string, string> };
    expect(options.env).toBeDefined();
    // Should contain PATH (always present)
    expect(options.env!['PATH']).toBeDefined();
    // Should NOT contain arbitrary env vars
    expect(options.env!['NODE_ENV']).toBeUndefined();
  });

  it('has correct tool metadata', () => {
    expect(runTestTool.name).toBe('run_test');
    expect(runTestTool.description).toBeDefined();
    expect(runTestTool.parameters).toBeDefined();
  });
});
