import { describe, it, expect, beforeEach } from 'vitest';
import { ShellCheckValidator } from '../../../src/feedback/validators/shell-check-validator.js';
import type { Action, ToolResult, ValidatorContext } from '../../../src/types.js';

describe('ShellCheckValidator', () => {
  let validator: ShellCheckValidator;

  const action: Action = { tool: 'shell_command', params: { command: 'npm test' } };
  const ctx: ValidatorContext = { workspaceRoot: '/tmp/test' };

  beforeEach(() => {
    validator = new ShellCheckValidator();
  });

  it('has name "shell-check"', () => {
    expect(validator.name).toBe('shell-check');
  });

  it('returns passed when exitCode is 0 and no error', async () => {
    const result: ToolResult = {
      success: true,
      duration_ms: 100,
      exitCode: 0,
      output: 'command output',
    };

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(true);
    expect(feedback.validator).toBe('shell-check');
    expect(feedback.evidence).toBe('Shell command completed successfully');
  });

  it('returns passed when exitCode is null (not set) and no error', async () => {
    const result: ToolResult = {
      success: true,
      duration_ms: 100,
      exitCode: null,
      output: 'command output',
    };

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(true);
  });

  it('returns passed when exitCode is undefined and no error', async () => {
    const result: ToolResult = {
      success: true,
      duration_ms: 100,
      output: 'command output',
    };

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(true);
  });

  it('returns failed when exitCode is non-zero', async () => {
    const result: ToolResult = {
      success: false,
      duration_ms: 100,
      exitCode: 1,
      output: 'some output',
      error: 'command failed',
    };

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(false);
    expect(feedback.failureCategory).toBe('command');
    expect(feedback.validator).toBe('shell-check');
    expect(feedback.evidence).toContain('exit code 1');
  });

  it('returns failed when error (stderr) is non-empty even with exitCode 0', async () => {
    const result: ToolResult = {
      success: true,
      duration_ms: 100,
      exitCode: 0,
      output: 'some output',
      error: 'Warning: deprecated option used',
    };

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(false);
    expect(feedback.failureCategory).toBe('command');
    expect(feedback.evidence).toContain('Warning: deprecated option used');
  });

  it('returns failed when both exitCode non-zero and error non-empty', async () => {
    const result: ToolResult = {
      success: false,
      duration_ms: 100,
      exitCode: 2,
      output: '',
      error: 'fatal error occurred',
    };

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(false);
    expect(feedback.failureCategory).toBe('command');
    expect(feedback.evidence).toContain('exit code 2');
    expect(feedback.evidence).toContain('fatal error occurred');
  });

  it('returns passed for ToolResult with no exitCode and empty error string', async () => {
    const result: ToolResult = {
      success: true,
      duration_ms: 100,
      output: 'done',
      error: '',
    };

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(true);
  });

  it('includes evidence with exit code when only exitCode fails', async () => {
    const result: ToolResult = {
      success: false,
      duration_ms: 100,
      exitCode: 127,
      output: '',
    };

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(false);
    expect(feedback.evidence).toContain('exit code 127');
  });
});
