import * as crypto from 'node:crypto';
import * as path from 'node:path';
import type {
  Action,
  Config,
  FeedbackResult,
  LLMProvider,
  LLMResponse,
  Message,
  Session,
  Tool,
  ToolContext,
  ToolResult,
  Validator,
} from '../types.js';
import type { ToolRegistry } from '../tools/tool.js';
import type { PatternGuard } from '../guardrail/pattern-guard.js';
import type { ScopeFence } from '../guardrail/scope-fence.js';
import type { HITLManager } from '../guardrail/hitl-manager.js';
import type { ActionClassifier } from '../feedback/action-classifier.js';
import type { ValidatorSelector } from '../feedback/validator-selector.js';
import type { FailureClassifier } from '../feedback/failure-classifier.js';
import type { StrategyMatcher } from '../feedback/strategy-matcher.js';
import { RoundManager } from '../feedback/round-manager.js';
import { ValidatorChain } from '../feedback/validator-chain.js';
import type { SessionMemory } from '../memory/session-memory.js';
import type { HarnessEvents } from '../events.js';
import { shouldTerminate } from './termination.js';
import { platformGuidance } from '../utils/platform-guidance.js';

function generateId(): string {
  return crypto.randomUUID();
}

function nowISO(): string {
  return new Date().toISOString();
}

/** First path-like parameter of a file-action (path | paths[0] | filePath). */
function extractActionPath(action: Action): string | null {
  if (typeof action.params.path === 'string') {
    return action.params.path;
  }
  if (typeof action.params.filePath === 'string') {
    return action.params.filePath;
  }
  if (Array.isArray(action.params.paths) && action.params.paths.length > 0) {
    return String(action.params.paths[0]);
  }
  return null;
}

/** Credential-bearing paths — reads/writes always require a human decision. */
function isSensitivePath(p: string): boolean {
  const lower = p.toLowerCase();
  return (
    /(^|[\\/])\.env([\\/]|$)/.test(lower) ||
    /(^|[\\/])\.ssh([\\/]|$)/.test(lower) ||
    /(^|[\\/])secrets([\\/]|$)/.test(lower) ||
    /\.codeharness([\\/]|$)/.test(lower) ||
    /\.cred$/.test(lower) ||
    /id_rsa|id_ed25519|\.pem$/.test(lower) ||
    /\.npmrc|\.pypirc/.test(lower)
  );
}

/**
 * Detect a shell command that READS a file outside the workspace (e.g.
 * `cat C:\path`, `type hosts`, `Get-Content /etc/x`). Returns the offending
 * target for the approval prompt, or null when the command looks contained.
 */
