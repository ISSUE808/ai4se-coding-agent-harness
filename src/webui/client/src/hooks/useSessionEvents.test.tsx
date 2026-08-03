import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSessionEvents, type SessionEventsState } from './useSessionEvents';
import type { SessionEventFrame } from '../lib/ws-state';
import type { SessionEventSource, SessionEventSourceHandlers } from '../lib/ws-source';
import type { SessionMessage } from '../lib/session-messages';

/** Deterministic fake event source — the hook must never touch a real WS. */
class FakeSource implements SessionEventSource {
  handlers: SessionEventSourceHandlers | null = null;
  connectCount = 0;
  disposeCount = 0;

  connect(handlers: SessionEventSourceHandlers): () => void {
    this.connectCount += 1;
    this.handlers = handlers;
    return () => {
      this.disposeCount += 1;
      this.handlers = null;
    };
  }

  emit(frame: SessionEventFrame): void {
    this.handlers?.onEvent(frame);
  }

  setConnected(connected: boolean): void {
    this.handlers?.onConnectionChange(connected);
  }
}

function message(id: string, timestamp: string, content = 'hello'): SessionMessage {
  return { id, role: 'assistant', content, timestamp };
}

function renderSessionEvents(source: FakeSource, initial?: Parameters<typeof useSessionEvents>[2]) {
  return renderHook((props) => useSessionEvents('s_1', source, props?.initial), {
    initialProps: { initial },
  });
}

