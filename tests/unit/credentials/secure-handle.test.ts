import { describe, it, expect } from 'vitest';
import { SecureHandle } from '../../../src/credentials/secure-handle.js';

/**
 * SecureHandle (SPEC §3.7, §4.2): the key is only reachable inside the
 * `use` closure. Outside it, the key must not be reachable by any means —
 * no property, no enumeration, no serialization.
 */
describe('SecureHandle', () => {
  const secret = 'sk-test-abc123';

  it('use() exposes the key only inside the closure', () => {
    const handle = new SecureHandle(secret);
    const seen = handle.use((key) => key);
    expect(seen).toBe(secret);
  });

  it('use() propagates the closure return value (generic T)', () => {
    const handle = new SecureHandle(secret);
    expect(handle.use((key) => key.length)).toBe(secret.length);
    expect(handle.use((key) => `len:${key.length}`)).toBe(`len:${secret.length}`);
    const parsed = handle.use((key) => ({ tail: key.slice(-4) }));
    expect(parsed).toEqual({ tail: 'c123' });
  });

  it('does not expose the key via any instance property', () => {
    const handle = new SecureHandle(secret) as unknown as Record<string, unknown>;
    expect(handle.key).toBeUndefined();
    expect('key' in handle).toBe(false);
  });

  it('does not enumerate or serialize the key', () => {
    const handle = new SecureHandle(secret);
    expect(Object.keys(handle)).toEqual([]);
    expect(JSON.stringify(handle)).toBe('{}');
  });

  it('handles with different keys are independent', () => {
    const a = new SecureHandle('aaa');
    const b = new SecureHandle('bbb');
    expect(a.use((key) => key)).toBe('aaa');
    expect(b.use((key) => key)).toBe('bbb');
  });
});
