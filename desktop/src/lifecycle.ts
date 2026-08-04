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
