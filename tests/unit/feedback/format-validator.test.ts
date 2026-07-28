import { describe, it, expect, beforeEach } from 'vitest';
import { FormatValidator } from '../../../src/feedback/validators/format-validator.js';
import type { Action, ToolResult, ValidatorContext } from '../../../src/types.js';

describe('FormatValidator', () => {
  let validator: FormatValidator;

  const ctx: ValidatorContext = { workspaceRoot: '/tmp/test' };

  beforeEach(() => {
    validator = new FormatValidator();
  });

  it('has name "format"', () => {
    expect(validator.name).toBe('formatChecker');
  });

  it('returns passed for a valid Action with tool and params', async () => {
    const action: Action = { tool: 'write_file', params: { path: 'src/index.ts', content: 'hello' } };
    const result: ToolResult = { success: true, duration_ms: 10 };

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(true);
    expect(feedback.validator).toBe('formatChecker');
    expect(feedback.evidence).toBe('Action format is valid');
  });

  it('returns passed for Action with empty params object', async () => {
    const action: Action = { tool: 'list_files', params: {} };
    const result: ToolResult = { success: true, duration_ms: 10 };

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(true);
  });

  it('returns failed with parse_error when Action is missing tool', async () => {
    const action = { params: { path: 'src/index.ts' } } as unknown as Action;
    const result: ToolResult = { success: true, duration_ms: 10 };

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(false);
    expect(feedback.failureCategory).toBe('parse_error');
    expect(feedback.validator).toBe('formatChecker');
    expect(feedback.evidence).toContain('missing required field: tool');
  });

  it('returns failed with parse_error when Action tool is empty string', async () => {
    const action: Action = { tool: '', params: {} };
    const result: ToolResult = { success: true, duration_ms: 10 };

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(false);
    expect(feedback.failureCategory).toBe('parse_error');
    expect(feedback.evidence).toContain('tool');
  });

  it('returns failed with parse_error when Action is missing params', async () => {
    const action = { tool: 'write_file' } as unknown as Action;
    const result: ToolResult = { success: true, duration_ms: 10 };

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(false);
    expect(feedback.failureCategory).toBe('parse_error');
    expect(feedback.evidence).toContain('missing required field: params');
  });

  it('returns failed with parse_error when Action params is null', async () => {
    const action: Action = { tool: 'write_file', params: null as unknown as Record<string, unknown> };
    const result: ToolResult = { success: true, duration_ms: 10 };

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(false);
    expect(feedback.failureCategory).toBe('parse_error');
    expect(feedback.evidence).toContain('params');
  });

  it('returns failed with parse_error when Action params is an array', async () => {
    const action = { tool: 'exec', params: [] as unknown as Record<string, unknown> } as Action;
    const result: ToolResult = { success: true, duration_ms: 10 };

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(false);
    expect(feedback.failureCategory).toBe('parse_error');
    expect(feedback.evidence).toContain('params');
  });

  it('returns failed with parse_error when Action is null', async () => {
    const action = null as unknown as Action;
    const result: ToolResult = { success: true, duration_ms: 10 };

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(false);
    expect(feedback.failureCategory).toBe('parse_error');
    expect(feedback.evidence).toContain('null');
  });

  it('returns failed with parse_error when Action is undefined', async () => {
    const action = undefined as unknown as Action;
    const result: ToolResult = { success: true, duration_ms: 10 };

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(false);
    expect(feedback.failureCategory).toBe('parse_error');
    expect(feedback.evidence).toContain('undefined');
  });

  it('lists all missing fields when multiple are absent', async () => {
    const action = {} as unknown as Action;
    const result: ToolResult = { success: true, duration_ms: 10 };

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(false);
    expect(feedback.failureCategory).toBe('parse_error');
    expect(feedback.evidence).toContain('tool');
    expect(feedback.evidence).toContain('params');
  });

  it('does not depend on ToolResult or context', async () => {
    const action: Action = { tool: 'read_file', params: { path: 'README.md' } };
    const result: ToolResult = { success: false, duration_ms: 0, exitCode: 1, error: 'failed' };

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(true);
  });
});
