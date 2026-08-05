import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { hasLocalBin } from '../../../src/utils/env-prereq.js';

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-prereq-'));
  fs.mkdirSync(path.join(root, 'node_modules', '.bin'), { recursive: true });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('hasLocalBin', () => {
  it('detects a POSIX sh binary in node_modules/.bin', () => {
    fs.writeFileSync(path.join(root, 'node_modules', '.bin', 'vitest'), '#!/bin/sh\n');
    expect(hasLocalBin(root, 'vitest')).toBe(true);
  });

  it('detects a Windows .cmd shim', () => {
    fs.writeFileSync(path.join(root, 'node_modules', '.bin', 'eslint.cmd'), '@echo off\n');
    expect(hasLocalBin(root, 'eslint')).toBe(true);
  });

  it('detects a Windows PowerShell .ps1 shim', () => {
    fs.writeFileSync(path.join(root, 'node_modules', '.bin', 'tsc.ps1'), '# ps1\n');
    expect(hasLocalBin(root, 'tsc')).toBe(true);
  });

  it('returns false when the binary is not installed', () => {
    expect(hasLocalBin(root, 'jest')).toBe(false);
  });
});
