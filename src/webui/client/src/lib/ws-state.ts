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
