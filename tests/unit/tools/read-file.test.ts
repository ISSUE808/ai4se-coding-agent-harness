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

describe('read_file encoding detection (KNOWN_ISSUES 2)', () => {
  const BOM = {
    utf8: Buffer.from([0xef, 0xbb, 0xbf]),
    utf16le: Buffer.from([0xff, 0xfe]),
    utf16be: Buffer.from([0xfe, 0xff]),
    utf32le: Buffer.from([0xff, 0xfe, 0x00, 0x00]),
    utf32be: Buffer.from([0x00, 0x00, 0xfe, 0xff]),
  };

  function utf16beBytes(s: string): Buffer {
    const out = Buffer.alloc(s.length * 2);
    for (let i = 0; i < s.length; i++) out.writeUInt16BE(s.charCodeAt(i), i * 2);
    return out;
  }

  function utf32Bytes(s: string, be: boolean): Buffer {
    const cps = [...s].map((ch) => ch.codePointAt(0)!);
    const out = Buffer.alloc(cps.length * 4);
    cps.forEach((cp, i) => (be ? out.writeUInt32BE(cp, i * 4) : out.writeUInt32LE(cp, i * 4)));
    return out;
  }

  it('UTF-16LE with BOM decodes correctly (was mojibake)', async () => {
    const payload = Buffer.from('你好 UTF-16', 'utf16le');
    fs.writeFileSync(path.join(workspaceRoot, 'enc16le.txt'), Buffer.concat([BOM.utf16le, payload]));
    const result = await readFileTool.execute({ paths: ['enc16le.txt'] }, context);
    expect(result.success).toBe(true);
    expect(parseFiles(result).files[0].content).toBe('你好 UTF-16');
  });

  it('UTF-16BE with BOM decodes correctly (was mojibake)', async () => {
    const payload = utf16beBytes('你好 UTF-16');
    fs.writeFileSync(path.join(workspaceRoot, 'enc16be.txt'), Buffer.concat([BOM.utf16be, payload]));
    const result = await readFileTool.execute({ paths: ['enc16be.txt'] }, context);
    expect(result.success).toBe(true);
    expect(parseFiles(result).files[0].content).toBe('你好 UTF-16');
  });

  it('UTF-8 BOM is stripped (no U+FEFF ghost character)', async () => {
    fs.writeFileSync(
      path.join(workspaceRoot, 'enc8bom.txt'),
      Buffer.concat([BOM.utf8, Buffer.from('line one')]),
    );
    const result = await readFileTool.execute({ paths: ['enc8bom.txt'] }, context);
    expect(result.success).toBe(true);
    expect(parseFiles(result).files[0].content).toBe('line one');
  });

  it('UTF-32LE with BOM decodes correctly', async () => {
    fs.writeFileSync(
      path.join(workspaceRoot, 'enc32le.txt'),
      Buffer.concat([BOM.utf32le, utf32Bytes('你好 UTF-32', false)]),
    );
    const result = await readFileTool.execute({ paths: ['enc32le.txt'] }, context);
    expect(result.success).toBe(true);
    expect(parseFiles(result).files[0].content).toBe('你好 UTF-32');
  });

  it('UTF-32BE with BOM decodes correctly', async () => {
    fs.writeFileSync(
      path.join(workspaceRoot, 'enc32be.txt'),
      Buffer.concat([BOM.utf32be, utf32Bytes('你好 UTF-32', true)]),
    );
    const result = await readFileTool.execute({ paths: ['enc32be.txt'] }, context);
    expect(result.success).toBe(true);
    expect(parseFiles(result).files[0].content).toBe('你好 UTF-32');
  });

  it('BOM-less non-UTF-8 (GBK) fails with an actionable iconv hint instead of mojibake', async () => {
    // GBK bytes for 你好 (C4 E3 BA C3) — invalid UTF-8, valid GB18030.
    fs.writeFileSync(path.join(workspaceRoot, 'encgbk.txt'), Buffer.from([0xc4, 0xe3, 0xba, 0xc3]));
    const result = await readFileTool.execute({ paths: ['encgbk.txt'] }, context);
    expect(result.success).toBe(true);
    const file = parseFiles(result).files[0];
    expect(file.error).toBeDefined();
    expect(file.error).toContain('iconv');
    expect(file.content).toBe('');
  });

  it('batch: undetectable-encoding file errors per-file, other files still read', async () => {
    fs.writeFileSync(path.join(workspaceRoot, 'encgbk2.txt'), Buffer.from([0xc4, 0xe3, 0xba, 0xc3]));
    const result = await readFileTool.execute({ paths: ['single.txt', 'encgbk2.txt'] }, context);
    expect(result.success).toBe(true);
    const files = parseFiles(result).files;
    expect(files).toHaveLength(2);
    expect(files[0].content).toBe('line one\nline two\nline three');
    expect(files[0].error).toBeUndefined();
    expect(files[1].error).toContain('iconv');
    expect(files[1].content).toBe('');
  });

  it('odd-length UTF-16LE payload errors instead of silently dropping a byte', async () => {
    // 3 bytes: 'A' (41 00) + stray 42 — a truncated write would look like this.
    fs.writeFileSync(path.join(workspaceRoot, 'enc16odd.txt'), Buffer.concat([BOM.utf16le, Buffer.from([0x41, 0x00, 0x42])]));
    const result = await readFileTool.execute({ paths: ['enc16odd.txt'] }, context);
    expect(result.success).toBe(true);
    expect(parseFiles(result).files[0].error).toContain('UTF-16');
    expect(parseFiles(result).files[0].content).toBe('');
  });

  it('odd-length UTF-16BE payload errors instead of U+FFFD mojibake', async () => {
    fs.writeFileSync(path.join(workspaceRoot, 'enc16oddbe.txt'), Buffer.concat([BOM.utf16be, Buffer.from([0x00, 0x41, 0x42])]));
    const result = await readFileTool.execute({ paths: ['enc16oddbe.txt'] }, context);
    expect(result.success).toBe(true);
    expect(parseFiles(result).files[0].error).toContain('UTF-16');
  });

  it('UTF-32 payload not a multiple of 4 bytes errors as truncated', async () => {
    // BOM + 6 bytes = 1.5 code points (two code points are 8 bytes; cut to 6).
    const payload = utf32Bytes('好你', false).subarray(0, 6);
    fs.writeFileSync(path.join(workspaceRoot, 'enc32trunc.txt'), Buffer.concat([BOM.utf32le, payload]));
    const result = await readFileTool.execute({ paths: ['enc32trunc.txt'] }, context);
    expect(result.success).toBe(true);
    expect(parseFiles(result).files[0].error).toContain('UTF-32');
    expect(parseFiles(result).files[0].content).toBe('');
  });

  it('UTF-32 out-of-range code point (0x110000) errors', async () => {
    const payload = Buffer.concat([utf32Bytes('好', false), Buffer.from([0x00, 0x00, 0x11, 0x00])]);
    fs.writeFileSync(path.join(workspaceRoot, 'enc32bad.txt'), Buffer.concat([BOM.utf32le, payload]));
    const result = await readFileTool.execute({ paths: ['enc32bad.txt'] }, context);
    expect(result.success).toBe(true);
    expect(parseFiles(result).files[0].error).toContain('UTF-32');
  });

  it('UTF-32 lone surrogate code point (0xD800) errors (fromCodePoint would not)', async () => {
    const payload = Buffer.from([0x00, 0xd8, 0x00, 0x00]); // U+D800 LE
    fs.writeFileSync(path.join(workspaceRoot, 'enc32sur.txt'), Buffer.concat([BOM.utf32le, payload]));
    const result = await readFileTool.execute({ paths: ['enc32sur.txt'] }, context);
    expect(result.success).toBe(true);
    expect(parseFiles(result).files[0].error).toContain('UTF-32');
  });

  it('BOM-only file reads as empty content without error', async () => {
    fs.writeFileSync(path.join(workspaceRoot, 'encbomonly.txt'), BOM.utf8);
    const result = await readFileTool.execute({ paths: ['encbomonly.txt'] }, context);
    expect(result.success).toBe(true);
    const file = parseFiles(result).files[0];
    expect(file.error).toBeUndefined();
    expect(file.content).toBe('');
    expect(file.lineCount).toBe(0);
  });
});
