import { describe, it, expect } from 'vitest';
import { HITLManager, HITLState } from '../../../src/guardrail/hitl-manager.js';

describe('HITLManager', () => {
  describe('初始状态', () => {
    it('初始状态为 IDLE', () => {
      const hitl = new HITLManager();
      expect(hitl.getState()).toBe(HITLState.IDLE);
    });

    it('初始没有待审批命令', () => {
      const hitl = new HITLManager();
      expect(hitl.getPendingCommand()).toBeNull();
    });
  });

  describe('requestApproval', () => {
    it('从 IDLE 转到 AWAITING_APPROVAL', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('rm -rf /tmp/build');
      expect(hitl.getState()).toBe(HITLState.AWAITING_APPROVAL);
    });

    it('存储原始命令供后续查看', () => {
      const hitl = new HITLManager();
      const cmd = 'npm run deploy';
      hitl.requestApproval(cmd);
      expect(hitl.getPendingCommand()).toBe(cmd);
    });

    it('已在 AWAITING_APPROVAL 时再次请求应抛异常', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('cmd1');
      expect(() => hitl.requestApproval('cmd2')).toThrow();
    });

    it('已在 EXECUTING 时再次请求应抛异常', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('cmd');
      hitl.approve();
      expect(() => hitl.requestApproval('cmd2')).toThrow();
    });
  });

  describe('approve', () => {
    it('从 AWAITING_APPROVAL 转到 EXECUTING', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('echo hello');
      hitl.approve();
      expect(hitl.getState()).toBe(HITLState.EXECUTING);
    });

    it('携带原始命令', () => {
      const hitl = new HITLManager();
      const cmd = 'npm test';
      hitl.requestApproval(cmd);
      hitl.approve();
      expect(hitl.getPendingCommand()).toBe(cmd);
    });

    it('从 IDLE 直接 approve 应抛异常', () => {
      const hitl = new HITLManager();
      expect(() => hitl.approve()).toThrow();
    });

    it('已在 EXECUTING 时再次 approve 应抛异常', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('cmd');
      hitl.approve();
      expect(() => hitl.approve()).toThrow();
    });

    it('已在 BLOCKED 时 approve 应抛异常', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('cmd');
      hitl.deny();
      expect(() => hitl.approve()).toThrow();
    });
  });

  describe('approveWithModification', () => {
    it('从 AWAITING_APPROVAL 转到 EXECUTING_MODIFIED', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('dangerous-command');
      hitl.approveWithModification('safe-command');
      expect(hitl.getState()).toBe(HITLState.EXECUTING_MODIFIED);
    });

    it('存储修改后的命令', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('original');
      hitl.approveWithModification('modified');
      expect(hitl.getPendingCommand()).toBe('modified');
    });

    it('从 IDLE 直接 approveWithModification 应抛异常', () => {
      const hitl = new HITLManager();
      expect(() => hitl.approveWithModification('cmd')).toThrow();
    });

    it('已在 EXECUTING 时 approveWithModification 应抛异常', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('cmd');
      hitl.approve();
      expect(() => hitl.approveWithModification('cmd2')).toThrow();
    });
  });

  describe('deny', () => {
    it('从 AWAITING_APPROVAL 转到 BLOCKED', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('bad-command');
      hitl.deny();
      expect(hitl.getState()).toBe(HITLState.BLOCKED);
    });

    it('从 IDLE 直接 deny 应抛异常', () => {
      const hitl = new HITLManager();
      expect(() => hitl.deny()).toThrow();
    });

    it('已在 BLOCKED 时再次 deny 应抛异常', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('cmd');
      hitl.deny();
      expect(() => hitl.deny()).toThrow();
    });
  });

  describe('无超时', () => {
    it('等待 100ms 后仍为 AWAITING_APPROVAL', async () => {
      const hitl = new HITLManager();
      hitl.requestApproval('some command');
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(hitl.getState()).toBe(HITLState.AWAITING_APPROVAL);
    });

    it('长时间等待后状态不变', async () => {
      const hitl = new HITLManager();
      hitl.requestApproval('some command');
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(hitl.getState()).toBe(HITLState.AWAITING_APPROVAL);
      expect(hitl.getPendingCommand()).toBe('some command');
    });
  });

  describe('reset', () => {
    it('从 AWAITING_APPROVAL 回到 IDLE', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('cmd');
      hitl.reset();
      expect(hitl.getState()).toBe(HITLState.IDLE);
      expect(hitl.getPendingCommand()).toBeNull();
    });

    it('从 EXECUTING 回到 IDLE', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('cmd');
      hitl.approve();
      hitl.reset();
      expect(hitl.getState()).toBe(HITLState.IDLE);
      expect(hitl.getPendingCommand()).toBeNull();
    });

    it('从 EXECUTING_MODIFIED 回到 IDLE', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('cmd');
      hitl.approveWithModification('mod');
      hitl.reset();
      expect(hitl.getState()).toBe(HITLState.IDLE);
      expect(hitl.getPendingCommand()).toBeNull();
    });

    it('从 BLOCKED 回到 IDLE', () => {
      const hitl = new HITLManager();
      hitl.requestApproval('cmd');
      hitl.deny();
      hitl.reset();
      expect(hitl.getState()).toBe(HITLState.IDLE);
      expect(hitl.getPendingCommand()).toBeNull();
    });

    it('从 IDLE 也可以 reset', () => {
      const hitl = new HITLManager();
      hitl.reset();
      expect(hitl.getState()).toBe(HITLState.IDLE);
    });
  });

  describe('确定性', () => {
    it('相同输入产生相同状态转换', () => {
      const a = new HITLManager();
      const b = new HITLManager();

      a.requestApproval('test');
      b.requestApproval('test');

      expect(a.getState()).toBe(b.getState());
      expect(a.getPendingCommand()).toBe(b.getPendingCommand());

      a.approve();
      b.approve();

      expect(a.getState()).toBe(b.getState());
    });
  });
});
