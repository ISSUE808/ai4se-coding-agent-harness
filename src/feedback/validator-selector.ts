import type { Config, ActionType } from '../types.js';

export class ValidatorSelector {
  select(actionType: ActionType, config: Config): string[] {
    const { validators } = config.feedback;

    switch (actionType) {
      case 'file_write': {
        const selected: string[] = [];
        if (validators.eslint.enabled) selected.push('eslint');
        if (validators.tsc.enabled) selected.push('tsc');
        return selected;
      }

      case 'test_run': {
        const selected: string[] = ['exitCodeParser'];
        if (validators.testRunner.enabled) selected.push('testResultParser');
        return selected;
      }

      case 'shell_command': {
        const selected: string[] = ['exitCodeParser'];
        if (validators.shellCheck.enabled) selected.push('stderrChecker');
        return selected;
      }

      case 'typecheck_run': {
        const selected: string[] = ['exitCodeParser'];
        if (validators.tsc.enabled) selected.push('tscOutputParser');
        return selected;
      }

      case 'file_read':
        return [];

      case 'parse_error':
        return ['formatChecker'];

      default:
        return [];
    }
  }
}
