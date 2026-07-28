import * as fs from 'fs';
import * as path from 'path';
import type { Tool, ToolContext, ToolResult } from '../types.js';

interface ReadFileParams {
  paths: string[];
}

interface FileResult {
  path: string;
  content: string;
  lineCount: number;
}

function isWithinWorkspace(targetPath: string, workspaceRoot: string): boolean {
  const resolved = path.resolve(targetPath);
  const root = path.resolve(workspaceRoot);
  return resolved === root || resolved.startsWith(root + path.sep) || resolved.startsWith(root + '/');
}

export const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read the contents of one or more files. Returns the content and line count for each file.',
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

      // Resolve all paths and verify they are within workspace
      const resolvedPaths: string[] = [];
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
        resolvedPaths.push(resolved);
      }

      // Read all files
      const files: FileResult[] = [];
      const filesChanged: string[] = [];
      for (let i = 0; i < resolvedPaths.length; i++) {
        const resolved = resolvedPaths[i];
        const relPath = p.paths[i];

        if (!fs.existsSync(resolved)) {
          return {
            success: false,
            error: `File not found: ${relPath}`,
            duration_ms: Date.now() - start,
          };
        }

        const content = fs.readFileSync(resolved, 'utf-8');
        const lineCount = content.length === 0 ? 0 : content.split('\n').length;
        files.push({ path: relPath, content, lineCount });
        filesChanged.push(relPath);
      }

      return {
        success: true,
        output: JSON.stringify({ files }),
        duration_ms: Date.now() - start,
        filesChanged,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, duration_ms: Date.now() - start };
    }
  },
};
