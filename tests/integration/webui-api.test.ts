import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { WebSocket } from 'ws';
import { createWebUIServer } from '../../src/webui/server.js';
import type { WebUIServer } from '../../src/webui/server.js';
import { InMemorySessionStore } from '../../src/webui/session-store.js';
import type { SessionStore } from '../../src/webui/session-store.js';
import { createEventBus } from '../../src/events.js';
import type { HarnessEvents } from '../../src/events.js';
import { CredentialStore } from '../../src/credentials/store.js';
import { HITLManager, HITLState } from '../../src/guardrail/hitl-manager.js';
import { DEFAULT_CONFIG } from '../../src/config/schema.js';
import type { Config } from '../../src/types.js';
import type { CredentialBackend } from '../../src/types.js';

/**
 * WebUI API integration tests (PLAN Task 17, SPEC §5.1).
 * All dependencies are in-memory: InMemorySessionStore, an in-memory
 * credential backend, a real event bus, and a real HITLManager. Zero network,
 * zero real LLM, zero keychain. Secrets never appear in any response body.
 */

/** In-memory CredentialBackend so POST/GET/DELETE /api/keys round-trip. */
function memoryBackend(): CredentialBackend {
  const secrets = new Map<string, string>();
  return {
    name: 'memory',
    async isAvailable() {
      return true;
    },
    async save(_service, account, secret) {
      secrets.set(account, secret);
    },
    async read(_service, account) {
      return secrets.get(account) ?? null;
    },
    async delete(_service, account) {
      return secrets.delete(account);
    },
    async exists(_service, account) {
      return secrets.has(account);
    },
  };
}

interface Fixture {
  web: WebUIServer;
  port: number;
  events: HarnessEvents;
  sessionStore: SessionStore;
  credentialStore: CredentialStore;
  hitl: HITLManager;
  getPersisted: () => Config | null;
}

const openSockets: WebSocket[] = [];
const openServers: WebUIServer[] = [];

afterEach(async () => {
  for (const ws of openSockets) {
    ws.terminate();
  }
  openSockets.length = 0;
  for (const web of openServers) {
    await web.close();
  }
  openServers.length = 0;
});

async function makeFixture(config?: Config): Promise<Fixture> {
  const events = createEventBus();
  const sessionStore = new InMemorySessionStore();
  const credentialStore = new CredentialStore([memoryBackend()]);
  const hitl = new HITLManager();
  let persisted: Config | null = null;
  const web = createWebUIServer({
    sessionStore,
    events,
    credentialStore,
    config: config ?? structuredClone(DEFAULT_CONFIG),
    hitl,
    persistConfig: async (c: Config) => {
      persisted = structuredClone(c);
    },
  });
  const port = await web.listen(0);
  openServers.push(web);
  return { web, port, events, sessionStore, credentialStore, hitl, getPersisted: () => persisted };
}

