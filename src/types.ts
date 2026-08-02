export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system' | 'feedback';
  content: string;
  metadata?: {
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolResult?: ToolResult;
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
  messages: Message[];
  tokenCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Action {
  tool: string;
  params: Record<string, unknown>;
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

export interface LLMResponse {
  content: string | null;
  toolCalls?: { name: string; arguments: Record<string, unknown> }[];
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
}
