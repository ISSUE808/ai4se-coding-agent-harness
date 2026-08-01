import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { promptHidden, readKeyWithConfirm } from '../../../src/cli/prompt.js';

/** Non-TTY fake IO (like CI / pipes): label written to stdout, line read from stdin. */
function fakeIO() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let written = '';
  stdout.on('data', (chunk) => {
    written += chunk.toString();
  });
  return { stdin, stdout, written: () => written };
}

describe('promptHidden (SPEC §4.3: hidden input)', () => {
  it('writes the label and resolves the typed line in non-TTY mode', async () => {
    const io = fakeIO();
    const promise = promptHidden('Enter API key: ', io as never);
    io.stdin.write('sk-secret-123\n');
    await expect(promise).resolves.toBe('sk-secret-123');
    expect(io.written()).toContain('Enter API key:');
  });

  it('never echoes the typed value back to stdout', async () => {
    const io = fakeIO();
    const promise = promptHidden('Key: ', io as never);
    io.stdin.write('supersecret-value\n');
    await promise;
    expect(io.written()).not.toContain('supersecret-value');
  });

  it('resolves an empty string when the user just presses Enter', async () => {
    const io = fakeIO();
    const promise = promptHidden('Key: ', io as never);
    io.stdin.write('\n');
    await expect(promise).resolves.toBe('');
  });

  it('supports sequential prompts on the same piped stdin (CI/Docker fallback)', async () => {
    // Regression: a fresh readline per call would buffer the second line and
    // the process would exit before the second prompt resolved.
    const io = fakeIO();
    io.stdin.write('first-line\nsecond-line\n');
    const first = promptHidden('First: ', io as never);
    const second = promptHidden('Second: ', io as never);
    await expect(first).resolves.toBe('first-line');
    await expect(second).resolves.toBe('second-line');
    expect(io.written()).toContain('First: ');
    expect(io.written()).toContain('Second: ');
  });

  it('resolves with an empty line when the piped stdin ends without input', async () => {
    const io = fakeIO();
    io.stdin.end();
    await expect(promptHidden('Key: ', io as never)).resolves.toBe('');
  });
});

describe('readKeyWithConfirm (first-run bootstrap, SPEC §8.2)', () => {
  it('returns the key when both entries match', async () => {
    const readHidden = vi
      .fn()
      .mockResolvedValueOnce('sk-abc')
      .mockResolvedValueOnce('sk-abc');
    await expect(readKeyWithConfirm(readHidden)).resolves.toBe('sk-abc');
    expect(readHidden).toHaveBeenCalledTimes(2);
  });

  it('throws an actionable error when the entries do not match', async () => {
    const readHidden = vi
      .fn()
      .mockResolvedValueOnce('sk-abc')
      .mockResolvedValueOnce('sk-xyz');
    await expect(readKeyWithConfirm(readHidden)).rejects.toThrow(/do not match/i);
  });

  it('throws an actionable error when the first entry is empty', async () => {
    const readHidden = vi.fn().mockResolvedValueOnce('');
    await expect(readKeyWithConfirm(readHidden)).rejects.toThrow(/no api key entered/i);
  });
});
