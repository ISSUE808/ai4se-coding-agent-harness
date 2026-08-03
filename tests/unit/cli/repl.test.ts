import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { AgentLoop } from '../../../src/core/main-loop.js';
import { MockProvider } from '../../../src/llm/mock-provider.js';
import { ToolRegistry } from '../../../src/tools/tool.js';
import { readFileTool } from '../../../src/tools/read-file.js';
import { ActionClassifier } from '../../../src/feedback/action-classifier.js';
import { ValidatorSelector } from '../../../src/feedback/validator-selector.js';
import { FailureClassifier } from '../../../src/feedback/failure-classifier.js';
import { StrategyMatcher } from '../../../src/feedback/strategy-matcher.js';
import { RoundManager } from '../../../src/feedback/round-manager.js';
import { FormatValidator } from '../../../src/feedback/validators/format-validator.js';
import { EslintValidator } from '../../../src/feedback/validators/eslint-validator.js';
import { TscValidator } from '../../../src/feedback/validators/tsc-validator.js';
import { ShellCheckValidator } from '../../../src/feedback/validators/shell-check-validator.js';
import { PatternGuard } from '../../../src/guardrail/pattern-guard.js';
import { ScopeFence } from '../../../src/guardrail/scope-fence.js';
import { HITLManager } from '../../../src/guardrail/hitl-manager.js';
import { SessionMemory } from '../../../src/memory/session-memory.js';
import { DEFAULT_CONFIG } from '../../../src/config/schema.js';
import { CredentialNotFoundError } from '../../../src/credentials/store.js';
import type { Config, LLMProvider, LLMResponse, Validator } from '../../../src/types.js';
import type {
  BuildAgentLoop,
  BuildAgentLoopOptions,
} from '../../../src/cli/commands/start.js';
import { createTerminalReplIO, runRepl } from '../../../src/cli/repl.js';
import type { ReplIO } from '../../../src/cli/repl.js';
import { createProgram } from '../../../src/cli/index.js';
import { parseCaptured } from './helpers.js';

/**
 * Task 27 REPL (SPEC §4.3, §5.1): `codeharness` with no arguments enters an
 * interactive loop — a task input runs the agent with streaming output,
 * later inputs are injected into the SAME session as new user instructions
 * (context preserved), slash commands drive the session, and HITL
 * confirmation happens inside the REPL. All runs use MockProvider —
 * deterministic, zero network (SPEC §A.4-C).
 */

let workspaceRoot: string;

function makeConfig(root = workspaceRoot): Config {
  return {
    ...DEFAULT_CONFIG,
    agent: { ...DEFAULT_CONFIG.agent, workspaceRoot: root },
  };
}

/** Real AgentLoop wired with the given provider (mirrors the CLI harness). */
function buildTestLoop(provider: LLMProvider): BuildAgentLoop {
  return async ({ config, events, hitl }) => {
    const tools = new ToolRegistry();
    tools.register(readFileTool);
    const memory = new SessionMemory(config);
    const guard = {
      patternGuard: new PatternGuard(),
      scopeFence: new ScopeFence(),
      hitl: hitl ?? new HITLManager(),
    };
    const validatorMap = new Map<string, Validator>();
    validatorMap.set('eslint', new EslintValidator());
    validatorMap.set('tsc', new TscValidator());
    validatorMap.set('stderrChecker', new ShellCheckValidator());
    validatorMap.set('formatChecker', new FormatValidator());
    const feedback = {
      classifier: new ActionClassifier(),
      selector: new ValidatorSelector(),
      failureClassifier: new FailureClassifier(),
      strategyMatcher: new StrategyMatcher(),
      roundManager: new RoundManager(config.agent.maxRounds),
    };
    return new AgentLoop(provider, tools, guard, feedback, validatorMap, memory, events, config);
  };
}

/**
 * MockProvider wrapper that records every LLM context (the messages passed to
 * complete) — lets tests assert WHAT the agent saw, i.e. that injected
 * instructions arrive with the full conversation history.
 */
function capturingProvider(responses: LLMResponse[]) {
  const mock = new MockProvider(responses);
  const contexts: Array<Array<{ role: string; content: string }>> = [];
  const provider: LLMProvider = {
    complete: async (messages, tools) => {
      contexts.push(messages.map((m) => ({ role: m.role, content: m.content })));
      return mock.complete(messages, tools);
    },
  };
  return { provider, contexts };
}

