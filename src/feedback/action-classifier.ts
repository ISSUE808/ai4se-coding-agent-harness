import type { Action, ActionType } from '../types.js';

const CODE_EXTENSIONS = /\.(ts|js|json|tsx|jsx)$/;
const TEST_PATTERN = /(?:vitest|jest|\bnpm\s+(?:run\s+)?test\b)/;
const TSC_PATTERN = /\btsc\b/;

export class ActionClassifier {
  classify(action: Action): ActionType {
    const tool = action.tool;
    const params = action.params;

    // file_write: SPEC §3.3 — only code files trigger eslint+tsc validators
    if (tool === 'write_file' || tool === 'edit_file') {
      const path = String(params.path ?? '');
      if (CODE_EXTENSIONS.test(path)) {
        return 'file_write';
      }
      // Non-code files (.md, .css, .yaml etc.) get no validators — same as file_read
      return 'file_read';
    }

    // file_read: read_file, list_directory, search_content
    if (tool === 'read_file' || tool === 'list_directory' || tool === 'search_content') {
      return 'file_read';
    }

    // run_shell needs command analysis
    if (tool === 'run_shell') {
      const command = String(params.command ?? '');

      // typecheck_run: tsc execution
      if (TSC_PATTERN.test(command)) {
        return 'typecheck_run';
      }

      // test_run: vitest/jest/npm test pattern
      if (TEST_PATTERN.test(command)) {
        return 'test_run';
      }

      // Everything else is shell_command
      return 'shell_command';
    }

    // run_test tool is test_run
    if (tool === 'run_test') {
      return 'test_run';
    }

    // Unknown tools fallback to shell_command
    return 'shell_command';
  }
}
