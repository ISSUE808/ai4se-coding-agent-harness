/**
 * Display formatting helpers for the WebUI (Dashboard rows, key masks).
 * Pure functions — unit-testable without a DOM.
 */

/** Session status → Chinese label (prototype docs/webui-prototype.html). */
export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
};

export type SessionStatus = 'running' | 'paused' | 'completed' | 'failed';

/** Seconds → `MM:SS` below an hour, `HH:MM:SS` at or above. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Token count → `0`, `847`, `128.4K`, `1.2M` (prototype stat formatting). */
export function formatTokens(count: number): string {
  const n = Math.max(0, count);
  if (n >= 1_000_000) {
    return `${trimZero(+(n / 1_000_000).toFixed(1))}M`;
  }
  if (n >= 1_000) {
    return `${trimZero(+(n / 1_000).toFixed(1))}K`;
  }
  return String(Math.floor(n));
}

/** Strip a trailing `.0` from a decimal string (847.0 → 847). */
function trimZero(value: number): string {
  return String(Number.isInteger(value) ? Math.trunc(value) : value);
}

/** Session status → label for status badges. */
export function formatSessionStatusLabel(status: SessionStatus): string {
  return SESSION_STATUS_LABELS[status];
}
