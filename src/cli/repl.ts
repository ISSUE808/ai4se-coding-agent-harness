import * as crypto from 'node:crypto';
import * as readline from 'node:readline';
import type { Config, Message, Session } from '../types.js';
import { HITLManager } from '../guardrail/hitl-manager.js';
import type { HarnessEvents, HarnessEventMap } from '../events.js';
import { createEventBus } from '../events.js';
// Task 27: the REPL reuses the CLI run semantics (streaming, HITL approval,
// approved-action execution). The module cycle with commands/start.ts is safe
// — both sides only use the other's bindings inside function bodies, never at
// module top level.
import type { BuildAgentLoop } from './commands/start.js';
import {
  cliPromptApproval,
  executeApprovedActionImpl,
  formatMessageLine,
} from './commands/start.js';

/**
 * Task 27 REPL (SPEC §4.3, §5.1): `codeharness` with no arguments enters an
 * interactive readline loop. A task input runs the agent with streaming
 * output; later inputs are injected into the SAME session as new user
 * instructions (message injection — the next run re-seeds memory from the
 * session, so the instruction reaches the LLM with full context); slash
 * commands drive the session; HITL confirmation happens inside the REPL.
 * Ctrl+C during a run interrupts it (returns to the prompt); Ctrl+C at the
 * prompt exits (handled by the terminal readline — see createTerminalReplIO).
 */

export interface ReplIO {
  /** Read one line of input. `null` means EOF (or Ctrl+C at the prompt) → exit. */
  readLine(prompt: string): Promise<string | null>;
  print(line: string): void;
  /**
   * HITL decision prompt (default terminal implementation reads the SAME
   * input stream as readLine — a single reader never loses piped lines).
   * Falls back to deps.promptApproval / the CLI default when absent.
   */
  askYesNo?(question: string): Promise<boolean>;
  /** Release the input (production closes the shared readline on exit). */
  close?(): void;
}

export interface ReplDeps {
  config: Config;
  buildAgentLoop: BuildAgentLoop;
  io: ReplIO;
  /** Shared HITL manager — the loop's guardrail and the REPL approval prompt. */
  hitl?: HITLManager;
  events?: HarnessEvents;
  /** Interactive decision prompt (CLI default reads stdin; tests inject). */
  promptApproval?: (question: string) => Promise<boolean>;
  /**
   * Ctrl+C wiring for RUNNING instructions: registers the "interrupt the
   * in-flight run" handler. Production wires it to process SIGINT; tests call
   * it directly. At the prompt, Ctrl+C exits instead — the terminal readline
   * resolves null and the REPL loop exits.
   */
  onRunInterrupt?: (handler: () => void) => void;
  /** Called once when the REPL exits (/exit, EOF, prompt-level Ctrl+C). */
  onExit?: (code: number) => void;
}

export const REPL_HELP_TEXT = [
  '可用命令:',
  '  /exit          退出 REPL',
  '  /help          显示此帮助',
  '  /model <name>  切换当前会话模型（下一次运行生效；不带参数显示当前模型）',
  '  /clear         开始新会话（清空当前上下文）',
  '  /status        显示当前会话状态',
].join('\n');

interface SlashContext {
  config: Config;
  hitl: HITLManager;
  io: ReplIO;
  exit: (code: number) => void;
}

/**
 * Slash command dispatch (single active session). Returns the session after
 * the command (null after /clear — a fresh conversation).
 */
function handleSlashCommand(
  input: string,
  session: Session | null,
  ctx: SlashContext,
): Session | null {
  const [command, ...rest] = input.split(/\s+/);
  const arg = rest.join(' ').trim();
  switch (command) {
    case '/exit':
      ctx.exit(0);
      return session;
    case '/help':
      ctx.io.print(REPL_HELP_TEXT);
      return session;
    case '/status':
      if (session === null) {
        ctx.io.print('没有进行中的会话');
        return session;
      }
      ctx.io.print(
        `[session] ${session.id} status=${session.status} rounds=${session.currentRound}` +
          ` model=${session.model ?? ctx.config.llm.model}`,
      );
      return session;
    case '/model':
      if (session === null) {
        ctx.io.print('没有进行中的会话 — 先输入任务开始对话，再用 /model 切换模型');
        return session;
      }
      if (arg === '') {
        ctx.io.print(`当前模型: ${session.model ?? ctx.config.llm.model}`);
        return session;
      }
      // Task 26 session-level override — the next run rebuilds the provider
      // with the new model (buildAgentLoop receives the stored session).
      session.model = arg;
      ctx.io.print(`[session] model → ${arg}（下一次运行生效）`);
      return session;
    case '/clear':
      ctx.hitl.reset();
      ctx.io.print('[session] cleared — 开始新会话');
      return null;
    default:
      ctx.io.print(`未知命令: ${command} — 输入 /help 查看可用命令`);
      return session;
  }
}

