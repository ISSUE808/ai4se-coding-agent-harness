/**
 * Client-side session runtime state reduced from WebSocket event frames
 * (PLAN Task 18b). Pure reducer: given the current state and one
 * `{ type, data }` frame from the Task 17 backend, return the next state.
 * The hook layer (hooks/useSessionEvents.ts) is a thin subscription wrapper
 * over this — the mapping rules are deterministic and unit-testable here.
 */
import type { SessionStatus } from './format';
import { upsertMessage, type SessionMessage } from './session-messages';

/** A command waiting for a human decision (warn-level guardrail trigger). */
export interface PendingApproval {
  rule: string;
  command: string;
  level: 'block' | 'warn';
}

export interface SessionRuntimeState {
  messages: SessionMessage[];
  status: SessionStatus | null;
  currentRound: number | null;
  maxRounds: number | null;
  /** Session-level model override (Task 26); null = follow the config default. */
  model: string | null;
  pendingApproval: PendingApproval | null;
}

/** One line of the session's live terminal stream (KNOWN_ISSUES 9 终端 tab). */
export interface TerminalLine {
  id: string;
  timestamp: string;
  kind: 'tool' | 'feedback' | 'guardrail' | 'round' | 'status';
  text: string;
}

/** WS frame shape: server serializes every HarnessEventMap event as `{type, data}`. */
export interface SessionEventFrame {
  type: string;
  data: Record<string, unknown>;
}

export interface InitialRuntimeState {
  messages: SessionMessage[];
  status: SessionStatus;
  currentRound?: number;
  maxRounds?: number;
  /** Session-level model override from the REST snapshot (Task 26). */
  model?: string;
}

const KNOWN_STATUSES: SessionStatus[] = ['running', 'paused', 'completed', 'failed'];

export function createInitialRuntimeState(initial?: InitialRuntimeState): SessionRuntimeState {
  return {
    messages: initial?.messages ?? [],
    status: initial?.status ?? null,
    currentRound: initial?.currentRound ?? null,
    maxRounds: initial?.maxRounds ?? null,
    model: initial?.model ?? null,
    pendingApproval: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Reduce one WS frame into the next runtime state (no mutation of input). */
export function reduceSessionEvent(state: SessionRuntimeState, event: SessionEventFrame): SessionRuntimeState {
  if (!isRecord(event.data)) {
    return state;
  }
  const data = event.data;

  switch (event.type) {
    case 'message:added': {
      if (typeof data.id !== 'string' || typeof data.role !== 'string' || typeof data.content !== 'string') {
        return state;
      }
      const message: SessionMessage = {
        id: data.id,
        role: data.role as SessionMessage['role'],
        content: data.content,
        metadata: isRecord(data.metadata) ? (data.metadata as SessionMessage['metadata']) : undefined,
        timestamp: typeof data.timestamp === 'string' ? data.timestamp : '',
      };
      return { ...state, messages: upsertMessage(state.messages, message) };
    }

    case 'session:status': {
      if (typeof data.status !== 'string' || !KNOWN_STATUSES.includes(data.status as SessionStatus)) {
        return state;
      }
      return { ...state, status: data.status as SessionStatus };
    }

    case 'round:changed': {
      if (typeof data.currentRound !== 'number' || typeof data.maxRounds !== 'number') {
        return state;
      }
      return { ...state, currentRound: data.currentRound, maxRounds: data.maxRounds };
    }

    case 'session:updated': {
      // Task 26: the session-level model override changed (`null` = cleared,
      // back to the config default). Anything else than a string/null is a
      // malformed frame — keep the previous model.
      if (typeof data.model !== 'string' && data.model !== null) {
        return state;
      }
      return { ...state, model: data.model };
    }

    case 'guardrail:triggered': {
      if (
        data.level !== 'warn' ||
        typeof data.rule !== 'string' ||
        typeof data.command !== 'string'
      ) {
        return state;
      }
      return {
        ...state,
        pendingApproval: { rule: data.rule, command: data.command, level: data.level },
      };
    }

    default:
      return state;
  }
}

// ─── Terminal stream (KNOWN_ISSUES 9 终端 tab) ──────────────────────────────

const TERMINAL_MAX = 500;

/**
 * Reduce WS frames into terminal lines for the session's live "terminal" tab.
 * Kept separate from `reduceSessionEvent` — the message feed and the
 * operational log have different consumers and retention policies.
 * `now` (ISO) is injected by the caller: the mapped frame types carry NO
 * timestamp on the wire (HarnessEventMap has none), so the receive-time stamp
 * is the only true "when it happened" the client has (reviewer Important).
 */
export function reduceTerminalEvent(
  lines: TerminalLine[],
  event: SessionEventFrame,
  now = '',
): TerminalLine[] {
  if (!isRecord(event.data)) {
    return lines;
  }
  const line = terminalLine(event.type, event.data, now);
  if (line === null) {
    return lines;
  }
  // Monotonic key: WS frames carry no id, and `lines.length` alone would
  // repeat once the 500-line cap kicks in (duplicate React keys). Pure max+1
  // keeps the reducer deterministic (reviewer Important).
  line.id = lines.length === 0 ? '0' : String(Math.max(...lines.map((l) => Number(l.id))) + 1);
  const next = [...lines, line];
  return next.length > TERMINAL_MAX ? next.slice(next.length - TERMINAL_MAX) : next;
}

function terminalLine(type: string, data: Record<string, unknown>, now = ''): TerminalLine | null {
  const stamp = now !== '' ? now : typeof data.timestamp === 'string' ? data.timestamp : '';
  switch (type) {
    case 'tool:executed': {
      const toolName = typeof data.toolName === 'string' ? data.toolName : '?';
      const success = typeof data.success === 'boolean' ? data.success : true;
      const ms = typeof data.duration_ms === 'number' ? `${data.duration_ms}ms` : '';
      return {
        id: stamp,
        timestamp: stamp,
        kind: 'tool',
        text: `[tool] ${toolName} ${success ? '✓' : '✗'} ${ms}`.trim(),
      };
    }
    case 'feedback:completed': {
      const validator = typeof data.validator === 'string' ? data.validator : '?';
      const passed = typeof data.passed === 'boolean' ? data.passed : false;
      const category =
        typeof data.failureCategory === 'string' && data.failureCategory !== ''
          ? ` (${data.failureCategory})`
          : '';
      return {
        id: stamp,
        timestamp: stamp,
        kind: 'feedback',
        text: `[feedback] ${validator} ${passed ? '✓' : `✗${category}`}`,
      };
    }
    case 'guardrail:triggered': {
      const rule = typeof data.rule === 'string' ? data.rule : '?';
      const command = typeof data.command === 'string' ? data.command : '';
      const level = typeof data.level === 'string' ? data.level : 'warn';
      return {
        id: stamp,
        timestamp: stamp,
        kind: 'guardrail',
        text: `[guardrail] ${level}: ${rule}${command !== '' ? ` — ${command}` : ''}`,
      };
    }
    case 'round:changed': {
      const current = typeof data.currentRound === 'number' ? data.currentRound : 0;
      const max = typeof data.maxRounds === 'number' ? data.maxRounds : 0;
      return {
        id: stamp,
        timestamp: stamp,
        kind: 'round',
        text: `[round] ${current}/${max === 0 ? '∞' : max}`,
      };
    }
    case 'session:status': {
      const status = typeof data.status === 'string' ? data.status : '?';
      return { id: stamp, timestamp: stamp, kind: 'status', text: `[session] ${status}` };
    }
    default:
      return null;
  }
}
