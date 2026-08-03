# AGENT_LOG — CodeHarness 开发过程记录

---

## 2026-07-28 13:50 Task 1：项目脚手架 + 核心类型 + 事件系统

- **触发技能**：`using-git-worktrees`, `test-driven-development`, `requesting-code-review`
- **Subagent**：主 agent 直接执行（Task 1 为基础设施任务，无需 subagent）
- **Prompt 要点**：按 PLAN.md Task 1 的 8 个步骤执行；TDD 只对 `events.ts` 适用（配置文件 TDD 豁免）；遵循 SPEC §12.1-12.2 的基础约定和 `.gitignore` 基线
- **产出**：
  - Commit: `6995d56`（初始），`281c246`（CR 修复）
  - 涉及文件: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/types.ts`, `src/events.ts`, `tests/unit/events.test.ts`, `.github/workflows/ci.yml`
  - 测试: 3/3 passing, `tsc --noEmit` clean
- **人工干预**：
  - 代码评审发现 C1（SPEC Date→string）——SPEC §6.2/§6.3 改为 ISO 8601 `string`，因为 harness 所有 IO 都是 JSON
  - 代码评审发现 C2（`.gitignore` 含基线外条目）——清理 `__pycache__/`, `*.pyc`, `venv/`, `target/`, 二进制通配符等
  - SPEC main 分支同步修改（Date→string 类型变更）
- **教训**：
  - 配置文件（package.json, tsconfig 等）TDD 豁免是正确的，但应在 AGENT_LOG 中记录豁免原因
  - 类型定义（`types.ts`）作为纯接口文件，没有可测逻辑——但它的正确性由 `tsc --noEmit` 验证
  - PLAN Step 5（写实现）在 Step 6（写测试）之前的排序问题——后续 task 应修正为先测试后实现
  - CR 评审 subagent 发现了 SPEC 和实现之间的 `Date` vs `string` 不一致——spec 写 `Date` 但在 JSON 场景下不合理。说明在写 SPEC 时就应考虑序列化格式

---

## 2026-07-28 15:04 Task 2：LLMProvider 接口 + MockProvider

- **触发技能**：`using-git-worktrees`, `subagent-driven-development`, `requesting-code-review`
- **Subagent**：`a6a57567`（general-purpose，独立执行 TDD 红→绿→重构）
- **Prompt 要点**：按 CLAUDE.md §2 模板派发；明确 `provider.ts` 不做 re-export；要求 subagent 自行完成 TDD 循环并返回 commit hash
- **产出**：
  - Commit: `3ff7841`
  - 涉及文件: `src/llm/provider.ts`, `src/llm/mock-provider.ts`, `tests/unit/llm/mock-provider.test.ts`
  - 测试: 4/4 passing（+ 预存 3 events = 7 total）, `tsc --noEmit` clean
- **人工干预**：无（subagent 独立完成 TDD + commit）
- **教训**：
  - Subagent 在 RED 阶段自行发现了 import 路径错误并修正——TDD 的价值：运行测试暴露路径问题而非假设正确
  - `provider.ts` 为"准残留文件"——CR 评审指出它只有 import+注释，后续 task 需明确其定位价值或移除
  - Subagent 单 commit 缺少独立 RED commit——后续派发 prompt 应要求"至少两个 commit"
  - MockProvider 忽略 `_tools` 正确，但 Task 3 DeepSeekProvider 需处理 `Tool.execute` 无法 JSON 序列化的问题

---

## 2026-07-28 15:16 Task 3：DeepSeekProvider

- **触发技能**：`subagent-driven-development`, `requesting-code-review`
- **Subagent**：`a3641485`（general-purpose，要求 RED+GREEN 两个独立 commit）
- **Prompt 要点**：使用 `vi.mock('openai')` 模拟 SDK，零网络调用；排除 `Tool.execute` 等不可序列化字段；构造函数接收配置对象而非硬编码
- **产出**：
  - Commits: `89dd56d`（RED，327行测试文件，implementation不存在）→ `ffab869`（GREEN，62行实现）
  - 涉及文件: `src/llm/deepseek-provider.ts`, `tests/unit/llm/deepseek-provider.test.ts`
  - 测试: 11/11 passing（累计 18/18, tsc clean）
- **人工干预**：无
- **教训**：
  - 首次成功的独立 RED+GREEN commit 模式——Task 2 反馈的改进在此 task 落地
  - `vi.mock('openai')` 提供了完整的 SDK mock 能力：消息格式化、工具格式化、tool_calls 解析均通过 mock 返回值验证
  - CR 评审指出 MINOR：`JSON.parse(tc.function.arguments)` 无 try/catch 保护——若 DeepSeek 返回畸形 JSON 会导致未捕获异常。但依赖 OpenAI function-calling 契约保证合理性，暂缓修复
  - CR 评审指出 `as OpenAI.Chat.Completions.ChatCompletionMessageParam[]` 类型断言绕过了 TS 检查——实用但值一个注释说明安全性

---

## 2026-07-28 15:40 Task 4：Tool 接口 + 只读工具

- **触发技能**：`subagent-driven-development`, `requesting-code-review`
- **Subagent**：`a0d3b997`（general-purpose，要求 4 RED+4 GREEN 独立 commit）
- **Prompt 要点**：3 个只读工具（list_directory, search_content, read_file）+ ToolRegistry；所有路径强制 workspaceRoot 边界；ToolResult 包含 duration_ms
- **产出**：
  - Commits: 8 个（4 RED + 4 GREEN）+ `77c77f9`（主 agent CR 修复）
  - 涉及文件: `src/tools/tool.ts`, `src/tools/fs-utils.ts`, `src/tools/list-directory.ts`, `src/tools/search-content.ts`, `src/tools/read-file.ts` + 4 个测试文件
  - 测试: 26 new tests（5+7+7+7）+ 18 existing = 45 passing, tsc clean
- **人工干预**：CR 评审发现 1 CRITICAL + 3 IMPORTANT，由主 agent 修复
- **教训**：
  - Subagent commit message 仍缺少 `— by subagent [ID]` 格式——后续需在 prompt 第一条强制要求
  - SPEC §3.2 read_file "跳过该文件并在结果中标明" 是精确规约——subagent 实现成短路失败，恰证明 CR 价值
  - `filesChanged` 被 subagent 错误填入 read_file——说明需在 SPEC 中标注"仅写操作填充"

---

## 2026-07-28 16:05 Task 5：写入 + 执行工具

- **触发技能**：`subagent-driven-development`, `requesting-code-review`
- **Subagent**：`a2a40dec`（general-purpose，commit message 格式置为 prompt 第一条但仍未完全遵循）
- **Prompt 要点**：4 个工具（write_file, edit_file, run_shell, run_test）；要求 4 RED+4 GREEN；强制要求 commit message 含 `— by subagent [ID]`
- **产出**：
  - Commits: 8 个（4 RED + 4 GREEN）+ `05d15a6`（主 agent CR 修复）
  - 涉及文件: 4 source + 1 shared (env-utils.ts) + 4 test files
  - 测试: 34 new tests + 45 existing = 79 passing, tsc clean
- **人工干预**：CR 评审 2 IMPORTANT，由主 agent 修复
- **教训**：
  - Subagent prompt 第一条是 commit message 格式要求，但仍未遵守——后续考虑在 CLAUDE.md 全局约束中再强化
  - run_test 结构化解析（SPEC §3.2 要求的 `{passed, results[]}`）是 SPEC 的精确规约——subagent 只做了 raw pass-through
  - env-utils 提取模式已成惯例：fs-utils（Task 4 CR）+ env-utils（Task 5 CR）→ 后续 task 直接遵循

---

## 2026-07-28 16:43 Task 6：配置系统

- **触发技能**：`subagent-driven-development`, `requesting-code-review`
- **Subagent**：`aa96a264`（general-purpose，commit `7bb8aff` — 首次正确使用 `— by subagent da86a25a` 格式）
- **Prompt 要点**：3 层覆盖（user→project→CLI）、深度合并、API Key 不在 Config 中、DEFAULT_CONFIG 工厂函数
- **产出**：
  - Commit: `7bb8aff`
  - 涉及文件: `src/types.ts` (+Config 接口), `src/config/schema.ts`, `src/config/loader.ts`, `tests/unit/config/loader.test.ts`
  - 测试: 9/9 passing（累计 88/88, tsc clean）
- **人工干预**：无
- **教训**：
  - Subagent commit message 首次正确遵循 CLAUDE.md 格式——在前几个 phase 的反复强调后终于落实
  - `loadConfig` 将路径解析推迟给调用方（CLI 入口）——CR 评审指出这是合理的可测试性权衡，但需在 CLI task 中实现自动解析
  - `Object.freeze` + `structuredClone` 双保险模式是 immutability 的正确做法

---

## 2026-07-28 16:50 Task 7：记忆系统

- **触发技能**：`subagent-driven-development`, `requesting-code-review`
- **Subagent**：`ad189834`（general-purpose，commit `589fd06`）
- **Prompt 要点**：3 层记忆、确定性 token 估算（chars/4）、80% 阈值、最近 8 轮保留、important 豁免、项目记忆纯 fs 实现
- **产出**：
  - Commit: `589fd06`
  - 涉及文件: 4 source (context-compressor, session, project, user) + 2 test files
  - 测试: 28 new（13 compressor + 15 project-memory）+ 88 existing = 116 passing, tsc clean
- **人工干预**：无
- **教训**：
  - SessionMemory 和 UserMemory 零测试——CR 评审指出这是测试覆盖缺口。核心逻辑（Compressor + ProjectMemory）覆盖充分，但集成层无测试
  - `getMessages()` 和 `getTokenCount()` 在非 addMessage 触发的场景下有状态不一致风险——需在后续 task 中修正
  - 上下文压缩器的测试策略做对了：13 个测试覆盖 token 估算、阈值、压缩、important、不可变性——这是机制中最关键的确定性部分

---

## 2026-07-28 17:28 Task 8：PatternGuard

- **触发技能**：`subagent-driven-development`, `requesting-code-review`
- **Subagent**：`abaa0880`（RED `c2b09c3` → GREEN `076aed5`）
- **Prompt 要点**：20 种正则模式（7 block + 13 warn），全部确定性代码，不依赖 LLM
- **产出**：
  - Commits: `c2b09c3`（RED）, `076aed5`（GREEN）, `efe2106`（CR 修复）
  - 涉及文件: `src/guardrail/pattern-guard.ts`, `tests/unit/guardrail/pattern-guard.test.ts`
  - 测试: 24/24 passing（含 CR 新增 1 个边界用例）, tsc clean
- **人工干预**：CR 评审 1 CRITICAL + 2 IMPORTANT，主 agent 修复 CRITICAL：`rm` 正则锚点 `/` 为终止路径组件（`\/(?:\s|$)`），新增 `-fr` 标志序覆盖
- **教训**：
  - `rm` 正则过度匹配 `rm -rf /tmp`——缺少路径终止锚点。护栏正则需要两类测试用例：正向（应拦截）+ 负向（应放行的边界）
  - CR 评审的价值再次体现——23 个测试全部通过但存在 1 个 false-positive 缺陷

---

## 2026-07-28 17:43 Task 9：ScopeFence + HITLManager

- **触发技能**：`subagent-driven-development`, `requesting-code-review`
- **Subagent**：`a5c32469`（RED `51a8927` → GREEN `dad85c4`）
- **Prompt 要点**：ScopeFence 路径穿越防护 + 环境白名单；HITLManager 纯状态机无超时
- **产出**：
  - Commits: `51a8927`（RED）, `dad85c4`（GREEN）
  - 涉及文件: `scope-fence.ts`, `hitl-manager.ts` + 2 test files
  - 测试: 40 new（14 scope + 26 hitl）+ 103 existing = 143/143, tsc clean
- **人工干预**：无
- **教训**：
  - HITLManager 55 行纯状态机——最简单但最正确的设计。无 I/O、无 LLM、无超时
  - `validatePath` 依赖 `process.cwd()` 而非显式传入 workspaceRoot（IMPORTANT 但非缺陷——harness 保证 cwd = workspaceRoot）
  - 40 个测试中 26 个是 HITL 状态机——状态数 × 转换数 = 覆盖率的自然结果

---

## 2026-07-28 18:57 Task 10：ActionClassifier + ValidatorSelector（反馈闭环第1-2层）

- **触发技能**：`subagent-driven-development`, `requesting-code-review`
- **Subagent**：`a9fb4a4b`（RED `4cba531` → GREEN `a57970a`）
- **Prompt 要点**：5 种 ActionType 分类 + ValidatorSelector 按类型选择校验器名称列表（返回 string[] 不创建实例）
- **产出**：
  - Commits: `4cba531`（RED）, `a57970a`（GREEN）, `aca0b6f`（主 agent CR 修复）
  - 涉及文件: `action-classifier.ts`, `validator-selector.ts`, `types.ts` (+ActionType) + 2 test files
  - 测试: 33 new + 180 existing = 213/213, tsc clean
- **人工干预**：多维度 CR 评审（6 个 agent 并行）发现 3 个需修复项：
  - CRITICAL: CODE_EXTENSIONS 死代码——非代码文件被分类为 file_write，触发不必要的 eslint/tsc。修复：非代码扩展名返回 `file_read`（zero validators）
  - CONVENTION: `ActionType` 从 action-classifier.ts 移至 `types.ts`（§12.1 唯一定义点违规）
  - BUG: `TEST_PATTERN` 遗漏 `npm run test`（仅匹配 `npm test`）
- **教训**：
  - **多角度 CR 评审首次应用**——6 个 agent 并行（Altitude/Conventions/TDD invariants/language pitfalls/wrapper correctness/removed-behavior）发现 10+ 个问题，远多于单一 reviewer 模式
  - Subagent 写了 CODE_EXTENSIONS 检查但使其失效——"看起来正确 + 测试通过" ≠ 真正正确（测试缺少负向用例揭示死代码）
  - `parse_error` 在 type union 中但 ActionClassifier 永远不返回它——设计意图正确（由 LLM parser 产生），但类型系统未体现分叉路径
  - 多角度评审的噪音比：10+ findings → 3 actionable → 实际修复 3 个——其余是设计讨论或后期重构项

---

## 2026-07-28 19:16 Task 11a：ValidatorChain + EslintValidator + TscValidator

- **触发技能**：`subagent-driven-development`, `requesting-code-review`
- **Subagent**：`ad51f31a`（RED `14937f8` → GREEN `827e157`）
- **Prompt 要点**：ValidatorChain fail_fast/collect_all 双模式；EslintValidator + TscValidator 实现 Validator 接口；DI execSync 满足 §A.4-C
- **产出**：
  - Commits: `14937f8`（RED）, `827e157`（GREEN）, `239d680`（CR fix）
  - 涉及文件: 3 source + 3 test files
  - 测试: 20 new（8+6+6）+ 213 existing = 233/233, tsc clean
- **人工干预**：CR 评审 1 IMPORTANT：eslint `details` 硬编码 `files[0]`——多文件时所有错误归属到第一个文件。修复：flatMap 中携带 `filePath` 从 ESLint JSON 输出
- **教训**：
  - Subagent 的 DI（依赖注入 execSync）设计是本次最佳实践——validator 测试纯确定性，不依赖文件系统/真实工具链
  - `details` 字段是反馈管线最容易被忽略但最关键的部分——错一行代码导致 LLM 修改错误文件

---

## 2026-07-28 19:28 Task 11b：TestResultValidator + ShellCheckValidator + FormatValidator

- **触发技能**：`subagent-driven-development`, `requesting-code-review`
- **Subagent**：`a05089d5`（RED `de8a3d7` → GREEN `bc8d08f`）
- **Prompt 要点**：3 个 validator 补齐 5 个校验器；DI 模式；FormatValidator 纯代码
- **产出**：
  - Commits: `de8a3d7`（RED）, `bc8d08f`（GREEN）, `1e2d765`（CR fix）
  - 涉及文件: 3 source + 3 test files
  - 测试: 30 new + 233 existing = 263/263, tsc clean
- **人工干预**：CR 评审 1 CRITICAL：3 个 validator 的 `name` 与 ValidatorSelector key 不匹配（如 selector 用 'testResultParser' 但 validator 名为 'test-runner'）。修复：全部对齐为 selector 的 key
- **教训**：
  - Validator name ↔ selector key 的一致性应通过共享常量文件或 registry 强制执行——6 个硬编码字符串分散在 selector 和 5 个 validator 中，容易漂移
  - Task 11a 的 eslint/tsc 名字恰巧匹配（因为是 SPEC 中的原名），掩盖了这个问题——新 3 个 validator 用了不同命名风格才暴露

---

## 2026-07-28 19:39 Task 12：FailureClassifier + StrategyMatcher + RoundManager（完成反馈5层管线）

- **触发技能**：`subagent-driven-development`, `requesting-code-review`
- **Subagent**：`a61fb659`（RED `d88b0c4` → GREEN `b671b09`）
- **Prompt 要点**：6 种分类映射 + 6 种策略 + 轮次管理器（3 轮执行，第 4 轮升级）
- **产出**：
  - Commits: `d88b0c4`（RED）, `b671b09`（GREEN）, `59b328b`（CR fix）
  - 涉及文件: 3 source + `types.ts` (+FailureClassification, +Strategy types) + 3 test files
  - 测试: 19 new + 263 existing = **282/282**, tsc clean
- **人工干预**：3 项 CR fix——`failureCategory!`→运行时断言、`currentRound` private + getter、`FailureClassification`/`Strategy` 移至 `types.ts`
- **教训**：
  - 反馈闭环主力维度完成：5 层管线 × 282 tests × 0 LLM × 0 network——§A.4-C 判据得到充分证实
  - `!` 非空断言在 TS 中是隐蔽技术债——告诉编译器"相信我"但运行时无保证

---

## 2026-08-01 13:10 Task 14：CredentialBackend 实现

- **触发技能**：`subagent-driven-development`, `requesting-code-review`
- **Subagent**：`a6ab98dc`（实现完成但分类器中断无法 commit——主 agent 代完成）
- **Prompt 要点**：3 个后端（keytar/加密文件/环境变量）；AES-256-GCM + PBKDF2 100k；EnvBackend 只读
- **产出**：
  - Commit: `04bd2be`
  - 涉及文件: 4 source + 3 test files + .gitignore + SPEC.md
  - 测试: 21 new + 282 existing = 303/303, tsc clean
- **人工干预**：
  - subagent 因分类器中断无法执行 git——主 agent 代完成 commit 并标注
  - keytar mock 修复：`vi.mock('keytar')` 返回对象补 `default` 属性（CJS 模块 default import）
  - **.gitignore 基线缺陷修复**：`credentials/` → `/credentials/`——无锚点模式误伤 `src/credentials/` 源码目录（SPEC §12.2 同步修改）
- **教训**：
  - CR 评审发现 `KeytarBackend.isAvailable()` 是恒真式——static import 要么成功要么崩溃，无法检测 keytar 不可用。留待 Task 15 用动态 import 修复
  - 加密文件后端设计正确：整个 SecretMap 加密（无明文元数据），0o600 权限，GCM tag 验证错误密码

---

## 2026-08-01 14:15 Task 15：CredentialStore + SecureHandle

- **触发技能**：`subagent-driven-development`, `requesting-code-review`
- **Subagent**：`a5497084`（RED `b702ab1` → GREEN `262560a`）
- **Prompt 要点**：优先级链探测 + SecureHandle 闭包 + keytar 动态 import 修复（Task 14 CR）
- **产出**：
  - Commits: `b702ab1`（RED）, `262560a`（GREEN）, `12bd574`（主 agent CR fix）
  - 涉及文件: `secure-handle.ts`, `store.ts`, `keytar-backend.ts`（动态 import）, `types.ts` (+CredentialBackend) + 2 test files
  - 测试: 19 new + 303 existing = 324/324, tsc clean
- **人工干预**：CR 评审 2 个 IMPORTANT 修复：
  - probe 异常保护——`isAvailable()` 抛出视为不可用，继续降级（§3.7 精神）
  - `CredentialBackend` 接口移至 `types.ts`——删除 backend.ts（re-export 违反 CLAUDE.md "不做 re-export"），4 个文件 import 更新
- **教训**：
  - SecureHandle 用 `#private` 字段——`Object.keys`/`JSON.stringify`/`structuredClone` 都拿不到 key，只有闭包可达。这是 SPEC §3.7 "闭包限制传播" 的完整实现
  - 差点重蹈 Task 2 provider.ts 覆辙：最初想保留 backend.ts 做 re-export——CLAUDE.md 明确禁止，删除是最干净的
  - keytar 在 optionalDependencies 的调整留给 Task 21（分发）——动态 import 修复使 optional 化变得安全

