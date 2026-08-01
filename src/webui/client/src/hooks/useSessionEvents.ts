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
  type InitialRuntimeState,
  type PendingApproval,
  type SessionRuntimeState,
} from '../lib/ws-state';
import { mergeMessages, upsertMessage, type SessionMessage } from '../lib/session-messages';

export interface SessionEventsState {
  messages: SessionMessage[];
  status: SessionStatus | null;
  currentRound: number | null;
  maxRounds: number | null;
  pendingApproval: PendingApproval | null;
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
  const [wsConnected, setWsConnected] = useState(false);
  const [connectionKey, setConnectionKey] = useState(0);

  // Merge a late-arriving REST snapshot exactly once (WS frames are newer).
  const initialMergedRef = useRef(false);
  useEffect(() => {
    if (!initial || initialMergedRef.current) {
      return;
    }
    initialMergedRef.current = true;
    setState((prev) => ({
      messages: mergeMessages(prev.messages, initial.messages),
      status: prev.status ?? initial.status,
      currentRound: prev.currentRound ?? initial.currentRound ?? null,
      maxRounds: prev.maxRounds ?? initial.maxRounds ?? null,
      pendingApproval: prev.pendingApproval,
    }));
  }, [initial]);

  useEffect(() => {
    let disposed = false;
    const dispose = source.connect({
      onEvent: (frame) => {
        setState((prev) => reduceSessionEvent(prev, frame));
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

  return {
    messages: state.messages,
    status: state.status,
    currentRound: state.currentRound,
    maxRounds: state.maxRounds,
    pendingApproval: state.pendingApproval,
    wsConnected,
    reconnect,
    dismissApproval,
    appendMessage,
  };
}
