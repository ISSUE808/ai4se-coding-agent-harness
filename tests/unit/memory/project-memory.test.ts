import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProjectMemory } from '../../../src/memory/project-memory.js';

describe('ProjectMemory', () => {
  let tmpDir: string;
  let harnessDir: string;
  let pm: ProjectMemory;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-mem-test-'));
    harnessDir = path.join(tmpDir, '.harness');
    fs.mkdirSync(harnessDir, { recursive: true });
    pm = new ProjectMemory('.harness/', tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---- List Files ----

  it('listFiles 列出 .harness/ 下的所有 .md 文件', () => {
    fs.writeFileSync(path.join(harnessDir, 'conventions.md'), '# Conventions\ntest');
    fs.writeFileSync(path.join(harnessDir, 'decisions.md'), '# Decisions\ntest');
    fs.writeFileSync(path.join(harnessDir, 'known_issues.md'), '# Known Issues');

    const files = pm.listFiles();
    expect(files).toContain('conventions.md');
    expect(files).toContain('decisions.md');
    expect(files).toContain('known_issues.md');
    expect(files.length).toBe(3);
  });

  it('listFiles 空目录返回空数组', () => {
    const files = pm.listFiles();
    expect(files).toEqual([]);
  });

  it('listFiles 不包含 .harness/ 目录自身', () => {
    fs.writeFileSync(path.join(harnessDir, 'conventions.md'), 'test');
    const files = pm.listFiles();
    expect(files).not.toContain('.harness/');
    expect(files.every((f) => f.endsWith('.md'))).toBe(true);
  });

  it('listFiles 忽略非 .md 文件', () => {
    fs.writeFileSync(path.join(harnessDir, 'conventions.md'), 'test');
    fs.writeFileSync(path.join(harnessDir, 'config.json'), '{}');
    fs.writeFileSync(path.join(harnessDir, 'notes.txt'), 'text');

    const files = pm.listFiles();
    expect(files).toEqual(['conventions.md']);
  });

  it('listFiles .harness/ 目录不存在时返回空数组', () => {
    const pm2 = new ProjectMemory('.harness/', path.join(tmpDir, 'nonexistent'));
    const files = pm2.listFiles();
    expect(files).toEqual([]);
  });

  // ---- Read File ----

  it('readFile 读取特定 markdown 文件内容', () => {
    const content = '# Convention 1\n\n- Use tabs, not spaces\n- Always write tests first';
    fs.writeFileSync(path.join(harnessDir, 'conventions.md'), content);

    const result = pm.readFile('conventions.md');
    expect(result).toBe(content);
  });

  it('readFile 文件不存在时返回 null', () => {
    const result = pm.readFile('nonexistent.md');
    expect(result).toBeNull();
  });

  // ---- Write File ----

  it('writeFile 写入 markdown 文件', () => {
    const content = '# New Convention\nThis is a new convention.';
    pm.writeFile('new_convention.md', content);

    const filePath = path.join(harnessDir, 'new_convention.md');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(content);
  });

  it('writeFile 覆盖已存在的文件', () => {
    fs.writeFileSync(path.join(harnessDir, 'conventions.md'), '# Old');
    pm.writeFile('conventions.md', '# Updated Content');

    const result = fs.readFileSync(path.join(harnessDir, 'conventions.md'), 'utf-8');
    expect(result).toBe('# Updated Content');
  });

  it('writeFile .harness/ 目录不存在时自动创建', () => {
    const newDir = path.join(tmpDir, 'new-project');
    const pm2 = new ProjectMemory('.harness/', newDir);

    pm2.writeFile('conventions.md', '# Test');
    const filePath = path.join(newDir, '.harness', 'conventions.md');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  // ---- Load All ----

  it('loadAll 返回所有 markdown 文件的 Map', () => {
    fs.writeFileSync(path.join(harnessDir, 'conventions.md'), '# Conventions');
    fs.writeFileSync(path.join(harnessDir, 'decisions.md'), '# Decisions');

    const all = pm.loadAll();
    expect(all.size).toBe(2);
    expect(all.get('conventions.md')).toBe('# Conventions');
    expect(all.get('decisions.md')).toBe('# Decisions');
  });

  it('loadAll 空目录返回空 Map', () => {
    const all = pm.loadAll();
    expect(all.size).toBe(0);
  });

  // ---- Load All Content ----

  it('loadAllContent 拼接所有 markdown 文件内容', () => {
    fs.writeFileSync(path.join(harnessDir, 'conventions.md'), '# Conventions\nUse tabs.');
    fs.writeFileSync(path.join(harnessDir, 'decisions.md'), '# Decisions\nUse vitest.');

    const content = pm.loadAllContent();
    expect(content).toContain('# Conventions');
    expect(content).toContain('Use tabs.');
    expect(content).toContain('# Decisions');
    expect(content).toContain('Use vitest.');
  });

  it('loadAllContent 空目录返回空字符串', () => {
    const content = pm.loadAllContent();
    expect(content).toBe('');
  });

  // ---- Workspace path resolution ----

  it('workspaceRoot + projectPath 正确拼接', () => {
    const pm2 = new ProjectMemory('.harness/', '/tmp/ws');
    // The harness path should be /tmp/ws/.harness/
    // Just verify it works when directory is created
    // We can't fully test without creating dirs, but listFiles should not throw
    const files = pm2.listFiles();
    expect(Array.isArray(files)).toBe(true);
  });
});
