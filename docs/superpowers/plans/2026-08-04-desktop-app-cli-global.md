# CodeHarness 分发：CLI 全局命令 + Electron 桌面应用 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户（1）在任意目录输入 `codeharness` 启动 CLI，（2）双击桌面应用打开独立窗口连接 WebUI——三层：生产模式静态服务 → npm link → Electron 壳。

**Architecture:** 第 1 层 server.ts 增加可注入 `staticDir`（express.static + SPA fallback，挂在 `/api` 404 兜底之后保证 API 不被劫持）；第 2 层 `npm link`（bin 已配置，零代码）；第 3 层新目录 `desktop/`（独立 package，主进程 = 探测端口 → spawn 后端 → 轮询就绪 → BrowserWindow → 关闭清理）。主进程纯逻辑与 electron 解耦（lifecycle.ts 注入依赖），vitest 单测不启动 Electron。

**Tech Stack:** express 4（静态服务）、npm link、Electron + electron-builder（主进程 CJS）、vitest。

## Global Constraints

- 凭据绝不进入代码/Git/日志/历史（keytar 原生模块打包进 resources，不进 asar——spec §5.4）
- TDD 红→绿强制；每个 task 完成后两阶段评审（spec 合规 + 代码质量）
- 测试必须 Mock 确定性（§A.4-C）——Electron 相关测试**不真实启动 Electron**（CI 不装 Electron）
- `desktop/` 是独立 package（electron 依赖不污染主项目）；主项目 `.gitignore` 增加 `desktop/build/`、`desktop/node_modules/`
- 静态目录解析**不得依赖 process.cwd()**（npm link 后 `codeharness` 在任意目录运行）——用 `import.meta.url` 解析项目根
- 主进程模块格式 CJS（Electron 主进程惯例，electron-builder 兼容性最稳）
- 开发模式（Vite 5173）行为不变
- Import 路径 NodeNext 模式（主项目相对 import 带 `.js`）；desktop 包内用相对 import（CJS 下 TS 自动补）

---

### Task 1: server 生产模式静态服务（staticDir 能力）

**Files:**
- Modify: `src/webui/server.ts`（WebUIServerDeps 加 `staticDir`；挂载静态服务 + SPA fallback）
- Test: `tests/integration/webui-static.test.ts`（新建）

**Interfaces:**
- Produces: `WebUIServerDeps.staticDir?: string`——存在时挂 express.static + SPA fallback；缺省保持 API-only（开发模式与既有测试不受影响）。

- [ ] **Step 1: 写失败测试**（新建 `tests/integration/webui-static.test.ts`，复用 webui-api.test.ts 的 fixture 模式——内存 CredentialBackend + InMemorySessionStore + 真实 event bus + supertest）

```ts
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { createWebUIServer } from '../../src/webui/server.js';
import type { WebUIServer } from '../../src/webui/server.js';
import { InMemorySessionStore } from '../../src/webui/session-store.js';
import { createEventBus } from '../../src/events.js';
import { CredentialStore } from '../../src/credentials/store.js';
import { HITLManager } from '../../src/guardrail/hitl-manager.js';
import { DEFAULT_CONFIG } from '../../src/config/schema.js';
import type { CredentialBackend } from '../../src/types.js';

/** 内存凭据后端（同 webui-api.test.ts 模式）——零 keychain、零网络。 */
function memoryBackend(): CredentialBackend {
  const secrets = new Map<string, string>();
  return {
    name: 'memory',
    async isAvailable() { return true; },
    async save(_service, account, secret) { secrets.set(account, secret); },
    async read(_service, account) { return secrets.get(account) ?? null; },
    async delete(_service, account) { return secrets.delete(account); },
    async exists(_service, account) { return secrets.has(account); },
    async list() { return [...secrets.keys()]; },
  };
}

const openServers: WebUIServer[] = [];
afterEach(async () => {
  for (const web of openServers) await web.close();
  openServers.length = 0;
});

/** 构造带 staticDir 的 WebUI server；fixture 临时目录模拟 vite build 产物。 */
async function makeStaticServer(staticDir: string): Promise<WebUIServer> {
  const web = createWebUIServer({
    sessionStore: new InMemorySessionStore(DEFAULT_CONFIG.agent.maxRounds, DEFAULT_CONFIG.agent.workspaceRoot),
    events: createEventBus(),
    credentialStore: new CredentialStore(memoryBackend()),
    config: DEFAULT_CONFIG,
    hitl: new HITLManager(),
    staticDir,
  });
  openServers.push(web);
  await web.listen(0);
  return web;
}

describe('WebUI 生产模式静态服务', () => {
  it('静态文件按 vite build 布局服务（/ → index.html，/assets/x.js → 内容）', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-webui-dist-'));
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>CodeHarness</title>');
    fs.mkdirSync(path.join(root, 'assets'));
    fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'console.log(1);');
    const web = await makeStaticServer(root);
    const home = await request(web.app).get('/');
    expect(home.status).toBe(200);
    expect(home.text).toContain('CodeHarness');
    const asset = await request(web.app).get('/assets/app.js');
    expect(asset.status).toBe(200);
    expect(asset.text).toBe('console.log(1);');
  });

  it('SPA fallback：非 API 的 GET 一律回 index.html（react-router 深链）', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-webui-dist-'));
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>SPA</title>');
    const web = await makeStaticServer(root);
    const res = await request(web.app).get('/sessions/abc-123');
    expect(res.status).toBe(200);
    expect(res.text).toContain('SPA');
  });

  it('/api 请求不被 SPA fallback 劫持（仍返回 JSON 404）', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-webui-dist-'));
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>SPA</title>');
    const web = await makeStaticServer(root);
    const res = await request(web.app).get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('staticDir 缺省时保持 API-only（GET / 不服务 HTML）', async () => {
    const web = createWebUIServer({
      sessionStore: new InMemorySessionStore(DEFAULT_CONFIG.agent.maxRounds, DEFAULT_CONFIG.agent.workspaceRoot),
      events: createEventBus(),
      credentialStore: new CredentialStore(memoryBackend()),
      config: DEFAULT_CONFIG,
      hitl: new HITLManager(),
    });
    openServers.push(web);
    await web.listen(0);
    const res = await request(web.app).get('/');
    // API-only：无静态服务 → express 默认 404（无 HTML）
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: 跑测试确认红**

```bash
npx vitest run tests/integration/webui-static.test.ts
```
Expected: FAIL（`staticDir` 不存在于 WebUIServerDeps 类型 / GET / 404）

- [ ] **Step 3: 实现**（`src/webui/server.ts`）

在 `WebUIServerDeps` 接口加字段：

```ts
  /**
   * 生产模式静态目录（vite build 产物，spec 2026-08-04 第 1 层）。存在时
   * 挂载 express.static + SPA fallback；缺省保持 API-only（开发模式走
   * Vite dev server，不受影响）。
   */
  staticDir?: string;