---

## 2026-08-01 20:39 Task 13a：停机判断器

- **触发技能**：`subagent-driven-development`, `requesting-code-review`
- **Subagent**：`a8bd360f`（RED `8bb3d36` → GREEN `237cfcc`）
- **Prompt 要点**：`shouldTerminate(response, currentRound, maxRounds)`——4 条停机规则全部确定性
- **产出**：
  - Commits: `8bb3d36`（RED）, `237cfcc`（GREEN）
  - 涉及文件: `src/core/termination.ts`, `tests/unit/core/termination.test.ts`
  - 测试: 5 new + 324 existing = 329/329, tsc clean
- **人工干预**：无
- **教训**：
  - 5 个测试用例直接匹配 PLAN 模板——最简单的 task，但却是主循环集成前的最后一块拼图
  - CR 评审无 CRITICAL——smallest module, cleanest review。停机判断逻辑简单到不可能出错

---
## 2026-08-01 21:06 Task 13b：Agent 主循环 + 集成测试

- **触发技能**：`test-driven-development`, `requesting-code-review`
- **Subagent**：`c767ce5c`（RED 无单独 commit，GREEN `03c6c97` 一次完成）
- **Prompt 要点**：编排所有已有模块（LLM/工具/护栏/反馈/记忆/事件/配置/停机判断），遵循 SPEC §3.1 伪代码；3 个集成测试全部使用 MockProvider；主 agent 事后评审（`a546a02a`）并修复 F1-F5
- **产出**：
  - Commits: `03c6c97`（GREEN，subagent）, `c13bfa3`（主 agent CR fix）
  - 涉及文件: `src/core/main-loop.ts`, `tests/integration/main-loop.test.ts`
  - 测试: 3 new + 329 existing = 332/332, tsc clean
