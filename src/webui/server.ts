import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import type { IncomingMessage } from 'node:http';
import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { Config, Message, Session } from '../types.js';
import type { HarnessEvents } from '../events.js';
import type { HarnessEventMap } from '../events.js';
import type { CredentialStore } from '../credentials/store.js';
import type { HITLManager } from '../guardrail/hitl-manager.js';
import type { SessionStore } from './session-store.js';
import { createSessionsRouter } from './api/sessions.js';
import { createApprovalsRouter } from './api/approvals.js';
import { createKeysRouter } from './api/keys.js';
import { createConfigRouter } from './api/config.js';
import { createFsRouter } from './api/fs.js';
import { createModelsRouter } from './api/models.js';

/**
 * WebUI backend (PLAN Task 17, SPEC §5.1): an Express HTTP server with a
 * same-port WebSocket channel (ws `noServer` + `upgrade`). All core
 * dependencies (SessionStore, HarnessEvents, CredentialStore, Config,
 * HITLManager) are constructor-injected — never global singletons — so the
 * backend is fully testable in isolation; Task 19 wires it into the running
 * agent loop in-process.
 *
 * WebSocket framing: every HarnessEventMap event is serialized as
 * `{ type, data }` JSON. Clients may pass `?sessionId=` to filter
 * session-scoped events; events whose payload carries no sessionId
 * (`message:added`, `tool:executed`, …) are broadcast to every client.
 */

export interface WebUIServerDeps {
  sessionStore: SessionStore;
  events: HarnessEvents;
  credentialStore: CredentialStore;
  /** Merged config the server starts with (SPEC §6.1 `webui.port`). */
  config: Config;
  hitl: HITLManager;
  /** Injectable config persistence (defaults to writing the project file). */
  persistConfig?: (config: Config) => Promise<void>;
  /**
   * Task 26 follow-up: injectable fetch for GET /api/llm/models (defaults to
   * globalThis.fetch) — tests keep the provider call zero-network.
   */
  fetchFn?: typeof fetch;
  /**
   * Task 19: invoked after a session is created (POST /api/sessions) so the
   * integrated harness can run the AgentLoop on the stored session in-process.
   */
  onSessionCreated?: (session: Session) => void;
  /**
   * Task 19: invoked after an HITL decision (approve/modify/deny) so the
   * integrated harness can resume a paused session.
   */
  onApprovalResolved?: (session: Session) => void;
  /**
   * Task 19 (I2): invoked after pause/stop — the endpoint already set the
   * final status; the harness aborts the live run so the loop really halts.
   */
  onSessionControl?: (session: Session, action: 'pause' | 'stop') => void;
  /**
   * Task 19 (I2): invoked after resume so the harness really starts the loop
   * on the stored session (a status change alone would leave a fake running).
   */
  onSessionResumed?: (session: Session) => void;
  /**
   * Task 19 (user feedback): invoked after a user message is appended to an
   * existing session — the harness injects it into the loop (resumes a
   * completed/paused session, or interrupts a running one so the new
   * instruction lands in the next LLM context).
   */
  onMessageAdded?: (session: Session, message: Message) => void;
  /**
   * Task 26: invoked after PATCH /api/sessions/:id/model changed the session
   * model — the harness restarts a running session on the new model.
   */
  onModelChanged?: (session: Session) => void;
}

export interface WebUIServer {
  app: Express;
  server: Server;
  wss: WebSocketServer;
  /** Listen on `port` (0 = ephemeral); resolves with the actual port. */
  listen(port?: number): Promise<number>;
  /** Terminate WS clients and close the HTTP server. */
  close(): Promise<void>;
}

/** All event types forwarded to WebSocket clients (SPEC §5.1 WebUI). */
const EVENT_TYPES: ReadonlyArray<keyof HarnessEventMap> = [
  'message:added',
  'tool:executed',
  'feedback:completed',
  'guardrail:triggered',
  'session:status',
  'round:changed',
  'session:updated',
];

function jsonErrorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const status = typeof (err as { status?: unknown }).status === 'number'
    ? (err as { status: number }).status
    : 500;
  const message = status >= 500
    ? 'internal server error'
    : (err instanceof Error ? err.message : String(err));
  res.status(status).json({ error: message });
}

