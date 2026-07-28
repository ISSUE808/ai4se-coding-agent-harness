export enum HITLState {
  IDLE = 'IDLE',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  EXECUTING = 'EXECUTING',
  EXECUTING_MODIFIED = 'EXECUTING_MODIFIED',
  BLOCKED = 'BLOCKED',
}

export class HITLManager {
  private state: HITLState = HITLState.IDLE;
  private pendingCommand: string | null = null;

  getState(): HITLState {
    return this.state;
  }

  getPendingCommand(): string | null {
    return this.pendingCommand;
  }

  requestApproval(command: string): void {
    if (this.state !== HITLState.IDLE) {
      throw new Error(`Cannot request approval in state ${this.state}`);
    }
    this.state = HITLState.AWAITING_APPROVAL;
    this.pendingCommand = command;
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
  }
}
