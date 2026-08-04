# CodeHarness 分发：CLI 全局命令 + Electron 桌面应用 — 设计规格

> 日期：2026-08-04
> 来源：用户需求（真实使用反馈）——「像 Claude Code 一样输入产品名就能启动 CLI」+「桌面应用打开就连接 WebUI」。
> 现状：CLI 需 `node dist/cli/index.js` 手工启动；WebUI 是双进程开发模式（后端 API-only :3000 + Vite dev server :5173）。

---

## 1. 目标与范围

| 目标 | 交付物 | 判定标准 |
|------|--------|----------|
| 终端输入产品名即启动 CLI | `npm link` 后全局 `codeharness` 命令 | `codeharness --version`、`codeharness start "任务"` 在任意目录可用 |
| 桌面应用打开即连 WebUI | Electron 应用（便携目录 + 安装程序） | 双击打开独立窗口 → 自动加载 WebUI；对方 Windows 机器**无需安装 Node** |
| 单命令启动 WebUI | `start --web` 生产模式（server 服务静态文件） | 浏览器打开 http://localhost:3000 即完整 WebUI |

**范围外（YAGNI）**：不发布 npm 公共包（npm link 满足本机与演示）；不做自动更新；不做 Docker（Task 21 的 Dockerfile 属原计划，本次不含）；不改开发模式（Vite 5173 流程不变）。

**用户决策记录**：
- 桌面应用用途：自己日常 + 课程演示 → **免 Node 依赖打包**（硬性约束）
- CLI 交付：npm link（本机），不 publish
- 桌面技术：**Electron**（与项目 100% 同构；Tauri 需 Rust 工具链 + Node sidecar 复杂度不值；轻量启动器无独立窗口）

---

## 2. 分层架构

```
第 3 层  Electron 桌面壳（新目录 desktop/）
        双击打开 → 独立窗口 → 自动连上 WebUI
第 2 层  CLI 全局命令（npm link，零代码改动）
        终端输入 codeharness 即启动
第 1 层  生产模式（server.ts 补静态服务）
        start --web 单命令 → 浏览器直接可用
```

三层按依赖顺序独立交付、独立验证。第 1 层是底座（Electron 与浏览器模式共用）。

---

## 3. 第 1 层：生产模式（server 静态服务）

### 3.1 改动

`src/webui/server.ts` 增加**可注入的静态目录选项** `staticDir`（server options）：

- 默认：项目根下 `src/webui/client/dist`（开发机 `start --web` 直接可用，需先构建前端）
- 挂载：`express.static(staticDir)`，**在 API 路由之后注册**（`/api/*` 优先，SPA fallback 绝不劫持 API）
- SPA fallback：非 `/api`、非静态文件的 GET → `index.html`（react-router client 路由需要）
- 覆盖方式：环境变量 `CODEHARNESS_WEBUI_DIR`（Electron spawn 时设置，指向打包后的 client 产物）

### 3.2 错误处理

- `staticDir` 不存在 → `start --web` 启动**明确失败**，stderr 指引：`请先构建前端：npm run build && cd src/webui/client && npm run build`（避免用户打开 3000 看到裸 404 困惑）
- API-only 行为不再存在（生产模式）：`--web` 必带静态服务；开发模式仍走 Vite（不经过 server 静态逻辑）

### 3.3 测试（自动化）

supertest 集成测试（新文件 `tests/integration/webui-static.test.ts`）：
1. 静态路径：fixture 目录模拟 dist（`index.html` + `assets/x.js`）→ GET `/` 与 `/assets/x.js` 返回内容
2. SPA fallback：GET `/sessions/abc` → 返回 `index.html` 内容
3. `/api` 不被劫持：GET `/api/sessions/` → 仍是 API 响应（不落 fallback）
4. staticDir 缺失 → 启动抛错（含构建指引文案）

fixture 用临时目录构造，不依赖真实构建产物；staticDir 经 server options 注入。

---

## 4. 第 2 层：CLI 全局命令（npm link）

零代码改动（`package.json` bin 已配置 `codeharness → ./dist/cli/index.js`，shebang 已在）。

操作流程：
1. `npm run build`（dist 最新）
2. `npm link`（根目录）
3. 验证：任意目录 `codeharness --version`、`codeharness start --web`（配合第 1 层）

**注意**：全局 bin 指向的是 link 时的 dist——更新代码后需重跑 build + link（或重 build 即可，symlink 指向同一路径）。

---

## 5. 第 3 层：Electron 桌面壳

### 5.1 目录结构（新目录，独立 package）