function wsConnect(port: number, query = '', path = '/ws'): Promise<WebSocket & { messages: string[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}${query}`);
    const messages: string[] = [];
    ws.on('message', (raw) => messages.push(raw.toString()));
    ws.on('open', () => {
      openSockets.push(ws);
      resolve(Object.assign(ws, { messages }));
    });
    ws.on('error', reject);
  });
}

interface WsFrame {
  type: string;
  data: Record<string, unknown>;
}

/** Wait for a frame matching `predicate`; checks already-received frames first. */
function nextEvent(
  ws: WebSocket & { messages: string[] },
  predicate: (frame: WsFrame) => boolean,
  timeoutMs = 3000,
): Promise<WsFrame> {
  const existing = ws.messages.map((m) => JSON.parse(m) as WsFrame).find(predicate);
  if (existing) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error('timeout waiting for WS event'));
    }, timeoutMs);
    function onMsg(raw: Buffer): void {
      const frame = JSON.parse(raw.toString()) as WsFrame;
      if (predicate(frame)) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(frame);
      }
    }
    ws.on('message', onMsg);
  });
}

const silence = (ms: number) => new Promise((r) => setTimeout(r, ms));

function secretConfig(): Config {
  return {
    ...structuredClone(DEFAULT_CONFIG),
    llm: { ...DEFAULT_CONFIG.llm, apiKey: 'sk-top-secret-1234' },
    webui: { ...DEFAULT_CONFIG.webui, token: 'tok-9abc' },
  } as unknown as Config;
}

describe('REST /api/sessions', () => {
  it('POST /api/sessions creates a session with an initial user message', async () => {
    const { web } = await makeFixture();
    const res = await request(web.app).post('/api/sessions').send({ task: 'Fix the test suite' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTypeOf('string');
    expect(res.body.task).toBe('Fix the test suite');
    expect(res.body.status).toBe('running');
    expect(res.body.maxRounds).toBe(DEFAULT_CONFIG.agent.maxRounds);
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0].role).toBe('user');
    expect(res.body.messages[0].content).toBe('Fix the test suite');
  });

  it('POST /api/sessions rejects a missing or empty task with 400 JSON', async () => {
    const { web } = await makeFixture();
    const missing = await request(web.app).post('/api/sessions').send({});
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBeTypeOf('string');
    const empty = await request(web.app).post('/api/sessions').send({ task: '   ' });
    expect(empty.status).toBe(400);
  });

  it('GET /api/sessions lists all created sessions', async () => {
    const { web } = await makeFixture();
    await request(web.app).post('/api/sessions').send({ task: 'task A' });
    await request(web.app).post('/api/sessions').send({ task: 'task B' });
    const res = await request(web.app).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((s: { task: string }) => s.task).sort()).toEqual(['task A', 'task B']);
  });

  it('GET /api/sessions/:id returns the session; unknown id is 404 JSON', async () => {
    const { web } = await makeFixture();
    const created = await request(web.app).post('/api/sessions').send({ task: 'detail me' });
    const id = created.body.id as string;
    const res = await request(web.app).get(`/api/sessions/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    const missing = await request(web.app).get('/api/sessions/nope');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBeTypeOf('string');
  });

  it('POST /api/sessions/:id/message appends a message and returns it', async () => {
    const { web } = await makeFixture();
    const created = await request(web.app).post('/api/sessions').send({ task: 'msg me' });
    const id = created.body.id as string;
    const res = await request(web.app)
      .post(`/api/sessions/${id}/message`)
      .send({ role: 'assistant', content: 'hello from the agent' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeTypeOf('string');
    expect(res.body.timestamp).toBeTypeOf('string');
    expect(res.body.content).toBe('hello from the agent');
    const detail = await request(web.app).get(`/api/sessions/${id}`);
    expect(detail.body.messages).toHaveLength(2);
    expect(detail.body.messages[1].role).toBe('assistant');
  });

  it('POST message validates role and 404s for an unknown session', async () => {
    const { web } = await makeFixture();
    const created = await request(web.app).post('/api/sessions').send({ task: 'validate' });
    const id = created.body.id as string;
    const badRole = await request(web.app)
      .post(`/api/sessions/${id}/message`)
      .send({ role: 'martian', content: 'hi' });
    expect(badRole.status).toBe(400);
    const badContent = await request(web.app)
      .post(`/api/sessions/${id}/message`)
      .send({ role: 'user', content: '' });
    expect(badContent.status).toBe(400);
    const missing = await request(web.app)
      .post('/api/sessions/ghost/message')
      .send({ role: 'user', content: 'hi' });
    expect(missing.status).toBe(404);
  });

  it('pause → resume → stop transition the session status', async () => {
    const { web } = await makeFixture();
    const created = await request(web.app).post('/api/sessions').send({ task: 'control me' });
    const id = created.body.id as string;
    const paused = await request(web.app).post(`/api/sessions/${id}/pause`);
    expect(paused.status).toBe(200);
    expect(paused.body.status).toBe('paused');
    const resumed = await request(web.app).post(`/api/sessions/${id}/resume`);
    expect(resumed.body.status).toBe('running');
    const stopped = await request(web.app).post(`/api/sessions/${id}/stop`);
    expect(stopped.status).toBe(200);
    expect(stopped.body.status).toBe('completed');
  });

  it('invalid state transitions return 409; unknown session 404', async () => {
    const { web } = await makeFixture();
    const created = await request(web.app).post('/api/sessions').send({ task: 'edge' });
    const id = created.body.id as string;
    await request(web.app).post(`/api/sessions/${id}/stop`);
    const pauseAfterStop = await request(web.app).post(`/api/sessions/${id}/pause`);
    expect(pauseAfterStop.status).toBe(409);
    expect(pauseAfterStop.body.error).toContain('completed');
    const resumeBeforePause = await request(web.app).post(`/api/sessions/${id}/resume`);
    expect(resumeBeforePause.status).toBe(409);
    const stopAgain = await request(web.app).post(`/api/sessions/${id}/stop`);
    expect(stopAgain.status).toBe(409);
    const ghost = await request(web.app).post('/api/sessions/ghost/pause');
    expect(ghost.status).toBe(404);
  });
});

