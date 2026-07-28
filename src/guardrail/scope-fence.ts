import * as path from 'node:path';

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
