import { describe, it, expect } from 'vitest';
import { ActionClassifier } from '../../../src/feedback/action-classifier.js';
import type { Action } from '../../../src/types.js';

describe('ActionClassifier', () => {
  const classifier = new ActionClassifier();

  describe('file_write classification', () => {
    it('classifies write_file with .ts path as file_write', () => {
      const action: Action = { tool: 'write_file', params: { path: 'src/index.ts', content: 'x' } };
      expect(classifier.classify(action)).toBe('file_write');
    });

    it('classifies write_file with .js path as file_write', () => {
      const action: Action = { tool: 'write_file', params: { path: 'lib/util.js', content: 'x' } };
      expect(classifier.classify(action)).toBe('file_write');
    });

    it('classifies write_file with .json path as file_write', () => {
      const action: Action = { tool: 'write_file', params: { path: 'package.json', content: '{}' } };
      expect(classifier.classify(action)).toBe('file_write');
    });

    it('classifies write_file with .tsx path as file_write', () => {
      const action: Action = { tool: 'write_file', params: { path: 'src/App.tsx', content: 'x' } };
      expect(classifier.classify(action)).toBe('file_write');
    });

    it('classifies write_file with .jsx path as file_write', () => {
      const action: Action = { tool: 'write_file', params: { path: 'src/App.jsx', content: 'x' } };
      expect(classifier.classify(action)).toBe('file_write');
    });

    it('classifies edit_file with .ts path as file_write', () => {
      const action: Action = { tool: 'edit_file', params: { path: 'src/index.ts', oldString: 'a', newString: 'b' } };
      expect(classifier.classify(action)).toBe('file_write');
    });
  });

  describe('file_read classification', () => {
    it('classifies read_file as file_read', () => {
      const action: Action = { tool: 'read_file', params: { paths: ['src/index.ts'] } };
      expect(classifier.classify(action)).toBe('file_read');
    });

    it('classifies list_directory as file_read', () => {
      const action: Action = { tool: 'list_directory', params: { path: 'src' } };
      expect(classifier.classify(action)).toBe('file_read');
    });

    it('classifies search_content as file_read', () => {
      const action: Action = { tool: 'search_content', params: { pattern: 'foo' } };
      expect(classifier.classify(action)).toBe('file_read');
    });
  });

  describe('test_run classification', () => {
    it('classifies run_shell with vitest as test_run', () => {
      const action: Action = { tool: 'run_shell', params: { command: 'npx vitest run' } };
      expect(classifier.classify(action)).toBe('test_run');
    });

    it('classifies run_shell with jest as test_run', () => {
      const action: Action = { tool: 'run_shell', params: { command: 'npx jest --coverage' } };
      expect(classifier.classify(action)).toBe('test_run');
    });

    it('classifies run_shell with npm test as test_run', () => {
      const action: Action = { tool: 'run_shell', params: { command: 'npm test' } };
      expect(classifier.classify(action)).toBe('test_run');
    });

    it('classifies run_test tool as test_run', () => {
      const action: Action = { tool: 'run_test', params: { pattern: 'unit' } };
      expect(classifier.classify(action)).toBe('test_run');
    });
  });

  describe('typecheck_run classification', () => {
    it('classifies run_shell with npx tsc as typecheck_run', () => {
      const action: Action = { tool: 'run_shell', params: { command: 'npx tsc --noEmit' } };
      expect(classifier.classify(action)).toBe('typecheck_run');
    });

    it('classifies run_shell with bare tsc as typecheck_run', () => {
      const action: Action = { tool: 'run_shell', params: { command: 'tsc' } };
      expect(classifier.classify(action)).toBe('typecheck_run');
    });
  });

  describe('shell_command classification', () => {
    it('classifies run_shell with echo as shell_command', () => {
      const action: Action = { tool: 'run_shell', params: { command: 'echo hello' } };
      expect(classifier.classify(action)).toBe('shell_command');
    });

    it('classifies run_shell with npm install as shell_command', () => {
      const action: Action = { tool: 'run_shell', params: { command: 'npm install lodash' } };
      expect(classifier.classify(action)).toBe('shell_command');
    });

    it('classifies run_shell with git status as shell_command', () => {
      const action: Action = { tool: 'run_shell', params: { command: 'git status' } };
      expect(classifier.classify(action)).toBe('shell_command');
    });

    it('classifies run_shell with eslint as shell_command (not a write/read tool, and command is not test/typecheck)', () => {
      const action: Action = { tool: 'run_shell', params: { command: 'npx eslint src/' } };
      expect(classifier.classify(action)).toBe('shell_command');
    });
  });

  describe('unknown tool fallback', () => {
    it('returns shell_command for unknown tools', () => {
      const action: Action = { tool: 'some_unknown_tool', params: {} };
      expect(classifier.classify(action)).toBe('shell_command');
    });
  });
});