describe('REST /api/approvals', () => {
  it('approve moves HITL to EXECUTING and records the approved command', async () => {
    const { web, hitl, sessionStore } = await makeFixture();
    hitl.requestApproval('rm -rf /');
    const created = await request(web.app).post('/api/sessions').send({ task: 'hitl' });
    const id = created.body.id as string;
    const res = await request(web.app)
      .post(`/api/approvals/${id}`)
      .send({ decision: 'approve' });
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('approve');
    expect(res.body.state).toBe(HITLState.EXECUTING);
    expect(hitl.getState()).toBe(HITLState.EXECUTING);
    const session = sessionStore.get(id);
    expect(session?.messages.some((m) => m.content.includes('rm -rf /'))).toBe(true);
  });

  it('modify requires modifiedCommand and records it', async () => {
    const { web, hitl, sessionStore } = await makeFixture();
    hitl.requestApproval('rm -rf /');
    const created = await request(web.app).post('/api/sessions').send({ task: 'hitl' });
    const id = created.body.id as string;
    const noCommand = await request(web.app)
      .post(`/api/approvals/${id}`)
      .send({ decision: 'modify' });
    expect(noCommand.status).toBe(400);
    const res = await request(web.app)
      .post(`/api/approvals/${id}`)
      .send({ decision: 'modify', modifiedCommand: 'rm -rf /tmp/scratch' });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe(HITLState.EXECUTING_MODIFIED);
    expect(hitl.getState()).toBe(HITLState.EXECUTING_MODIFIED);
    const session = sessionStore.get(id);
    expect(session?.messages.some((m) => m.content.includes('/tmp/scratch'))).toBe(true);
  });

  it('deny blocks the pending command and records the denial', async () => {
    const { web, hitl, sessionStore } = await makeFixture();
    hitl.requestApproval('rm -rf /');
    const created = await request(web.app).post('/api/sessions').send({ task: 'hitl' });
    const id = created.body.id as string;
    const res = await request(web.app)
      .post(`/api/approvals/${id}`)
      .send({ decision: 'deny' });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe(HITLState.BLOCKED);
    expect(hitl.getState()).toBe(HITLState.BLOCKED);
    const session = sessionStore.get(id);
    expect(session?.messages.some((m) => m.content.toLowerCase().includes('denied'))).toBe(true);
  });

  it('rejects an invalid decision with 400', async () => {
    const { web } = await makeFixture();
    const created = await request(web.app).post('/api/sessions').send({ task: 'hitl' });
    const id = created.body.id as string;
    const res = await request(web.app)
      .post(`/api/approvals/${id}`)
      .send({ decision: 'maybe' });
    expect(res.status).toBe(400);
  });

  it('returns 409 when HITL is not awaiting approval', async () => {
    const { web } = await makeFixture();
    const created = await request(web.app).post('/api/sessions').send({ task: 'hitl' });
    const id = created.body.id as string;
    const res = await request(web.app)
      .post(`/api/approvals/${id}`)
      .send({ decision: 'approve' });
    expect(res.status).toBe(409);
  });

  it('returns 404 for an unknown session', async () => {
    const { web, hitl } = await makeFixture();
    hitl.requestApproval('rm -rf /');
    const res = await request(web.app)
      .post('/api/approvals/ghost')
      .send({ decision: 'approve' });
    expect(res.status).toBe(404);
  });
});

