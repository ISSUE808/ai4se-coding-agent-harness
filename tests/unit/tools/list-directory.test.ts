import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { listDirectoryTool } from '../../../src/tools/list-directory.js';
import type { ToolContext } from '../../../src/types.js';

let workspaceRoot: string;
let context: ToolContext;

beforeAll(() => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-ld-'));
  context = { workspaceRoot };

  // Create test directory structure:
  // workspaceRoot/
  //   a.txt
  //   sub/
  //     b.txt
  //     nested/
  //       c.txt
  //   empty-dir/
  fs.writeFileSync(path.join(workspaceRoot, 'a.txt'), 'hello');
  fs.mkdirSync(path.join(workspaceRoot, 'sub'));
  fs.writeFileSync(path.join(workspaceRoot, 'sub', 'b.txt'), 'world');
  fs.mkdirSync(path.join(workspaceRoot, 'sub', 'nested'));
  fs.writeFileSync(path.join(workspaceRoot, 'sub', 'nested', 'c.txt'), 'deep');
  fs.mkdirSync(path.join(workspaceRoot, 'empty-dir'));
});

afterAll(() => {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

function parseOutput(toolResult: { success: boolean; output?: string }): { entries: { name: string; type: string; size: number }[] } {
  return JSON.parse(toolResult.output ?? '{"entries":[]}');
}

describe('list_directory tool', () => {
  it('lists files in the workspace root', async () => {
    const result = await listDirectoryTool.execute({ path: '.' }, context);
    expect(result.success).toBe(true);
    const { entries } = parseOutput(result);
    const names = entries.map((e) => e.name).sort();
    expect(names).toContain('a.txt');
    expect(names).toContain('sub');
    expect(names).toContain('empty-dir');
  });

  it('lists files in a subdirectory', async () => {
    const result = await listDirectoryTool.execute({ path: 'sub' }, context);
    expect(result.success).toBe(true);
    const { entries } = parseOutput(result);
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(['b.txt', 'nested']);
  });

  it('returns entries with name, type, and size', async () => {
    const result = await listDirectoryTool.execute({ path: '.' }, context);
    expect(result.success).toBe(true);
    const { entries } = parseOutput(result);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('type');
      expect(entry).toHaveProperty('size');
      expect(['file', 'directory']).toContain(entry.type);
      expect(typeof entry.size).toBe('number');
    }
  });

  it('returns error for path outside workspaceRoot', async () => {
    const result = await listDirectoryTool.execute({ path: '../outside' }, context);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('outside workspace');
  });

  it('returns error for non-existent path', async () => {
    const result = await listDirectoryTool.execute({ path: 'nope' }, context);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('not found');
  });

  it('returns empty entries for an empty directory', async () => {
    const result = await listDirectoryTool.execute({ path: 'empty-dir' }, context);
    expect(result.success).toBe(true);
    const { entries } = parseOutput(result);
    expect(entries).toEqual([]);
  });

  it('has correct tool metadata', () => {
    expect(listDirectoryTool.name).toBe('list_directory');
    expect(listDirectoryTool.description).toBeDefined();
    expect(listDirectoryTool.parameters).toBeDefined();
  });
});
