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
  /**
   * Canonical workspace roots keyed by their lexical form. `canonicalize` is
   * filesystem I/O (possibly a multi-level walk-up) and the root is constant
   * per session — memoizing it keeps the hot path (every tool action) to a
   * single realpath. Stale if the root itself is replaced mid-session (a
   * deleted-and-recreated workspace) — accepted: sessions pin their root.
   */
  private readonly canonicalRootCache = new Map<string, string>();

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
    // `canonicalize` returns null on unreadable paths (ELOOP/EACCES/EMFILE) —
    // fail closed, never accept a truncated path whose leaf was not checked.
    const norm = (p: string): string =>
      process.platform === 'win32' ? p.toLowerCase() : p;
    const canonical = canonicalize(resolved);
    if (canonical === null) {
      return false;
    }
    let canonicalRoot = this.canonicalRootCache.get(resolvedRoot);
    if (canonicalRoot === undefined) {
      canonicalRoot = canonicalize(resolvedRoot) ?? resolvedRoot;
      this.canonicalRootCache.set(resolvedRoot, canonicalRoot);
    }
    const c = norm(canonical);
    const cr = norm(canonicalRoot);
    return c === cr || c.startsWith(cr + path.sep);
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
 * lexical tail. For ENOENT the missing leaf provably cannot be a symlink, so
 * truncation is safe there. ANY other error (ELOOP symlink cycle, EACCES,
 * EMFILE/EIO) returns null — the leaf may be a real escaping symlink that a
 * later open() would resolve, and accepting the truncated path would bypass
 * the fence (reviewer Important).
 */
function canonicalize(inputPath: string): string | null {
  const resolved = path.resolve(inputPath);
  const isMissing = (err: unknown): boolean => {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR';
  };
  try {
    return fs.realpathSync(resolved);
  } catch (err) {
    if (!isMissing(err)) {
      return null;
    }
    let dir = path.dirname(resolved);
    const tail: string[] = [];
    for (;;) {
      try {
        return path.join(fs.realpathSync(dir), ...tail.reverse());
      } catch (walkErr) {
        if (!isMissing(walkErr)) {
          return null;
        }
        tail.push(path.basename(dir));
        const parent = path.dirname(dir);
        if (parent === dir) {
          // Filesystem root itself unreachable — nothing left to resolve.
          return resolved;
        }
        dir = parent;
      }
    }
  }
}
