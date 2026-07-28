import { EventEmitter } from 'events';

export interface HarnessEventMap {
  'message:added': { id: string; role: string; content: string; metadata?: Record<string, unknown>; timestamp: string };
  'tool:executed': { toolName: string; duration_ms: number; success: boolean };
  'feedback:completed': { passed: boolean; validator: string; failureCategory?: string };
  'guardrail:triggered': { rule: string; command: string; level: 'block' | 'warn' };
  'session:status': { sessionId: string; status: string };
  'round:changed': { currentRound: number; maxRounds: number };
}

export interface HarnessEvents {
  on<E extends keyof HarnessEventMap>(event: E, handler: (data: HarnessEventMap[E]) => void): void;
  off<E extends keyof HarnessEventMap>(event: E, handler: (data: HarnessEventMap[E]) => void): void;
  emit<E extends keyof HarnessEventMap>(event: E, data: HarnessEventMap[E]): void;
}

export function createEventBus(): HarnessEvents {
  const emitter = new EventEmitter();
  return {
    on(event, handler) { emitter.on(event, handler); },
    off(event, handler) { emitter.off(event, handler); },
    emit(event, data) { emitter.emit(event, data); },
  };
}
