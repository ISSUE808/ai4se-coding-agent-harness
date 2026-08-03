import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createFsRouter } from '../../src/webui/api/fs.js';
import { createWebUIServer } from '../../src/webui/server.js';
import type { WebUIServer } from '../../src/webui/server.js';
import { InMemorySessionStore } from '../../src/webui/session-store.js';
import { createEventBus } from '../../src/events.js';
import { CredentialStore } from '../../src/credentials/store.js';
import { HITLManager } from '../../src/guardrail/hitl-manager.js';
import { DEFAULT_CONFIG } from '../../src/config/schema.js';
import type { Config } from '../../src/types.js';

/**
 * fs browsing endpoint tests (PLAN Task 23): GET /api/fs/tree enumerates a
 * directory tree under the authorized workspace roots. Fixtures are real temp
 * directories (deterministic, no mocks); boundary rejection and truncation
 * are asserted against the exact response shapes the client consumes.
 */

const openServers: WebUIServer[] = [];

afterEach(async () => {
  for (const web of openServers) {
    await web.close();
  }
  openServers.length = 0;
});

/** Create a temp workspace with a known nested structure, return its root. */
function makeTree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-fs-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"demo"}');
  fs.writeFileSync(path.join(root, 'README.md'), '# demo\n');
  fs.mkdirSync(path.join(root, 'src', 'auth'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(root, 'src', 'auth', 'token.ts'), 'export const t = 1;\n');
  return root;
}

/** An express app with the fs router bound to one temp root (unit-style). */
function routerApp(options?: { maxDepth?: number; maxEntriesPerDir?: number; maxNodes?: number }): {
  app: express.Express;
  root: string;
  other: string;
} {
  const root = makeTree();
  const other = makeTree();
  const app = express();
  app.use(
    '/api/fs',
    createFsRouter({
      getAllowedRoots: () => [root],
      maxDepth: options?.maxDepth,
      maxEntriesPerDir: options?.maxEntriesPerDir,
      maxNodes: options?.maxNodes,
    }),
  );
  return { app, root, other };
}

/**
 * Create a directory symlink (junction on Windows, dir link elsewhere).
 * Returns false when the platform forbids it (no privileges / dev mode).
 */
function tryCreateLink(target: string, linkPath: string): boolean {
  try {
    fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch {
    return false;
  }
}

/** Recursively count the nodes of a tree (global-budget assertions). */
function countNodes(node: { children?: unknown[] }): number {
  return 1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child as { children?: unknown[] }), 0);
}

/** Whether this machine can create directory links (computed once). */
const linkSupported = ((): boolean => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-link-'));
  try {
    const target = path.join(base, 'target');
    fs.mkdirSync(target);
    return tryCreateLink(target, path.join(base, 'link'));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
})();

/** Full WebUI server fixture (mounting + session-root inclusion). */
async function serverFixture(workspaceRoot: string): Promise<WebUIServer> {
  const config = structuredClone(DEFAULT_CONFIG) as Config;
  config.agent.workspaceRoot = workspaceRoot;
  const secrets = new Map<string, string>();
  const credentialStore = new CredentialStore([
    {
      name: 'memory',
      async isAvailable() {
        return true;
      },
      async save(_service, account, secret) {
        secrets.set(account, secret);
      },
      async read(_service, account) {
        return secrets.get(account) ?? null;
      },
      async delete(_service, account) {
        return secrets.delete(account);
      },
      async exists(_service, account) {
        return secrets.has(account);
      },
    },
  ]);
  const web = createWebUIServer({
    sessionStore: new InMemorySessionStore(),
    events: createEventBus(),
    credentialStore,
    config,
    hitl: new HITLManager(),
  });
  await web.listen(0);
  openServers.push(web);
  return web;
}

