import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createProgram, readVersion } from '../../../src/cli/index.js';
import { CredentialStore } from '../../../src/credentials/store.js';
import { mockBackend, parseCaptured } from './helpers.js';

/**
 * Program entry (SPEC §5.1 component diagram): `codeharness` with
 * start / key / config subcommands and a real version string.
 */

describe('createProgram', () => {
  it('names the program codeharness with start, key and config subcommands', () => {
    const program = createProgram();
    expect(program.name()).toBe('codeharness');
    const names = program.commands.map((c) => c.name());
    expect(names).toEqual(expect.arrayContaining(['start', 'key', 'config']));
  });

  it('`--version` prints the package version', async () => {
    const program = createProgram({}, { exitOverride: true });
    const result = await parseCaptured(program, ['--version']);
    expect(result.thrown).toBeDefined(); // exitOverride surfaces the version exit
    expect(result.out.trim()).toBe(readVersion());
  });

  it('`key status` works end-to-end through the program with an injected store', async () => {
    const backend = mockBackend('mock', { secret: 'sk-e2e-abcd' });
    const store = new CredentialStore([backend.backend]);
    const out: string[] = [];
    const program = createProgram({
      key: {
        storeFactory: async () => store,
        service: 'codeharness/deepseek',
        account: 'deepseek',
        print: (line) => out.push(line),
      },
    });
    await parseCaptured(program, ['key', 'status']);
    expect(out.join('')).toContain('****-abcd');
    expect(out.join('')).not.toContain('sk-e2e-abcd');
  });

  it('`config show` works end-to-end through the program', async () => {
    const out: string[] = [];
    const program = createProgram({
      config: {
        // Isolated: no real home config read
        userConfigPath: 'missing-user.json',
        projectConfigPath: 'missing-project.json',
        print: (line) => out.push(line),
      },
    });
    await parseCaptured(program, ['config', 'show']);
    expect(out.join('')).toContain('"provider": "deepseek"');
  });
});

describe('readVersion', () => {
  it('returns the version declared in package.json', () => {
    const pkgPath = fileURLToPath(new URL('../../../package.json', import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    expect(readVersion()).toBe(pkg.version);
  });
});
