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
  // Real env prerequisite (KNOWN_ISSUES 3): run_test skips when vitest is not
  // installed. Give the shared workspace a fake local vitest binary so the
  // execSync paths below are exercised; the skip path gets its own workspace.
  fs.mkdirSync(path.join(workspaceRoot, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, 'node_modules', '.bin', 'vitest'), '#!/bin/sh\n');
  fs.writeFileSync(path.join(workspaceRoot, 'node_modules', '.bin', 'vitest.cmd'), '@echo off\n');
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
    mockedExecSync.mockReturnValue('✓ tests/unit/tools/sample.test.ts (1 test) 5ms\n\n Test Files  1 passed\n      Tests  1 passed');
    const result = await runTestTool.execute({ pattern: 'my-test' }, context);

    expect(result.success).toBe(true);
    const p1 = JSON.parse(result.output!);
    expect(p1.passed).toBe(true);
    expect(p1.results).toHaveLength(1);
    expect(p1.results[0].name).toContain('sample.test.ts');
    expect(result.exitCode).toBe(0);
    expect(mockedExecSync).toHaveBeenCalledWith(
      'npx vitest run my-test',
      expect.objectContaining({ cwd: context.workspaceRoot, encoding: 'utf-8' }),
    );
  });

  it('delegates to npx vitest run without a pattern when none is given', async () => {
    mockedExecSync.mockReturnValue('✓ tests/unit/a.test.ts (2 tests) 10ms\n✓ tests/unit/b.test.ts (3 tests) 8ms\n\n Test Files  2 passed\n      Tests  5 passed');
    const result = await runTestTool.execute({}, context);

    expect(result.success).toBe(true);
    const p2 = JSON.parse(result.output!);
    expect(p2.passed).toBe(true);
    expect(p2.results).toHaveLength(2);
    expect(mockedExecSync).toHaveBeenCalledWith(
      'npx vitest run',
      expect.objectContaining({ cwd: context.workspaceRoot }),
    );
  });

  it('delegates to npx vitest run with empty string pattern (runs all)', async () => {
    mockedExecSync.mockReturnValue('✓ tests/unit/x.test.ts (3 tests) 6ms');
    const result = await runTestTool.execute({ pattern: '' }, context);

    expect(result.success).toBe(true);
    expect(mockedExecSync).toHaveBeenCalledWith(
      'npx vitest run',
      expect.objectContaining({ cwd: context.workspaceRoot }),
    );
  });

  it('returns failure when vitest exits with non-zero code', async () => {
    const execError = Object.assign(new Error('Command failed'), {
      stdout: '❯ tests/unit/failing.test.ts (1 test | 1 failed) 12ms',
      stderr: '',
      status: 1,
    });
    mockedExecSync.mockImplementation(() => {
      throw execError;
    });
    const result = await runTestTool.execute({ pattern: 'failing-test' }, context);

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    const pf = JSON.parse(result.output!);
    expect(pf.passed).toBe(false);
    expect(pf.results[0].status).toBe('failed');
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

  it('fails clearly without triggering an npx download when vitest is not installed (KNOWN_ISSUES 3)', async () => {
    const bareRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-rt-bare-'));
    const bareContext: ToolContext = { workspaceRoot: bareRoot };

    try {
      const result = await runTestTool.execute({}, bareContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('vitest');
      expect(mockedExecSync).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(bareRoot, { recursive: true, force: true });
    }
  });
});
