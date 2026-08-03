/**
 * WebUI API client — thin fetch wrappers over the Task 17 backend
 * (src/webui/server.ts). Server responses are already secret-masked; this
 * client never stores or displays plaintext keys.
 */
import type { SessionMessage } from './session-messages';

export interface SessionSummary {
  id: string;
  task: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  maxRounds: number;
  currentRound: number;
  /** Session workspace root (Task 19) — bound per session, defaults to the config root. */
  workspaceRoot: string;
  /** Session-level model override (Task 26); absent = follow the config default. */
  model?: string;
  tokenCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KeyStatus {
  provider: string;
  /** Masked value e.g. `****-9f2c`, or the literal `not set`. */
  status: string;
}

export interface KeyProviderStatus {
  provider: string;
  /** Masked value e.g. `****-9f2c`, or the literal `not set`. */
  status: string;
}

export interface KeyListResponse {
  /** Every provider that has a credential in the store (Task 25). */
  providers: KeyProviderStatus[];
  /**
   * Active credential backend name (keytar | encrypted-file | env | memory).
   * 'env' is read-only — the UI shows a hint when it is active (reviewer M4).
   */
  backend?: string;
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

/** Create a session; `workspaceRoot` defaults server-side to the config root. */
export async function createSession(
  task: string,
  maxRounds: number,
  workspaceRoot?: string,
  model?: string,
): Promise<SessionSummary> {
  const body: Record<string, unknown> = { task, maxRounds, workspaceRoot };
  if (model !== undefined) {
    body.model = model;
  }
  return request<SessionSummary>('/api/sessions', jsonInit('POST', body));
}

/** Session with its full message history (GET /api/sessions/:id). */
export interface SessionDetail extends SessionSummary {
  messages: SessionMessage[];
}

export async function fetchSession(id: string): Promise<SessionDetail> {
  return request<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`);
}

/** Append a user message; the backend broadcasts it back via `message:added`. */
export async function postMessage(sessionId: string, content: string): Promise<SessionMessage> {
  return request<SessionMessage>(
    `/api/sessions/${encodeURIComponent(sessionId)}/message`,
    jsonInit('POST', { role: 'user', content }),
  );
}

/**
 * Switch the session-level model override (Task 26). An empty string clears
 * the override so the session falls back to the config default. The backend
 * broadcasts `session:updated` over WS; a running session restarts on the
 * new model.
 */
export async function updateSessionModel(sessionId: string, model: string): Promise<SessionSummary> {
  return request<SessionSummary>(
    `/api/sessions/${encodeURIComponent(sessionId)}/model`,
    jsonInit('PATCH', { model }),
  );
}

export type SessionControlAction = 'pause' | 'resume' | 'stop';

/** Pause/resume/stop a session (illegal transitions answer 409). */
export async function sessionControl(
  sessionId: string,
  action: SessionControlAction,
): Promise<SessionSummary> {
  return request<SessionSummary>(
    `/api/sessions/${encodeURIComponent(sessionId)}/${action}`,
    { method: 'POST' },
  );
}

export type ApprovalDecision = 'approve' | 'modify' | 'deny';

export interface ApprovalResponse {
  sessionId: string;
  decision: ApprovalDecision;
}

/** Resolve a pending HITL approval; `modify` requires the modified command. */
export async function resolveApproval(
  sessionId: string,
  decision: ApprovalDecision,
  modifiedCommand?: string,
): Promise<ApprovalResponse> {
  const body: Record<string, unknown> = { decision };
  if (decision === 'modify') {
    body.modifiedCommand = modifiedCommand ?? '';
  }
  return request<ApprovalResponse>(`/api/approvals/${encodeURIComponent(sessionId)}`, jsonInit('POST', body));
}

// ─── Keys (provider-scoped; responses are masked server-side) ───────────────

/**
 * Enumerate the providers that have a credential in the store (Task 25) —
 * including custom providers added at runtime. The backend never returns a
 * hardcoded whitelist; providers come from the credential store itself.
 */
export async function fetchKeys(): Promise<KeyListResponse> {
  return request<KeyListResponse>('/api/keys');
}

export async function getKeyStatus(provider: string): Promise<KeyStatus> {
  return request<KeyStatus>(`/api/keys/${encodeURIComponent(provider)}`);
}

export async function saveKey(provider: string, apiKey: string): Promise<KeySaveResponse> {
  return request<KeySaveResponse>(
    `/api/keys/${encodeURIComponent(provider)}`,
    jsonInit('POST', { apiKey }),
  );
}

export async function deleteKey(provider: string): Promise<KeyDeleteResponse> {
  return request<KeyDeleteResponse>(
    `/api/keys/${encodeURIComponent(provider)}`,
    { method: 'DELETE' },
  );
}

// ─── Config (masked merged config in every response) ────────────────────────

export async function fetchConfig(): Promise<ConfigValue> {
  return request<ConfigValue>('/api/config');
}

// ─── fs browsing (Task 23: directory picker + session file tree) ────────────

/** A node in the directory tree served by GET /api/fs/tree. */
export interface FsTreeNode {
  /** Absolute path of this node. */
  path: string;
  /** Basename of this node. */
  name: string;
  type: 'dir' | 'file';
  /** File size in bytes (files only). */
  size?: number;
  /** Direct children (dirs only, within the server depth cap). */
  children?: FsTreeNode[];
  /** True when this directory held more entries than the server cap. */
  truncated?: boolean;
}

/**
 * Fetch the directory tree below `path` (must sit under an authorized
 * workspace root — the config root or a session workspaceRoot). Omit the
 * path to browse the default workspace root.
 */
export async function fetchFsTree(path?: string): Promise<FsTreeNode> {
  const query = path !== undefined && path !== '' ? `?path=${encodeURIComponent(path)}` : '';
  return request<FsTreeNode>(`/api/fs/tree${query}`);
}

/** One entry in a GET /api/fs/browse listing (metadata only, never contents). */
export interface FsBrowseEntry {
  /** Absolute path of this entry. */
  path: string;
  /** Basename of this entry. */
  name: string;
  type: 'dir' | 'file' | 'link';
  /** File size in bytes (files only). */
  size?: number;
}

/** Directory listing served by GET /api/fs/browse?path=. */
export interface FsBrowseResult {
  path: string;
  parent: string;
  entries: FsBrowseEntry[];
  /** True when the directory held more entries than the server cap. */
  truncated?: boolean;
}

/**
 * Fetch the machine's root directories (Windows drive letters like `C:\`,
 * or `/` on POSIX). The picker's top level — browsing is deliberately
 * UNRESTRICTED so the user can choose ANY directory as a session root;
 * the server returns metadata only (see KNOWN_ISSUES).
 */
export async function fetchMachineRoots(): Promise<string[]> {
  const body = await request<{ roots: string[] }>('/api/fs/browse');
  return body.roots;
}

/** List one directory's entries (names/types/sizes — never file contents). */
export async function fetchFsBrowse(path: string): Promise<FsBrowseResult> {
  return request<FsBrowseResult>(`/api/fs/browse?path=${encodeURIComponent(path)}`);
}

export async function saveConfig(patch: ConfigValue): Promise<ConfigValue> {
  return request<ConfigValue>('/api/config', jsonInit('PUT', patch));
}
