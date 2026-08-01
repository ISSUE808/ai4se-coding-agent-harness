import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { promptHidden, readKeyWithConfirm } from '../../../src/cli/prompt.js';

/** Fake TTY pair: isTTY + setRawMode/resume/pause so the raw-mode path runs. */
function fakeTTY() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const rawModes: boolean[] = [];
  (stdin as unknown as { isTTY: boolean }).isTTY = true;
  (stdout as unknown as { isTTY: boolean }).isTTY = true;
  (stdin as unknown as { setRawMode: (m: boolean) => void }).setRawMode = (m: boolean) => {
    rawModes.push(m);
  };
  (stdin as unknown as { isRaw: boolean }).isRaw = false;
  let written = '';
  stdout.on('data', (chunk: Buffer) => {
    written += chunk.toString();
  });
  const type = (data: string | Buffer): void => {
    stdin.write(data);
  };
  return { stdin, stdout, rawModes, written: () => written, type };
}

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

describe('promptHidden TTY raw-mode path (I1 CR: main interactive path)', () => {
  it('masks every typed character with `*` and never echoes the value', async () => {
    const io = fakeTTY();
    const promise = promptHidden('Key: ', io as never);
    io.type('sk-secret-123\r');
    await expect(promise).resolves.toBe('sk-secret-123');
    expect(io.written()).toContain('Key: ');
    expect(io.written()).toContain('**********');
    expect(io.written()).not.toContain('sk-secret-123');
  });

  it('enters raw mode for input and restores it on finish', async () => {
    const io = fakeTTY();
    const promise = promptHidden('Key: ', io as never);
    expect(io.rawModes).toEqual([true]);
    io.type('abc\r');
    await promise;
    expect(io.rawModes).toEqual([true, false]); // restored to pre-prompt state
  });

  it('handles backspace by removing the previous character', async () => {
    const io = fakeTTY();
    const promise = promptHidden('Key: ', io as never);
    io.type('ab\x7fcd\r'); // typed a,b,backspace,c,d → "acd"
    await expect(promise).resolves.toBe('acd');
    expect(io.written()).not.toContain('ab');
  });

  it('rejects with Cancelled on Ctrl+C (0x03)', async () => {
    const io = fakeTTY();
    const promise = promptHidden('Key: ', io as never);
    io.type(Buffer.from([0x03]));
    await expect(promise).rejects.toThrow('Cancelled');
    expect(io.rawModes).toEqual([true, false]); // raw mode restored on abort
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
