import * as readline from 'node:readline';

/**
 * Hidden-input helpers (SPEC §4.2: key never appears in shell history or
 * terminal echo; §4.3: hidden input on first run).
 *
 * `promptHidden` masks echo on a TTY (raw mode, '*' per keystroke) and falls
 * back to a plain line read when stdin is not a TTY (CI, pipes, Docker without
 * -t). The IO is injectable so the fallback path is unit-testable.
 */

export interface PromptIO {
  stdin: NodeJS.ReadableStream & {
    isTTY?: boolean;
    isRaw?: boolean;
    setRawMode?: (mode: boolean) => void;
    resume?: () => void;
    pause?: () => void;
  };
  stdout: NodeJS.WritableStream & { isTTY?: boolean };
}

const DEFAULT_IO: PromptIO = { stdin: process.stdin, stdout: process.stdout };

/**
 * Shared per-stream line reader for the non-TTY fallback. A fresh readline
 * interface per prompt would buffer the whole piped input and lose the lines
 * of subsequent prompts (regression: `printf "a\nb\n" | codeharness key
 * update` exited before the confirm prompt resolved). One reader per stdin
 * streams lines into a queue instead.
 */
interface LineReader {
  next(): Promise<string>;
}

const lineReaders = new Map<NodeJS.ReadableStream, LineReader>();

function getLineReader(stdin: PromptIO['stdin']): LineReader {
  let reader = lineReaders.get(stdin);
  if (!reader) {
    reader = createLineReader(stdin);
    lineReaders.set(stdin, reader);
  }
  return reader;
}

function createLineReader(stdin: NodeJS.ReadableStream): LineReader {
  const queue: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  let closed = false;

  const rl = readline.createInterface({ input: stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else queue.push(line);
  });
  rl.on('close', () => {
    // EOF: no more input — pending prompts resolve to an empty line instead
    // of hanging (or the process exiting mid-prompt). Release the reader so
    // closed streams don't stay referenced for the process lifetime (C4 CR).
    closed = true;
    lineReaders.delete(stdin);
    for (const waiter of waiters.splice(0)) waiter('');
  });

  return {
    next(): Promise<string> {
      if (queue.length > 0) return Promise.resolve(queue.shift() as string);
      if (closed) return Promise.resolve('');
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

/** Read one line with echo suppressed. Empty input resolves to ''. */
export function promptHidden(label: string, io: PromptIO = DEFAULT_IO): Promise<string> {
  const { stdin, stdout } = io;
  if (!stdin.isTTY || !stdout.isTTY) {
    // Non-TTY fallback: no raw mode available; echo cannot be suppressed
    // anyway (nothing is typed in CI), so just read the line.
    stdout.write(`${label}\n`);
    return getLineReader(stdin).next();
  }

  return new Promise((resolve, reject) => {
    const wasRaw = stdin.isRaw ?? false;
    let value = '';
    let finished = false;

    const finish = (err?: Error): void => {
      if (finished) return;
      finished = true;
      stdin.off('data', onData);
      try {
        stdin.setRawMode?.(wasRaw);
      } catch {
        // TTY closed underneath us — nothing to restore
      }
      stdin.pause?.();
      stdout.write('\n');
      if (err) reject(err);
      else resolve(value);
    };

    const onData = (chunk: Buffer): void => {
      for (let i = 0; i < chunk.length; i++) {
        const byte = chunk[i];
        if (byte === 0x03) {
          // Ctrl+C — abort without resolving
          finish(new Error('Cancelled'));
          return;
        }
        if (byte === 0x0d || byte === 0x0a) {
          finish();
          return;
        }
        if (byte === 0x7f || byte === 0x08) {
          // Backspace
          value = value.slice(0, -1);
        } else if (byte >= 0x20 && byte < 0x7f) {
          value += String.fromCharCode(byte);
          stdout.write('*');
        }
        // Non-ASCII bytes are ignored (API keys are ASCII)
      }
    };

    stdout.write(label);
    stdin.setRawMode?.(true);
    stdin.resume?.();
    stdin.on('data', onData);
  });
}

/**
 * Two-pass hidden entry with confirmation (SPEC §8.2 bootstrap flow).
 * Throws actionable errors on empty input or mismatch — the caller prints
 * advice and exits non-zero.
 */
export async function readKeyWithConfirm(
  readHidden: (label: string) => Promise<string>,
): Promise<string> {
  const key = await readHidden('Enter API key: ');
  if (!key) {
    throw new Error('No API key entered. Run `codeharness key update` to try again.');
  }
  const confirm = await readHidden('Confirm API key: ');
  if (key !== confirm) {
    throw new Error('API keys do not match. Run `codeharness key update` to try again.');
  }
  return key;
}
