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
 * Boundary enforcement (CR I1): both the request path and every root are
 * canonicalized with `fs.realpathSync` before the prefix check. This resolves
 * EVERY symlink/junction component — middle ones and the final one — so a
 * link that escapes the workspace surfaces as a canonical path outside the
 * canonical roots and is rejected, even when the lexical form sits inside
 * (a junction `root/link → outside` used to enumerate outside directories).
 * Links pointing INSIDE a root stay browseable (their canonical target is in
 * bounds). On Windows the prefix comparison lowercases both sides (M6).
 *
 * Guards:
 * - maxDepth (default 4): directories at the depth cap carry no `children`.
 * - maxEntriesPerDir (default 200): oversized directories are truncated and
 *   flagged with `truncated: true`.
 * - maxNodes (default 5000): global node budget across the whole response;
 *   overflow truncates the level where it would be exceeded and is flagged.
 * - Symlinked entries inside a directory are never listed and never recursed
 *   into (they could point anywhere; the boundary is enforced at the request
 *   path, and listing links would leak target names).
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
  /** True when this directory was truncated (per-level cap or global budget). */
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
  /** Global node budget for the whole response tree (M7). */
  maxNodes?: number;
}

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_ENTRIES_PER_DIR = 200;
const DEFAULT_MAX_NODES = 5000;

/** Canonical prefix check (CR I1: inputs must already be realpath'd forms;
 *  win32 paths are compared case-insensitively — M6). */
function isInside(canonicalPath: string, canonicalRoot: string): boolean {
  const p = process.platform === 'win32' ? canonicalPath.toLowerCase() : canonicalPath;
  const r = process.platform === 'win32' ? canonicalRoot.toLowerCase() : canonicalRoot;
  if (p === r) {
    return true;
  }
  return p.startsWith(r + path.sep);
}

/** Resolve a path to its canonical (real) form, or null when it is missing
 *  or unreadable. realpathSync resolves every symlink/junction component. */