```

文件顶部 import 增加 `import * as path from 'node:path';`（检查现有 import——server.ts 目前只有 http/net/express/ws/types，无 path）。

在 `app.use('/api', (_req, res) => { res.status(404).json({ error: 'Not found' }); });` 之后、`app.use(jsonErrorHandler)` 之前插入：

```ts
  // 生产模式（spec 2026-08-04）：静态服务 + SPA fallback。API 路由与 `/api`
  // 404 兜底均在此前注册——`/api/*` 永不落入 fallback；未知静态路径由
  // sendFile 的 err 走 jsonErrorHandler。
  if (deps.staticDir !== undefined) {
    app.use(express.static(deps.staticDir));
    // react-router client 路由深链（/sessions/xxx 直接访问）需要回 index.html。
    app.get('*', (req, res, next) => {
      if (req.method !== 'GET') {
        next();
        return;
      }
      res.sendFile(path.join(deps.staticDir as string, 'index.html'), (err) => {
        if (err) {
          next(err);
        }
      });
    });
  }
```

- [ ] **Step 4: 跑测试确认绿**

```bash
npx vitest run tests/integration/webui-static.test.ts
```
Expected: 4 passed

- [ ] **Step 5: 全量回归 + 提交**

```bash
npx vitest run && npx tsc --noEmit
git add src/webui/server.ts tests/integration/webui-static.test.ts
git commit -m "feat: server 生产模式静态服务（staticDir + SPA fallback，API 不被劫持）— by subagent <id>"
```

---

### Task 2: `start --web` 生产模式接线 + dist 缺失报错 + npm link

**Files:**
- Modify: `src/cli/commands/start.ts`（CreateWebHarnessOptions 加 `staticDir`；createWebHarness 解析静态目录 + 缺失报错；`resolveStaticDir` 纯函数导出）
- Test: `tests/integration/webui-static.test.ts`（追加 harness 级 3 测试）
- Manual: `npm link` 验证

**Interfaces:**
- Consumes: `WebUIServerDeps.staticDir`（Task 1）
- Produces: `resolveStaticDir(staticDir?: string, env?: NodeJS.ProcessEnv, projectRoot?: string): string`——解析顺序：显式参数 → `CODEHARNESS_WEBUI_DIR` env → `<projectRoot>/src/webui/client/dist`；`createWebHarness` 校验目录存在，缺失抛带构建指引的错误。

- [ ] **Step 1: 写失败测试**（追加到 `tests/integration/webui-static.test.ts`）

```ts
import { createWebHarness } from '../../src/cli/commands/start.js';
import { resolveStaticDir } from '../../src/cli/commands/start.js';
import { MockProvider } from '../../src/llm/mock-provider.js';
import type { LLMProvider } from '../../src/types.js';

