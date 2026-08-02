import * as path from 'node:path';

/**
 * ScopeFence — lexical path-prefix validation against the workspace root
 * (SPEC §3.4). Known limitation (M3, Task 8 existing design): validation is
 * lexical (string prefix), not canonical — a symlink INSIDE the workspace
 * pointing outside is not resolved, so `validatePath` can be bypassed via a
 * link target. Resolving symlinks (`fs.realpathSync`) before validation is
 * future hardening; do not rely on this fence as the sole sandbox boundary.
 */

const DEFAULT_ENV_SAFELIST = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'LANG',
  'LC_ALL',
  'NODE_ENV',
  'TERM',
  'PWD',
  'OLDPWD',
  'DISPLAY',
  'SSH_AUTH_SOCK',
  'XDG_SESSION_TYPE',
];

export class ScopeFence {
  private readonly envSafelist: string[];

  constructor(envSafelist?: string[]) {
    this.envSafelist = envSafelist ?? DEFAULT_ENV_SAFELIST;
  }

  validatePath(inputPath: string, workspaceRoot: string): boolean {
    const resolved = path.resolve(inputPath);
    const resolvedRoot = path.resolve(workspaceRoot);
    if (resolved === resolvedRoot) {
      return true;
    }
    return resolved.startsWith(resolvedRoot + path.sep);
  }

  filterEnv(env: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const key of this.envSafelist) {
      if (key in env) {
        result[key] = env[key];
      }
    }
    return result;
  }
}
