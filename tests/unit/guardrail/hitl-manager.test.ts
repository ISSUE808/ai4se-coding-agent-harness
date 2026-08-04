import { describe, it, expect } from 'vitest';
import { HITLManager, HITLState } from '../../../src/guardrail/hitl-manager.js';

describe('HITLManager', () => {
  describe('初始状态', () => {
    it('初始状态为 IDLE', () => {
      const hitl = new HITLManager();
      expect(hitl.getState('s1')).toBe(HITLState.IDLE);
    });

    it('初始没有待审批命令', () => {
      const hitl = new HITLManager();
      expect(hitl.getPendingCommand('s1')).toBeNull();
    });
  });

  describe('requestApproval', () => {
    it('从 IDLE 转到 AWAITING_APPROVAL', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('s1', 'rm -rf /tmp/build');
      expect(hitl.getState('s1')).toBe(HITLState.AWAITING_APPROVAL);
    });

    it('存储原始命令供后续查看', () => {
      const hitl = new HITLManager();
      const cmd = 'npm run deploy';
      hitl.requestApproval('s1', cmd);
      expect(hitl.getPendingCommand('s1')).toBe(cmd);
    });

    it('已在 AWAITING_APPROVAL 时再次请求应抛异常', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('s1', 'cmd1');
      expect(() => hitl.requestApproval('s1', 'cmd2')).toThrow();
    });

    it('已在 EXECUTING 时再次请求应抛异常', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('s1', 'cmd');
      hitl.approve('s1');
      expect(() => hitl.requestApproval('s1', 'cmd2')).toThrow();
    });
  });

  describe('approve', () => {
    it('从 AWAITING_APPROVAL 转到 EXECUTING', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('s1', 'echo hello');
      hitl.approve('s1');
      expect(hitl.getState('s1')).toBe(HITLState.EXECUTING);
    });

    it('携带原始命令', () => {
      const hitl = new HITLManager();
      const cmd = 'npm test';
      hitl.requestApproval('s1', cmd);
      hitl.approve('s1');
      expect(hitl.getPendingCommand('s1')).toBe(cmd);
    });

    it('从 IDLE 直接 approve 应抛异常', () => {
      const hitl = new HITLManager();
      expect(() => hitl.approve('s1')).toThrow();
    });

    it('已在 EXECUTING 时再次 approve 应抛异常', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('s1', 'cmd');
      hitl.approve('s1');
      expect(() => hitl.approve('s1')).toThrow();
    });

    it('已在 BLOCKED 时 approve 应抛异常', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('s1', 'cmd');
      hitl.deny('s1');
      expect(() => hitl.approve('s1')).toThrow();
    });
  });

  describe('approveWithModification', () => {
    it('从 AWAITING_APPROVAL 转到 EXECUTING_MODIFIED', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('s1', 'dangerous-command');
      hitl.approveWithModification('s1', 'safe-command');
      expect(hitl.getState('s1')).toBe(HITLState.EXECUTING_MODIFIED);
    });

    it('存储修改后的命令', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('s1', 'original');
      hitl.approveWithModification('s1', 'modified');
      expect(hitl.getPendingCommand('s1')).toBe('modified');
    });

    it('从 IDLE 直接 approveWithModification 应抛异常', () => {
      const hitl = new HITLManager();
      expect(() => hitl.approveWithModification('s1', 'cmd')).toThrow();
    });

    it('已在 EXECUTING 时 approveWithModification 应抛异常', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('s1', 'cmd');
      hitl.approve('s1');
      expect(() => hitl.approveWithModification('s1', 'cmd2')).toThrow();
    });
  });

  describe('deny', () => {
    it('从 AWAITING_APPROVAL 转到 BLOCKED', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('s1', 'bad-command');
      hitl.deny('s1');
      expect(hitl.getState('s1')).toBe(HITLState.BLOCKED);
    });

    it('从 IDLE 直接 deny 应抛异常', () => {
      const hitl = new HITLManager();
      expect(() => hitl.deny('s1')).toThrow();
    });

    it('已在 BLOCKED 时再次 deny 应抛异常', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('s1', 'cmd');
      hitl.deny('s1');
      expect(() => hitl.deny('s1')).toThrow();
    });
  });

  describe('无超时', () => {
    it('等待 100ms 后仍为 AWAITING_APPROVAL', async () => {
      const hitl = new HITLManager();
      hitl.requestApproval('s1', 'some command');
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(hitl.getState('s1')).toBe(HITLState.AWAITING_APPROVAL);
    });

    it('长时间等待后状态不变', async () => {
      const hitl = new HITLManager();
      hitl.requestApproval('s1', 'some command');
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(hitl.getState('s1')).toBe(HITLState.AWAITING_APPROVAL);
      expect(hitl.getPendingCommand('s1')).toBe('some command');
    });
  });

  describe('reset', () => {
    it('从 AWAITING_APPROVAL 回到 IDLE', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('s1', 'cmd');
      hitl.reset('s1');
      expect(hitl.getState('s1')).toBe(HITLState.IDLE);
      expect(hitl.getPendingCommand('s1')).toBeNull();
    });

    it('从 EXECUTING 回到 IDLE', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('s1', 'cmd');
      hitl.approve('s1');
      hitl.reset('s1');
      expect(hitl.getState('s1')).toBe(HITLState.IDLE);
      expect(hitl.getPendingCommand('s1')).toBeNull();
    });

    it('从 EXECUTING_MODIFIED 回到 IDLE', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('s1', 'cmd');
      hitl.approveWithModification('s1', 'mod');
      hitl.reset('s1');
      expect(hitl.getState('s1')).toBe(HITLState.IDLE);
      expect(hitl.getPendingCommand('s1')).toBeNull();
    });

    it('从 BLOCKED 回到 IDLE', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('s1', 'cmd');
      hitl.deny('s1');
      hitl.reset('s1');
      expect(hitl.getState('s1')).toBe(HITLState.IDLE);
      expect(hitl.getPendingCommand('s1')).toBeNull();
    });

    it('从 IDLE 也可以 reset', () => {
      const hitl = new HITLManager();
      hitl.reset('s1');
      expect(hitl.getState('s1')).toBe(HITLState.IDLE);
    });
  });

  describe('确定性', () => {
    it('相同输入产生相同状态转换', () => {
      const a = new HITLManager();
      const b = new HITLManager();

      a.requestApproval('s1', 'test');
      b.requestApproval('s1', 'test');

      expect(a.getState('s1')).toBe(b.getState('s1'));
      expect(a.getPendingCommand('s1')).toBe(b.getPendingCommand('s1'));

      a.approve('s1');
      b.approve('s1');

      expect(a.getState('s1')).toBe(b.getState('s1'));
    });
  });
});