describe('start --web 生产模式接线', () => {
  it('resolveStaticDir：显式参数 > CODEHARNESS_WEBUI_DIR env > 项目默认路径', () => {
    const root = 'C:/fake/project';
    expect(resolveStaticDir(undefined, {}, root)).toBe(
      path.join('C:/fake/project', 'src', 'webui', 'client', 'dist'),
    );
    expect(resolveStaticDir(undefined, { CODEHARNESS_WEBUI_DIR: 'D:/packed/webui' }, root)).toBe(
      'D:/packed/webui',
    );
    expect(resolveStaticDir('E:/explicit', { CODEHARNESS_WEBUI_DIR: 'D:/packed/webui' }, root)).toBe(
      'E:/explicit',
    );
  });

  it('createWebHarness 用 staticDir 提供静态页面（GET / 返回 fixture index.html）', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-harness-dist-'));
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Harness WebUI</title>');
    const events = createEventBus();
    const harness = await createWebHarness({
      config: DEFAULT_CONFIG,
      events,
      credentialStore: new CredentialStore(memoryBackend()),
      // 本测试不创建会话——buildAgentLoop 不会被调用，抛错即可满足类型。
      buildAgentLoop: async () => { throw new Error('unused'); },
      staticDir: root,
    });
    try {
      const res = await request(harness.web.app).get('/');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Harness WebUI');
    } finally {
      await harness.close();
    }
  });

  it('staticDir 不存在 → createWebHarness 拒绝，错误含构建指引', async () => {
    const missing = path.join(os.tmpdir(), `ch-missing-${Date.now()}`);
    const events = createEventBus();
    await expect(
      createWebHarness({
        config: DEFAULT_CONFIG,
        events,
        credentialStore: new CredentialStore(memoryBackend()),
        buildAgentLoop: async () => {
          throw new Error('unused');
        },
        staticDir: missing,
      }),
    ).rejects.toThrow(/请先构建前端/);
  });
});
```

> 说明：`createWebHarness` 的 buildAgentLoop 仅在创建会话时才被调用（本测试不建会话）——`async () => { throw new Error('unused'); }` 满足类型且不会被触达。

- [ ] **Step 2: 跑测试确认红**

```bash
npx vitest run tests/integration/webui-static.test.ts
```
Expected: FAIL（`resolveStaticDir` 未导出 / createWebHarness 无 staticDir 选项）

- [ ] **Step 3: 实现**（`src/cli/commands/start.ts`）

CreateWebHarnessOptions 加字段（在 `persistConfig` 之后）：

```ts
  /**
   * 生产模式静态目录（vite build 产物）。解析顺序：显式参数 →
   * CODEHARNESS_WEBUI_DIR 环境变量 → 项目根 src/webui/client/dist。
   * 不依赖 process.cwd()（全局 codeharness 命令在任意目录运行）。
   */
  staticDir?: string;
```

文件顶部 import 增加（检查现有 import，start.ts 已有 fs/path/crypto 等）：

```ts
import { fileURLToPath } from 'node:url';
```

在 `createWebHarness` 之前加导出函数：

```ts
/**
 * 生产模式静态目录解析（spec 2026-08-04 第 1 层）：显式参数优先，其次
 * CODEHARNESS_WEBUI_DIR（Electron 打包布局用它指向 resources/backend/webui），
 * 缺省为项目根 src/webui/client/dist。projectRoot 由调用方解析（默认
 * import.meta.url 上溯），绝不依赖 process.cwd()。
 */
export function resolveStaticDir(
  staticDir: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..'),
): string {
  if (staticDir !== undefined && staticDir !== '') {
    return path.resolve(staticDir);
  }
  const envDir = env.CODEHARNESS_WEBUI_DIR;
  if (envDir !== undefined && envDir !== '') {
    return path.resolve(envDir);
  }
  return path.resolve(projectRoot, 'src', 'webui', 'client', 'dist');
}
```

> `import.meta.url` 上溯 4 层：`dist/cli/commands/start.js` → `dist/cli/commands` → `dist/cli` → `dist` → 根。开发与打包后布局一致（打包后根 = resources/backend，配合 env 覆盖）。

`createWebHarness` 内、`createWebUIServer` 调用之前：

```ts
  // 生产模式（spec 2026-08-04）：静态目录缺失 → 启动失败并给构建指引，
  // 避免用户打开 3000 看到裸 404 困惑。
  const staticDir = resolveStaticDir(opts.staticDir);
  if (!fs.existsSync(staticDir)) {
    throw new Error(
      `WebUI 前端构建产物不存在：${staticDir}。请先构建前端：npm run build && cd src/webui/client && npm run build`,
    );
  }
