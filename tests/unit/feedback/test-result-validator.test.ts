import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestResultValidator } from '../../../src/feedback/validators/test-result-validator.js';
import type { Action, ToolResult, ValidatorContext } from '../../../src/types.js';

function makeExec(): ReturnType<typeof vi.fn> {
  return vi.fn();
}

describe('TestResultValidator', () => {
  let execSync: ReturnType<typeof vi.fn>;
  let validator: TestResultValidator;

  const action: Action = { tool: 'write_file', params: { path: 'src/index.ts' } };
  const ctx: ValidatorContext = { workspaceRoot: '/tmp/test' };

  beforeEach(() => {
    execSync = makeExec();
    // hasVitest injected as always-present so execSync paths are exercised
    // (the env-prereq skip is tested separately below).
    validator = new TestResultValidator(execSync, () => true);
  });

  it('has name "test-runner"', () => {
    expect(validator.name).toBe('testResultParser');
  });

  it('skips (passes) when vitest is not installed in the workspace — env prerequisite (KNOWN_ISSUES 3)', async () => {
    const result: ToolResult = { success: true, duration_ms: 10, filesChanged: ['src/index.ts'] };
    const noVitestValidator = new TestResultValidator(execSync, () => false);

    const feedback = await noVitestValidator.validate(action, result, ctx);

    expect(feedback.passed).toBe(true);
    expect(feedback.validator).toBe('testResultParser');
    expect(feedback.evidence).toContain('vitest');
    expect(execSync).not.toHaveBeenCalled();
  });

  it('returns passed when all tests pass', async () => {
    const result: ToolResult = { success: true, duration_ms: 10, filesChanged: ['src/index.ts'] };
    const vitestOutput = JSON.stringify({
      numTotalTests: 3,
      numPassedTests: 3,
      numFailedTests: 0,
      success: true,
      testResults: [],
    });
    execSync.mockReturnValue(Buffer.from(vitestOutput));

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(true);
    expect(feedback.validator).toBe('testResultParser');
    expect(feedback.evidence).toBe('All 3 tests passed');
  });

  it('returns failed with logic category when tests fail', async () => {
    const result: ToolResult = { success: true, duration_ms: 10, filesChanged: ['src/index.ts'] };
    const vitestOutput = JSON.stringify({
      numTotalTests: 3,
      numPassedTests: 1,
      numFailedTests: 2,
      success: false,
      testResults: [
        {
          name: '/tmp/test/tests/unit/foo.test.ts',
          status: 'failed',
          assertionResults: [
            {
              ancestorTitles: ['Foo'],
              title: 'should work',
              status: 'failed',
              failureMessages: ['Error: expected 1 to be 2'],
            },
            {
              ancestorTitles: ['Foo'],
              title: 'should also work',
              status: 'failed',
              failureMessages: ['Error: timeout'],
            },
          ],
        },
      ],
    });
    execSync.mockReturnValue(Buffer.from(vitestOutput));

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(false);
    expect(feedback.failureCategory).toBe('logic');
    expect(feedback.validator).toBe('testResultParser');
    expect(feedback.evidence).toContain('2 of 3 tests failed');
    expect(feedback.details).toHaveLength(2);
    expect(feedback.details![0]).toMatchObject({
      file: 'tests/unit/foo.test.ts',
    });
  });

  it('handles jest-style output format', async () => {
    const result: ToolResult = { success: true, duration_ms: 10, filesChanged: ['src/index.ts'] };
    const jestOutput = JSON.stringify({
      numTotalTests: 2,
      numPassedTests: 1,
      numFailedTests: 1,
      success: false,
      testResults: [
        {
          name: '/tmp/test/tests/bar.test.ts',
          status: 'failed',
          message: 'Test failed',
          assertionResults: [
            {
              ancestorTitles: ['Bar'],
              title: 'does thing',
              status: 'failed',
              failureMessages: ['Expected: 1, Received: 2'],
            },
          ],
        },
      ],
    });
    execSync.mockReturnValue(Buffer.from(jestOutput));

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(false);
    expect(feedback.failureCategory).toBe('logic');
    expect(feedback.details![0]).toMatchObject({
      file: 'tests/bar.test.ts',
    });
  });

  it('returns command failure when vitest not found', async () => {
    const result: ToolResult = { success: true, duration_ms: 10, filesChanged: ['src/index.ts'] };
    const error = Object.assign(new Error('Command failed: npx vitest'), {
      stdout: Buffer.from(''),
      stderr: Buffer.from("'vitest' is not recognized"),
      status: 1,
    });
    execSync.mockImplementation(() => { throw error; });

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(false);
    expect(feedback.failureCategory).toBe('command');
    expect(feedback.validator).toBe('testResultParser');
  });

  it('returns command failure when JSON output is invalid', async () => {
    const result: ToolResult = { success: true, duration_ms: 10, filesChanged: ['src/index.ts'] };
    execSync.mockReturnValue(Buffer.from('not valid json'));

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(false);
    expect(feedback.failureCategory).toBe('command');
    expect(feedback.evidence).toContain('Failed to parse');
  });

  it('runs npx vitest run in workspace root', async () => {
    const result: ToolResult = { success: true, duration_ms: 10, filesChanged: ['src/index.ts'] };
    execSync.mockReturnValue(Buffer.from(JSON.stringify({
      numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, success: true, testResults: [],
    })));

    await validator.validate(action, result, ctx);
    expect(execSync).toHaveBeenCalledWith(
      'npx vitest run --reporter json',
      expect.objectContaining({ cwd: '/tmp/test' }),
    );
  });

  it('handles empty testResults array with zero failed count', async () => {
    const result: ToolResult = { success: true, duration_ms: 10, filesChanged: ['src/index.ts'] };
    const vitestOutput = JSON.stringify({
      numTotalTests: 0,
      numPassedTests: 0,
      numFailedTests: 0,
      success: true,
      testResults: [],
    });
    execSync.mockReturnValue(Buffer.from(vitestOutput));

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(true);
    expect(feedback.evidence).toContain('0 tests');
  });

  it('uses exitCode from error object to detect failure', async () => {
    const result: ToolResult = { success: true, duration_ms: 10, filesChanged: ['src/index.ts'] };
    const error = Object.assign(new Error('Command failed with exit code 1'), {
      stdout: Buffer.from(''),
      stderr: Buffer.from('Some error output'),
      status: 1,
    });
    execSync.mockImplementation(() => { throw error; });

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(false);
    expect(feedback.failureCategory).toBe('command');
  });
});
