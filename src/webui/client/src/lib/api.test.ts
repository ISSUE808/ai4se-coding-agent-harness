import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSession,
  deleteKey,
  fetchAvailableModels,
  fetchConfig,
  fetchFsBrowse,
  fetchFsFile,
  fetchFsTree,
  fetchMachineRoots,
  fetchSession,
  fetchSessions,
  getKeyStatus,
  postMessage,
  resolveApproval,
  saveConfig,
  saveKey,
  sessionControl,
  updateSessionModel,
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

  it('createSession sends the workspaceRoot when provided (Task 19)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 's_2', task: 't', maxRounds: 0 }));
    await createSession('t', 0, '/repo/proj-a');
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/sessions');
    expect(JSON.parse(init.body)).toEqual({ task: 't', maxRounds: 0, workspaceRoot: '/repo/proj-a' });
    // Omitting workspaceRoot must not send the key at all.
    fetchMock.mockResolvedValue(jsonResponse({ id: 's_2', task: 't', maxRounds: 0 }));
    await createSession('t', 0);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ task: 't', maxRounds: 0 });
  });

  it('createSession sends the session-level model when provided (Task 26)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 's_2', task: 't', maxRounds: 0, model: 'deepseek-v3' }));
    await createSession('t', 0, undefined, 'deepseek-v3');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ task: 't', maxRounds: 0, model: 'deepseek-v3' });
    // Omitting the model must not send the key at all.
    fetchMock.mockResolvedValue(jsonResponse({ id: 's_2', task: 't', maxRounds: 0 }));
    await createSession('t', 0);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ task: 't', maxRounds: 0 });
  });

  it('updateSessionModel PATCHes the model and returns the updated session (Task 26)', async () => {
    const updated = { id: 's_1', task: 't', status: 'running', model: 'deepseek-v3' };
    fetchMock.mockResolvedValue(jsonResponse(updated));
    const result = await updateSessionModel('s_1', 'deepseek-v3');
    expect(result.model).toBe('deepseek-v3');
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/sessions/s_1/model');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ model: 'deepseek-v3' });
  });

  it('updateSessionModel clears the override with an empty string (back to default, Task 26)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 's_1', task: 't', status: 'running' }));
    await updateSessionModel('s_1', '');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ model: '' });
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

  it('saveKey carries optional registry metadata (Task 26 follow-up)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ provider: 'openai', saved: true, masked: '****-9f2c' }));
    await saveKey('openai', 'sk-plain', { baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/keys/openai');
    expect(JSON.parse(init.body)).toEqual({
      apiKey: 'sk-plain',
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o',
    });
  });

  it('saveKey omits empty registry metadata fields (Task 26 follow-up)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ provider: 'groq', saved: true, masked: '****-1111' }));
    await saveKey('groq', 'sk-g', { baseUrl: '', defaultModel: '' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ apiKey: 'sk-g' });
  });

  it('URL-encodes provider names in every key endpoint (reviewer M1)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ provider: 'x', status: 'not set' }));
    const provider = 'groq/api key';
    await getKeyStatus(provider);
    await saveKey(provider, 'sk-plain');
    await deleteKey(provider);
    const paths = fetchMock.mock.calls.map((call) => new URL(call[0]).pathname);
    const expected = '/api/keys/groq%2Fapi%20key';
    expect(paths).toEqual([expected, expected, expected]);
    // The raw provider name must never appear unencoded in a request path.
    expect(paths.join('')).not.toContain('groq/api');
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

  it('fetchAvailableModels GETs /api/llm/models', async () => {
    const body = { models: ['deepseek-chat', 'deepseek-reasoner'] };
    fetchMock.mockResolvedValue(jsonResponse(body));
    const result = await fetchAvailableModels();
    expect(result).toEqual(body);
    expect(lastPath()).toBe('/api/llm/models');
  });

  it('rejects with the server error message on a failed response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'internal server error' }, false, 500));
    await expect(fetchSessions()).rejects.toThrow('internal server error');
  });

  it('fetchSession GETs /api/sessions/:id and returns messages', async () => {
    const detail = {
      id: 's_1',
      task: 't',
      status: 'running',
      maxRounds: 3,
      currentRound: 1,
      tokenCount: 100,
      createdAt: '2026-08-02T08:00:00.000Z',
      updatedAt: '2026-08-02T08:01:00.000Z',
      messages: [{ id: 'm1', role: 'user', content: 'task', timestamp: '2026-08-02T08:00:00.000Z' }],
    };
    fetchMock.mockResolvedValue(jsonResponse(detail));
    const result = await fetchSession('s_1');
    expect(result.messages).toHaveLength(1);
    expect(lastPath()).toBe('/api/sessions/s_1');
  });

  it('postMessage POSTs a user message and returns the stored message', async () => {
    const stored = { id: 'm2', role: 'user', content: '继续', timestamp: '2026-08-02T08:02:00.000Z' };
    fetchMock.mockResolvedValue(jsonResponse(stored));
    const result = await postMessage('s_1', '继续');
    expect(result.id).toBe('m2');
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/sessions/s_1/message');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ role: 'user', content: '继续' });
  });

  it('sessionControl POSTs the action endpoint and returns the session', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 's_1', status: 'paused' }));
    const result = await sessionControl('s_1', 'pause');
    expect(result.status).toBe('paused');
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/sessions/s_1/pause');
    expect(init.method).toBe('POST');
  });

  it('sessionControl supports resume and stop actions', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 's_1', status: 'running' }));
    await sessionControl('s_1', 'resume');
    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe('/api/sessions/s_1/resume');
    fetchMock.mockResolvedValue(jsonResponse({ id: 's_1', status: 'completed' }));
    await sessionControl('s_1', 'stop');
    expect(new URL(fetchMock.mock.calls[1][0]).pathname).toBe('/api/sessions/s_1/stop');
  });

  it('resolveApproval POSTs approve without a modified command', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ sessionId: 's_1', decision: 'approve' }));
    const result = await resolveApproval('s_1', 'approve');
    expect(result.decision).toBe('approve');
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/approvals/s_1');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ decision: 'approve' });
  });

  it('resolveApproval POSTs modify with the modifiedCommand body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ sessionId: 's_1', decision: 'modify' }));
    const result = await resolveApproval('s_1', 'modify', 'npm run migrate -- --dry-run');
    expect(result.decision).toBe('modify');
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/approvals/s_1');
    expect(JSON.parse(init.body)).toEqual({ decision: 'modify', modifiedCommand: 'npm run migrate -- --dry-run' });
  });

  it('fetchFsTree GETs /api/fs/tree with the query path and returns the node', async () => {
    const tree = { path: '/repo/src', name: 'src', type: 'dir', children: [] };
    fetchMock.mockResolvedValue(jsonResponse(tree));
    const result = await fetchFsTree('/repo/src');
    expect(result).toEqual(tree);
    const [url] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/fs/tree');
    expect(new URL(url).searchParams.get('path')).toBe('/repo/src');
  });

  it('fetchFsFile GETs /api/fs/file with the query path and returns the content', async () => {
    const file = { path: '/repo/src/a.ts', name: 'a.ts', content: 'export const a = 1;', size: 20 };
    fetchMock.mockResolvedValue(jsonResponse(file));
    const result = await fetchFsFile('/repo/src/a.ts');
    expect(result).toEqual(file);
    const [url] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/fs/file');
    expect(new URL(url).searchParams.get('path')).toBe('/repo/src/a.ts');
  });

  it('fetchFsTree omits the query when path is undefined (server default root)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ path: '/repo', name: 'repo', type: 'dir' }));
    await fetchFsTree();
    expect(lastPath()).toBe('/api/fs/tree');
    expect(new URL(fetchMock.mock.calls[0][0]).search).toBe('');
  });

  it('fetchMachineRoots GETs /api/fs/browse without a path and returns the machine roots', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ roots: ['C:\\', 'D:\\'] }));
    const result = await fetchMachineRoots();
    expect(result).toEqual(['C:\\', 'D:\\']);
    expect(lastPath()).toBe('/api/fs/browse');
    expect(new URL(fetchMock.mock.calls[0][0]).search).toBe('');
  });

  it('fetchFsBrowse GETs /api/fs/browse with the query path and returns the listing', async () => {
    const listing = {
      path: 'C:\\Users',
      parent: 'C:\\',
      entries: [
        { path: 'C:\\Users\\me', name: 'me', type: 'dir' },
        { path: 'C:\\Users\\a.txt', name: 'a.txt', type: 'file', size: 3 },
        { path: 'C:\\Users\\alias', name: 'alias', type: 'link' },
      ],
    };
    fetchMock.mockResolvedValue(jsonResponse(listing));
    const result = await fetchFsBrowse('C:\\Users');
    expect(result).toEqual(listing);
    const [url] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/fs/browse');
    expect(new URL(url).searchParams.get('path')).toBe('C:\\Users');
  });
});
