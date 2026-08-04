import type { Validator, Action, ToolResult, ValidatorContext, FeedbackResult } from '../../types.js';
import { execSync as nodeExecSync } from 'child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { hasLocalBin } from '../../utils/env-prereq.js';

/** ESLint config files recognized by eslint v8/v9 (flat + legacy). */
const ESLINT_CONFIG_FILES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  '.eslintrc.js',
  '.eslintrc.json',
  '.eslintrc',
];

function defaultHasEslintConfig(root: string): boolean {
  return ESLINT_CONFIG_FILES.some((name) => existsSync(path.join(root, name)));
}

export class EslintValidator implements Validator {
  name = 'eslint';
  private _exec: typeof nodeExecSync;
  private _hasConfig: (root: string) => boolean;
  private _hasBin: (root: string) => boolean;

  constructor(
    exec?: typeof nodeExecSync,
    hasConfig?: (root: string) => boolean,
    hasBin?: (root: string) => boolean,
  ) {
    this._exec = exec ?? nodeExecSync;
    this._hasConfig = hasConfig ?? defaultHasEslintConfig;
    this._hasBin = hasBin ?? ((root) => hasLocalBin(root, 'eslint'));
  }

  async validate(action: Action, result: ToolResult, context: ValidatorContext): Promise<FeedbackResult> {
    const files = result.filesChanged ?? [];

    // Environment prerequisite (SPEC §10 未决问题 2): without an eslint config
    // the linter can only report "no config found" noise — skip it instead of
    // feeding the environment failure back to the LLM as a code error.
    if (!this._hasConfig(context.workspaceRoot)) {
      return {
        passed: true,
        validator: 'eslint',
        evidence: 'ESLint skipped: no eslint.config.(js|mjs|cjs) in workspace',
      };
    }

    // Env prerequisite (KNOWN_ISSUES 4): with a config but no LOCAL eslint,
    // `npx eslint` downloads the package — skip rather than trigger an
    // install/network fetch from inside a feedback loop.
    if (!this._hasBin(context.workspaceRoot)) {
      return {
        passed: true,
        validator: 'eslint',
        evidence: 'ESLint skipped: no local eslint binary (node_modules/.bin/eslint missing)',
      };
    }

    try {
      const output = this._exec(`npx eslint --format json ${files.join(' ')}`, {
        cwd: context.workspaceRoot,
        stdio: 'pipe',
      });

      const results: Array<{
        filePath: string;
        messages: Array<{ ruleId: string | null; severity: number; message: string; line: number; column: number }>;
      }> = JSON.parse(output.toString());

      const errors = results.flatMap(r =>
        r.messages.filter(m => m.severity >= 2).map(m => ({ ...m, _filePath: r.filePath })),
      );

      if (errors.length === 0) {
        return {
          passed: true,
          validator: 'eslint',
          evidence: 'No lint errors',
        };
      }

      return {
        passed: false,
        validator: 'eslint',
        failureCategory: 'syntax',
        evidence: `ESLint: ${errors.map(e => `${e.ruleId}: ${e.message}`).join('; ')}`,
        details: errors.map(e => ({ file: e._filePath, line: e.line, rule: e.ruleId ?? undefined })),
      };
    } catch (err) {
      const error = err as Error;
      return {
        passed: false,
        validator: 'eslint',
        failureCategory: 'command',
        evidence: `ESLint error: ${error.message}`,
      };
    }
  }
}
