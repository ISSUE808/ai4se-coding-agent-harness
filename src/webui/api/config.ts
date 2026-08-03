import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { Config } from '../../types.js';
import { maskSecret } from '../../credentials/mask.js';

/**
 * Config REST API (PLAN Task 17, SPEC §3.6/§4.2).
 * GET returns the merged config with secrets masked (same explicit
 * SECRET_FIELDS whitelist approach as `codeharness config show`); PUT merges
 * a partial config onto the current one and persists it. Persistence is
 * injectable — src/config/loader.ts only exposes loadConfig (no write API),
 * so the default here writes the project-level `.codeharness.json` layer the
 * loader reads back on startup.
 */

/** Secret field paths that must be masked in responses (SPEC §4.2). */
const SECRET_FIELDS: ReadonlyArray<{ path: string[]; kind: 'mask' | 'hide' }> = [
  { path: ['webui', 'token'], kind: 'mask' },
  { path: ['llm', 'apiKey'], kind: 'mask' },
];

/** Key-like field names rejected at ANY nesting depth (SPEC §3.6). */
const SECRET_KEY_RE = /^(apiKey|api_key|secret|secretKey|token|password)$/i;

/**
 * Find the first secret-like field in a config patch (any depth), returning
 * its dotted path — e.g. `apiKey`, `llm.apiKey`, `webui.token`. Deep check
 * beats a fixed whitelist: a future config shape cannot silently accept a
 * plaintext key into the persisted project file.
 */
function findSecretField(node: Record<string, unknown>, prefix = ''): string | null {
  for (const [key, value] of Object.entries(node)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (SECRET_KEY_RE.test(key)) {
      return dotted;
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const found = findSecretField(value as Record<string, unknown>, dotted);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

/** Deep-overlay of a partial config onto a full one (loader.ts semantics). */
function mergeConfig(base: Config, patch: Record<string, unknown>): Config {
  const result = structuredClone(base) as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    const baseVal = result[key];
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof baseVal === 'object' &&
      baseVal !== null &&
      !Array.isArray(baseVal)
    ) {
      result[key] = mergeConfig(baseVal as Config, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result as unknown as Config;
}

/** Masked view of the config: secrets replaced, absent token reads "not set". */
function maskedConfig(config: Config): Config {
  const redacted = structuredClone(config) as unknown as Record<string, unknown>;
  for (const { path } of SECRET_FIELDS) {
    let node: Record<string, unknown> = redacted;
    for (let i = 0; i < path.length - 1; i++) {
      const next = node[path[i]];
      if (typeof next !== 'object' || next === null) break;
      node = next as Record<string, unknown>;
    }
    const leaf = path[path.length - 1];
    const value = node[leaf];
    if (typeof value === 'string' && value.length > 0) {
      node[leaf] = maskSecret(value);
    }
  }
  const webui = redacted.webui as Record<string, unknown>;
  if (webui.token === undefined || webui.token === '') {
    webui.token = 'not set';
  }
  return redacted as unknown as Config;
}

export interface ConfigRouterDeps {
  /** Merged config the server was started with. */
  config: Config;
  /** Injectable persistence; defaults to writing the project config file. */
  persistConfig?: (config: Config) => Promise<void>;
  /** Project-level config file path used by the default persistence. */
  configFilePath?: string;
}

export function createConfigRouter(deps: ConfigRouterDeps): Router {
  const { config, configFilePath = join(process.cwd(), '.codeharness.json') } = deps;
  const persist = deps.persistConfig ?? (async (c: Config) => {
    await fs.writeFile(configFilePath, `${JSON.stringify(c, null, 2)}\n`, 'utf-8');
  });
  let current: Config = config;
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(maskedConfig(current));
  });

  router.put('/', (req: Request, res: Response, next: NextFunction) => {
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      res.status(400).json({ error: 'config body must be a JSON object' });
      return;
    }
    // SPEC §3.6: config never holds keys — reject secret fields outright so a
    // user cannot persist a plaintext key into the project config file. The
    // deep check reports the ACTUAL offending path (top-level `apiKey` is not
    // misreported as `llm.apiKey`).
    const secretPath = findSecretField(body as Record<string, unknown>);
    if (secretPath !== null) {
      res.status(400).json({
        error: `${secretPath} cannot be set via config — use POST /api/keys/:provider instead`,
      });
      return;
    }
    const merged = mergeConfig(current, body as Record<string, unknown>);
    persist(merged)
      .then(() => {
        current = merged;
        res.json(maskedConfig(current));
      })
      .catch(next);
  });

  return router;
}