```

`createWebUIServer({ ... })` 的 deps 对象加 `staticDir,`（放在 `persistConfig,` 之后、`onConfigChanged` 之前）。

- [ ] **Step 4: 跑测试确认绿**

```bash
npx vitest run tests/integration/webui-static.test.ts
```
Expected: 3 passed（resolveStaticDir ×1 + harness 静态 ×1 + 缺失报错 ×1）+ Task 1 的 4 个不变

- [ ] **Step 5: 全量回归 + npm link 手动验证**

```bash
npx vitest run && npx tsc --noEmit
npm run build
npm link
cd ~ && codeharness --version          # 期望：0.1.0
codeharness start --web                # 期望：启动，浏览器 http://localhost:3000 完整 WebUI
# Ctrl+C 停止；确认 3000 无残留进程
```

- [ ] **Step 6: 提交**

```bash
git add src/cli/commands/start.ts tests/integration/webui-static.test.ts
git commit -m "feat: start --web 生产模式接线（resolveStaticDir + dist 缺失报错）+ npm link 全局命令 — by subagent <id>"
```

---

### Task 3: desktop/ 脚手架 + 主进程纯函数（TDD，不启动 Electron）

**Files:**
- Create: `desktop/package.json`、`desktop/tsconfig.json`
- Create: `desktop/src/lifecycle.ts`（纯函数：路径解析 / 命令构造 / 端口轮询 / 进程树清理）
- Create: `desktop/src/lifecycle.test.ts`
- Modify: `.gitignore`（根，追加 `desktop/build/`、`desktop/node_modules/`）

**Interfaces:**
- Produces（Task 4 消费，精确签名）：
  - `resolveBackendDir(options: { resourcesPath?: string; projectRoot: string }): string`——resourcesPath 存在（打包）→ `path.join(resourcesPath, 'backend')`；否则 projectRoot
  - `buildBackendCommand(backendDir: string): { cmd: string; args: string[]; env: Record<string, string>; cwd: string }`——`node <backendDir>/dist/cli/index.js start --web`，env `CODEHARNESS_WEBUI_DIR: path.join(backendDir, 'webui')`，cwd=backendDir
  - `waitForPort(url: string, timeoutMs: number, fetchFn?: typeof fetch): Promise<void>`——轮询 500ms，200 即 resolve；超时 reject（错误消息含 url）
  - `killProcessTree(pid: number, spawnFn?: (cmd: string, args: string[], opts?: unknown) => unknown): void`——win32 `taskkill /pid <pid> /T /F`（spawn 可注入，测试不真杀进程）

- [ ] **Step 1: 脚手架**

```bash
mkdir -p desktop/src
```

`desktop/package.json`：

```json
{
  "name": "codeharness-desktop",
  "version": "0.1.0",
  "private": true,
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "dev": "tsc && electron .",
    "dist": "npm run build && electron-builder"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`desktop/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

根 `.gitignore` 追加（不得从训练数据添加其他条目——项目基线约束）：

```
desktop/build/
desktop/node_modules/
```

```bash
cd desktop && npm install
```

- [ ] **Step 2: 写失败测试**（`desktop/src/lifecycle.test.ts`）

```ts
import { describe, it, expect, vi } from 'vitest';
import * as path from 'node:path';
import { resolveBackendDir, buildBackendCommand, waitForPort, killProcessTree } from './lifecycle.js';

describe('resolveBackendDir', () => {
  it('打包后：resourcesPath 下 backend 目录', () => {
    expect(resolveBackendDir({ resourcesPath: 'C:/app/resources', projectRoot: 'C:/dev/codeharness' }))
      .toBe('C:/app/resources/backend');
  });
  it('开发：projectRoot', () => {
    expect(resolveBackendDir({ projectRoot: 'C:/dev/codeharness' }))
      .toBe('C:/dev/codeharness');
  });
});

describe('buildBackendCommand', () => {
  it('node 启动后端 + 生产模式 env（CODEHARNESS_WEBUI_DIR 指向 webui/）', () => {
    const cmd = buildBackendCommand('C:/app/backend');
    expect(cmd.cmd).toBe('node');
    expect(cmd.args).toEqual(['C:/app/backend/dist/cli/index.js', 'start', '--web']);
    expect(cmd.env.CODEHARNESS_WEBUI_DIR).toBe('C:/app/backend/webui');
    expect(cmd.cwd).toBe('C:/app/backend');
  });
});

describe('waitForPort', () => {
  it('端口就绪（fetch 返回 200）即 resolve', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true } as Response));
    await expect(waitForPort('http://localhost:3000/api/sessions/', 2000, fetchFn as unknown as typeof fetch))
      .resolves.toBeUndefined();
    expect(fetchFn).toHaveBeenCalled();
  });
  it('超时未就绪 → reject（消息含 url）', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    await expect(waitForPort('http://localhost:3000/api/sessions/', 300, fetchFn as unknown as typeof fetch))
      .rejects.toThrow(/localhost:3000/);
  });
});

describe('killProcessTree', () => {
  it('win32 用 taskkill /T /F 杀进程树', () => {
    const spawnFn = vi.fn();
    killProcessTree(1234, spawnFn);
    expect(spawnFn).toHaveBeenCalledWith('taskkill', ['/pid', '1234', '/T', '/F']);
  });
});
```

- [ ] **Step 3: 跑测试确认红**

```bash
cd desktop && npx vitest run
```
Expected: FAIL（lifecycle.js 不存在 / 函数未定义）

- [ ] **Step 4: 实现**（`desktop/src/lifecycle.ts`）

```ts
/**
 * Electron 主进程的纯逻辑（spec 2026-08-04 第 3 层）——与 electron 完全解耦，
 * vitest 单测不启动 Electron。Electron 接线见 main.ts（Task 4）。
 */