- **人工干预**：
  - 两阶段评审无 CRITICAL；修复 5 项（commit `c13bfa3`）：
    1. **F1（IMPORTANT）** HITL 置 paused 后外层循环未停止——needsApproval 分支改为 `break outer`，会话真正暂停而非继续烧轮次
    2. **F2（IMPORTANT）** `chain.run()` 无异常兜底——try/catch 包裹，异常转为结构化 FeedbackResult（`validator:'loop'`）
    3. **F3（CONVENTION）** 测试标题"4 轮反馈失败"实为 3 轮失败后第 4 轮进入前触发——修正标题
    4. **F4（CONVENTION）** HITL requestApproval 静默 catch——改为 treat as blocked，避免 stale pendingCommand 被静默覆盖
    5. **F5（CONVENTION）** guardMsg 文案重复前缀"Guardrail blocked: Blocked: rule"——reason 只放规则名
  - subagent 实现中的 3 个集成调试（`createToolRegistry`→`new ToolRegistry()`、ScopeFence 相对路径预解析、`triggerHITL` 前同步 currentRound）由 subagent 自行完成，如实记录
- **教训**：
  - **HITL 暂停 ≠ 循环结束**——任何 paused 状态必须立即终止主循环，否则继续调用 LLM 烧 token，直接违反用户故事 2/5
  - 主循环是验证型评审重点：8 步流程顺序、5 个 maxRounds 检查点（循环顶/parse_error 后/无 action 后/反馈失败后/轮次递增后）、4 条 continue 路径是否递增轮次——评审逐条推演 3 个测试全部路径确认无死循环
  - ValidatorChain 的 `Validator[]` 实例与 `ValidatorSelector` 返回的 `string[]` 名称之间存在映射缺口——主循环用 `Map<string, Validator>` 桥接
  - SPEC §3.1 步骤 7/8 顺序：反馈失败 → 回灌 → 下一轮（不查停机）；反馈通过 → 才查停机
  - 全项目 332 测试全部通过，零网络调用——MockProvider 确定性验证目标达成

