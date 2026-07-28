import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { searchContentTool } from '../../../src/tools/search-content.js';
import type { ToolContext } from '../../../src/types.js';

let workspaceRoot: string;
let context: ToolContext;

beforeAll(() => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-sc-'));
  context = { workspaceRoot };

  // Create test files:
  //   alpha.txt    "hello world\nfoo bar\nhello again"
  //   beta.log     "DEBUG: hello start\nINFO: processing\nDEBUG: hello end"
  //   sub/
  //     gamma.txt  "goodbye world\nhello there"
  fs.writeFileSync(path.join(workspaceRoot, 'alpha.txt'), 'hello world\nfoo bar\nhello again');
  fs.writeFileSync(path.join(workspaceRoot, 'beta.log'), 'DEBUG: hello start\nINFO: processing\nDEBUG: hello end');
  fs.mkdirSync(path.join(workspaceRoot, 'sub'));
  fs.writeFileSync(path.join(workspaceRoot, 'sub', 'gamma.txt'), 'goodbye world\nhello there');
});

afterAll(() => {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

function parseMatches(toolResult: { success: boolean; output?: string }): { matches: { file: string; line: number; content: string }[] } {
  return JSON.parse(toolResult.output ?? '{"matches":[]}').matches;
}

describe('search_content tool', () => {
  it('finds matches for a pattern in all files', async () => {
    const result = await searchContentTool.execute({ pattern: 'hello' }, context);
    expect(result.success).toBe(true);
    const matches = parseMatches(result);
    // alpha.txt: 2 matches, beta.log: 2 matches, sub/gamma.txt: 1 match
    expect(matches.length).toBe(5);
    for (const m of matches) {
      expect(m.file).toBeDefined();
      expect(m.line).toBeGreaterThan(0);
      expect(m.content).toBeDefined();
      expect(m.content.toLowerCase()).toContain('hello');
    }
  });

  it('returns empty matches when pattern not found', async () => {
    const result = await searchContentTool.execute({ pattern: 'nonexistentxyz' }, context);
    expect(result.success).toBe(true);
    const matches = parseMatches(result);
    expect(matches).toEqual([]);
  });

  it('searches within a specific subpath', async () => {
    const result = await searchContentTool.execute({ pattern: 'hello', path: 'sub' }, context);
    expect(result.success).toBe(true);
    const matches = parseMatches(result);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    // All matches should be under sub/
    for (const m of matches) {
      expect(m.file).toMatch(/^sub[\/\\]/);
    }
  });

  it('respects glob pattern filter', async () => {
    const result = await searchContentTool.execute({ pattern: 'hello', glob: '*.txt' }, context);
    expect(result.success).toBe(true);
    const matches = parseMatches(result);
    // Only .txt files: alpha.txt (2), sub/gamma.txt (1) -- no beta.log
    expect(matches.length).toBe(3);
    for (const m of matches) {
      expect(m.file).toMatch(/\.txt$/);
    }
  });

  it('returns empty matches for non-matching glob', async () => {
    const result = await searchContentTool.execute({ pattern: 'hello', glob: '*.json' }, context);
    expect(result.success).toBe(true);
    const matches = parseMatches(result);
    expect(matches).toEqual([]);
  });

  it('returns error for invalid regex pattern', async () => {
    const result = await searchContentTool.execute({ pattern: '[' }, context);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('has correct tool metadata', () => {
    expect(searchContentTool.name).toBe('search_content');
    expect(searchContentTool.description).toBeDefined();
    expect(searchContentTool.parameters).toBeDefined();
  });
});
