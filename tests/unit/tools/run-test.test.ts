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

  // Real vitest v2.1.9 output captured on Windows (pipe): per-file lines and
  // summary lines are interleaved with ANSI color codes — e.g.
  // `\x1b[32m✓\x1b[39m path` and `\x1b[1m\x1b[32m48 passed\x1b[39m`. The parser
  // must strip them before matching, otherwise EVERY real invocation resolves
  // to `{passed:false, results:[]}` (KNOWN_ISSUES 9.6).
  const ANSI_FILE_LINES =
    '\x1b[32m✓\x1b[39m tests/unit/cli/prompt.test.ts \x1b[2m(\x1b[22m\x1b[2m12 tests\x1b[22m\x1b[2m)\x1b[22m\x1b[90m 11\x1b[2mms\x1b[22m\x1b[39m\n' +
    '\x1b[32m✓\x1b[39m tests/unit/tools/run-test.test.ts \x1b[2m(\x1b[22m\x1b[2m8 tests\x1b[22m\x1b[2m)\x1b[22m\x1b[90m 31\x1b[2mms\x1b[22m\x1b[39m\n';
  const ANSI_SUMMARY =
    '\x1b[2m Test Files \x1b[22m \x1b[1m\x1b[32m2 passed\x1b[39m\x1b[22m\x1b[90m (2)\x1b[39m\n' +
    '\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m20 passed\x1b[39m\x1b[22m\x1b[90m (20)\x1b[39m\n';

  it('parses per-file lines containing ANSI color codes (KNOWN_ISSUES 9.6)', async () => {
    mockedExecSync.mockReturnValue(ANSI_FILE_LINES + '\n' + ANSI_SUMMARY);
    const result = await runTestTool.execute({}, context);

    expect(result.success).toBe(true);
    const p = JSON.parse(result.output!);
    expect(p.passed).toBe(true);
    expect(p.results).toHaveLength(2);
    expect(p.results[0].name).toContain('prompt.test.ts');
    expect(p.results[0].status).toBe('passed');
  });

  it('does not report failure when only the ANSI-colored summary matched (KNOWN_ISSUES 9.6)', async () => {
    // No per-file lines at all (e.g. quiet reporter) — summary alone must
    // yield passed:true, not the old fallback `{passed:false, results:[]}`.
    mockedExecSync.mockReturnValue('\n' + ANSI_SUMMARY);
    const result = await runTestTool.execute({}, context);

    expect(result.success).toBe(true);
    const p = JSON.parse(result.output!);
    expect(p.passed).toBe(true);
    expect(p.results).toHaveLength(0);
  });

  it('does not report passed:true when a skipped-count line hid a failed file (reviewer Important)', async () => {
    // Vitest renders a file with failures AND skips as
    // `❯ path (5 tests | 1 failed | 2 skipped) 13ms` — the per-file regex
    // stops at `| 1 failed` and the `| 2 skipped` suffix makes it not match
    // at all. If another file's ✓ line matched, the per-file path used to
    // short-circuit to passed:true while the summary said a file failed.
    mockedExecSync.mockReturnValue(
      '\x1b[32m✓\x1b[39m tests/unit/ok.test.ts \x1b[2m(\x1b[22m\x1b[2m2 tests\x1b[22m\x1b[2m)\x1b[22m\x1b[90m 4\x1b[2mms\x1b[22m\x1b[39m\n' +
        '\x1b[31m❯\x1b[39m tests/unit/flaky.test.ts \x1b[2m(\x1b[22m\x1b[2m5 tests\x1b[22m \x1b[2m|\x1b[22m \x1b[2m1 failed\x1b[22m \x1b[2m|\x1b[22m \x1b[2m2 skipped\x1b[22m\x1b[2m)\x1b[22m\x1b[90m 13\x1b[2mms\x1b[22m\x1b[39m\n' +
        '\n\x1b[2m Test Files \x1b[22m \x1b[1m\x1b[31m1 failed\x1b[39m\x1b[22m\x1b[90m |\x1b[39m\x1b[22m\x1b[1m\x1b[32m1 passed\x1b[39m\x1b[22m\x1b[90m (2)\x1b[39m\n' +
        '\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m6 passed\x1b[39m\x1b[22m\x1b[90m\x1b[39m\x1b[22m \x1b[1m\x1b[31m1 failed\x1b[39m\x1b[22m\x1b[90m (7 | 1 skipped)\x1b[39m\n',
    );
    const result = await runTestTool.execute({}, context);

    expect(result.success).toBe(true);
    const p = JSON.parse(result.output!);
    expect(p.passed).toBe(false);
  });

  it('reports passed:false on an all-failed summary line (reviewer Minor)', async () => {
    mockedExecSync.mockReturnValue(
      '\x1b[2m Test Files \x1b[22m \x1b[1m\x1b[31m3 failed\x1b[39m\x1b[22m\x1b[90m (3)\x1b[39m\n' +
        '\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[31m3 failed\x1b[39m\x1b[22m\x1b[90m (3)\x1b[39m\n',
    );
    const result = await runTestTool.execute({}, context);

    expect(result.success).toBe(true);
    const p = JSON.parse(result.output!);
    expect(p.passed).toBe(false);
    expect(p.results).toHaveLength(0);
  });

  it('truncates rawOutput beyond 4000 chars with an explicit marker (reviewer Minor)', async () => {
    const longOutput = 'line of vitest output\n'.repeat(600); // ~12600 chars
    mockedExecSync.mockReturnValue(longOutput);
    const result = await runTestTool.execute({}, context);

    expect(result.success).toBe(true);
    const p = JSON.parse(result.output!);
    expect(p.rawOutput!.length).toBeLessThanOrEqual(4000 + 64);
    expect(p.rawOutput).toContain('output truncated at 4000 chars');
  });

  it('includes the raw stdout in output.rawOutput when parsing fails (KNOWN_ISSUES 9.6)', async () => {
    // A vitest version/locale change could defeat the parser — the agent must
    // still see the original stdout instead of an empty `{passed:false}`.
    const weirdOutput = 'garbled nonsense without any recognizable marker';
    mockedExecSync.mockReturnValue(weirdOutput);
    const result = await runTestTool.execute({}, context);

    expect(result.success).toBe(true);
    const p = JSON.parse(result.output!);
    expect(p.rawOutput).toContain(weirdOutput);
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
