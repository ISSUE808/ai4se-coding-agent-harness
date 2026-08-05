import * as fs from 'fs';
import * as path from 'path';
import type { Tool, ToolContext, ToolResult } from '../types.js';
import { isWithinWorkspace } from './fs-utils.js';

interface ReadFileParams {
  paths: string[];
}

interface FileResult {
  path: string;
  content: string;
  lineCount: number;
  error?: string;
}

/**
 * Decode a file buffer with BOM-driven encoding detection (KNOWN_ISSUES 2).
 *
 * - BOM present → decode as UTF-8/16LE/16BE/32LE/32BE (BOM stripped). Only the
 *   BOM is a reliable encoding signal; UTF-32 needs manual decoding because
 *   Node's TextDecoder has no utf-32 label.
 * - No BOM → strict UTF-8 validation. On failure the encoding is unknowable
 *   (GBK/Shift-JIS/… are all valid byte sequences) — return a clear error with
 *   an actionable conversion path instead of silent mojibake. The agent can
 *   then run `file`/`iconv` via run_shell (both are deterministic tools).
 * - Detects UTF-32LE BOM (FF FE 00 00) BEFORE UTF-16LE (FF FE) — the former
 *   starts with the latter's bytes.
 */
function decodeFileBuffer(buf: Buffer): { content?: string; error?: string } {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { content: buf.subarray(3).toString('utf-8') }; // UTF-8 BOM
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xfe && buf[2] === 0x00 && buf[3] === 0x00) {
    return decodeUtf32(buf.subarray(4), false); // UTF-32LE
  }
  if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0xfe && buf[3] === 0xff) {
    return decodeUtf32(buf.subarray(4), true); // UTF-32BE
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return decodeUtf16(buf.subarray(2), false); // UTF-16LE
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return decodeUtf16(buf.subarray(2), true); // UTF-16BE
  }
  // No BOM: strict UTF-8 — reject invalid sequences instead of replacing them
  // with U+FFFD mojibake that the LLM cannot distinguish from real content.
  try {
    return { content: new TextDecoder('utf-8', { fatal: true }).decode(buf) };
  } catch {
    return {
      error:
        'Cannot determine encoding: no BOM and not valid UTF-8. ' +
        'Use run_shell to inspect: `file "<path>"` to detect the encoding, ' +
        'or convert first with `iconv -f <encoding> -t utf-8 "<path>"` and read the result.',
    };
  }
}

/** Decode UTF-16 (BOM already stripped) with strict validation: an odd
 * payload length or an unpaired surrogate is a truncated/corrupt file — a
 * per-file error, never silent data loss (reviewer-verified: Buffer's
 * 'utf16le' silently drops a trailing byte, TextDecoder without fatal emits
 * U+FFFD). */
function decodeUtf16(payload: Buffer, bigEndian: boolean): { content?: string; error?: string } {
  try {
    return {
      content: new TextDecoder(bigEndian ? 'utf-16be' : 'utf-16le', { fatal: true }).decode(payload),
    };
  } catch {
    return {
      error:
        'File content is not valid UTF-16 (truncated or corrupt). ' +
        'Use run_shell: `file "<path>"` to inspect the raw bytes.',
    };
  }
}

/** Decode UTF-32 (BOM already stripped): 4 bytes per code point, hand-rolled
 * because Node's TextDecoder has no utf-32 label. Returns the same shape as
 * decodeFileBuffer so an invalid code point becomes a per-file error. */
function decodeUtf32(buf: Buffer, bigEndian: boolean): { content?: string; error?: string } {
  if (buf.length % 4 !== 0) {
    return {
      error:
        'File content is truncated (UTF-32 payload length is not a multiple of 4 bytes). ' +
        'Use run_shell: `file "<path>"` to inspect the raw bytes.',
    };
  }
  try {
    const out: string[] = [];
    for (let i = 0; i < buf.length; i += 4) {
      const cp = bigEndian ? buf.readUInt32BE(i) : buf.readUInt32LE(i);
      // String.fromCodePoint only rejects > 0x10FFFF — lone surrogates
      // (U+D800–DFFF) pass through silently, so check them explicitly.
      if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
        throw new RangeError('invalid code point');
      }
      out.push(String.fromCodePoint(cp));
    }
    return { content: out.join('') };
  } catch {
    return {
      error:
        'File content contains invalid UTF-32 data (truncated or corrupt). ' +
        'Use run_shell: `file "<path>"` to inspect the raw bytes.',
    };
  }
}

export const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read the contents of one or more files. Returns the content and line count for each file. Missing files are skipped with an error indicator per file.',
  parameters: {
    paths: {
      type: 'array',
      items: { type: 'string' },
      description: 'Array of file paths to read, relative to the workspace root.',
    },
  },
  async execute(
    params: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const start = Date.now();
    try {
      const p = params as unknown as ReadFileParams;

      if (!Array.isArray(p.paths) || p.paths.length === 0) {
        return {
          success: false,
          error: 'paths is required and must be a non-empty array',
          duration_ms: Date.now() - start,
        };
      }

      for (const filePath of p.paths) {
        if (typeof filePath !== 'string') {
          return {
            success: false,
            error: `Invalid path: ${filePath}`,
            duration_ms: Date.now() - start,
          };
        }
        const resolved = path.resolve(context.workspaceRoot, filePath);
        if (!isWithinWorkspace(resolved, context.workspaceRoot)) {
          return {
            success: false,
            error: `Path outside workspace: ${resolved}`,
            duration_ms: Date.now() - start,
          };
        }
      }

      // Read all files — skip missing ones with per-file error indicator (SPEC §3.2)
      const files: FileResult[] = [];
      for (let i = 0; i < p.paths.length; i++) {
        const resolved = path.resolve(context.workspaceRoot, p.paths[i]);
        const relPath = p.paths[i];

        if (!fs.existsSync(resolved)) {
          files.push({ path: relPath, content: '', lineCount: 0, error: `File not found` });
          continue;
        }

        const decoded = decodeFileBuffer(fs.readFileSync(resolved));
        if (decoded.error) {
          files.push({ path: relPath, content: '', lineCount: 0, error: decoded.error });
          continue;
        }
        const content = decoded.content ?? '';
        const lineCount = content.length === 0 ? 0 : content.split('\n').length;
        files.push({ path: relPath, content, lineCount });
      }

      return {
        success: true,
        output: JSON.stringify({ files }),
        duration_ms: Date.now() - start,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, duration_ms: Date.now() - start };
    }
  },
};
