import * as fs from 'fs';
import * as path from 'path';

/**
 * Project memory layer: reads/writes markdown files in .harness/ directory.
 * SPEC: 项目级约定文件 (.harness/conventions.md, decisions.md, known_issues.md)
 * 启动时全量注入 system prompt
 */
export class ProjectMemory {
  private readonly resolvedPath: string;

  constructor(
    projectPath: string,
    workspaceRoot: string,
  ) {
    this.resolvedPath = path.resolve(workspaceRoot, projectPath);
  }

  /**
   * List all .md files in the .harness/ directory.
   */
  listFiles(): string[] {
    if (!fs.existsSync(this.resolvedPath)) {
      return [];
    }
    try {
      const entries = fs.readdirSync(this.resolvedPath, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  }

  /**
   * Read a specific markdown file from .harness/ directory.
   * Returns null if the file does not exist.
   */
  readFile(filename: string): string | null {
    const filePath = path.join(this.resolvedPath, filename);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Write (or overwrite) a markdown file in .harness/ directory.
   * Creates the directory if it does not exist.
   */
  writeFile(filename: string, content: string): void {
    this.ensureDirectory();
    const filePath = path.join(this.resolvedPath, filename);
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Load all markdown files as a Map of filename -> content.
   */
  loadAll(): Map<string, string> {
    const result = new Map<string, string>();
    const files = this.listFiles();
    for (const file of files) {
      const content = this.readFile(file);
      if (content !== null) {
        result.set(file, content);
      }
    }
    return result;
  }

  /**
   * Load all markdown content concatenated as a single string,
   * suitable for injection into the system prompt.
   */
  loadAllContent(): string {
    const all = this.loadAll();
    const parts: string[] = [];
    for (const [filename, content] of all) {
      parts.push(`<!-- ${filename} -->\n${content}`);
    }
    return parts.join('\n\n');
  }

  /**
   * Ensure the .harness directory exists.
   */
  ensureDirectory(): void {
    if (!fs.existsSync(this.resolvedPath)) {
      fs.mkdirSync(this.resolvedPath, { recursive: true });
    }
  }
}
