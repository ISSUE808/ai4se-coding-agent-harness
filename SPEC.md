# CodeHarness — SPEC

> AI4SE 期末项目 A · Coding Agent Harness
> 创建日期：2026-07-27

---

## 一、问题陈述

### 1.1 要解决什么问题

当前 AI 编程领域充斥着两个极端：一端是"把所有事情交给 LLM 自己判断"的松散提示词驱动模式，另一端是 LangChain、CrewAI 等高度抽象的编排框架。前者因缺乏确定性的工程机制而不可靠（护栏是一句提示词、反馈是"让 LLM 自查"），后者将关键循环隐藏在框架内部，使开发者丧失对治理、反馈、安全的控制权。

**CodeHarness** 要回答的工程问题是：**Agent = LLM + Harness 中的 Harness 层究竟该长什么样——而且必须用代码（而非提示词）来回答。**

### 1.2 目标用户

- 想要理解 coding agent 内部机制的学生和开发者
- 需要在受限环境（本地、无网、容器）中运行可审计 coding agent 的团队
- 对现有 agent 框架的"黑盒"不满、想要一个透明、可测试、可注入 mock 的替代方案

### 1.3 为什么值得做

市面上没有一个 coding agent harness 能做到"移除真实 LLM 后核心机制仍可确定性验证"。CodeHarness 填补这个空白：所有机制（工具分发、治理拦截、反馈回灌、记忆读写、停机判断）在 mock/stub LLM 下仍能用单元测试验证——这既是课程 §A.4-C 的硬性判据，也是一个有实际工程价值的差异化定位。

---

## 二、用户故事

| # | 用户故事 | INVEST 维度 |
|---|---------|------------|
| 1 | 作为一个开发者，我可以在终端中输入一个 coding task，让 CodeHarness 自动读取项目文件、搜索相关代码、生成修改，并通过 lint/typecheck/test 的反馈自动修正，直到 task 完成。 | Independent, Valuable |
| 2 | 作为一个安全运维人员，当 agent 试图执行 `rm -rf /` 或 `git push --force main` 时，我看到一个拦截提示，并可以选择批准（可能带修改）、拒绝或让它自动被阻止。 | Independent, Valuable |
| 3 | 作为一个开发者，我可以在一台新机器上通过 `npm install -g codeharness` 或 `docker run` 启动项目，首次运行时会引导我安全录入 API Key（隐藏输入），Key 存入系统 keychain 或加密文件，绝不以明文落地磁盘。 | Independent, Valuable |
| 4 | 作为一个想验证 agent 机制的贡献者，我可以在不联网、不消耗真实 API 调用的情况下，用 mock LLM 运行全套单元测试，验证护栏拦截危险命令、反馈闭环驱动自我修正、主循环停机判断等行为是确定性的。 | Independent, Testable |
| 5 | 作为一个在本地 IDE 中工作的开发者，当 agent 修改代码后连续 3 轮都修不好同一个类型错误时，我能看到 agent 暂停并请求人工介入（HITL），而不是无限循环消耗 token。 | Negotiable, Valuable |

---

## 三、功能规约

### 3.1 Agent 主循环

**输入**: 用户 task 描述（字符串）

**行为**: 
```
while (not done) {
  1. 构建上下文: memory + config + tools + messages
  2. 调用 LLM 获取下一步动作
  3. 解析 LLM 输出为 Action（工具名 + 参数）
  4. 护栏检查: PatternGuard → ScopeFence → HITL
  5. 执行工具，获取 ToolResult
  6. 反馈闭环: ActionClassifier → ValidatorSelector → ValidatorChain → FailureClassifier → Strategy
  7. 若反馈失败: 将 FeedbackResult 回灌给 LLM，进入下一轮修正
  8. 若反馈通过: 停机判断（task 是否完成？）
}
```

**输出**: 会话完成状态 + 所有 messages

**边界条件**: 
- LLM 输出无法解析 → `parse_error` 反馈，LLM 重试格式修正
- 工具执行超时 → `timeout` 失败类别，触发 `split_task` 策略
- 达到 `maxRounds` → 升级为 HITL

