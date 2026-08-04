export enum HITLState {
  IDLE = 'IDLE',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  EXECUTING = 'EXECUTING',
  EXECUTING_MODIFIED = 'EXECUTING_MODIFIED',
  BLOCKED = 'BLOCKED',
}

export interface PendingAction {
  tool: string;
  params: Record<string, unknown>;
  /** OpenAI tool_call id of the paused action — lets the harness rewrite the
   *  blocked tool message with the real execution result after approval. */
  id?: string;
}

interface SessionHITL {
  state: HITLState;
  pendingCommand: string | null;
  pendingAction: PendingAction | null;
  /** Commands approved in this session — re-issued identical commands (the
   *  LLM may not realize the harness already executed them) pass without a
   *  second confirmation. Cleared only when the session entry is removed. */
  approvedCommands: Set<string>;
}

/**
 * HITLManager — human-in-the-loop approval state, keyed by sessionId
 * (KNOWN_ISSUES 6). Every method takes the owning session id, so concurrent
 * sessions each hold their own pending decision instead of fighting over one
 * global state ("HITL busy" silently swallowing the second session's warn).
 * A session entry is created lazily on first access; `removeSession` drops it
 * (CLI /clear, session teardown).
 */
export class HITLManager {
  private sessions = new Map<string, SessionHITL>();

  private session(sessionId: string): SessionHITL {
    let s = this.sessions.get(sessionId);
    if (s === undefined) {
      s = {
        state: HITLState.IDLE,
        pendingCommand: null,
        pendingAction: null,
        approvedCommands: new Set(),
      };
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  getState(sessionId: string): HITLState {
    return this.session(sessionId).state;
  }

  getPendingCommand(sessionId: string): string | null {
    return this.session(sessionId).pendingCommand;
  }

  /** Full operation behind the pending/approved decision, if any. */
  getPendingAction(sessionId: string): PendingAction | null {
    return this.session(sessionId).pendingAction;
  }

  /**
   * The command authorized by a human decision — the harness must EXECUTE it
   * (SPEC §3.4: approval = authorization to run, not a hint to the LLM).
   * Returns the original (approve) or modified (modify) command after a
   * decision; null for deny or before any decision.
   */
  getApprovedCommand(sessionId: string): string | null {
    const s = this.session(sessionId);
    if (s.state === HITLState.EXECUTING || s.state === HITLState.EXECUTING_MODIFIED) {
      return s.pendingCommand;
    }
    return null;
  }

  /** Full action behind an approved decision (null for deny/IDLE). */
  getApprovedAction(sessionId: string): PendingAction | null {
    const s = this.session(sessionId);
    if (s.state === HITLState.EXECUTING || s.state === HITLState.EXECUTING_MODIFIED) {
      return s.pendingAction;
    }
    return null;
  }

  requestApproval(sessionId: string, command: string, action?: PendingAction): void {
    const s = this.session(sessionId);
    if (s.state !== HITLState.IDLE) {
      throw new Error(`Cannot request approval in state ${s.state}`);
    }
    s.state = HITLState.AWAITING_APPROVAL;
    s.pendingCommand = command;
    s.pendingAction = action ?? null;
  }

  approve(sessionId: string): void {
    const s = this.session(sessionId);
    if (s.state !== HITLState.AWAITING_APPROVAL) {
      throw new Error(`Cannot approve in state ${s.state}`);
    }
    s.state = HITLState.EXECUTING;
    if (s.pendingCommand !== null) {
      s.approvedCommands.add(s.pendingCommand);
    }
  }

  /** True when this exact command was already approved in this session. */
  isApprovedCommand(sessionId: string, command: string): boolean {
    return this.session(sessionId).approvedCommands.has(command);
  }

  approveWithModification(sessionId: string, command: string): void {
    const s = this.session(sessionId);
    if (s.state !== HITLState.AWAITING_APPROVAL) {
      throw new Error(`Cannot approve with modification in state ${s.state}`);
    }
    s.state = HITLState.EXECUTING_MODIFIED;
    s.pendingCommand = command;
  }

  deny(sessionId: string): void {
    const s = this.session(sessionId);
    if (s.state !== HITLState.AWAITING_APPROVAL) {
      throw new Error(`Cannot deny in state ${s.state}`);
    }
    s.state = HITLState.BLOCKED;
  }

  reset(sessionId: string): void {
    const s = this.session(sessionId);
    s.state = HITLState.IDLE;
    s.pendingCommand = null;
    s.pendingAction = null;
  }

  /** Drop a session's state entirely (session deleted/cleared). */
  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