describe('GET /api/fs/tree', () => {
  it('returns the workspace tree: nested dirs, file types and file sizes', async () => {
    const { app, root } = routerApp();
    const res = await request(app).get('/api/fs/tree');

    expect(res.status).toBe(200);
    const tree = res.body;
    expect(tree.type).toBe('dir');
    expect(tree.name).toBe(path.basename(root));
    expect(tree.path).toBe(root);

    // Directories are sorted first, then files, alphabetically.
    const names = (tree.children as { name: string }[]).map((c) => c.name);
    expect(names).toEqual(['src', 'README.md', 'package.json']);

    const src = tree.children.find((c: { name: string }) => c.name === 'src');
    expect(src.type).toBe('dir');
    const srcNames = (src.children as { name: string }[]).map((c) => c.name);
    expect(srcNames).toEqual(['auth', 'index.ts']);

    const auth = src.children.find((c: { name: string }) => c.name === 'auth');
    expect(auth.children.map((c: { name: string }) => c.name)).toEqual(['token.ts']);

    const pkg = tree.children.find((c: { name: string }) => c.name === 'package.json');
    expect(pkg.type).toBe('file');
    expect(pkg.size).toBe(15);
    expect(pkg.children).toBeUndefined();
    expect(src.children.find((c: { name: string }) => c.name === 'index.ts').size).toBe(20);
  });

  it('defaults to the config workspaceRoot when path is omitted', async () => {
    const { app, root } = routerApp();
    const res = await request(app).get('/api/fs/tree');
    expect(res.status).toBe(200);
    expect(res.body.path).toBe(root);
  });

  it('enumerates any subdirectory under the allowed root via ?path=', async () => {
    const { app, root } = routerApp();
    const res = await request(app).get('/api/fs/tree').query({ path: path.join(root, 'src', 'auth') });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('auth');
    expect(res.body.children.map((c: { name: string }) => c.name)).toEqual(['token.ts']);
  });

  it('rejects out-of-bounds paths with 400', async () => {
    const { app, other } = routerApp();
    const res = await request(app).get('/api/fs/tree').query({ path: other });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/outside/i);
  });

  it('rejects paths escaping the allowed root via .. traversal with 400', async () => {
    const { app, root } = routerApp();
    const res = await request(app).get('/api/fs/tree').query({ path: path.join(root, '..') });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/outside/i);
  });

  it('rejects non-existent directories with 400', async () => {
    const { app, root } = routerApp();
    const res = await request(app).get('/api/fs/tree').query({ path: path.join(root, 'missing') });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not exist|no such/i);
  });

  it('rejects a plain file as the requested path with 400', async () => {
    const { app, root } = routerApp();
    const res = await request(app).get('/api/fs/tree').query({ path: path.join(root, 'package.json') });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a directory|file/i);
  });

  it('caps recursion depth: directories at the depth cap carry no children', async () => {
    const root = makeTree();
    // root/deep/a/b/c — 4 nested levels below the requested dir.
    fs.mkdirSync(path.join(root, 'deep', 'a', 'b', 'c'), { recursive: true });
    fs.writeFileSync(path.join(root, 'deep', 'a', 'b', 'c', 'leaf.txt'), 'x');
    const app = express();
    app.use('/api/fs', createFsRouter({ getAllowedRoots: () => [root], maxDepth: 3 }));

    const res = await request(app).get('/api/fs/tree').query({ path: path.join(root, 'deep') });
    expect(res.status).toBe(200);
    // deep (0) → a (1) → b (2) → c (3): c sits exactly at the cap, so its
    // entries are never enumerated (no children key).
    const a = res.body.children.find((n: { name: string }) => n.name === 'a');
    const b = a.children.find((n: { name: string }) => n.name === 'b');
    const c = b.children.find((n: { name: string }) => n.name === 'c');
    expect(c.name).toBe('c');
    expect(c.children).toBeUndefined();
  });

  it('truncates oversized directories and flags them truncated', async () => {
    const root = makeTree();
    const big = path.join(root, 'big');
    fs.mkdirSync(big);
    for (let i = 0; i < 250; i++) {
      fs.writeFileSync(path.join(big, `f${String(i).padStart(3, '0')}.txt`), 'x');
    }
    const app = express();
    app.use('/api/fs', createFsRouter({ getAllowedRoots: () => [root], maxEntriesPerDir: 20 }));

    const res = await request(app).get('/api/fs/tree');
    expect(res.status).toBe(200);
    const bigNode = res.body.children.find((n: { name: string }) => n.name === 'big');
    expect(bigNode.truncated).toBe(true);
    expect(bigNode.children).toHaveLength(20);
    // Sorted, so the kept entries are the alphabetically first 20.
    expect(bigNode.children[0].name).toBe('f000.txt');
    expect(bigNode.children[19].name).toBe('f019.txt');
    // Unaffected sibling dirs are not flagged.
    const srcNode = res.body.children.find((n: { name: string }) => n.name === 'src');
    expect(srcNode.truncated).toBeUndefined();
  });

  it('rejects paths that traverse a symlink/junction escaping the root (I1)', async () => {
    const { app, root, other } = routerApp();
    // root/link → other (a directory OUTSIDE the allowed root); `other/src`
    // is a real external directory — today this 200s with the external tree.
    const link = path.join(root, 'link');
    if (!tryCreateLink(other, link)) {
      return;
    }
    const res = await request(app).get('/api/fs/tree').query({ path: path.join(link, 'src') });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/outside/i);
  });

  it('rejects a final-segment symlink/junction pointing outside the root (I1)', async () => {
    const { app, root, other } = routerApp();
    const link = path.join(root, 'link');
    if (!tryCreateLink(other, link)) {
      return;
    }
    const res = await request(app).get('/api/fs/tree').query({ path: link });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/outside/i);
  });

  it('allows a symlink/junction pointing INSIDE the root (canonical target stays in bounds)', async () => {
    const { app, root } = routerApp();
    const link = path.join(root, 'link');
    if (!tryCreateLink(path.join(root, 'src'), link)) {
      return;
    }
    const res = await request(app).get('/api/fs/tree').query({ path: link });
    expect(res.status).toBe(200);
    expect(res.body.children.map((c: { name: string }) => c.name)).toContain('auth');
  });

  it('caps the total node count with a global budget (M7)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-fs-'));
    for (let i = 0; i < 60; i++) {
      fs.writeFileSync(path.join(root, `f${String(i).padStart(3, '0')}.txt`), 'x');
    }
    const app = express();
    app.use('/api/fs', createFsRouter({ getAllowedRoots: () => [root], maxNodes: 8 }));

    const res = await request(app).get('/api/fs/tree');
    expect(res.status).toBe(200);
    // root (1) + 7 children max; overflow is flagged truncated.
    expect(countNodes(res.body)).toBe(8);
    expect(res.body.truncated).toBe(true);
    expect(res.body.children).toHaveLength(7);
  });

  it('serves the tree for session workspaceRoots through the mounted server (Task 23)', async () => {
    const configRoot = makeTree();
    const sessionRoot = makeTree();
    const web = await serverFixture(configRoot);

    // A session bound to a root outside the config root must be browseable.
    const created = await request(web.app).post('/api/sessions').send({
      task: 'work in a side repo',
      workspaceRoot: sessionRoot,
    });
    expect(created.status).toBe(201);

    const res = await request(web.app).get('/api/fs/tree').query({ path: sessionRoot });
    expect(res.status).toBe(200);
    expect(res.body.path).toBe(sessionRoot);
    expect(res.body.children.map((c: { name: string }) => c.name)).toContain('src');

    // The config root itself is always browseable (with and without ?path=).
    const rootRes = await request(web.app).get('/api/fs/tree');
    expect(rootRes.status).toBe(200);
    expect(rootRes.body.path).toBe(configRoot);
  });
});
