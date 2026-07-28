import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readFileTool } from '../../../src/tools/read-file.js';
import type { ToolContext } from '../../../src/types.js';

let workspaceRoot: string;
let context: ToolContext;

beforeAll(() => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-rf-'));
  context = { workspaceRoot };

  // Create test files:
  //   single.txt      "line one\nline two\nline three"  (3 lines)
  //   empty.txt       ""                                 (0 lines or 1 empty line)
  //   sub/
  //     deep.txt      "deep content\nsecond line"        (2 lines)
  fs.writeFileSync(path.join(workspaceRoot, 'single.txt'), 'line one\nline two\nline three');
  fs.writeFileSync(path.join(workspaceRoot, 'empty.txt'), '');
  fs.mkdirSync(path.join(workspaceRoot, 'sub'));
  fs.writeFileSync(path.join(workspaceRoot, 'sub', 'deep.txt'), 'deep content\nsecond line');
});

afterAll(() => {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

function parseFiles(toolResult: { success: boolean; output?: string }): { files: { path: string; content: string; lineCount: number }[] } {
  return JSON.parse(toolResult.output ?? '{"files":[]}');
}

describe('read_file tool', () => {
  it('reads a single file', async () => {
    const result = await readFileTool.execute({ paths: ['single.txt'] }, context);
    expect(result.success).toBe(true);
    const { files } = parseFiles(result);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('single.txt');
    expect(files[0].content).toBe('line one\nline two\nline three');
    expect(files[0].lineCount).toBe(3);
  });

  it('reads multiple files', async () => {
    const result = await readFileTool.execute({ paths: ['single.txt', 'sub/deep.txt'] }, context);
    expect(result.success).toBe(true);
    const { files } = parseFiles(result);
    expect(files).toHaveLength(2);
    const pathsInResult = files.map((f) => f.path).sort();
    expect(pathsInResult).toEqual(['single.txt', 'sub/deep.txt']);
    expect(files[0].lineCount).toBeGreaterThan(0);
    expect(files[1].lineCount).toBeGreaterThan(0);
  });

  it('reads an empty file with lineCount 0 or content empty', async () => {
    const result = await readFileTool.execute({ paths: ['empty.txt'] }, context);
    expect(result.success).toBe(true);
    const { files } = parseFiles(result);
    expect(files).toHaveLength(1);
    expect(files[0].content).toBe('');
    // empty file: content is '' means 0 lines; or 1 empty line
    expect(files[0].lineCount).toBeGreaterThanOrEqual(0);
  });

  it('returns error for path outside workspaceRoot', async () => {
    const result = await readFileTool.execute({ paths: ['../outside.txt'] }, context);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('outside workspace');
  });

  it('skips missing file with per-file error indicator (SPEC §3.2)', async () => {
    const result = await readFileTool.execute({ paths: ['nonexistent.txt'] }, context);
    expect(result.success).toBe(true);
    const files = JSON.parse(result.output!).files;
    expect(files[0].error).toBe('File not found');
    expect(files[0].content).toBe('');
  });

  it('batch: skips missing file, returns other files', async () => {
    const result = await readFileTool.execute({ paths: ['single.txt', 'nonexistent.txt'] }, context);
    expect(result.success).toBe(true);
    const files = JSON.parse(result.output!).files;
    expect(files).toHaveLength(2);
    expect(files[0].error).toBeUndefined();
    expect(files[0].content).toBe('line one\nline two\nline three');
    expect(files[1].error).toBe('File not found');
  });

  it('fails the entire request if any file is outside workspace', async () => {
    const result = await readFileTool.execute({ paths: ['single.txt', '../escape.txt'] }, context);
    expect(result.success).toBe(false);
    expect(result.error).toContain('outside workspace');
  });

  it('has correct tool metadata', () => {
    expect(readFileTool.name).toBe('read_file');
    expect(readFileTool.description).toBeDefined();
    expect(readFileTool.parameters).toBeDefined();
  });
});