**错误处理**: 
- 所有异常被捕获并转化为结构化 FeedbackResult，不中断主循环
- 不可恢复错误（如 API Key 无效）→ 终止并报告

### 3.2 工具系统

7 个工具，输入/输出/错误处理见下表：

| 工具 | 输入 | 行为 | 输出 | 边界条件 | 错误处理 |
|------|------|------|------|---------|---------|
| `list_directory` | path (string), recursive? (bool) | 列出目录内容 | `{entries: {name, type, size}[]}` | 路径必须在 workspaceRoot 内 | 路径不存在 → ToolResult.error |
| `search_content` | pattern (string), path? (string), glob? (string) | 用 ripgrep 库搜索代码 | `{matches: {file, line, content}[]}` | 限制搜索在 workspaceRoot 内 | 无匹配 → 空数组 |
| `read_file` | paths (string[]) | 读取文件内容 | `{files: {path, content, lineCount}[]}` | 路径必须在 workspaceRoot 内 | 文件不存在 → 跳过该文件并在结果中标明 |
| `write_file` | path (string), content (string) | 全量覆写文件 | `{bytesWritten, path}` | 路径必须在 workspaceRoot 内 | 写入失败 → ToolResult.error |
| `edit_file` | path (string), oldString (string), newString (string) | 精确字符串替换 | `{path, replaced, bytesWritten}` | 路径必须在 workspaceRoot 内；oldString 必须在文件中唯一匹配 | 不唯一匹配 → ToolResult.error 含"oldString not unique" |
| `run_shell` | command (string), timeout? (number) | 在 workspaceRoot 内执行 shell | `{stdout, stderr, exitCode, duration_ms}` | cwd 锁定为 workspaceRoot；env 白名单过滤；命令须过护栏 | 超时 → 返回 exitCode=null + duration_ms=timeout |
| `run_test` | pattern? (string) | 语法糖：`npx vitest run <pattern>` + 结构化解析 | `{passed: bool, results: {name, status, duration}[]}` | 同 run_shell | 测试框架未安装 → ToolResult.error 含提示 |

### 3.3 反馈闭环（主力维度）

**层 1: ActionClassifier**

| 动作类型 | 判定规则 |
|---------|---------|
| `file_write` | write_file 或 edit_file 涉及 `.ts`/`.js`/`.json`/`.tsx`/`.jsx` 文件 |
| `file_read` | read_file、list_directory、search_content |
| `shell_command` | run_shell 执行了非 test/typecheck/lint 模式的命令 |
| `test_run` | run_shell 执行了匹配 `vitest\|jest\|npm test` 的命令；或直接调用 run_test |
| `typecheck_run` | run_shell 执行了 `tsc` |
| `parse_error` | LLM 输出无法解析为有效 Action |

**层 2: ValidatorSelector**

| 动作类型 | 选中校验器 | 模式 |
|---------|-----------|------|
| `file_write` | eslint → tsc | 按全局 `validatorMode`（fail_fast 或 collect_all） |
| `test_run` | exitCodeParser + testResultParser | fail_fast |
| `shell_command` | exitCodeParser + stderrChecker | fail_fast |
| `typecheck_run` | exitCodeParser + tscOutputParser | fail_fast |
| `file_read` | 无 | — |
| `parse_error` | formatChecker | fail_fast |

**层 3: ValidatorChain**

按顺序执行校验器，`fail_fast` 模式下第一个失败即停，`collect_all` 模式收集所有失败后统一返回。每个校验器是实现 `Validator` 接口的类。

**层 4: FailureClassifier + StrategyMatcher**

