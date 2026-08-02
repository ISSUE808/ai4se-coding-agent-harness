import { Router } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Session } from '../../types.js';
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
    const { maxRounds, workspaceRoot } = req.body ?? {};
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
    const session = sessionStore.create(task, rounds, root.value || undefined);
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
    const message = sessionStore.appendMessage(req.params.id, {
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
    res.json(message);
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
      }
      res.json(updated);
    });
  }

  return router;
}
