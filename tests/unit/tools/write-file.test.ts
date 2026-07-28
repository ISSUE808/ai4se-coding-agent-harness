import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeFileTool } from '../../../src/tools/write-file.js';
import type { ToolContext } from '../../../src/types.js';

let workspaceRoot: string;
let context: ToolContext;

beforeAll(() => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-wf-'));
  context = { workspaceRoot };
});

afterAll(() => {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

describe('write_file tool', () => {
  it('writes content to a new file', async () => {
    const result = await writeFileTool.execute({ path: 'newfile.txt', content: 'hello world' }, context);
    expect(result.success).toBe(true);
    const written = fs.readFileSync(path.join(workspaceRoot, 'newfile.txt'), 'utf-8');
    expect(written).toBe('hello world');
    expect(result.filesChanged).toEqual(['newfile.txt']);
  });

  it('overwrites an existing file', async () => {
    const existing = path.join(workspaceRoot, 'existing.txt');
    fs.writeFileSync(existing, 'old content');
    const result = await writeFileTool.execute({ path: 'existing.txt', content: 'new content' }, context);
    expect(result.success).toBe(true);
    const written = fs.readFileSync(existing, 'utf-8');
    expect(written).toBe('new content');
    expect(result.filesChanged).toEqual(['existing.txt']);
  });

  it('rejects paths outside workspaceRoot', async () => {
    const result = await writeFileTool.execute({ path: '../outside.txt', content: 'no' }, context);
    expect(result.success).toBe(false);
    expect(result.error).toContain('outside workspace');
  });

  it('rejects absolute paths outside workspaceRoot', async () => {
    const result = await writeFileTool.execute({ path: '/etc/passwd', content: 'hack' }, context);
    expect(result.success).toBe(false);
    expect(result.error).toContain('outside workspace');
  });

  it('rejects when path parameter is missing', async () => {
    const result = await writeFileTool.execute({ content: 'no path' }, context);
    expect(result.success).toBe(false);
    expect(result.error).toContain('path');
  });

  it('rejects when content parameter is missing', async () => {
    const result = await writeFileTool.execute({ path: 'f.txt' }, context);
    expect(result.success).toBe(false);
    expect(result.error).toContain('content');
  });

  it('writes to nested subdirectories (creates parent dirs automatically)', async () => {
    const result = await writeFileTool.execute({ path: 'deep/nested/file.txt', content: 'deep content' }, context);
    expect(result.success).toBe(true);
    const written = fs.readFileSync(path.join(workspaceRoot, 'deep', 'nested', 'file.txt'), 'utf-8');
    expect(written).toBe('deep content');
  });

  it('has correct tool metadata', () => {
    expect(writeFileTool.name).toBe('write_file');
    expect(writeFileTool.description).toBeDefined();
    expect(writeFileTool.parameters).toBeDefined();
  });
});
