import { describe, it, expect } from 'vitest';
import { ValidatorSelector } from '../../../src/feedback/validator-selector.js';
import type { ActionType, Config } from '../../../src/types.js';
import { DEFAULT_CONFIG } from '../../../src/config/schema.js';

function makeConfig(overrides: Partial<Config['feedback']> = {}): Config {
  return {
    ...DEFAULT_CONFIG,
    feedback: {
      ...DEFAULT_CONFIG.feedback,
      ...overrides,
      validators: {
        ...DEFAULT_CONFIG.feedback.validators,
        ...(overrides.validators ?? {}),
      },
    },
  } as Config;
}

describe('ValidatorSelector', () => {
  const selector = new ValidatorSelector();

  describe('file_write action type', () => {
    it('selects [eslint, tsc] for file_write with default config', () => {
      const config = makeConfig();
      const result = selector.select('file_write', config);
      expect(result).toEqual(['eslint', 'tsc']);
    });

    it('skips eslint when disabled', () => {
      const config = makeConfig({
        validators: { eslint: { enabled: false } },
      });
      const result = selector.select('file_write', config);
      expect(result).toEqual(['tsc']);
    });

    it('skips tsc when disabled', () => {
      const config = makeConfig({
        validators: { tsc: { enabled: false } },
      });
      const result = selector.select('file_write', config);
      expect(result).toEqual(['eslint']);
    });

    it('returns empty array when both eslint and tsc are disabled', () => {
      const config = makeConfig({
        validators: { eslint: { enabled: false }, tsc: { enabled: false } },
      });
      const result = selector.select('file_write', config);
      expect(result).toEqual([]);
    });
  });

  describe('test_run action type', () => {
    it('selects [exitCodeParser, testResultParser] for test_run with default config', () => {
      const config = makeConfig();
      const result = selector.select('test_run', config);
      expect(result).toEqual(['exitCodeParser', 'testResultParser']);
    });

    it('skips testResultParser when testRunner is disabled', () => {
      const config = makeConfig({
        validators: { testRunner: { enabled: false } },
      });
      const result = selector.select('test_run', config);
      expect(result).toEqual(['exitCodeParser']);
    });
  });

  describe('shell_command action type', () => {
    it('selects [exitCodeParser, stderrChecker] for shell_command with default config', () => {
      const config = makeConfig();
      const result = selector.select('shell_command', config);
      expect(result).toEqual(['exitCodeParser', 'stderrChecker']);
    });

    it('skips stderrChecker when shellCheck is disabled', () => {
      const config = makeConfig({
        validators: { shellCheck: { enabled: false } },
      });
      const result = selector.select('shell_command', config);
      expect(result).toEqual(['exitCodeParser']);
    });
  });

  describe('typecheck_run action type', () => {
    it('selects [exitCodeParser, tscOutputParser] for typecheck_run with default config', () => {
      const config = makeConfig();
      const result = selector.select('typecheck_run', config);
      expect(result).toEqual(['exitCodeParser', 'tscOutputParser']);
    });

    it('skips tscOutputParser when tsc is disabled', () => {
      const config = makeConfig({
        validators: { tsc: { enabled: false } },
      });
      const result = selector.select('typecheck_run', config);
      expect(result).toEqual(['exitCodeParser']);
    });
  });

  describe('file_read action type', () => {
    it('returns empty array for file_read', () => {
      const config = makeConfig();
      const result = selector.select('file_read', config);
      expect(result).toEqual([]);
    });
  });

  describe('parse_error action type', () => {
    it('selects [formatChecker] for parse_error', () => {
      const config = makeConfig();
      const result = selector.select('parse_error', config);
      expect(result).toEqual(['formatChecker']);
    });

    it('formatChecker is always included (not configurable)', () => {
      // Even with all validators disabled, formatChecker should still be included
      const config = makeConfig({
        validators: {
          eslint: { enabled: false },
          tsc: { enabled: false },
          testRunner: { enabled: false },
          shellCheck: { enabled: false },
        },
      });
      const result = selector.select('parse_error', config);
      expect(result).toEqual(['formatChecker']);
    });
  });
});
