/**
 * WebUI API client — thin fetch wrappers over the Task 17 backend
 * (src/webui/server.ts). Server responses are already secret-masked; this
 * client never stores or displays plaintext keys.
 */

export interface SessionSummary {
  id: string;
  task: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  maxRounds: number;
  currentRound: number;
  tokenCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KeyStatus {
  provider: string;
  /** Masked value e.g. `****-9f2c`, or the literal `not set`. */
  status: string;
}

export interface KeySaveResponse {
  provider: string;
  saved: boolean;
  masked: string;
}

export interface KeyDeleteResponse {
  provider: string;
  removed: boolean;
}

export type ConfigValue = Record<string, unknown>;

/** Raised when the backend responds non-2xx; message is the API error body. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Same-origin base so relative API paths resolve under Node fetch too. */
const BASE =
  typeof window !== 'undefined' && window.location.origin ? window.location.origin : '';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, init);
  if (!res.ok) {
    let message = `request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === 'string' && body.error.length > 0) {
        message = body.error;
      }
    } catch {
      // Non-JSON error body — keep the status-based message.
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// ─── Sessions ───────────────────────────────────────────────────────────────

export async function fetchSessions(): Promise<SessionSummary[]> {
  return request<SessionSummary[]>('/api/sessions');
}

export async function createSession(task: string, maxRounds: number): Promise<SessionSummary> {
  return request<SessionSummary>('/api/sessions', jsonInit('POST', { task, maxRounds }));
}

// ─── Keys (provider-scoped; responses are masked server-side) ───────────────

export async function getKeyStatus(provider: string): Promise<KeyStatus> {
  return request<KeyStatus>(`/api/keys/${provider}`);
}

export async function saveKey(provider: string, apiKey: string): Promise<KeySaveResponse> {
  return request<KeySaveResponse>(`/api/keys/${provider}`, jsonInit('POST', { apiKey }));
}

export async function deleteKey(provider: string): Promise<KeyDeleteResponse> {
  return request<KeyDeleteResponse>(`/api/keys/${provider}`, { method: 'DELETE' });
}

// ─── Config (masked merged config in every response) ────────────────────────

export async function fetchConfig(): Promise<ConfigValue> {
  return request<ConfigValue>('/api/config');
}

export async function saveConfig(patch: ConfigValue): Promise<ConfigValue> {
  return request<ConfigValue>('/api/config', jsonInit('PUT', patch));
}