import * as path from 'node:path';

/** 后端目录解析：打包后 resourcesPath/backend；开发时项目根。 */
export function resolveBackendDir(options: {
  resourcesPath?: string;
  projectRoot: string;
}): string {
  if (options.resourcesPath !== undefined) {
    return path.join(options.resourcesPath, 'backend');
  }
  return options.projectRoot;
}

/** 后端 spawn 命令：生产模式（静态目录由 env 指向打包布局 webui/）。 */
export function buildBackendCommand(backendDir: string): {
  cmd: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
} {
  return {
    cmd: 'node',
    args: [path.join(backendDir, 'dist', 'cli', 'index.js'), 'start', '--web'],
    env: { CODEHARNESS_WEBUI_DIR: path.join(backendDir, 'webui') },
    cwd: backendDir,
  };
}

/** 轮询端口就绪（500ms 间隔）；fetch 注入便于测试。超时 reject 含 url。 */
export async function waitForPort(
  url: string,
  timeoutMs: number,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = new Error('no probe');
  while (Date.now() < deadline) {
    try {
      const res = await fetchFn(url);
      if (res.ok) {
        return;
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`后端未在 ${timeoutMs}ms 内就绪：${url}（${String(lastError)}）`);
}

/** 杀进程树：win32 taskkill /T（含子进程）/F（强制）。spawnFn 注入测试。 */
export function killProcessTree(
  pid: number,
  spawnFn: (cmd: string, args: string[], opts?: { stdio: string }) => unknown = (cmd, args, opts) => {
    // 默认用 child_process.spawn 的异步调用——同步 import 会与 vitest mock 冲突，
    // 延迟 require 只在默认路径触发。
    const cp = require('node:child_process') as typeof import('node:child_process');
    cp.spawn(cmd, args, { stdio: 'ignore' } as never);
    return undefined;
  },
): void {
  spawnFn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
}
```

> 说明：`require('node:child_process')` 延迟加载是为了让测试注入 spawnFn 时完全不触碰真实模块（vitest 下 require 可用——desktop 是 CJS）。如评审认为 `import { spawn } from 'node:child_process'` 顶层导入更干净且不影响注入（spawnFn 有默认值时顶层 import 不执行），可在评审阶段统一为顶层 import + 默认参数直接引用。

- [ ] **Step 5: 跑测试确认绿**

```bash
cd desktop && npx vitest run && npx tsc --noEmit
```
Expected: 6 passed；tsc 无输出

- [ ] **Step 6: 提交**

```bash
git add desktop .gitignore
git commit -m "feat: desktop 脚手架 + 主进程纯函数（路径/命令/端口轮询/进程树清理）— by subagent <id>"
```

---

### Task 4: Electron 主进程生命周期接线（TDD，electron 模块注入）

**Files:**
- Create: `desktop/src/lifecycle.ts`（追加 `runDesktopLifecycle`）
- Create: `desktop/src/main.ts`（electron 接线薄层——唯一 import electron 的文件）
- Create: `desktop/src/main.test.ts`（或并入 lifecycle.test.ts——追加 runDesktopLifecycle 测试）

**Interfaces:**
- Consumes: Task 3 的 `resolveBackendDir` / `buildBackendCommand` / `waitForPort` / `killProcessTree`
- Produces: `runDesktopLifecycle(deps: DesktopLifecycleDeps): { close: () => void }`——deps 注入 { projectRoot, resourcesPath?, createWindow(url), spawnBackend(cmd), waitForPortFn?, fetchFn? }；行为：探测 3000（waitForPort 1s 短探）→ 就绪直接开窗 / 未就绪 spawn 后端 → waitForPort 30s → 开窗；失败 → showError(deps.showError)；窗口关闭 → killProcessTree(backendPid) + 退出回调。main.ts 组装真实 electron（app.whenReady → BrowserWindow 工厂 → runDesktopLifecycle）。

- [ ] **Step 1: 写失败测试**（追加 `desktop/src/lifecycle.test.ts`）

```ts
import { runDesktopLifecycle } from './lifecycle.js';

describe('runDesktopLifecycle', () => {
  it('端口已就绪 → 直接开窗，不 spawn 后端', async () => {
    const createWindow = vi.fn();
    const spawnBackend = vi.fn();
    const deps = {
      projectRoot: 'C:/dev/codeharness',
      createWindow,
      spawnBackend,
      waitForPort: async () => undefined,
      killProcessTree: vi.fn(),
      showError: vi.fn(),
      onExit: vi.fn(),
    };
    await runDesktopLifecycle(deps);
    expect(createWindow).toHaveBeenCalledWith('http://localhost:3000');
    expect(spawnBackend).not.toHaveBeenCalled();
  });

  it('端口未就绪 → spawn 后端 → 就绪后开窗；错误时 showError 不开窗', async () => {
    const createWindow = vi.fn();
    const spawnBackend = vi.fn(() => 999); // 返回 pid
    const waitForPort = vi.fn()
      .mockResolvedValueOnce(undefined)   // 首次短探：未就绪（先抛错再断言？）
      ;
    // 用序列：第一次调用 reject（探测失败 → spawn），第二次 resolve（后端就绪）
    waitForPort
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValueOnce(undefined);
    const killProcessTree = vi.fn();
    const deps = {
      projectRoot: 'C:/dev/codeharness',
      createWindow,
      spawnBackend,
      waitForPort,
      killProcessTree,
      showError: vi.fn(),
      onExit: vi.fn(),
    };
    const lifecycle = await runDesktopLifecycle(deps);
    expect(spawnBackend).toHaveBeenCalledTimes(1);
    expect(createWindow).toHaveBeenCalledWith('http://localhost:3000');
    expect(waitForPort).toHaveBeenCalledTimes(2);
    // 窗口关闭 → 杀后端进程树
    lifecycle.close();
    expect(killProcessTree).toHaveBeenCalledWith(999);
    expect(deps.onExit).toHaveBeenCalled();
  });

  it('后端启动失败（等待超时）→ showError 且不开窗', async () => {
    const createWindow = vi.fn();
    const spawnBackend = vi.fn(() => 999);
    const waitForPort = vi.fn().mockRejectedValue(new Error('timeout'));
    const showError = vi.fn();
    const deps = {
      projectRoot: 'C:/dev/codeharness',
      createWindow,
      spawnBackend,
      waitForPort,
      killProcessTree: vi.fn(),
      showError,
      onExit: vi.fn(),
    };
    await runDesktopLifecycle(deps);
    expect(createWindow).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalled();
    expect(showError.mock.calls[0][0]).toContain('timeout');
  });
});
```

- [ ] **Step 2: 跑测试确认红**

```bash
cd desktop && npx vitest run
```
Expected: FAIL（runDesktopLifecycle 未定义）

- [ ] **Step 3: 实现**（`desktop/src/lifecycle.ts` 追加）

```ts
export interface DesktopLifecycleDeps {
  projectRoot: string;
  resourcesPath?: string;
  /** 打开主窗口（url 就绪后调用）。返回可被 close 的窗口句柄（可为 undefined）。 */
  createWindow: (url: string) => void;
  /** spawn 后端进程，返回 pid 或 null（spawn 失败）。 */
  spawnBackend: (cmd: { cmd: string; args: string[]; env: Record<string, string>; cwd: string }) => number | null;
  /** 端口探测（默认 waitForPort）；测试注入序列。 */
  waitForPort?: (url: string, timeoutMs: number) => Promise<void>;
  /** 杀进程树（默认 killProcessTree）。 */
  killProcessTree?: (pid: number) => void;
  /** 后端启动失败/崩溃时显示错误（窗口内错误页）。 */
  showError: (message: string) => void;
  /** 后端被主动关闭时回调（退出流程）。 */
  onExit?: () => void;
}

export interface DesktopLifecycle {
  /** 关闭：杀后端进程树 + onExit。窗口关闭事件接线到它。 */
  close: () => void;
}

const BACKEND_URL = 'http://localhost:3000';
const PROBE_TIMEOUT_MS = 1500;
const START_TIMEOUT_MS = 30000;

/**
 * 主进程生命周期（spec 2026-08-04 §5.2）：
 * 1. 短探 :3000——已就绪（既有实例）→ 直接开窗，不重复 spawn
 * 2. 未就绪 → spawn 后端（生产模式）→ 轮询就绪（30s）→ 开窗
 * 3. 等待超时 → showError（错误页），不开窗
 * 4. close() → 杀后端进程树 + onExit
 */
export async function runDesktopLifecycle(deps: DesktopLifecycleDeps): Promise<DesktopLifecycle> {
  const waitFor = deps.waitForPort ?? ((url: string, timeoutMs: number) => waitForPort(url, timeoutMs));
  const kill = deps.killProcessTree ?? killProcessTree;
  let backendPid: number | null = null;

  let ready = false;
  try {
    await waitFor(`${BACKEND_URL}/api/sessions/`, PROBE_TIMEOUT_MS);
    ready = true;
  } catch {
    // 未就绪 → 启动后端
  }

  if (!ready) {
    const backendDir = resolveBackendDir({ resourcesPath: deps.resourcesPath, projectRoot: deps.projectRoot });
    const cmd = buildBackendCommand(backendDir);
    backendPid = deps.spawnBackend(cmd);
    try {
      await waitFor(`${BACKEND_URL}/api/sessions/`, START_TIMEOUT_MS);
      ready = true;
    } catch (err) {
      deps.showError(`后端启动失败：${err instanceof Error ? err.message : String(err)}`);
      return { close: () => { /* 后端从未就绪，无进程可杀 */ } };
    }
  }

  if (ready) {
    deps.createWindow(BACKEND_URL);
  }

  return {
    close: () => {
      if (backendPid !== null) {
        kill(backendPid);
      }
      deps.onExit?.();
    },
  };
}
```

- [ ] **Step 4: 跑测试确认绿**

```bash
cd desktop && npx vitest run && npx tsc --noEmit
```
Expected: 9 passed（3 + 6）

- [ ] **Step 5: 实现 electron 接线薄层**（`desktop/src/main.ts`——唯一 import electron 的文件，CI 不编译测试）

```ts
/**
 * Electron 主进程入口（spec 2026-08-04 第 3 层）：组装真实 electron 依赖，
 * 全部逻辑在 lifecycle.ts（纯函数，已单测）。此文件仅接线。
 */
import { app, BrowserWindow, dialog } from 'electron';
import * as path from 'node:path';
import { runDesktopLifecycle } from './lifecycle.js';

function createWindow(url: string): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'CodeHarness',
    autoHideMenuBar: true,
  });
  void win.loadURL(url);
  return;
}

