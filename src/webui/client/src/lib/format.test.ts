import { describe, expect, it } from 'vitest';
import { formatDuration, formatSessionStatusLabel, formatTokens } from './format';

describe('formatDuration', () => {
  it('formats zero as 00:00', () => {
    expect(formatDuration(0)).toBe('00:00');
  });

  it('formats seconds below an hour as MM:SS', () => {
    expect(formatDuration(401)).toBe('06:41');
    expect(formatDuration(752)).toBe('12:32');
  });

  it('formats an hour or more as HH:MM:SS', () => {
    expect(formatDuration(3661)).toBe('01:01:01');
  });
});

describe('formatTokens', () => {
  it('formats small counts as plain digits', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(847)).toBe('847');
  });

  it('formats thousands with one K decimal, stripping trailing .0', () => {
    expect(formatTokens(128400)).toBe('128.4K');
    expect(formatTokens(847000)).toBe('847K');
    expect(formatTokens(212900)).toBe('212.9K');
  });

  it('formats millions with one M decimal', () => {
    expect(formatTokens(1234567)).toBe('1.2M');
  });
});

describe('formatSessionStatusLabel', () => {
  it('maps every session status to its label', () => {
    expect(formatSessionStatusLabel('running')).toBe('运行中');
    expect(formatSessionStatusLabel('paused')).toBe('已暂停');
    expect(formatSessionStatusLabel('completed')).toBe('已完成');
    expect(formatSessionStatusLabel('failed')).toBe('失败');
  });
});
