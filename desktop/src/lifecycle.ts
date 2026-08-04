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
    if (backendPid === null) {
      // spawn 失败（如 node 不存在）：立即报错，不空等 30s 轮询
      deps.showError('后端进程启动失败（spawn 返回 null）');
      return { close: () => { /* 后端从未成功 spawn，无进程可杀 */ } };
    }
    try {
      await waitFor(`${BACKEND_URL}/api/sessions/`, START_TIMEOUT_MS);
      ready = true;
    } catch (err) {
      deps.showError(`后端启动失败：${err instanceof Error ? err.message : String(err)}`);
      return {
        close: () => {
          // 进程已 spawn 但未就绪：仍需清理（没开窗时 window-all-closed 不触发）
          if (backendPid !== null) {
            kill(backendPid);
          }
        },
      };
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