---
## 2026-08-01 22:26 Task 16：CLI + Key 管理

- **触发技能**：`test-driven-development`, `requesting-code-review`
- **Subagent**：`a4ef9d14`（GREEN `d3c2bdf` 一次完成；subagent 无法访问自身 agentId，commit 中标注了 CLAUDE_CODE_SESSION_ID 前缀 `095f64f2`，实为主会话标识——已在 AGENT_LOG 记录此偏差）
- **Prompt 要点**：commander 脚手架 + `start`/`key status|update|reset`/`config show` 四条命令；key 必须经 CredentialStore + SecureHandle 闭包；`start` 测试用 MockProvider；所有 IO 可注入
- **产出**：
  - Commits: `d3c2bdf`（GREEN，subagent）, `13536ba`（主 agent CR fix）
  - 涉及文件: `src/cli/` 下 8 文件（index/commands/prompt/store/options/errors）+ `tests/unit/cli/` 6 测试文件
  - 测试: 42 new + 332 existing = 374/374；CR 修复后 382/382, tsc clean
- **人工干预**（8 项，commit `13536ba`）：
  - **I1（IMPORTANT）** TTY raw 模式零测试——补 4 个 fake-TTY 测试（掩码回显/raw 恢复/backspace/Ctrl+C）
  - **I2（IMPORTANT）** `config.llm.apiKeySource` 死配置——`buildCredentialStore` 现在消费该字段：`'env'` 仅显式选择才读（SPEC §4.2），`'encrypted_file'` 只走加密文件，默认 `'keytar'` 回退加密文件；不再静默 push EnvBackend；start.ts 默认 wiring 传入 `config.llm.apiKeySource`
  - **I3（IMPORTANT）** 会话失败 exit 0——`start` action 中 `session.status !== 'completed'` → exit 1（CI 可判断成败）
  - **I4（IMPORTANT）** `config show` 只脱敏 webui.token——新增 SECRET_FIELDS 白名单（webui.token + llm.apiKey），误放的秘密字段也掩码；空 token 保持 `not set`
  - **C1** mask 逻辑三处重复——新建 `src/credentials/mask.ts` 共享（store/key/config 三处统一）
  - **C2** `isDirectExecution` 原始路径比较——两侧 `realpathSync`（npm -g symlink 场景）
  - **C3** start.test.ts 缺 `afterEach(exitCode=0)`——补上
  - **C4** prompt.ts `lineReaders` 永不清理——close 事件中从 Map 删除
  - **C6** 非 TTY 提示无换行——label 后补 `\n`
  - 跳过：C5（`StartCommandDeps.config` 命名过载，低风险）、C7（低风险覆盖缺口）
- **教训**：
  - **subagent 无法访问自身 agentId 时会用 session id 前缀冒充**——派发 prompt 应显式告知 subagent 如何获取 agentId，或主 agent 事后核对 commit 标注
  - `apiKeySource` 死配置是本轮最有价值的发现：Task 6/7 定义了字段但无人消费，直到 CLI 装配（Task 16）才暴露——类型定义了 ≠ 功能实现了，评审要 grep 消费点
  - 改造行为语义（如"不再静默读 env"）必须同步更新断言旧行为的测试——I2 修复直接改了 1 个旧测试的期望并新增 2 个
  - 非 TTY 顺序 prompt 的共享 LineReader 是真实 bug（smoke test 暴露）：每个 prompt 新建 readline 会缓冲整段 piped 输入

---
## 2026-08-01 23:50 Task 17：WebUI——Express 服务器 + API 路由

- **触发技能**：`test-driven-development`, `requesting-code-review`
- **Subagent**：`a1b5ad5b`（GREEN `319c72a9`；commit 标注沿用主会话前缀 `095f64f2`，同 Task 16 已知偏差）
- **Prompt 要点**：Express + WS 同端口（`noServer` + upgrade）；REST 五组路由（sessions/approvals/keys/config）；全部依赖构造注入（SessionStore/HarnessEvents/CredentialStore/Config/HITLManager）供 Task 19 进程内接线，禁全局单例；密钥只在服务端掩码（复用 `mask.ts` 与 CLI SECRET_FIELDS 白名单）；supertest + ws 集成测试零网络零 LLM
- **产出**：
  - Commits: `319c72a9`（GREEN，subagent）, `6fe864d`（主 agent CR fix）
  - 涉及文件: `src/webui/server.ts`、`src/webui/session-store.ts`、`src/webui/api/{sessions,approvals,keys,config}.ts` + `tests/integration/webui-api.test.ts`（31 用例）
  - 测试: 30 new + 382 existing = 412/412；CR 修复后 413/413, tsc clean
- **人工干预**（1 项，commit `6fe864d`）：
  - **I1（IMPORTANT）** `PUT /api/config` 可持久化明文密钥——违反 SPEC §3.6「配置不包含 API Key，Key 走独立凭据通道」：body 含 `llm.apiKey`/`webui.token` 时 400 + 指引 `POST /api/keys/:provider`；补 1 个测试（拒绝 + 未持久化断言）。`.gitignore` 基线（§12.2）不含 `.codeharness.json` 且不得自行补充，故不能靠 ignore 规避
- **教训**：
  - **新增 API 面最容易违反 SPEC 的是"隐性写路径"**：GET 掩码大家都会做，PUT 持久化才是泄密点——评审 REST 设计要追踪每个写端点把什么落盘、落在哪（git 可追踪？）
  - §3.6 的"Key 走独立凭据通道"是硬约束，不是建议：WebUI 的 key 管理必须走 `/api/keys/:provider`，config 端点永不接受密钥字段
  - `ws` 的 `noServer` + upgrade 拦截是测 WS 的正确姿势（supertest 只测 HTTP，WS 需真 socket）——测试基础设施（内存 backend/内存 session store/fixture）一次搭好，31 用例零网络

---
## 2026-08-02 02:10 Task 18a：WebUI——Open Design 设计 + 项目脚手架 + Dashboard + Settings

- **触发技能**：`test-driven-development`, `requesting-code-review`
- **Subagent**：`ac097ac0`（GREEN `ce8627e`；commit 标注沿用主会话前缀 `095f64f2`，已知偏差同前）
- **Prompt 要点**：步骤 0 由人工完成（Open Design 设计 + design-tokens.ts 落地，commit `f5aaffc`）；token 是唯一视觉约束源（无硬编码色值/字号/间距）；API 直连 Task 17 后端不 mock；Monaco 本地打包禁 CDN；TDD 先红后绿
- **产出**：
  - Commits: `f5aaffc`（步骤 0 交付物，主 agent）, `ce8627e`（GREEN，subagent）
  - 涉及文件: `src/webui/client/` 全新 Vite+React 独立项目（26 个源码文件：pages/Dashboard+Settings、components/StatusBadge、lib/api+format+config-json+monaco-theme、31 个测试/5 文件）
  - 测试: 31 client + 413 main = 全绿；`npm run build`（client）通过
