import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createConfigCommand, showConfig } from '../../../src/cli/commands/config.js';
import { loadConfig } from '../../../src/config/loader.js';
import type { LoadConfigOptions } from '../../../src/config/loader.js';
import { parseCaptured } from './helpers.js';

/**
 * CLI config show (SPEC §3.6: three-layer merge; §4.2: secrets never echoed).
 * Uses real config files in temp dirs — deterministic, no network, no keychain.
 */

const tmpDirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-cli-config-'));
  tmpDirs.push(dir);
  return dir;
}

function missingOptions(dir: string): LoadConfigOptions {
  return {
    userConfigPath: path.join(dir, 'missing-user.json'),
    projectConfigPath: path.join(dir, 'missing-project.json'),
  };
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

describe('showConfig', () => {
  it('prints the merged config as JSON with the webui token masked', () => {
    const dir = tmpDir();
    const config = loadConfig({
      ...missingOptions(dir),
      cliArgs: { webui: { token: 'sk-cli-token-9abc' } },
    });
    const printed = showConfig(config);
    expect(printed).toContain('"provider": "deepseek"');
    expect(printed).toContain('"token": "****-9abc"');
    expect(printed).not.toContain('sk-cli-token-9abc');
  });

  it('reports "not set" when no token is configured', () => {
    const dir = tmpDir();
    const config = loadConfig(missingOptions(dir));
    expect(showConfig(config)).toContain('"token": "not set"');
  });

  it('fully masks tokens of 4 or fewer characters', () => {
    const dir = tmpDir();
    const config = loadConfig({
      ...missingOptions(dir),
      cliArgs: { webui: { token: 'abcd' } },
    });
    const printed = showConfig(config);
    expect(printed).toContain('"token": "****"');
    expect(printed).not.toContain('abcd');
  });
});

describe('createConfigCommand wiring (SPEC §3.6 three-layer merge)', () => {
  it('`config show` prints user → project → CLI override merge with the key masked', async () => {
    const dir = tmpDir();
    const userPath = path.join(dir, 'user.json');
    const projectPath = path.join(dir, '.codeharness.json');
    fs.writeFileSync(
      userPath,
      JSON.stringify({
        llm: { model: 'user-model' },
        webui: { port: 4000, token: 'user-token-abc' },
      }),
    );
    fs.writeFileSync(
      projectPath,
      JSON.stringify({
        llm: { model: 'project-model' },
        webui: { token: 'project-token123' },
      }),
    );
    const out: string[] = [];
    const cmd = createConfigCommand({
      userConfigPath: userPath,
      projectConfigPath: projectPath,
      cliArgs: { llm: { model: 'cli-model' } },
      print: (line) => out.push(line),
    });
    const result = await parseCaptured(cmd, ['show']);
    const printed = out.join('') + result.out;
    // CLI args win over project config, which wins over user config
    expect(printed).toContain('"model": "cli-model"');
    // User layer survives where nothing overrides it
    expect(printed).toContain('"port": 4000');
    // Project token masks over user token; plaintext never printed
    expect(printed).toContain('"token": "****-n123"');
    expect(printed).not.toContain('project-token123');
    expect(printed).not.toContain('user-token-abc');
  });

  it('`config show` with no config files prints built-in defaults', async () => {
    const dir = tmpDir();
    const out: string[] = [];
    const cmd = createConfigCommand({
      ...missingOptions(dir),
      print: (line) => out.push(line),
    });
    await parseCaptured(cmd, ['show']);
    const printed = out.join('');
    expect(printed).toContain('"provider": "deepseek"');
    expect(printed).toContain('"maxRounds": 3');
    expect(printed).toContain('"token": "not set"');
  });
});