app.whenReady().then(async () => {
  // 打包后 process.resourcesPath 存在；开发时用项目根（desktop 的上级）。
  const projectRoot = path.resolve(__dirname, '..', '..');
  const lifecycle = await runDesktopLifecycle({
    projectRoot,
    resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
    createWindow,
    spawnBackend: (cmd) => {
      const { spawn } = require('node:child_process') as typeof import('node:child_process');
      const child = spawn(cmd.cmd, cmd.args, { env: { ...process.env, ...cmd.env }, cwd: cmd.cwd, stdio: 'inherit' });
      child.on('error', () => {
        /* spawn 失败：端口轮询超时后错误页会兜底 */
      });
      child.on('exit', (code) => {
        // 后端自行退出（崩溃）→ 主窗口显示提示
        if (code !== null && code !== 0) {
          // 非主动 kill 的退出：简单提示（生命周期 close 已杀进程，正常退出码 0 静默）
          dialog.showErrorBox('CodeHarness', `后端已退出（code ${code}）`);
        }
      });
      return child.pid ?? null;
    },
    showError: (message) => {
      dialog.showErrorBox('CodeHarness 启动失败', message);
    },
  });

  // 窗口全部关闭 → 杀后端 + 退出应用
  app.on('window-all-closed', () => {
    lifecycle.close();
    app.quit();
  });
});
```

- [ ] **Step 6: 提交**

```bash
git add desktop/src
git commit -m "feat: Electron 主进程生命周期（探测→spawn→轮询→开窗→清理，纯函数 TDD）+ main 接线 — by subagent <id>"
```

---

### Task 5: electron-builder 打包 + 手动验收

**Files:**
- Modify: `desktop/package.json`（build 字段：extraResources 布局 + win targets）
- Create: `desktop/prepare-resources.mjs`（组装打包用后端三件套）
- Modify: `TESTING.md`（新增「桌面应用验收」小节）

**Interfaces:**
- Consumes: Task 4 的 main.ts（`app.isPackaged ? process.resourcesPath` 分支已就位）

- [ ] **Step 1: desktop/package.json 加 build 字段**

```json
  "build": {
    "appId": "com.codeharness.desktop",
    "productName": "CodeHarness",
    "files": ["dist/**"],
    "extraResources": [
      { "from": "backend-pack", "to": "backend" }
    ],
    "win": { "target": ["nsis", "portable"] },
    "nsis": { "oneClick": false, "allowToChangeInstallationDirectory": true }
  }
