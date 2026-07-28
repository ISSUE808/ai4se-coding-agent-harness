import { describe, it, expect } from 'vitest';
import { MockProvider } from '../../../src/llm/mock-provider.js';
import type { LLMResponse, Message, Tool } from '../../../src/types.js';

const dummyMessages: Message[] = [
  { id: '1', role: 'user', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' },
];
const dummyTools: Tool[] = [];

describe('MockProvider', () => {
  it('returns responses in order', async () => {
    const responses: LLMResponse[] = [
      { content: 'first response' },
      { content: 'second response' },
    ];
    const provider = new MockProvider(responses);

    const r1 = await provider.complete(dummyMessages, dummyTools);
    const r2 = await provider.complete(dummyMessages, dummyTools);

    expect(r1.content).toBe('first response');
    expect(r2.content).toBe('second response');
  });

  it('returns tool calls when the injected response has toolCalls', async () => {
    const responses: LLMResponse[] = [
      {
        content: null,
        toolCalls: [{ name: 'read_file', arguments: { filePath: '/src/a.ts' } }],
      },
    ];
    const provider = new MockProvider(responses);

    const r1 = await provider.complete(dummyMessages, dummyTools);

    expect(r1.content).toBeNull();
    expect(r1.toolCalls).toHaveLength(1);
    expect(r1.toolCalls![0].name).toBe('read_file');
    expect(r1.toolCalls![0].arguments).toEqual({ filePath: '/src/a.ts' });
  });

  it('throws when responses are exhausted', async () => {
    const provider = new MockProvider([]);

    await expect(provider.complete(dummyMessages, dummyTools)).rejects.toThrow();
  });

  it('exposes remaining count', () => {
    const provider = new MockProvider([
      { content: 'a' },
      { content: 'b' },
    ]);

    expect(provider.remaining).toBe(2);
  });
});