function shellReadsOutside(command: string, workspaceRoot: string): string | null {
  const readPatterns = [
    /\b(cat|type|Get-Content|head|tail|less|more|od)\s+["']?([^"'\s|;&]+)/,
    /\b(cat|Get-Content|type)\s+<["']?([^"'\s|;&]+)/,
  ];
  for (const pattern of readPatterns) {
    const m = command.match(pattern);
    if (!m) {
      continue;
    }
    const candidate = m[m.length - 1];
    if (!candidate || candidate.startsWith('-')) {
      continue;
    }
    const abs = path.isAbsolute(candidate)
      ? path.normalize(candidate)
      : path.resolve(workspaceRoot, candidate);
    if (!abs.startsWith(path.resolve(workspaceRoot) + path.sep) && abs !== path.resolve(workspaceRoot)) {
      return abs;
    }
  }
  return null;
}

/**
 * Detect a shell command that writes/deletes outside the workspace (e.g.
 * `echo x > C:\path`, `rm C:\path`, `mv /etc/x /tmp`). Returns the offending
 * target for the approval prompt, or null when the command looks contained.
 * Heuristic, not a sandbox — advanced obfuscation can still slip through
 * (documented limitation); the human-in-the-loop model is the real control.
 */
function shellWritesOutside(command: string, workspaceRoot: string): string | null {
  const writePatterns = [
    // Redirection target — but NOT `2>` (stderr redirect, e.g. `ls 2>/dev/null`).
    /(^|[^0-9])(>|>>)\s*["']?([^"'\s|;&]+)/,
    /\b(rm|del|unlink)\s+(-[a-z]+\s+)?["']?([^"'\s|;&]+)/,
    /\b(mv|move|ren|rename)\s+["']?([^"'\s|;&]+)\s+["']?([^"'\s|;&]+)/,
    /\b(mkdir|touch)\s+["']?([^"'\s|;&]+)/,
  ];
  for (const pattern of writePatterns) {
    const m = command.match(pattern);
    if (!m) {
      continue;
    }
    const candidate = m[m.length - 1];
    if (!candidate || candidate.startsWith('-')) {
      continue;
    }
    const abs = path.isAbsolute(candidate)
      ? path.normalize(candidate)
      : path.resolve(workspaceRoot, candidate);
    if (!abs.startsWith(path.resolve(workspaceRoot) + path.sep) && abs !== path.resolve(workspaceRoot)) {
      return abs;
    }
  }
  return null;
}

/**
 * Network-outbound shell commands matched by config.guardrails.blockOutbound
 * (Task 25). Reuses the idea behind PatternGuard's `outbound_network` /
 * `remote_access` warn rules (curl/wget/ssh/scp) and extends it to common
 * outbound tools PatternGuard does NOT warn on (git remote ops, rsync, …) —
 * the config switch must be meaningful ON TOP of PatternGuard, not a
 * duplicate of it.
 */
const NETWORK_OUTBOUND_RE = /\b(?:curl|wget|ssh|scp|rsync|telnet|ftp|ping|git\s+(?:fetch|pull|push|clone))\s+/;

interface GuardSet {
  patternGuard: PatternGuard;
  scopeFence: ScopeFence;
  hitl: HITLManager;
}

interface FeedbackSet {
  classifier: ActionClassifier;
  selector: ValidatorSelector;
  failureClassifier: FailureClassifier;
  strategyMatcher: StrategyMatcher;
  roundManager: RoundManager;
}

/**
 * Task 19 run options: per-session workspace root binding. The loop builds
 * every execution context (tool cwd, scope-fence base, validator cwd) from
 * the SESSION's workspaceRoot, falling back to the global config value.
 */
export interface AgentRunOptions {
  /**
   * Attach to an existing session (WebUI-created via POST /api/sessions).
   * The loop mutates this exact object — the SessionStore sees every status
   * change and message. The session's own workspaceRoot/maxRounds win.
   */
  session?: Session;
  /** Session workspace root; defaults to config.agent.workspaceRoot. */
  workspaceRoot?: string;
  /** Round cap; 0 = unlimited; defaults to config.agent.maxRounds. */
  maxRounds?: number;
  /**
   * Task 19 (I2): the WebUI pause/stop endpoints abort a live run between
   * rounds. The REST endpoint already set the final status — the loop stops
   * without overriding it. Cancellation is per-round: an in-flight LLM/tool
   * call completes before the check takes effect.
   */
  signal?: AbortSignal;
}

export class AgentLoop {
  private llm: LLMProvider;
  private tools: ToolRegistry;
  private guard: GuardSet;
  private feedback: FeedbackSet;
  private validatorMap: Map<string, Validator>;
  private memory: SessionMemory;
  private events: HarnessEvents;
  private config: Config;

  constructor(
    llm: LLMProvider,
    tools: ToolRegistry,
    guard: GuardSet,
    feedback: FeedbackSet,
    validatorMap: Map<string, Validator>,
    memory: SessionMemory,
    events: HarnessEvents,
    config: Config,
  ) {
    this.llm = llm;
    this.tools = tools;
    this.guard = guard;
    this.feedback = feedback;
    this.validatorMap = validatorMap;
    this.memory = memory;
    this.events = events;
    this.config = config;
  }

  async run(task: string, options: AgentRunOptions = {}): Promise<Session> {
    // Session-level binding: attached session > explicit option > global config.
    const workspaceRoot =
      options.session?.workspaceRoot ??
      options.workspaceRoot ??
      this.config.agent.workspaceRoot;
    const maxRounds =
      options.session?.maxRounds ?? options.maxRounds ?? this.config.agent.maxRounds;
    // Fresh RoundManager per run: sessions on a shared loop must not leak
    // round state; a resumed (paused) session keeps its current round.
    const roundManager = new RoundManager(
      maxRounds,
      options.session ? options.session.currentRound : undefined,
    );

    const session: Session = options.session ?? {
      id: generateId(),
      task,
      status: 'running',
      maxRounds,
      workspaceRoot,
      currentRound: roundManager.currentRound,
      messages: [],
      tokenCount: 0,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };

    if (options.session) {
      // WebUI-created session: the store already appended the initial user
      // message — seed the LLM memory from it instead of re-adding.
      for (const message of session.messages) {
        this.memory.addMessage(message);
      }
    } else {
      // Add initial user message
      this.addMessage(session, {
        id: generateId(),
        role: 'user',
        content: task,
        timestamp: nowISO(),
      });
    }

    // Human-in-the-loop semantics — tell the LLM what to expect so it does
    // not re-request approval for operations the harness already executed.
    this.memory.addMessage({
      id: generateId(),
      role: 'system',
      content:
        '部分操作（工作区外读写与高危命令）会先收到 "Operation paused for human approval" 消息' +
        '等待人工确认。人工批准后，该工具会正常执行并返回结果（工具消息）。' +
        '看到该工具的执行结果即表示操作已完成——不要重复执行相同命令、不要说操作被拦截或等待批准，直接继续你的任务。',
      timestamp: nowISO(),
    });

    // Platform guidance (KNOWN_ISSUES 5): Windows agents must know which Unix
    // tools are missing and what to use instead — otherwise `xxd`-style
    // commands fail on first try and burn a round. POSIX platforms get none.
    // Idempotency guard (reviewer): resume/restart re-enters run() with an
    // existing session — without the check the guidance accumulates once per
    // run in session.messages AND memory (resumed loops re-seed session
    // messages, so each guidance would be seen twice).
    const guidance = platformGuidance(process.platform);
    if (
      guidance &&
      !session.messages.some((m) => m.role === 'system' && m.content === guidance)
    ) {
      this.addMessage(session, {
        id: generateId(),
        role: 'system',
        content: guidance,
        timestamp: nowISO(),
      });
    }

    this.events.emit('session:status', { sessionId: session.id, status: 'running' });

    outer: while (true) {
      // I2: pause/stop from the WebUI abort a live run; the endpoint already
      // set the final status (paused/completed), so break without touching it.
      if (options.signal?.aborted) {
        break;
      }

      // Keep session round tracking in sync
      session.currentRound = roundManager.currentRound;

      // Check upgrade before starting this round
      if (roundManager.shouldUpgrade()) {
        this.triggerHITL(session, 'Max rounds exceeded without resolution', roundManager);
        break;
      }

      // Step 1: Build context
      const messages = this.memory.getMessages();
      const toolList = this.tools.list();

      // Step 2: Call LLM
      let response: LLMResponse;
      try {
        response = await this.llm.complete(messages, toolList);
        // I2-fix: an abort can land DURING the LLM call — the loop only
        // checked at the round boundary above. Without this check a
        // single-round task would complete anyway (session → completed),
        // which suppresses the harness's restart-in-finally for message
        // injection / model switch / provider switch. The endpoint already
        // owns the final status for pause/stop, so a bare break is safe.
        if (options.signal?.aborted) {
          break;
        }
      } catch (llmError: unknown) {
        const msg = llmError instanceof Error ? llmError.message : String(llmError);
        session.status = 'failed';
        const errMsg: Message = {
          id: generateId(),
          role: 'system',
          content: `LLM call failed: ${msg}`,
          timestamp: nowISO(),
        };
        this.addMessage(session, errMsg);
        this.events.emit('session:status', { sessionId: session.id, status: 'failed' });
        break;
      }

      // Add assistant message
      const assistantContent = response.content ?? '';
      const assistantMsg: Message = {
        id: generateId(),
        role: 'assistant',
        content: assistantContent,
        metadata: response.toolCalls ? { toolInput: { toolCalls: response.toolCalls } } : undefined,
        timestamp: nowISO(),
      };
      this.addMessage(session, assistantMsg);

      // Step 3: Parse LLM output into Actions
      const parseResult = this.parseActions(response);

      if (parseResult.parseError) {
        // Create parse_error feedback
        const fb: FeedbackResult = {
          passed: false,
          validator: 'formatChecker',
          failureCategory: 'parse_error',
          strategy: 'format_retry',
          evidence: parseResult.errorEvidence ?? 'Failed to parse LLM output',
        };
        this.addFeedbackMessage(session, fb);

        roundManager.nextRound();
        this.events.emit('round:changed', {
          currentRound: roundManager.currentRound,
          maxRounds: session.maxRounds,
        });

        // Check upgrade after increment
        if (roundManager.shouldUpgrade()) {
          this.triggerHITL(session, 'Max rounds exceeded after parse errors', roundManager);
          break;
        }
        continue;
      }

      const actions = parseResult.actions;

      // No actions → check termination
      if (actions.length === 0) {
        if (shouldTerminate(response, roundManager.currentRound, session.maxRounds)) {
          session.status = 'completed';
          this.events.emit('session:status', { sessionId: session.id, status: 'completed' });
          break;
        }
        // No actions but not terminating → next round
        roundManager.nextRound();
        this.events.emit('round:changed', {
          currentRound: roundManager.currentRound,
          maxRounds: session.maxRounds,
        });

        if (roundManager.shouldUpgrade()) {
          this.triggerHITL(session, 'Max rounds exceeded', roundManager);
          break;
        }
        continue;
      }

      // Step 4-6: For each action — guardrail → execute → feedback
      let allFeedbackPassed = true;
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        // Step 4: Guardrail checks
        const guardResult = this.runGuardrails(action, session);
        if (guardResult.blocked) {
          // Paused by guardrail. The command/rule ride on the message so a
          // WebUI refresh can rebuild the pending approval card from the REST
          // snapshot (approval state is not persisted separately). Wording
          // matters: "blocked" reads as a permanent denial to LLMs — this
          // operation is PAUSED for a human decision, and after approval the
          // harness executes it (result arrives as a follow-up message).
          const guardMsg: Message = {
            id: generateId(),
            role: 'system',
            content: `Operation paused for human approval: ${guardResult.reason}`,
            metadata: {
              approvalRequired: guardResult.needsApproval,
              guardrailRule: guardResult.reason ?? undefined,
              guardrailCommand:
                action.tool === 'run_shell' && typeof action.params.command === 'string'
                  ? action.params.command
                  : undefined,
            },
            timestamp: nowISO(),
          };
          this.addMessage(session, guardMsg);
          // OpenAI protocol: every assistant tool_call needs a paired tool
          // response — a blocked action must still answer its tool_call_id,
          // or the next LLM call 400s (insufficient tool messages).
          this.addToolMessage(
            session,
            action.tool,
            action.params,
            {
              success: false,
              error: `Operation paused for human approval: ${guardResult.reason}`,
              duration_ms: 0,
            },
            action.id,
          );
          allFeedbackPassed = false;

          // The LLM declared every call in this round — skipped actions still
          // need a paired tool response (OpenAI protocol), so pair them before
          // stopping further execution.
          for (const skipped of actions.slice(i + 1)) {
            this.addToolMessage(
              session,
              skipped.tool,
              skipped.params,
              {
                success: false,
                error: 'Skipped: guardrail blocked an earlier action in this round',
                duration_ms: 0,
              },
              skipped.id,
            );
          }

          if (guardResult.needsApproval) {
            session.status = 'paused';
            this.events.emit('session:status', { sessionId: session.id, status: 'paused' });
            break outer; // HITL paused — stop the loop; resume handled by CLI/WebUI
          }
          break; // Stop processing further actions
        }

        // Step 5: Execute tool
        const toolResult = await this.executeTool(action, session.workspaceRoot);
        this.addToolMessage(session, action.tool, action.params, toolResult, action.id);

        // Step 6: Feedback loop
        const feedbackPassed = await this.runFeedback(action, toolResult, session);
        if (!feedbackPassed) {
          allFeedbackPassed = false;
        }
      }

      // Final protocol backstop: every tool_call_id this round declared must
      // have a paired tool response, no matter what interrupted execution.
      // DeepSeek 400s on the next call if any pair is missing.
      const declared = response.toolCalls ?? [];
      for (const call of declared) {
        if (!call.id) {
          continue;
        }
        const paired = session.messages.some(
          (m) => m.role === 'tool' && m.metadata?.toolCallId === call.id,
        );
        if (!paired) {
          this.addToolMessage(
            session,
            call.name,
            call.arguments,
            {
              success: false,
              error: 'Skipped: the loop did not execute this tool call',
              duration_ms: 0,
            },
            call.id,
          );
        }
      }

      // If guardrail blocked or feedback failed — check upgrade & continue
      if (!allFeedbackPassed) {
        // Re-check upgrade in case feedback failure pushed us over limit
        if (roundManager.shouldUpgrade()) {
          this.triggerHITL(session, 'Max rounds exceeded after feedback failures', roundManager);
          break;
        }
      }

      // Step 8: Termination check (only if feedback passed)
      if (allFeedbackPassed) {
        if (shouldTerminate(response, roundManager.currentRound, session.maxRounds)) {
          session.status = 'completed';
          this.events.emit('session:status', { sessionId: session.id, status: 'completed' });
          break;
        }
      }

      // Advance to next round
      roundManager.nextRound();
      this.events.emit('round:changed', {
        currentRound: roundManager.currentRound,
        maxRounds: session.maxRounds,
      });

      // Check upgrade after incrementing
      if (roundManager.shouldUpgrade()) {
        this.triggerHITL(session, 'Max rounds exceeded', roundManager);
        break;
      }
    }

    session.updatedAt = nowISO();
    session.tokenCount = this.memory.getTokenCount();
    return session;
  }

  /**
   * Parse an LLMResponse into actionable Actions.
   *
   * - Structured `toolCalls` from the response are used directly.
   * - For `content`-only responses: attempt JSON.parse to extract tool calls.
   *   - If parse fails and content looks JSON-like → parse_error.
   *   - If parse fails and content is plain text → no actions (text completion).
   */
  private parseActions(response: LLMResponse): {
    actions: Action[];
    parseError: boolean;
    errorEvidence?: string;
  } {
    // Structured tool calls take priority
    if (response.toolCalls && response.toolCalls.length > 0) {
      const actions: Action[] = response.toolCalls.map((tc) => ({
        tool: tc.name,
        params: tc.arguments,
        id: tc.id,
      }));
      return { actions, parseError: false };
    }

    // No tool calls, try to parse content as JSON
    const content = (response.content ?? '').trim();
    if (content.length === 0) {
      return { actions: [], parseError: false };
    }

    // Try JSON.parse for inline tool call definitions
    try {
      const parsed = JSON.parse(content);

      // Single action object: { tool: "...", params: {...} }
      if (parsed && typeof parsed.tool === 'string') {
        return {
          actions: [{ tool: parsed.tool, params: parsed.params ?? {} }],
          parseError: false,
        };
      }

      // Array of actions
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0].tool === 'string') {
        return {
          actions: parsed.map((a: { tool: string; params?: Record<string, unknown> }) => ({
            tool: a.tool,
            params: a.params ?? {},
          })),
          parseError: false,
        };
      }

      // Parsed JSON but not a recognizable action format → treat as text completion
      return { actions: [], parseError: false };
    } catch {
      // JSON.parse failed — an "attempted tool call" only looks like JSON when
      // the content BEGINS with a brace/bracket (KNOWN_ISSUES 9.5): markdown
      // links `[文字](URL)` put '[' in the middle of plain text, which the old
      // "content.includes('{') || content.includes('[')" heuristic misjudged
      // as JSON → spurious parse_error feedback → the LLM rewrote the same
      // answer until it produced one without brackets. (`content` is already
      // trimmed above.)
      if (content.startsWith('{') || content.startsWith('[')) {
        return {
          actions: [],
          parseError: true,
          errorEvidence: `Failed to parse LLM output as JSON: ${content.substring(0, 200)}`,
        };
      }

      // Plain text — completion signal
      return { actions: [], parseError: false };
    }
  }

  /**
   * Run guardrails: PatternGuard for shell commands, ScopeFence for file operations.
   */
  private runGuardrails(
    action: Action,
    session: Session,
  ): { blocked: boolean; needsApproval: boolean; reason?: string } {
    try {
      return this.runGuardrailsInner(action, session);
    } catch (err: unknown) {
      // A crashing guardrail must fail closed — and it must not abort the
      // action loop (which would leave tool_calls unpaired → next LLM 400).
      const msg = err instanceof Error ? err.message : String(err);
      return { blocked: true, needsApproval: false, reason: `guardrail error: ${msg}` };
    }
  }

  private runGuardrailsInner(
    action: Action,
    session: Session,
  ): { blocked: boolean; needsApproval: boolean; reason?: string } {
    const isShell = action.tool === 'run_shell';
    const command =
      isShell && typeof action.params.command === 'string' ? action.params.command : '';

    // PatternGuard — only for run_shell commands
    if (isShell && command.length > 0) {
      const guardResult = this.guard.patternGuard.check(command);
      if (guardResult.level === 'block') {
        this.events.emit('guardrail:triggered', {
          rule: guardResult.rule ?? 'unknown',
          command,
          level: 'block',
        });
        return { blocked: true, needsApproval: false, reason: guardResult.rule ?? 'unknown' };
      }
      // Task 25 config guardrails overlay — an ADDITIVE layer ON TOP of
      // PatternGuard. BLOCK rules still win; the overlay runs before the WARN
      // path so blockOutbound/requireApproval can demand a fresh human
      // decision even for a command PatternGuard already approved.
      const configReason = this.matchConfigGuardrails(command);
      if (configReason !== null) {
        return this.requestApprovalFromConfig(action, configReason, command);
      }
      if (guardResult.level === 'warn') {
        // The LLM may re-issue an already-approved command (it does not always
        // realize the harness executed it) — pass it without a second prompt.
        if (this.guard.hitl.isApprovedCommand(command)) {
          return { blocked: false, needsApproval: false };
        }
        this.events.emit('guardrail:triggered', {
          rule: guardResult.rule ?? 'unknown',
          command,
          level: 'warn',
        });
        // Trigger HITL
        try {
          this.guard.hitl.requestApproval(command, {
            tool: action.tool,
            params: action.params,
            id: action.id,
          });
        } catch {
          // HITL already in another state — treat as blocked so the stale
          // pendingCommand is not silently overwritten
          return {
            blocked: true,
            needsApproval: false,
            reason: `HITL busy: ${guardResult.rule}`,
          };
        }
        return { blocked: true, needsApproval: true, reason: `HITL required: ${guardResult.rule}` };
      }
    }

    // Human-in-the-loop supervision model (user's decision, Claude Code style):
    // reads are open (except sensitive credential paths), writes outside the
    // workspace and destructive shell patterns require an explicit decision.
    const actionPath = extractActionPath(action);
    const resolvedPath = actionPath
      ? path.resolve(session.workspaceRoot, actionPath)
      : '';

    // Sensitive credential paths — reading or writing them always asks.
    if (actionPath && isSensitivePath(actionPath)) {
      return this.requestApprovalFor(
        action,
        `Sensitive path: ${actionPath}`,
        session,
        command,
      );
    }

    if (isShell && command.length > 0) {
      // Shell access outside the workspace — writes and reads of system paths
      // both need a human decision (user-in-the-loop supervision).
      const outside = shellWritesOutside(command, session.workspaceRoot);
      if (outside) {
        return this.requestApprovalFor(
          action,
          `Shell write outside workspace: ${outside}`,
          session,
          command,
        );
      }
      const outsideRead = shellReadsOutside(command, session.workspaceRoot);
      if (outsideRead) {
        return this.requestApprovalFor(
          action,
          `Shell read outside workspace: ${outsideRead}`,
          session,
          command,
        );
      }
    }

    const isWriteOp = action.tool === 'write_file' || action.tool === 'edit_file';
    const isReadOp = ['read_file', 'list_directory', 'search_content'].includes(action.tool);

    if (isWriteOp && resolvedPath && !this.guard.scopeFence.validatePath(resolvedPath, session.workspaceRoot)) {
      // Writing outside the workspace is authorized by the user per-operation.
      return this.requestApprovalFor(
        action,
        `Write outside workspace: ${actionPath}`,
        session,
        command,
      );
    }

    // Reads outside the workspace also require a decision (supervision model):
    // the user sees what the agent touches outside its project.
    if (isReadOp && resolvedPath && actionPath && !this.guard.scopeFence.validatePath(resolvedPath, session.workspaceRoot)) {
      return this.requestApprovalFor(
        action,
        `Read outside workspace: ${actionPath}`,
        session,
        command,
      );
    }

    return { blocked: false, needsApproval: false };
  }

  /**
   * Match a shell command against config.guardrails (Task 25). Returns the
   * approval reason, or null when the config does not flag the command.
   * Matching semantics (documented in src/types.ts Config.guardrails):
   * `blockOutbound` matches known network-outbound tools via
   * NETWORK_OUTBOUND_RE; each `requireApproval` rule is a case-sensitive
   * substring of the command.
   */
  private matchConfigGuardrails(command: string): string | null {
    const guardrails = this.config.guardrails;
    if (guardrails?.blockOutbound === true && NETWORK_OUTBOUND_RE.test(command)) {
      return 'Network outbound blocked by guardrails config (blockOutbound)';
    }
    if (Array.isArray(guardrails?.requireApproval)) {
      for (const rule of guardrails.requireApproval) {
        if (typeof rule === 'string' && rule.length > 0 && command.includes(rule)) {
          return `Command matches guardrail rule "${rule}" (requireApproval)`;
        }
      }
    }
    return null;
  }

  /**
   * Request approval for a config-guardrails hit. Unlike requestApprovalFor,
   * this deliberately SKIPS the session approval cache: the config switch
   * (blockOutbound/requireApproval) demands a fresh human decision per
   * matching command — stricter than PatternGuard warn, which passes an
   * already-approved command through.
   */
  private requestApprovalFromConfig(
    action: Action,
    reason: string,
    command: string,
  ): { blocked: boolean; needsApproval: boolean; reason: string } {
    this.events.emit('guardrail:triggered', { rule: reason, command, level: 'warn' });
    try {
      this.guard.hitl.requestApproval(command, {
        tool: action.tool,
        params: action.params,
        id: action.id,
      });
    } catch {
      // HITL already in another state — treat as blocked so the stale
      // pendingCommand is not silently overwritten.
      return { blocked: true, needsApproval: false, reason: `HITL busy: ${reason}` };
    }
    return { blocked: true, needsApproval: true, reason: `HITL required: ${reason}` };
  }

  /** Request approval for an operation, emitting the guardrail event. */
  private requestApprovalFor(
    action: Action,
    reason: string,
    session: Session,
    command: string,
  ): { blocked: boolean; needsApproval: boolean; reason: string } {
    // Already-approved command → execute directly (see warn branch above).
    if (command !== '' && this.guard.hitl.isApprovedCommand(command)) {
      return { blocked: false, needsApproval: false, reason: `approved: ${reason}` };
    }
    this.events.emit('guardrail:triggered', {
      rule: reason,
      command: command || action.tool,
      level: 'warn',
    });
    try {
      this.guard.hitl.requestApproval(
        command || `${action.tool}: ${reason}`,
        { tool: action.tool, params: action.params, id: action.id },
      );
    } catch {
      return { blocked: true, needsApproval: false, reason: `HITL busy: ${reason}` };
    }
    return { blocked: true, needsApproval: true, reason: `HITL required: ${reason}` };
  }

  /**
   * Execute a tool and return the result. The ToolContext workspaceRoot is
   * the SESSION's root (Task 19) — tools run their cwd there.
   */
  private async executeTool(action: Action, workspaceRoot: string): Promise<ToolResult> {
    const tool: Tool | undefined = this.tools.get(action.tool);
    const context: ToolContext = { workspaceRoot };

    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: ${action.tool}`,
        duration_ms: 0,
      };
    }

    const start = Date.now();
    try {
      const result = await tool.execute(action.params, context);
      this.events.emit('tool:executed', {
        toolName: action.tool,
        duration_ms: result.duration_ms,
        success: result.success,
      });
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const duration_ms = Date.now() - start;
      this.events.emit('tool:executed', {
        toolName: action.tool,
        duration_ms,
        success: false,
      });
      return { success: false, error: message, duration_ms };
    }
  }

  /**
   * Run the full feedback pipeline for an action and its result.
   * Returns true if all feedback passed, false otherwise.
   */
  private async runFeedback(
    action: Action,
    result: ToolResult,
    session: Session,
  ): Promise<boolean> {
    // Layer 1: ActionClassifier
    const actionType = this.feedback.classifier.classify(action);

    // Layer 2: ValidatorSelector
    const validatorNames = this.feedback.selector.select(actionType, this.config);

    // No validators needed → feedback passes automatically
    if (validatorNames.length === 0) {
      return true;
    }

    // Look up validator instances
    const validators: Validator[] = [];
    for (const name of validatorNames) {
      const v = this.validatorMap.get(name);
      if (v) {
        validators.push(v);
      }
    }

    if (validators.length === 0) {
      return true;
    }

    // Layer 3: ValidatorChain — validators run against the SESSION root (Task 19)
    let feedbackResults: FeedbackResult[];
    try {
      const chain = new ValidatorChain(validators, this.config.feedback.validatorMode);
      feedbackResults = await chain.run(action, result, {
        workspaceRoot: session.workspaceRoot,
      });
    } catch (err: unknown) {
      // SPEC §3.1 错误处理: 所有异常捕获并转化为结构化 FeedbackResult，不中断主循环
      const msg = err instanceof Error ? err.message : String(err);
      feedbackResults = [
        {
          passed: false,
          validator: 'loop',
          failureCategory: 'command',
          strategy: 'command_fix',
          evidence: `Validator chain crashed: ${msg}`,
        },
      ];
    }

    let allPassed = true;

    for (const fb of feedbackResults) {
      this.events.emit('feedback:completed', {
        passed: fb.passed,
        validator: fb.validator,
        failureCategory: fb.failureCategory,
      });

      if (!fb.passed) {
        allPassed = false;

        // Layer 4: FailureClassifier
        const failureCategory = this.feedback.failureClassifier.classify(fb);

        // Layer 5: StrategyMatcher
        const strategy = this.feedback.strategyMatcher.match(failureCategory);

        // Enrich the feedback result
        const enriched: FeedbackResult = {
          ...fb,
          failureCategory,
          strategy,
        };

        this.addFeedbackMessage(session, enriched);
      }
    }

    return allPassed;
  }

  /**
   * Trigger HITL upgrade: add an approval-required message and pause the session.
   */
  private triggerHITL(session: Session, reason: string, roundManager: RoundManager): void {
    session.currentRound = roundManager.currentRound;
    const hitlMsg: Message = {
      id: generateId(),
      role: 'system',
      content: `[HITL] ${reason} — human approval required.`,
      metadata: { approvalRequired: true, important: true },
      timestamp: nowISO(),
    };
    this.addMessage(session, hitlMsg);
    session.status = 'paused';
    this.events.emit('session:status', { sessionId: session.id, status: 'paused' });
  }

  /**
   * Add a message to both the session history and the memory.
   */
  private addMessage(session: Session, message: Message): void {
    session.messages.push(message);
    this.memory.addMessage(message);
    // Broadcast the FULL content — the WebUI message feed renders it live and
    // REST snapshots dedupe by id; truncating here (substring(0, 200)) made
    // long messages appear cut off until a refresh.
    this.events.emit('message:added', {
      id: message.id,
      role: message.role,
      content: message.content,
      metadata: message.metadata as Record<string, unknown> | undefined,
      timestamp: message.timestamp,
    });
  }

  /**
   * Add a tool result message to the session.
   */
  private addToolMessage(
    session: Session,
    toolName: string,
    params: Record<string, unknown>,
    result: ToolResult,
    toolCallId?: string,
  ): void {
    const toolMsg: Message = {
      id: generateId(),
      role: 'tool',
      content: result.success
        ? (result.output ?? 'Tool executed successfully')
        : (result.error ?? 'Tool execution failed'),
      metadata: {
        toolName,
        toolInput: params,
        toolResult: result,
        ...(toolCallId !== undefined ? { toolCallId } : {}),
      },
      timestamp: nowISO(),
    };
    this.addMessage(session, toolMsg);
  }

  /**
   * Add a feedback message to the session.
   */
  private addFeedbackMessage(session: Session, fb: FeedbackResult): void {
    const fbMsg: Message = {
      id: generateId(),
      role: 'feedback',
      content: fb.evidence,
      metadata: { feedbackResult: fb },
      timestamp: nowISO(),
    };
    this.addMessage(session, fbMsg);
  }
}