/**
 * Run one instruction on the REPL conversation. The first instruction creates
 * a session; later instructions append a user message and resume the SAME
 * session (message injection — the loop re-seeds memory from the session, so
 * the new instruction reaches the LLM context with full history). Streaming
 * output, HITL approval and resume mirror the `start <task>` CLI flow.
 */
async function runInstruction(opts: {
  instruction: string;
  session: Session | null;
  config: Config;
  buildAgentLoop: BuildAgentLoop;
  hitl: HITLManager;
  events: HarnessEvents;
  ask: (question: string) => Promise<boolean>;
  signal: AbortSignal;
  print: (line: string) => void;
}): Promise<Session> {
  const { config, events, hitl } = opts;

  const onMessage = (data: HarnessEventMap['message:added']): void => {
    opts.print(formatMessageLine(data));
  };
  const onStatus = (data: HarnessEventMap['session:status']): void => {
    opts.print(`[session] ${data.status}`);
  };
  events.on('message:added', onMessage);
  events.on('session:status', onStatus);
  try {
    // C1 (WebUI): a fresh decision context per instruction — otherwise the
    // post-decision HITL state (EXECUTING/BLOCKED) silently swallows every
    // later warn as "HITL busy". The approved-command cache survives reset.
    hitl.reset();
    // Task 26: hand the stored session to the factory so the provider is
    // built with `session.model` when the session overrides the config.
    const loop = await opts.buildAgentLoop({
      config,
      events,
      hitl,
      session: opts.session ?? undefined,
    });

    let session = opts.session;
    if (session === null) {
      // First instruction: the loop creates the session and its user message.
      session = await loop.run(opts.instruction, { signal: opts.signal });
    } else {
      // New instruction injected into the conversation: append the user
      // message, then resume the SAME session (the loop re-seeds memory from
      // session.messages, so the message lands in the next LLM context).
      session.status = 'running';
      const message: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: opts.instruction,
        timestamp: new Date().toISOString(),
      };
      session.messages.push(message);
      events.emit('message:added', {
        id: message.id,
        role: message.role,
        content: message.content,
        metadata: message.metadata,
        timestamp: message.timestamp,
      });
      // A capped-out session would re-pause on upgrade at the top of the next
      // run — raise the cap on continuation (WebUI continueSession semantics).
      if (session.maxRounds > 0 && session.currentRound >= session.maxRounds) {
        session.maxRounds = session.currentRound + session.maxRounds;
      }
      session = await loop.run(session.task, { session, signal: opts.signal });
    }

    // Human-in-the-loop: same flow as the CLI start command — approve
    // executes the authorized operation directly, deny records the decision,
    // then the SAME stored session resumes. Ctrl+C wins over the prompt.
    while (session.status === 'paused' && hitl.getPendingCommand() !== null) {
      if (opts.signal.aborted) {
        break;
      }
      const pending = hitl.getPendingCommand() ?? 'unknown operation';
      const approved = await opts.ask(
        `[HITL] 需要人工确认 — 批准执行该操作？\n  ${pending}\n  (y=批准执行 / n=拒绝)`,
      );
      if (approved) {
        hitl.approve();
        const action = hitl.getApprovedAction();
        if (action) {
          await executeApprovedActionImpl(session, action, events);
        }
      } else {
        hitl.deny();
        const deniedMsg: Message = {
          id: crypto.randomUUID(),
          role: 'system',
          content: `[HITL] Command denied: ${pending}`,
          timestamp: new Date().toISOString(),
        };
        session.messages.push(deniedMsg);
        events.emit('message:added', {
          id: deniedMsg.id,
          role: deniedMsg.role,
          content: deniedMsg.content,
          metadata: deniedMsg.metadata,
          timestamp: deniedMsg.timestamp,
        });
      }
      session = await loop.run(session.task, { session, signal: opts.signal });
    }

    // Ctrl+C interrupt: the loop stops at its next round boundary without
    // touching the status — mark the session paused so the next instruction
    // resumes it as a conversation continuation.
    if (opts.signal.aborted && session.status === 'running') {
      session.status = 'paused';
    }
    opts.print(
      `[session] done: ${session.id} status=${session.status} rounds=${session.currentRound}`,
    );
    if (opts.signal.aborted) {
      opts.print('[session] interrupted (Ctrl+C) — 输入新指令继续对话');
    }
    return session;
  } finally {
    events.off('message:added', onMessage);
    events.off('session:status', onStatus);
  }
}

