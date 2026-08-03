import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
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
      const providers = (await credentialStore.list(service)).sort();
      const entries = await Promise.all(
        providers.map(async (provider) => ({
          provider,
          status: await credentialStore.status(service, provider),
        })),
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
      const apiKey = req.body?.apiKey;
      if (typeof apiKey !== 'string' || apiKey.trim() === '') {
        res.status(400).json({ error: 'apiKey is required' });
        return;
      }
      await credentialStore.save(service, provider, apiKey);
      res.json({ provider, saved: true, masked: maskSecret(apiKey) });
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