| 失败类别 | 判定规则 | 修正策略 |
|---------|---------|---------|
| `syntax` | eslint error | `auto_fix`: 回灌文件名+行号+规则+修复建议 |
| `type` | tsc error | `targeted_fix`: 回灌完整类型错误+类型上下文 |
| `logic` | test assertion failed | `logic_fix`: 回灌 expected vs actual diff |
| `command` | stderr 非空 或 exitCode ≠ 0 | `command_fix`: 回灌 stderr + 建议 |
| `timeout` | 执行超过超时阈值 | `split_task`: 回灌超时信息 + 拆分建议 |
| `parse_error` | LLM 输出格式错误 | `format_retry`: 回灌原始输出 + 期望格式 |

**层 5: 多轮修正 + 升级路径**

```
同一 task:
  Round 1 → LLM 首次尝试
  Round 2 → 反馈失败 → 回灌 FeedbackResult（默认策略）→ LLM 重试
  Round 3 → 再次失败 → 换策略（更详细的上下文）→ LLM 重试
  Round 4 (maxRounds+1) → 升级 → 暂停，HITL 请求人工介入
```

轮次计数、策略切换、升级判断——全部确定性代码。

### 3.4 治理护栏

**第 1 层: PatternGuard**

| 级别 | 模式 | 示例 |
|------|------|------|
| **block** | 递归删除 | `rm -rf /`, `rm -rf --no-preserve-root`, `del /f /s /q C:\`, `rmdir /s /q` |
| **block** | 磁盘级破坏 | `dd`, `mkfs` |
| **block** | 系统关机 | `shutdown`, `reboot`, `halt` |
| **block** | 保护分支 force push | `git push --force origin main/master` |
| **block** | 破坏 reflog | `git reflog expire` + `git gc --prune` |
| **block** | 管道到 shell | `curl ... \| sh`, `curl ... \| bash`, `wget ... \| sh` |
| **block** | 反向 shell 工具 | `nc`（netcat） |
| **warn** | force push（非保护分支） | `git push --force` |
| **warn** | 不可恢复清理 | `git clean -fdx` |
| **warn** | 丢弃未提交修改 | `git checkout -- .`, `git reset --hard` |
| **warn** | 重写历史 | `git filter-branch` |
| **warn** | 系统文件权限修改 | `chmod 777` 或 `chown` 作用域包含 `/etc`, `/usr` |
| **warn** | 提权 | `sudo`, `su` |
| **warn** | 系统服务修改 | `crontab`, `systemctl` |
| **warn** | 强制杀进程 | `kill -9` |
| **warn** | 外发网络请求 | `curl`, `wget` 到非白名单域名 |
| **warn** | 全局包安装 | `npm install -g`, `pip install`（非 `--user`） |
| **warn** | SSH/SCP 到外部 | `ssh`, `scp` 到非本地或非白名单主机 |
| **warn** | Docker 破坏性操作 | `docker rm -f`, `docker system prune` |
| **warn** | 数据库破坏操作 | `DROP TABLE`, `DROP DATABASE`, `TRUNCATE` |

**第 2 层: ScopeFence**

- 文件操作路径必须解析后前缀匹配 `workspaceRoot`
- shell `cwd` 锁定为 `workspaceRoot`
- 环境变量白名单透传（阻止注入凭据）

**第 3 层: HITL 状态机**

```
IDLE → AWAITING_APPROVAL（warn 触发）
  ├─ 用户批准 → EXECUTING
  ├─ 用户批准带修改 → EXECUTING_MODIFIED
  └─ 用户拒绝 → BLOCKED（通知 LLM）