describe('useSessionEvents', () => {
  it('connects the injected event source once and reports connection state', () => {
    const source = new FakeSource();
    const { result } = renderSessionEvents(source);

    expect(source.connectCount).toBe(1);
    expect(source.handlers).not.toBeNull();
    expect(result.current.wsConnected).toBe(false);

    act(() => source.setConnected(true));
    expect(result.current.wsConnected).toBe(true);
  });

  it('appends message:added frames to the message list', () => {
    const source = new FakeSource();
    const { result } = renderSessionEvents(source);

    act(() =>
      source.emit({
        type: 'message:added',
        data: { id: 'm1', role: 'tool', content: 'edited', timestamp: '2026-08-02T14:23:07.000Z' },
      }),
    );

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({ id: 'm1', role: 'tool' });
  });

  it('dedupes a REST-loaded message that the server re-broadcasts over WS', () => {
    const source = new FakeSource();
    const { result } = renderSessionEvents(source, {
      messages: [message('m1', '2026-08-02T14:23:00.000Z', 'rest-version')],
      status: 'running',
      currentRound: 1,
      maxRounds: 3,
    });

    act(() =>
      source.emit({
        type: 'message:added',
        data: { id: 'm1', role: 'assistant', content: 'ws-version', timestamp: '2026-08-02T14:24:00.000Z' },
      }),
    );

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].content).toBe('ws-version');
  });

  it('updates status from session:status and rounds from round:changed', () => {
    const source = new FakeSource();
    const { result } = renderSessionEvents(source);

    act(() => source.emit({ type: 'session:status', data: { sessionId: 's_1', status: 'paused' } }));
    act(() => source.emit({ type: 'round:changed', data: { currentRound: 13, maxRounds: 40 } }));

    expect(result.current.status).toBe('paused');
    expect(result.current.currentRound).toBe(13);
    expect(result.current.maxRounds).toBe(40);
  });

  it('surfaces warn-level guardrail triggers as pending approval and dismisses them', () => {
    const source = new FakeSource();
    const { result } = renderSessionEvents(source);

    expect(result.current.pendingApproval).toBeNull();

    act(() =>
      source.emit({
        type: 'guardrail:triggered',
        data: { rule: 'prod-mutation', command: 'npm run migrate:prod', level: 'warn' },
      }),
    );
    expect(result.current.pendingApproval).toEqual({
      rule: 'prod-mutation',
      command: 'npm run migrate:prod',
      level: 'warn',
    });

    act(() => result.current.dismissApproval());
    expect(result.current.pendingApproval).toBeNull();
  });

  it('merges a late-arriving REST snapshot without losing WS events', () => {
    const source = new FakeSource();
    type HookProps = { initial?: Parameters<typeof useSessionEvents>[2] };
    const { result, rerender } = renderHook<SessionEventsState, HookProps>(
      (props) => useSessionEvents('s_1', source, props.initial),
      { initialProps: { initial: undefined } },
    );

    act(() =>
      source.emit({
        type: 'message:added',
        data: { id: 'm3', role: 'assistant', content: 'from-ws', timestamp: '2026-08-02T14:25:00.000Z' },
      }),
    );
    rerender({
      initial: {
        messages: [
          message('m1', '2026-08-02T14:23:00.000Z', 'rest-1'),
          message('m2', '2026-08-02T14:24:00.000Z', 'rest-2'),
        ],
        status: 'running',
        currentRound: 2,
        maxRounds: 3,
      },
    });

    expect(result.current.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(result.current.currentRound).toBe(2);
  });

  it('reconnect disposes the old source and connects a fresh one', () => {
    const source = new FakeSource();
    const { result } = renderSessionEvents(source);

    act(() => result.current.reconnect());

    expect(source.disposeCount).toBe(1);
    expect(source.connectCount).toBe(2);
    expect(source.handlers).not.toBeNull();
  });

  it('disconnects the source on unmount', () => {
    const source = new FakeSource();
    const { unmount } = renderSessionEvents(source);
    expect(source.disposeCount).toBe(0);

    unmount();
    expect(source.disposeCount).toBe(1);
    expect(source.handlers).toBeNull();
  });

  it('appendMessage injects a local message and dedupes a later WS broadcast by id', () => {
    const source = new FakeSource();
    const { result } = renderSessionEvents(source);

    act(() =>
      result.current.appendMessage({
        id: 'm9',
        role: 'user',
        content: '继续',
        timestamp: '2026-08-02T14:30:00.000Z',
      }),
    );
    expect(result.current.messages).toHaveLength(1);

    act(() =>
      source.emit({
        type: 'message:added',
        data: { id: 'm9', role: 'user', content: '继续', timestamp: '2026-08-02T14:30:00.000Z' },
      }),
    );
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].content).toBe('继续');
  });

  it('ignores unknown frames without re-rendering state', () => {
    const source = new FakeSource();
    const { result } = renderSessionEvents(source);

    act(() => source.emit({ type: 'tool:executed', data: { toolName: 'x', duration_ms: 1, success: true } }));

    expect(result.current.messages).toEqual([]);
    expect(vi.isMockFunction(console.warn)).toBeFalsy();
  });

  it('a WS session:updated frame (even model null) wins over a late REST snapshot (review M2)', () => {
    const source = new FakeSource();
    const { result, rerender } = renderSessionEvents(source);

    // The WS delivers the model change BEFORE the (stale) REST snapshot merges.
    act(() =>
      source.emit({
        type: 'session:updated',
        data: { sessionId: 's_1', model: null, updatedAt: '2026-08-03T00:00:00.000Z' },
      }),
    );
    expect(result.current.model).toBeNull();

    // A late snapshot that still carries the old override must NOT resurrect it.
    rerender({
      initial: { messages: [], status: 'running', model: 'deepseek-r1' },
    });
    expect(result.current.model).toBeNull();

    // A WS-set model also wins over the snapshot value.
    act(() =>
      source.emit({
        type: 'session:updated',
        data: { sessionId: 's_1', model: 'deepseek-v3', updatedAt: '2026-08-03T00:01:00.000Z' },
      }),
    );
    expect(result.current.model).toBe('deepseek-v3');
  });

  it('seeds the model from the REST snapshot when no WS frame arrived yet (Task 26)', () => {
    const source = new FakeSource();
    const { result } = renderSessionEvents(source, {
      messages: [],
      status: 'running',
      model: 'deepseek-r1',
    });
    expect(result.current.model).toBe('deepseek-r1');
  });

  it('updateModel applies a model override locally (Task 26)', () => {
    const source = new FakeSource();
    const { result } = renderSessionEvents(source);

    act(() => result.current.updateModel('deepseek-v3'));
    expect(result.current.model).toBe('deepseek-v3');

    act(() => result.current.updateModel(null));
    expect(result.current.model).toBeNull();
  });
});