```

> `portable` = 免安装单 exe（分发首选）；`nsis` = 安装程序（可选）。两者都满足 spec §5.4「便携 + 安装程序」。

- [ ] **Step 2: prepare-resources.mjs（组装 backend-pack）**

```js
// 打包前组装：把构建后的后端三件套复制到 desktop/backend-pack/
// （dist/ + node_modules/ + client 产物 webui/）——electron-builder
// 的 extraResources 会把 backend-pack → resources/backend。
// keytar 原生模块必须走 resources（不进 asar），此布局天然满足。
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packDir = resolve(dirname(fileURLToPath(import.meta.url)), 'backend-pack');
const webuiDir = resolve(root, 'src', 'webui', 'client', 'dist');

for (const p of [resolve(root, 'dist'), resolve(root, 'node_modules'), webuiDir]) {
  if (!existsSync(p)) {
    console.error(`缺失：${p}——请先 npm run build 与 cd src/webui/client && npm run build`);
    process.exit(1);
  }
}
rmSync(packDir, { recursive: true, force: true });
mkdirSync(packDir, { recursive: true });
cpSync(resolve(root, 'dist'), resolve(packDir, 'dist'), { recursive: true });
cpSync(resolve(root, 'node_modules'), resolve(packDir, 'node_modules'), { recursive: true });
cpSync(webuiDir, resolve(packDir, 'webui'), { recursive: true });
console.log(`backend-pack 就绪：${packDir}`);
```

desktop/package.json scripts 更新：

```json
    "dist": "node prepare-resources.mjs && npm run build && electron-builder"
