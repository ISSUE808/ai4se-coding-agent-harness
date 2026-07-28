import * as fs from 'fs';
import * as path from 'path';
import type { Tool, ToolContext, ToolResult } from '../types.js';
import { isWithinWorkspace } from './fs-utils.js';

interface EditFileParams {
  path: string;
  old_string: string;
  new_string: string;
}

export const editFileTool: Tool = {
  name: 'edit_file',
  description:
    'Performs exact string replacement in a file. The old_string must match exactly once in the file. If old_string matches zero or more than one time, an error is returned.',
  parameters: {
    path: {
      type: 'string',
      description: 'File path relative to the workspace root.',
    },
    old_string: {
      type: 'string',
      description: 'The exact string to replace.',
    },
    new_string: {
      type: 'string',
      description: 'The replacement string.',
    },
  },
  async execute(
    params: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const start = Date.now();
    try {
      const p = params as unknown as EditFileParams;

      if (typeof p.path !== 'string' || p.path.trim().length === 0) {
        return {
          success: false,
          error: 'path is required and must be a non-empty string',
          duration_ms: Date.now() - start,
        };
      }

      if (typeof p.old_string !== 'string') {
        return {
          success: false,
          error: 'old_string is required and must be a string',
          duration_ms: Date.now() - start,
        };
      }

      if (typeof p.new_string !== 'string') {
        return {
          success: false,
          error: 'new_string is required and must be a string',
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

      if (!fs.existsSync(resolved)) {
        return {
          success: false,
          error: `File not found: ${p.path}`,
          duration_ms: Date.now() - start,
        };
      }

      const content = fs.readFileSync(resolved, 'utf-8');

      // Count occurrences of old_string
      const count = content.split(p.old_string).length - 1;
      if (count === 0) {
        return {
          success: false,
          error: `old_string not found in file: "${p.old_string}"`,
          duration_ms: Date.now() - start,
        };
      }
      if (count > 1) {
        return {
          success: false,
          error: `old_string is not unique in file (found ${count} occurrences): "${p.old_string}"`,
          duration_ms: Date.now() - start,
        };
      }

      const newContent = content.replace(p.old_string, p.new_string);
      fs.writeFileSync(resolved, newContent, 'utf-8');

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
