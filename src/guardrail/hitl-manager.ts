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
}

export class HITLManager {
  private state: HITLState = HITLState.IDLE;
  private pendingCommand: string | null = null;
  /** Full action behind the pending/approved decision — lets the harness
   *  execute the authorized operation (shell command, file write, …). */
  private pendingAction: PendingAction | null = null;

  getState(): HITLState {
    return this.state;
  }

  getPendingCommand(): string | null {
    return this.pendingCommand;
  }

  /** Full operation behind the pending/approved decision, if any. */
  getPendingAction(): PendingAction | null {
    return this.pendingAction;
  }

  /**
   * The command authorized by a human decision — the harness must EXECUTE it
   * (SPEC §3.4: approval = authorization to run, not a hint to the LLM).
   * Returns the original (approve) or modified (modify) command after a
   * decision; null for deny or before any decision.
   */
  getApprovedCommand(): string | null {
    if (this.state === HITLState.EXECUTING || this.state === HITLState.EXECUTING_MODIFIED) {
      return this.pendingCommand;
    }
    return null;
  }

  /** Full action behind an approved decision (null for deny/IDLE). */
  getApprovedAction(): PendingAction | null {
    if (this.state === HITLState.EXECUTING || this.state === HITLState.EXECUTING_MODIFIED) {
      return this.pendingAction;
    }
    return null;
  }

  requestApproval(command: string, action?: PendingAction): void {
    if (this.state !== HITLState.IDLE) {
      throw new Error(`Cannot request approval in state ${this.state}`);
    }
    this.state = HITLState.AWAITING_APPROVAL;
    this.pendingCommand = command;
    this.pendingAction = action ?? null;
  }

  approve(): void {
    if (this.state !== HITLState.AWAITING_APPROVAL) {
      throw new Error(`Cannot approve in state ${this.state}`);
    }
    this.state = HITLState.EXECUTING;
  }

  approveWithModification(command: string): void {
    if (this.state !== HITLState.AWAITING_APPROVAL) {
      throw new Error(`Cannot approve with modification in state ${this.state}`);
    }
    this.state = HITLState.EXECUTING_MODIFIED;
    this.pendingCommand = command;
  }

  deny(): void {
    if (this.state !== HITLState.AWAITING_APPROVAL) {
      throw new Error(`Cannot deny in state ${this.state}`);
    }
    this.state = HITLState.BLOCKED;
  }

  reset(): void {
    this.state = HITLState.IDLE;
    this.pendingCommand = null;
    this.pendingAction = null;
  }
}
