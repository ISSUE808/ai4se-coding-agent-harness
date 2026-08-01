/**
 * Session message model + pure aggregation helpers for the SessionDetail view
 * (PLAN Task 18b). Everything here is deterministic and DOM-free so it can be
 * unit-tested without rendering; the shapes mirror the backend Message type
 * (src/types.ts) as delivered over REST and the `message:added` WS frame.
 */

export type SessionRole = 'user' | 'assistant' | 'tool' | 'system' | 'feedback';

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  duration_ms: number;
  filesChanged?: string[];
  exitCode?: number | null;
}

export interface FeedbackResult {
  passed: boolean;
  validator: string;
  failureCategory?: string;
  strategy?: string;
  evidence: string;
  details?: Array<Record<string, unknown>>;
}

export interface SessionMessageMetadata {
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: ToolResult;
  feedbackResult?: FeedbackResult;
  approvalRequired?: boolean;
  important?: boolean;
  compressed?: boolean;
}

export interface SessionMessage {
  id: string;
  role: SessionRole;
  content: string;
  metadata?: SessionMessageMetadata;
  timestamp: string;
}

/** A file touched by a tool call, aggregated for the 文件变更 column. */
export interface FileEntry {
  path: string;
  /** A = first mention, M = modified again later; D is reserved for when a
   *  baseline snapshot becomes available (the backend only reports touched
   *  files per tool call, so deletion cannot be inferred today). */
  mark: 'A' | 'M' | 'D';
  /** Added / deleted line counts parsed from the tool output (0 = unknown). */
  addCount: number;
  delCount: number;
}

/** Insert-or-replace a message by id, preserving chronological order. */
export function upsertMessage(messages: SessionMessage[], next: SessionMessage): SessionMessage[] {
  const index = messages.findIndex((m) => m.id === next.id);
  if (index === -1) {
    return [...messages, next];
  }
  const copy = [...messages];
  copy[index] = next;
  return copy;
}

/**
 * Merge a REST snapshot with WS-delivered messages (both may overlap). The
 * first list wins on id collisions (it holds the newer payloads); the result
 * is deduped and sorted chronologically by timestamp (ISO strings sort
 * lexicographically). Inputs are not mutated.
 */
export function mergeMessages(base: SessionMessage[], extra: SessionMessage[]): SessionMessage[] {
  const byId = new Map<string, SessionMessage>();
  for (const m of base) {
    byId.set(m.id, m);
  }
  for (const m of extra) {
    if (!byId.has(m.id)) {
      byId.set(m.id, m);
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.timestamp === b.timestamp ? (a.id < b.id ? -1 : 1) : a.timestamp < b.timestamp ? -1 : 1,
  );
}

/** Files changed by a single message (empty for non-tool messages). */
export function toolFiles(message: SessionMessage): string[] {
  return message.role === 'tool' ? (message.metadata?.toolResult?.filesChanged ?? []) : [];
}

/** Aggregate all touched files across a session's messages. */
export function aggregateFiles(messages: SessionMessage[]): FileEntry[] {
  const entries = new Map<string, FileEntry>();
  for (const message of messages) {
    const files = toolFiles(message);
    if (files.length === 0) {
      continue;
    }
    const delta = parseLineDelta(message.metadata?.toolResult?.output);
    for (const path of files) {
      const prev = entries.get(path);
      entries.set(path, {
        path,
        mark: prev ? 'M' : 'A',
        addCount: delta?.add ?? prev?.addCount ?? 0,
        delCount: delta?.del ?? prev?.delCount ?? 0,
      });
    }
  }
  return [...entries.values()];
}

/**
 * Parse a "+84 −32" style line delta out of a tool output snippet (the format
 * the harness tools emit in their summaries). Returns null when absent.
 */
export function parseLineDelta(output: string | undefined): { add: number; del: number } | null {
  if (!output) {
    return null;
  }
  const both = output.match(/\+(\d+)\s*[−-]\s*(\d+)/);
  if (both) {
    return { add: Number(both[1]), del: Number(both[2]) };
  }
  const add = output.match(/\+(\d+)/);
  if (add) {
    return { add: Number(add[1]), del: 0 };
  }
  const del = output.match(/[−-](\d+)/);
  if (del) {
    return { add: 0, del: Number(del[1]) };
  }
  return null;
}

/** Last tool output (or error) for a file, for the FileDiff placeholder. */
export function contentForFile(messages: SessionMessage[], path: string): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (toolFiles(message).includes(path)) {
      const result = message.metadata?.toolResult;
      return result?.output ?? result?.error ?? null;
    }
  }
  return null;
}

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
  css: 'css',
  html: 'html',
  py: 'python',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'shell',
  sql: 'sql',
};

/** Monaco language id for a file path (plaintext fallback). */
export function languageForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_LANG[ext] ?? 'plaintext';
}

/**
 * Server timestamps are ISO-8601 UTC (new Date().toISOString()); render them
 * as `YYYY-MM-DD HH:MM` deterministically instead of re-deriving in local
 * time, so formatting is stable across machines and timezones.
 */
export function formatDateTime(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}
