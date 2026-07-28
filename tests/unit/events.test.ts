import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from '../../src/events.js';

describe('EventBus', () => {
  it('能够发送和接收 message:added 事件', () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on('message:added', handler);
    bus.emit('message:added', { id: '1', role: 'user', content: 'hello', timestamp: '' });
    expect(handler).toHaveBeenCalledWith({ id: '1', role: 'user', content: 'hello', timestamp: '' });
  });

  it('支持同一事件的多个处理函数', () => {
    const bus = createEventBus();
    const h1 = vi.fn(), h2 = vi.fn();
    bus.on('tool:executed', h1);
    bus.on('tool:executed', h2);
    bus.emit('tool:executed', { toolName: 'read_file', duration_ms: 10, success: true });
    expect(h1).toHaveBeenCalled();
    expect(h2).toHaveBeenCalled();
  });

  it('能够通过 off() 移除处理函数', () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on('guardrail:triggered', handler);
    bus.off('guardrail:triggered', handler);
    bus.emit('guardrail:triggered', { rule: 'rm', command: 'rm -rf /', level: 'block' });
    expect(handler).not.toHaveBeenCalled();
  });
});