describe('REST /api/keys', () => {
  it('GET reports "not set" before a key exists', async () => {
    const { web } = await makeFixture();
    const res = await request(web.app).get('/api/keys/deepseek');
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('deepseek');
    expect(res.body.status).toBe('not set');
  });

  it('POST stores the key and never echoes plaintext', async () => {
    const { web, credentialStore } = await makeFixture();
    const res = await request(web.app)
      .post('/api/keys/deepseek')
      .send({ apiKey: 'sk-secret-abcd1' });
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('deepseek');
    expect(res.body.masked).toBe('****-bcd1');
    expect(JSON.stringify(res.body)).not.toContain('sk-secret-abcd1');
    expect(await credentialStore.get('codeharness/deepseek', 'deepseek').catch(() => null)).not.toBeNull();
  });

  it('GET returns the masked key after save, never plaintext', async () => {
    const { web } = await makeFixture();
    await request(web.app).post('/api/keys/deepseek').send({ apiKey: 'sk-secret-abcd1' });
    const res = await request(web.app).get('/api/keys/deepseek');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('****-bcd1');
    expect(JSON.stringify(res.body)).not.toContain('sk-secret-abcd1');
  });

  it('POST rejects a missing or empty apiKey with 400', async () => {
    const { web } = await makeFixture();
    const missing = await request(web.app).post('/api/keys/deepseek').send({});
    expect(missing.status).toBe(400);
    const empty = await request(web.app).post('/api/keys/deepseek').send({ apiKey: '' });
    expect(empty.status).toBe(400);
  });

  it('DELETE removes the key; second DELETE is 404', async () => {
    const { web } = await makeFixture();
    await request(web.app).post('/api/keys/deepseek').send({ apiKey: 'sk-secret-abcd1' });
    const del = await request(web.app).delete('/api/keys/deepseek');
    expect(del.status).toBe(200);
    expect(del.body.removed).toBe(true);
    const after = await request(web.app).get('/api/keys/deepseek');
    expect(after.body.status).toBe('not set');
    const again = await request(web.app).delete('/api/keys/deepseek');
    expect(again.status).toBe(404);
  });
});

describe('REST /api/config', () => {
  it('GET returns the merged config with secrets masked', async () => {
    const { web } = await makeFixture(secretConfig());
    const res = await request(web.app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.llm.provider).toBe('deepseek');
    expect(res.body.llm.apiKey).toBe('****-1234');
    expect(res.body.webui.token).toBe('****-9abc');
    expect(JSON.stringify(res.body)).not.toContain('sk-top-secret-1234');
    expect(JSON.stringify(res.body)).not.toContain('tok-9abc');
  });

  it('GET reports "not set" when no token is configured', async () => {
    const { web } = await makeFixture();
    const res = await request(web.app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.webui.token).toBe('not set');
  });

  it('PUT merges partial updates, persists, and masks secrets in the response', async () => {
    const { web, getPersisted } = await makeFixture(secretConfig());
    const res = await request(web.app)
      .put('/api/config')
      .send({ webui: { port: 4000 }, agent: { maxRounds: 7 } });
    expect(res.status).toBe(200);
    expect(res.body.webui.port).toBe(4000);
    expect(res.body.agent.maxRounds).toBe(7);
    // Defaults from other branches survive the merge
    expect(res.body.llm.provider).toBe('deepseek');
    // Response is still masked
    expect(res.body.llm.apiKey).toBe('****-1234');
    expect(JSON.stringify(res.body)).not.toContain('sk-top-secret-1234');
    // The persisted config holds the merged values
    const persisted = getPersisted();
    expect(persisted?.webui.port).toBe(4000);
    expect(persisted?.agent.maxRounds).toBe(7);
  });

  it('PUT rejects a non-object body with 400', async () => {
    const { web } = await makeFixture();
    // A JSON array parses cleanly but is not a valid config overlay
    const res = await request(web.app).put('/api/config').send([1, 2, 3]);
    expect(res.status).toBe(400);
  });

  it('PUT rejects llm.apiKey / webui.token with 400 — SPEC §3.6: config never holds keys', async () => {
    const { web, getPersisted } = await makeFixture(secretConfig());
    const keyRes = await request(web.app).put('/api/config').send({ llm: { apiKey: 'sk-leak' } });
    expect(keyRes.status).toBe(400);
    expect(keyRes.body.error).toContain('/api/keys');
    const tokenRes = await request(web.app).put('/api/config').send({ webui: { token: 'tok-leak' } });
    expect(tokenRes.status).toBe(400);
    // Non-secret fields in the same body are also rejected (whole-request 400)
    const mixed = await request(web.app).put('/api/config').send({
      webui: { port: 4000, token: 'tok-leak' },
    });
    expect(mixed.status).toBe(400);
    // Nothing was persisted
    const persisted = getPersisted();
    expect(persisted).toBeNull();
    expect(JSON.stringify(persisted)).not.toContain('sk-leak');
  });
});