无超时，无限等待。
```

### 3.5 记忆系统

| 层 | 作用域 | 存储位置 | 加载策略 |
|----|--------|---------|---------|
| 会话 | 单次运行 | 内存 `messages[]` | 上下文窗口管理：最近 8 轮全文 + 更早轮次摘要 + `important` 消息永不压缩 |
| 项目 | 跨会话 | `.harness/conventions.md`, `decisions.md`, `known_issues.md` | 启动时全量注入 system prompt |
| 用户 | 跨项目 | `~/.codeharness/preferences.md` | 启动时全量注入 system prompt |

上下文窗口管理：当 `messages[]` token 估算达到 80% 窗口阈值时触发压缩。估算用简单的字符数/4 近似（确定性算法）。压缩只作用于非 important、超过 8 轮的消息。

### 3.6 配置系统

三层覆盖：`~/.codeharness/config.json` → `.codeharness.json`（项目根） → CLI 参数

完整配置项见第九节（数据模型）。配置不包含 API Key——Key 走独立凭据通道。

### 3.7 凭据管理

后端优先级链：`keytar (系统 keychain) → 加密文件 (AES-256-GCM) → 环境变量`

- **keytar**: Windows Credential Manager / macOS Keychain / Linux libsecret
- **加密文件**: `~/.codeharness/secrets.enc`，PBKDF2 密钥派生 + AES-256-GCM 加密，主密码保护
- **环境变量**: `CODEHARNESS_API_KEY`（明文风险，用户需显式选择）

`get()` 返回 `SecureHandle` 而非裸 string，通过闭包限制 key 传播范围。ESLint 禁止日志中出现 Bearer token。

---

## 四、非功能性需求

### 4.1 性能

- Agent 单轮响应 ≤ 2 秒（不含 LLM API 调用耗时）
- 工具执行延迟 ≤ 原生操作 + 50ms（工具层开销）
- 上下文窗口 token 估算延迟 ≤ 1ms
- WebUI WebSocket 消息推送延迟 ≤ 100ms

### 4.2 安全（凭据威胁模型）

| 威胁 | 对策 |
|------|------|
| Key 写入 Git/文件 | Key 从不存在文件或环境变量中（默认用 keytar）；`.gitignore` 排除 `.env`、`secrets/`、`*.cred` |
| `.env` 文件泄露 | 默认不读 `.env`，需用户显式设置 `apiKeySource: 'env'` 才读 |
| shell history 泄露 | Key 从不在命令行中传递；隐藏输入 |
| 日志/终端泄露 | 查看状态只显示脱敏后 4 位；`SecureHandle` 闭包限制传播；ESLint 禁止日志输出 Bearer |
| 进程内存 dump | 需要时才 `get()`，用完尽快离开闭包作用域；无法完全防御（记录为已知风险） |
| 加密文件被盗 | PBKDF2 100k 迭代防暴力破解 |
| Master password 遗忘 | 无恢复机制；`codeharness key reset` 清除后重录 |
| keytar 后端不可用 | 自动降级到加密文件后端 |
| 传输层 | 所有 LLM API 调用强制 HTTPS |

### 4.3 可用性

- 首次运行零配置引导（隐藏输入 → 自动存储）
- CLI 错误信息包含可操作的建议
- `codeharness key status` 显示脱敏状态，不回显明文

### 4.4 可观测性

- 每个工具调用记录耗时、输入摘要、输出摘要
- 反馈闭环每步记录校验器名 + 结果 + 耗时
- 护栏触发记录匹配的规则 + 用户决策
- WebUI 实时展示消息流中的工具调用可展开查看详情

---

## 五、系统架构

### 5.1 组件图

```
┌─────────────────────────────────────────────────────────┐
│                     CLI (commander)                     │
│  start | key status | key reset | config show           │
├─────────────────────────────────────────────────────────┤
│                    WebUI (Express + WS)                 │
│  Dashboard | Session Detail | Settings                  │
├─────────────────────────────────────────────────────────┤
│                   Agent Core                            │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐              │
│  │MainLoop │  │Guardrail │  │ Feedback   │              │
│  │(while)  │  │(3-layer) │  │(5-layer)   │              │
│  └────┬────┘  └────┬─────┘  └─────┬──────┘              │
│       │            │              │                     │
│  ┌────┴────────────┴──────────────┴──────┐              │
│  │           LLMProvider (interface)       │            │
│  │  ├─ DeepSeekProvider (real, OpenAI SDK) │            │
│  │  └─ MockProvider (stub, deterministic)  │            │
│  └────────────────────────────────────────┘             │
├─────────────────────────────────────────────────────────┤
│  ┌────────┐  ┌────────┐  ┌──────────────────┐           │
│  │ Tools  │  │ Memory │  │ CredentialStore  │           │
│  │(7 pcs) │  │(3-tier)│  │ (3-backend chain)│           │
│  └────────┘  └────────┘  └──────────────────┘           │
├─────────────────────────────────────────────────────────┤
│  ┌──────────┐                                           │
│  │  Config  │  (3-layer overlay)                        │
│  └──────────┘                                           │
└─────────────────────────────────────────────────────────┘
```

### 5.2 数据流

```
User Task → Config.load() → Memory.load() → MainLoop.start()
  → LLM.complete(prompt) → parse(response) → Action
  → Guardrail.check(action) → [blocked|approved|awaiting_hitl]
  → Tool.execute(action) → ToolResult
  → Feedback.verify(action, result)
    → ActionClassifier.classify(action)
    → ValidatorSelector.select(type) → [...validators]
    → ValidatorChain.run(validators) → [Pass|Fail]
    → FailureClassifier.classify(fail) → category
    → StrategyMatcher.match(category) → strategy
  → if failed: push FeedbackResult to messages → loop (round++)
  → if passed: TerminationCheck → [done|continue]