```

- [ ] **Step 3: 打包并验收**（手动——本机验证）

```bash
cd <项目根> && npm run build && cd src/webui/client && npm run build
cd desktop && npm install && npm run dist
# 产物：desktop/dist/CodeHarness Setup 0.1.0.exe（NSIS）+ CodeHarness 0.1.0.exe（portable）
```

本机验收清单（写进 TESTING.md，同下节）逐项过。

- [ ] **Step 4: TESTING.md 新增验收小节**（追加到「C. 快速核对表」之前）

```markdown
### B11. 桌面应用 + CLI 全局命令（分发）

| | |
|---|---|
| 操作 1 | 终端 `codeharness --version`（任意目录）；`codeharness start --web` → 浏览器 http://localhost:3000 完整 WebUI |
| 操作 2 | 双击打包产物（portable exe）→ 独立窗口自动加载 WebUI（无需先启动任何东西） |
| 预期 | ① `codeharness` 全局可用（版本号输出）② 浏览器 3000 完整 WebUI（静态页面 + API 并存）③ 桌面窗口 1-2 秒内加载 WebUI ④ 关闭窗口 → 任务管理器无残留 node 进程 ⑤ 已开着后端时再启动桌面应用 → 直接连上不重复 spawn ⑥ 人为占用 3000（起一个假服务）→ 桌面应用显示错误对话框而非白屏 |
| 失败定位 | `tests/integration/webui-static.test.ts`（静态服务）+ `desktop/src/lifecycle.test.ts`（生命周期纯函数） |
```

- [ ] **Step 5: 提交**

```bash
git add desktop/package.json desktop/prepare-resources.mjs TESTING.md
git commit -m "feat: electron-builder 打包配置 + 资源组装脚本 + TESTING 桌面验收小节 — by subagent <id>"
```

---

### Task 6: README（Task 22 顺带落地）

**Files:**
- Create: `README.md`（项目根）

- [ ] **Step 1: 写 README**（依据 SPEC.md 与 PLAN.md 已有内容；含新增分发方式）

```markdown
# CodeHarness

从零构建的 AI 编码智能体运行框架（Coding Agent Harness）。核心命题：**Agent = LLM + Harness**——治理、反馈、工具、记忆全部由代码而非提示词实现。

## 安装

```bash
npm run build
npm link          # 全局 codeharness 命令（任意目录可用）
```

### 桌面应用（可选）

```bash
cd desktop && npm install && npm run dist
# 产物：desktop/dist/CodeHarness*.exe（portable 免安装 / NSIS 安装程序）
```

## 快速开始

```bash
codeharness key update           # 配置 API 密钥（keytar 安全存储）
codeharness start "任务描述"      # CLI 单次任务
codeharness                       # 交互式 REPL
codeharness start --web           # WebUI（浏览器 http://localhost:3000）
```

## WebUI 说明

- 开发模式：`node dist/cli/index.js start --web`（后端 :3000）+ `cd src/webui/client && npm run dev`（Vite :5173，代理 /api 与 /ws）
- 生产模式：`codeharness start --web` 单命令（server 服务构建后的前端）
- 密钥只经 `/api/keys` 链路，config 拒绝明文密钥字段

## 目录结构

（简述 src/ 主要模块：cli、core、tools、feedback、guardrail、memory、credentials、webui）

## 安全边界

- 工作区外操作需 HITL 人工确认（symlink 逃逸在 canonical 层拦截）
- 凭据不入代码/Git/日志/历史

## 已知限制

（指向 KNOWN_ISSUES.md）
```

> 目录结构与已知限制部分从 SPEC.md/PLAN.md/KNOWN_ISSUES.md 提取现有描述填充，不新造内容。

- [ ] **Step 2: 检查并提交**

```bash
git add README.md
git commit -m "docs: README — 安装（npm link / 桌面应用）、快速开始、WebUI 说明 — by subagent <id>"
```

---

## 自审记录

- **Spec 覆盖**：§3.1 staticDir + SPA fallback + env 覆盖 → Task 1/2；§3.2 dist 缺失报错 → Task 2；§3.3 四项测试 → Task 1/2；§4 npm link → Task 2；§5.2 生命周期（探测/spawn/轮询/清理/复用）→ Task 4；§5.3 错误处理表 → Task 4；§5.4 打包布局（extraResources + keytar 出 asar）→ Task 5；§5.5 手动清单 → Task 5；§6 测试总览 → 各任务；§7 交付顺序 → 任务顺序。
- **类型一致性**：`resolveStaticDir`（Task 2）与 `resolveBackendDir`（Task 3，名字不同但职责域不同——CLI 侧 vs Electron 侧，无冲突）；`buildBackendCommand` 返回 `{cmd,args,env,cwd}` 与 Task 4 的 `spawnBackend(cmd)` 消费签名一致；`waitForPort(url, timeoutMs, fetchFn?)` Task 3 定义、Task 4 默认引用（包装成 2 参版本 `(url, timeoutMs)` 注入测试）。
- **已知注意**：`killProcessTree` 的默认 spawnFn 用延迟 `require('node:child_process')` 避免测试路径触碰真实模块——若评审建议顶层 import，需同步更新测试（注入仍走参数，顶层 import 不执行时无碍）。
