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

        const content = fs.readFileSync(resolved, 'utf-8');
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
