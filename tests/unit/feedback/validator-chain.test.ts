import { describe, it, expect } from 'vitest';
import { ValidatorChain } from '../../../src/feedback/validator-chain.js';
import type { Action, ToolResult, Validator, FeedbackResult, ValidatorContext } from '../../../src/types.js';

function passing(name: string): Validator {
  return {
    name,
    validate: async (): Promise<FeedbackResult> => ({
      passed: true,
      validator: name,
      evidence: 'ok',
    }),
  };
}

function failing(name: string): Validator {
  return {
    name,
    validate: async (): Promise<FeedbackResult> => ({
      passed: false,
      validator: name,
      failureCategory: 'syntax',
      evidence: 'bad',
    }),
  };
}

const action: Action = { tool: 'write_file', params: { path: 'a.ts' } };
const result: ToolResult = { success: true, duration_ms: 1 };
const ctx: ValidatorContext = { workspaceRoot: '/tmp' };

describe('ValidatorChain', () => {
  describe('fail_fast mode', () => {
    it('executes all validators when all pass', async () => {
      const chain = new ValidatorChain([passing('a'), passing('b')], 'fail_fast');
      const results = await chain.run(action, result, ctx);
      expect(results).toHaveLength(2);
      expect(results.every(r => r.passed)).toBe(true);
    });

    it('stops at first failure', async () => {
      const chain = new ValidatorChain([passing('a'), failing('b'), passing('c')], 'fail_fast');
      const results = await chain.run(action, result, ctx);
      expect(results).toHaveLength(2);
      expect(results[0].passed).toBe(true);
      expect(results[1].passed).toBe(false);
    });

    it('returns single result when first validator fails', async () => {
      const chain = new ValidatorChain([failing('a'), passing('b')], 'fail_fast');
      const results = await chain.run(action, result, ctx);
      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(false);
      expect(results[0].validator).toBe('a');
    });
  });

  describe('collect_all mode', () => {
    it('executes all validators even when some fail', async () => {
      const chain = new ValidatorChain([passing('a'), failing('b'), failing('c')], 'collect_all');
      const results = await chain.run(action, result, ctx);
      expect(results).toHaveLength(3);
    });

    it('returns all failures', async () => {
      const chain = new ValidatorChain([failing('a'), failing('b')], 'collect_all');
      const results = await chain.run(action, result, ctx);
      expect(results).toHaveLength(2);
      expect(results.every(r => !r.passed)).toBe(true);
    });

    it('returns all passes when all pass', async () => {
      const chain = new ValidatorChain([passing('a'), passing('b')], 'collect_all');
      const results = await chain.run(action, result, ctx);
      expect(results).toHaveLength(2);
      expect(results.every(r => r.passed)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns empty array for empty validators', async () => {
      const chain = new ValidatorChain([], 'fail_fast');
      const results = await chain.run(action, result, ctx);
      expect(results).toEqual([]);
    });

    it('returns empty array for empty validators in collect_all', async () => {
      const chain = new ValidatorChain([], 'collect_all');
      const results = await chain.run(action, result, ctx);
      expect(results).toEqual([]);
    });
  });
});
