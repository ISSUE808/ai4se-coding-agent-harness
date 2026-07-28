import * as path from 'path';

export function isWithinWorkspace(targetPath: string, workspaceRoot: string): boolean {
  const resolved = path.resolve(targetPath);
  const root = path.resolve(workspaceRoot);
  return resolved === root || resolved.startsWith(root + path.sep);
}