describe('WebSocket /ws', () => {
  it('forwards all six HarnessEventMap event types as JSON frames', async () => {
    const { web, port, events } = await makeFixture();
    const ws = await wsConnect(port);
    events.emit('message:added', { id: 'm1', role: 'user', content: 'hi', timestamp: 't1' });
    await nextEvent(ws, (f) => f.type === 'message:added' && f.data.id === 'm1');
    events.emit('tool:executed', { toolName: 'run_shell', duration_ms: 12, success: true });
    await nextEvent(ws, (f) => f.type === 'tool:executed' && f.data.toolName === 'run_shell');
    events.emit('feedback:completed', { passed: true, validator: 'tsc', failureCategory: undefined });
    await nextEvent(ws, (f) => f.type === 'feedback:completed' && f.data.passed === true);
    events.emit('guardrail:triggered', { rule: 'rm_rf', command: 'rm -rf /', level: 'warn' });
    await nextEvent(ws, (f) => f.type === 'guardrail:triggered' && f.data.rule === 'rm_rf');
    events.emit('session:status', { sessionId: 's1', status: 'paused' });
    const frame = await nextEvent(ws, (f) => f.type === 'session:status' && f.data.sessionId === 's1');
    expect(frame.data.status).toBe('paused');
    events.emit('round:changed', { currentRound: 2, maxRounds: 5 });
    await nextEvent(ws, (f) => f.type === 'round:changed' && f.data.currentRound === 2);
  });

  it('filters session:status by the ?sessionId= query parameter', async () => {
    const { web, port, events } = await makeFixture();
    const a = await wsConnect(port, '?sessionId=s1');
    const b = await wsConnect(port, '?sessionId=s2');
    const c = await wsConnect(port); // no filter — receives everything

    events.emit('session:status', { sessionId: 's1', status: 'running' });
    await nextEvent(a, (f) => f.type === 'session:status' && f.data.sessionId === 's1');
    await nextEvent(c, (f) => f.type === 'session:status' && f.data.sessionId === 's1');
    await silence(100);
    // b filtered on s2 must not receive the s1 frame
    expect(
      b.messages.filter(
        (m) =>
          (JSON.parse(m) as WsFrame).type === 'session:status' &&
          (JSON.parse(m) as WsFrame).data.sessionId === 's1',
      ),
    ).toEqual([]);

    events.emit('session:status', { sessionId: 's2', status: 'paused' });
    await nextEvent(b, (f) => f.type === 'session:status' && f.data.sessionId === 's2');
    await nextEvent(c, (f) => f.type === 'session:status' && f.data.sessionId === 's2');
    await silence(100);
    // a filtered on s1 must not receive the s2 frame
    expect(
      a.messages.filter(
        (m) =>
          (JSON.parse(m) as WsFrame).type === 'session:status' &&
          (JSON.parse(m) as WsFrame).data.sessionId === 's2',
      ),
    ).toEqual([]);
  });

  it('broadcasts events without sessionId to every connected client', async () => {
    const { web, port, events } = await makeFixture();
    const a = await wsConnect(port, '?sessionId=s1');
    const b = await wsConnect(port, '?sessionId=s2');
    events.emit('message:added', { id: 'm9', role: 'user', content: 'broadcast', timestamp: 't9' });
    await nextEvent(a, (f) => f.type === 'message:added' && f.data.id === 'm9');
    await nextEvent(b, (f) => f.type === 'message:added' && f.data.id === 'm9');
  });

  it('cleans up disconnected clients and keeps serving the rest', async () => {
    const { web, port, events } = await makeFixture();
    const a = await wsConnect(port);
    const b = await wsConnect(port);
    expect(web.wss.clients.size).toBe(2);
    a.close();
    await silence(100);
    expect(web.wss.clients.size).toBe(1);
    events.emit('message:added', { id: 'm10', role: 'user', content: 'still alive', timestamp: 't10' });
    await nextEvent(b, (f) => f.type === 'message:added' && f.data.id === 'm10');
  });

  it('rejects non-/ws upgrade paths', async () => {
    const { port } = await makeFixture();
    await expect(wsConnect(port, '', '/other')).rejects.toThrow();
  });
});

describe('error handling middleware', () => {
  it('returns JSON 404 for unknown /api routes', async () => {
    const { web } = await makeFixture();
    const res = await request(web.app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.error).toBeTypeOf('string');
  });

  it('returns JSON 400 for malformed JSON bodies', async () => {
    const { web } = await makeFixture();
    const res = await request(web.app)
      .post('/api/sessions')
      .set('Content-Type', 'application/json')
      .send('{not json');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/json');
  });
});
