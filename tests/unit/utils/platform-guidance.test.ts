import { describe, it, expect } from 'vitest';
import { platformGuidance } from '../../../src/utils/platform-guidance.js';

describe('platformGuidance (KNOWN_ISSUES 5)', () => {
  it('returns Windows guidance with actionable Unix-tool substitutes', () => {
    const guidance = platformGuidance('win32');
    expect(guidance).toBeDefined();
    expect(guidance).toContain('xxd');
    expect(guidance).toContain('od -A x -t x1z');
    expect(guidance).toContain('Git Bash');
  });

  it('warns about PowerShell UTF-16LE redirects (KNOWN_ISSUES 2 environment note)', () => {
    const guidance = platformGuidance('win32');
    expect(guidance).toContain('UTF-16LE');
    expect(guidance).toContain('utf8');
  });

  it('warns about the bare-npx download trap (KNOWN_ISSUES 4)', () => {
    const guidance = platformGuidance('win32');
    expect(guidance).toContain('npx');
    expect(guidance).toContain('node_modules/.bin');
  });

  it('returns nothing on POSIX platforms — no noise for the common case', () => {
    expect(platformGuidance('linux')).toBeUndefined();
    expect(platformGuidance('darwin')).toBeUndefined();
  });
});
