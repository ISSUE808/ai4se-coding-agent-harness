import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { createWebUIServer } from '../../src/webui/server.js';
import type { WebUIServer } from '../../src/webui/server.js';
import { InMemorySessionStore } from '../../src/webui/session-store.js';
import { createEventBus } from '../../src/events.js';
import { CredentialStore } from '../../src/credentials/store.js';
import { HITLManager } from '../../src/guardrail/hitl-manager.js';
import { DEFAULT_CONFIG } from '../../src/config/schema.js';
import type { CredentialBackend } from '../../src/types.js';

/** 内存凭据后端（同 webui-api.test.ts 模式）——零 keychain、零网络。 */
function memoryBackend(): CredentialBackend {
  const secrets = new Map<string, string>();
  return {
    name: 'memory',
    async isAvailable() { return true; },
    async save(_service, account, secret) { secrets.set(account, secret); },
    async read(_service, account) { return secrets.get(account) ?? null; },
    async delete(_service, account) { return secrets.delete(account); },
    async exists(_service, account) { return secrets.has(account); },
    async list() { return [...secrets.keys()]; },
  };
}

const openServers: WebUIServer[] = [];
afterEach(async () => {
  for (const web of openServers) await web.close();
  openServers.length = 0;
});

/** 构造带 staticDir 的 WebUI server；fixture 临时目录模拟 vite build 产物。 */
async function makeStaticServer(staticDir: string): Promise<WebUIServer> {
  const web = createWebUIServer({
    sessionStore: new InMemorySessionStore(DEFAULT_CONFIG.agent.maxRounds, DEFAULT_CONFIG.agent.workspaceRoot),
    events: createEventBus(),
    credentialStore: new CredentialStore(memoryBackend()),
    config: DEFAULT_CONFIG,
    hitl: new HITLManager(),
    staticDir,
  });
  openServers.push(web);
  await web.listen(0);
  return web;
}

describe('WebUI 生产模式静态服务', () => {
  it('静态文件按 vite build 布局服务（/ → index.html，/assets/x.js → 内容）', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-webui-dist-'));
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>CodeHarness</title>');
    fs.mkdirSync(path.join(root, 'assets'));
    fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'console.log(1);');
    const web = await makeStaticServer(root);
    const home = await request(web.app).get('/');
    expect(home.status).toBe(200);
    expect(home.text).toContain('CodeHarness');
    const asset = await request(web.app).get('/assets/app.js');
    expect(asset.status).toBe(200);
    expect(asset.text).toBe('console.log(1);');
  });

  it('SPA fallback：非 API 的 GET 一律回 index.html（react-router 深链）', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-webui-dist-'));
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>SPA</title>');
    const web = await makeStaticServer(root);
    const res = await request(web.app).get('/sessions/abc-123');
    expect(res.status).toBe(200);
    expect(res.text).toContain('SPA');
  });

  it('/api 请求不被 SPA fallback 劫持（仍返回 JSON 404）', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-webui-dist-'));
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>SPA</title>');
    const web = await makeStaticServer(root);
    const res = await request(web.app).get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('staticDir 缺省时保持 API-only（GET / 不服务 HTML）', async () => {
    const web = createWebUIServer({
      sessionStore: new InMemorySessionStore(DEFAULT_CONFIG.agent.maxRounds, DEFAULT_CONFIG.agent.workspaceRoot),
      events: createEventBus(),
      credentialStore: new CredentialStore(memoryBackend()),
      config: DEFAULT_CONFIG,
      hitl: new HITLManager(),
    });
    openServers.push(web);
    await web.listen(0);
    const res = await request(web.app).get('/');
    // API-only：无静态服务 → express 默认 404（无 HTML）
    expect(res.status).toBe(404);
  });
});
