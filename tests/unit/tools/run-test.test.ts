import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';
import { runTestTool } from '../../../src/tools/run-test.js';
import type { ToolContext } from '../../../src/types.js';

let workspaceRoot: string;
let context: ToolContext;

beforeAll(() => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-rt-'));
  context = { workspaceRoot };

  // Create a minimal vitest project so run_test has something to execute.
  // package.json (specifying type:module for ESM)
  fs.writeFileSync(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({ name: 'test-proj', type: 'module' }, null, 2),
  );

  // A passing test file
  fs.writeFileSync(
    path.join(workspaceRoot, 'sample.test.js'),
    `import { describe, it, expect } from 'vitest';
describe('sample', () => {
  it('passes', () => { expect(1 + 1).toBe(2); });
});
`,
  );

  // A failing test file
  fs.writeFileSync(
    path.join(workspaceRoot, 'failing.test.js'),
    `import { describe, it, expect } from 'vitest';
describe('failing', () => {
  it('fails', () => { expect(1 + 1).toBe(3); });
});
`,
  );

  // Install vitest in the project dir (so npx vitest works with the project's node_modules)
  // We use the host vitest via npx which resolves from the project root.
  // Create a minimal vitest through a symlink/node_modules approach.
  // Actually, we just need npx vitest to work - we'll use the parent's vitest.
  // Create a node_modules symlink to the parent project's vitest.
  const parentNodeModules = path.resolve(workspaceRoot, '..', '..', '..', '..', '..', 'node_modules');
  const parentVitestDir = path.join(parentNodeModules, 'vitest');
  if (fs.existsSync(parentVitestDir)) {
    const testNodeModules = path.join(workspaceRoot, 'node_modules');
    fs.mkdirSync(testNodeModules, { recursive: true });
    // Symlink vitest into the test project
    try {
      fs.symlinkSync(parentVitestDir, path.join(testNodeModules, 'vitest'), 'junction');
    } catch {
      // If symlink fails, copy the directory instead
      cp.execSync(`robocopy "${parentVitestDir}" "${path.join(testNodeModules, 'vitest')}" /E /NJH /NJS /NFL /NDL`, { stdio: 'ignore' });
    }
  }
});

afterAll(() => {
  try {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  } catch {
    // Windows may hold handles; harmless.
  }
});

describe('run_test tool', () => {
  it('executes vitest and returns success for passing tests', async () => {
    const result = await runTestTool.execute({ pattern: 'sample' }, context);
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    // The output should contain test results
    expect(result.output).toContain('sample');
  });

  it('returns failure for failing tests', async () => {
    const result = await runTestTool.execute({ pattern: 'failing' }, context);
    expect(result.success).toBe(false);
    expect(result.output).toBeDefined();
  });

  it('uses an empty string as default pattern (runs all tests)', async () => {
    const result = await runTestTool.execute({}, context);
    // Should complete (may succeed or fail depending on which tests exist)
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(result.output).toBeDefined();
  });

  it('has correct tool metadata', () => {
    expect(runTestTool.name).toBe('run_test');
    expect(runTestTool.description).toBeDefined();
    expect(runTestTool.parameters).toBeDefined();
  });
});
