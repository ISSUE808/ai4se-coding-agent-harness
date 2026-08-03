import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { WebSocket } from 'ws';
import { createWebHarness } from '../../src/cli/commands/start.js';
import type { WebHarness } from '../../src/cli/commands/start.js';
import { InMemorySessionStore } from '../../src/webui/session-store.js';
import type { SessionStore } from '../../src/webui/session-store.js';
import { createEventBus } from '../../src/events.js';
import type { HarnessEvents } from '../../src/events.js';
import { CredentialStore } from '../../src/credentials/store.js';
import { AgentLoop } from '../../src/core/main-loop.js';
import { MockProvider } from '../../src/llm/mock-provider.js';
import { ToolRegistry } from '../../src/tools/tool.js';
import { readFileTool } from '../../src/tools/read-file.js';
import { writeFileTool } from '../../src/tools/write-file.js';
import { runShellTool } from '../../src/tools/run-shell.js';
import { ActionClassifier } from '../../src/feedback/action-classifier.js';
import { ValidatorSelector } from '../../src/feedback/validator-selector.js';
import { FailureClassifier } from '../../src/feedback/failure-classifier.js';
import { StrategyMatcher } from '../../src/feedback/strategy-matcher.js';
import { RoundManager } from '../../src/feedback/round-manager.js';
import { FormatValidator } from '../../src/feedback/validators/format-validator.js';
import { EslintValidator } from '../../src/feedback/validators/eslint-validator.js';
import { TscValidator } from '../../src/feedback/validators/tsc-validator.js';
import { ShellCheckValidator } from '../../src/feedback/validators/shell-check-validator.js';
import { PatternGuard } from '../../src/guardrail/pattern-guard.js';
import { ScopeFence } from '../../src/guardrail/scope-fence.js';
import { HITLManager } from '../../src/guardrail/hitl-manager.js';
import { SessionMemory } from '../../src/memory/session-memory.js';
import { DEFAULT_CONFIG } from '../../src/config/schema.js';
import type {
  Config,
  CredentialBackend,
  LLMProvider,
  LLMResponse,
  Session,
  Tool,
  Validator,
} from '../../src/types.js';
import type { BuildAgentLoop, BuildAgentLoopOptions } from '../../src/cli/commands/start.js';

/**
 * Task 19 full integration (SPEC §5.1, §9): `start --web` wiring — the real
 * AgentLoop runs WebUI-created sessions in the same process, streaming real
 * events over the WebSocket channel. Every scenario uses MockProvider
 * (SPEC §A.4-C): deterministic, zero network, zero real LLM, zero keychain.
 */

/** In-memory CredentialBackend so /api/keys round-trips without keytar. */
function memoryBackend(): CredentialBackend {
  const secrets = new Map<string, string>();
  return {
    name: 'memory',
    async isAvailable() {
      return true;
    },
    async save(_service, account, secret) {
      secrets.set(account, secret);
    },
    async read(_service, account) {
      return secrets.get(account) ?? null;
    },
    async delete(_service, account) {
      return secrets.delete(account);
    },
    async exists(_service, account) {
      return secrets.has(account);
    },
    async list() {
      return [...secrets.keys()];
    },
  };
}

function createMockExec() {
  return () => {
    throw new Error('mock exec: no real linters in integration tests');
  };
}

/**
 * Real production-style loop factory (mirrors buildDefaultAgentLoop wiring):
 * real tools + validators, but MockProvider and an injectable validator map.
 * The SAME MockProvider is shared across every build so a resumed session
 * (HITL approval) continues consuming the scripted responses.
 */
function buildLoopFactory(
  provider: LLMProvider,
  validators?: Map<string, Validator>,
  guardOverrides?: { patternGuard?: PatternGuard; scopeFence?: ScopeFence },
): BuildAgentLoop {
  return async ({ config, events, hitl }) => {
    const tools = new ToolRegistry();
    tools.register(readFileTool);
    tools.register(writeFileTool);
    tools.register(runShellTool);

    const memory = new SessionMemory(config);
    const guard = {
      patternGuard: guardOverrides?.patternGuard ?? new PatternGuard(),
      scopeFence: guardOverrides?.scopeFence ?? new ScopeFence(),
      // Task 19: share the harness's HITLManager so the approvals API gates
      // the loop's own guardrail decisions.
      hitl: hitl ?? new HITLManager(),
    };

    const validatorMap = validators ?? new Map<string, Validator>();
    if (validators === undefined) {
      validatorMap.set('eslint', new EslintValidator(createMockExec() as never));
      validatorMap.set('tsc', new TscValidator(createMockExec() as never));
      validatorMap.set('stderrChecker', new ShellCheckValidator());
      validatorMap.set('formatChecker', new FormatValidator());
    }
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
 * MockProvider wrapper with a per-call delay — lets REST control requests
 * (pause/resume/stop) land while the loop is still mid-run.
 */
function slowMockProvider(responses: LLMResponse[], delayMs: number): LLMProvider {
  const inner = new MockProvider(responses);
  return {
    async complete(messages, tools) {
      await silence(delayMs);
      return inner.complete(messages, tools);
    },
  };
}

function makeConfig(
  workspaceRoot: string,
  overrides: { maxRounds?: number; port?: number } = {},
): Config {
  return {
    ...structuredClone(DEFAULT_CONFIG),
    llm: { ...DEFAULT_CONFIG.llm, provider: 'mock' },
    agent: {
      ...DEFAULT_CONFIG.agent,
      workspaceRoot,
      maxRounds: overrides.maxRounds ?? 3,
    },
    webui: { ...DEFAULT_CONFIG.webui, port: overrides.port ?? 0 },
  } as Config;
}

interface Fixture {
  harness: WebHarness;
  events: HarnessEvents;
  sessionStore: SessionStore;
  port: number;
  web: WebHarness['web'];
}

const openHarnesses: WebHarness[] = [];
const openSockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of openSockets) {
    ws.terminate();
  }
  openSockets.length = 0;
  for (const harness of openHarnesses) {
    await harness.close();
  }
  openHarnesses.length = 0;
});

