import { describe, it, expect, vi } from 'vitest';
import * as path from 'node:path';
import { resolveBackendDir, buildBackendCommand, waitForPort, killProcessTree, runDesktopLifecycle } from './lifecycle.js';

describe('resolveBackendDir', () => {
  it('打包后：resourcesPath 下 backend 目录', () => {
    expect(resolveBackendDir({ resourcesPath: 'C:/app/resources', projectRoot: 'C:/dev/codeharness' }))
      .toBe(path.join('C:/app/resources', 'backend'));
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
    expect(cmd.args).toEqual([path.join('C:/app/backend', 'dist', 'cli', 'index.js'), 'start', '--web']);
    expect(cmd.env.CODEHARNESS_WEBUI_DIR).toBe(path.join('C:/app/backend', 'webui'));
    expect(cmd.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(cmd.cwd).toBe('C:/app/backend');
  });
  it('nodePath 参数化：Electron 打包传 electron.exe（ELECTRON_RUN_AS_NODE 纯 Node 模式，ABI 匹配）', () => {
    const cmd = buildBackendCommand('C:/app/backend', 'C:/x/electron.exe');
    expect(cmd.cmd).toBe('C:/x/electron.exe');
    expect(cmd.args).toEqual([path.join('C:/app/backend', 'dist', 'cli', 'index.js'), 'start', '--web']);
    expect(cmd.env.ELECTRON_RUN_AS_NODE).toBe('1');
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
    expect(spawnFn).toHaveBeenCalledWith('taskkill', ['/pid', '1234', '/T', '/F'], { stdio: 'ignore' });
  });
});

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
    // 用序列：第一次调用 reject（探测失败 → spawn），第二次 resolve（后端就绪）
    const waitForPort = vi.fn()
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
    // 错误路径不开窗 → window-all-closed 不触发：必须主动触发退出回调，防僵尸应用
    expect(deps.onExit).toHaveBeenCalled();
  });

  it('spawnBackend 返回 null（spawn 失败）→ 立即 showError，不再空等轮询', async () => {
    const createWindow = vi.fn();
    const spawnBackend = vi.fn(() => null);
    // 探测失败后若实现继续轮询，此 mock 会 resolve（会被误判为就绪并开窗）
    const waitForPort = vi.fn()
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValueOnce(undefined);
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
    expect(showError).toHaveBeenCalled();
    expect(createWindow).not.toHaveBeenCalled();
    expect(waitForPort).toHaveBeenCalledTimes(1); // 仅探测一次，spawn 失败后不轮询
    // 错误路径不开窗 → window-all-closed 不触发：必须主动触发退出回调，防僵尸应用
    expect(deps.onExit).toHaveBeenCalled();
  });

  it('后端启动失败（超时）→ close() 仍会杀掉已 spawn 的后端进程', async () => {
    const createWindow = vi.fn();
    const spawnBackend = vi.fn(() => 999);
    const waitForPort = vi.fn().mockRejectedValue(new Error('timeout'));
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
    expect(createWindow).not.toHaveBeenCalled();
    expect(deps.showError).toHaveBeenCalled();
    lifecycle.close();
    expect(killProcessTree).toHaveBeenCalledWith(999);
  });
});