```

### 5.3 外部依赖

| 依赖 | 用途 | 类型 |
|------|------|------|
| DeepSeek API (OpenAI 兼容) | LLM 推理 | 运行时 HTTP |
| keytar | 系统 keychain 访问 | 运行时 native |
| ripgrep (npm `@rg` 或 child_process) | 代码搜索 | 工具层 |
| Node.js `crypto` | AES-256-GCM 加密 | 标准库 |
| Node.js `child_process` | shell 执行 | 标准库 |
| Node.js `fs` | 文件读写 | 标准库 |
| Open Design 桌面应用 | UI 设计 token 与组件 spec 导出 | 开发工具（非运行时依赖） |
| Vite + React + shadcn/ui | WebUI 前端构建 | 开发依赖 |
| Express + ws | WebUI 后端 | 运行时 HTTP/WS |

---

## 六、数据模型

### 6.1 Config

```typescript
interface Config {
  llm: {
    provider: string;           // 'deepseek' | 'openai'
    baseUrl: string;            // API endpoint
    model: string;              // 'deepseek-chat'
    maxTokens: number;          // default 4096
    apiKeySource: 'keytar' | 'encrypted_file' | 'env';
    apiKeyService: string;      // 'codeharness/deepseek'
  };
  agent: {
    maxRounds: number;          // default 0 (unlimited, mirroring Claude Code --max-turns); set a number to cap
    contextThreshold: number;   // 0.8 (80% window → compress)
    workspaceRoot: string;
  };
  feedback: {
    validatorMode: 'fail_fast' | 'collect_all';
    validators: {
      eslint:    { enabled: boolean };
      tsc:       { enabled: boolean };
      testRunner:{ enabled: boolean };
      shellCheck:{ enabled: boolean };
    };
  };
  guardrail: {
    allowlist: string[];
    blocklist: string[];
    warnlist: string[];
    downgrade: Record<string, 'allow'>;
  };
  shell: {
    timeoutSeconds: number;     // default 60
  };
  memory: {
    projectPath: string;        // default '.harness/'
    userPath: string;           // default '~/.codeharness/'
  };
  webui: {
    port: number;               // default 3000
    token?: string;             // auth token for remote deployment
  };
}
```

### 6.2 Session

```typescript
interface Session {
  id: string;                   // uuid
  task: string;                 // user task description
  status: 'running' | 'paused' | 'completed' | 'failed';
  maxRounds: number;
  currentRound: number;
  messages: Message[];
  tokenCount: number;           // estimated
  createdAt: string;             // ISO 8601
  updatedAt: string;             // ISO 8601
}
```

### 6.3 Message

```typescript
interface Message {
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
  timestamp: string;            // ISO 8601
}
```

### 6.4 ToolResult

```typescript
interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  duration_ms: number;
  filesChanged?: string[];
  exitCode?: number;
}
```

### 6.5 FeedbackResult

```typescript
interface FeedbackResult {
  passed: boolean;
  validator: string;
  failureCategory?: 'syntax' | 'type' | 'logic' | 'command' | 'timeout' | 'parse_error';
  strategy?: 'auto_fix' | 'targeted_fix' | 'logic_fix' | 'command_fix' | 'split_task' | 'format_retry';
  evidence: string;
  details?: {
    file?: string;
    line?: number;
    expected?: string;
    actual?: string;
    rule?: string;
  }[];
}
```

---

## 七、技术选型与理由

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 编程语言 | TypeScript | 接口抽象天然契合 mock/real 切换（核心判据 §A.4-C）；CI 模板已预配 Node.js；同语言覆盖 CLI + WebUI；生态成熟 |
| LLM 供应商 | DeepSeek (OpenAI 兼容协议) | 国内可直接充值；API 兼容 OpenAI 格式，更换供应商只需改 baseURL；tool calling 可用 |
| LLM SDK | OpenAI Node.js SDK | 兼容大多数国内供应商；TypeScript 一等支持；也可直接接 Anthropic SDK 扩展 |
| CLI 框架 | commander | 轻量、生态标准 |
| 测试框架 | vitest | 快、TypeScript 原生支持、mock 注入方便 |
| 凭据存储 | keytar + 加密文件 fallback | keytar 一个 API 绑三平台；纯 JS 用户可降级到加密文件；环境变量为最后兜底 |
| 分发 | npm + Docker | npm 对 TS 项目最自然；Docker 提供零依赖备选 |
| WebUI | React + Vite + shadcn/ui + Monaco Editor | 全功能控制台；Monaco 提供代码 diff 视图；shadcn/ui 轻量；同语言减少心智开销 |
| 设计系统 | Open Design（桌面应用） | 使用 Open Design 桌面应用可视化设计 Dashboard/SessionDetail/Settings 三页的 UI 布局、颜色和组件 spec；导出设计 token 文件（`design-tokens.ts`）作为 agent 生成 React 代码的约束来源；shadcn/ui 作为组件实现层 |

---

## 八、凭据与分发设计

### 8.1 Key 存储方案

见 §3.7。`apiKeySource` 默认 `keytar`，不可用时自动探测加密文件后端。加密文件后端在 Docker 中为默认后端。

### 8.2 首次运行引导

```
$ codeharness start
  No API key found for deepseek.
  Enter API key: ******           # 隐藏输入
  Confirm: ******
  ✓ Saved to Windows Credential Manager
