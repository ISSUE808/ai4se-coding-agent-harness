import { Router } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * fs browsing endpoint (PLAN Task 23): GET /api/fs/tree enumerates a
 * directory tree for the WebUI (new-session directory picker + session-detail
 * file tree). Boundary semantics follow SPEC §3.4 / ScopeFence: a path is
 * enumerable only when it resolves inside one of the authorized workspace
 * roots; anything else answers 400. The root set is provided by the caller
 * via `getAllowedRoots` — server.ts wires it to the config agent
 * workspaceRoot plus every known session workspaceRoot (so an existing
 * session's working directory stays browseable even when it differs from the
 * config root).
 *
 * Guards:
 * - maxDepth (default 4): directories at the depth cap carry no `children`.
 * - maxEntriesPerDir (default 200): oversized directories are truncated and
 *   flagged with `truncated: true`.
 * - Symlinks are never followed and never listed: a symlink inside the
 *   workspace could point outside it, so the endpoint refuses symlinked
 *   request paths and skips symlinked entries (the same lexical-boundary
 *   caveat documented for ScopeFence, M3).
 */

export interface FsTreeNode {
  /** Absolute path of this node. */
  path: string;
  /** Basename of this node. */
  name: string;
  type: 'dir' | 'file';
  /** File size in bytes (files only). */
  size?: number;
  /** Direct children (dirs only, and only within the depth cap). */
  children?: FsTreeNode[];
  /** True when this directory held more entries than maxEntriesPerDir. */
  truncated?: boolean;
}

export interface FsRouterDeps {
  /**
   * Authorized workspace roots (boundary set). Called per request so roots
   * registered after mount (e.g. newly created sessions) are honored.
   */
  getAllowedRoots: () => string[];
  /** Recursion cap; directories at this depth are not enumerated. */
  maxDepth?: number;
  /** Per-directory entry cap; overflow is flagged `truncated`. */
  maxEntriesPerDir?: number;
}

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_ENTRIES_PER_DIR = 200;

/** Lexical prefix check — same semantics as ScopeFence.validatePath (§3.4). */
function isInside(resolvedPath: string, root: string): boolean {
  if (resolvedPath === root) {
    return true;
  }
  return resolvedPath.startsWith(root + path.sep);
}

export function createFsRouter(deps: FsRouterDeps): Router {
  const maxDepth = deps.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxEntriesPerDir = deps.maxEntriesPerDir ?? DEFAULT_MAX_ENTRIES_PER_DIR;
  const router = Router();

  router.get('/tree', (req, res) => {
    const rawPath = req.query.path;
    if (rawPath !== undefined && typeof rawPath !== 'string') {
      res.status(400).json({ error: 'path must be a single string' });
      return;
    }

    const roots = deps
      .getAllowedRoots()
      .filter((r) => typeof r === 'string' && r.trim() !== '')
      .map((r) => path.resolve(r));
    if (roots.length === 0) {
      res.status(400).json({ error: 'no workspace roots are configured' });
      return;
    }

    // No path → the first allowed root (server.ts wires config
    // agent.workspaceRoot first, so this is the default workspace).
    const target = rawPath !== undefined && rawPath.trim() !== ''
      ? path.resolve(rawPath)
      : roots[0];

    if (!roots.some((root) => isInside(target, root))) {
      res.status(400).json({ error: `path is outside the allowed workspace roots: ${target}` });
      return;
    }

    // lstat (no symlink following): a symlinked request path could point
    // outside the boundary, so refuse it outright.
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(target);
    } catch {
      res.status(400).json({ error: `directory does not exist or is not readable: ${target}` });
      return;
    }
    if (stat.isSymbolicLink()) {
      res.status(400).json({ error: `path must not be a symbolic link: ${target}` });
      return;
    }
    if (!stat.isDirectory()) {
      res.status(400).json({ error: `path is not a directory: ${target}` });
      return;
    }

    let tree: FsTreeNode;
    try {
      tree = buildNode(target, 0, maxDepth, maxEntriesPerDir);
    } catch {
      res.status(400).json({ error: `directory is not readable: ${target}` });
      return;
    }
    res.json(tree);
  });

  return router;
}

/** Enumerate `dir` into an FsTreeNode; entries at `depth >= maxDepth` are
 *  not enumerated (no `children` key). */
function buildNode(dir: string, depth: number, maxDepth: number, maxEntriesPerDir: number): FsTreeNode {
  const node: FsTreeNode = {
    path: dir,
    name: path.basename(dir),
    type: 'dir',
  };
  if (depth >= maxDepth) {
    return node;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const dirs: fs.Dirent[] = [];
  const files: fs.Dirent[] = [];
  for (const entry of entries) {
    // Symlinks are skipped entirely: never listed, never recursed into
    // (they may point outside the workspace boundary — M3 caveat).
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      dirs.push(entry);
    } else if (entry.isFile()) {
      files.push(entry);
    }
    // Other entry kinds (sockets, devices) are omitted.
  }
  dirs.sort(byName);
  files.sort(byName);

  const all = [...dirs, ...files];
  const truncated = all.length > maxEntriesPerDir;
  const kept = truncated ? all.slice(0, maxEntriesPerDir) : all;

  node.children = kept.map((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return buildNode(full, depth + 1, maxDepth, maxEntriesPerDir);
    }
    return fileNode(full, entry.name);
  });
  if (truncated) {
    node.truncated = true;
  }
  return node;
}

function fileNode(full: string, name: string): FsTreeNode {
  let size: number | undefined;
  try {
    size = fs.statSync(full).size;
  } catch {
    // Unreadable file — report it without a size rather than failing the
    // whole listing.
    size = undefined;
  }
  return { path: full, name, type: 'file', size };
}

function byName(a: fs.Dirent, b: fs.Dirent): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
