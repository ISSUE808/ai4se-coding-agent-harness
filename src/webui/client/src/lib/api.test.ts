import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSession,
  deleteKey,
  fetchConfig,
  fetchSessions,
  getKeyStatus,
  saveConfig,
  saveKey,
} from './api';

const fetchMock = vi.fn();

/** Request path of a fetch call (origin-independent assertion). */
function lastPath(callIndex = 0): string {
  return new URL(fetchMock.mock.calls[callIndex][0]).pathname;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('fetchSessions GETs /api/sessions and returns the list', async () => {
    const sessions = [{ id: 's_1', task: 't', status: 'running' }];
    fetchMock.mockResolvedValue(jsonResponse(sessions));
    const result = await fetchSessions();
    expect(result).toEqual(sessions);
    expect(lastPath()).toBe('/api/sessions');
  });

  it('createSession POSTs task and maxRounds as JSON and returns the session', async () => {
    const created = { id: 's_2', task: 't', maxRounds: 5 };
    fetchMock.mockResolvedValue(jsonResponse(created));
    const result = await createSession('t', 5);
    expect(result).toEqual(created);
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/sessions');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ task: 't', maxRounds: 5 });
  });

  it('getKeyStatus GETs /api/keys/:provider', async () => {
    const body = { provider: 'deepseek', status: '****-9f2c' };
    fetchMock.mockResolvedValue(jsonResponse(body));
    const result = await getKeyStatus('deepseek');
    expect(result).toEqual(body);
    expect(lastPath()).toBe('/api/keys/deepseek');
  });

  it('saveKey POSTs the plaintext key once, never reading it back', async () => {
    const body = { provider: 'deepseek', saved: true, masked: '****-9f2c' };
    fetchMock.mockResolvedValue(jsonResponse(body));
    const result = await saveKey('deepseek', 'sk-plain-secret');
    expect(result).toEqual(body);
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/keys/deepseek');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ apiKey: 'sk-plain-secret' });
  });

  it('deleteKey DELETEs /api/keys/:provider', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ provider: 'deepseek', removed: true }));
    const result = await deleteKey('deepseek');
    expect(result.removed).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/keys/deepseek');
    expect(init.method).toBe('DELETE');
  });

  it('fetchConfig GETs /api/config', async () => {
    const config = { llm: { provider: 'deepseek' } };
    fetchMock.mockResolvedValue(jsonResponse(config));
    const result = await fetchConfig();
    expect(result).toEqual(config);
    expect(lastPath()).toBe('/api/config');
  });

  it('saveConfig PUTs a partial config and returns the masked merged config', async () => {
    const merged = { llm: { provider: 'deepseek', apiKey: '****-9f2c' } };
    fetchMock.mockResolvedValue(jsonResponse(merged));
    const result = await saveConfig({ agent: { maxRounds: 10 } });
    expect(result).toEqual(merged);
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/config');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ agent: { maxRounds: 10 } });
  });

  it('rejects with the server error message on a failed response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'internal server error' }, false, 500));
    await expect(fetchSessions()).rejects.toThrow('internal server error');
  });
});
