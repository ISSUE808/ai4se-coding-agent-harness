/**
 * Config editor JSON parsing (Settings). Guards the PUT /api/config request:
 * invalid JSON or non-object bodies are rejected client-side with a message.
 */

export type ParseResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

export function parseConfigJson(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'invalid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'config must be a JSON object' };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}