function tryRealpath(target: string): string | null {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

export function createFsRouter(deps: FsRouterDeps): Router {
  const maxDepth = deps.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxEntriesPerDir = deps.maxEntriesPerDir ?? DEFAULT_MAX_ENTRIES_PER_DIR;
  const maxNodes = deps.maxNodes ?? DEFAULT_MAX_NODES;
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
    // Canonicalize every root once per request; a root that cannot be
    // resolved simply falls out of the boundary (enumeration would fail
    // anyway when a requested path under it is canonicalized).
    const canonicalRoots = roots.map((root) => tryRealpath(root) ?? root);

    // No path → the first allowed root (server.ts wires config
    // agent.workspaceRoot first, so this is the default workspace).
    const target = rawPath !== undefined && rawPath.trim() !== ''
      ? path.resolve(rawPath)
      : roots[0];

    // Canonicalize the request path: every symlink/junction component
    // (middle or final) is resolved, so an escaping link lands outside the
    // canonical roots and is rejected (I1). Missing paths throw → 400.
    const canonicalTarget = tryRealpath(target);
    if (canonicalTarget === null) {
      res.status(400).json({ error: `directory does not exist or is not readable: ${target}` });
      return;
    }

    if (!canonicalRoots.some((root) => isInside(canonicalTarget, root))) {
      res.status(400).json({ error: `path is outside the allowed workspace roots: ${target}` });
      return;
    }

    // The canonical target has no link components left — a plain stat check
    // decides dir vs file.
    let stat: fs.Stats;
    try {
      stat = fs.statSync(canonicalTarget);
    } catch {
      res.status(400).json({ error: `directory does not exist or is not readable: ${target}` });
      return;
    }
    if (!stat.isDirectory()) {
      res.status(400).json({ error: `path is not a directory: ${target}` });
      return;
    }

    let tree: FsTreeNode;
    try {
      const state: BuildState = { count: 0, budget: maxNodes };
      tree = buildNode(canonicalTarget, 0, maxDepth, maxEntriesPerDir, state);
    } catch {
      res.status(400).json({ error: `directory is not readable: ${target}` });
      return;
    }
    res.json(tree);
  });

  /**
   * Directory picker browsing — intentionally UNRESTRICTED (user decision,
   * Task 23 review follow-up): the picker must let the user select ANY
   * directory on the machine as a future session workspace root. Unlike
   * `/tree` (authorized roots only), `/browse` lists metadata only — entry
   * names/types/sizes, never file contents. The exposure equals a local
   * `ls`; the supervision model (choosing a dir authorizes it as a session
   * root) is the real control. Documented limitation in KNOWN_ISSUES.
   */
  router.get('/browse', (req, res) => {
    const rawPath = req.query.path;
    if (rawPath !== undefined && typeof rawPath !== 'string') {
      res.status(400).json({ error: 'path must be a single string' });
      return;
    }
    // No path → machine roots (Windows drive letters / POSIX `/`).
    if (rawPath === undefined || rawPath.trim() === '') {
      res.json({ roots: machineRoots() });
      return;
    }
    const target = path.resolve(rawPath);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(target);
    } catch {
      res.status(400).json({ error: `directory does not exist or is not readable: ${target}` });
      return;
    }
    if (!stat.isDirectory()) {
      res.status(400).json({ error: `not a directory: ${target}` });
      return;
    }

    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(target, { withFileTypes: true });
    } catch {
      res.status(400).json({ error: `directory is not readable: ${target}` });
      return;
    }
    // Partition into dirs / files / links, sort with the same comparator as
    // /tree (dirs first, then alphabetical), and only then apply the entry
    // cap — so the kept entries are the alphabetically-first ones, not
    // whatever order readdir happened to return (ext4/APFS order is
    // arbitrary). Sockets/devices are omitted, same as /tree. Links are
    // kept (marked `link`) — the picker must show them; it never follows.
    const dirs: fs.Dirent[] = [];
    const files: fs.Dirent[] = [];
    const links: fs.Dirent[] = [];
    for (const entry of dirents) {
      if (entry.isSymbolicLink()) {
        links.push(entry);
      } else if (entry.isDirectory()) {
        dirs.push(entry);
      } else if (entry.isFile()) {
        files.push(entry);
      }
    }
    dirs.sort(byName);
    files.sort(byName);
    links.sort(byName);

    const all = [...dirs, ...files, ...links];
    const truncated = all.length > maxEntriesPerDir;
    const kept = truncated ? all.slice(0, maxEntriesPerDir) : all;

    // Only kept entries are stat'd — no lstat for sliced-away entries.
    const entries: Array<{ path: string; name: string; type: 'dir' | 'file' | 'link'; size?: number }> = [];
    for (const entry of kept) {
      const full = path.join(target, entry.name);
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        entries.push({
          path: full,
          name: entry.name,
          type: entry.isSymbolicLink() ? 'link' : 'dir',
        });
        continue;
      }
      let size: number | undefined;
      try {
        size = fs.statSync(full).size;
      } catch {
        size = undefined; // unreadable file — report it without a size
      }
      entries.push({ path: full, name: entry.name, type: 'file', size });
    }

    res.json({ path: target, parent: path.dirname(target), entries, truncated });
  });

  return router;
}

/** Machine roots for the picker: drive letters on Windows, `/` elsewhere. */
function machineRoots(): string[] {
  if (process.platform !== 'win32') {
    return ['/'];
  }
  const drives: string[] = [];
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    try {
      if (fs.existsSync(`${letter}:\\`)) {
        drives.push(`${letter}:\\`);
      }
    } catch {
      // unreadable drive — skip
    }
  }
  return drives;
}

/** Mutable recursion state for the global node budget (M7). */
interface BuildState {
  /** Nodes created so far (dirs counted at entry, files when listed). */
  count: number;
  /** Absolute maximum number of nodes in the response. */
  budget: number;
}

/** Enumerate `dir` into an FsTreeNode; entries at `depth >= maxDepth` are
 *  not enumerated (no `children` key). Honors the per-level entry cap and
 *  the global node budget; either overflow flags the node `truncated`. */
function buildNode(
  dir: string,
  depth: number,
  maxDepth: number,
  maxEntriesPerDir: number,
  state: BuildState,
): FsTreeNode {
  state.count += 1;
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
    // Symlinks are skipped entirely: never listed, never recursed into.
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
  const perLevelCap = all.length > maxEntriesPerDir;
  let kept = perLevelCap ? all.slice(0, maxEntriesPerDir) : all;

  // Global budget: keep only what fits below the cap; when the budget runs
  // out mid-level, `kept` becomes empty and recursion stops entirely.
  const headroom = Math.max(0, state.budget - state.count);
  const budgetCap = kept.length > headroom;
  if (budgetCap) {
    kept = kept.slice(0, headroom);
  }

  node.children = kept.map((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return buildNode(full, depth + 1, maxDepth, maxEntriesPerDir, state);
    }
    state.count += 1;
    return fileNode(full, entry.name);
  });
  if (perLevelCap || budgetCap) {
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