```
desktop/
  package.json        # 私有包；deps: electron；devDeps: electron-builder、typescript、vitest
  tsconfig.json       # 编译 src/main.ts → dist/main.js（**CJS**——Electron 主进程惯例，electron-builder 兼容性最稳）
  src/
    main.ts           # 主进程：spawn 后端 → 端口就绪 → BrowserWindow → 清理
    main.test.ts      # 纯函数单测（不启动 Electron，CI 不装 Electron）
  build/              # electron-builder 产物（.gitignore）
  resources/          # 打包输入：构建后的后端（见 5.4 布局）
```

主项目 `.gitignore` 增加 `desktop/build/`、`desktop/node_modules/`。

### 5.2 主进程生命周期

```
启动
 ├─ 探测 :3000 是否已就绪（GET /api/health 或会话端点）
 │    ├─ 就绪 → 直接加载窗口（复用既有实例，不重复 spawn）
 │    └─ 未就绪 → spawn 后端
 │         node <backend>/dist/cli/index.js start --web
 │         cwd=<backend>，env 追加 CODEHARNESS_WEBUI_DIR=<backend>/webui
 │         轮询 :3000 就绪（超时 30s）
 │             失败 → 窗口加载本地错误页（后端 stderr 摘要）
 ├─ BrowserWindow loadURL http://localhost:3000
 │    窗口标题/图标：CodeHarness
 └─ 窗口关闭 → kill 后端子进程（树）→ app.quit
```

后端进程路径解析：
- 开发（`npm run dev` in desktop/）：项目根 `dist/cli/index.js`（`CODEHARNESS_WEBUI_DIR` 指向 `src/webui/client/dist`）
- 打包后：`path.join(process.resourcesPath, 'backend', 'dist', 'cli', 'index.js')`

端口就绪探测与清理逻辑**抽成纯函数**（`buildBackendCommand()`、`waitForPort(url, timeout)`、`killProcessTree(pid)`），vitest 单测（mock spawn / child_process），CI 无需真实 Electron。

### 5.3 错误处理

| 场景 | 行为 |
|------|------|
| 3000 已有实例 | 直接连，不 spawn（复用） |
| 后端 spawn/启动失败（端口占用、dist 缺失） | 窗口加载本地错误页：错误信息 + stderr 摘要 + 「以浏览器打开」备选 |
| 窗口关闭 | kill 后端子进程树（Windows `taskkill /pid <pid> /T /F`），不留孤儿 |
| 后端运行中崩溃 | 监听子进程 exit（非主动 kill 时）→ 窗口显示「后端已退出」提示页 |

### 5.4 打包（electron-builder）

- target：`win-unpacked`（便携目录，自己用）+ `nsi`（NSIS 安装程序，分发）
- **extraResources**：构建后的后端三件套进 `resources/backend/`：
  - `dist/`（后端编译产物）
  - `node_modules/`（生产依赖；**keytar 原生模块必须放 resources，不能进 asar**）
  - `webui/`（`src/webui/client/dist` vite 构建产物）
- `files` 仅打包 desktop 自身（main.js），asar 内
- 打包前置脚本：`npm run build`（主项目）+ `cd src/webui/client && npm run build` + 组装 resources

### 5.5 测试（手动，写入 TESTING.md）

1. 开发模式：`desktop/` 里启动 → 窗口打开连上 WebUI；关窗口 → 任务管理器无残留 node 进程
2. 打包产物（win-unpacked）双击 → 独立窗口 WebUI 可用（本机 + 一台无 Node 的演示机）
3. 二次启动（已有实例）→ 直接连不重复 spawn
4. 端口占用 → 错误页非白屏
5. `codeharness start --web` → 浏览器 3000 完整 WebUI

---

## 6. 测试总览

| 层 | 自动化 | 手动 |
|----|--------|------|
| 生产模式 | supertest 集成（静态/fallback/API 不被劫持/dist 缺失报错） | 浏览器 3000 |
| npm link | ——（零代码） | `codeharness --version` 任意目录 |
| Electron | 主进程纯函数单测（spawn 命令/端口轮询/清理），不启动 Electron | TESTING.md 5 项清单（本机 + 无 Node 演示机） |

## 7. 交付顺序（实施计划将细化）

1. 第 1 层：server 静态服务 + 集成测试（TDD）
2. 第 2 层：npm link + 手动验证
3. 第 3 层：desktop/ 脚手架 → 主进程纯函数（TDD）→ 生命周期接线 → electron-builder 打包 → 手动验收
4. 文档：TESTING.md 新增桌面验收小节；README（Task 22 顺带补充安装说明）
