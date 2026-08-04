import { Router } from 'express';
import type { Session } from '../../types.js';
import type { HarnessEvents } from '../../events.js';
import { HITLState } from '../../guardrail/hitl-manager.js';
import type { HITLManager } from '../../guardrail/hitl-manager.js';
import type { SessionStore } from '../session-store.js';

/**
 * HITL approvals REST API (PLAN Task 17, SPEC §5.1 WebUI approval card).
 * `POST /api/approvals/:sessionId` resolves a pending human decision on the
 * injected HITLManager. The approved/modified/denied command is recorded as a
 * system message in the session (the "hand back to the agent" record) and
 * broadcast over the event bus; the standalone backend has no agent loop, so
 * Task 19 wires the resumed execution.
 */

export interface ApprovalsRouterDeps {
  sessionStore: SessionStore;
  hitl: HITLManager;
  events: HarnessEvents;
  /** Task 19: invoked after a decision so the harness can resume the session. */
  onApprovalResolved?: (session: Session) => void;
}

const DECISIONS = ['approve', 'modify', 'deny'] as const;

export function createApprovalsRouter(deps: ApprovalsRouterDeps): Router {
  const { sessionStore, hitl, events } = deps;
  const router = Router();

  router.post('/:id', (req, res) => {
    const { decision, modifiedCommand } = req.body ?? {};
    if (typeof decision !== 'string' || !DECISIONS.includes(decision as (typeof DECISIONS)[number])) {
      res.status(400).json({ error: `decision must be one of: ${DECISIONS.join(', ')}` });
      return;
    }
    if (decision === 'modify' && (typeof modifiedCommand !== 'string' || modifiedCommand.trim() === '')) {
      res.status(400).json({ error: 'modifiedCommand is required for decision "modify"' });
      return;
    }

    const session = sessionStore.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: `Session not found: ${req.params.id}` });
      return;
    }

    // Session ownership (KNOWN_ISSUES 6): HITL state is keyed per session —
    // this endpoint may only resolve THIS session's pending decision. Without
    // the check, a client could resolve a pending command belonging to a
    // different session through any sessionId.
    if (hitl.getState(session.id) !== HITLState.AWAITING_APPROVAL) {
      res.status(409).json({
        error: `Session ${session.id} has no pending approval (state: ${hitl.getState(session.id)})`,
      });
      return;
    }

    const pending = hitl.getPendingCommand(session.id);
    let record: string;
    try {
      if (decision === 'approve') {
        hitl.approve(session.id);
        record = `[HITL] Command approved: ${pending ?? '(none)'}`;
      } else if (decision === 'modify') {
        hitl.approveWithModification(session.id, modifiedCommand as string);
        record = `[HITL] Command approved with modification: ${modifiedCommand}`;
      } else {
        hitl.deny(session.id);
        record = `[HITL] Command denied: ${pending ?? '(none)'}`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(409).json({ error: msg });
      return;
    }

    const message = sessionStore.appendMessage(session.id, { role: 'system', content: record });
    if (message) {
      events.emit('message:added', {
        id: message.id,
        role: message.role,
        content: message.content,
        metadata: message.metadata,
        timestamp: message.timestamp,
      });
    }
    // Task 19: hand the session back to the integrated harness — a paused
    // (HITL) session is re-run with the decision recorded in its history.
    deps.onApprovalResolved?.(session);
    res.json({ sessionId: session.id, decision, state: hitl.getState(session.id) });
  });

  return router;
}
