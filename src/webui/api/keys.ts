import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { CredentialStore } from '../../credentials/store.js';
import { maskSecret } from '../../credentials/mask.js';

/**
 * API key management REST API (PLAN Task 17, SPEC §4.2/§4.3).
 * All reads flow through CredentialStore.status() / maskSecret() — a masked
 * suffix at most, never plaintext. The secret only ever travels one way:
 * client → POST body → CredentialStore.save().
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

export function createKeysRouter(deps: KeysRouterDeps): Router {
  const { credentialStore, service } = deps;
  const router = Router();

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
      const apiKey = req.body?.apiKey;
      if (typeof apiKey !== 'string' || apiKey.trim() === '') {
        res.status(400).json({ error: 'apiKey is required' });
        return;
      }
      await credentialStore.save(service, req.params.provider, apiKey);
      res.json({ provider: req.params.provider, saved: true, masked: maskSecret(apiKey) });
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
