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

  it('formats assistant tool_calls and tool results with tool_call_id (OpenAI protocol)', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'OK' } }],
    });

    // Round 2 context: assistant declared tool_calls, tool reported its result.
    const messages: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: 'Reading the file.',
        metadata: {
          toolInput: {
            toolCalls: [{ id: 'call_1', name: 'read_file', arguments: { paths: ['a.ts'] } }],
          },
        },
        timestamp: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 't1',
        role: 'tool',
        content: 'ok',
        metadata: { toolCallId: 'call_1' },
        timestamp: '2026-01-01T00:00:01.000Z',
      },
    ];

    const provider = new DeepSeekProvider(defaultConfig);
    await provider.complete(messages, []);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages).toEqual([
      {
        role: 'assistant',
        content: 'Reading the file.',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"paths":["a.ts"]}' },
          },
        ],
      },
      { role: 'tool', content: 'ok', tool_call_id: 'call_1' },
    ]);
  });

  it('carries tool_call ids through to the parsed toolCalls', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_xyz',
                type: 'function',
                function: { name: 'read_file', arguments: '{"paths":["a.ts"]}' },
              },
            ],
          },
        },
      ],
    });

    const provider = new DeepSeekProvider(defaultConfig);
    const result = await provider.complete(dummyMessages, []);

    expect(result.toolCalls![0].id).toBe('call_xyz');
  });

  it('maps feedback-role messages to system (OpenAI protocol has no feedback role)', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'OK' } }],
    });

    const messages: Message[] = [
      {
        id: 'f1',
        role: 'feedback',
        content: '[feedback] tsc: type error at add.ts:1',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    ];

    const provider = new DeepSeekProvider(defaultConfig);
    await provider.complete(messages, []);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages).toEqual([
      { role: 'system', content: '[feedback] tsc: type error at add.ts:1' },
    ]);
  });

  it('keeps tool responses contiguous after an assistant tool_calls message (feedback system messages move after the pairs)', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'OK' } }],
    });

    // Round order as produced by the main loop: assistant declares 2 calls,
    // action 1 executes (tool), its feedback lands (→ system), action 2
    // executes (tool). DeepSeek 400s when a non-tool message sits between an
    // assistant's tool_calls and its tool responses.
    const messages: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        metadata: {
          toolInput: {
            toolCalls: [
              { id: 'call_1', name: 'run_shell', arguments: { command: 'pwd' } },
              { id: 'call_2', name: 'list_directory', arguments: { path: '.' } },
            ],
          },
        },
        timestamp: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 't1',
        role: 'tool',
        content: 'ok',
        metadata: { toolCallId: 'call_1' },
        timestamp: '2026-01-01T00:00:01.000Z',
      },
      {
        id: 'f1',
        role: 'feedback',
        content: 'tsc: no errors',
        timestamp: '2026-01-01T00:00:02.000Z',
      },
      {
        id: 't2',
        role: 'tool',
        content: 'entries',
        metadata: { toolCallId: 'call_2' },
        timestamp: '2026-01-01T00:00:03.000Z',
      },
    ];

    const provider = new DeepSeekProvider(defaultConfig);
    await provider.complete(messages, []);

    const callArgs = mockCreate.mock.calls[0][0];
    const roles = callArgs.messages.map((m: { role: string }) => m.role);
    expect(roles).toEqual(['assistant', 'tool', 'tool', 'system']);
    // The system (feedback) message must come after both tool responses.
    expect(callArgs.messages[1].tool_call_id).toBe('call_1');
    expect(callArgs.messages[2].tool_call_id).toBe('call_2');
    expect(callArgs.messages[3]).toEqual({ role: 'system', content: 'tsc: no errors' });
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

  it('enriches HTTP failures with the endpoint URL, status and a compatibility hint', async () => {
    // Real-test: a bare "404 openai_error" tells nobody WHY. HTTP errors
    // (numeric status) must surface the target URL and a hint.
    const httpError = Object.assign(new Error('404 openai_error'), {
      status: 404,
      error: { message: 'not found' },
    });
    mockCreate.mockRejectedValue(httpError);

    const provider = new DeepSeekProvider({
      ...defaultConfig,
      baseUrl: 'https://njusehub.info/v1',
    });
    const promise = provider.complete(dummyMessages, []);
    await expect(promise).rejects.toThrow(/njusehub\.info\/v1\/chat\/completions/);
    await expect(promise).rejects.toThrow(/HTTP 404/);
    await expect(promise).rejects.toThrow(/OpenAI 兼容端点/);
    // The response body fragment is included for diagnosis.
    await expect(promise).rejects.toThrow(/not found/);
  });

  it('passes through non-HTTP errors unchanged', async () => {
    const networkError = new TypeError('fetch failed');
    mockCreate.mockRejectedValue(networkError);

    const provider = new DeepSeekProvider(defaultConfig);
    await expect(provider.complete(dummyMessages, [])).rejects.toThrow('fetch failed');
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
      id: 'call_1',
      name: 'read_file',
      arguments: { filePath: '/src/a.ts' },
    });
    expect(result.toolCalls![1]).toEqual({
      id: 'call_2',
      name: 'write_file',
      arguments: { filePath: '/src/b.ts', content: '// code' },
    });
  });

  it('surfaces billing usage including the cached-prompt count (KNOWN_ISSUES 9)', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok', tool_calls: [] } }],
      usage: { prompt_tokens: 1200, completion_tokens: 340, prompt_cache_hit_tokens: 900 },
    });
    const provider = new DeepSeekProvider(defaultConfig);
    const result = await provider.complete(dummyMessages, []);
    expect(result.usage).toEqual({ prompt: 1200, completion: 340, cached: 900 });
  });

  it('omits usage when the API response carries none (KNOWN_ISSUES 9)', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok', tool_calls: [] } }],
      // No usage object at all — some OpenAI-compatible endpoints omit it.
    });
    const provider = new DeepSeekProvider(defaultConfig);
    const result = await provider.complete(dummyMessages, []);
    expect(result.usage).toBeUndefined();
  });
});
