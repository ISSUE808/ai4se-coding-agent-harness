import OpenAI from 'openai';
import type { LLMProvider, LLMResponse, Message, Tool } from '../types.js';

export interface DeepSeekConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
}

/**
 * Normalize a tool's `parameters` into a standard JSON Schema object for the
 * OpenAI-compatible API. Our tools declare parameters as a bare property table
 * (e.g. `{ paths: {...} }`) — DeepSeek rejects schemas without
 * `type: "object"` with 400. Already-standard schemas (carrying `type` or
 * `properties`) pass through unchanged.
 */
export function toOpenAIToolParameters(
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof parameters.type === 'string' || 'properties' in parameters) {
    return parameters;
  }
  return {
    type: 'object',
    properties: parameters,
    required: Object.keys(parameters),
  };
}

export class DeepSeekProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;
  private maxTokens: number;

  constructor(config: DeepSeekConfig) {
    this.client = new OpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
    });
    this.model = config.model;
    this.maxTokens = config.maxTokens;
  }

  async complete(messages: Message[], tools: Tool[]): Promise<LLMResponse> {
    const openaiMessages = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const openaiTools = tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: toOpenAIToolParameters(t.parameters),
      },
    }));

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      max_tokens: this.maxTokens,
    });

    const choice = response.choices[0]?.message;

    let toolCalls: LLMResponse['toolCalls'];
    if (choice?.tool_calls && choice.tool_calls.length > 0) {
      toolCalls = choice.tool_calls.map((tc) => ({
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      }));
    }

    return {
      content: choice?.content ?? null,
      toolCalls,
    };
  }
}
