import * as fs from 'fs';
import * as path from 'path';
import type { Tool, ToolContext, ToolResult } from '../types.js';

interface SearchContentParams {
  pattern: string;
  path?: string;
  glob?: string;
}

interface SearchMatch {
  file: string;
  line: number;
  content: string;
}

function isWithinWorkspace(targetPath: string, workspaceRoot: string): boolean {
  const resolved = path.resolve(targetPath);
  const root = path.resolve(workspaceRoot);
  return resolved === root || resolved.startsWith(root + path.sep) || resolved.startsWith(root + '/');
}

function globToRegex(glob: string): RegExp {
  // Convert simple glob to regex: * → .*, ? → ., handle dotfiles
  let pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex special chars except * and ?
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  pattern = '^' + pattern + '$';
  return new RegExp(pattern, 'i');
}

function collectFiles(dirPath: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function searchFile(
  filePath: string,
  regex: RegExp,
  baseDir: string,
): SearchMatch[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const matches: SearchMatch[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      matches.push({
        file: path.relative(baseDir, filePath).replace(/\\/g, '/'),
        line: i + 1,
        content: lines[i],
      });
    }
  }

  return matches;
}

export const searchContentTool: Tool = {
  name: 'search_content',
  description:
    'Search for a regex pattern in files within the workspace. Optionally filter by subpath and/or file glob.',
  parameters: {
    pattern: {
      type: 'string',
      description: 'The regex pattern to search for.',
    },
    path: {
      type: 'string',
      description: 'Optional subdirectory path to restrict the search.',
    },
    glob: {
      type: 'string',
      description: 'Optional file glob pattern (e.g. *.ts) to filter files.',
    },
  },
  async execute(
    params: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const start = Date.now();
    try {
      const p = params as unknown as SearchContentParams;

      if (typeof p.pattern !== 'string' || p.pattern.length === 0) {
        return {
          success: false,
          error: 'pattern is required and must be a non-empty string',
          duration_ms: Date.now() - start,
        };
      }

      // Validate regex
      let regex: RegExp;
      try {
        regex = new RegExp(p.pattern, 'i');
      } catch {
        return {
          success: false,
          error: `Invalid regex pattern: ${p.pattern}`,
          duration_ms: Date.now() - start,
        };
      }

      // Determine search root
      const searchRoot = p.path
        ? path.resolve(context.workspaceRoot, p.path)
        : context.workspaceRoot;

      if (!isWithinWorkspace(searchRoot, context.workspaceRoot)) {
        return {
          success: false,
          error: `Path outside workspace: ${searchRoot}`,
          duration_ms: Date.now() - start,
        };
      }

      if (!fs.existsSync(searchRoot)) {
        return {
          success: false,
          error: `Path not found: ${searchRoot}`,
          duration_ms: Date.now() - start,
        };
      }

      // Collect all files
      const stat = fs.statSync(searchRoot);
      let allFiles: string[];
      if (stat.isFile()) {
        allFiles = [searchRoot];
      } else {
        allFiles = collectFiles(searchRoot);
      }

      // Apply glob filter if provided
      let fileGlobRegex: RegExp | null = null;
      if (p.glob) {
        fileGlobRegex = globToRegex(p.glob);
      }

      // Search each file
      const allMatches: SearchMatch[] = [];
      for (const filePath of allFiles) {
        const fileName = path.basename(filePath);
        if (fileGlobRegex && !fileGlobRegex.test(fileName)) {
          continue;
        }
        const fileMatches = searchFile(filePath, regex, context.workspaceRoot);
        allMatches.push(...fileMatches);
      }

      return {
        success: true,
        output: JSON.stringify({ matches: allMatches }),
        duration_ms: Date.now() - start,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, duration_ms: Date.now() - start };
    }
  },
};