describe('KNOWN_ISSUES 6: 多会话键控', () => {
  it('两个会话可并发 pending，互不干扰', () => {
    const hitl = new HITLManager();
    hitl.requestApproval('sess-a', 'cmd-a');
    // Second session must NOT hit "HITL busy" — keyed state per session.
    expect(() => hitl.requestApproval('sess-b', 'cmd-b')).not.toThrow();
    expect(hitl.getState('sess-a')).toBe(HITLState.AWAITING_APPROVAL);
    expect(hitl.getState('sess-b')).toBe(HITLState.AWAITING_APPROVAL);
    expect(hitl.getPendingCommand('sess-a')).toBe('cmd-a');
    expect(hitl.getPendingCommand('sess-b')).toBe('cmd-b');
  });

  it('批准只影响对应会话', () => {
    const hitl = new HITLManager();
    hitl.requestApproval('sess-a', 'cmd-a');
    hitl.requestApproval('sess-b', 'cmd-b');
    hitl.approve('sess-a');
    expect(hitl.getState('sess-a')).toBe(HITLState.EXECUTING);
    // sess-b still awaiting — a human decision on A must not resolve B.
    expect(hitl.getState('sess-b')).toBe(HITLState.AWAITING_APPROVAL);
    expect(() => hitl.deny('sess-b')).not.toThrow();
    expect(hitl.getState('sess-b')).toBe(HITLState.BLOCKED);
  });

  it('已批准命令缓存按会话隔离', () => {
    const hitl = new HITLManager();
    hitl.requestApproval('sess-a', 'cmd-a');
    hitl.approve('sess-a');
    expect(hitl.isApprovedCommand('sess-a', 'cmd-a')).toBe(true);
    // The same command is NOT pre-approved for another session.
    expect(hitl.isApprovedCommand('sess-b', 'cmd-a')).toBe(false);
  });

  it('reset 只清对应会话，不动其他会话', () => {
    const hitl = new HITLManager();
    hitl.requestApproval('sess-a', 'cmd-a');
    hitl.requestApproval('sess-b', 'cmd-b');
    hitl.reset('sess-a');
    expect(hitl.getState('sess-a')).toBe(HITLState.IDLE);
    expect(hitl.getState('sess-b')).toBe(HITLState.AWAITING_APPROVAL);
  });
});

describe('removeSession (KNOWN_ISSUES 6)', () => {
  it('删除会话条目后状态回到 IDLE（新条目）', () => {
    const hitl = new HITLManager();
    hitl.requestApproval('s1', 'cmd-a');
    hitl.approve('s1');
    expect(hitl.getState('s1')).toBe(HITLState.EXECUTING);
    hitl.removeSession('s1');
    expect(hitl.getState('s1')).toBe(HITLState.IDLE);
    // Approved-command cache is gone with the entry — a re-issued command
    // must be confirmed again (REPL /clear semantics, KNOWN_ISSUES 6).
    expect(hitl.isApprovedCommand('s1', 'cmd-a')).toBe(false);
  });

  it('删除一个会话不影响其他会话', () => {
    const hitl = new HITLManager();
    hitl.requestApproval('s1', 'cmd-a');
    hitl.requestApproval('s2', 'cmd-b');
    hitl.removeSession('s1');
    expect(hitl.getState('s2')).toBe(HITLState.AWAITING_APPROVAL);
    expect(hitl.getPendingCommand('s2')).toBe('cmd-b');
  });
});
