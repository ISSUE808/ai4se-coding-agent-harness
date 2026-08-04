import { existsSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Environment-prerequisite check (KNOWN_ISSUES 3/4): is a binary installed in
 * the workspace's LOCAL node_modules? Bare `npx <pkg>` in a project without
 * the dependency downloads it — for `tsc` that resolves to the ABANDONED npm
 * package `tsc@2.0.4`, not TypeScript — so harness components must check
 * before delegating to npx. Windows keeps `.cmd`/`.ps1` shims in `.bin`
 * alongside the POSIX sh script, hence the three candidates.
 */
export function hasLocalBin(workspaceRoot: string, bin: string): boolean {
  const binDir = path.join(workspaceRoot, 'node_modules', '.bin');
  return (
    existsSync(path.join(binDir, bin)) ||
    existsSync(path.join(binDir, `${bin}.cmd`)) ||
    existsSync(path.join(binDir, `${bin}.ps1`))
  );
}
