import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { Config } from '../../types.js';
import type { CredentialStore } from '../../credentials/store.js';
import { maskSecret } from '../../credentials/mask.js';

/**
 * API key management REST API (PLAN Task 17 + Task 25, SPEC §4.2/§4.3).
 * All reads flow through CredentialStore.status() / maskSecret() — a masked
 * suffix at most, never plaintext. The secret only ever travels one way:
 * client → POST body → CredentialStore.save().
 *
 * Task 25: GET /api/keys enumerates the CONFIGURED providers from the
 * credential store (CredentialStore.list) — any account a key was saved for
 * (including custom providers) shows up here, sorted alphabetically, each
 * with its masked status. No hardcoded provider whitelist exists anywhere.
 */

export interface KeysRouterDeps {
  credentialStore: CredentialStore;
  /** Credential service, e.g. merged config `llm.apiKeyService`. */
  service: string;
  /**
   * Task 26 follow-up: the LIVE config (a mutable reference the server
   * re-points when PUT /api/config persists) — read for the provider
   * registry (`llm.providers`) and the active provider (`llm.provider`).
   */
  getConfig: () => Config;
  /** Persist a config change (registry writes from POST /api/keys). */
  persistConfig: (config: Config) => Promise<void>;
}

/** Express 4 does not catch async rejections — route them to the error handler. */
function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}

/** Provider names must be URL-safe single path segments (reviewer M1). */
const PROVIDER_NAME_RE = /^[a-zA-Z0-9_-]+$/;

export function createKeysRouter(deps: KeysRouterDeps): Router {
  const { credentialStore, service } = deps;
  const router = Router();

  router.get(
    '/',
    asyncRoute(async (_req, res) => {
      const backend = await credentialStore.getActiveBackend();
      const config = deps.getConfig();
      const registry = config.llm.providers ?? {};
      // Task 26 follow-up: the union of keyed providers (credential store)
      // and registered providers (config.llm.providers) — a provider added
      // with metadata but no key yet still shows up (status "not set").
      const stored = (await credentialStore.list(service)).sort();
      const registered = Object.keys(registry).filter((p) => !stored.includes(p));
      const providers = [...stored, ...registered].sort();
      const entries = await Promise.all(
        providers.map(async (provider) => {
          const meta = registry[provider];
          return {
            provider,
            status: await credentialStore.status(service, provider),
            // Task 26 follow-up: registry metadata so the UI can show the
            // endpoint and enable the "应用" (activate) action.
            ...(meta?.baseUrl ? { baseUrl: meta.baseUrl } : {}),
            ...(meta?.defaultModel ? { defaultModel: meta.defaultModel } : {}),
            isActive: provider === config.llm.provider,
          };
        }),
      );
      // `backend` lets the UI hint when the active backend is the read-only
      // env backend (reviewer M4).
      res.json({ providers: entries, backend: backend.name });
    }),
  );

  router.get(
    '/:provider',
    asyncRoute(async (req, res) => {
      const status = await credentialStore.status(service, req.params.provider);
      res.json({ provider: req.params.provider, status });
    }),
  );

  router.post(
    '/:provider',
    asyncRoute(async (req, res) => {
      const provider = req.params.provider;
      if (!PROVIDER_NAME_RE.test(provider)) {
        res.status(400).json({
          error: `Invalid provider name: ${provider} (allowed: [a-zA-Z0-9_-])`,
        });
        return;
      }
      // Task 26 follow-up: a POST may carry an apiKey (→ credential store),
      // registry metadata (baseUrl/defaultModel → config.llm.providers), or
      // both. At least one must be present. The key never appears in any
      // response body; the registry holds NO secrets.
      const apiKey = req.body?.apiKey;
      const baseUrl = req.body?.baseUrl;
      const defaultModel = req.body?.defaultModel;
      const hasKey = typeof apiKey === 'string' && apiKey.trim() !== '';
      const hasBaseUrl = typeof baseUrl === 'string' && baseUrl.trim() !== '';
      const hasDefault = typeof defaultModel === 'string' && defaultModel.trim() !== '';
      if (!hasKey && !hasBaseUrl) {
        res.status(400).json({ error: 'apiKey or baseUrl is required' });
        return;
      }
      if (hasKey) {
        await credentialStore.save(service, provider, apiKey as string);
      }
      if (hasBaseUrl || hasDefault) {
        const config = deps.getConfig();
        const next: Config = {
          ...config,
          llm: {
            ...config.llm,
            providers: {
              ...(config.llm.providers ?? {}),
              [provider]: {
                baseUrl: hasBaseUrl ? (baseUrl as string).trim() : ((config.llm.providers ?? {})[provider]?.baseUrl ?? config.llm.baseUrl),
                ...(hasDefault ? { defaultModel: (defaultModel as string).trim() } : {}),
              },
            },
          },
        };
        await deps.persistConfig(next);
      }
      res.json({ provider, saved: hasKey, masked: hasKey ? maskSecret(apiKey as string) : 'not set' });
    }),
  );

  router.delete(
    '/:provider',
    asyncRoute(async (req, res) => {
      const removed = await credentialStore.delete(service, req.params.provider);
      if (!removed) {
        res
          .status(404)
          .json({ error: `No credential found for provider: ${req.params.provider}` });
        return;
      }
      res.json({ provider: req.params.provider, removed: true });
    }),
  );

  return router;
}
