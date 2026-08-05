export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system' | 'feedback';
  content: string;
  metadata?: {
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolResult?: ToolResult;
    /** OpenAI tool_call id — present on `tool` role result messages. */
    toolCallId?: string;
    /** Guardrail rule + command on a blocked system message — lets the WebUI
     *  rebuild the pending approval card from the REST snapshot. */
    guardrailRule?: string;
    guardrailCommand?: string;
    feedbackResult?: FeedbackResult;
    approvalRequired?: boolean;
    important?: boolean;
    compressed?: boolean;
  };
  timestamp: string;
}

export interface Session {
  id: string;
  task: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  maxRounds: number;
  currentRound: number;
  /** Session workspace root — tool cwd / scope-fence base / validator cwd (Task 19). */
  workspaceRoot: string;
  /**
   * Session-level model override (Task 26). When set, the provider built for
   * this session uses it instead of config.llm.model; `undefined` = follow
   * the config default. Switchable mid-conversation via PATCH
   * /api/sessions/:id/model (running sessions abort + restart on the new
   * model).
   */
  model?: string;
  messages: Message[];
  tokenCount: number;
  /**
   * Actual API token usage accumulated across rounds (KNOWN_ISSUES 9 Token
   * 明细). `undefined` until a provider reports usage (MockProvider fixtures
   * may omit it). Distinct from `tokenCount` — that is the memory layer's
   * estimated context size; this is what the LLM API billed.
   */
  tokenUsage?: TokenUsage;
  createdAt: string;
  updatedAt: string;
}

export interface Action {
  tool: string;
  params: Record<string, unknown>;
  /** OpenAI tool_call id — links the tool result message back to the call. */
  id?: string;
}

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  duration_ms: number;
  filesChanged?: string[];
  exitCode?: number | null;
}

export interface FeedbackResult {
  passed: boolean;
  validator: string;
  failureCategory?: 'syntax' | 'type' | 'logic' | 'command' | 'timeout' | 'parse_error';
  strategy?: 'auto_fix' | 'targeted_fix' | 'logic_fix' | 'command_fix' | 'split_task' | 'format_retry';
  evidence: string;
  details?: { file?: string; line?: number; expected?: string; actual?: string; rule?: string; }[];
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

export interface ToolContext { workspaceRoot: string; }

export interface LLMProvider {
  complete(messages: Message[], tools: Tool[]): Promise<LLMResponse>;
}

/** Actual token billing from one LLM call (KNOWN_ISSUES 9 Token 明细). */
export interface TokenUsage {
  /** Input (prompt) tokens. */
  prompt: number;
  /** Output (completion) tokens. */
  completion: number;
  /** Prompt tokens served from the provider's prompt cache, if reported. */
  cached?: number;
}

export interface LLMResponse {
  content: string | null;
  toolCalls?: { id?: string; name: string; arguments: Record<string, unknown> }[];
  /** Billing usage reported by the provider for this call; may be absent. */
  usage?: TokenUsage;
}

export interface Validator {
  name: string;
  validate(action: Action, result: ToolResult, context: ValidatorContext): Promise<FeedbackResult>;
}

export interface ValidatorContext { workspaceRoot: string; }

export type ActionType = 'file_write' | 'file_read' | 'test_run' | 'typecheck_run' | 'shell_command' | 'parse_error';

export type FailureClassification = 'syntax' | 'type' | 'logic' | 'command' | 'timeout' | 'parse_error';

export type Strategy = 'auto_fix' | 'targeted_fix' | 'logic_fix' | 'command_fix' | 'split_task' | 'format_retry';

export interface Config {
  llm: {
    provider: string;
    baseUrl: string;
    model: string;
    maxTokens: number;
    apiKeySource: 'keytar' | 'encrypted_file' | 'env';
    apiKeyService: string;
    /**
     * Pre-supplied encrypted-file master password (Docker/headless
     * deployments, SPEC §8.5): when keytar is unavailable and no interactive
     * prompt is possible, this activates the encrypted-file backend without
     * prompting. Falls back to interactive input when unset.
     */
    masterPassword?: string;
    /**
     * Task 26 follow-up: provider registry — per-provider connection
     * metadata. `llm.provider`/`llm.baseUrl`/`llm.model` are the ACTIVE
     * provider's values; this map keeps every registered provider's
     * endpoint so the Settings "应用" action can switch cleanly. Keys
     * (secrets) live in the CredentialStore, never here.
     */
    providers?: Record<string, { baseUrl: string; defaultModel?: string }>;
  };
  agent: {
    maxRounds: number;
    contextThreshold: number;
    workspaceRoot: string;
  };
  feedback: {
    validatorMode: 'fail_fast' | 'collect_all';
    validators: {
      eslint: { enabled: boolean };
      tsc: { enabled: boolean };
      testRunner: { enabled: boolean };
      shellCheck: { enabled: boolean };
    };
  };
  guardrail: {
    allowlist: string[];
    blocklist: string[];
    warnlist: string[];
    downgrade: Record<string, 'allow'>;
  };
  /**
   * WebUI-editable guardrail switches (PLAN Task 25, edited in Settings →
   * 模型与护栏). Optional — when absent the guardrail pipeline runs purely
   * on PatternGuard/ScopeFence/HITL rules. When present it is an ADDITIVE
   * overlay (main-loop runGuardrails): `blockOutbound` flags network-outbound
   * shell commands (curl/wget/ssh/scp/git push …) for a human decision, and
   * each `requireApproval` rule is matched as a case-sensitive substring of a
   * shell command. Matched commands pause for approval even when PatternGuard
   * allows or has previously approved them.
   */
  guardrails?: {
    requireApproval?: string[];
    blockOutbound?: boolean;
  };
  shell: {
    timeoutSeconds: number;
  };
  memory: {
    projectPath: string;
    userPath: string;
  };
  webui: {
    port: number;
    token?: string;
  };
}

/**
 * CredentialBackend — SPI for credential storage backends.
 * Backend priority chain (SPEC §3.7): keytar → encrypted file → env.
 * `isAvailable` is async because keytar must be loaded dynamically to detect
 * native-binding failures (Task 14 CR).
 */
export interface CredentialBackend {
  readonly name: string;
  /** Asynchronous probe: can this backend be used right now? */
  isAvailable(): Promise<boolean>;
  save(service: string, account: string, secret: string): Promise<void>;
  read(service: string, account: string): Promise<string | null>;
  delete(service: string, account: string): Promise<boolean>;
  exists(service: string, account: string): Promise<boolean>;
  /**
   * Enumerate the account names configured under a service (Task 25: WebUI
   * GET /api/keys lists providers from the credential store). Backends that
   * cannot enumerate (env: no account namespace) return an empty array.
   */
  list(service: string): Promise<string[]>;
}