export function createWebUIServer(deps: WebUIServerDeps): WebUIServer {
  const app = express();
  app.use(express.json());

  // Task 26 follow-up: `liveConfig` is the config every router reads. The
  // config router's persistence re-points it, so routes mounted with this
  // reference (keys registry, provider model list) follow PUT /api/config —
  // the startup snapshot alone would leave them stuck on the old provider.
  let liveConfig: Config = deps.config;
  const persistConfig = async (config: Config): Promise<void> => {
    liveConfig = config;
    await deps.persistConfig?.(config);
  };

  app.use(
    '/api/sessions',
    createSessionsRouter({
      sessionStore: deps.sessionStore,
      events: deps.events,
      onSessionCreated: deps.onSessionCreated,
      onSessionControl: deps.onSessionControl,
      onSessionResumed: deps.onSessionResumed,
      onMessageAdded: deps.onMessageAdded,
      onModelChanged: deps.onModelChanged,
    }),
  );
  app.use(
    '/api/approvals',
    createApprovalsRouter({
      sessionStore: deps.sessionStore,
      hitl: deps.hitl,
      events: deps.events,
      onApprovalResolved: deps.onApprovalResolved,
    }),
  );
  app.use(
    '/api/keys',
    createKeysRouter({
      credentialStore: deps.credentialStore,
      service: deps.config.llm.apiKeyService,
      getConfig: () => liveConfig,
      persistConfig,
    }),
  );
  app.use(
    '/api/config',
    createConfigRouter({ config: deps.config, persistConfig }),
  );
  // Task 23: fs browsing (directory picker / file tree). Allowed roots = the
  // config workspace root plus every known session workspaceRoot, queried
  // live so sessions created after mount stay browseable.
  app.use(
    '/api/fs',
    createFsRouter({
      getAllowedRoots: () => [
        deps.config.agent.workspaceRoot,
        ...deps.sessionStore.list().map((session) => session.workspaceRoot),
      ],
    }),
  );
  // Task 26 follow-up: provider model list (fetched with the stored key).
  // `getConfig` reads the LIVE config so switching providers redirects the
  // fetch target (a plain `config:` snapshot would freeze the startup value).
  app.use(
    '/api/llm/models',
    createModelsRouter({
      getConfig: () => liveConfig,
      credentialStore: deps.credentialStore,
      fetchFn: deps.fetchFn,
    }),
  );

  // Unknown API paths → JSON 404 (never the HTML default)
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.use(jsonErrorHandler);

  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  // Same-port WebSocket: intercept the upgrade, only for the /ws endpoint.
  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  /** Per-client session filter (`?sessionId=`); undefined = receive all. */
  const filters = new Map<WebSocket, string | undefined>();
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    filters.set(ws, url.searchParams.get('sessionId') ?? undefined);
    ws.on('close', () => {
      filters.delete(ws);
    });
  });

  function broadcast(type: keyof HarnessEventMap, data: HarnessEventMap[keyof HarnessEventMap]): void {
    const frame = JSON.stringify({ type, data });
    for (const client of wss.clients) {
      if (client.readyState !== client.OPEN) {
        continue;
      }
      const filter = filters.get(client);
      // session:status and session:updated carry a sessionId in their payload;
      // events without one are broadcast to every connected client.
      if (
        filter !== undefined &&
        (type === 'session:status' || type === 'session:updated')
      ) {
        if ((data as { sessionId: string }).sessionId !== filter) {
          continue;
        }
      }
      client.send(frame);
    }
  }

  for (const type of EVENT_TYPES) {
    deps.events.on(type, (data) => {
      broadcast(type, data as HarnessEventMap[keyof HarnessEventMap]);
    });
  }

  function listen(port = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error): void => reject(err);
      server.once('error', onError);
      server.listen(port, () => {
        server.off('error', onError);
        const addr = server.address();
        resolve(typeof addr === 'object' && addr !== null ? addr.port : port);
      });
    });
  }

  function close(): Promise<void> {
    return new Promise((resolve) => {
      for (const client of wss.clients) {
        client.terminate();
      }
      wss.close(() => {
        server.close(() => resolve());
      });
    });
  }

  return { app, server, wss, listen, close };
}
