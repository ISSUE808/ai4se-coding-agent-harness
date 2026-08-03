import { describe, expect, it } from 'vitest';
import {
  aggregateFiles,
  formatDateTime,
  languageForPath,
  mergeMessages,
  parseLineDelta,
  toolFiles,
  upsertMessage,
  type SessionMessage,
} from './session-messages';

function msg(partial: Partial<SessionMessage>): SessionMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: 'hi',
    timestamp: '2026-08-02T14:23:07.000Z',
    ...partial,
  };
}

describe('upsertMessage', () => {
  it('appends new messages in arrival order', () => {
    const a = msg({ id: 'm1' });
    const b = msg({ id: 'm2', content: 'second' });
    const result = upsertMessage([a], b);
    expect(result.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('replaces an existing message with the same id in place (dedupe)', () => {
    const a = msg({ id: 'm1', content: 'old' });
    const updated = msg({ id: 'm1', content: 'new' });
    const result = upsertMessage([a], updated);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('new');
  });

  it('keeps the original message when ids collide but the payload is identical', () => {
    const a = msg({ id: 'm1', content: 'same' });
    const result = upsertMessage([a], { ...a });
    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe(a.timestamp);
  });
});

describe('toolFiles', () => {
  it('returns an empty list for non-tool messages', () => {
    expect(toolFiles(msg({ role: 'assistant' }))).toEqual([]);
  });

  it('returns filesChanged of a tool message', () => {
    const m = msg({
      role: 'tool',
      content: 'edited',
      metadata: {
        toolName: 'edit_file',
        toolResult: { success: true, duration_ms: 5, filesChanged: ['src/a.ts', 'src/b.ts'] },
      },
    });
    expect(toolFiles(m)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('returns an empty list when toolResult has no filesChanged', () => {
    const m = msg({ role: 'tool', metadata: { toolName: 'run_command', toolResult: { success: true, duration_ms: 5 } } });
    expect(toolFiles(m)).toEqual([]);
  });
});

describe('aggregateFiles', () => {
  const edit = (id: string, files: string[], output?: string): SessionMessage =>
    msg({
      id,
      role: 'tool',
      content: 'edited',
      metadata: { toolName: 'edit_file', toolResult: { success: true, duration_ms: 5, filesChanged: files, output } },
    });

  it('marks first mention as A and repeated mentions as M', () => {
    const messages = [edit('t1', ['src/a.ts']), edit('t2', ['src/a.ts'])];
    const files = aggregateFiles(messages);
    expect(files).toEqual([{ path: 'src/a.ts', mark: 'M', addCount: 0, delCount: 0 }]);
  });

  it('collects distinct files in first-seen order', () => {
    const messages = [edit('t1', ['src/a.ts']), edit('t2', ['src/b.ts', 'src/c.ts'])];
    const files = aggregateFiles(messages);
    expect(files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(files.map((f) => f.mark)).toEqual(['A', 'A', 'A']);
  });

  it('reads the +/− line delta from the last tool output mentioning the file', () => {
    const messages = [edit('t1', ['src/a.ts'], 'applied 2 edits · +84 −32')];
    expect(aggregateFiles(messages)).toEqual([
      { path: 'src/a.ts', mark: 'A', addCount: 84, delCount: 32 },
    ]);
  });

  it('ignores non-tool messages', () => {
    const messages = [
      msg({ id: 'u1', role: 'user', content: 'please fix' }),
      edit('t1', ['src/a.ts']),
      msg({ id: 'f1', role: 'feedback', content: 'ok', metadata: { feedbackResult: { passed: true, validator: 'v', evidence: 'e' } } }),
    ];
    expect(aggregateFiles(messages).map((f) => f.path)).toEqual(['src/a.ts']);
  });
});

describe('parseLineDelta', () => {
  it('parses "+84 −32" with a U+2212 minus', () => {
    expect(parseLineDelta('applied 2 edits · +84 −32')).toEqual({ add: 84, del: 32 });
  });

  it('parses "+41 -18" with an ASCII hyphen', () => {
    expect(parseLineDelta('+41 -18')).toEqual({ add: 41, del: 18 });
  });

  it('parses an add-only delta "+127"', () => {
    expect(parseLineDelta('+127')).toEqual({ add: 127, del: 0 });
  });

  it('parses a del-only delta "−96"', () => {
    expect(parseLineDelta('deleted · −96')).toEqual({ add: 0, del: 96 });
  });

  it('returns null when no delta pattern is present', () => {
    expect(parseLineDelta('ok')).toBeNull();
    expect(parseLineDelta(undefined)).toBeNull();
  });
});

describe('languageForPath', () => {
  it('maps common extensions to monaco languages', () => {
    expect(languageForPath('src/auth/token.ts')).toBe('typescript');
    expect(languageForPath('config.json')).toBe('json');
    expect(languageForPath('README.md')).toBe('markdown');
    expect(languageForPath('style.css')).toBe('css');
  });

  it('falls back to plaintext for unknown extensions', () => {
    expect(languageForPath('Makefile')).toBe('plaintext');
    expect(languageForPath('src/data.xyz')).toBe('plaintext');
  });
});

describe('mergeMessages', () => {
  const at = (id: string, ts: string): SessionMessage => msg({ id, timestamp: ts });

  it('merges two lists, dedupes by id and sorts by timestamp', () => {
    const ws = [at('m3', '2026-08-02T14:25:00.000Z')];
    const rest = [at('m1', '2026-08-02T14:23:00.000Z'), at('m2', '2026-08-02T14:24:00.000Z')];
    expect(mergeMessages(ws, rest).map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('keeps the WS copy when ids collide (newer payload wins)', () => {
    const ws = [msg({ id: 'm1', timestamp: '2026-08-02T14:25:00.000Z', content: 'ws-version' })];
    const rest = [msg({ id: 'm1', timestamp: '2026-08-02T14:23:00.000Z', content: 'rest-version' })];
    const merged = mergeMessages(ws, rest);
    expect(merged).toHaveLength(1);
    expect(merged[0].content).toBe('ws-version');
  });

  it('does not mutate the input lists', () => {
    const ws = [at('m2', '2026-08-02T14:24:00.000Z')];
    const rest = [at('m1', '2026-08-02T14:23:00.000Z')];
    mergeMessages(ws, rest);
    expect(ws).toHaveLength(1);
    expect(rest).toHaveLength(1);
  });
});

describe('formatDateTime', () => {
  it('formats an ISO timestamp as YYYY-MM-DD HH:MM (UTC, as emitted by the server)', () => {
    expect(formatDateTime('2026-08-02T14:23:07.000Z')).toBe('2026-08-02 14:23');
  });

  it('truncates rather than re-derives, so offset timestamps stay deterministic', () => {
    expect(formatDateTime('2026-08-02T14:23:07+08:00')).toBe('2026-08-02 14:23');
  });
});