/**
 * REPL main loop (single active session): read a line at the prompt → run the
 * instruction (streaming) → back to the prompt. Never returns until /exit,
 * EOF or prompt-level Ctrl+C.
 */
export async function runRepl(deps: ReplDeps): Promise<void> {
  const { config, io } = deps;
  const hitl = deps.hitl ?? new HITLManager();
  const events = deps.events ?? createEventBus();
  // HITL decisions prefer the injected prompt; the terminal io's askYesNo
  // reads the SAME input stream (single reader — piped lines are never lost);
  // the CLI start default is the last fallback.
  const ask = deps.promptApproval ?? io.askYesNo ?? cliPromptApproval;
  let session: Session | null = null;
  let exited = false;
  let currentAbort: AbortController | null = null;

  const exit = (code: number): void => {
    if (exited) {
      return;
    }
    exited = true;
    io.close?.();
    deps.onExit?.(code);
  };

  // Ctrl+C during a run: abort it (the loop stops at its next round boundary)
  // and return to the prompt; the next instruction resumes the session.
  const interruptRun = (): void => {
    currentAbort?.abort();
  };
  deps.onRunInterrupt?.(interruptRun);

  io.print('CodeHarness REPL — 输入任务开始对话；运行中按 Ctrl+C 中断；/exit 退出');

  while (!exited) {
    const line = await io.readLine('codeharness> ');
    if (line === null) {
      exit(0);
      break;
    }
    const input = line.trim();
    if (input === '') {
      continue;
    }

    if (input.startsWith('/')) {
      session = handleSlashCommand(input, session, { config, hitl, io, exit });
      continue;
    }

    // A task (first run) or a new instruction injected into the conversation.
    const controller = new AbortController();
    currentAbort = controller;
    try {
      session = await runInstruction({
        instruction: input,
        session,
        config,
        buildAgentLoop: deps.buildAgentLoop,
        hitl,
        events,
        ask,
        signal: controller.signal,
        print: io.print,
      });
    } catch (err) {
      // Per-instruction error (e.g. missing API key, wiring failure): show
      // actionable advice (§4.3) and return to the prompt — the REPL keeps
      // running; the failed instruction is not injected into the session.
      const message = err instanceof Error ? err.message : String(err);
      io.print(`[session] error: ${message}`);
    } finally {
      currentAbort = null;
    }
  }
}

/**
 * Terminal I/O for the REPL: ONE persistent readline interface for the whole
 * session (prompt.ts lesson — a fresh interface per prompt buffers the whole
 * piped input and loses the lines of subsequent prompts). Lines stream into a
 * queue; each readLine/askYesNo takes the next one — on a TTY the user can
 * even type while the agent runs: those lines are queued and become the next
 * instructions (injected after the current run).
 *
 * Ctrl+C: at the prompt (a waiter is pending) → resolve null → the REPL exits
 * (documented Task 27 behavior). During a run (no waiter — the terminal is in
 * raw mode for the whole REPL, so the key arrives here, not as a process
 * SIGINT) → `interruptRun` aborts the run and the prompt returns.
 */
export function createTerminalReplIO(
  print: (line: string) => void = console.log,
  interruptRun?: () => void,
): ReplIO {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    crlfDelay: Infinity,
  });
  const queue: string[] = [];
  const waiters: Array<(line: string | null) => void> = [];
  let closed = false;

  rl.on('line', (line) => {
    const waiter = waiters.shift();
    if (waiter) {
      waiter(line);
    } else {
      queue.push(line);
    }
  });
  rl.on('close', () => {
    // EOF: no more input — every pending read resolves to null (the REPL
    // exits instead of hanging on a closed stream).
    closed = true;
    for (const waiter of waiters.splice(0)) waiter(null);
  });
  rl.on('SIGINT', () => {
    if (waiters.length > 0) {
      // At the prompt: exit the REPL.
      for (const waiter of waiters.splice(0)) waiter(null);
    } else {
      // During a run: interrupt it (Ctrl+C at the prompt again exits).
      interruptRun?.();
    }
  });

  const next = (): Promise<string | null> => {
    if (queue.length > 0) {
      return Promise.resolve(queue.shift() as string);
    }
    if (closed) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => waiters.push(resolve));
  };

  return {
    print,
    readLine(prompt: string): Promise<string | null> {
      rl.setPrompt(prompt);
      rl.prompt();
      return next();
    },
    askYesNo(question: string): Promise<boolean> {
      rl.setPrompt(`${question}\n> `);
      rl.prompt();
      return next().then((line) => line?.trim().toLowerCase() === 'y');
    },
    close(): void {
      if (!closed) {
        closed = true;
        rl.close();
      }
    },
  };
}
