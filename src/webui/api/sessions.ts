import { Router } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Message, Session } from '../../types.js';
import type { HarnessEvents } from '../../events.js';
import type { SessionStore } from '../session-store.js';

/**
 * Sessions REST API (PLAN Task 17, SPEC §5.1 WebUI).
 * Depends only on injected SessionStore + HarnessEvents — never a global
 * singleton, so the server stays independently testable until Task 19 wires
 * it to the running agent loop. Task 19 added the session-level workspaceRoot
 * binding: POST validates the field (absolute, existing, writable directory)
 * and hands it to the SessionStore; `onSessionCreated` lets the integrated
 * harness start the agent loop in-process.
 */

export interface SessionsRouterDeps {
  sessionStore: SessionStore;
  events: HarnessEvents;
  /** Task 19: invoked after a session is created so the harness can run it. */
  onSessionCreated?: (session: Session) => void;
  /**
   * Task 19 (I2): invoked after pause/stop — the endpoint already set the
   * final status; the harness aborts the live loop so it really halts.
   */
  onSessionControl?: (session: Session, action: 'pause' | 'stop') => void;
  /**
   * Task 19 (I2): invoked after resume so the harness really starts the loop.
   */
  onSessionResumed?: (session: Session) => void;
  /**
   * Task 19 (user feedback): invoked after a user message is appended to an
   * existing session — the harness injects the instruction into the loop
   * (resume completed/paused sessions; interrupt running ones).
   */
  onMessageAdded?: (session: Session, message: Message) => void;
  /**
   * Task 26: invoked after PATCH /api/sessions/:id/model actually changed the
   * session's model — the harness aborts a live run and restarts it on the
   * new model (same abort+restart path as message injection). Not invoked
   * when the patched value equals the current one.
   */
  onModelChanged?: (session: Session) => void;
}

const MESSAGE_ROLES = ['user', 'assistant', 'tool', 'system', 'feedback'] as const;

/**
 * Task 19 workspaceRoot validation: must be a string, an absolute path, an
 * existing directory, and writable. `undefined` means "use the store default".
 * Returns `{ ok: true, value }` or `{ ok: false, error }`.
 */
function validateWorkspaceRoot(
  value: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: true, value: '' };
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, error: 'workspaceRoot must be a non-empty string' };
  }
  if (!path.isAbsolute(value)) {
    return { ok: false, error: 'workspaceRoot must be an absolute path' };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(value);
  } catch {
    return { ok: false, error: `workspaceRoot directory does not exist: ${value}` };
  }
  if (!stat.isDirectory()) {
    return { ok: false, error: `workspaceRoot must be a directory: ${value}` };
  }
  try {
    fs.accessSync(value, fs.constants.W_OK);
  } catch {
    return { ok: false, error: `workspaceRoot is not writable: ${value}` };
  }
  return { ok: true, value };
}

/** Allowed status transitions for pause/resume/stop control endpoints. */
const TRANSITIONS: Record<string, { from: Session['status'][]; to: Session['status'] }> = {
  pause: { from: ['running'], to: 'paused' },
  resume: { from: ['paused'], to: 'running' },
  stop: { from: ['running', 'paused'], to: 'completed' },
};

/**
 * Task 26 model validation. POST requires a non-empty string; PATCH also
 * accepts `''` (or whitespace) to CLEAR the override back to the config
 * default. Returns the trimmed model or `null` (clear) when valid.
 * Review M3: overloads — with `allowClear: false` the value can never be
 * `null`, so callers do not need a `?? undefined` fallback.
 */
function normalizeModel(value: unknown, allowClear: false): { ok: true; value: string } | { ok: false; error: string };
function normalizeModel(value: unknown, allowClear: true): { ok: true; value: string | null } | { ok: false; error: string };
function normalizeModel(
  value: unknown,
  allowClear: boolean,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (typeof value !== 'string') {
    return { ok: false, error: 'model must be a string' };
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    if (allowClear) {
      return { ok: true, value: null };
    }
    return { ok: false, error: 'model must be a non-empty string' };
  }
  return { ok: true, value: trimmed };
}

