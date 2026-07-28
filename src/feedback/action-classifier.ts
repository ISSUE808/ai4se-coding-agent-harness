import type { Action } from '../types.js';

export type ActionType = 'file_write' | 'file_read' | 'test_run' | 'typecheck_run' | 'shell_command' | 'parse_error';

const CODE_EXTENSIONS = /\.(ts|js|json|tsx|jsx)$/;
const TEST_PATTERN = /(?:vitest|jest|\bnpm\s+test\b)/;
const TSC_PATTERN = /\btsc\b/;

export class ActionClassifier {
  classify(action: Action): ActionType {
    const tool = action.tool;
    const params = action.params;

    // file_write: write_file or edit_file involving code files
    if (tool === 'write_file' || tool === 'edit_file') {
      const path = String(params.path ?? '');
      if (CODE_EXTENSIONS.test(path)) {
        return 'file_write';
      }
      // write/edit on non-code file still counts as file_write
      return 'file_write';
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
