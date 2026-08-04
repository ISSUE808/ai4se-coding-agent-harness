/**
 * useSessionEvents — live session state for SessionDetail (PLAN Task 18b).
 *
 * Subscribes to the session-scoped WebSocket channel (injectable transport,
 * defaults to the browser WebSocket source) and reduces every frame through
 * the pure lib/ws-state reducer. The REST snapshot (`initial`) is merged once
 * it arrives — `message:added` frames and the snapshot dedupe by message id.
 *
 * Interface (for Task 19 integration):
 *   useSessionEvents(sessionId, eventSource?, initial?)
 *   → { messages, status, currentRound, maxRounds, pendingApproval,
 *       wsConnected, reconnect, dismissApproval, appendMessage }
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionStatus } from '../lib/format';
import { createWebSocketEventSource, type SessionEventSource } from '../lib/ws-source';
import {
  createInitialRuntimeState,
  reduceSessionEvent,
  reduceTerminalEvent,
  type InitialRuntimeState,
  type PendingApproval,
  type SessionRuntimeState,
  type TerminalLine,
} from '../lib/ws-state';
import { mergeMessages, upsertMessage, type SessionMessage } from '../lib/session-messages';

export interface SessionEventsState {
  messages: SessionMessage[];
  status: SessionStatus | null;
  currentRound: number | null;
  maxRounds: number | null;
  /** Session-level model override (Task 26); null = config default. */
  model: string | null;
  pendingApproval: PendingApproval | null;
  /** Live operational log (KNOWN_ISSUES 9 终端 tab) — capped at 500 lines. */
  terminal: TerminalLine[];
  wsConnected: boolean;
  /** Tear down and re-open the transport (retry after a drop). */
  reconnect(): void;
  /** Clear the pending approval card after a successful resolution POST. */
  dismissApproval(): void;
  /**
   * Locally inject a message (composer POST response). The server also
   * broadcasts the same message via `message:added` — id dedupe keeps one.
   */
  appendMessage(message: SessionMessage): void;
  /**
   * Locally apply a model override (PATCH response, Task 26). The server
   * also broadcasts `session:updated` over WS — both paths agree.
   */
  updateModel(model: string | null): void;
}

export function useSessionEvents(
  sessionId: string,
  eventSource?: SessionEventSource,
  initial?: InitialRuntimeState,
): SessionEventsState {
  // Hold the first source identity for the component's lifetime.
  const [source] = useState<SessionEventSource>(
    () => eventSource ?? createWebSocketEventSource(sessionId),
  );
  const [state, setState] = useState<SessionRuntimeState>(() => createInitialRuntimeState(initial));
  const [terminal, setTerminal] = useState<TerminalLine[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [connectionKey, setConnectionKey] = useState(0);

  // Merge a late-arriving REST snapshot exactly once (WS frames are newer).
  const initialMergedRef = useRef(false);
  // Review M2: once a `session:updated` frame was delivered, the WS model
  // (including a null "cleared" frame) is authoritative — a late REST
  // snapshot must not resurrect an override the WS already cleared.
  const modelFrameSeenRef = useRef(false);
  useEffect(() => {
    if (!initial || initialMergedRef.current) {
      return;
    }
    initialMergedRef.current = true;
    setState((prev) => {
      // Rebuild a pending approval from the REST snapshot: the harness records
      // approvalRequired + command/rule on a system message (approval state is
      // not persisted separately), so a refresh restores the card. Only for
      // sessions still paused — a completed session's stale approval message
      // must not resurrect an unusable card ("Cannot approve in state IDLE").
      let pendingApproval = prev.pendingApproval;
      if (pendingApproval === null && (initial.status ?? prev.status) === 'paused') {
        const lastApproval = [...initial.messages]
          .reverse()
          .find((m) => m.metadata?.approvalRequired === true);
        if (lastApproval?.metadata?.guardrailCommand !== undefined) {
          pendingApproval = {
            rule:
              typeof lastApproval.metadata.guardrailRule === 'string'
                ? lastApproval.metadata.guardrailRule
                : 'unknown',
            command: lastApproval.metadata.guardrailCommand,
            level: 'warn',
          };
        }
      }
      return {
        messages: mergeMessages(prev.messages, initial.messages),
        status: prev.status ?? initial.status,
        currentRound: prev.currentRound ?? initial.currentRound ?? null,
        maxRounds: prev.maxRounds ?? initial.maxRounds ?? null,
        // M2: explicit — only seed from the snapshot when no WS
        // `session:updated` frame has been seen yet; a WS-set null (override
        // cleared) must win over the stale snapshot value.
        model: modelFrameSeenRef.current ? prev.model : (prev.model ?? initial.model ?? null),
        pendingApproval,
      };
    });
  }, [initial]);

  useEffect(() => {
    let disposed = false;
    const dispose = source.connect({
      onEvent: (frame) => {
        if (frame.type === 'session:updated') {
          modelFrameSeenRef.current = true;
        }
        setState((prev) => reduceSessionEvent(prev, frame));
        setTerminal((prev) => reduceTerminalEvent(prev, frame));
      },
      onConnectionChange: (connected) => {
        if (!disposed) {
          setWsConnected(connected);
        }
      },
    });
    return () => {
      disposed = true;
      dispose();
    };
  }, [source, connectionKey]);

  const reconnect = useCallback(() => {
    setConnectionKey((key) => key + 1);
  }, []);

  const dismissApproval = useCallback(() => {
    setState((prev) => (prev.pendingApproval ? { ...prev, pendingApproval: null } : prev));
  }, []);

  const appendMessage = useCallback((message: SessionMessage) => {
    setState((prev) => ({ ...prev, messages: upsertMessage(prev.messages, message) }));
  }, []);

  const updateModel = useCallback((model: string | null) => {
    setState((prev) => ({ ...prev, model }));
  }, []);

  return {
    messages: state.messages,
    status: state.status,
    currentRound: state.currentRound,
    maxRounds: state.maxRounds,
    model: state.model,
    pendingApproval: state.pendingApproval,
    terminal,
    wsConnected,
    reconnect,
    dismissApproval,
    appendMessage,
    updateModel,
  };
}