/** Injectable REPL input: a fixed line queue. null = EOF → the REPL exits. */
function makeIo(lines: Array<string | null>): {
  io: ReplIO;
  printed: string[];
  asked: string[];
} {
  const printed: string[] = [];
  const asked: string[] = [];
  const queue = [...lines];
  return {
    io: {
      readLine: async () => queue.shift() ?? null,
      print: (line) => printed.push(line),
      askYesNo: async (question) => {
        asked.push(question);
        const line = queue.shift() ?? '';
        return line.trim().toLowerCase() === 'y';
      },
    },
    printed,
    asked,
  };
}

async function waitFor(fn: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

beforeAll(() => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-repl-'));
  fs.writeFileSync(path.join(workspaceRoot, 'test.ts'), 'const answer = 42;\n');
});

afterAll(() => {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

describe('runRepl', () => {
  const config = makeConfig();

  it('a task input runs the agent with streaming output, then returns to the prompt (EOF exits)', async () => {
    const { io, printed } = makeIo(['read test.ts', null]);
    const { provider } = capturingProvider([
      { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
      { content: 'Task complete.' },
    ]);
    const exitCodes: number[] = [];
    await runRepl({
      config,
      buildAgentLoop: buildTestLoop(provider),
      io,
      onExit: (code) => exitCodes.push(code),
    });
    const out = printed.join('\n');
    expect(out).toContain('[user] read test.ts');
    expect(out).toContain('Task complete.');
    expect(out).toContain('status=completed');
    expect(exitCodes).toEqual([0]);
  });

  it('a new instruction after completion is injected into the NEXT run with full context', async () => {
    const { io, printed } = makeIo(['first task', 'second instruction', null]);
    const { provider, contexts } = capturingProvider([
      { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
      { content: 'First done.' },
      { content: 'Second done.' },
    ]);
    await runRepl({ config, buildAgentLoop: buildTestLoop(provider), io });
    const out = printed.join('\n');
    expect(out).toContain('[user] first task');
    expect(out).toContain('First done.');
    expect(out).toContain('[user] second instruction');
    expect(out).toContain('Second done.');
    // Both runs completed (streaming order: run 1 done line before run 2).
    expect(out.match(/status=completed/g) ?? []).toHaveLength(2);
    // The injected instruction reached the LLM context WITH the full history —
    // the last complete() call saw both user messages (single session).
    const lastContext = contexts[contexts.length - 1];
    const userContents = lastContext.filter((m) => m.role === 'user').map((m) => m.content);
    expect(userContents).toEqual(expect.arrayContaining(['first task', 'second instruction']));
  });

  it('HITL confirmation happens inside the REPL (approve executes the operation and resumes)', async () => {
    const { io, printed } = makeIo(['push', null]);
    const { provider } = capturingProvider([
      {
        toolCalls: [
          { id: 'call_push', name: 'run_shell', arguments: { command: 'git push --force origin feature/x' } },
        ],
      },
      { content: 'done' },
    ]);
    const asked: string[] = [];
    await runRepl({
      config,
      buildAgentLoop: buildTestLoop(provider),
      io,
      promptApproval: async (question) => {
        asked.push(question);
        return true; // user says yes inside the REPL
      },
    });
    const out = printed.join('\n');
    // The approval question was asked as part of the REPL run.
    expect(asked.some((q) => q.includes('[HITL]'))).toBe(true);
    expect(out).toContain('status=completed');
  });

  it('HITL answers read through the io (default askYesNo path, same input stream)', async () => {
    // No promptApproval injected: the REPL falls back to io.askYesNo — the
    // 'y' line is consumed from the SAME input queue as the instructions.
    const { io, printed, asked } = makeIo(['push', 'y', null]);
    const { provider } = capturingProvider([
      {
        toolCalls: [
          { id: 'call_push', name: 'run_shell', arguments: { command: 'git push --force origin feature/x' } },
        ],
      },
      { content: 'done' },
    ]);
    await runRepl({ config, buildAgentLoop: buildTestLoop(provider), io });
    expect(asked.some((q) => q.includes('[HITL]'))).toBe(true);
    expect(printed.join('\n')).toContain('status=completed');
  });

  it('Ctrl+C during a run interrupts it; the next instruction resumes the SAME session', async () => {
    // Gate the first LLM call so the run is deterministically in-flight.
    let releaseFirst: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = () => resolve();
    });
    const mock = new MockProvider([
      { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
      { content: 'After interrupt.' },
    ]);
    let calls = 0;
    const provider: LLMProvider = {
      complete: async (messages, tools) => {
        calls++;
        if (calls === 1) {
          await gate;
        }
        return mock.complete(messages, tools);
      },
    };
    let interruptHandler: (() => void) | null = null;
    const { io, printed } = makeIo(['long task', 'continue after interrupt', null]);
    const done = runRepl({
      config,
      buildAgentLoop: buildTestLoop(provider),
      io,
      onRunInterrupt: (handler) => {
        interruptHandler = handler;
      },
    });
    // The run is in flight once the first user message is streamed (the LLM
    // call is still gated).
    await waitFor(() => printed.some((l) => l.includes('[user] long task')));
    interruptHandler?.();
    releaseFirst?.();
    await done;
    const out = printed.join('\n');
    expect(out).toContain('[session] interrupted');
    expect(out).toContain('status=paused');
    expect(out).toContain('[user] continue after interrupt');
    expect(out).toContain('After interrupt.');
    expect(out).toContain('status=completed');
  });

  it('/exit exits without reading further input', async () => {
    const { io, printed } = makeIo(['/exit', 'should never run']);
    const exitCodes: number[] = [];
    await runRepl({
      config,
      buildAgentLoop: buildTestLoop(new MockProvider([])),
      io,
      onExit: (code) => exitCodes.push(code),
    });
    expect(exitCodes).toEqual([0]);
    expect(printed.join('\n')).not.toContain('should never run');
  });

  it('/help lists the available slash commands', async () => {
    const { io, printed } = makeIo(['/help', null]);
    await runRepl({ config, buildAgentLoop: buildTestLoop(new MockProvider([])), io });
    const out = printed.join('\n');
    expect(out).toContain('/exit');
    expect(out).toContain('/model');
    expect(out).toContain('/clear');
    expect(out).toContain('/status');
  });

  it('/model <name> switches the session model — the next run builds the provider with it', async () => {
    const builtModels: Array<string | undefined> = [];
    const { io } = makeIo(['task one', '/model deepseek-v3', 'continue', null]);
    const { provider } = capturingProvider([
      { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
      { content: 'One done.' },
      { content: 'Continued.' },
    ]);
    const buildAgentLoop: BuildAgentLoop = async (opts: BuildAgentLoopOptions) => {
      builtModels.push(opts.session?.model);
      return buildTestLoop(provider)(opts);
    };
    await runRepl({ config, buildAgentLoop, io });
    // First run: no session yet → no model override. After /model: the
    // session override reaches the loop factory (Task 26 mechanism).
    expect(builtModels[0]).toBeUndefined();
    expect(builtModels[1]).toBe('deepseek-v3');
  });

  it('/model without an active session prints an error', async () => {
    const { io, printed } = makeIo(['/model deepseek-v3', null]);
    await runRepl({ config, buildAgentLoop: buildTestLoop(new MockProvider([])), io });
    expect(printed.join('\n')).toContain('没有进行中的会话');
  });

  it('/model with no name prints the current model', async () => {
    const { io, printed } = makeIo(['task one', '/model', null]);
    const { provider } = capturingProvider([
      { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
      { content: 'One done.' },
    ]);
    await runRepl({ config, buildAgentLoop: buildTestLoop(provider), io });
    expect(printed.join('\n')).toContain(`当前模型: ${config.llm.model}`);
  });

  it('/clear starts a new session — the old context is not carried over', async () => {
    const { io, printed } = makeIo(['first task', '/clear', 'second task', null]);
    const { provider, contexts } = capturingProvider([
      { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
      { content: 'First done.' },
      { content: 'Second done.' },
    ]);
    await runRepl({ config, buildAgentLoop: buildTestLoop(provider), io });
    const out = printed.join('\n');
    // Two different sessions (the done lines carry distinct session ids).
    const ids = [...out.matchAll(/done: ([0-9a-f-]+)/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    // The second session's LLM context only saw the new task.
    const lastContext = contexts[contexts.length - 1];
    const userContents = lastContext.filter((m) => m.role === 'user').map((m) => m.content);
    expect(userContents).toEqual(['second task']);
    expect(out).toContain('[session] cleared');
  });

  it('/status prints the current session state', async () => {
    const { io, printed } = makeIo(['task one', '/status', null]);
    const { provider } = capturingProvider([
      { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
      { content: 'One done.' },
    ]);
    await runRepl({ config, buildAgentLoop: buildTestLoop(provider), io });
    const out = printed.join('\n');
    const statusLine = out.split('\n').find((l) => l.includes('status=completed') && l.includes('model='));
    expect(statusLine).toBeDefined();
  });

  it('a failing loop build (e.g. missing API key) prints the error and the REPL keeps running', async () => {
    const { io, printed } = makeIo(['first task', 'second task', null]);
    let builds = 0;
    const { provider } = capturingProvider([
      { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
      { content: 'Done.' },
    ]);
    const buildAgentLoop: BuildAgentLoop = async (opts: BuildAgentLoopOptions) => {
      builds++;
      if (builds === 1) {
        throw new Error('No API key found. Run `codeharness key update` to add one.');
      }
      return buildTestLoop(provider)(opts);
    };
    await runRepl({ config, buildAgentLoop, io });
    const out = printed.join('\n');
    // Actionable advice (SPEC §4.3) — and the REPL did NOT die: the next
    // instruction ran normally.
    expect(out).toContain('key update');
    expect(out).toContain('status=completed');
  });

  it('an unknown slash command prints an error with a /help hint', async () => {
    const { io, printed } = makeIo(['/foo', null]);
    await runRepl({ config, buildAgentLoop: buildTestLoop(new MockProvider([])), io });
    const out = printed.join('\n');
    expect(out).toContain('未知命令: /foo');
    expect(out).toContain('/help');
  });

  it('after an approval, a resumed run hitting maxRounds pauses WITHOUT re-asking the decided command (I1 CR)', async () => {
    // maxRounds = 1: the resumed run upgrades (triggerHITL pause, no
    // requestApproval) — HITL state is EXECUTING (the command was already
    // decided), so the REPL must NOT ask about it again (approve() would
    // throw in EXECUTING state and stick the session paused).
    const capped = { ...config, agent: { ...config.agent, maxRounds: 1 } };
    const { io, printed } = makeIo(['push', null]);
    const { provider } = capturingProvider([
      {
        toolCalls: [
          { id: 'call_push', name: 'run_shell', arguments: { command: 'git push --force origin feature/x' } },
        ],
      },
      { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
    ]);
    const asked: string[] = [];
    await runRepl({
      config: capped,
      buildAgentLoop: buildTestLoop(provider),
      io,
      promptApproval: async (question) => {
        asked.push(question);
        return true;
      },
    });
    const out = printed.join('\n');
    expect(asked).toHaveLength(1); // asked exactly once — no re-ask
    expect(out).not.toContain('[session] error');
    expect(out).toContain('status=paused'); // the upgrade pause, cleanly reported
  });

  it('Ctrl+C during the HITL prompt interrupts the run instead of continuing (I2 CR)', async () => {
    // The terminal io (createTerminalReplIO) resolves a pending ask as 'no'
    // AND interrupts the in-flight run on Ctrl+C — the REPL must abort at the
    // round boundary instead of resuming with the denial.
    let interruptHandler: (() => void) | null = null;
    const printed: string[] = [];
    const queue: Array<string | null> = ['push', null];
    const io: ReplIO = {
      readLine: async () => queue.shift() ?? null,
      print: (line) => printed.push(line),
      askYesNo: async () => {
        interruptHandler?.(); // Ctrl+C lands while the approval is pending
        return false;
      },
    };
    const { provider, contexts } = capturingProvider([
      {
        toolCalls: [
          { id: 'call_push', name: 'run_shell', arguments: { command: 'git push --force origin feature/x' } },
        ],
      },
      { content: 'done' },
    ]);
    await runRepl({
      config,
      buildAgentLoop: buildTestLoop(provider),
      io,
      onRunInterrupt: (handler) => {
        interruptHandler = handler;
      },
    });
    const out = printed.join('\n');
    expect(out).toContain('[session] interrupted');
    expect(out).toContain('status=paused');
    expect(out).not.toContain('[session] error');
    // The resumed run was aborted at the round boundary — the LLM was never
    // called again (the 'done' response was not consumed).
    expect(contexts).toHaveLength(1);
  });

  it('EOF exits 1 when the last session did not complete (I3 CR scripting contract)', async () => {
    const { io } = makeIo(['explode', null]);
    const exitCodes: number[] = [];
    await runRepl({
      config,
      buildAgentLoop: buildTestLoop(new MockProvider([])), // no responses → failed
      io,
      onExit: (code) => exitCodes.push(code),
    });
    expect(exitCodes).toEqual([1]);
  });

  it('/exit stays 0 even when the session did not complete (interactive exit, I3 CR)', async () => {
    const { io } = makeIo(['explode', '/exit']);
    const exitCodes: number[] = [];
    await runRepl({
      config,
      buildAgentLoop: buildTestLoop(new MockProvider([])),
      io,
      onExit: (code) => exitCodes.push(code),
    });
    expect(exitCodes).toEqual([0]);
  });

  it('per-instruction errors map through adviceFor (SPEC §4.3 actionable advice, M2 CR)', async () => {
    const { io, printed } = makeIo(['task one', null]);
    const buildAgentLoop: BuildAgentLoop = async () => {
      throw new CredentialNotFoundError('codeharness/deepseek', 'deepseek');
    };
    await runRepl({ config, buildAgentLoop, io });
    const out = printed.join('\n');
    // The mapped advice, not the raw CredentialNotFoundError message.
    expect(out).toContain('No API key is set. Run `codeharness key update` to add one.');
    expect(out).not.toContain('No credential found for');
  });

  it('continuing a capped-out session raises the cap so the next instruction runs (M4 CR)', async () => {
    const capped = { ...config, agent: { ...config.agent, maxRounds: 1 } };
    const { io, printed } = makeIo(['first task', 'continue', null]);
    const { provider } = capturingProvider([
      { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
      { content: 'Continued done.' },
    ]);
    await runRepl({ config: capped, buildAgentLoop: buildTestLoop(provider), io });
    const out = printed.join('\n');
    // Run 1: read_file → round 2 → maxRounds exceeded → paused (upgrade).
    expect(out).toContain('status=paused');
    // Run 2: the raised cap lets the injected instruction run to completion.
    expect(out).toContain('Continued done.');
    expect(out).toContain('status=completed');
  });

  it('HITL deny records the decision and continues without executing (M4 CR)', async () => {
    const { io, printed } = makeIo(['push', 'n', null]);
    const { provider } = capturingProvider([
      {
        toolCalls: [
          { id: 'call_push', name: 'run_shell', arguments: { command: 'git push --force origin feature/x' } },
        ],
      },
      { content: 'done' },
    ]);
    await runRepl({ config, buildAgentLoop: buildTestLoop(provider), io });
    const out = printed.join('\n');
    expect(out).toContain('Command denied');
    expect(out).toContain('status=completed');
  });

  it('/model with a blank argument prints the current model (no override, M4 CR)', async () => {
    const { io, printed } = makeIo(['task one', '/model   ', null]);
    const { provider } = capturingProvider([
      { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
      { content: 'One done.' },
    ]);
    await runRepl({ config, buildAgentLoop: buildTestLoop(provider), io });
    expect(printed.join('\n')).toContain(`当前模型: ${config.llm.model}`);
  });
});

describe('createTerminalReplIO', () => {
  it('Ctrl+C while a read is pending ALSO interrupts the run (I2 CR)', async () => {
    class FakeTty extends PassThrough {
      isTTY = true;
      setRawMode(): this {
        return this;
      }
    }
    const input = new FakeTty();
    const output = new FakeTty();
    const interrupt = vi.fn();
    const io = createTerminalReplIO(() => {}, interrupt, { input, output });
    // A read is pending (the prompt, or a HITL ask mid-run) when Ctrl+C lands
    // — the terminal raw-mode 0x03 byte reaches the readline 'SIGINT' event.
    const line = io.readLine('codeharness> ');
    input.write(Buffer.from([0x03]));
    expect(await line).toBeNull(); // the pending read resolves as an exit...
    expect(interrupt).toHaveBeenCalledTimes(1); // ...AND the run is interrupted
    io.close?.();
  });
});

describe('program wiring', () => {
  it('`codeharness` with no arguments enters the REPL (program action)', async () => {
    const printed: string[] = [];
    const { provider } = capturingProvider([
      { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
      { content: 'Task complete.' },
    ]);
    const program = createProgram(
      {
        start: {
          config: {
            userConfigPath: path.join(workspaceRoot, 'missing-user.json'),
            projectConfigPath: path.join(workspaceRoot, 'missing-project.json'),
          },
          buildAgentLoop: buildTestLoop(provider),
          io: {
            readLine: async () => (printed.some((l) => l.includes('status=completed')) ? null : 'read test.ts'),
            print: (line) => printed.push(line),
          },
        },
      },
      { exitOverride: true },
    );
    const result = await parseCaptured(program, []);
    expect(printed.some((l) => l.includes('CodeHarness REPL'))).toBe(true);
    expect(printed.some((l) => l.includes('[user] read test.ts'))).toBe(true);
    expect(printed.some((l) => l.includes('status=completed'))).toBe(true);
    expect(result.err).toBe('');
  });
});