- **评审**：0 CRITICAL / 0 IMPORTANT（主 agent 亲验：硬编码 grep 零命中、dist/node_modules 未跟踪、测试断言直接引用 token 值）
- **人工干预**：无（步骤 0 设计为人工部分，非干预）
- **教训**：
  - **需求文档要分"约束 vs 方向"两层**：布局/配色是 AI 的创作空间（写死了反而僵硬），token 结构契约与信息架构必须硬——Open Design 交付物超出预期正因如此
  - **验收"无硬编码"的闭环做法**：grep 检查是静态层；组件测试里 `toHaveStyle({ color: designTokens.colors.statusRunning })` 是动态层——两层的 token 约束才锁得住
  - Monaco 本地打包（loader.config({monaco}) + ESM workers）是离线演示的关键决策，代价是 3.5MB chunk
  - jsdom 下 fetch 需要绝对 URL（client 加 `location.origin` 前缀）；RTL cleanup 需显式注册 setup——两个前端测试基建坑，一次踩完
  - 分类器（deepseek-v4-flash）不可用时派发 subagent 可能失败——重试即可；完成后主 agent 需更严格复核（本 task 全部完成条件主 agent 亲验）

---
## 2026-08-02 02:40 Task 18b：WebUI——SessionDetail + 核心组件

- **触发技能**：`test-driven-development`, `requesting-code-review`
- **Subagent**：`aa0fccea`（GREEN `184b682`；commit 标注沿用主会话前缀 `095f64f2`，已知偏差同前）
- **Prompt 要点**：三栏驾驶舱（文件变更|消息流|上下文）；WS 实时驱动（原生 WebSocket `/ws?sessionId=`，6 种事件 → 纯 reducer 状态机）；ApprovalCard 语义对齐 Task 17 后端（modify 必带 modifiedCommand、409 处理）；FileDiff 用 Monaco（token 主题，不伪造 diff 端点）；REST 快照与 WS 广播按 id 去重；无硬编码约束延续
- **产出**：
  - Commit: `184b682`（19 files, +3348/−33）
  - 涉及文件: SessionDetail.tsx、MessageList.tsx、ApprovalCard.tsx、FileDiff.tsx、hooks/useSessionEvents.ts、lib/{ws-state,ws-source,session-messages}.ts（+ 各自测试）
  - 测试: client 31→115（+84，先红后绿）+ 主项目 413 全绿；build 通过
- **评审**：0 CRITICAL / 0 IMPORTANT（主 agent 亲验：硬编码 grep 零命中、dist 未跟踪、双测试套件 + build 全绿）
- **人工干预**：无
- **教训**：
  - **WS 实时 UI 的正确分层**：纯 reducer（输入校验 + 白名单，可确定性单测）→ 可注入事件源的 hook（connectionKey 重连）→ 组件订阅。三层分离是 84 个新测试全部确定性的前提
  - **后端广播 + REST 快照的重复消息**：前端 upsert by id 是唯一正确去重姿势；快照只在到达时合并一次（WS 帧更新）
  - **API 值 ≠ 显示态**：approval decision（approve/modify/deny）与卡片状态（approved/modified/denied）是两套枚举，`as` cast 会掩盖类型错误——subagent 踩坑后改显式映射，这是真实 bug 修复
  - **文件变更标记的推断限制**：无基线快照时只能"首次提及=A、再次=M"，D 无法从后端数据推断——已注释文档化
  - 浏览器端原生 WebSocket 即可（无需 ws 库），vite dev proxy 配 `ws:true` 即可穿透

---

## 2026-08-02 15:32 Task 18b 修订：原型完全复刻 + 用户反馈修复（Phase 10 收尾）

- **触发技能**：无（用户直接要求"完全复刻参考原型"，主 agent 直接实现，未派发 subagent）
- **Subagent**：主 agent（commit 标注 `— by 主 agent`）
- **Prompt 要点**：无派发；需求 = 对照 `Web-Prototype/codeharness-webui.html` 逐元素复刻 + 三个用户反馈问题（maxRounds 是否有用/头像是否有用/设置缺失板块）
- **产出**：
  - Commit: `ab7a932`（21 files, +2393/−764；PR #8 合并 `8c70155`）
  - 涉及文件: App/Dashboard/SessionDetail/MessageList/ApprovalCard/Settings（client）+ termination/round-manager/session-store/api/sessions（backend）+ 6 个测试文件 + 新增 App.test.tsx、global.css
  - 测试: 主项目 419/419 + client 120/120 + tsc 0 错误 + 构建成功 + 端到端 curl 验证
- **人工干预**：无
- **教训**：
  - **页面测试全绿 ≠ 整棵树可渲染**：TopBar 的 `isActive` 作用域 bug（style 函数参数在 JSX 体外被引用）导致浏览器白屏，而所有测试只渲染页面组件不渲染 App——tsc 也没抓到（作用域误判）。修复后新增 App.test.tsx 渲染整个壳。**结论：改 App 壳/布局组件必须配壳级测试**
  - **用户问"字段有没有用"是真实 bug 探测器**：POST /api/sessions 静默丢弃 maxRounds（store 固定 defaultMaxRounds=3）——WebUI 里"最大轮次"一直无效。修复为透传 + `0 = 无上限`语义（RoundManager/shouldTerminate 支持 0）。**教训：UI 字段与后端消费链必须端到端核对，不能只看前端**（端到端 curl 验证才暴露）
  - **原型复刻的诚实性取舍**：原型是演示数据——"显示密钥明文"（安全约束拒绝）、Token 输入/输出明细（后端无数据）、模型/工作目录字段（创建 API 不支持）都不造假，用占位/说明替代并在汇报中明示
  - **旧 dev 进程不热重载**：`npx tsx`（非 watch）启动的后端不感知代码改动——改后端后必须重启进程，前端 HMR 推送后旧实例会白屏（HMR 状态损坏），强刷或换新端口实例

---

## 2026-08-02 17:22 Task 19：完整集成——CLI `--web` + Agent 循环 + 会话级工作目录绑定

- **触发技能**：`test-driven-development`（subagent）、`requesting-code-review`（两阶段评审）、`subagent-driven-development`
- **Subagent**：`a1972c7f`（实现 `860336b` + 评审修复 `d411349`；commit 标注沿用主会话前缀 `095f64f2`，已知偏差同前）
- **Prompt 要点**：`start --web` 同进程集成（复用 createWebUIServer 注入模式）；会话级 workspaceRoot 全链路（Session 字段 → API 校验 → 主循环 ToolContext/护栏/验证器基准 → WebUI modal 字段 + 详情显示）；full-loop.test.ts 三场景 MockProvider 确定性；PLAN「需求备注」5 子项逐项验证
- **产出**：
  - Commit: `860336b`（20 files +1061/−86）+ `d411349`（7 files +304/−9，评审修复）
  - 涉及文件: start.ts、main-loop.ts、round-manager.ts、session-store.ts、api/{sessions,approvals}.ts、server.ts、types.ts、scope-fence.ts（注释）、client {api,Dashboard,SessionDetail}.tsx + full-loop.test.ts 等
  - 测试: 主项目 419→432→436（修复后 436/436）+ client 120→123；tsc + 双 build 通过
