import { describe, expect, it } from 'vitest';
import {
  createInitialRuntimeState,
  reduceSessionEvent,
  reduceTerminalEvent,
  type SessionEventFrame,
  type TerminalLine,
} from './ws-state';
import type { SessionMessage } from './session-messages';

function message(id: string, role: SessionMessage['role'] = 'assistant', content = 'hello'): SessionMessage {
  return { id, role, content, timestamp: '2026-08-02T14:23:07.000Z' };
}

function frame(type: string, data: Record<string, unknown>): SessionEventFrame {
  return { type, data };
}

describe('createInitialRuntimeState', () => {
  it('starts empty without initial data', () => {
    const state = createInitialRuntimeState();
    expect(state.messages).toEqual([]);
    expect(state.status).toBeNull();
    expect(state.currentRound).toBeNull();
    expect(state.pendingApproval).toBeNull();
  });

  it('seeds REST-loaded session data', () => {
    const state = createInitialRuntimeState({
      messages: [message('m1', 'user', 'task')],
      status: 'running',
      currentRound: 2,
      maxRounds: 40,
    });
    expect(state.messages.map((m) => m.id)).toEqual(['m1']);
    expect(state.status).toBe('running');
    expect(state.currentRound).toBe(2);
  });
});

describe('reduceSessionEvent — message:added', () => {
  it('appends a new message', () => {
    const next = reduceSessionEvent(createInitialRuntimeState(), frame('message:added', {
      id: 'm1', role: 'tool', content: 'done', timestamp: '2026-08-02T14:23:07.000Z',
    }));
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0]).toMatchObject({ id: 'm1', role: 'tool', content: 'done' });
  });

  it('dedupes by id against the REST-loaded list (server broadcasts message:added)', () => {
    const state = createInitialRuntimeState({ messages: [message('m1')], status: 'running' });
    const next = reduceSessionEvent(state, frame('message:added', {
      id: 'm1', role: 'tool', content: 'updated', timestamp: '2026-08-02T14:24:00.000Z',
    }));
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].content).toBe('updated');
  });

  it('keeps tool metadata (toolName, toolInput, toolResult) attached', () => {
    const next = reduceSessionEvent(createInitialRuntimeState(), frame('message:added', {
      id: 'm2', role: 'tool', content: 'ok', timestamp: '2026-08-02T14:23:07.000Z',
      metadata: { toolName: 'edit_file', toolInput: { path: 'src/a.ts' }, toolResult: { success: true, duration_ms: 5, filesChanged: ['src/a.ts'] } },
    }));
    expect(next.messages[0].metadata?.toolName).toBe('edit_file');
    expect(next.messages[0].metadata?.toolResult?.filesChanged).toEqual(['src/a.ts']);
  });
});

describe('reduceSessionEvent — session:status', () => {
  it('updates the session status', () => {
    const next = reduceSessionEvent(createInitialRuntimeState(), frame('session:status', { sessionId: 's1', status: 'paused' }));
    expect(next.status).toBe('paused');
  });

  it('ignores an unknown status value', () => {
    const state = createInitialRuntimeState({ messages: [], status: 'running' });
    const next = reduceSessionEvent(state, frame('session:status', { sessionId: 's1', status: 'teleported' }));
    expect(next.status).toBe('running');
  });
});

describe('reduceSessionEvent — round:changed', () => {
  it('updates round progress', () => {
    const next = reduceSessionEvent(createInitialRuntimeState(), frame('round:changed', { currentRound: 13, maxRounds: 40 }));
    expect(next.currentRound).toBe(13);
    expect(next.maxRounds).toBe(40);
  });
});

describe('reduceSessionEvent — session:updated (Task 26)', () => {
  it('seeds the model from the REST snapshot', () => {
    const state = createInitialRuntimeState({ messages: [], status: 'running', model: 'deepseek-r1' });
    expect(state.model).toBe('deepseek-r1');
  });

  it('starts with no model when the snapshot has none (config default)', () => {
    const state = createInitialRuntimeState({ messages: [], status: 'running' });
    expect(state.model).toBeNull();
  });

  it('updates the model from a session:updated frame', () => {
    const next = reduceSessionEvent(
      createInitialRuntimeState(),
      frame('session:updated', { sessionId: 's1', model: 'deepseek-v3', updatedAt: '2026-08-03T00:00:00.000Z' }),
    );
    expect(next.model).toBe('deepseek-v3');
  });

  it('clears the model when the payload carries null (back to the config default)', () => {
    const state = createInitialRuntimeState({ messages: [], status: 'running', model: 'deepseek-v3' });
    const next = reduceSessionEvent(state, frame('session:updated', { sessionId: 's1', model: null }));
    expect(next.model).toBeNull();
  });

  it('ignores an invalid model payload', () => {
    const state = createInitialRuntimeState({ messages: [], status: 'running', model: 'deepseek-v3' });
    const next = reduceSessionEvent(state, frame('session:updated', { sessionId: 's1', model: 42 }));
    expect(next.model).toBe('deepseek-v3');
  });
});