async function makeHarness(
  config: Config,
  provider: LLMProvider,
  validators?: Map<string, Validator>,
  guardOverrides?: { patternGuard?: PatternGuard; scopeFence?: ScopeFence },
  /** Task 26: per-build observer (records what runSession passed the factory). */
  onBuild?: (opts: BuildAgentLoopOptions) => void,
): Promise<Fixture> {
  const events = createEventBus();
  const credentialStore = new CredentialStore([memoryBackend()]);
  const sessionStore = new InMemorySessionStore(config.agent.maxRounds, config.agent.workspaceRoot);
  const harness = await createWebHarness({
    config,
    events,
    credentialStore,
    sessionStore,
    buildAgentLoop: async (opts) => {
      onBuild?.(opts);
      return buildLoopFactory(provider, validators, guardOverrides)(opts);
    },
    persistConfig: async () => {
      // Test-only: never touch the project config file.
    },
  });
  openHarnesses.push(harness);
  return { harness, events, sessionStore, port: harness.port, web: harness.web };
}

function wsConnect(port: number): Promise<WebSocket & { messages: string[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: string[] = [];
    ws.on('message', (raw) => messages.push(raw.toString()));
    ws.on('open', () => {
      openSockets.push(ws);
      resolve(Object.assign(ws, { messages }));
    });
    ws.on('error', reject);
  });
}

interface WsFrame {
  type: string;
  data: Record<string, unknown>;
}

/** Wait for a frame matching `predicate`; checks already-received frames first. */
function nextEvent(
  ws: WebSocket & { messages: string[] },
  predicate: (frame: WsFrame) => boolean,
  timeoutMs = 5000,
): Promise<WsFrame> {
  const existing = ws.messages.map((m) => JSON.parse(m) as WsFrame).find(predicate);
  if (existing) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error('timeout waiting for WS event'));
    }, timeoutMs);
    function onMsg(raw: Buffer): void {
      const frame = JSON.parse(raw.toString()) as WsFrame;
      if (predicate(frame)) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(frame);
      }
    }
    ws.on('message', onMsg);
  });
}

const silence = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll the store until the session reaches `status` (the loop runs async). */
async function waitForStatus(
  store: SessionStore,
  id: string,
  status: Session['status'],
  timeoutMs = 8000,
): Promise<Session> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const session = store.get(id);
    if (session?.status === status) {
      return session;
    }
    await silence(20);
  }
  const current = store.get(id);
  throw new Error(`timeout waiting for session ${id} to reach ${status}, got ${current?.status}`);
}

/** Poll until `cond()` is true (the loop runs async; status may not change). */
async function waitForCondition(
  cond: () => boolean,
  timeoutMs = 8000,
  label = 'condition',
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) {
      return;
    }
    await silence(20);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function toolCount(store: SessionStore, id: string): number {
  return store.get(id)?.messages.filter((m) => m.role === 'tool').length ?? 0;
}