- **评审**：两轮——首轮 1 CRITICAL（C1 HITL 无回 IDLE）+ 2 IMPORTANT（I1 升级暂停无法恢复 / I2 控制端点与 loop 不一致）+ 1 Minor（M1 --help 退出码）→ subagent 修复 → 复验通过（436+123 全绿 + 代码抽查）
- **人工干预**：无（评审结论与修复决策由主 agent 给出，subagent 执行）
- **教训**：
  - **"单次消费"测试会掩盖状态机缺陷**：full-loop 场景 2 只批准一次，HITLManager 批准后永不回 IDLE 的缺陷被测试掩盖——第一次批准后所有后续 warn 命令静默拦截。评审价值正在于此：**评审要找测试路径之外的确定性失败**
  - **升级/恢复语义要闭环**：upgrade 暂停后批准恢复，RoundManager(currentRound) 立即再升级形成死循环——"暂停"必须配"如何恢复"（决策：人工批准 = 授权继续，maxRounds += currentRound 写回持久化）
  - **REST 控制端点与执行器必须共享同一生命周期**：status-only 的 resume/pause 在真实 loop 面前是假状态——resume 必须真实启动 loop、pause/stop 必须真实取消（AbortSignal 轮级检查），否则 WebUI 按钮语义失真
  - **TDD 在修复中的价值**：C1/I1/I2/M1 各配一个先 RED 的失败测试（第二次 warn 批准、升级批准恢复、慢 provider 控制时序、exitOverride 白盒）——修复有回归锚点
  - **评审注入的决策项**：I3（并发 HITL 键控）/M2（--cwd）/M3（符号链接词法校验）均按范围评估后不修并文档注明——不是所有评审项都要修，范围决策要显式

---

## 2026-08-03 12:57 Task 19 真实测试验证 + 用户在场监督模式（32 commits, master..HEAD）

- **触发技能**：无（用户主导全流程真实测试：CLI 场景 2.1-2.4、WebUI 3.1-3.6、会话级工作目录、安全验证；主 agent 直接修复）
- **Subagent**：主 agent（全部修复主 agent 直接实现，commit 标注 `— by 主 agent`）
- **Prompt 要点**：无派发；测试流程由主 agent 设计（第 0-5 步），用户逐场景执行，发现即修
- **产出**：
  - Commit: 32 个（`be7c51a` ~ `c31bddc`），覆盖 20+ 修复
  - 测试: 主项目 449/449 + client 123/123 + 双 build 通过
- **修复分类**（真实测试暴露，每一类都是 Mock 测试覆盖不到的）：
  1. **真实 API 协议（4 个 400 错误）**：工具 schema 属性表 → JSON Schema 转换；tool_call_id 链路（LLMResponse/Action/Message 贯穿）；feedback 角色 → system；tool 响应连续性稳定化（feedback-as-system 穿插导致 400）
  2. **Windows 环境**：run_shell 改用 Git Bash（cmd 不认 `/c/...` 路径与 POSIX 命令）；eslint/tsc 环境前提跳过（npx 下载废弃包）；`2>` stderr 重定向误判修复
  3. **WS/前端**：广播 substring(0,200) 截断（长文本实时截断根因）；flex 子项收缩卡片塌陷成线；body line-height 缺失行重叠；批准卡刷新恢复（approvalRequired 消息重建 + 仅 paused）；长 system 消息 SystemCard（工具卡式可折叠）
  4. **用户在场监督模式（Claude Code 式，用户决策）**：工作区外读写 + 敏感路径 → 确认卡；批准后**工具消息原地替换为真实结果**（LLM 只看到正常工具结果，零中间态噪音——彻底解决"AI 后知后觉"）；CLI stdin 交互确认；已批准命令记忆（防重复确认）
  5. **功能补齐**：completed 会话发消息恢复（onMessageAdded 注入）；maxRounds 默认无上限（参照 Claude Code --max-turns 默认 Unlimited，用户决策）
  6. **安全**：config PUT 深度密钥字段拒绝（任意层 apiKey/token/secret，报精确路径）；编辑器剥离 webui.token 残留；用户可见处移除 SPEC § 引用
- **人工干预**：无（全部主 agent 直接实现）
- **教训**：
  - **Mock 全绿 ≠ 真实可用**：4 个 DeepSeek 协议 400（schema/tool_call_id/feedback 角色/配对顺序）全部只在真实 API 暴露——MockProvider 不校验协议契约。**真实 LLM 测试是 Mock 的必要补充，且不可替代**
  - **"AI 后知后觉"的本质**：批准后注入中间 system 消息（approved/executed）依赖 LLM 理解——**LLM 行为随机**（同一消息格式写任务成功、读任务失败）。**正确架构是 Claude Code 式**：批准后工具正常执行、结果正常返回——LLM 看到的只有普通工具结果，零中间态
  - **消息措辞影响 LLM 认知**：`Guardrail blocked` 被 LLM 读作"永久拦截"——改为 `Operation paused for human approval` 后认知显著改善；提示词必须与消息格式同步（格式改了提示词没改导致失效）
  - **测试 fixture 与真实格式一致**：Mock fixture 没给 tool_call id 导致批准替换链路测试假失败——**fixture 必须反映真实协议结构**
  - **Windows shell 是系统性差异**：LLM 生成 POSIX 命令、cmd.exe 不兼容——run_shell 必须跑在 Git Bash（`'cat' is not recognized` 系列报错的根因）
  - **用户测试流程的价值**：20+ 修复全部由真实场景驱动（Console 脚本对比 DOM/API 内容定位广播截断、curl 手动批准区分前后端问题）——**系统化测试流程 + 数据定位是高效调试的组合**

---

## 2026-08-03 15:35 Task 23：fs 浏览端点 + 目录选择器 + 会话详情文件树（阶段 15 第一个任务）

- **触发技能**：`test-driven-development`（subagent）、`requesting-code-review`（两阶段评审）
- **Subagent**：`abf1da09`（实现 `9bba87c` + 评审修复 `3f0ee53`；commit 标注沿用主会话前缀 `095f64f2`，已知偏差同前）
- **Prompt 要点**：`GET /api/fs/tree` 目录树枚举（嵌套/类型/大小、授权边界、深度/数量/节点截断）；新建会话目录选择器弹窗；会话详情左栏工作目录文件树 + A/M 标记 + diff 预览保留；授权根集合设计（config 根 + 会话根并集，实时求值）
- **产出**：
  - Commit: `9bba87c`（+10 主项目测试、+4 client）+ `3f0ee53`（评审修复 +4/+4）
  - 涉及文件: webui/api/fs.ts（新建）、components/DirectoryPicker.tsx（新建）、server.ts、api.ts、Dashboard.tsx、SessionDetail.tsx + 测试
  - 测试: 主项目 449→463 + client 123→131；tsc 双 build + oxlint 干净
- **评审**：0 CRITICAL；2 IMPORTANT + 4 Minor —— I1（中间 symlink/junction 越界，评审实测确认逃逸）→ realpath 规范化边界检查（RED 先复现漏洞）；I2（截断外变更文件不可达）→「变更文件 fallback 列表」；M4-M8 顺手修（StrictMode 重复请求/树重取依赖/Windows 大小写/全局节点预算/Escape 关闭）→ 复验 463+131 全绿 + 代码抽查
- **人工干预**：无（评审结论与修复决策由主 agent 给出）
- **教训**：
  - **新网络面必须做真实边界验证**：词法 `isInside` + 末段 lstat 只防"直接 symlink"——junction/symlink **中间组件**逃逸需要 realpath 规范化才能封死。评审用实际 junction 复现了逃逸（200 枚举外部目录）——**安全边界检查不能只靠静态推理，要实证**
  - **UI 功能回归的隐性代价**：文件树取代平铺变更列表后，截断/深度外的变更文件不可达——**替换 UI 时必须保留旧行为的可达性**（fallback 列表方案）
  - **测试 fixture 必须贴近真实路径形态**：`filesChanged`（相对）vs 树节点（绝对）直接比对永不命中——subagent 自己抓到并修（absoluteWithin + 归一化）
  - **全局节点预算**（maxNodes 5000）配合深度/每层上限才真正封死响应爆炸半径——三层防线

