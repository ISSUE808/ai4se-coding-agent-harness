/**
 * Dev smoke server for the WebUI backend (Phase 10, pre-Task-19).
 *
 * Runs the Task 17 Express + WS server standalone with in-memory deps, so the
 * React client can be exercised before the agent loop is wired in (Task 19).
 * Not a production entry point — Task 19 replaces this with `start --web`.
 *
 *   npx tsx scripts/dev-webui.ts
 *   (defaults to DEFAULT_CONFIG.webui.port = 3000; override: npx tsx scripts/dev-webui.ts 4000)
 */
import { createWebUIServer } from '../src/webui/server.js';
import { createEventBus } from '../src/events.js';
import { InMemorySessionStore } from '../src/webui/session-store.js';
import { CredentialStore } from '../src/credentials/store.js';
import { HITLManager } from '../src/guardrail/hitl-manager.js';
import { DEFAULT_CONFIG } from '../src/config/schema.js';
import type { Config, CredentialBackend } from '../src/types.js';

/** In-memory backend so key management round-trips during manual testing. */
function memoryBackend(): CredentialBackend {
  const secrets = new Map<string, string>();
  return {
    name: 'memory-dev',
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

const config: Config = structuredClone(DEFAULT_CONFIG) as Config;

const web = createWebUIServer({
  sessionStore: new InMemorySessionStore(),
  events: createEventBus(),
  credentialStore: new CredentialStore([memoryBackend()]),
  config,
  hitl: new HITLManager(),
});

const port = Number(process.argv[2] ?? config.webui.port);
const actual = await web.listen(port);
console.log(`[dev-webui] WebUI backend on http://localhost:${actual} (WS: ws://localhost:${actual}/ws)`);
console.log('[dev-webui] Ctrl+C to stop');