```

### 8.3 查看/更新/清除

```
$ codeharness key status          # 显示脱敏状态
$ codeharness key update          # 覆写
$ codeharness key reset           # 清除所有 key
```

### 8.4 分发形态

**npm**: `npm install -g codeharness` → `codeharness start`
**Docker**: `docker pull ghcr.io/<user>/codeharness:latest` → `docker run -it ...`

CI 中 `docker build` 作为验证步骤，git tag 触发自动 push 到 GHCR。

### 8.5 Key 在目标机上的安全配置

| 分发形态 | 配置方式 |
|---------|---------|
| npm | 首次运行引导 → keytar（优先）或加密文件（fallback，keytar 编译失败时） |
| Docker | 首次运行引导 → 加密文件（唯一可用后端，容器内无系统 keychain） |

---

## 九、验收标准

| 功能 | 验收标准 |
|------|---------|
| Agent 主循环 | 输入 task → agent 自主完成"探索→搜索→读写→执行→验证"闭环 → 结果正确 |
| 工具系统 | 7 个工具全部可通过 mock LLM 测试独立验证 |
| 反馈闭环 | Mock LLM 注入"总是类型错误" → 3 轮后自动升级；注入 parse_error → 触发 format_retry |
| 治理护栏 | Mock 直接构造 `Action(command="rm -rf /")` → PatternGuard 返回 block；构造 `git push --force main` → block |
| HITL | Mock 触发 warn → 用户通过 WebUI 内联审批卡片批准/修改/拒绝 |
| 凭据安全 | `key status` 不回显明文；key 不作为文件落地；`.gitignore` 排除所有凭据路径 |
| 分发 | `npm install -g` 后可运行；`docker build && docker run` 后可运行 |
| 上下文管理 | messages 超过 80% 窗口阈值 → 压缩触发，important 消息不被压缩 |
| CI | `npm test` 一键运行全部单测（含 mock-LLM 测试），GitHub Actions `unit-test` job 通过 |
| WebUI | `codeharness start --web` → 浏览器访问 Dashboard → 创建会话 → 实时观察 agent 消息流 |
| 机制演示 | §A.6 三项演示：护栏拦截、反馈闭环驱动修正、主力维度行为——全部在 mock LLM 下确定性复现 |

---

## 十、风险与未决问题

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| keytar native 编译在 Windows 用户机器上失败 | npm 安装体验差 | 自动降级到加密文件后端；Docker 不走 keytar |
| DeepSeek tool calling 在复杂场景下不够可靠 | LLM 输出格式异常 | parse_error 反馈路径覆盖格式异常；可切换供应商 |
| 上下文压缩中 LLM 生成的摘要丢失关键信息 | agent 行为偏离 | `important` 标记机制；确定性压缩策略作为 fallback |
| 上下文 token 估算用字符数/4 不够精确 | 可能过早或过晚触发压缩 | 与真实 tokenizer（tiktoken）对比校准后调整系数 |
| 项目记忆文件随迭代膨胀 | 全量加载可能超过上下文容量 | 目前数据量小有界；未来可加入摘要或检索 |
| 加密文件主密码遗忘 | 密码不可恢复 | 文档明确告知无恢复机制；`key reset` 清除后重来 |
| WebUI 在 Render/Railway 免费额度下的稳定性 | 线上 URL 可能不可访问 | 提供 Docker 镜像作为本地验证备选 |
| **不同 agent 使用自身默认值覆盖未约定项** | 分支名、.gitignore 内容、import 风格等隐性约定在新 agent 上不成立 | **已通过冷启动验证确认**；§十二将基础约定显式化 |

### 未决问题

1. **LLM 供应商切换的配置体验**：如何在首次运行时自动探测可用的供应商？（当前设计需要用户手动编辑配置）
2. **eslint/tsc 作为反馈校验器的前提**：项目必须预装这些工具。是否在 agent 启动时自动检测并跳过不可用的校验器？
3. **多 agent 编排**：作为扩展方向，但不在最低实现范围内。

---

## 十一、领域与机制设计

### 11.1 领域分析

Coding 领域的特点决定了四类机制的具体形态：

| 机制 | Coding 领域的特殊性 |
|------|-------------------|
| **反馈信号** | 编译器/测试/linter 提供客观、确定、可自动获取的信号——coding 相较于其他 agent 领域的独特优势 |
| **危险动作** | 文件系统和 shell 的破坏性操作有已知、可枚举的清单——不需 LLM 做语义判断 |
| **工具** | 操作对象是代码文件，有明确的结构化输入输出——不需处理物理世界不确定性 |
| **记忆** | 项目级约定和决策，数据量小有界——不需复杂检索系统 |

### 11.2 四类机制

详见 §3.2（工具）、§3.3（反馈）、§3.4（治理）、§3.5（记忆）。

### 11.3 主力维度：反馈闭环

选择理由：
1. Coding 领域的天然优势：编译器/测试/linter 的反馈是客观且可自动获取的
2. 天然由代码构成：校验器选择、失败分类、策略匹配、轮次控制——全部确定性逻辑
3. 区分度最高：提示词只能"请 LLM 自查"；编码的反馈系统能做到"tsc 报错就是失败，3 轮修不好就升级"
4. Mock 测试最顺手：注入"总是返回类型错误的 mock 响应"→ 全链路确定性验证

### 11.4 各维度最低实现

| 维度 | 最低实现 |
|------|---------|
| 工具 | 7 个 Tool 接口实现 + 注册表 |
| 记忆 | 三层全量加载 + 上下文窗口管理 |
| 治理 | 18 条模式匹配 + ScopeFence + HITL 状态机 |
| 配置 | 三层覆盖 + 配置对象合并 |
| 决策封装 | 主循环 `while(!done)` + 停机判断 |
| 反馈闭环（深入） | 五层全量实现：ActionClassifier + ValidatorSelector + ValidatorChain + FailureClassifier + 多轮修正/升级 |

---

## 十二、项目约定与基线配置

> 本节为冷启动验证后新增——确保任何新 agent 仅凭 SPEC + PLAN 即可做出一致的基础决策。

### 12.1 基础约定

| 约定项 | 选择 | 理由 |
|--------|------|------|
| Git 分支名 | `master` | CI 和 worktree 派发均以此为默认分支 |
| 接口定义点 | `src/types.ts` 为所有共享接口的**唯一定义点** | 其他模块（如 `provider.ts`）从 `types.ts` import，不做二次定义或 re-export |
| 模块解析 | `NodeNext`（ESM） | import 路径须带 `.js` 扩展名，但指向 `.ts` 源文件 |
| 包管理器 | npm | CI 用 `npm ci`，本地用 `npm install` |

### 12.2 `.gitignore` 基线

新 agent 启动时必须创建完整的 `.gitignore`，不得依赖 agent 自身训练数据自行补充。最小基线内容：

```
# 凭据与密钥文件 —— 绝对不提交
.env
.env.*
*.pem
*.key
*.p12
*.pfx
secrets/
/credentials/
*.cred
*_credentials.*