---

## 2026-08-03 16:20 Task 24：MD 渲染 + 移除搜索框（阶段 15）

- **触发技能**：`test-driven-development`（subagent）、`requesting-code-review`（两阶段评审）
- **Subagent**：`ab385bfe`（实现 `b53df7a`；commit 标注沿用主会话前缀 `095f64f2`，已知偏差同前）
- **Prompt 要点**：react-markdown@10 + remark-gfm 渲染 assistant 消息；`skipHtml` 防 XSS + `dangerouslySetInnerHTML` 零使用 + URL 协议剥除 + 图片不远程加载；user 保持纯文本；移除 TopBar 搜索框
- **产出**：
  - Commit: `b53df7a`（client +4 测试；主项目不变）
  - 涉及文件: components/MarkdownContent.tsx（新建）、MessageList.tsx、App.tsx + 测试 + package.json（react-markdown/remark-gfm）
  - 测试: client 131→136 + 主项目 463；tsc 双 build + oxlint 干净
- **评审**：0 CRITICAL 0 IMPORTANT（评审核实 skipHtml 源码行为 + urlTransform 白名单 + dangerouslySetInnerHTML 零使用）；4 Minor——补 `javascript:` URL 测试锁定（XSS 三类入口全覆盖，主 agent 补 `c2a63cc`）
- **人工干预**：补 XSS URL 测试（评审 Minor #1）
- **教训**：
  - **XSS 防线要三类入口全测**：raw HTML（skipHtml）/ 图片（alt 化）/ URL 协议（urlTransform）——漏一类将来改配置就静默回归
  - **行尾事故**：编辑器保存把 LF 文件转 CRLF → git diff 1393 行假变化——定位方法：`git config core.autocrlf` + `file` 对比 HEAD/工作区；**教训：行尾异常先查 git 存储 vs 工作区的换行，再动文件**
  - **vitest 测试级超时是隐性 flake 源**：HITL 全链路（暂停→批准→执行→恢复→完成）在并行负载下 >5s——`describe(name, fn, timeout)` 提到 15s 根治

---

## 2026-08-03 17:10 Task 25：自定义供应商 + 模型/护栏可编辑（阶段 15）

- **触发技能**：`test-driven-development`（subagent）、`requesting-code-review`（两阶段评审）
- **Subagent**：`a304c632`（实现 `cc8b703` + 评审修复 `ab497ac`；commit 标注沿用主会话前缀 `095f64f2`，已知偏差同前）
- **Prompt 要点**：GET /api/keys 凭据库枚举（CredentialBackend.list + CredentialStore.list 委托）；动态 provider 列表 + 添加供应商（URL 编码 + 服务端名校验）；模型/护栏表单化（PUT config 白名单 patch）；护栏配置接入运行时（blockOutbound/requireApproval 真实生效）
- **产出**：
  - Commit: `cc8b703`（+12/+7）+ `ab497ac`（评审修复 +4/+4）
  - 涉及文件: types.ts（CredentialBackend.list + Config.guardrails）、credentials/store + 三后端 list、webui/api/keys.ts（GET /）、main-loop.ts（guardrails 叠加层）、client api.ts + Settings.tsx（动态 KeyManagementCard + 可编辑表单）等
  - 测试: 主项目 463→481 + client 136→147；tsc 双 build + oxlint 干净
- **评审**：0 CRITICAL；1 IMPORTANT（护栏字段无类型无运行效果——写死旋钮）→ 修复：Config.guardrails 纳入接口点 + runGuardrails 叠加层（blockOutbound 网络外呼确认、requireApproval 子串匹配确认，PatternGuard BLOCK 优先不破坏）；4 Minor（URL 编码/删除行残留/maxRounds 空值/env 只读提示）全修
- **人工干预**：无（评审结论与修复决策由主 agent 给出）
- **教训**：
  - **评审抓"写死旋钮"的价值**：表单保存成功文案宣称"已生效"，但字段无运行时读取——**UI 可编辑的配置项必须验证"保存后真的影响行为"**（对照：model/maxRounds 生效 vs 护栏不生效——完成条件只满足一半）
  - **叠加层顺序**：新护栏检查放在 PatternGuard BLOCK 之后（不破坏硬拦截）、warn 之前（配置开关语义优先于 PatternGuard warn 缓存——同一命令二次出现仍要求二次确认）
  - **凭据枚举的设计取舍**：`list(service)` 加到 CredentialBackend 接口（唯一接口点）而非 harness 注入列表——重启持久化的真实依据是"凭据在持久通道、枚举同一批 account"
  - **M3 附带发现**：表单 seeding effect 前空值渲染一帧导致交互竞态——`seeded` 门控根治（不只是校验补丁）

---

## 2026-08-03 18:20 Task 26：对话中切换模型（阶段 15）

- **触发技能**：`test-driven-development`（subagent）、`requesting-code-review`（两阶段评审）
- **Subagent**：`ad7cfb78`（实现 `9743b5f` + 评审修复 `9422977`；commit 标注沿用主会话前缀 `095f64f2`，已知偏差同前）
- **Prompt 要点**：Session.model 全链路（types/store/API/PATCH）；runSession → BuildAgentLoopOptions.session 显式字段 → createLLMProvider model 参数（config 不变、覆盖点显式）；运行中切换复用 abort+restart（pendingInjection）；WS 新事件 session:updated（按会话过滤）；前端上下文栏模型选择器
- **产出**：
  - Commit: `9743b5f`（17 文件 +827/−21）+ `9422977`（评审修复 8 文件 +246/−13）
  - 涉及文件: types.ts、events.ts（session:updated）、session-store.ts（updateModel）、api/sessions.ts（PATCH /:id/model + normalizeModel 重载）、start.ts（session 传递 + restartLiveRun helper）、deepseek-provider.ts（readonly model）、ws-state/useSessionEvents/SessionDetail（选择器 + model 状态）
  - 测试: 主项目 481→495 + client 147→166；tsc 双 build + oxlint 干净
- **评审**：0 CRITICAL；1 IMPORTANT（pause/stop 与模型切换竞态——finally 见 latch 时 store 已 paused → 重启覆盖用户暂停）→ finally 加 `session.status === 'running'` 守卫 + 竞态测试（慢 provider + PATCH 后立即 pause，断言无重启流/无双重 loop）；5 Minor 全修（latch 错误消费→runSession 开头 delete；WS null 帧权威（modelFrameSeenRef）；死代码；dropdown 保留刚离开的模型；restartLiveRun 抽取）
- **人工干预**：无（评审结论与修复决策由主 agent 给出）
- **教训**：
  - **复用机制时要重新审视其边界**：消息注入的 abort+restart latch 被模型切换复用——"运行中重启"的时序语义（暂停先落地则重启应放弃）必须显式处理，不能假设复用点语义相同
  - **`??` 不能表达"显式 null 赢"**：模型清除帧（null）vs 迟到 REST 快照（旧值）——用 ref 记录"已收到 WS 帧"使 WS 成为权威，语义清晰
  - **provider 构造 spy 是"切换生效"的最好验证**：builtModels 序列 `[undefined, 'deepseek-v3']` 直接证明首构建无覆盖、重启带新模型
  - **executeApprovedAction 窗口当前不可达**（工具全同步）——M1 修复是纵深防御，测试固化不变量而非当前可达路径

---

## 2026-08-03 19:10 Task 27：CLI 交互式 REPL（阶段 15 最后一个任务）

