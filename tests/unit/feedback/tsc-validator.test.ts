import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TscValidator } from '../../../src/feedback/validators/tsc-validator.js';
import type { Action, ToolResult, ValidatorContext } from '../../../src/types.js';

function makeExec(): ReturnType<typeof vi.fn> {
  return vi.fn();
}

describe('TscValidator', () => {
  let execSync: ReturnType<typeof vi.fn>;
  let validator: TscValidator;

  const action: Action = { tool: 'write_file', params: { path: 'src/index.ts' } };
  const ctx: ValidatorContext = { workspaceRoot: '/tmp/test' };

  beforeEach(() => {
    execSync = makeExec();
    // hasConfig + hasBin injected as present so execSync paths are exercised
    // (the env-prereq skip is tested separately below).
    validator = new TscValidator(execSync, () => true, () => true);
  });

  it('skips (passes) when no tsconfig.json exists in the workspace — env prerequisite', async () => {
    const result: ToolResult = { success: true, duration_ms: 10, filesChanged: ['src/index.ts'] };
    const noConfigValidator = new TscValidator(execSync, () => false);

    const feedback = await noConfigValidator.validate(action, result, ctx);

    expect(feedback.passed).toBe(true);
    expect(feedback.validator).toBe('tsc');
    expect(feedback.evidence).toContain('skipped');
    expect(execSync).not.toHaveBeenCalled();
  });

  it('skips (passes) when tsconfig exists but no local tsc binary — the tsc@2.0.4 npx trap (KNOWN_ISSUES 4)', async () => {
    const result: ToolResult = { success: true, duration_ms: 10, filesChanged: ['src/index.ts'] };
    const noBinValidator = new TscValidator(execSync, () => true, () => false);

    const feedback = await noBinValidator.validate(action, result, ctx);

    expect(feedback.passed).toBe(true);
    expect(feedback.validator).toBe('tsc');
    expect(feedback.evidence).toContain('tsc');
    expect(execSync).not.toHaveBeenCalled();
  });

  it('has name "tsc"', () => {
    expect(validator.name).toBe('tsc');
  });

  it('returns passed when tsc finds no errors', async () => {
    const result: ToolResult = { success: true, duration_ms: 10, filesChanged: ['src/index.ts'] };
    execSync.mockReturnValue(Buffer.from(''));

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(true);
    expect(feedback.validator).toBe('tsc');
    expect(feedback.evidence).toBe('No type errors');
  });

  it('returns failed when tsc finds type errors in stdout', async () => {
    const result: ToolResult = { success: true, duration_ms: 10, filesChanged: ['src/index.ts'] };
    execSync.mockReturnValue(Buffer.from("src/index.ts(5,9): error TS6133: 'x' is declared but never used."));

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(false);
    expect(feedback.failureCategory).toBe('type');
    expect(feedback.validator).toBe('tsc');
    expect(feedback.evidence).toContain('TS6133');
  });

  it('parses tsc errors from error object when exit code is non-zero', async () => {
    const result: ToolResult = { success: true, duration_ms: 10, filesChanged: ['src/index.ts'] };
    const error = Object.assign(new Error('Command failed: npx tsc --noEmit'), {
      stdout: Buffer.from("src/index.ts(3,1): error TS2322: Type mismatch."),
      stderr: Buffer.from(''),
      status: 2,
    });
    execSync.mockImplementation(() => { throw error; });

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(false);
    expect(feedback.failureCategory).toBe('type');
    expect(feedback.evidence).toContain('TS2322');
  });

  it('returns command failure when tsc is not found', async () => {
    const result: ToolResult = { success: true, duration_ms: 10, filesChanged: ['src/index.ts'] };
    const error = Object.assign(new Error('Command failed: npx tsc --noEmit'), {
      stdout: Buffer.from(''),
      stderr: Buffer.from("'tsc' is not recognized"),
      status: 1,
    });
    execSync.mockImplementation(() => { throw error; });

    const feedback = await validator.validate(action, result, ctx);
    expect(feedback.passed).toBe(false);
    expect(feedback.failureCategory).toBe('command');
  });

  it('runs tsc --noEmit in workspace root', async () => {
    const result: ToolResult = { success: true, duration_ms: 10, filesChanged: ['src/index.ts'] };
    execSync.mockReturnValue(Buffer.from(''));

    await validator.validate(action, result, ctx);
    expect(execSync).toHaveBeenCalledWith(
      'npx tsc --noEmit',
      expect.objectContaining({ cwd: '/tmp/test' }),
    );
  });
});
