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

interface OpenAIMessage {
  role: string;
  content: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

/**
 * DeepSeek (OpenAI protocol) requires tool responses to be contiguous after
 * the assistant message that declared them — an interleaved system message
 * (our feedback → system mapping) triggers 400 "insufficient tool messages
 * following tool_calls". Stable-partition each assistant tool-call block:
 * tool responses first (in order), then the interleaved non-tool messages.
 */
function stabilizeToolPairs(msgs: OpenAIMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  let i = 0;
  while (i < msgs.length) {
    const m = msgs[i];
    out.push(m);
    i++;
    if (m.role !== 'assistant' || !Array.isArray(m.tool_calls) || m.tool_calls.length === 0) {
      continue;
    }
    // Collect everything until the next assistant message.
    const block: OpenAIMessage[] = [];
    while (i < msgs.length && msgs[i].role !== 'assistant') {
      block.push(msgs[i]);
      i++;
    }
    const tools = block.filter((b) => b.role === 'tool');
    const rest = block.filter((b) => b.role !== 'tool');
    out.push(...tools, ...rest);
  }
  return out;
}
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
  private maxTokens: number;
  /**
   * The model this provider serves (Task 26): the config default or the
   * session-level override that constructed it. Read-only — switching models
   * mid-conversation builds a fresh provider.
   */
  readonly model: string;
  /** Endpoint this provider talks to — surfaced in enriched error messages. */
  readonly baseUrl: string;

  constructor(config: DeepSeekConfig) {
    this.client = new OpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
    });
    this.model = config.model;
    this.maxTokens = config.maxTokens;
    this.baseUrl = config.baseUrl;
  }

  async complete(messages: Message[], tools: Tool[]): Promise<LLMResponse> {
    // OpenAI tool-calling protocol: an assistant message that declared tool
    // calls must resend them (`tool_calls`), and every tool result message
    // must reference its call (`tool_call_id`) — DeepSeek rejects a missing
    // `tool_call_id` with 400.
    const openaiMessages = messages.map((m) => {
      if (m.role === 'assistant') {
        const calls = m.metadata?.toolInput?.toolCalls;
        if (Array.isArray(calls) && calls.length > 0) {
          return {
            role: 'assistant',
            content: m.content,
            tool_calls: calls.map((c) => ({
              id: c.id ?? 'call_unknown',
              type: 'function' as const,
              function: { name: c.name, arguments: JSON.stringify(c.arguments) },
            })),
          };
        }
        return { role: 'assistant', content: m.content };
      }
      if (m.role === 'tool') {
        return {
          role: 'tool',
          content: m.content,
          tool_call_id: m.metadata?.toolCallId ?? 'call_unknown',
        };
      }
      // The OpenAI protocol has no `feedback` role — feedback content must
      // reach the LLM (it drives the correction loop), so send it as system.
      const role = m.role === 'feedback' ? 'system' : m.role;
      return { role, content: m.content };
    }) as OpenAIMessage[];

    // Tool responses must be contiguous after their declaring assistant
    // message — feedback-as-system messages interleave otherwise.
    const stabilized = stabilizeToolPairs(openaiMessages);

    const openaiTools = tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: toOpenAIToolParameters(t.parameters),
      },
    }));

    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await this.client.chat.completions.create({
        model: this.model,
        messages: stabilized as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        max_tokens: this.maxTokens,
      });
    } catch (err) {
      // Real-test: a bare "404 openai_error" told nobody WHY. Enrich HTTP
      // failures (numeric status) with the target URL, status and response
      // body so wrong endpoints (missing /v1, non-OpenAI-compatible servers)
      // are diagnosable; non-HTTP errors (network) pass through unchanged.
      const status = (err as { status?: unknown })?.status;
      if (typeof status === 'number') {
        const body = (err as { error?: unknown })?.error;
        const detail =
          body !== undefined
            ? typeof body === 'string'
              ? body
              : JSON.stringify(body)
            : '';
        throw new Error(
          `LLM API 调用失败（${this.baseUrl}/chat/completions，HTTP ${status}）：` +
            `${err instanceof Error ? err.message : String(err)}` +
            (detail !== '' ? ` 响应：${detail.slice(0, 200)}` : '') +
            '——请检查 API 地址是否为 OpenAI 兼容端点（通常以 /v1 结尾）',
        );
      }
      throw err;
    }

    const choice = response.choices[0]?.message;

    let toolCalls: LLMResponse['toolCalls'];
    if (choice?.tool_calls && choice.tool_calls.length > 0) {
      toolCalls = choice.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      }));
    }

    // KNOWN_ISSUES 9 Token 明细: surface the provider's billing usage.
    // DeepSeek answers the OpenAI-compatible `usage` object; the cached-prompt
    // count is optional (DeepSeek reports `prompt_cache_hit_tokens`).
    const u = response.usage as {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_cache_hit_tokens?: number;
    } | undefined;
    const usage =
      u && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number'
        ? {
            prompt: u.prompt_tokens,
            completion: u.completion_tokens,
            ...(typeof u.prompt_cache_hit_tokens === 'number'
              ? { cached: u.prompt_cache_hit_tokens }
              : {}),
          }
        : undefined;

    return {
      content: choice?.content ?? null,
      toolCalls,
      ...(usage !== undefined ? { usage } : {}),
    };
  }
}