- **触发技能**：`test-driven-development`（subagent）、`requesting-code-review`（两阶段评审）
- **Subagent**：`ab8ed348`（实现 `051e052` + 评审修复 `b5b5efe`；commit 标注沿用主会话前缀 `095f64f2`，已知偏差同前）
- **Prompt 要点**：无参数进 REPL；单会话（持久 readline 队列+waiters）；首输入=任务、后续=消息注入（hitl.reset + maxRounds 上调 + 每轮新 loop 带 session）；斜杠命令（/exit /help /model /clear）；Ctrl+C 两态（提示符退出/运行中中断）；HITL 确认在 REPL 内；凭据隔离（缺 key 抛可操作错误而非交互引导——防 key 进 REPL 队列泄漏）
- **产出**：
  - Commit: `051e052`（新增 src/cli/repl.ts + 15 测试）+ `b5b5efe`（评审修复 +10 测试）
  - 涉及文件: repl.ts（新建）、index.ts（无参数进 REPL）、start.ts（导出共享 helper + runReplAction）、repl.test.ts（新建 24 测试）
  - 测试: 主项目 495→520 + client 166；tsc 双 build + oxlint 干净
- **评审**：0 CRITICAL；3 IMPORTANT + 6 Minor —— I1（HITL 循环条件在 EXECUTING/BLOCKED 态误问已决断命令 → approve 抛错）→ 条件改 AWAITING_APPROVAL（+ start.ts 同款）；I2（HITL 确认中 Ctrl+C 静默拒绝继续运行）→ SIGINT 先 interruptRun；I3（EOF 退出码不看会话结局）→ lastStatus 决定码；M1-M6 处理（adviceFor、测试补齐、模块环接受、/clear 决策注释、tsbuildinfo 清理）
- **人工干预**：无（评审结论与修复决策由主 agent 给出）
- **教训**：
  - **状态机条件是边界的照妖镜**：`getPendingCommand() !== null` 在 IDLE/EXECUTING/BLOCKED 态都非空——循环条件必须用状态（AWAITING_APPROVAL）而非字段；评审发现的可达路径（批准后恢复 run 再撞 maxRounds）是"跨机制组合"才暴露的边界
  - **Ctrl+C 是三态契约**：提示符/运行中/HITL 确认——文档只写了两态，评审抓到第三态行为违背；SIGINT 处理必须对每个挂起状态明确语义
  - **凭据与交互界面的隔离**：REPL 持久 reader 与 promptHidden 共享 stdin 是真实泄漏路径（key 进下轮 LLM 上下文）——"不让工厂交互引导"是正确取舍（错误提示代替交互）
  - **管道场景的退出码契约**：EOF 退出码必须镜像 start 命令的 I3 CR（非 completed → 1）——脚本可检测失败

---

## 2026-08-03 19:10 阶段 15 模块收尾：WebUI/CLI 产品增强（Task 23-27）

- 5 个任务全部完成：Task 23（fs 端点/目录选择器/文件树）、Task 24（MD 渲染/删搜索框）、Task 25（自定义供应商/模型护栏可编辑）、Task 26（对话中切模型）、Task 27（CLI REPL）
- 测试：主项目 449→520 + client 123→166；每个任务两阶段评审（0 CRITICAL 遗留）
- 用户 8 条建议全部落地（搜索框删除、MD 预览、文件树、自定义供应商、模型护栏编辑、对话切模型、目录选择器、CLI REPL）

---

## 2026-08-03 20:42 Task 23 评审跟进：目录选择器整机浏览（/api/fs/browse）

- **触发技能**：`systematic-debugging`（机器根测试红 → 根因调查）、`test-driven-development`（前端 api/组件 红→绿）
- **Subagent**：095f64f2（原会话中断，后端 /browse 路由 + 5 个集成测试已写未提交）；前端切换 + 测试修复由主 agent 接手（交接文件 `.claude/handoff-browse-feature.md` 驱动）
- **Prompt 要点**：用户真实测试需求"目录选择器只有当前工作目录下的目录，我想的是可以选择整台电脑的任何目录"→ 已批准方案：分离端点（browse=宽浏览仅元数据，tree=窄授权不变）；前端选择器初始显示机器根
- **产出**：
  - Commit: `e5f88e8`（8 文件 +419/-61；含新增 DirectoryPicker.test.tsx 9 测试）
  - 涉及文件: src/webui/api/fs.ts（/browse + machineRoots）、tests/integration/fs-api.test.ts（5 测试）、client lib/api.ts（fetchMachineRoots/fetchFsBrowse）、DirectoryPicker.tsx（tree→browse 重构）、DirectoryPicker.test.tsx（新建）、Dashboard.test.tsx（适配）、KNOWN_ISSUES.md（§11 安全取舍）
  - 测试: 主项目 520→525 + client 166→177（+11）；tsc 双项目干净
- **人工干预**：修机器根测试正则字符类 `[\/]` → `[\/]`（原字符类仅匹配正斜杠，Windows 盘符根 `C:\` 是反斜杠——测试 bug，实现正确）；commit message 正则转义被 bash 吃掉两处，用 message 文件 + od 逐字节验证修正
- **教训**：
  - **正则字符类是转义重灾区**：`[\/]` 在 JS 中只含 `/`（`\` 只是多余转义），Windows 路径断言必须写 `[\/]`——"一眼看着对"的断言在 win32 永远红，复现脚本（node 复刻 machineRoots + 双正则对比）一次锁定根因
  - **Windows 命令行转义两层吃反斜杠**：bash 双引号 + 单引号都会处理 `\`——commit message 含正则时用 `-F message文件`，验证用 `git log | od -c`
  - **交接文件模型有效**：中断会话按"现状一句话/已批准方案/进度/接续清单/环境坑"交接，新会话 5 分钟即可全绿接手，无需回看原 transcript

---

## 2026-08-03 21:02 Task 23 评审跟进：整机浏览两阶段评审（reviewer ab2ff25c）

- **触发技能**：`requesting-code-review`（两阶段：spec 合规 + 代码质量）、`systematic-debugging`（复现评审发现的 unhandled 错误）
- **Subagent**：`ab2ff25c`（评审 6bb3fc5..e5f88e8，read-only）
- **Prompt 要点**：两阶段评审强制——spec 合规对照 SPEC §3.4（/browse 是有意偏离，须确认偏离文档化且边界收窄）+ 代码质量；明确列出怀疑对象（machineRoots、400 语义、排序稳定性、StrictMode/M4、虚拟根守卫、渲染安全）
- **产出**：
  - Commit: `4f2632c`（4 文件 +157/-40）
  - 修复: I1 循环 fixture → client 套件 1 unhandled 栈溢出（"177 passed" 掩盖）→ 按路径分发 fixture + renderNode 祖先链环守卫；I2 browse 截断在排序前（readdir 序不定，ext4/APFS 非确定性）→ withFileTypes 分区 → byName 排序 → 截断，与 /tree 同契约 + 消除逐条 lstat / socket-FIFO 归类差异（M3/M4）；M7 +3 集成测试
  - 测试: 主项目 525→528 + client 177（unhandled 清零）；tsc 双项目干净
- **人工干预**：评审结论全部采纳（2 Important + 4 Minor 处理，0 Critical）；未采纳项无
- **教训**：
  - **"全绿"会掩盖 unhandled 错误**：vitest 的 `Tests 177 passed` 与 `1 unhandled error` 同屏——用 grep 过滤结果会漏掉错误行；全量验证必须看 Errors 计数（评审 agent 抓住了主 agent 漏掉的栈溢出）
  - **mock fixture 必须无环**：`mockResolvedValue(同一 listing)` 在逐级展开的组件测试里等于"目录包含自己"——服务器契约（path 严格加深）保证不了前端拿到的数据；渲染递归必须自带祖先链守卫
  - **排序后再截断是唯一可断言的契约**：readdir 返回序在 NTFS 恰好有序、ext4 任意——"截断保前 N"只有先排序才有意义；/tree 早已做对，/browse 初版切在排序前
