import { describe, it, expect } from 'vitest';
import { ContextCompressor } from '../../../src/memory/context-compressor.js';
import type { Message } from '../../../src/types.js';

function msg(
  id: string,
  role: Message['role'],
  content: string,
  important?: boolean,
  compressed?: boolean,
): Message {
  return {
    id,
    role,
    content,
    metadata: { important, compressed },
    timestamp: new Date().toISOString(),
  };
}

function makeMessages(
  roundCount: number,
  contentLength: number,
  important?: boolean,
): Message[] {
  const messages: Message[] = [];
  for (let r = 1; r <= roundCount; r++) {
    messages.push(msg(`u-${r}`, 'user', `round ${r} user message with some content for token count estimation`));
    messages.push(
      msg(`a-${r}`, 'assistant', `round ${r} assistant response `.padEnd(contentLength, 'x'), important),
    );
    messages.push(msg(`t-${r}`, 'tool', `round ${r} tool result`));
  }
  return messages;
}

describe('ContextCompressor', () => {
  const maxTokens = 4096;
  const threshold = 0.8;

  // ---- Token Estimation ----

  it('estimateTokens 使用字符数/4 的确定性算法', () => {
    const comp = new ContextCompressor(maxTokens, threshold);
    const messages: Message[] = [
      msg('1', 'user', 'hello world'), // 11 chars
      msg('2', 'assistant', 'ABCDEFGH'), // 8 chars
    ];
    // total chars = 19, tokens = floor(19/4) = 4
    expect(comp.estimateTokens(messages)).toBe(4);
  });

  it('estimateTokens 空消息数组返回 0', () => {
    const comp = new ContextCompressor(maxTokens, threshold);
    expect(comp.estimateTokens([])).toBe(0);
  });

  it('estimateTokens 单个长消息精确字符除 4', () => {
    const comp = new ContextCompressor(maxTokens, threshold);
    const content = 'a'.repeat(1000);
    const messages: Message[] = [msg('1', 'user', content)];
    expect(comp.estimateTokens(messages)).toBe(250);
  });

  // ---- needsCompression ----

  it('needsCompression 低于阈值时返回 false', () => {
    const comp = new ContextCompressor(maxTokens, threshold);
    // threshold = 0.8 * 4096 = 3276 tokens
    // That's 3276 * 4 = 13104 chars
    // Use short messages well below that
    const messages: Message[] = [msg('1', 'user', 'hi')];
    expect(comp.needsCompression(messages)).toBe(false);
  });

  it('needsCompression 高于阈值时返回 true', () => {
    const comp = new ContextCompressor(maxTokens, threshold);
    // Need > 3276 tokens -> > 13104 chars
    // Create a message with > 13104 chars
    const content = 'x'.repeat(15000);
    const messages: Message[] = [msg('1', 'user', content)];
    expect(comp.needsCompression(messages)).toBe(true);
  });

  // ---- Compression: below threshold ----

  it('compress 低于阈值时返回原消息数组（不变）', () => {
    const comp = new ContextCompressor(maxTokens, threshold);
    const messages: Message[] = [
      msg('1', 'user', 'short message'),
      msg('2', 'assistant', 'short reply'),
    ];
    const result = comp.compress(messages);
    expect(result).toEqual(messages);
    expect(result[0].content).toBe('short message');
    expect(result[1].content).toBe('short reply');
  });

  // ---- Compression: above threshold, recent rounds kept ----

  it('compress 超过阈值时最近 8 轮保持全文不变', () => {
    const comp = new ContextCompressor(maxTokens, threshold);
    // Create 10 rounds of messages with long content to exceed threshold
    const allMessages = makeMessages(10, 2000);

    // Manually verify tokens exceed threshold
    const estimated = comp.estimateTokens(allMessages);
    expect(comp.needsCompression(allMessages)).toBe(true);

    const result = comp.compress(allMessages);

    // With assistant-based round counting: each assistant message defines the
    // START of a new round. For makeMessages pattern [u1,a1,t1,u2,a2,t2,...]:
    //   Round 1: a1,t1,u2    Round 2: a2,t2,u3   Round 3: a3,t3,u4  ...
    // maxRound=10, cutoff=2, so rounds > 2 are recent (rounds 3-10)
    // Old (compressed): u1,a1,t1,u2,a2,t2,u3
    // Recent (kept): a3,t3,u4,a4,t4,u5,a5,t5,u6,a6,t6,u7,a7,t7,u8,a8,t8,u9,a9,t9,u10,a10,t10

    const compressed = result.filter((m) => m.metadata?.compressed === true);

    // Old messages (round <= 2) should be compressed
    expect(compressed.find((m) => m.id === 'u-1')).toBeTruthy();
    expect(compressed.find((m) => m.id === 'a-1')).toBeTruthy();
    expect(compressed.find((m) => m.id === 't-1')).toBeTruthy();
    expect(compressed.find((m) => m.id === 'u-2')).toBeTruthy();
    expect(compressed.find((m) => m.id === 'a-2')).toBeTruthy();
    expect(compressed.find((m) => m.id === 't-2')).toBeTruthy();
    expect(compressed.find((m) => m.id === 'u-3')).toBeTruthy();

    // Recent rounds (round > 2) should NOT be compressed
    // a3,t3 through a10,t10 are all recent
    for (let r = 3; r <= 10; r++) {
      const aMsg = result.find((m) => m.id === `a-${r}`);
      expect(aMsg?.content).not.toBe('[Compressed]');
      expect(aMsg?.metadata?.compressed).toBeFalsy();

      const tMsg = result.find((m) => m.id === `t-${r}`);
      expect(tMsg?.content).not.toBe('[Compressed]');
      expect(tMsg?.metadata?.compressed).toBeFalsy();
    }
    // u4 through u10 are also recent
    for (let r = 4; r <= 10; r++) {
      const uMsg = result.find((m) => m.id === `u-${r}`);
      expect(uMsg?.content).not.toBe('[Compressed]');
      expect(uMsg?.metadata?.compressed).toBeFalsy();
    }
  });

  // ---- Compression: old messages content replaced ----

  it('compress 将旧消息的 content 替换为 [Compressed] 并标记 compressed: true', () => {
    const comp = new ContextCompressor(maxTokens, threshold);
    const allMessages = makeMessages(10, 2000);
    const result = comp.compress(allMessages);

    // Round 1 messages should be compressed
    const u1 = result.find((m) => m.id === 'u-1');
    expect(u1?.content).toBe('[Compressed]');
    expect(u1?.metadata?.compressed).toBe(true);

    const a1 = result.find((m) => m.id === 'a-1');
    expect(a1?.content).toBe('[Compressed]');
    expect(a1?.metadata?.compressed).toBe(true);
  });

  // ---- Compression: important messages never compressed ----

  it('compress important 消息永不压缩，即使属于旧轮次', () => {
    const comp = new ContextCompressor(maxTokens, threshold);
    // Create 12 rounds, make rounds 1-2 assistant messages important
    const msgs: Message[] = [];
    const contentLong = 'y'.repeat(2000);
    for (let r = 1; r <= 12; r++) {
      msgs.push(msg(`u-${r}`, 'user', contentLong));
      // Make rounds 1 and 2 important
      msgs.push(msg(`a-${r}`, 'assistant', contentLong, r <= 2));
      msgs.push(msg(`t-${r}`, 'tool', contentLong));
    }

    expect(comp.needsCompression(msgs)).toBe(true);

    const result = comp.compress(msgs);

    // Old important messages (rounds 1-2) should NOT be compressed
    const a1 = result.find((m) => m.id === 'a-1');
    expect(a1?.metadata?.important).toBe(true);
    expect(a1?.content).not.toBe('[Compressed]');
    expect(a1?.metadata?.compressed).toBeFalsy();

    const a2 = result.find((m) => m.id === 'a-2');
    expect(a2?.metadata?.important).toBe(true);
    expect(a2?.content).not.toBe('[Compressed]');
    expect(a2?.metadata?.compressed).toBeFalsy();

    // But other old non-important messages in round 1 (user, tool) SHOULD be compressed
    const u1 = result.find((m) => m.id === 'u-1');
    expect(u1?.content).toBe('[Compressed]');
    expect(u1?.metadata?.compressed).toBe(true);

    const t1 = result.find((m) => m.id === 't-1');
    expect(t1?.content).toBe('[Compressed]');
    expect(t1?.metadata?.compressed).toBe(true);
  });

  // ---- Compression: only 8 rounds total ----

  it('compress 仅有 8 轮或更少时不压缩任何消息', () => {
    const comp = new ContextCompressor(maxTokens, threshold);
    const allMessages = makeMessages(8, 2000);

    expect(comp.needsCompression(allMessages)).toBe(true);

    const result = comp.compress(allMessages);

    // All 8 rounds are recent, nothing should be compressed
    const compressed = result.filter((m) => m.metadata?.compressed === true);
    expect(compressed.length).toBe(0);
  });

  // ---- Compression: returns new array ----

  it('compress 返回新数组，不修改原数组', () => {
    const comp = new ContextCompressor(maxTokens, threshold);
    const allMessages = makeMessages(10, 2000);
    const originalCopy = JSON.parse(JSON.stringify(allMessages));

    const result = comp.compress(allMessages);

    // Original should be unchanged
    expect(allMessages).toEqual(originalCopy);
    // Result should be different (for compressed messages)
    const hasCompressed = result.some((m) => m.metadata?.compressed === true);
    expect(hasCompressed).toBe(true);
  });

  // ---- Compression: below threshold no compression regardless of rounds ----

  it('compress 低于阈值即使有 20 轮也不压缩', () => {
    const comp = new ContextCompressor(maxTokens, threshold);
    // Short messages - many rounds but low total tokens
    const msgs: Message[] = [];
    for (let r = 1; r <= 20; r++) {
      msgs.push(msg(`u-${r}`, 'user', 'hi'));
      msgs.push(msg(`a-${r}`, 'assistant', 'ok'));
    }

    expect(comp.needsCompression(msgs)).toBe(false);

    const result = comp.compress(msgs);
    expect(result).toEqual(msgs);
  });

  // ---- Edge case: important metadata is undefined ----

  it('estimateTokens 处理 metadata 为 undefined 的消息', () => {
    const comp = new ContextCompressor(maxTokens, threshold);
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'test message', timestamp: new Date().toISOString() },
    ];
    expect(comp.estimateTokens(messages)).toBe(3); // 12 chars / 4 = 3
  });
});
