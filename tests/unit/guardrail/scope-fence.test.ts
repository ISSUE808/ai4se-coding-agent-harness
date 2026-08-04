import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ScopeFence } from '../../../src/guardrail/scope-fence.js';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

describe('ScopeFence', () => {
  const workspaceRoot = os.platform() === 'win32'
    ? 'C:\\Users\\agent\\workspace'
    : '/home/agent/workspace';

  const fence = new ScopeFence();

  describe('validatePath', () => {
    it('放行 workspace 内的路径', () => {
      const innerPath = path.join(workspaceRoot, 'src', 'index.ts');
      expect(fence.validatePath(innerPath, workspaceRoot)).toBe(true);
    });

    it('放行以 workspace 为前缀的子路径（含尾部无分隔符的情况）', () => {
      const subPath = path.join(workspaceRoot, 'a', 'b', 'c.ts');
      expect(fence.validatePath(subPath, workspaceRoot)).toBe(true);
    });

    it('拦截 workspace 外部的绝对路径', () => {
      const outsidePath = os.platform() === 'win32'
        ? 'C:\\Windows\\System32\\config'
        : '/etc/passwd';
      expect(fence.validatePath(outsidePath, workspaceRoot)).toBe(false);
    });

    it('拦截 ../ 目录遍历攻击', () => {
      // resolve 后应该跳出 workspace
      expect(fence.validatePath('../../etc/passwd', workspaceRoot)).toBe(false);
    });

    it('拦截多层 ../ 目录遍历', () => {
      expect(fence.validatePath('../../../root', workspaceRoot)).toBe(false);
    });

    it('拦截以 workspace 为前缀但拼接 ../ 的欺骗路径', () => {
      const tricky = path.join(workspaceRoot, '..', 'etc', 'passwd');
      expect(fence.validatePath(tricky, workspaceRoot)).toBe(false);
    });

    it('放行 workspace 根目录本身', () => {
      expect(fence.validatePath(workspaceRoot, workspaceRoot)).toBe(true);
    });

    it('resolve 后路径恰好在 workspace 内的相对路径', () => {
      const cwd = process.cwd();
      // 构造一个在 cwd 内但 resolve 到其他位置的情况不容易测试
      // 使用直接路径
      const inner = path.join(workspaceRoot, 'subdir', 'file.txt');
      expect(fence.validatePath(inner, workspaceRoot)).toBe(true);
    });

    // path.resolve() 是平台原生的——Windows 盘符在 Linux 上不被理解。
    // 此测试仅在 Windows 平台运行。
    const itWin = process.platform === 'win32' ? it : it.skip;
    itWin('windows 风格分隔符也能正确拦截', () => {
      const wsWin = 'C:\\Users\\agent\\workspace';
      const outsideWin = 'C:\\Windows\\System32\\drivers\\etc\\hosts';
      expect(fence.validatePath(outsideWin, wsWin)).toBe(false);
      const insideWin = 'C:\\Users\\agent\\workspace\\src\\main.ts';
      expect(fence.validatePath(insideWin, wsWin)).toBe(true);
    });
  });

  describe('canonical symlink check (KNOWN_ISSUES 7)', () => {
    // Real-filesystem fixtures: a symlink INSIDE the workspace pointing
    // OUTSIDE it must not let validatePath pass (lexical prefix matching
    // alone would). Windows: junction links need no admin privilege, so the
    // test runs on both platforms; if link creation fails (e.g. filesystem
    // without reparse support) the group is skipped.
    let root: string;
    let outside: string;
    let linkDir: string;
    let linksSupported = true;

    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-fence-root-'));
      outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-fence-out-'));
      fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret');
      linkDir = path.join(root, 'link');
      try {
        fs.symlinkSync(outside, linkDir, process.platform === 'win32' ? 'junction' : 'dir');
      } catch {
        linksSupported = false;
      }
    });

    afterAll(() => {
      if (linksSupported) {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it.skipIf(!linksSupported)('拦截会话根内 symlink 指向根外的逃逸路径', () => {
      const fence = new ScopeFence();
      // Lexically inside the root (`root/link/secret.txt`), canonically
      // outside (`outside/secret.txt`).
      expect(fence.validatePath(path.join(linkDir, 'secret.txt'), root)).toBe(false);
    });

    it.skipIf(!linksSupported)('放行会话根内的真实路径（canonical 检查不误伤）', () => {
      const fence = new ScopeFence();
      const inner = path.join(root, 'real', 'file.txt');
      fs.mkdirSync(path.dirname(inner), { recursive: true });
      fs.writeFileSync(inner, 'x');
      expect(fence.validatePath(inner, root)).toBe(true);
    });

    it.skipIf(!linksSupported)('放行会话根内尚不存在的写入目标（canonical 走最近存在祖先）', () => {
      const fence = new ScopeFence();
      // write_file targets need not exist yet — canonicalize must walk up to
      // the nearest existing ancestor (the root) and still accept.
      expect(fence.validatePath(path.join(root, 'not-yet-created.ts'), root)).toBe(true);
    });

    it.skipIf(!linksSupported)('会话根内 symlink 逃逸路径即使以根为前缀也被拦截', () => {
      const fence = new ScopeFence();
      // Deeper nesting: root/sub/link → outside. Lexical prefix passes, the
      // canonical comparison must reject.
      const subLink = path.join(root, 'sub');
      fs.mkdirSync(subLink, { recursive: true });
      fs.symlinkSync(outside, path.join(subLink, 'esc'), process.platform === 'win32' ? 'junction' : 'dir');
      expect(fence.validatePath(path.join(subLink, 'esc', 'secret.txt'), root)).toBe(false);
    });
  });

  describe('filterEnv', () => {
    const input = {
      PATH: '/usr/bin:/bin',
      HOME: '/home/agent',
      USER: 'agent',
      SECRET_TOKEN: 'abc123',
      AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
      NODE_ENV: 'test',
      RANDOM_VAR: 'should-be-removed',
    };

    it('白名单内的环境变量被保留', () => {
      const result = fence.filterEnv(input);
      // PATH and HOME are common safelist entries
      expect(result.PATH).toBe('/usr/bin:/bin');
      expect(result.HOME).toBe('/home/agent');
    });

    it('敏感 / 未知变量被移除', () => {
      const result = fence.filterEnv(input);
      expect(result.SECRET_TOKEN).toBeUndefined();
      expect(result.AWS_ACCESS_KEY_ID).toBeUndefined();
      expect(result.RANDOM_VAR).toBeUndefined();
    });

    it('返回的是新对象，不修改原始对象', () => {
      const original = { ...input };
      const result = fence.filterEnv(input);
      expect(result).not.toBe(input);
      // 原始对象未被修改
      expect(input.SECRET_TOKEN).toBe('abc123');
    });

    it('白名单为空时返回空对象', () => {
      const emptyFence = new ScopeFence([]);
      const result = emptyFence.filterEnv(input);
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('支持自定义白名单', () => {
      const customFence = new ScopeFence(['CUSTOM_VAR', 'NODE_ENV']);
      const result = customFence.filterEnv({
        CUSTOM_VAR: 'keep-me',
        NODE_ENV: 'production',
        TO_REMOVE: 'bye',
      });
      expect(result.CUSTOM_VAR).toBe('keep-me');
      expect(result.NODE_ENV).toBe('production');
      expect(result.TO_REMOVE).toBeUndefined();
    });
  });
});
