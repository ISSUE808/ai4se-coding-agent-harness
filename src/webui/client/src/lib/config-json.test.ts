import { describe, expect, it } from 'vitest';
import { parseConfigJson } from './config-json';

describe('parseConfigJson', () => {
  it('accepts a valid JSON object', () => {
    const result = parseConfigJson('{"agent":{"maxRounds":10}}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ agent: { maxRounds: 10 } });
    }
  });

  it('rejects malformed JSON with a message', () => {
    const result = parseConfigJson('{"agent": ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('rejects valid JSON that is not an object', () => {
    expect(parseConfigJson('[1,2,3]').ok).toBe(false);
    expect(parseConfigJson('"just a string"').ok).toBe(false);
    expect(parseConfigJson('null').ok).toBe(false);
  });
});
