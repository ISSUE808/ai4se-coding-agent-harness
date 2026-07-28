import * as fs from 'fs';
import * as path from 'path';
import type { Tool, ToolContext, ToolResult } from '../types.js';
import { isWithinWorkspace } from './fs-utils.js';

interface WriteFileParams {
  path: string;
  content: string;
}

export const writeFileTool: Tool = {
  name: 'write_file',
  description:
    'Writes a file to the local filesystem (overwriting if it exists). The path is resolved relative to the workspace root. Parent directories are created automatically.',
  parameters: {
    path: {
      type: 'string',
      description: 'File path relative to the workspace root.',
    },
    content: {
      type: 'string',
      description: 'Content to write.',
    },
  },
  async execute(
    params: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const start = Date.now();
    try {
      const p = params as unknown as WriteFileParams;

      if (typeof p.path !== 'string' || p.path.trim().length === 0) {
        return {
          success: false,
          error: 'path is required and must be a non-empty string',
          duration_ms: Date.now() - start,
        };
      }

      if (typeof p.content !== 'string') {
        return {
          success: false,
          error: 'content is required and must be a string',
          duration_ms: Date.now() - start,
        };
      }

      const resolved = path.resolve(context.workspaceRoot, p.path);
      if (!isWithinWorkspace(resolved, context.workspaceRoot)) {
        return {
          success: false,
          error: `Path outside workspace: ${resolved}`,
          duration_ms: Date.now() - start,
        };
      }

      // Create parent directories if needed
      const dir = path.dirname(resolved);
      fs.mkdirSync(dir, { recursive: true });

      fs.writeFileSync(resolved, p.content, 'utf-8');

      return {
        success: true,
        duration_ms: Date.now() - start,
        filesChanged: [p.path],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, duration_ms: Date.now() - start };
    }
  },
};
