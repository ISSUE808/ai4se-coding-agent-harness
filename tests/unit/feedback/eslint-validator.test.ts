import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EslintValidator } from '../../../src/feedback/validators/eslint-validator.js';
import type { Action, ToolResult, ValidatorContext } from '../../../src/types.js';

function makeExec(): ReturnType<typeof vi.fn> {
  return vi.fn();
}

describe('EslintValidator', () => {
  let execSync: ReturnType<typeof vi.fn>;
  let validator: EslintValidator;

  const action: Action = { tool: 'write_file', params: { path: 'src/index.ts' } };
  const ctx: ValidatorContext = { workspaceRoot: '/tmp/test' };

  beforeEach(() => {
    execSync = makeExec();
    validator = new EslintValidator(execSync);
  });

  it('has name "eslint"', () => {
    expect(validator.name).toBe('eslint');
  });

  it('returns passed when eslint finds no errors', async () => {
    const result: ToolResult = { success: true, duration_ms: 10, filesChanged: ['src/index.ts'] };
    execSync.mockReturnValue(Buffer.from(JSON.stringify([])));

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(true);
    expect(feedback.validator).toBe('eslint');
    expect(feedback.evidence).toBe('No lint errors');
  });

  it('returns failed when eslint finds errors', async () => {
    const result: ToolResult = { success: true, duration_ms: 10, filesChanged: ['src/index.ts'] };
    const eslintOutput = [{
      filePath: 'src/index.ts',
      messages: [{
        ruleId: 'no-unused-vars',
        severity: 2,
        message: 'x is declared but never used',
        line: 5,
        column: 9,
      }],
      errorCount: 1,
      warningCount: 0,
    }];
    execSync.mockReturnValue(Buffer.from(JSON.stringify(eslintOutput)));

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(false);
    expect(feedback.failureCategory).toBe('syntax');
    expect(feedback.validator).toBe('eslint');
    expect(feedback.evidence).toContain('no-unused-vars');
  });

  it('returns failed when eslint throws', async () => {
    const result: ToolResult = { success: true, duration_ms: 10, filesChanged: ['src/index.ts'] };
    execSync.mockImplementation(() => {
      throw new Error('eslint not found');
    });

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(false);
    expect(feedback.failureCategory).toBe('command');
    expect(feedback.evidence).toContain('eslint not found');
  });

  it('passes filesChanged to eslint command', async () => {
    const result: ToolResult = { success: true, duration_ms: 10, filesChanged: ['a.ts', 'b.ts'] };
    execSync.mockReturnValue(Buffer.from(JSON.stringify([])));

    await validator.validate(action, result, ctx);
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('a.ts b.ts'),
      expect.objectContaining({ cwd: '/tmp/test' }),
    );
  });

  it('handles warnings-only output as passed', async () => {
    const result: ToolResult = { success: true, duration_ms: 10, filesChanged: ['src/index.ts'] };
    const eslintOutput = [{
      filePath: 'src/index.ts',
      messages: [{
        ruleId: 'no-console',
        severity: 1,
        message: 'Unexpected console statement',
        line: 3,
        column: 1,
      }],
      errorCount: 0,
      warningCount: 1,
    }];
    execSync.mockReturnValue(Buffer.from(JSON.stringify(eslintOutput)));

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(true);
  });
});