// Longer per-test budget: HITL approval scenarios (pause → decide → execute
// → resume → complete) exceed the 5s default under parallel load — the WS
// helpers already use their own 5-8s waits, this guards the vitest-level cap.
describe('full integration — start --web wiring (Task 19)', () => {
  let configRoot: string;

  beforeAll(() => {
    configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-full-'));
    fs.writeFileSync(path.join(configRoot, 'test.ts'), 'const answer = 42;\n');
  });

  afterAll(() => {
    fs.rmSync(configRoot, { recursive: true, force: true });
  });

  it('启动 agent → tool call → 反馈管线 → 会话完成，WS 广播真实事件', async () => {
    const mock = new MockProvider([
      { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
      { content: '任务完成。' },
    ]);
    const { harness, sessionStore, port, web } = await makeHarness(makeConfig(configRoot), mock);

    // Connect BEFORE creating the session so the loop's live frames are seen.
    const ws = await wsConnect(port);
    const created = await request(web.app).post('/api/sessions').send({ task: '读取 test.ts' });
    expect(created.status).toBe(201);
    expect(created.body.workspaceRoot).toBe(configRoot); // store default = config root

    const session = await waitForStatus(sessionStore, created.body.id, 'completed');
    // Tool executed against the session root; feedback pipeline ran (no
    // validators for file_read → passed) and the session completed.
    const toolMsgs = session.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(1);
    expect(toolMsgs[0].metadata?.toolName).toBe('read_file');
    expect(toolMsgs[0].metadata?.toolResult?.success).toBe(true);

    // Real events reached the WebSocket channel.
    const toolFrame = await nextEvent(ws, (f) => f.type === 'tool:executed' && f.data.toolName === 'read_file');
    expect(toolFrame.data.success).toBe(true);
    const doneFrame = await nextEvent(
      ws,
      (f) => f.type === 'session:status' && f.data.sessionId === created.body.id && f.data.status === 'completed',
    );
    expect(doneFrame.data.status).toBe('completed');
    expect(harness).toBeDefined();
  });

  it('keeps tool_call pairing intact when guardrails crash — loop never 400s on the next call', async () => {
    // A guardrail that throws must not leave declared tool_calls unpaired.
    const crashingGuard = new PatternGuard();
    vi.spyOn(crashingGuard, 'check').mockImplementation(() => {
      throw new Error('pattern guard exploded');
    });

    const mock = new MockProvider([
      { toolCalls: [{ id: 'c1', name: 'run_shell', arguments: { command: 'git status' } }] },
      { content: 'done' },
    ]);
    const { harness, sessionStore } = await makeHarness(
      makeConfig(configRoot, { maxRounds: 10 }),
      mock,
      undefined,
      { patternGuard: crashingGuard },
    );
    const created = await request(harness.web.app).post('/api/sessions').send({ task: 't' });
    const session = await waitForStatus(sessionStore, created.body.id, 'completed');

    const declaredIds = new Set<string>();
    for (const m of session.messages) {
      const calls = m.metadata?.toolInput?.toolCalls as { id?: string }[] | undefined;
      if (m.role === 'assistant' && Array.isArray(calls)) {
        for (const c of calls) {
          if (c.id) {
            declaredIds.add(c.id);
          }
        }
      }
    }
    expect(declaredIds.size).toBeGreaterThan(0);
    for (const id of declaredIds) {
      const paired = session.messages.filter((m) => m.role === 'tool' && m.metadata?.toolCallId === id);
      expect(paired.length, `tool_call_id ${id} must have exactly one tool response`).toBe(1);
    }
  });

  it('pairs every assistant tool_call with a tool message, including guardrail-blocked actions (OpenAI protocol)', async () => {
    const mock = new MockProvider([
      {
        toolCalls: [
          { id: 'call_block', name: 'run_shell', arguments: { command: 'rm -rf /' } },
          { id: 'call_ok', name: 'write_file', arguments: { path: 'x.txt', content: 'hi' } },
        ],
      },
      { content: 'done' },
    ]);
    const { harness, sessionStore } = await makeHarness(makeConfig(configRoot, { maxRounds: 10 }), mock);
    const created = await request(harness.web.app).post('/api/sessions').send({ task: 't' });
    const session = await waitForStatus(sessionStore, created.body.id, 'completed');

    // OpenAI protocol: every tool_call_id declared by an assistant message must
    // have exactly one tool-role response — DeepSeek 400s on missing pairs.
    const declaredIds = new Set<string>();
    for (const m of session.messages) {
      const calls = m.metadata?.toolInput?.toolCalls as { id?: string }[] | undefined;
      if (m.role === 'assistant' && Array.isArray(calls)) {
        for (const c of calls) {
          if (c.id) {
            declaredIds.add(c.id);
          }
        }
      }
    }
    expect(declaredIds.size).toBeGreaterThan(0);
    for (const id of declaredIds) {
      const paired = session.messages.filter((m) => m.role === 'tool' && m.metadata?.toolCallId === id);
      expect(paired.length, `tool_call_id ${id} must have exactly one tool response`).toBe(1);
    }
  });

  it('护栏 HITL warn 触发 → 用户通过 API 批准 → agent 继续执行并完成', async () => {
    const mock = new MockProvider([
      // Round 1: warn-level command → HITL pause (approval required).
      { toolCalls: [{ id: 'call_push', name: 'run_shell', arguments: { command: 'git push --force origin feature/x' } }] },
      // After the user approves: the agent continues with a normal tool call…
      { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
      // …and finishes.
      { content: '任务完成。' },
    ]);
    const { sessionStore, web } = await makeHarness(makeConfig(configRoot), mock);

    const created = await request(web.app).post('/api/sessions').send({ task: '推送分支' });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const paused = await waitForStatus(sessionStore, id, 'paused');
    expect(paused.messages.some((m) => m.metadata?.approvalRequired === true)).toBe(true);
    expect(paused.messages.some((m) => m.content.includes('Operation paused for human approval'))).toBe(true);

    // Human approves via the REST API.
    const approve = await request(web.app).post(`/api/approvals/${id}`).send({ decision: 'approve' });
    expect(approve.status).toBe(200);
    expect(approve.body.decision).toBe('approve');

    // The integrated harness resumes the same stored session — it completes.
    const done = await waitForStatus(sessionStore, id, 'completed');
    expect(done.messages.some((m) => m.content.includes('Command approved'))).toBe(true);
    const toolMsgs = done.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs.some((m) => m.metadata?.toolName === 'read_file' && m.metadata?.toolResult?.success)).toBe(true);

    // SPEC §3.4: approval authorizes EXECUTION — the paused tool message was
    // REWRITTEN with the real execution result (Claude Code model: the LLM
    // sees a normal tool outcome, not "[HITL] approved" noise). git push
    // fails (not a git repo) but it RAN — the error is visible to the LLM.
    const executed = done.messages.filter(
      (m) =>
        m.role === 'tool' &&
        ((m.metadata?.toolResult?.error as string | undefined) ?? '').includes('fatal'),
    );
    expect(executed.length).toBeGreaterThanOrEqual(1);
  });

  describe('Task 25 guardrails config overlay (config.guardrails)', () => {
    it('blockOutbound=true pauses a network-outbound command for approval, then resumes to completion', async () => {
      // `git push origin main` is NOT flagged by PatternGuard (only
      // `--force` is a warn rule) — the config switch must be the reason.
      const cfg = makeConfig(configRoot, { maxRounds: 10 });
      cfg.guardrails = { blockOutbound: true };
      const mock = new MockProvider([
        { toolCalls: [{ id: 'call_net', name: 'run_shell', arguments: { command: 'git push origin main' } }] },
        { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
        { content: '任务完成。' },
      ]);
      const { sessionStore, web } = await makeHarness(cfg, mock);

      const created = await request(web.app).post('/api/sessions').send({ task: '推送' });
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      const paused = await waitForStatus(sessionStore, id, 'paused');
      const guardMsg = paused.messages.find((m) => m.metadata?.approvalRequired === true);
      expect(guardMsg).toBeDefined();
      expect(guardMsg?.metadata?.guardrailRule).toContain('blockOutbound');

      const approve = await request(web.app).post(`/api/approvals/${id}`).send({ decision: 'approve' });
      expect(approve.status).toBe(200);

      const done = await waitForStatus(sessionStore, id, 'completed');
      expect(
        done.messages.some(
          (m) => m.metadata?.toolName === 'read_file' && m.metadata?.toolResult?.success,
        ),
      ).toBe(true);
    });

    it('blockOutbound=true demands a FRESH decision even for a previously approved network command', async () => {
      const cfg = makeConfig(configRoot, { maxRounds: 10 });
      cfg.guardrails = { blockOutbound: true };
      const mock = new MockProvider([
        { toolCalls: [{ id: 'c1', name: 'run_shell', arguments: { command: 'git push origin main' } }] },
        { toolCalls: [{ id: 'c2', name: 'run_shell', arguments: { command: 'git push origin main' } }] },
        { content: '任务完成。' },
      ]);
      const { sessionStore, web } = await makeHarness(cfg, mock);

      const created = await request(web.app).post('/api/sessions').send({ task: '推送两次' });
      const id = created.body.id as string;

      // First occurrence pauses.
      await waitForStatus(sessionStore, id, 'paused');
      await request(web.app).post(`/api/approvals/${id}`).send({ decision: 'approve' });

      // The SAME command again must still pause — the config switch overrides
      // the session approval cache (PatternGuard warn would pass it through).
      const second = await waitForStatus(sessionStore, id, 'paused');
      expect(
        second.messages.filter((m) => m.metadata?.approvalRequired === true),
      ).toHaveLength(2);
      await request(web.app).post(`/api/approvals/${id}`).send({ decision: 'approve' });

      const done = await waitForStatus(sessionStore, id, 'completed');
      expect(done.status).toBe('completed');
    });

    it('requireApproval pauses a command matching a listed rule (substring); non-matching commands run freely', async () => {
      const cfg = makeConfig(configRoot, { maxRounds: 10 });
      cfg.guardrails = { requireApproval: ['prod'] };
      const mock = new MockProvider([
        { toolCalls: [{ id: 'c1', name: 'run_shell', arguments: { command: 'kubectl apply -f prod-deploy.yaml' } }] },
        { toolCalls: [{ id: 'c2', name: 'run_shell', arguments: { command: 'kubectl apply -f dev-deploy.yaml' } }] },
        { content: '任务完成。' },
      ]);
      const { sessionStore, web } = await makeHarness(cfg, mock);

      const created = await request(web.app).post('/api/sessions').send({ task: '部署' });
      const id = created.body.id as string;

      const paused = await waitForStatus(sessionStore, id, 'paused');
      const guardMsg = paused.messages.find((m) => m.metadata?.approvalRequired === true);
      expect(guardMsg?.metadata?.guardrailRule).toContain('requireApproval');
      expect(guardMsg?.metadata?.guardrailRule).toContain('prod');
      await request(web.app).post(`/api/approvals/${id}`).send({ decision: 'approve' });

      // The dev command does NOT contain 'prod' — it must execute unpaused.
      const done = await waitForStatus(sessionStore, id, 'completed');
      expect(done.messages.filter((m) => m.metadata?.approvalRequired === true)).toHaveLength(1);
    });

    it('no guardrails config → the same commands behave exactly as before (no config interception)', async () => {
      const mock = new MockProvider([
        { toolCalls: [{ id: 'c1', name: 'run_shell', arguments: { command: 'git push origin main' } }] },
        { content: '任务完成。' },
      ]);
      const { sessionStore, web } = await makeHarness(makeConfig(configRoot, { maxRounds: 10 }), mock);

      const created = await request(web.app).post('/api/sessions').send({ task: '推送' });
      const id = created.body.id as string;

      const done = await waitForStatus(sessionStore, id, 'completed');
      expect(done.messages.filter((m) => m.metadata?.approvalRequired === true)).toHaveLength(0);
    });
  });

  it('a user message resumes a completed session — the agent continues (user feedback)', async () => {
    const mock = new MockProvider([
      // First run: text-only → completed immediately.
      { content: '任务完成。' },
      // After the user message: the agent continues with a tool call…
      { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
      // …and finishes again.
      { content: '任务完成。' },
    ]);
    const { harness, sessionStore, web } = await makeHarness(makeConfig(configRoot, { maxRounds: 10 }), mock);
    const created = await request(web.app).post('/api/sessions').send({ task: '第一个任务' });
    const id = created.body.id as string;

    const first = await waitForStatus(sessionStore, id, 'completed');
    expect(first.messages.some((m) => m.role === 'tool')).toBe(false);

    // User appends a new instruction to the finished session.
    const post = await request(web.app)
      .post(`/api/sessions/${id}/message`)
      .send({ role: 'user', content: '继续：读取 test.ts' });
    if (post.status !== 200) {
      console.log('POST /message error body:', JSON.stringify(post.body));
    }
    expect(post.status).toBe(200);

    // The harness resumes the loop with the new message in context — the
    // scripted next response executes a tool call.
    const start = Date.now();
    let toolSeen = false;
    while (Date.now() - start < 8000) {
      const s = sessionStore.get(id);
      if (s?.messages.some((m) => m.role === 'tool' && m.metadata?.toolName === 'read_file')) {
        toolSeen = true;
        break;
      }
      await silence(50);
    }
    expect(toolSeen).toBe(true);
  });

  it('反馈失败 3 次 → 升级 → HITL 暂停（approvalRequired 消息）', async () => {
    const mock = new MockProvider([
      { toolCalls: [{ name: 'write_file', arguments: { path: 'test.ts', content: 'const x: number = "str"' } }] },
      { toolCalls: [{ name: 'write_file', arguments: { path: 'test.ts', content: 'const x: number = "str2"' } }] },
      { toolCalls: [{ name: 'write_file', arguments: { path: 'test.ts', content: 'const x: number = "str3"' } }] },
      { toolCalls: [{ name: 'write_file', arguments: { path: 'test.ts', content: 'const x: number = "str4"' } }] },
    ]);
    const { sessionStore, web } = await makeHarness(makeConfig(configRoot, { maxRounds: 3 }), mock);

    const created = await request(web.app).post('/api/sessions').send({ task: '修复类型错误' });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const paused = await waitForStatus(sessionStore, id, 'paused');
    expect(paused.messages.some((m) => m.metadata?.approvalRequired === true)).toBe(true);
    const toolMsgs = paused.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(3);
    expect(paused.currentRound).toBe(4);
    expect(paused.status).not.toBe('completed');
  });

  it('会话级 workspaceRoot 全链路：工具 cwd / 验证器 cwd / scope-fence 越界基准均为会话根', async () => {
    const sessionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-full-sess-'));
    try {
      fs.writeFileSync(path.join(sessionRoot, 'b.ts'), 'const n = 1;\n');

      // Spy validators record the cwd the feedback pipeline ran in.
      const recordedCwd: string[] = [];
      const spy = (name: string): Validator => ({
        name,
        async validate(_action, _result, context) {
          recordedCwd.push(context.workspaceRoot);
          return { passed: true, validator: name, evidence: 'ok' };
        },
      });
      const validators = new Map<string, Validator>();
      validators.set('eslint', spy('eslint'));
      validators.set('tsc', spy('tsc'));
      validators.set('stderrChecker', new ShellCheckValidator());
      validators.set('formatChecker', new FormatValidator());

      const mock = new MockProvider([
        // file_write (code file) → eslint+tsc spies run against the session root.
        { toolCalls: [{ name: 'write_file', arguments: { path: 'b.ts', content: 'const n = 1;' } }] },
        // file_read — b.ts exists ONLY in the session root.
        { toolCalls: [{ name: 'read_file', arguments: { paths: ['b.ts'] } }] },
        // Absolute path INSIDE the config root but OUTSIDE the session root →
        // the session-scoped scope fence must block it.
        { toolCalls: [{ name: 'write_file', arguments: { path: path.join(configRoot, 'sneak.txt'), content: 'x' } }] },
        { content: '任务完成。' },
      ]);
      // Room for the blocked round: guardrail-blocked actions count as a
      // failed round, and 3 maxRounds would upgrade (pause) before the final
      // text-completion response is consumed.
      const { sessionStore, web } = await makeHarness(makeConfig(configRoot, { maxRounds: 5 }), mock, validators);

      const created = await request(web.app)
        .post('/api/sessions')
        .send({ task: '会话级工作目录', workspaceRoot: sessionRoot });
      expect(created.status).toBe(201);
      expect(created.body.workspaceRoot).toBe(sessionRoot);

      const session = await waitForStatus(sessionStore, created.body.id, 'paused');

      // Validators ran against the session root, not the config root.
      expect(recordedCwd.length).toBeGreaterThan(0);
      expect(recordedCwd.every((c) => c === sessionRoot)).toBe(true);

      // Tools ran against the session root: b.ts was read successfully.
      const toolMsgs = session.messages.filter((m) => m.role === 'tool');
      const read = toolMsgs.find((m) => m.metadata?.toolName === 'read_file');
      expect(read?.metadata?.toolResult?.success).toBe(true);
      const write = toolMsgs.find((m) => m.metadata?.toolName === 'write_file');
      expect(write?.metadata?.toolResult?.success).toBe(true);
      expect(fs.existsSync(path.join(sessionRoot, 'b.ts'))).toBe(true);

      // The sneaky absolute write now pauses for a human decision (not a
      // silent block) — nothing was written yet.
      expect(session.messages.some((m) => m.metadata?.approvalRequired === true)).toBe(true);
      expect(fs.existsSync(path.join(configRoot, 'sneak.txt'))).toBe(false);

      // Human approves → the harness executes the authorized write.
      await request(web.app).post(`/api/approvals/${created.body.id}`).send({ decision: 'approve' });
      await waitForStatus(sessionStore, created.body.id, 'completed');
      expect(fs.existsSync(path.join(configRoot, 'sneak.txt'))).toBe(true);
    } finally {
      fs.rmSync(sessionRoot, { recursive: true, force: true });
    }
  });

  it('同一进程内第二次 warn → 批准卡再次出现 → 批准后 agent 继续执行（C1 HITL 可复用）', async () => {
    const mock = new MockProvider([
      // Round 1: first warn-level command → HITL pause.
      { toolCalls: [{ name: 'run_shell', arguments: { command: 'git push --force origin feature/a' } }] },
      // After approve 1: a SECOND warn command must raise a NEW approval card
      // (not be silently swallowed as "HITL busy").
      { toolCalls: [{ name: 'run_shell', arguments: { command: 'git clean -fd' } }] },
      // After approve 2: the agent really executes the next command and finishes.
      { toolCalls: [{ name: 'run_shell', arguments: { command: 'echo approved-work' } }] },
      { content: '任务完成。' },
    ]);
    const { sessionStore, web } = await makeHarness(makeConfig(configRoot), mock);

    const created = await request(web.app).post('/api/sessions').send({ task: '重复 warn' });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    // First warn pause shows one approval card.
    await waitForStatus(sessionStore, id, 'paused');
    await waitForCondition(
      () => (sessionStore.get(id)?.messages.filter((m) => m.metadata?.approvalRequired === true).length ?? 0) === 1,
      8000,
      'first approval card',
    );

    const approve1 = await request(web.app).post(`/api/approvals/${id}`).send({ decision: 'approve' });
    expect(approve1.status).toBe(200);

    // Second warn → the approval card appears AGAIN (approvals API usable).
    await waitForCondition(
      () => (sessionStore.get(id)?.messages.filter((m) => m.metadata?.approvalRequired === true).length ?? 0) === 2,
      8000,
      'second approval card',
    );
    const approve2 = await request(web.app).post(`/api/approvals/${id}`).send({ decision: 'approve' });
    expect(approve2.status).toBe(200);

    // After the second approval the agent executes a real command and completes.
    const done = await waitForStatus(sessionStore, id, 'completed');
    expect(done.messages.filter((m) => m.content.includes('Command approved'))).toHaveLength(2);
    // The SECOND pending command was the one recorded on the second approval.
    expect(done.messages.some((m) => m.content.includes('git clean -fd'))).toBe(true);
    const shellMsgs = done.messages.filter((m) => m.role === 'tool' && m.metadata?.toolName === 'run_shell');
    expect(shellMsgs.some((m) => m.metadata?.toolResult?.success)).toBe(true);
  });

  it('升级暂停（反馈失败 3 次）→ 人工恢复 → 上限提高并继续执行至完成（I1）', async () => {
    const mock = new MockProvider([
      { toolCalls: [{ name: 'write_file', arguments: { path: 'test.ts', content: 'const x: number = "str"' } }] },
      { toolCalls: [{ name: 'write_file', arguments: { path: 'test.ts', content: 'const x: number = "str2"' } }] },
      { toolCalls: [{ name: 'write_file', arguments: { path: 'test.ts', content: 'const x: number = "str3"' } }] },
      { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
      { content: '任务完成。' },
    ]);
    const { sessionStore, web } = await makeHarness(makeConfig(configRoot, { maxRounds: 3 }), mock);

    const created = await request(web.app).post('/api/sessions').send({ task: '升级后恢复' });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    // Upgrade pause: currentRound=4 > maxRounds=3.
    const paused = await waitForStatus(sessionStore, id, 'paused');
    expect(paused.currentRound).toBe(4);
    expect(paused.maxRounds).toBe(3);
    expect(paused.messages.some((m) => m.metadata?.approvalRequired === true)).toBe(true);

    // Human resumes via the REST API — the harness raises the cap (persisted
    // on the stored session) so the loop continues instead of re-upgrading.
    const resumed = await request(web.app).post(`/api/sessions/${id}/resume`);
    expect(resumed.status).toBe(200);
    expect(resumed.body.status).toBe('running');
    expect(resumed.body.maxRounds).toBe(7); // currentRound(4) + maxRounds(3)

    const done = await waitForStatus(sessionStore, id, 'completed');
    expect(done.maxRounds).toBe(7);
    const toolMsgs = done.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(4); // 3 failed writes + 1 read after resume
    expect(
      toolMsgs.some((m) => m.metadata?.toolName === 'read_file' && m.metadata?.toolResult?.success),
    ).toBe(true);
  });

  it('pause 真实停止 loop；resume 真实继续；stop 真实终止（I2）', async () => {
    // 8 tool rounds with a 60ms-per-call LLM — long enough for the REST
    // control requests to land while the loop is mid-run.
    const responses: LLMResponse[] = Array.from({ length: 8 }, () => ({
      toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }],
    }));
    const { sessionStore, web } = await makeHarness(makeConfig(configRoot), slowMockProvider(responses, 60));

    const created = await request(web.app).post('/api/sessions').send({ task: '控制测试' });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    // The loop is mid-run once the first tool message exists.
    await waitForCondition(() => toolCount(sessionStore, id) >= 1, 8000, 'first tool round');

    // Pause: status becomes paused AND the loop really stops.
    const paused = await request(web.app).post(`/api/sessions/${id}/pause`);
    expect(paused.status).toBe(200);
    expect(paused.body.status).toBe('paused');
    const countAtPause = toolCount(sessionStore, id);
    await silence(300);
    // At most the in-flight round may finish; a live loop would add ~5 more.
    expect(toolCount(sessionStore, id)).toBeLessThanOrEqual(countAtPause + 1);

    // Resume: the loop really continues.
    const resumed = await request(web.app).post(`/api/sessions/${id}/resume`);
    expect(resumed.status).toBe(200);
    expect(resumed.body.status).toBe('running');
    await waitForCondition(() => toolCount(sessionStore, id) > countAtPause, 8000, 'rounds after resume');

    // Stop: status becomes completed AND the loop halts.
    const stopped = await request(web.app).post(`/api/sessions/${id}/stop`);
    expect(stopped.status).toBe(200);
    expect(stopped.body.status).toBe('completed');
    const countAtStop = toolCount(sessionStore, id);
    await silence(300);
    expect(toolCount(sessionStore, id)).toBeLessThanOrEqual(countAtStop + 1);
    expect(sessionStore.get(id)?.status).toBe('completed');
  });

  describe('Task 26 — session-level model override', () => {
    it('a session created WITH a model hands it to the first provider build (spy)', async () => {
      const builtModels: Array<string | undefined> = [];
      const provider = new MockProvider([{ content: '完成。' }]);
      const { sessionStore, web } = await makeHarness(
        makeConfig(configRoot),
        provider,
        undefined,
        undefined,
        (opts) => {
          builtModels.push(opts.session?.model);
        },
      );

      const created = await request(web.app)
        .post('/api/sessions')
        .send({ task: '带模型的会话', model: 'deepseek-r1' });
      expect(created.status).toBe(201);
      await waitForStatus(sessionStore, created.body.id, 'completed');

      // The very first loop build already carried the session's model.
      expect(builtModels).toEqual(['deepseek-r1']);
    });

    it('PATCH while running aborts the run and restarts with the new model (spy + timing)', async () => {
      const builtModels: Array<string | undefined> = [];
      // Slow provider: the PATCH lands while the first run is mid-call.
      // Scripted: the FIRST tool call is cut by the abort (the loop breaks
      // right after the LLM response); the restarted run executes the next
      // tool call and completes.
      const provider = slowMockProvider(
        [
          { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
          { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
          { content: '完成。' },
        ],
        400,
      );
      const { harness, sessionStore, web, port } = await makeHarness(
        makeConfig(configRoot),
        provider,
        undefined,
        undefined,
        (opts) => {
          builtModels.push(opts.session?.model);
        },
      );

      const created = await request(web.app).post('/api/sessions').send({ task: '模型切换任务' });
      const id = created.body.id as string;
      // The initial build happened with no session-level model.
      expect(builtModels).toEqual([undefined]);

      const ws = await wsConnect(port);
      const patched = await request(web.app)
        .patch(`/api/sessions/${id}/model`)
        .send({ model: 'deepseek-v3' });
      expect(patched.status).toBe(200);

      // The abort+restart mechanism rebuilt the loop — the new build carries
      // the session's model (spec: provider construction spy).
      await waitForCondition(() => builtModels.length >= 2, 8000, 'provider rebuild after switch');
      expect(builtModels).toEqual([undefined, 'deepseek-v3']);

      // The restarted agent continued and completed under the new model.
      const done = await waitForStatus(sessionStore, id, 'completed');
      expect(done.model).toBe('deepseek-v3');
      expect(done.messages.some((m) => m.role === 'tool')).toBe(true);
      // The model change reached WebSocket clients too.
      const frame = await nextEvent(ws, (f) => f.type === 'session:updated' && f.data.sessionId === id);
      expect(frame.data.model).toBe('deepseek-v3');
    });

    it('pause racing a model switch wins — no restart flow behind the pause (review I1)', async () => {
      const builtModels: Array<string | undefined> = [];
      const provider = slowMockProvider(
        [
          { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
          { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
          { content: '完成。' },
          { content: '完成。' },
        ],
        400,
      );
      const { sessionStore, web } = await makeHarness(
        makeConfig(configRoot),
        provider,
        undefined,
        undefined,
        (opts) => {
          builtModels.push(opts.session?.model);
        },
      );

      const created = await request(web.app).post('/api/sessions').send({ task: '竞态测试' });
      const id = created.body.id as string;

      // Model switch while running, then pause IMMEDIATELY — the pause lands
      // while the aborted run is still finishing. The abort cuts the loop
      // right after the in-flight LLM response (the round's tool call is
      // dropped), and the pause's final status suppresses any restart.
      await request(web.app).patch(`/api/sessions/${id}/model`).send({ model: 'deepseek-v3' });
      const paused = await request(web.app).post(`/api/sessions/${id}/pause`);
      expect(paused.status).toBe(200);
      expect(paused.body.status).toBe('paused');

      // Give the in-flight round time to finish — then verify NOTHING
      // restarted behind the pause (a buggy finally would re-run the loop:
      // status flips to completed / tool messages keep flowing / a second
      // provider is built).
      await silence(1000);
      const session = sessionStore.get(id);
      expect(session?.status).toBe('paused');
      // The switch itself is still recorded — the NEXT run honors it.
      expect(session?.model).toBe('deepseek-v3');
      // No restart flow behind the pause — and the cut round ran NO tool.
      expect(toolCount(sessionStore, id)).toBe(0);
      expect(builtModels).toEqual([undefined]);
    });

    it('resume after the paused race does not re-restart on a leftover latch (review M1)', async () => {
      const builtModels: Array<string | undefined> = [];
      const provider = slowMockProvider(
        [
          { toolCalls: [{ name: 'read_file', arguments: { paths: ['test.ts'] } }] },
          { content: '完成。' },
          { content: '完成。' },
        ],
        400,
      );
      const { sessionStore, web } = await makeHarness(
        makeConfig(configRoot),
        provider,
        undefined,
        undefined,
        (opts) => {
          builtModels.push(opts.session?.model);
        },
      );

      const created = await request(web.app).post('/api/sessions').send({ task: '竞态恢复' });
      const id = created.body.id as string;

      // Same I1 race: the model switch's latch is left behind by the paused
      // run (its finally must NOT consume-and-restart it).
      await request(web.app).patch(`/api/sessions/${id}/model`).send({ model: 'deepseek-v3' });
      await request(web.app).post(`/api/sessions/${id}/pause`);
      await silence(1000);
      expect(sessionStore.get(id)?.status).toBe('paused');

      // Resume: the new run honors the model switch, completes, and the
      // leftover latch must NOT trigger an extra rebuild afterwards.
      const resumed = await request(web.app).post(`/api/sessions/${id}/resume`);
      expect(resumed.status).toBe(200);
      const done = await waitForStatus(sessionStore, id, 'completed');
      expect(done.model).toBe('deepseek-v3');

      // Exactly TWO provider builds: the original run and the resumed one.
      expect(builtModels).toEqual([undefined, 'deepseek-v3']);

      // Nothing keeps flowing after completion. The cut round ran no tool,
      // and the resumed run (re-seeded, no tool message) completes directly.
      await silence(900);
      expect(builtModels).toEqual([undefined, 'deepseek-v3']);
      expect(toolCount(sessionStore, id)).toBe(0);
    });
  });
}, 15000);

describe('provider activation follows the LIVE config (real-test fix)', () => {
  it('sessions built after PUT /api/config use the NEW provider; running sessions restart onto it', async () => {
    const builds: BuildAgentLoopOptions[] = [];
    const config = makeConfig(os.tmpdir());
    // Slow responses keep the first session RUNNING while the switch lands.
    const slow = slowMockProvider(
      [
        { role: 'assistant', content: 'done', toolCalls: [] },
        { role: 'assistant', content: 'done 2', toolCalls: [] },
        { role: 'assistant', content: 'done 3', toolCalls: [] },
      ],
      400,
    );
    const { harness, port, sessionStore } = await makeHarness(
      config,
      slow,
      undefined,
      undefined,
      (opts) => builds.push(opts),
    );

    // First session runs on the STARTUP provider (deepseek).
    const first = await request(`http://127.0.0.1:${port}`)
      .post('/api/sessions')
      .send({ task: 't1' });
    expect(first.status).toBe(201);
    await waitForStatus(sessionStore, first.body.id, 'running');
    expect(builds[0].config.llm.provider).toBe('mock');

    // Activate another provider — the Settings 应用 action.
    const put = await request(`http://127.0.0.1:${port}`)
      .put('/api/config')
      .send({ llm: { provider: 'nju', baseUrl: 'https://nju.example.com/v1', model: 'nju-model' } });
    expect(put.status).toBe(200);

    // The RUNNING session restarts onto the new provider and completes.
    await waitForStatus(sessionStore, first.body.id, 'completed', 10000);
    expect(builds.length).toBeGreaterThanOrEqual(2);
    const restarted = builds[builds.length - 1];
    expect(restarted.config.llm.provider).toBe('nju');
    expect(restarted.config.llm.baseUrl).toBe('https://nju.example.com/v1');

    // A NEW session also builds with the LIVE config, not the startup one.
    const before = builds.length;
    const second = await request(`http://127.0.0.1:${port}`)
      .post('/api/sessions')
      .send({ task: 't2' });
    expect(second.status).toBe(201);
    await waitForStatus(sessionStore, second.body.id, 'completed', 10000);
    expect(builds.length).toBeGreaterThan(before);
    const built = builds[builds.length - 1];
    expect(built.config.llm.provider).toBe('nju');
    expect(built.config.llm.baseUrl).toBe('https://nju.example.com/v1');
  });
}, 15000);
