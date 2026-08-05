import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createWebUIServer } from '../../src/webui/server.js';
import type { WebUIServer } from '../../src/webui/server.js';
import { InMemorySessionStore } from '../../src/webui/session-store.js';
import { createEventBus } from '../../src/events.js';
import { CredentialStore } from '../../src/credentials/store.js';
import { HITLManager } from '../../src/guardrail/hitl-manager.js';
import { DEFAULT_CONFIG } from '../../src/config/schema.js';
import type { Config } from '../../src/types.js';
import type { CredentialBackend } from '../../src/types.js';

/**
 * GET /api/llm/models integration tests (Task 26 follow-up: provider model
 * list for the Settings page and the session model selector). The provider
 * call is injected (`fetchFn`), so zero network: the Authorization header is
 * asserted to carry the stored key and the secret must never appear in any
 * response body.
 */

function memoryBackend(secrets: Record<string, string> = {}): CredentialBackend {
  const map = new Map(Object.entries(secrets));
  return {
    name: 'memory',
    async isAvailable() {
      return true;
    },
    async save(_service, account, secret) {
      map.set(account, secret);
    },
    async read(_service, account) {
      return map.get(account) ?? null;
    },
    async delete(_service, account) {
      return map.delete(account);
    },
    async exists(_service, account) {
      return map.has(account);
    },
    async list() {
      return [...map.keys()];
    },
  };
}

const openServers: WebUIServer[] = [];

afterEach(async () => {
  for (const web of openServers) {
    await web.close();
  }
  openServers.length = 0;
});

interface Fixture {
  web: WebUIServer;
  port: number;
}

async function makeFixture(config: Config, fetchFn: typeof fetch): Promise<Fixture> {
  const events = createEventBus();
  const web = createWebUIServer({
    sessionStore: new InMemorySessionStore(),
    events,
    credentialStore: new CredentialStore([memoryBackend({ deepseek: 'sk-test-123' })]),
    config,
    hitl: new HITLManager(),
    fetchFn,
  });
  const port = await web.listen(0);
  openServers.push(web);
  return { web, port };
}

const OK_BODY = JSON.stringify({
  object: 'list',
  data: [
    { id: 'deepseek-chat', object: 'model' },
    { id: 'deepseek-reasoner', object: 'model' },
  ],
});

describe('GET /api/llm/models', () => {
  it('returns the provider model list, using the stored key only in the request', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(OK_BODY, { status: 200 })) as unknown as typeof fetch;
    const { port } = await makeFixture(structuredClone(DEFAULT_CONFIG), fetchFn);
    const res = await request(`http://127.0.0.1:${port}`).get('/api/llm/models');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ models: ['deepseek-chat', 'deepseek-reasoner'] });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.deepseek.com/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test-123' }),
      }),
    );
    // The secret must never leak into the response.
    expect(JSON.stringify(res.body)).not.toContain('sk-test-123');
  });

  it('strips a trailing slash from the base URL when joining /models', async () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.llm.baseUrl = 'https://api.deepseek.com/v1/';
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(OK_BODY, { status: 200 })) as unknown as typeof fetch;
    const { port } = await makeFixture(config, fetchFn);
    const res = await request(`http://127.0.0.1:${port}`).get('/api/llm/models');
    expect(res.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledWith('https://api.deepseek.com/v1/models', expect.anything());
  });

  it('rejects 401 when no key is stored — the provider is never called', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const events = createEventBus();
    const web = createWebUIServer({
      sessionStore: new InMemorySessionStore(),
      events,
      credentialStore: new CredentialStore([memoryBackend()]),
      config: structuredClone(DEFAULT_CONFIG),
      hitl: new HITLManager(),
      fetchFn,
    });
    const port = await web.listen(0);
    openServers.push(web);
    const res = await request(`http://127.0.0.1:${port}`).get('/api/llm/models');
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('deepseek');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns 502 when the provider request fails (network)', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;
    const { port } = await makeFixture(structuredClone(DEFAULT_CONFIG), fetchFn);
    const res = await request(`http://127.0.0.1:${port}`).get('/api/llm/models');
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('api.deepseek.com');
  });

  it('returns 502 when the provider answers non-2xx', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response('unauthorized', { status: 401 })) as unknown as typeof fetch;
    const { port } = await makeFixture(structuredClone(DEFAULT_CONFIG), fetchFn);
    const res = await request(`http://127.0.0.1:${port}`).get('/api/llm/models');
    expect(res.status).toBe(502);
  });

  it('returns an empty list for a payload without a data array', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response('{"foo":1}', { status: 200 })) as unknown as typeof fetch;
    const { port } = await makeFixture(structuredClone(DEFAULT_CONFIG), fetchFn);
    const res = await request(`http://127.0.0.1:${port}`).get('/api/llm/models');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ models: [] });
  });
});
