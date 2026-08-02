import { describe, it, expect } from 'vitest';
import { RoundManager } from '../../../src/feedback/round-manager.js';

describe('RoundManager', () => {
  it('new RoundManager(3) starts at round 1, shouldUpgrade() = false', () => {
    const rm = new RoundManager(3);
    expect(rm.currentRound).toBe(1);
    expect(rm.shouldUpgrade()).toBe(false);
  });

  it('nextRound() increments to round 2, shouldUpgrade() = false', () => {
    const rm = new RoundManager(3);
    rm.nextRound();
    expect(rm.currentRound).toBe(2);
    expect(rm.shouldUpgrade()).toBe(false);
  });

  it('nextRound() increments to round 3, shouldUpgrade() = false', () => {
    const rm = new RoundManager(3);
    rm.nextRound();
    rm.nextRound();
    expect(rm.currentRound).toBe(3);
    expect(rm.shouldUpgrade()).toBe(false);
  });

  it('nextRound() beyond maxRounds sets round 4, shouldUpgrade() = true', () => {
    const rm = new RoundManager(3);
    rm.nextRound();
    rm.nextRound();
    rm.nextRound();
    expect(rm.currentRound).toBe(4);
    expect(rm.shouldUpgrade()).toBe(true);
  });

  it('reset() returns to round 1, shouldUpgrade() = false', () => {
    const rm = new RoundManager(3);
    rm.nextRound();
    rm.nextRound();
    rm.nextRound();
    rm.reset();
    expect(rm.currentRound).toBe(1);
    expect(rm.shouldUpgrade()).toBe(false);
  });

  it('works with different maxRounds (5)', () => {
    const rm = new RoundManager(5);
    expect(rm.currentRound).toBe(1);
    expect(rm.shouldUpgrade()).toBe(false);
    for (let i = 0; i < 4; i++) rm.nextRound();
    expect(rm.currentRound).toBe(5);
    expect(rm.shouldUpgrade()).toBe(false);
    rm.nextRound();
    expect(rm.currentRound).toBe(6);
    expect(rm.shouldUpgrade()).toBe(true);
  });

  it('shouldUpgrade() returns false while currentRound <= maxRounds', () => {
    const rm = new RoundManager(2);
    expect(rm.shouldUpgrade()).toBe(false); // round 1 <= 2
    rm.nextRound();
    expect(rm.shouldUpgrade()).toBe(false); // round 2 <= 2
    rm.nextRound();
    expect(rm.shouldUpgrade()).toBe(true);  // round 3 > 2
  });

  it('maxRounds = 0 means unlimited — shouldUpgrade() is always false', () => {
    const rm = new RoundManager(0);
    expect(rm.shouldUpgrade()).toBe(false);
    for (let i = 0; i < 500; i++) rm.nextRound();
    expect(rm.currentRound).toBe(501);
    expect(rm.shouldUpgrade()).toBe(false);
  });

  it('rejects a negative maxRounds', () => {
    expect(() => new RoundManager(-1)).toThrow(/>= 0/);
  });
});