describe('reduceSessionEvent — guardrail:triggered', () => {
  it('records a warn-level command as pending human approval', () => {
    const next = reduceSessionEvent(createInitialRuntimeState(), frame('guardrail:triggered', {
      rule: 'prod-mutation', command: 'npm run migrate:prod', level: 'warn',
    }));
    expect(next.pendingApproval).toEqual({ rule: 'prod-mutation', command: 'npm run migrate:prod', level: 'warn' });
  });

  it('does not surface block-level commands for approval', () => {
    const next = reduceSessionEvent(createInitialRuntimeState(), frame('guardrail:triggered', {
      rule: 'no-network', command: 'curl http://x', level: 'block',
    }));
    expect(next.pendingApproval).toBeNull();
  });
});

describe('reduceSessionEvent — malformed input', () => {
  it('ignores unknown event types without touching state', () => {
    const state = createInitialRuntimeState({ messages: [message('m1')], status: 'running' });
    const next = reduceSessionEvent(state, frame('tool:executed', { toolName: 'x' }));
    expect(next).toBe(state);
  });

  it('ignores frames with non-object data', () => {
    const state = createInitialRuntimeState({ messages: [], status: 'running' });
    const next = reduceSessionEvent(state, { type: 'session:status', data: 'paused' as unknown as Record<string, unknown> });
    expect(next).toBe(state);
  });
});

describe('reduceTerminalEvent — KNOWN_ISSUES 9 终端 tab', () => {
  it('renders a tool:executed line with result and duration', () => {
    const next = reduceTerminalEvent([], frame('tool:executed', {
      toolName: 'read_file', duration_ms: 12, success: true,
    }));
    expect(next).toHaveLength(1);
    expect(next[0].kind).toBe('tool');
    expect(next[0].text).toContain('read_file');
    expect(next[0].text).toContain('12ms');
  });

  it('renders failed tools with ✗ and feedback failures with the category', () => {
    let next = reduceTerminalEvent([], frame('tool:executed', {
      toolName: 'run_shell', duration_ms: 3, success: false,
    }));
    expect(next[0].text).toContain('✗');
    next = reduceTerminalEvent(next, frame('feedback:completed', {
      passed: false, validator: 'tsc', failureCategory: 'type',
    }));
    expect(next[1].kind).toBe('feedback');
    expect(next[1].text).toContain('tsc');
    expect(next[1].text).toContain('type');
  });

  it('renders guardrail, round and status lines', () => {
    let next = reduceTerminalEvent([], frame('guardrail:triggered', {
      rule: 'prod-mutation', command: 'npm run migrate:prod', level: 'warn',
    }));
    expect(next[0].text).toContain('prod-mutation');
    next = reduceTerminalEvent(next, frame('round:changed', { currentRound: 2, maxRounds: 5 }));
    expect(next[1].text).toContain('2/5');
    next = reduceTerminalEvent(next, frame('session:status', { sessionId: 's1', status: 'running' }));
    expect(next[2].text).toContain('running');
  });

  it('ignores message:added frames (the message feed owns those)', () => {
    const next = reduceTerminalEvent([], frame('message:added', {
      id: 'm1', role: 'user', content: 'hi', timestamp: 't',
    }));
    expect(next).toHaveLength(0);
  });

  it('caps the stream at 500 lines', () => {
    let lines: TerminalLine[] = [];
    for (let i = 0; i < 505; i += 1) {
      lines = reduceTerminalEvent(lines, frame('round:changed', { currentRound: i, maxRounds: 1000 }));
    }
    expect(lines).toHaveLength(500);
    expect(lines[0].text).toContain('5/1000');
  });
});

describe('reduceTerminalEvent — reviewer fixes', () => {
  it('keeps line ids unique past the 500-line cap (reviewer Important)', () => {
    let lines: TerminalLine[] = [];
    for (let i = 0; i < 505; i += 1) {
      lines = reduceTerminalEvent(lines, frame('round:changed', { currentRound: i, maxRounds: 1000 }));
    }
    expect(lines).toHaveLength(500);
    const ids = new Set(lines.map((l) => l.id));
    expect(ids.size).toBe(500);
  });

  it('stamps lines with the injected now timestamp (reviewer Important)', () => {
    const next = reduceTerminalEvent(
      [],
      frame('tool:executed', { toolName: 'read_file', duration_ms: 1, success: true }),
      '2026-08-04T08:00:00.000Z',
    );
    expect(next[0].timestamp).toBe('2026-08-04T08:00:00.000Z');
  });
});
