import { describe, it, expect, vi } from 'vitest';
import * as path from 'node:path';
import { resolveBackendDir, buildBackendCommand, waitForPort, killProcessTree } from './lifecycle.js';

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
    expect(spawnFn).toHaveBeenCalledWith('taskkill', ['/pid', '1234', '/T', '/F'], { stdio: 'ignore' });
  });
});
