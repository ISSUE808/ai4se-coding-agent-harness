import { describe, it, expect, vi, beforeEach } from 'vitest';
import OpenAI from 'openai';
import { DeepSeekProvider } from '../../../src/llm/deepseek-provider.js';
import type { Message, Tool, ToolResult, ToolContext } from '../../../src/types.js';

vi.mock('openai', () => ({
  default: vi.fn(),
}));

const MockedOpenAI = vi.mocked(OpenAI);

let mockCreate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate = vi.fn();
  MockedOpenAI.mockImplementation(
    () =>
      ({
        chat: {
          completions: {
            create: mockCreate,
          },
        },
      }) as unknown as OpenAI,
  );
});

const dummyExecute = async (
  _params: Record<string, unknown>,
  _context: ToolContext,
): Promise<ToolResult> => {
  return { success: true, output: 'ok', duration_ms: 0 };
};

const dummyMessages: Message[] = [
  {
    id: '1',
    role: 'user',
    content: 'Hello',
    timestamp: '2026-01-01T00:00:00.000Z',
  },
];

const dummyTools: Tool[] = [
  {
    name: 'read_file',
    description: 'Read a file from the workspace',
    parameters: {
      type: 'object',
      properties: { filePath: { type: 'string' } },
      required: ['filePath'],
    },
    execute: dummyExecute,
  },
];

const defaultConfig = {
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'sk-test-key-123',
  model: 'deepseek-chat',
  maxTokens: 4096,
};

