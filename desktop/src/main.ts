/**
 * Electron 主进程入口（spec 2026-08-04 第 3 层）：组装真实 electron 依赖，
 * 全部逻辑在 lifecycle.ts（纯函数，已单测）。此文件仅接线。
 */
import { app, BrowserWindow, dialog } from 'electron';
import * as path from 'node:path';
import { runDesktopLifecycle, resolveNodePath } from './lifecycle.js';

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
  // 主动关闭标志：窗口关闭触发 taskkill 强杀时后端 exit code 非 0，
  // 需区分「主动清理」（不弹框）与「后端自行崩溃」（弹框提示）。spec 2026-08-04 §5.3。
  let intentional = false;

  // 打包后 process.resourcesPath 存在；开发时用项目根（desktop 的上级）。
  const projectRoot = path.resolve(__dirname, '..', '..');
  const lifecycle = await runDesktopLifecycle({
    projectRoot,
    resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
    // 打包内没有系统 Node：electron.exe 以 ELECTRON_RUN_AS_NODE=1 纯 Node 模式
    // 运行后端（keytar.node 等原生模块按 electron ABI 重编译，ABI 天然匹配）；
    // dev 用系统 node（root node_modules 的 keytar 按系统 Node ABI 编译，electron
    // 内嵌 Node 版本不同会 keytar 加载失败、静默降级 encrypted-file 读不到已有密钥）
    nodePath: resolveNodePath(app.isPackaged, process.execPath),
    // 启动失败等错误路径不开窗 → window-all-closed 不触发：onExit 兜底退出
    onExit: () => app.quit(),
    createWindow,
    spawnBackend: (cmd) => {
      const { spawn } = require('node:child_process') as typeof import('node:child_process');
      const child = spawn(cmd.cmd, cmd.args, { env: { ...process.env, ...cmd.env }, cwd: cmd.cwd, stdio: 'inherit' });
      child.on('error', () => {
        /* spawn 失败：端口轮询超时后错误页会兜底 */
      });
      child.on('exit', (code) => {
        // 后端自行退出（崩溃）→ 主窗口显示提示；主动 close 杀掉的（intentional）不提示
        if (!intentional && code !== null && code !== 0) {
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
    intentional = true; // 主动清理：taskkill 强杀后后端 exit code 非 0，不应弹「后端已退出」框
    lifecycle.close();
    app.quit();
  });
});
