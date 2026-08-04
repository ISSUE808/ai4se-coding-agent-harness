import * as path from 'node:path';
import * as fs from 'node:fs';

/**
 * ScopeFence — canonical path validation against the workspace root
 * (SPEC §3.4). Validation is two-layered (KNOWN_ISSUES 7):
 * 1. Lexical fast path — `path.resolve` + prefix match rejects paths already
 *    outside the root without any filesystem I/O.
 * 2. Canonical check — `fs.realpathSync` on the nearest existing ancestor of
 *    the target (the target itself may not exist yet: write_file creates new
 *    files) so a symlink INSIDE the workspace pointing outside (e.g.
 *    `root/link → /etc`) is resolved before the prefix comparison.
 * The fence never claims to be a hard sandbox boundary — it authorizes
 * per-operation access to the user's workspace.
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
    // Lexical fast path: paths already outside the root are rejected without
    // filesystem I/O (realpath of a nonexistent path costs a walk-up).
    const lexicalOk =
      resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
    if (!lexicalOk) {
      return false;
    }
    // Canonical check: a symlink INSIDE the workspace may point outside it
    // (`root/link → /etc`). Compare canonical forms; Windows realpath may
    // normalize drive-letter case, so fold case before comparing.
    const norm = (p: string): string =>
      process.platform === 'win32' ? p.toLowerCase() : p;
    const canonical = norm(canonicalize(resolved));
    const canonicalRoot = norm(canonicalize(resolvedRoot));
    return canonical === canonicalRoot || canonical.startsWith(canonicalRoot + path.sep);
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

/**
 * Canonicalize a path without requiring it to exist. `fs.realpathSync` throws
 * ENOENT for targets that do not exist yet (write_file creates new files) —
 * walk up to the nearest existing ancestor, realpath it, and re-attach the
 * lexical tail. Falls back to the lexical path if even the filesystem root is
 * unreachable.
 */
function canonicalize(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  try {
    return fs.realpathSync(resolved);
  } catch {
    let dir = path.dirname(resolved);
    const tail: string[] = [];
    for (;;) {
      try {
        return path.join(fs.realpathSync(dir), ...tail.reverse());
      } catch {
        tail.push(path.basename(dir));
        const parent = path.dirname(dir);
        if (parent === dir) {
          return resolved;
        }
        dir = parent;
      }
    }
  }
}
