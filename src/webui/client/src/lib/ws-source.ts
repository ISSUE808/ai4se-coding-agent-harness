/**
 * WebSocket event source for the SessionDetail view (PLAN Task 18b).
 *
 * The backend (src/webui/server.ts) serves a same-port WebSocket at `/ws` and
 * pushes every HarnessEventMap event as a JSON frame `{ type, data }`. The
 * `SessionEventSource` interface is deliberately tiny and framework-free so
 * tests can inject a fake (see hooks/useSessionEvents.test.tsx); the browser
 * implementation below uses the native WebSocket API — no ws library needed.
 */

/** One server frame: event type + payload (payload shapes are validated in
 *  lib/ws-state.ts, never trusted at the boundary). */
export interface SessionEventFrame {
  type: string;
  data: Record<string, unknown>;
}

export interface SessionEventSourceHandlers {
  /** A parsed frame arrived. */
  onEvent(frame: SessionEventFrame): void;
  /** Transport connected / disconnected (drives the UI indicator). */
  onConnectionChange(connected: boolean): void;
}

/** Injectable transport contract. `connect` returns a dispose function. */
export interface SessionEventSource {
  connect(handlers: SessionEventSourceHandlers): () => void;
}

/**
 * Browser default: native WebSocket against the same origin the page was
 * served from (`/ws?sessionId=<id>`), mirroring the REST base in lib/api.ts.
 */
export function createWebSocketEventSource(sessionId: string): SessionEventSource {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?sessionId=${encodeURIComponent(sessionId)}`;
  return {
    connect(handlers: SessionEventSourceHandlers): () => void {
      const socket = new WebSocket(url);
      socket.onopen = () => handlers.onConnectionChange(true);
      socket.onclose = () => handlers.onConnectionChange(false);
      socket.onerror = () => handlers.onConnectionChange(false);
      socket.onmessage = (event: MessageEvent<string>) => {
        try {
          const parsed = JSON.parse(event.data) as unknown;
          if (typeof parsed === 'object' && parsed !== null && 'type' in parsed) {
            handlers.onEvent(parsed as SessionEventFrame);
          }
        } catch {
          // Non-JSON frame — ignore rather than crash the session view.
        }
      };
      return () => {
        socket.onopen = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        socket.close();
      };
    },
  };
}
