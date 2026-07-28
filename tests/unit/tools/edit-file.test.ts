import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { editFileTool } from '../../../src/tools/edit-file.js';
import type { ToolContext } from '../../../src/types.js';

let workspaceRoot: string;
let context: ToolContext;

beforeAll(() => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-ef-'));
  context = { workspaceRoot };
});

afterAll(() => {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

describe('edit_file tool', () => {
  it('replaces old_string with new_string in a file', async () => {
    const filePath = path.join(workspaceRoot, 'target.txt');
    fs.writeFileSync(filePath, 'hello world');
    const result = await editFileTool.execute(
      { path: 'target.txt', old_string: 'hello', new_string: 'hi' },
      context,
    );
    expect(result.success).toBe(true);
    const written = fs.readFileSync(filePath, 'utf-8');
    expect(written).toBe('hi world');
    expect(result.filesChanged).toEqual(['target.txt']);
  });

  it('replaces a multiline old_string', async () => {
    const filePath = path.join(workspaceRoot, 'multiline.txt');
    fs.writeFileSync(filePath, 'line one\nline two\nline three');
    const result = await editFileTool.execute(
      { path: 'multiline.txt', old_string: 'line one\nline two', new_string: 'replaced' },
      context,
    );
    expect(result.success).toBe(true);
    const written = fs.readFileSync(filePath, 'utf-8');
    expect(written).toBe('replaced\nline three');
  });

  it('returns error when old_string is not found', async () => {
    const filePath = path.join(workspaceRoot, 'target.txt');
    fs.writeFileSync(filePath, 'hello world');
    const result = await editFileTool.execute(
      { path: 'target.txt', old_string: 'nonexistent', new_string: 'x' },
      context,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns error when old_string is not unique (multiple occurrences)', async () => {
    const filePath = path.join(workspaceRoot, 'dup.txt');
    fs.writeFileSync(filePath, 'dup dup');
    const result = await editFileTool.execute(
      { path: 'dup.txt', old_string: 'dup', new_string: 'x' },
      context,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('not unique');
  });

  it('rejects paths outside workspaceRoot', async () => {
    const result = await editFileTool.execute(
      { path: '../outside.txt', old_string: 'a', new_string: 'b' },
      context,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('outside workspace');
  });

  it('returns error when path is missing', async () => {
    const result = await editFileTool.execute(
      { old_string: 'a', new_string: 'b' },
      context,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('path');
  });

  it('returns error when old_string is missing', async () => {
    const result = await editFileTool.execute(
      { path: 'target.txt', new_string: 'b' },
      context,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('old_string');
  });

  it('returns error when new_string is missing', async () => {
    const result = await editFileTool.execute(
      { path: 'target.txt', old_string: 'a' },
      context,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('new_string');
  });

  it('replaces only the first occurrence when old_string appears once', async () => {
    const filePath = path.join(workspaceRoot, 'unique.txt');
    fs.writeFileSync(filePath, 'prefix [TARGET] suffix');
    const result = await editFileTool.execute(
      { path: 'unique.txt', old_string: '[TARGET]', new_string: 'REPLACED' },
      context,
    );
    expect(result.success).toBe(true);
    const written = fs.readFileSync(filePath, 'utf-8');
    expect(written).toBe('prefix REPLACED suffix');
  });

  it('has correct tool metadata', () => {
    expect(editFileTool.name).toBe('edit_file');
    expect(editFileTool.description).toBeDefined();
    expect(editFileTool.parameters).toBeDefined();
  });
});