# 操作系统
.DS_Store
Thumbs.db
Desktop.ini

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# 依赖目录
node_modules/

# 构建产物
dist/
build/

# 日志
*.log
logs/

# 临时文件
*.tmp
.cache/
```

此基线不需要 agent 添加额外条目；如需补充，由人工 reviewer 在 PR 评审时决定。

---

## 十三、代码结构（预览）

```
src/
  core/
    main-loop.ts              # Agent 主循环
    termination.ts            # 停机判断
  llm/
    provider.ts               # LLMProvider 接口
    deepseek-provider.ts      # DeepSeek 实现
    mock-provider.ts          # Mock 实现（测试用）
  tools/
    tool.ts                   # Tool 接口 + 注册表
    list-directory.ts
    search-content.ts
    read-file.ts
    write-file.ts
    edit-file.ts
    run-shell.ts
    run-test.ts
  feedback/                   # 主力维度
    action-classifier.ts
    validator-selector.ts
    validator-chain.ts
    validators/
      eslint-validator.ts
      tsc-validator.ts
      test-result-validator.ts
      shell-check-validator.ts
      format-validator.ts
    failure-classifier.ts
    strategy-matcher.ts
    round-manager.ts
  guardrail/
    pattern-guard.ts
    scope-fence.ts
    hitl-manager.ts
  memory/
    session-memory.ts
    project-memory.ts
    user-memory.ts
    context-compressor.ts
  config/
    loader.ts
    schema.ts
  credentials/
    store.ts                  # CredentialStore（三条后端链）
    backends/
      keytar-backend.ts
      encrypted-file-backend.ts
      env-backend.ts
    secure-handle.ts
  webui/
    server.ts                 # Express + WS
    client/                   # React SPA
      src/
        design-tokens.ts      # Open Design 导出的设计 token（颜色、间距、字体、组件 spec）
  cli/
    index.ts                  # CLI 入口（commander）
  events.ts                    # EventEmitter（harness→WebUI 桥接）

tests/
  unit/
    feedback/                 # 反馈闭环单测（mock LLM）
    guardrail/                # 护栏单测（mock LLM）
    tools/                    # 工具单测
    memory/                   # 记忆单测
    llm/                      # LLMProvider 接口单测
  integration/
    main-loop.test.ts         # 集成测试（mock LLM）
    demo/                     # §A.6 机制演示
      guardrail-demo.test.ts
      feedback-demo.test.ts
      deep-dimension-demo.test.ts
```