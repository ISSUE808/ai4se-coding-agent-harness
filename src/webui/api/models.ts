import { Router } from 'express';
import type { Config } from '../../types.js';
import { CredentialStore, CredentialNotFoundError } from '../../credentials/store.js';

/**
 * Provider model list REST API (Task 26 follow-up): `GET /api/llm/models`
 * fetches the OpenAI-compatible `{baseUrl}/models` list for the configured
 * provider and returns the model ids. The secret key is read through the
 * CredentialStore and used ONLY inside the SecureHandle `use` closure when
 * building the provider request — it never appears in a response body or log
 * (SPEC §3.7, §4.2).
 *
 * Errors are structured for the frontend to act on:
 * - 401 no stored key → Settings should ask the user to configure one first
 * - 502 provider unreachable / non-2xx → show the raw message as guidance
 * The fetch is injectable (`fetchFn`) so the route stays zero-network in tests.
 */

export interface ModelsRouterDeps {
  config: Config;
  credentialStore: CredentialStore;
  /** Injectable fetch (defaults to globalThis.fetch); tests inject a mock. */
  fetchFn?: typeof fetch;
}

/** Join the provider base URL with /models, tolerating a trailing slash. */
export function modelsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/models`;
}

/** Extract model ids from an OpenAI-compatible list payload (lenient). */
export function extractModelIds(body: unknown): string[] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) {
    return [];
  }
  return data
    .map((entry) => (typeof (entry as { id?: unknown })?.id === 'string' ? (entry as { id: string }).id : ''))
    .filter((id: string) => id !== '');
}

export function createModelsRouter(deps: ModelsRouterDeps): Router {
  const { config, credentialStore } = deps;
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const router = Router();

  router.get('/', async (_req, res) => {
    const { provider, baseUrl, apiKeyService } = config.llm;
    try {
      const handle = await credentialStore.get(apiKeyService, provider);
      // §3.7: the key exists only inside this closure; the fetch is built and
      // awaited there so no bare string ever escapes into this scope.
      const response = await handle.use((key) =>
        fetchFn(modelsUrl(baseUrl), {
          headers: { Authorization: `Bearer ${key}` },
        }),
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        res.status(502).json({
          error: `模型列表请求失败（${response.status}）：${detail.slice(0, 200)}`,
        });
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      res.json({ models: extractModelIds(body) });
    } catch (err) {
      if (err instanceof CredentialNotFoundError) {
        res.status(401).json({
          error: `未配置 ${provider} 的 API key——请先在 设置 → 密钥 中保存`,
        });
        return;
      }
      res.status(502).json({
        error: `获取模型列表失败（${baseUrl}）：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  return router;
}