describe('DeepSeekProvider', () => {
  it('returns content from LLM response', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Hello from DeepSeek' } }],
    });

    const provider = new DeepSeekProvider(defaultConfig);
    const result = await provider.complete(dummyMessages, []);

    expect(result.content).toBe('Hello from DeepSeek');
    expect(result.toolCalls).toBeUndefined();
  });

  it('returns null content when LLM returns null content', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: null, tool_calls: [] } }],
    });

    const provider = new DeepSeekProvider(defaultConfig);
    const result = await provider.complete(dummyMessages, dummyTools);

    expect(result.content).toBeNull();
    expect(result.toolCalls).toBeUndefined();
  });

  it('returns tool_calls parsed from LLM response', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_123',
                type: 'function',
                function: {
                  name: 'read_file',
                  arguments: '{"filePath":"/src/a.ts"}',
                },
              },
            ],
          },
        },
      ],
    });

    const provider = new DeepSeekProvider(defaultConfig);
    const result = await provider.complete(dummyMessages, dummyTools);

    expect(result.content).toBeNull();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe('read_file');
    expect(result.toolCalls![0].arguments).toEqual({ filePath: '/src/a.ts' });
  });

  it('returns both content and tool_calls when both present', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Let me read that file.',
            tool_calls: [
              {
                id: 'call_456',
                type: 'function',
                function: {
                  name: 'read_file',
                  arguments: '{"filePath":"/tmp/test.txt"}',
                },
              },
            ],
          },
        },
      ],
    });

    const provider = new DeepSeekProvider(defaultConfig);
    const result = await provider.complete(dummyMessages, dummyTools);

    expect(result.content).toBe('Let me read that file.');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe('read_file');
    expect(result.toolCalls![0].arguments).toEqual({ filePath: '/tmp/test.txt' });
  });

  it('correctly formats messages into OpenAI messages array', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'OK' } }],
    });

    const messages: Message[] = [
      {
        id: 'm1',
        role: 'system',
        content: 'You are a coding assistant.',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'm2',
        role: 'user',
        content: 'Write a function.',
        timestamp: '2026-01-01T00:00:01.000Z',
      },
      {
        id: 'm3',
        role: 'assistant',
        content: 'Here is the code.',
        timestamp: '2026-01-01T00:00:02.000Z',
      },
    ];

    const provider = new DeepSeekProvider(defaultConfig);
    await provider.complete(messages, []);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages).toEqual([
      { role: 'system', content: 'You are a coding assistant.' },
      { role: 'user', content: 'Write a function.' },
      { role: 'assistant', content: 'Here is the code.' },
    ]);
  });

  it('correctly formats tools into OpenAI tools array (excluding execute)', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'OK' } }],
    });

    const provider = new DeepSeekProvider(defaultConfig);
    await provider.complete(dummyMessages, dummyTools);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file from the workspace',
          parameters: {
            type: 'object',
            properties: { filePath: { type: 'string' } },
            required: ['filePath'],
          },
        },
      },
    ]);

    // Ensure 'execute' was NOT included in the serialized tool
    const serialized = JSON.stringify(callArgs.tools);
    expect(serialized).not.toContain('execute');
    expect(serialized).not.toContain('dummyExecute');
  });

  it('normalizes property-table parameters into a JSON Schema object (real tool format)', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'OK' } }],
    });

    // Real tools declare parameters as a bare property table (no type/properties
    // wrapper) — DeepSeek rejects schemas without `type: "object"` (400).
    const realTool: Tool = {
      name: 'read_file',
      description: 'Read a file from the workspace',
      parameters: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of file paths to read, relative to the workspace root.',
        },
      },
      execute: dummyExecute,
    };

    const provider = new DeepSeekProvider(defaultConfig);
    await provider.complete(dummyMessages, [realTool]);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.tools[0].function.parameters).toEqual({
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of file paths to read, relative to the workspace root.',
        },
      },
      required: ['paths'],
    });
  });

  it('passes through already-standard JSON Schema parameters unchanged', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'OK' } }],
    });

    const provider = new DeepSeekProvider(defaultConfig);
    await provider.complete(dummyMessages, dummyTools);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.tools[0].function.parameters).toEqual(dummyTools[0].parameters);
  });

  it('does not pass tools field when tools array is empty', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'OK' } }],
    });

    const provider = new DeepSeekProvider(defaultConfig);
    await provider.complete(dummyMessages, []);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.tools).toBeUndefined();
  });

  it('passes model and max_tokens from constructor config', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'OK' } }],
    });

    const provider = new DeepSeekProvider({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-custom-key',
      model: 'deepseek-coder',
      maxTokens: 8192,
    });
    await provider.complete(dummyMessages, []);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('deepseek-coder');
    expect(callArgs.max_tokens).toBe(8192);
  });

  it('uses apiKey from constructor (not hardcoded)', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'OK' } }],
    });

    const customKey = 'sk-my-secret-key-xyz';
    const provider = new DeepSeekProvider({
      baseUrl: 'https://api.deepseek.com',
      apiKey: customKey,
      model: 'deepseek-chat',
      maxTokens: 4096,
    });
    await provider.complete(dummyMessages, []);

    // Verify the OpenAI client was constructed with the correct apiKey
    const openAiConstructorCall = MockedOpenAI.mock.calls[0][0];
    expect(openAiConstructorCall).toBeDefined();
    expect(openAiConstructorCall.apiKey).toBe(customKey);
    expect(openAiConstructorCall.apiKey).not.toBe('');
  });

  it('passes baseUrl to OpenAI client constructor', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'OK' } }],
    });

    const provider = new DeepSeekProvider({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      maxTokens: 4096,
    });
    await provider.complete(dummyMessages, []);

    const openAiConstructorCall = MockedOpenAI.mock.calls[0][0];
    expect(openAiConstructorCall.baseURL).toBe('https://api.deepseek.com/v1');
  });

  it('handles multiple tool_calls in a single response', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'read_file',
                  arguments: '{"filePath":"/src/a.ts"}',
                },
              },
              {
                id: 'call_2',
                type: 'function',
                function: {
                  name: 'write_file',
                  arguments: '{"filePath":"/src/b.ts","content":"// code"}',
                },
              },
            ],
          },
        },
      ],
    });

    const provider = new DeepSeekProvider(defaultConfig);
    const result = await provider.complete(dummyMessages, dummyTools);

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls![0]).toEqual({
      name: 'read_file',
      arguments: { filePath: '/src/a.ts' },
    });
    expect(result.toolCalls![1]).toEqual({
      name: 'write_file',
      arguments: { filePath: '/src/b.ts', content: '// code' },
    });
  });
});