export function createSessionsRouter(deps: SessionsRouterDeps): Router {
  const { sessionStore, events } = deps;
  const router = Router();

  router.post('/', (req, res) => {
    const task = req.body?.task;
    if (typeof task !== 'string' || task.trim() === '') {
      res.status(400).json({ error: 'task is required' });
      return;
    }
    // Optional round cap: 0 = unlimited, undefined = store default. Anything
    // else must be a non-negative integer (SPEC §3.1 hard termination rule).
    const { maxRounds, workspaceRoot, model } = req.body ?? {};
    let rounds: number | undefined;
    if (maxRounds !== undefined) {
      if (typeof maxRounds !== 'number' || !Number.isInteger(maxRounds) || maxRounds < 0) {
        res.status(400).json({ error: 'maxRounds must be a non-negative integer (0 = unlimited)' });
        return;
      }
      rounds = maxRounds;
    }
    const root = validateWorkspaceRoot(workspaceRoot);
    if (!root.ok) {
      res.status(400).json({ error: root.error });
      return;
    }
    // Optional session-level model override (Task 26): non-empty string.
    // M3: allowClear=false narrows the return type — `parsed.value` is a
    // plain string here, never null.
    let sessionModel: string | undefined;
    if (model !== undefined) {
      const parsed = normalizeModel(model, false);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      sessionModel = parsed.value;
    }
    const session = sessionStore.create(task, rounds, root.value || undefined, sessionModel);
    const message = sessionStore.appendMessage(session.id, { role: 'user', content: task });
    if (message) {
      events.emit('message:added', {
        id: message.id,
        role: message.role,
        content: message.content,
        metadata: message.metadata,
        timestamp: message.timestamp,
      });
    }
    events.emit('session:status', { sessionId: session.id, status: session.status });
    // Task 19: hand the stored session to the integrated harness — it runs the
    // AgentLoop on the same object, so store state and loop state stay in sync.
    deps.onSessionCreated?.(session);
    res.status(201).json(session);
  });

  router.get('/', (_req, res) => {
    res.json(sessionStore.list());
  });

  router.get('/:id', (req, res) => {
    const session = sessionStore.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: `Session not found: ${req.params.id}` });
      return;
    }
    res.json(session);
  });

  router.post('/:id/message', (req, res) => {
    const { role, content, metadata } = req.body ?? {};
    if (!MESSAGE_ROLES.includes(role)) {
      res.status(400).json({ error: `role must be one of: ${MESSAGE_ROLES.join(', ')}` });
      return;
    }
    if (typeof content !== 'string' || content.trim() === '') {
      res.status(400).json({ error: 'content is required' });
      return;
    }
    const session = sessionStore.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: `Session not found: ${req.params.id}` });
      return;
    }
    const message = sessionStore.appendMessage(session.id, {
      role,
      content,
      metadata: typeof metadata === 'object' && metadata !== null ? metadata : undefined,
    });
    if (!message) {
      res.status(404).json({ error: `Session not found: ${req.params.id}` });
      return;
    }
    events.emit('message:added', {
      id: message.id,
      role: message.role,
      content: message.content,
      metadata: message.metadata,
      timestamp: message.timestamp,
    });
    // Task 19 (user feedback): hand the new instruction to the integrated
    // harness — a completed/paused session resumes, a running one is
    // interrupted so the message lands in the next LLM context.
    deps.onMessageAdded?.(session, message);
    res.json(message);
  });

  /**
   * Task 26: switch the session-level model override mid-conversation.
   * `''` clears the override (back to the config default). A real change is
   * broadcast as `session:updated` over WS and handed to the harness so a
   * RUNNING session aborts and restarts on the new model; paused/completed
   * sessions simply record it — the next run uses it.
   */
  router.patch('/:id/model', (req, res) => {
    const session = sessionStore.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: `Session not found: ${req.params.id}` });
      return;
    }
    const parsed = normalizeModel(req.body?.model, true);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const next = parsed.value;
    const previous = session.model ?? null;
    if (next === previous) {
      // No-op — keep the session untouched and do not signal the harness.
      res.json(session);
      return;
    }
    const updated = sessionStore.updateModel(session.id, next);
    if (!updated) {
      res.status(404).json({ error: `Session not found: ${req.params.id}` });
      return;
    }
    events.emit('session:updated', {
      sessionId: updated.id,
      model: updated.model ?? null,
      updatedAt: updated.updatedAt,
    });
    deps.onModelChanged?.(updated);
    res.json(updated);
  });

  for (const [action, transition] of Object.entries(TRANSITIONS)) {
    router.post(`/:id/${action}`, (req, res) => {
      const session = sessionStore.get(req.params.id);
      if (!session) {
        res.status(404).json({ error: `Session not found: ${req.params.id}` });
        return;
      }
      if (!transition.from.includes(session.status)) {
        res.status(409).json({
          error: `Cannot ${action} a session in status ${session.status}`,
        });
        return;
      }
      const updated = sessionStore.updateStatus(session.id, transition.to);
      if (updated) {
        events.emit('session:status', { sessionId: updated.id, status: updated.status });
        // Task 19 (I2): pause/stop abort the live loop (a status change alone
        // does not stop it); resume hands the session back so the loop really
        // starts on the stored object.
        if (action === 'pause' || action === 'stop') {
          deps.onSessionControl?.(updated, action);
        } else {
          deps.onSessionResumed?.(updated);
        }
      }
      res.json(updated);
    });
  }

  return router;
}
