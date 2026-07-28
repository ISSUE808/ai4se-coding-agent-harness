import * as fs from 'fs';
import * as path from 'path';
import type { Tool, ToolContext, ToolResult } from '../types.js';
import { isWithinWorkspace } from './fs-utils.js';

interface ListDirectoryParams {
  path: string;
  recursive?: boolean;
}

interface DirEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
}

function collectEntries(
  dirPath: string,
  recursive: boolean,
  base: string,
): DirEntry[] {
  const names = fs.readdirSync(dirPath);
  const entries: DirEntry[] = [];

  for (const name of names) {
    const fullPath = path.join(dirPath, name);
    const stat = fs.statSync(fullPath);
    const entryName = recursive ? path.relative(base, fullPath) : name;
    entries.push({
      name: entryName.replace(/\\/g, '/'),
      type: stat.isDirectory() ? 'directory' : 'file',
      size: stat.size,
    });

    if (recursive && stat.isDirectory()) {
      entries.push(...collectEntries(fullPath, true, base));
    }
  }

  return entries;
}

export const listDirectoryTool: Tool = {
  name: 'list_directory',
  description:
    'List files and directories in a given path. Optionally list recursively.',
  parameters: {
    path: { type: 'string', description: 'The directory path to list.' },
    recursive: {
      type: 'boolean',
      description: 'Whether to list recursively.',
      default: false,
    },
  },
  async execute(
    params: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const start = Date.now();
    try {
      const p = params as unknown as ListDirectoryParams;
      const relPath = typeof p.path === 'string' ? p.path : '.';
      const targetPath = path.resolve(context.workspaceRoot, relPath);

      if (!isWithinWorkspace(targetPath, context.workspaceRoot)) {
        return {
          success: false,
          error: `Path outside workspace: ${targetPath}`,
          duration_ms: Date.now() - start,
        };
      }

      if (!fs.existsSync(targetPath)) {
        return {
          success: false,
          error: `Path not found: ${targetPath}`,
          duration_ms: Date.now() - start,
        };
      }

      if (!fs.statSync(targetPath).isDirectory()) {
        return {
          success: false,
          error: `Not a directory: ${targetPath}`,
          duration_ms: Date.now() - start,
        };
      }

      const recursive = p.recursive === true;
      const entries = collectEntries(targetPath, recursive, targetPath);
      return {
        success: true,
        output: JSON.stringify({ entries }),
        duration_ms: Date.now() - start,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, duration_ms: Date.now() - start };
    }
  },
};
