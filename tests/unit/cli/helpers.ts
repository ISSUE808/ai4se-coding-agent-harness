import { vi } from 'vitest';
import type { Command } from 'commander';
import type { CredentialBackend } from '../../../src/types.js';

/**
 * Shared test helpers for CLI tests (SPEC §A.4-C: deterministic, no real
 * keychain, no network).
 */

/**
 * Build a stateful mock CredentialBackend: `save` stores, `read` returns the
 * stored value, `delete` clears it — faithful to a real backend so flows like
 * "bootstrap a missing key then re-read it" work without mocks piling up.
 */
export function mockBackend(
  name: string,
  opts: { available?: boolean; secret?: string | null } = {},
): {
  backend: CredentialBackend;
  isAvailable: ReturnType<typeof vi.fn>;
  read: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} {
  const available = opts.available ?? true;
  let stored: string | null = 'secret' in opts ? opts.secret : null;
  const isAvailable = vi.fn(async () => available);
  const read = vi.fn(async () => stored);
  const save = vi.fn(async (_service: string, _account: string, secret: string) => {
    stored = secret;
  });
  const remove = vi.fn(async () => {
    if (stored === null) return false;
    stored = null;
    return true;
  });
  const backend: CredentialBackend = {
    name,
    isAvailable,
    read,
    save,
    delete: remove,
    exists: vi.fn(async () => stored !== null),
  };
  return { backend, isAvailable, read, save, delete: remove };
}

/** Parse a commander command with stdout/stderr captured. */
export async function parseCaptured(
  cmd: Command,
  argv: string[],
): Promise<{ out: string; err: string; thrown: unknown }> {
  const out: string[] = [];
  const err: string[] = [];
  cmd.configureOutput({
    writeOut: (s: string) => out.push(s),
    writeErr: (s: string) => err.push(s),
  });
  let thrown: unknown;
  try {
    await cmd.parseAsync(['node', 'codeharness', ...argv]);
  } catch (caught) {
    // exitOverride (e.g. --version) rejects after writing output
    thrown = caught;
  }
  return { out: out.join(''), err: err.join(''), thrown };
}
