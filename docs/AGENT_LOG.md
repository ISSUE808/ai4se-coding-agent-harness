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

---

## 2026-08-03 21:10 复核：测试流程 1.6「手动输入越界被拒」在新行为下是否仍成立

- **结论**：成立（行为未变），选择器行为变化不涉及 1.6 断言路径——对照 `src/webui/api/sessions.ts` `validateWorkspaceRoot`（Task 19 既有）：相对路径/不存在/非目录/不可写 → 400 明确报错，未改动；选择器选中任意目录 → 成为该会话授权根（sessions API 对 workspaceRoot 无范围限制，监督模式即"选中即授权"）；`/tree` 越界 400 不变；`/browse` 是唯一新开放面且仅元数据（KNOWN_ISSUES §11）
- **教训**：交接文件第 6 项「复核 1.6 预期」的落点不在测试文档（会话内产物，未入库）而在 API 校验函数——复核语义变化时先找"拒绝路径"的代码位置，再对照新行为

## 2026-08-03 21:35 真实测试反馈修复：文件树随消息流自动刷新（1.4）

- **触发技能**：`test-driven-development`（红→绿）、`systematic-debugging`（先查代码定位设计意图再判断）
- **Subagent**：无（主 agent 直接实现——用户真实测试反馈驱动）
- **Prompt 要点**：用户按 5 部分测试流程实机测试阶段 15，报告 1.4「创建文件后树未显示 notes.md，刷新后才出现」+ 1.5「点击文件显示无 diff 内容占位」。先读代码判定：1.5 是刻意设计（FileDiff 无 diff 端点只展示工具输出摘要，有专门测试 FileDiff.test.tsx:21）；1.4 是 M5 取舍（树 effect 仅依赖 workspaceRoot，注释明示不随 status 重取）但偏离测试流程字面预期 → 用户决定 1.4 要改
- **产出**：
  - Commit: `2be2f88`
  - 涉及文件: `SessionDetail.tsx`（树加载抽 loadTree + 请求代际计数器防过期覆盖；新增消息监听 effect：首次快照吸收，其后仅新到达的 tool 变更消息 debounce 300ms 重取）+ `SessionDetail.test.tsx`（+2 测试：tool 变更触发第 2 次 fetch / 非变更消息不触发）
  - 测试: client 177→179/179 绿；tsc 干净
- **人工干预**：无
- **教训**：
  - **"刷新才出现"先查 effect 依赖再下结论**：树快照 + 实时变更列表是 M5 刻意混合模型（A/M 标记实时 overlay + 树下方回退列表兜底）——不是 bug，但字面偏离测试流程预期；用户真实测试的价值正是抓这种"设计合理但体验断裂"的偏差
  - **"首次吸收 + 只认新消息"是快照合并下的干净信号**：消息流 = REST 快照一次合并 + ws 增量帧，用「最后一条消息 id 变化」区分新旧，快照合并不算"新变更"，初始 fetch 恰好 1 次不破坏 M5 断言
  - **防过期响应用代际计数器**（请求 id 递增）比 cancelled 标志更稳：debounce 的晚到请求不会覆盖切换 workspaceRoot 后的新树

## 2026-08-03 21:50 真实测试反馈：文件内容预览取代工具摘要（1.5）

- **触发技能**：`test-driven-development`（后端红→绿）、`systematic-debugging`（write_file 预览为空的根因追踪）
- **Subagent**：无（主 agent 直接实现——用户真实测试反馈驱动）
- **Prompt 要点**：用户测试 1.5 发现「write_file 新建文件后预览仍为空」并建议改文件内容预览。根因：`contentForFile` 取 `toolResult.output ?? error`，而 write_file 的 toolResult 只有 `{ success, duration_ms, filesChanged }`（无 output）→ 必然空。用户批准方向：内容预览，安全前提=内容读取限授权根内（/browse 元数据整机是 §11 既有取舍，内容必须收紧到 /tree 边界）
- **产出**：
  - Commit: `24d39b5`（10 文件 +301/-76）
  - 后端: fs.ts 新增 `GET /api/fs/file`——复用 /tree 边界（canonicalBoundary 辅助函数抽取，roots+canonical 双返回）+ realpath 防 symlink 逃逸 + 非文件 400 + 超 256KB 413；9 个新集成测试（内容/缺 path/越界/不存在/非文件/逃逸 400/向内放行/413/挂载会话根）
  - 前端: api.ts `fetchFsFile`；SessionDetail 点击文件经 `/api/fs/file` 拉真实内容（loading/error 状态 + 请求代际防快速连点覆盖）；FileDiff 改「文件内容预览」文案 + error 态；`contentForFile` 移除（含其 3 个单测）
  - 测试: 主 528→537（+9）+ client 179/179；tsc 双项目干净
- **人工干预**：无
- **教训**：
  - **"预览为空"先查工具契约再怀疑 UI**：write_file 从不产出 output 摘要——摘要型预览对写文件类工具结构性失效；用户建议（内容预览）直接消灭了这类空白
  - **内容端点必须收紧边界，元数据端点放开≠内容放开**：/browse 整机仅元数据（§11）；/api/fs/file 复用 /tree 的 canonical boundary（授权根 + symlink 逃逸拒绝）——安全取舍分层：元数据宽、内容窄
  - **抽取共享边界时小心暗依赖**：canonicalBoundary 重构 /tree 时丢了 `roots[0]`（默认根），5 个既有测试 500——重构公共逻辑必须全量跑目标文件，不能只看新测试

---

## 2026-08-03 22:35 真实测试推翻复核：1.6 手动输入任意目录可建会话（W_OK 校验删除）

- **触发技能**：`test-driven-development`（红→绿）、`systematic-debugging`（复核结论被真实测试推翻后的根因追查）
- **Subagent**：无（主 agent 直接实现——用户真实测试反馈驱动）
- **Prompt 要点**：用户实测 1.6：手动输入 `C:\Windows` 创建会话**成功**（仅树加载报错），问"放开限制让所有目录都可以创建会话怎么样"。此前 21:10 复核条目结论"仍会拒"被推翻——根因：Node 文档明示 Windows 上 `fs.access` 只查文件属性（READONLY 位）**不查 ACL**，目录无 read-only 属性 → W_OK 恒通过，纸面校验从未真正拦截过
- **产出**：
  - Commit: `f1f60fd`（`sessions.ts` validateWorkspaceRoot 删 W_OK 检查 + 注释；`webui-api.test.ts` +1 测试——vi.mock('node:fs') 包装 accessSync 为可控制 vi.fn（ESM 命名空间不可 spyOn，`vi.spyOn(fs,'accessSync')` 抛 Cannot redefine property），mockImplementationOnce 模拟不可写 → 断言 201；PLAN.md L1089 更新）
  - 决策: 采纳用户方向——放开=承认现状（选择器本就整机可选，手动输入校验形同虚设）；保留 非空/绝对/存在/是目录 校验；不可读根的树加载错误保留（可见反馈）；工具层 isWithinWorkspace 硬边界兜底
  - 测试: webui-api 54/54；主套件待全量确认
- **人工干预**：无
- **教训**：
  - **"复核过=成立"必须被真实测试证伪**：21:10 只读代码得出"仍会拒"，用户一测就推翻——平台行为（Windows access 不查 ACL）只能靠实测或文档明证，读代码会自欺
  - **纸面限制比没有限制更糟**：W_OK 在 Windows 恒真 → "代码声称会拒、实际能建"的不一致，最终由用户困惑买单；校验的可靠性比存在性更重要
  - **ESM 命名空间不能 spyOn**：`vi.spyOn(fs, 'accessSync')` 抛 `Cannot redefine property`；需要可注入行为时用 `vi.mock('node:fs', factory)` 把目标函数包成转发真实实现的 vi.fn（spread 会求值 promises getter，需确认无副作用），mockImplementationOnce 单次注入

---

## 2026-08-03 23:24 真实测试 4.1：模型选择器不渲染（config 读取路径错误）

- **触发技能**：`test-driven-development`（红→绿）、`systematic-debugging`（根因追查）
- **Subagent**：无（主 agent 直接修复——用户真实测试反馈驱动）
- **Prompt 要点**：用户按测试流程 4.1 实测：会话详情页**没看到模型选择器**（预期"模型选择器显示当前模型（默认 · deepseek-v4-flash）"）。根因链：真实 Config 的 `model` 在 `config.llm.model`（types.ts Config 接口），前端 SessionDetail.tsx 却读顶层 `config.model` → 真实响应恒 undefined → `configModel` 恒 null → 渲染条件 `configModel !== null` 恒假 → 选择器永不渲染；测试 mock（`{ model: 'deepseek-v4-pro' }`）恰好用了与真实结构不符的顶层 model，8 个 Task 26 测试全绿掩盖了 bug
- **产出**：
  - Commit: `976b611`（SessionDetail.tsx `configModel` 改为 `llm.model` 读取——手写窄化与 guardrails 同风格；SessionDetail.test.tsx mock 改为真实结构 `{ llm: { model } }` 并加注释）
  - 测试: 红 8 failed（mock 改真实结构后 Task 26 选择器测试全部失败——正是用户所见现象的测试再现）→ 绿 26/26；client 179/179（14 文件）；双 tsc 干净
- **人工干预**：无
- **教训**：
  - **"Mock fixture 必须来自真实代码路径"第三次重演**：KNOWN_ISSUES 三、1 已归档同类教训（工具 parameters 属性表），这次是 config 结构——测试 mock 与真实响应结构不一致时，测试全绿与页面损坏同时发生。修 bug 时必须顺带把 mock 改成真实结构，否则测试永远"绿得心安理得"
  - **Record<string, unknown> 类型宽化掩盖路径错误**：ConfigValue 无类型约束，`config.model` 在 tsc 下合法 → 只有真实数据能暴露；对这种"宽类型 + 深层字段"的配置读取，应参照 Settings.tsx 的 `asRecord(config.llm)` 窄化模式统一
  - **渲染条件隐藏 UI 是比报错更静的失败**：`configModel !== null` 恒假时选择器整个消失，无任何报错线索——条件渲染前先确认数据源真的取到了值

---

## 2026-08-03 23:52 用户需求：模型选择器从供应商模型列表选 + 切换联动全局配置

- **触发技能**：`test-driven-development`（红→绿，4 处）、AskUserQuestion（设计决策）
- **Subagent**：无（主 agent 直接实现——用户功能需求）
- **Prompt 要点**：用户反馈"自定义模型填入后设置里仍是旧模型，感觉不太好"——要求：① 设置页获取每个供应商的模型列表 ② 模型选择器只能在已获取列表中选择 ③ 选择模型后配置也相应更新。设计决策（用户确认）：列表拉取失败回退手动输入+提示；选模型时 PATCH 会话 override **和** PUT config llm.model 双更新（当前会话立即用 + 新会话默认）
- **产出**：
  - Commit `a8eca19`：后端 `GET /api/llm/models`——CredentialStore 取 key（SecureHandle.use 闭包内发请求，§3.7 密钥不落响应/日志）、OpenAI 兼容 `{baseUrl}/models`、尾斜杠容错、401（无 key）/502（网络/非 2xx）、注入 fetchFn 零网络测试（6 测试）
  - Commit `7553229`：前端——SessionDetail 选择器列表模式（`listMode`：仅列表+config 默认+会话 override；失败回退最近使用+自定义输入+提示条）；`applyModelSync` 双更新（PATCH 成功 → PUT config → setConfig 刷新"默认模型"基线；config 失败不阻断会话切换，提示"已切换会话模型，但全局配置更新失败"）；Settings 新增"供应商模型列表"区块（挂载自动加载 + 刷新按钮 + 点击 chip 填入表单字段）；api.ts fetchAvailableModels
  - 测试: 红→绿：models-api 6/6、SessionDetail 30/30（+4 列表模式）、Settings 20/20（+2）、api 25/25；全量 主套件 544/544（46 文件）+ client 186/186（14 文件）+ 双 tsc 干净
- **人工干预**：App.test.tsx 的 api mock 缺 fetchAvailableModels 导致 2 测试挂（SessionDetail 新增 import）——补 mock 修复
- **教训**：
  - **每次给组件加新 import 都要全局搜 vi.mock 工厂**：SessionDetail 加了 fetchAvailableModels，App.test.tsx 的 api mock 工厂没有它 → 挂 2 个壳级测试（vitest 报 "No export defined on the mock"）。Mock 工厂与组件 import 面必须同步
  - **"自定义输入"是纸面能力也是双刃剑**：列表模式隐藏自定义入口让"只能在已获取列表选"成立，但失败回退保住可用性——功能收窄必须配套降级路径，否则断网/无 key 时模型切换整个瘫痪
  - **双更新（PATCH+PATCH config）的失败语义**：会话切换是主操作（运行中立即生效），config 持久化是副操作——副失败不能回滚主成功，提示而非阻断

---

## 2026-08-04 00:45 用户需求：多供应商模型列表（key 行"应用"按钮 + 添加供应商填 baseUrl）

- **触发技能**：`test-driven-development`（红→绿）、AskUserQuestion（设计决策）
- **Subagent**：无（主 agent 直接实现——用户功能需求）
- **Prompt 要点**：用户反馈"设置里的模型列表只显示 deepseek 的，希望显示所有供应商的模型列表"——方案（用户提出）：每个 key 后加"应用"按钮，点击后配置自动切换、模型与护栏板块显示对应信息与模型列表；key 不够的（需 baseUrl）在添加供应商时提供填写框。设计决策（用户确认）：切换时**有 defaultModel 就自动带，没有就用模型列表第一个**
- **产出**：
  - Commit `9b097d8`（后端）：`Config.llm.providers` 注册表（provider → { baseUrl, defaultModel? }，schema 预设 deepseek）；POST /api/keys/:provider 扩展（apiKey 可选 + baseUrl/defaultModel 写注册表，两者皆空 400）；GET /api/keys 返回 baseUrl/defaultModel/isActive，providers = 凭据 ∪ 注册表；**liveConfig 引用重构**——server 的 persistConfig 包装更新 liveConfig，keys/models 路由经 getConfig() 读最新（PUT /api/config 切供应商后模型列表端点自动跟随）
  - Commit `69997df`（前端）：KeyRow 加"当前"chip + "应用"按钮（激活 = saveConfig llm.provider/baseUrl/model——有 defaultModel 直接带，否则拉新供应商模型列表取第一个，再 saveConfig）；行内编辑可改 baseUrl/defaultModel；添加供应商表单（名称 + baseUrl 必填 + 默认模型可选）；模型列表随 config 变化重拉（ModelGuardrailCard effect 依赖 config）
  - 测试: 红→绿：webui-api +9（注册表/无 key 注册/isActive/切换后 models URL 跟随）、models-api 6/6 保持、client +7（应用/无默认取第一/添加供应商/saveKey meta/当前 chip）；全量 主套件 550/550 + client 192/192 + 双 tsc 干净
- **人工干预**：修复两处隐藏问题——① models router 曾把 config 解构为快照（PUT config 后不跟随），改 getConfig() 函数式；② 旧 handleAddProvider 残留覆盖新 async 版（同名函数后者覆盖前者，点添加只走本地加列表不调 API）
- **教训**：
  - **"传引用"要传函数，不要传当时的引用值**：`config: liveConfig` 在组装时求值成快照，liveConfig 变量后续重新赋值不影响 deps——必须 `getConfig: () => liveConfig`。引用传递的意图要用闭包函数表达
  - **同名函数定义在文件后段会覆盖前段**：新增 async handleAddProvider 与旧同步版同名共存，后者（定义在文件更后）覆盖前者——功能"看起来改了但行为没变"，测试救回（saveKey 0 调用 + 输入被旧逻辑清空）
  - **无 key 供应商也要能出现在 keys 列表**：providers = 凭据 ∪ 注册表——"添加供应商（仅元数据）"才有意义，否则用户填完 baseUrl 后列表里看不到

---

## 2026-08-04 01:00 真实测试修复：注册的供应商在切换后被清掉（config 双状态源）

- **触发技能**：`systematic-debugging`（根因追查）、`test-driven-development`（红→绿）
- **Subagent**：无（主 agent 直接修复——用户真实测试反馈）
- **Prompt 要点**：用户操作链复现：添加 nju（baseUrl+key）→ 应用 nju ✓ → 应用 deepseek ✓ → 再应用 nju ✗ 报"供应商 nju 未配置 API 地址"。根因：**config router 持有自己的 `current` 快照**——POST /api/keys 注册 nju 只更新 liveConfig + 持久化文件，config router 的 current 不变；下一次 PUT /api/config 以旧 current 为 base merge → merged 丢 nju 注册表条目 → persist 覆盖 liveConfig 与文件 → nju 条目永久消失 → 再应用 nju 时 GET /api/keys 查不到 baseUrl
- **产出**：
  - Commit: `b6efc7b`（config.ts 去状态化：deps 改 `getConfig: () => Config`，GET/PUT 都读 liveConfig，删除 `let current`；server.ts 传 `getConfig: () => liveConfig`；webui-api.test.ts +1 回归测试——注册→应用 A→应用 B→断言注册表存活）
  - 测试: 红 1（复现）→ 绿：webui-api+models-api 67/67；主套件 551/551；client 192/192；双 tsc 干净
- **人工干预**：无
- **教训**：
  - **两个可变状态源必然失同步**：config router 的 current 与 server 的 liveConfig 并存，keys 路由写一个、config 路由读另一个——任何"启动快照 + 运行时更新"的双轨都埋雷。去状态化（单一真源 + getConfig 函数式）一次性消除整类 bug
  - **用户操作链是比单测更强的回归场景**：单测各自测 POST keys 和 PUT config 都过，只有完整链（注册→切换×2）暴露覆盖——把用户复现链原样写成集成测试
  - **持久化覆盖比内存丢失更严重**：不只是运行时拿不到 baseUrl，`.codeharness.json` 里的注册表条目也被旧 current merge 的结果覆盖删除了——状态丢失要同时检查内存与落盘

---

## 2026-08-04 01:30 真实测试修复：应用 nju 后调用的仍是 deepseek（loop 用启动快照 config）

- **触发技能**：`systematic-debugging`（根因追查）、`test-driven-development`（红→绿）
- **Subagent**：无（主 agent 直接修复——用户真实测试反馈）
- **Prompt 要点**：用户实测"应用 nju 后调用的还是 deepseek 的 api"。根因链：`runSession` 每次 `buildAgentLoop({ config })` 用的 **createWebHarness 启动快照**——应用按钮只切 WebUI 层 liveConfig，agent loop 层每次构建 provider（新会话/恢复/重启）都用启动时 config → 请求永远发到 deepseek。另发现第二个根因：**abort 只在轮边界检查**（main-loop 循环顶部）——abort 落在 `llm.complete()` 等待期间时当前轮仍跑完，单轮任务直接 completed → runSession finally 的"pendingInjection + running"条件不满足 → 重启被抑制（模型/供应商切换在单轮任务上失效）
- **产出**：
  - Commit: `366c6b2`（① start.ts：createWebHarness 维护 `liveConfig`（persistConfig 包装同步），runSession 用 liveConfig 构建 loop；`onConfigChanged` 回调——llm.provider/baseUrl/model 变化 → 所有 running 会话 restartLiveRun（复用模型切换的 abort+restart 路径）② server.ts/config.ts：onConfigChanged 透传（prev/next）③ main-loop.ts：`llm.complete()` 返回后补 abort 检查（轮内中断，立即 break））
  - 测试: 红→绿：full-loop +1 回归（慢 provider 运行中 PUT 切供应商 → 断言重启后的 build 用新 provider + 新会话也用新 provider）；3 个既有 Task 26 测试按新 abort 语义更新（中断轮工具不再执行：toolCount 1→0；PATCH 测试脚本改为重启后执行工具）；主套件 552/552 + client 192/192 + 双 tsc 干净
- **人工干预**：无
- **教训**：
  - **WebUI 层配置与 agent loop 层配置是两个世界**：应用按钮（PUT /api/config）只影响 WebUI 层，loop 的 provider 每次从"构建时传入的 config"取——不共享 liveConfig，切换就只停留在界面层。跨层状态必须显式共享（persistConfig 包装同步 + runSession 读同一引用）
  - **abort 语义要覆盖"调用中"而非只"轮间"**：signal 只在轮边界检查时，慢 LLM 调用期间的中断全部失效——单轮任务直接完成导致重启被 finally 抑制。LLM 响应后补查 abort 是让中断真正生效的最小补丁；3 个既有测试因依赖旧语义（中断轮工具仍执行）而红——语义变更要同步审视依赖该行为的测试
  - **用户的一句"还是 deepseek"同时暴露了两个层的问题**：先修 loop 层快照（新会话用新供应商），再发现 abort 边界问题（运行中切换失效）——真实测试的"再测一次"才逼出第二层

---

## 2026-08-04 01:55 真实测试反馈：LLM call failed 可诊断性增强

- **触发技能**：`test-driven-development`（红→绿）
- **Subagent**：无（主 agent 直接实现——用户真实测试反馈）
- **Prompt 要点**：用户应用 nju（baseUrl `https://njusehub.info/v1`）后发消息报 "LLM call failed: 404 openai_error"——裸错误无法判断是端点问题还是协议问题（404 + 非 JSON body = 路由不存在；模型错误通常是 400 带 JSON）。用户确认增强错误消息
- **产出**：
  - Commit: `27d320b`（deepseek-provider.ts：complete 的 create 包 try/catch——HTTP 错误（数字 status）抛增强消息：`LLM API 调用失败（{baseUrl}/chat/completions，HTTP {status}）：{原始消息} 响应：{body 前 200 字符}——请检查 API 地址是否为 OpenAI 兼容端点（通常以 /v1 结尾）`；非 HTTP 错误（网络）原样透传；provider 增加 readonly baseUrl 字段；测试 +2：增强断言（URL/HTTP 404/兼容提示/响应片段）+ 非 HTTP 透传）
  - 测试: 红 1 → 绿 19/19；主套件 554/554 + client 192/192 + 双 tsc 干净
- **人工干预**：无
- **教训**：
  - **裸 SDK 错误对多供应商场景不可接受**：单供应商时代 "404 openai_error" 尚可猜；多供应商后错误必须自带"发到了哪、什么状态、服务回了什么"——可诊断性随配置自由度同步提升
  - **instanceof 判断在 mock 环境不可靠**：测试里 OpenAI 被 vi.mock 成 vi.fn()（无 APIError 属性）——用鸭子类型（数字 status）判断 HTTP 错误，比 instanceof 稳

## 2026-08-04 02:15 真实测试反馈：三个 WebUI 状态同步问题（供应商信息编辑刷新 / 激活供应商端点同步 / 会话详情 tab 记忆）

- **触发技能**：`test-driven-development`（红→绿 ×4）、`requesting-code-review`（两阶段评审）
- **Subagent**：评审 subagent `a7483e23646838875`（两阶段评审：spec 合规 + 代码质量）
- **Prompt 要点**：用户三个实测问题——① 供应商处更新 baseURL 后需刷新页面左侧才显示新值；② API Keys 板块修改供应商信息后需"先应用别的供应商再重新应用 + 刷新"下方配置才更新；③ 多会话时从会话详情切走再切回总打开第一个会话
- **产出**：
  - 根因：① KeyRow handleSave 成功后不通知父级（KeyManagementCard.meta 是行内 baseUrl 显示源）② 后端 POST /api/keys 只写 registry（llm.providers）不同步激活供应商的 llm.baseUrl + 前端 Settings.config 保存后不重拉 ③ App.tsx SessionDetailTab 恒跳 sessions[0]
  - 修复：① KeyRow 加 onSaved → KeyManagementCard load() 重拉 + Settings 重拉 fetchConfig（onRegistryChanged 链）② keys.ts：`provider === config.llm.provider && hasBaseUrl` 时同一 persist 内同步 llm.baseUrl；评审后补 onConfigChanged 触发（运行中 loop 重启契约）③ App.tsx：sessionStorage 记忆 lastSessionId（pathname useEffect 记录；点击 tab 优先跳 lastSessionId，会话被删回退 sessions[0]；decodeURIComponent try/catch 防畸形 % 编码白屏）
  - 评审修复：Important×1（keys POST 绕过 onConfigChanged → 注入回调 + 测试）、Minor×3（decodeURIComponent 防御、key-only 保存不重拉 config、非激活供应商负向断言测试）
  - 测试: 红 4 → 绿：webui-api 64/64（+3：同步、负向、onConfigChanged）、client 196/196（+4：行内刷新、下方配置刷新、tab 记忆、key-only 不重拉）、主套件 555+ / 双 tsc 干净；顺带修 tsc -b 增量缓存暴露的既有错误（models 窄化、relativeToRoot 删除、config prop 删除）
- **人工干预**：无
- **教训**：
  - **tsc -b 增量缓存会遮蔽既有错误**：只重编译"变化的文件及其依赖图"——Settings.tsx 的 models 窄化错误一直存在，直到本次改动触发重编译才暴露。全量验证时对常改文件应跑 `tsc -b --force` 或清理 .tsbuildinfo，不能只信增量结果
  - **getByText 的精确匹配对相邻文本节点无效**：行内 `{baseUrl}{defaultModel ? ...}` 两个相邻文本节点合并进父元素 textContent，`getByText(url)`（exact）匹配失败——URL 断言要用正则。jsdom 里 textarea.value 会反映为文本内容（配置编辑器里的旧 JSON 会匹配 queryByText）
  - **userEvent.click 的 await 会先 flush handler 的 async 链**：click 后同步更新 mock 状态（rows 变量）太晚——handler 的 load() 已用旧状态执行。mock 状态更新要放在 click 之前（等价于预置 mockResolvedValueOnce）
  - **前端两层状态源（列表 meta vs 页面 config）必须同源刷新**：保存 registry 只刷新列表，下方卡片不跟；两层都刷新，但"纯 key 保存"不该触发（静默丢弃未保存的模型表单编辑）——刷新粒度要匹配"实际变化了什么"<｜end▁of▁thinking｜>

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="Bash">
<｜｜DSML｜｜parameter name="command" string="true">tail -5 "C:\Users\ISSUE\AppData\Local\Temp\claude\c--Users-ISSUE-Desktop-se-summer\2e36ca82-8bbb-46fc-a2ed-c5ee2e7d5d6e\tasks\b5vsa5akz.output" 2>/dev/null || echo "still running"

## 2026-08-04 02:35 真实测试反馈：配置编辑板块不跟随 config 变化（三卡同源）

- **触发技能**：`test-driven-development`（红→绿 ×3）、`requesting-code-review`（上轮评审遗留观察）
- **Subagent**：无（主 agent 直接修复——用户真实测试反馈）
- **Prompt 要点**：用户实测"编辑激活供应商端点后，模型与护栏处立即更新了，但配置编辑处的配置显示还是要刷新后才更新"。上轮评审曾把"编辑器保留自己快照"判定为合理，用户预期是三板块同源——按用户预期修正
- **产出**：
  - 修复（`src/webui/client/src/pages/Settings.tsx`）：① ConfigEditorCard 接收共享 config prop + 同步 effect——外部 config 变化时编辑器文本跟随（baselineRef 脏检测：`text !== baseline` 时用户正在编辑，不覆盖）② 保存成功后 `baselineRef = text` + `onSaved(merged)` → Settings setConfig → 模型与护栏/通用卡跟随（双向同源）③ stripSecrets 提取为 useCallback（load 与同步 effect 共用）
  - 测试: 红 2 → 绿：client 199/199（+3：编辑器跟随端点编辑、dirty 缓冲不被外部覆盖、编辑器保存传播到模型卡）；既有 "saves valid JSON" 断言适配（编辑器现在也显示 merged，`"apiKey": "****-9f2c"` 出现 2 处）
- **人工干预**：无
- **教训**：
  - **编辑缓冲与外部快照的冲突用 baseline 脏检测解决**：外部 config 变化时，`text !== baseline`（用户未保存的编辑）→ 跳过覆盖；等于 baseline → 跟随。保存成功即提升 baseline——"所见即真实持久化状态"
  - **方向性判断要听用户真实预期**：评审时把"编辑器保留自己的快照"判定为合理取舍，但用户实测后明确期望三板块同源——真实测试的预期优先于评审的技术判断
  - **保存后的编辑器显示 merged 是增值**：用户保存后立即看到脱敏合并结果（含 apiKey 掩码字段），而不是保留自己未保存的局部视图——测试断言从 getByText 改为 getAllByText 适配

## 2026-08-04 13:35 KNOWN_ISSUES 修复：9.5 parseActions 误判 Markdown 为 JSON + 1 CLI 暂停恢复指引

- **触发技能**：`systematic-debugging`（根因来自真实会话 a4b7e7fe 的完整消息序列）、`test-driven-development`（红→绿 ×2）、`requesting-code-review`
- **Subagent**：评审 ade4b3e5（两阶段：spec 合规 + 代码质量）
- **Prompt 要点**：用户实测"只是让 AI 用 md 格式写一段话，AI 却回复了三次"——curl `/api/sessions/:id` 拿到完整记录：assistant(markdown 含 `[链接](…)`) → feedback parse_error → assistant → feedback parse_error → assistant(无括号) → completed。currentRound=3 恰好坐实 KNOWN_ISSUES 9.5
- **产出**：
  - 修复 1（`src/core/main-loop.ts` parseActions）：旧启发式 `content.includes('{') || content.includes('[')` 把文本中间出现方括号/花括号的纯文本误判为"JSON 尝试"→ 无谓 parse_error → LLM 白重写。收紧为 **trim 后以 `{` 或 `[` 开头** 才算 JSON 尝试（KNOWN_ISSUES 9.5 建议）
  - 修复 2（`src/cli/commands/start.ts` runStartTask）：maxRounds 升级暂停（triggerHITL 无 pending command → stdin 交互循环不触发）后仅输出 `[session] paused` 就退出。结束时 status=paused 追加恢复指引：重跑（提高 maxRounds）或改用 `--web` 在 WebUI 恢复（评审核实 `continueSession` 的 `maxRounds += currentRound` 恢复路径属实）
  - 测试: 红 2 → 绿。新测试：① 集成 markdown 含链接+代码块（`[`/`{` 都在文本中间）→ 无 parse_error、1 轮完成 ② CLI 升级暂停 → 输出含 `--web`/`maxRounds` 指引。适配：既有 parse_error 恢复测试 fixture `'not valid json {{{}'`（新语义下是纯文本）改为 `it.each` 参数化 `{`/`[` 两种真残缺 JSON 开头。评审 Minor×4 全部处理：删 trimStart 空操作、`[` 开头分支补测试、fixture 加 ts 代码块（贴近 9.5 原始复现）、文案"需要人工批准"收紧为"升级暂停"
  - 全量：主套件 560/560（+3）、client 199/199、双 tsc 干净
- **人工干预**：无
- **教训**：
  - **真实会话记录是最好的 bug 报告**：用户一句"回复了三次"背后，`/api/sessions/:id` 的完整消息序列直接展示了根因链条（含 feedback 的 failureCategory/strategy 元数据）——先拉数据再猜
  - **启发式判定的关键特征是"位置"不是"存在"**：`[` 在 Markdown 里无处不在（链接、引用代码），只有以 `{`/`[` **开头**的文本才可能是内联 JSON——同理可推广到其他"contains → startsWith"型启发式
  - **升级暂停与 warn 暂停的恢复路径不同**：warn 暂停有 pending command（stdin y/n 交互）；升级暂停无（只能 WebUI 恢复或重跑）——指引文案必须对应真实可用的恢复路径，评审逐条核实了 `--web` 恢复语义后才算数

## 2026-08-04 14:30 KNOWN_ISSUES 2 修复：read_file BOM 驱动的编码探测

- **触发技能**：`test-driven-development`（红 7 → 绿）、`requesting-code-review`（派发评审 ade4b3e5 之前轮）——本轮评审 a5b1c472 发现 2 Important + 3 Minor，全部修复
- **Subagent**：评审 a5b1c472；方案调研 claude-code-guide a4f627c5（Claude Code 官方编码处理对比）
- **Prompt 要点**：用户三个连续设计问题——①"不能支持所有编码吗"（无 BOM 时编码不可判定，GB18030 会把 UTF-8 解成乱码且无报错，实验验证）②"Claude Code 是怎么做的"（调研结论：官方零编码探测，裸 UTF-8 宽容解码 + 静默 U+FFFD，BOM 都不处理；社区镜像曾有 BOM→fatal→ICU 同构实现后被 revert，证明路线可行）③"不支持的编码会让 LLM 用 Bash 兜底吗"（设计决策：错误提示显式给 `file`/`iconv` 兜底路径——把 Claude Code 里"模型自己悟"的策略变成 harness 写明的确定性指引）
- **产出**：
  - 修复（`src/tools/read-file.ts`）：`decodeFileBuffer`——UTF-8 BOM 剥 3 字节；UTF-16LE/BE 剥 BOM + `TextDecoder(..., {fatal:true})`（奇数长度、孤立代理 → per-file error）；UTF-32LE/BE 手写解码（Node TextDecoder 无 utf-32 标签，%4 长度校验 + 码点范围校验，代理区显式拒绝——`String.fromCodePoint` 对 U+D800–DFFF 不抛错）；无 BOM → UTF-8 fatal 严格校验，失败返回带 `file`/`iconv` 指引的明确错误
  - 测试: 红 7 → 绿 + 评审补 6 = 21/21（UTF-16LE/BE、UTF-32LE/BE、UTF-8 BOM 剥离、GBK 无 BOM → iconv 提示、batch per-file 容错、奇数长度 ×2、UTF-32 截断/非法码点/孤立代理、BOM-only）
  - 评审修复：Important×2（UTF-16 奇数长度静默丢字节——`Buffer.toString('utf16le')` 不报错；UTF-32 尾部 1-3 字节静默丢弃——统一 fatal + 长度校验）、Minor×3（代理区码点显式检查、UTF-32 错误消息带 `file` 指引、补边界测试）
  - 全量：主套件 573/573（+13）、client 199/199、双 tsc 干净
- **人工干预**：无
- **教训**：
  - **"支持所有编码"在信息论上不可能**：无 BOM 时同一字节序列在 UTF-8/GBK/Shift-JIS 下都合法（实测：GB18030 把 UTF-8"你好"解成"浣犲ソ"无报错）——启发式猜编码会把乱码合法化，比乱码更糟。正确策略："BOM 全覆盖 + 无 BOM 明确失败"
  - **对标 Claude Code 反而印证了我们的设计**：官方零编码探测（静默 U+FFFD 不可逆、BOM 不处理、Edit 还破坏 BOM），社区同构实现（BOM→fatal→ICU）被 revert——"正确或明确失败优先"是我们比业界标杆更优的取舍，也是"机制由代码而非提示词/模型判断"命题的实例
  - **解码器边界要实测，不能凭 API 直觉**：`Buffer.from(str, 'utf16be')` 抛 ERR_UNKNOWN_ENCODING（Buffer 编码表没有 utf16be）；`String.fromCodePoint(0xD800)` 不抛错（代理区静默通过）；`TextDecoder` fatal 模式才是统一严格路径——评审的 2 个 Important 全是"静默数据损坏"路径，都是 Node API 的隐蔽行为
  - **测试构造要自校验**：UTF-32 截断测试第一次红在测试自身（'好' 只有 4 字节，subarray(0,6) 截不出 6 字节）——测试 fixture 的字节数要先心算验证

## 2026-08-04 15:20 KNOWN_ISSUES 3/4 修复：统一环境前提检查 + npx 下载陷阱

- **触发技能**：`test-driven-development`（红 4 → 绿）、`requesting-code-review`（评审 a61da146）
- **Subagent**：评审 a61da146
- **Prompt 要点**：用户"继续"推进 KNOWN_ISSUES 3/4（一族：环境前提检查）。设计决策：① 检查对象用 `node_modules/.bin` 存在性（package.json 声明检查会漏 monorepo——声明了没装 / 装了没声明）② run_shell 不拦 npx（agent 合法工具，守卫只落在确定性代码路径：工具/校验器）③ 校验器 skip 语义与既有"无配置 → 跳过"同构（passed:true + evidence 含 skipped）④ 保留 npx 调用（npx 优先解析本地 .bin，有 bin 就不下载），只加前置检查
- **产出**：
  - 新建 `src/utils/env-prereq.ts`：`hasLocalBin(root, bin)`——检查 node_modules/.bin 下 sh / .cmd / .ps1 三种变体（Windows shim 是 .cmd/.ps1）
  - 接入 4 处：① run_test 无 vitest → `success:false` + 错误含 `npm i -D vitest` 指引（不触发 npx 下载）② TestResultValidator 构造器加 hasVitest 注入，无 → passed:true + skipped ③ eslint 有配置无 bin → skip ④ tsc 有 tsconfig 无 bin → skip（**`npx tsc` 废弃包 tsc@2.0.4 陷阱根除**）
  - 测试: 红 4 → 绿：validator skip ×3（构造器注入 `() => false`）、run_test 无 bin 工作区（真实 mkdtemp 无 node_modules）；hasLocalBin 直测 ×4（sh/.cmd/.ps1/不存在）；现有 30 个测试 beforeEach 适配注入 `() => true` + run-test 测试造 fake bin 文件（真实环境形状）
  - 评审 Minor×4 全部处理：裸目录清理改 try/finally、.ps1 分支补直测、tsconfig.tsbuildinfo 删除（.gitignore 按 §12.2 基线不可加条目）、import 顺序
  - 全量：主套件 581/581（+8）、client 199/199、双 tsc 干净
- **人工干预**：无
- **教训**：
  - **"无配置跳过"的既有模式有盲区**：eslint/tsc 只查配置文件存在性——tsc 有 tsconfig 但没装 TypeScript 时 `npx tsc` 仍会下载废弃包。环境前提检查要查 **bin 存在性**（配置 + 运行时两层），"统一封装"不是复制模式而是抽象出共享函数（hasLocalBin）
  - **注入参数一律追加在尾部**：3 个 validator 构造器 (exec, hasConfig) → (exec, hasConfig, hasBin)，14 个调用点 grep 确认无遗漏；真实默认值路径（无参构造）由集成测试覆盖（裸临时目录 hasConfig 先短路）
  - **skip 与失败语义分层**：校验器层 skip（passed:true，环境噪音不反馈给 LLM 当代码错误）；工具层明确失败（success:false + 可操作错误）——同一前提检查，两层语义不同，因为消费者不同（校验器结果进反馈闭环、工具结果给 agent 决策）

## 2026-08-04 16:05 KNOWN_ISSUES 5 修复：system prompt 注入平台感知

- **触发技能**：`test-driven-development`（红 → 绿）、`requesting-code-review`（评审 a1e44df8）
- **Subagent**：评审 a1e44df8
- **Prompt 要点**：用户"继续"推进 KNOWN_ISSUES 5（Windows 工具差异——agent 调 `xxd` 必失败）。调研发现：harness 原本**无主 system prompt**（只有 HITL 语义说明一条 system 消息），LLM 只能靠踩坑学习平台限制。方向选 KNOWN_ISSUES 建议第一项（system prompt 注入平台感知）而非工具层适配——环境知识由 harness 写死注入，不靠模型经验
- **产出**：
  - 新建 `src/utils/platform-guidance.ts`：`platformGuidance(platform)` 纯函数——win32 返回多行提示（`xxd`→`od -A x -t x1z`、`command -v` 确认、Git Bash 存在性限定、PowerShell 5.1 UTF-16LE 重定向、裸 npx 废弃包陷阱），linux/darwin 返回 undefined（零噪音）
  - main-loop.ts run() 初始化注入 system 消息（HITL 说明之后、round 循环之前）——**幂等守卫**（评审发现）：检查 session.messages 是否已含同条 guidance，防 resume/restart 累积（CLI 恢复、WebUI /resume、模型/供应商切换重启都会二次 run）
  - 测试: 红 → 绿：platformGuidance 单测 ×4（win32 内容断言 + POSIX undefined）+ 集成 ×2（注入可见性 + 二次 run 幂等回归，skipIf 非 win32 保 CI Linux 可移植）
  - 评审修复：Important×1（双写 vs HITL memory-only 并不同构 → resume seed 路径重复 → 幂等守卫 + 回归测试）、Minor×4（Git Bash 无条件断言改为条件限定、PowerShell 加 5.1 限定、幂等回归测试、tsbuildinfo 删除）
  - 全量：主套件 587/587（+5）、client 199/199、双 tsc 干净
- **人工干预**：无
- **教训**：
  - **"新消息注入"必须考虑 resume 路径的幂等**：run() 有 options.session 重入路径（CLI 恢复 / WebUI 重启 / 模型切换），注入任何 system 消息都要先查 session.messages——否则每次 run 累积一条且 resume seed 后 LLM 看到双份。评审抓的正是"我声称与 HITL 模式一致、实际并不一致"（HITL 是 memory-only 单写，我用了双写）
  - **环境知识写死进 harness 注入，比让模型踩坑学习便宜**：xxd→od、PowerShell UTF-16LE、npx 废弃包——三条都是真实测试烧过轮次的教训，固化为 platformGuidance 后每条会话首次 LLM 调用即见，零试错成本；纯函数 + 平台参数注入使测试与 CI 平台无关
  - **文案里的每个事实断言都要有出处**：评审逐条核对了 Git Bash 条件限定（resolveShell 有回退）、PowerShell 5.1 限定（pwsh 7 默认 UTF-8）——给 LLM 的环境说明错了就是新的误导来源，与错误代码同罪

## 2026-08-04 15:15 KNOWN_ISSUES 9.6 修复：run_test 剥离 ANSI 后解析

- **触发技能**：`test-driven-development`（红 → 绿）、`requesting-code-review`（评审 af1d1f03）
- **Subagent**：评审 af1d1f03
- **Prompt 要点**：用户"继续"推进 KNOWN_ISSUES 9.6（run_test 无 pattern 行为不明确）。根因调查（systematic-debugging）：真实抓取 `npx vitest run` 输出（cat -v 看不可见字符）发现 vitest v2.1.9 **pipe 下仍输出 ANSI SGR 颜色码**（`ESC[32m✓ESC[39m path`、`ESC[1mESC[32m48 passedESC[39m`）——旧正则假设 ✓ 后直接是文件名、summary 数字直接跟在 Test Files 后，全部匹配失败 → fallback 也失败 → 恒返回 `{passed:false, results:[]}`，**587 个测试全过也报失败**。现象"无 pattern 时"最明显只是巧合（summary 行多），实际任何调用都解析失败
- **产出**：
  - `src/tools/run-test.ts`：① `stripAnsi()` 解析前剥离 CSI 序列（`/\x1b\[[0-9;?]*[a-zA-Z]/g`，`?` 覆盖私有序列）——根因修复 ② summary 行解析重构：`2 failed | 46 passed (48)` → false、`48 passed (48)` → true、全 failed → false ③ 解析完全失败（新版本/语言/包装器）→ output 附 `rawOutput`（截断 4000 + 显式标记）替代静默 `{passed:false}` ④ output 附 `command` 字段（agent 知道实际执行了什么）
  - 测试: 红 3 → 绿：真实 ANSI per-file 行 fixture、仅 summary 行、rawOutput 回传；CR 后 +3：skipped 行误报回归（红 → 绿）、全 failed summary、4000 截断边界
  - 评审：Verdict 正确——fixture 与 vitest 2.1.9 dist 内部渲染（`testPass="✓"`、`suiteFail="❯"`、dim 包裹计数）逐一核实。**Important×1**：`❯ path (5 tests | 1 failed | 2 skipped)` 的 `| 2 skipped` 后缀使正则不匹配失败行——若其他文件 ✓ 行匹配则短路 `passed:true`（有失败文件也报全过）→ 修复：per-file 分支也 consult summary 行 `summaryFailed` 兜底。Minor×3：截断边界补测、all-failed summary 补测、stripAnsi 加 `?`、`(\d+)ms` 降级注释
  - 全量：主套件 593/593（+6）、client 199/199、双 tsc 干净
- **人工干预**：无
- **教训**：
  - **解析类工具的 fixture 必须来自真实输出**：旧测试用手写理想格式（无 ANSI）所以全绿，真实世界一行颜色码就打穿。这次 fixture 直接从真实 `npx vitest run | cat -v` 抓取，评审还对照 vitest dist 源码验证了渲染逻辑——测试诚实性的标准是"fixture 与真实输出逐字节同构"，不是"测试覆盖了代码路径"
  - **聚合判定不能只看单层证据**：per-file 行最详细但正则可能漏（skipped 后缀），summary 行最可靠但无细节——两层都要读，per-file 通过后仍要 summary 兜底防误报。单层短路（`results.length > 0` 就返回）正是旧代码的隐藏缺陷
  - **execSync 抛错时 stdout/stderr 是 Error 的附加属性**，message 只有 stderr 截断——catch 分支必须拼 `(execError.stdout || '') + (execError.stderr || '')` 才能拿到完整输出喂给解析器，否则失败场景解析永远是空

## 2026-08-04 15:50 KNOWN_ISSUES 7 修复：scope-fence canonical 校验

- **触发技能**：`test-driven-development`（红 → 绿）、`requesting-code-review`（评审 a678abc6）
- **Subagent**：评审 a678abc6
- **Prompt 要点**：用户"继续#6#7"推进 KNOWN_ISSUES。头注释"future hardening"已在 Task 8 写明局限——本次落地 realpath 校验。设计约束：write_file 目标可能不存在（realpathSync 抛 ENOENT）→ "最近存在祖先 realpath + 词法尾部重挂"；Windows junction 无需管理员（测试可真实跑）；win32 盘符大小写归一
- **产出**：
  - `canonicalize()`：ENOENT/ENOTDIR 走 walk-up（叶子不存在不可能被 symlink，截断安全）；**fail-closed（评审 Important）**：ELOOP/EACCES/EMFILE 返回 null → validatePath 拒绝——否则叶子可能是真实逃逸 symlink 而截断路径被"未验证接受"（评审运行时验证 `canonicalize(root/new) → root` 丢叶子）
  - 两层校验：词法快路径（根外零 IO 拒绝）→ canonical 比较；canonical root 按 workspaceRoot memoize（**评审 Important**：热路径每次工具动作 2 次 realpathSync 多级 walk-up → 缓存后单 realpath）
  - 测试 +5：junction 逃逸 ×2（含深层 root/sub/esc）、根内真实路径放行、不存在写入目标放行、ELOOP 双向循环 fail-closed（self-symlink 在 Windows 被 EPERM 拒绝，改 a→b、b→a 双向循环）
  - 全量：主套件 606/606（+8）、client 199/199、双 tsc
- **人工干预**：无
- **教训**：
  - **canonicalize 的截断路径是隐式信任漏洞**：walk-up 丢叶子在 ENOENT 时安全（不存在的叶子不可能被 symlink），但 catch-all 会吞 ELOOP/EACCES 也走截断——"最近存在祖先"算法只在缺失路径上有语义，其余错误必须 fail-closed。评审给了运行时证据（canonicalize(root/new) → root），我不该只靠推演
  - **Windows 测试要先验证链接创建能力**：junction 免管理员可测 symlink 逃逸，但 self-symlink 被 EPERM 拒绝（Windows 拒绝自指链接）——用双向循环替代；链接能力仍可能因文件系统（无 reparse 支持）失败，skipIf 探测兜底
  - **词法快检不只有性能价值**：先拦根外路径也避免对越界路径做无谓 realpath——fail-closed 与 fast-path 分层后，每个校验动作只对"看似合法"的路径付 IO 成本

## 2026-08-04 16:10 KNOWN_ISSUES 6 修复：HITL 多会话键控

- **触发技能**：`test-driven-development`（红 → 绿）、`requesting-code-review`（评审 a678abc6）
- **Subagent**：评审 a678abc6
- **Prompt 要点**：用户"继续#6#7"。架构级改动：HITLManager 全局单例 → Map 键控。设计决策：① 全部方法显式 sessionId 参数（无默认 key——CLI 单会话也传 session.id，防止"忘传默认 key 隐式共享"）② `removeSession` 新方法（REPL /clear 接线；WebUI 无删除端点暂不接——条目随会话数有界增长，评审判 acceptable）③ approvals 归属校验放 404 之后、决策方法之前（400→404→409 契约保持）
- **产出**：
  - `hitl-manager.ts`：`Map<string, SessionHITL>` 惰性创建；26 个旧测试 sed 机械适配 's1'（变量命名 `a`/`b` 的确定性测试手工改）；webui-api 3 个 approvals 测试重排（真实流程：先建会话拿 id 再 requestApproval）
  - main-loop 4 个调用点传 session.id；repl/start 循环传 session.id；`/clear` 改 `removeSession(session.id)`——**行为变化**（注释文档化）：键控后新会话新 id，重发已批准命令需重新确认，比旧共享 cache 更安全
  - **行为变化**（M5 CR 文档化决策修订）：旧 "cache per-HITLManager lifetime" 在新会话边界失效——KNOW_ISSUES/AGENT_LOG 记录
  - 评审：Important×1（fail-open，见 #7 条目）+ Minor×4（approvals getState 双调用复用、removeSession 单测 ×2、try/catch 防御注释、KNOWN_ISSUES 未更新）
  - 全量：主套件 606/606（+9：键控 ×4、approvals 归属、main-loop 集成 ×1、removeSession ×2、ELOOP）、client 199/199、双 tsc
- **人工干预**：无
- **教训**：
  - **sed 机械适配的坑**：`hitl.requestApproval(\([^)]*\))` 会把已带双参的新测试也改坏（`[^)]*` 贪婪匹配 `'sess-a', 'cmd-a'`）——先跑出 5 个红，逐个看是"真实红"还是"适配红"。适配类变更要 grep 出所有形状再写模式，变量命名（a/b 而非 hitl）是漏网点
  - **API 签名变化时测试顺序也是契约**：approvals 测试"先 requestApproval 后建 session"在键控后语义颠倒（pending 归属尚未存在的会话）——重排成真实流程（session 先存在）本身就在验证时序契约
  - **键控让既有"安全折衷"更安全**：M5 的 cache 保留语义在共享实例下是便利性折衷；键控后新会话自然隔离，重确认成本换来的安全增益是设计副产品而非妥协


## 2026-08-04 17:10 KNOWN_ISSUES 9 修复：WebUI 三项占位 + 单会话删除

- **触发技能**：`test-driven-development`（红 → 绿）、`requesting-code-review`（评审 a9ad6ede）
- **Subagent**：评审 a9ad6ede
- **Prompt 要点**：用户指令——搜索框已删，完成其余三个占位项；新增需求：会话列表支持单会话删除。设计决策：① 删除语义：running 会话 409 拒绝（live loop 拥有会话，先停再删）；批量清空保留 running 并返回 `keptRunning`（200 + 部分保留 > 生硬 409）② Token 明细与既有 `tokenCount` 并存：usage 是 API 实际计费、tokenCount 是 memory 层上下文估算，语义注释区分 ③ 终端 tab 用独立纯函数 reducer（与消息 feed 消费方/保留策略不同）④ wire 帧无 timestamp → 接收时注入（保持 reducer 纯）
- **产出**：
  - 后端：`DELETE /api/sessions`（批量）+ `DELETE /api/sessions/:id`（404→409→200）+ `SessionStore.remove`；`TokenUsage` + `LLMResponse.usage` + `Session.tokenUsage`；DeepSeek 提取 `usage.prompt_tokens/completion_tokens/prompt_cache_hit_tokens`（typeof 守卫，无 usage 时 undefined）；main-loop `accumulateUsage` 每轮累积
  - 前端：Dashboard 行删除按钮（running 禁用 + title 解释）、Settings 两步确认清空（"清空会话" → "确认清空？"）、SessionDetail Token 明细（输入/输出/缓存命中/总计 + 上下文估计）、终端 tab 实时事件流（按 kind 着色：tool=primary、guardrail=danger、status=success、round=warning）
  - 测试 +19；评审修复 +3 测试（key 唯一、now 注入、删除错误路径）
  - 全量：主套件 614/614、client 216/216、双 tsc 干净
- **人工干预**：无
- **教训**：
  - **评审抓的"wire 帧无 timestamp"是字段级设计遗漏**：五个事件类型的 HarnessEventMap 定义里本就没有 timestamp（message:added 有），终端 tab 直接用 data.timestamp 恒空。跨组件（events.ts → server 广播 → reducer）的字段契约要先核对再写消费端，纯函数加 `now` 参数比污染 frame 干净
  - **500 行上限的 key 复用是纯函数里最隐蔽的 bug**：`String(lines.length)` 在 cap 后恒为 500——React 重复 key 不报错只错乱，测试只断言了长度没断言 key 唯一。评审给的 max+1 纯方案避免了模块级计数器破坏 reducer 确定性
  - **JSX 三元分支插错误横幅要记得包 fragment**：单根限制下 `<table>` 变双兄弟直接 parse error——改 UI 结构时先想根节点数
  - **jsonInit('DELETE', undefined)** 与 deleteKey 的裸 `{method:'DELETE'}` 并存无碍（stringify(undefined) 无 body），评审只记 nit——一致性整理留给未来



## 2026-08-04 19:35 KNOWN_ISSUES 验收反馈：Token 明细实时化 + 单删两步确认

- **触发技能**：`systematic-debugging`（根因调查）、`test-driven-development`（红 → 绿）、`requesting-code-review`（评审 a0c5cf70，复核同 agent）
- **Subagent**：评审 a0c5cf70（两轮：初审 + 修复后复核）
- **Prompt 要点**：用户在 B9 手工验收（TESTING.md）中发现两个问题：① 会话完成后 Token 使用区不刷新不更新 ② 单删无确认易误操作。根因调查：WS 帧（session:status/round:changed）只带 status/rounds，tokenUsage 在 loop 结束时才定稿写入 REST 快照（main-loop accumulateUsage），SessionDetail 的 `session` 是**挂载时 fetch 一次**的 REST 快照 → 完成后必须刷新才看到明细。修复 A 设计：终态重取（completed/failed）——评审后迭代出 load('refresh') 模式（不翻转 phase，后台失败静默保活）+ fetch 代际守卫。
- **产出**：
  - 修复 A：SessionDetail `snapshotStatusRef` + 终态重取 effect（恰好一次/离开终态 re-arm/挂载终态不取）；`load(mode)` 初始/刷新两模式 + `fetchGenRef` 代际守卫；failed 纳入终态
  - 修复 B：Dashboard `confirmDeleteId` 两步确认（armed 态按钮变「确认删除」+ dangerSoft 底 + 宽扩展，3s 自动解除，同一时刻仅一行 armed，running 禁用不变）
  - 测试 +5（SessionDetail ×4：保活/失败态/挂载终态不取/恢复后再取；Dashboard ×1：单行 armed 转移）；既有删除测试 ×2 改两步
  - 全量：client 222/222、主套件 614/614、双 tsc 干净
  - Commits：`efad265`（首轮修复）、`5fcdd0b`（评审修复：phase 保活 + failed + 代际 + 按钮宽度）
- **人工干预**：无（评审 Important×1 + Minor×3 全部处理；Minor 未做：3s 自动解除的 3 秒实时测试（成本>价值）、unmount cleanup 测试）
- **教训**：
  - **"刷新才更新"类问题先查数据源归属**：WS 实时流与 REST 快照各自携带不同字段（status 实时、tokenUsage 终态定稿），UI 混用两者时以"哪个字段在哪个通道"画清边界，比无脑全走 WS 或全走 REST 干净
  - **终态重取的防双发守卫必须在 await 之前置位**，否则 effect 二次运行（fetch 期间状态未变）会重复请求——评审关注点，测试用 waitFor(callTimes(2)) 钉死
  - **后台刷新不得复用会翻转 phase 的加载函数**：评审 Important 抓的是"修复本身引入了新失败模式"（重取失败 → 全屏错误页），模式复用要检查副作用边界
  - **测试基建的隐藏坑**：`renderDetail()` 内部会重新 `mockResolvedValue(SESSION)`，手动先设的 mock 被覆盖——fixture 必须走 renderDetail 参数传


## 2026-08-04 20:25 KNOWN_ISSUES 验收反馈：CLI 输出降噪 + 对话视觉区分

- **触发技能**：`test-driven-development`（红 → 绿）、`requesting-code-review`（评审 a630ea49 + 复核 ace7b1f1）
- **Subagent**：评审 a630ea49（两阶段初审）+ ace7b1f1（修复后复核）
- **Prompt 要点**：用户在 REPL 真实对话中发现输出杂乱：① `codeharness> 运行命令：…`（readline 回显）之后 `[user] 运行命令：…` 又重复一遍 ② 除 user/assistant 外还有 `[session] running`、`[assistant]`（空头）、`[tool:run_shell]`、`[session] completed` 等行。用户问"只显示用户消息和 AI 回复是否更好？"——方案评审后定「智能降噪 + 视觉区分」（不删 tool 行：删了运行中全静默；[user] 只在 REPL 滤：start 单跑模式无回显必须保留）。
- **产出**：
  - `formatMessageLine(data, color?)` 返回 `string | null`：空 content 且无 toolName → null（不打空头）；TTY 下标签着色（user 绿 / assistant 青 / tool·system·feedback·[session] 灰，正文不着色防多行污染）
  - REPL onMessage 滤 `role==='user'`（echoInput 门控：`io.echoInput ?? true`，createTerminalReplIO 按 `input.isTTY === true` 设置——管道输入保留 [user] 行）；onStatus 只打非 running/completed 状态（paused/failed 保留，暂停指引前导行）
  - start 单跑模式：只滤状态行 + 空头（[user] 保留）
  - 测试 +6（起始 618 → 623）；全量主套件 623/623、双 tsc 干净
  - Commits：`009ee38`（降噪+着色）、`2d8cd4e`（评审修复 4 Minor）
- **人工干预**：评审 5 Minor 修 4（feedback 灰 / echoInput 管道可见 / 着色 e2e / 单跑空头断言），Minor 4（ANSI 常量归属）按评审认可保留；复核新 Minor ×2：解构统一（顺手做掉）、管道续接覆盖（共用同一过滤分支风险极低，跳过）
- **教训**：
  - **"是否只显示 X 和 Y"的直觉需求要拆开分析**：用户觉得乱的三类行里，只有两类是真噪音（重复回声、空头、终态状态行），tool 行是高价值过程可见性——全删会引入"运行中全静默"的新问题。逐行问"删掉后失去什么"再决定
  - **"readline 已回显"是 TTY 假设**：node readline 不回显管道输入——回声过滤的正确判据是 `input.isTTY`（echoInput），评审 Minor 2 抓的正是这个边界；脚本捕获（`echo ... | codeharness | tee log`）场景 [user] 行是唯一指令可见性
  - **着色只在 TTY 启用是硬规则**：管道/重定向输出带 ANSI 码会污染脚本捕获——`isTTY === true` 两处（输出着色、输入回显）分开检测，语义不同不能共用一个标志
  - **REPL 测试等待在途信号不能依赖被降噪的行**：Ctrl+C 测试原来 waitFor `[user] long task` 打印——降噪后改用 provider calls 计数（gate 前递增），等待信号与输出解耦


## 2026-08-04 21:00 分发功能 Task 1：server 生产模式静态服务（staticDir + SPA fallback）

- **触发技能**：`subagent-driven-development`（派发 implementer a1561fb2）、`test-driven-development`（红→绿）、`requesting-code-review`（评审 a476d121）
- **Subagent**：implementer a1561fb2（haiku，机械转写——计划含完整代码）
- **Prompt 要点**：需求源 = task-1-brief.md（计划提取，含逐字测试与实现代码）；纪律 = /test-driven-development 红→绿→重构 + CLAUDE.md commit 格式（subagent 标注）。implementer 顾虑：环境无显式 agent ID，用会话 ID 前 8 位 `2e36ca82` 标注（主 agent 确认可接受）；未提交的 repl.ts 变更与任务无关未纳入 commit
- **产出**：
  - Commit: `006d448`
  - 涉及文件: src/webui/server.ts（WebUIServerDeps.staticDir + 静态挂载 + SPA fallback）、tests/integration/webui-static.test.ts（新建 4 测试）
  - 测试: 4/4 新（先红后绿），全量 627/627（623 + 4），双 tsc 干净
- **人工干预**：① 补提交遗漏的解构统一（`715aad1`，repl.ts echoInput——b58f1e5 文档 commit 时漏 add，属上一批次遗留）② pre-flight 修计划 killProcessTree 断言参数不一致（`009ee49`）
- **教训**：
  - **sdd 派发前必须确认工作区干净**：implementer 报告提示 repl.ts 未提交变更——是我上次解构统一后文档 commit 只 add 了 3 个文档文件，代码改动漏掉了。评审包 BASE 记录在派发前，遗漏变更会混入 diff 或污染后续 commit
  - **express 路由顺序即安全边界**：/api 404 兜底 → static → SPA fallback → error handler——`/api/*` 被兜底终结，即使 build 产物含 api/ 目录也不受影响
  - **app.get('*') 只匹配 GET/HEAD**：方法检查 `req.method !== 'GET'` 对 GET 永不生效（brief 原样代码，评审确认行为符合需求）


## 2026-08-04 21:35 分发功能 Task 2：start --web 生产模式接线 + dist 缺失报错 + npm link

- **触发技能**：`subagent-driven-development`（implementer a94d0d5a + fix resume 同 agent）、`test-driven-development`、`requesting-code-review`（评审 aa6b6192）
- **Subagent**：implementer a94d0d5a（haiku）
- **Prompt 要点**：需求源 = task-2-brief.md；关键补充——npm link 后只验证 `codeharness --version`（`start --web` 启动验证留给主 agent/用户，避免占终端）；fix 轮：full-loop CI 回归风险 + 冗余 import（评审前处理）
- **产出**：
  - Commits: `90e3778`（接线）、`c4d7724`（fix：full-loop fixture staticDir + 删冗余 import）
  - 涉及文件: src/cli/commands/start.ts（resolveStaticDir 导出 + createWebHarness 校验/接线）、tests/integration/webui-static.test.ts（+3 测试）、tests/integration/full-loop.test.ts（makeHarness fixture staticDir）
  - 测试: 7/7（webui-static）、full-loop 19/19（含 CI 模拟：移走真实 client/dist 仍绿）；全量 630/630、双 tsc 干净；`codeharness --version` → 0.1.0（npm link 已保留）
- **人工干预**：① implementer 发现 brief off-by-one（4 层 '..' 落在根上一级 → 3 层，已实测 src/dist 双布局验证）② CI 模拟时 Windows 重命名被句柄锁定 → 复制+删除绕过（implementer 报告）
- **教训**：
  - **计划里的路径上溯数必须实测**：`dist/cli/commands/start.js` 到根是 3 层不是 4 层——off-by-one 直到 CI 全量回归（默认路径指向根上一级、staticDir 校验抛错）才暴露。写计划时对 `import.meta.url` 上溯应先在真实 dist 布局验证
  - **生产默认分支是最容易被测试绕开的路径**：所有测试都传显式 projectRoot/staticDir，唯二生产路径（默认解析、npm link 任意目录运行）零自动化——评审 Minor 2 提醒加默认分支断言，防 off-by-one 类回归
  - **CI 与开发机环境差异是测试确定性的一部分**：本机有真实 client/dist 掩盖了 full-loop 对构建产物的隐式依赖——CI 不构建 client 时红。测试 fixture 必须自给自足（评审透镜）
  - **3000 端口旧实例（PID 202428）**：非本会话进程，不杀；`start --web` 手动验证前需用户决策


## 2026-08-04 22:20 分发功能 Task 3：desktop 脚手架 + 主进程纯函数

- **触发技能**：`subagent-driven-development`（implementer a1319734）、`test-driven-development`、`requesting-code-review`（评审 a0f73d0d）
- **Subagent**：implementer a1319734（haiku）
- **Prompt 要点**：需求源 = task-3-brief.md；明确 .gitignore 只加批准两条；killProcessTree 延迟 require 保持 brief 原样；desktop 独立 package 的 npm install 在 desktop/ 内执行
- **产出**：
  - Commit: `cbe0a40`
  - 涉及文件: desktop/（package.json + lockfile、tsconfig.json、vitest.config.ts、src/lifecycle.ts + lifecycle.test.ts）、根 .gitignore（+2 条）
  - 测试: 6/6（desktop vitest，先红后绿）、tsc 干净
- **人工干预**：无（评审 9 Minor 全 defer，含 electron-builder 输出目录与 tsc dist 冲突的 plan 级提醒——Task 5 处理）
- **教训**：
  - **独立 package 的 vitest 会被根配置"向上捡走"**：根 vitest.config include 是 `tests/**/*.test.ts`，desktop 的 `npx vitest run` 找不到 src 测试——需要自己的 vitest.config.ts（include: ['src/**/*.test.ts']）。写计划时没预料到配置继承
  - **Windows 路径分隔符是断言层面最容易踩的差异**：测试期望字面量 `C:/app/resources/backend` 在 path.join 输出反斜杠时必败——期望值用 path.join 构造（implementer 实测修正，语义不变）
  - **electron 二进制下载在国内网络需镜像**：官方源 TLS 证书错误 → --use-system-ca 卡死 → npmmirror 镜像成功。环境处理，无代码影响；Task 4 单测不依赖该二进制
  - **tsc 的 include:["src"] 会把 *.test.ts 编入 dist**（无 exclude）——打包时会携带测试产物，Task 4/5 需加 exclude


## 2026-08-04 22:45 分发功能 Task 4：Electron 生命周期 + main 接线

- **触发技能**：`subagent-driven-development`（implementer ab2ccfdd + fix resume 同 agent）、`test-driven-development`、`requesting-code-review`（评审 ac6cf5be + 复评审 a9391de5）
- **Subagent**：implementer ab2ccfdd（haiku）
- **Prompt 要点**：需求源 = task-4-brief.md；明确不启动 electron（只 tsc 校验 main.ts 的 electron import）；顺带修 Task 3 评审的 tsconfig exclude
- **产出**：
  - Commits: `0d5fdf9`（生命周期 + main 接线）、`d2203dc`（CR 修复）
  - 涉及文件: desktop/src/lifecycle.ts（runDesktopLifecycle）、desktop/src/main.ts（electron 接线薄层）、desktop/src/lifecycle.test.ts（+3 新 +2 fix）、desktop/tsconfig.json（exclude 测试）
  - 测试: 9/9 → 11/11；desktop tsc 干净；main.ts 仅类型校验未执行
- **人工干预**：评审发现 Important（主动关闭误弹框）→ fix round 1 修复（intentional 标志 + 孤儿进程 + spawn null + 补测试），复评审 all addressed
- **教训**：
  - **Windows 强杀进程的 exit code 假设是坑**：taskkill /F 杀掉的进程 exit code 几乎不可能是 0（典型 1）——"正常退出码 0 静默"的注释假设在 Windows 不成立，评审抓出「每次关窗都弹错误框」的确定性 bug。主动/被动 kill 必须显式区分（intentional 标志），不能靠 exit code 判断
  - **失败分支的 close 空操作 = 孤儿进程**：spawn 成功但超时未就绪时没有窗口（window-all-closed 不触发）→ 进程无清理路径。评审 Minor 提醒后修复：超时分支 close 也 kill
  - **spawn 返回 null 应立即报错**：原实现空等 30s 才说"未就绪"，真相是 spawn 失败——错误语义要匹配失败点
  - **brief 里的 mock 队列顺序 bug**：test 2 首行 `.mockResolvedValueOnce(undefined)` 让首次探测 resolve → 不 spawn → 断言失败。implementer 删掉后行为才符合注释意图——写测试的 mock 序列时先心算队列消费顺序


## 2026-08-05 00:50 分发功能 Task 5：electron-builder 打包 + TESTING 验收（人工协作）

- **触发技能**：`subagent-driven-development`（派发被用户中断 → 转人工协作）、`requesting-code-review`（评审 af36b0c3 + 复评审 a1ca7a66）
- **Subagent**：无（用户手动实现 + 主 agent 修复）
- **Prompt 要点**：Task 5 派发时用户中断——safety classifier 持续不可用影响 subagent 的 Bash 操作，用户主动提出手动执行命令。分工：文件编辑（主 agent Edit/Write）+ 命令执行（用户终端）
- **产出**：
  - Commits: `b28dc04`（build 字段 + prepare-resources.mjs + TESTING B11，用户实现）、`cb1975c`（textFaint token，用户独立改动）、`918ac18`（CR 修复：backend-pack gitignore + npm prune）、`chore`（死导入清理）
  - 产物: win-unpacked + NSIS Setup exe + portable exe（82MB），backend/node_modules 73MB→20MB（prune）
- **人工干预**：用户在中断期间手动完成：package.json build 字段（含 directories.output）、prepare-resources.mjs、TESTING B11、design-tokens textFaint；打包遇到 winCodeSign 符号链接权限错误（Windows 无管理员）→ `signAndEditExecutable: false` 跳过（无签名/无自定义图标零损失）；主 agent 修 Important-1/2
- **教训**：
  - **Windows 无管理员时 7za 解压符号链接必败**（`Cannot create symbolic link: 客户端没有所需的特权`）——electron-builder 的 winCodeSign 包里含 darwin symlink，无管理员/开发者模式时解压失败重试 4 次才放弃。`win.signAndEditExecutable: false` 直接跳过该环节（无自定义图标/签名时零损失）——比让用户开管理员/开发者模式更稳，且对分发机器无影响
  - **PowerShell 不认 `VAR=value cmd` 前缀**——用户第一次跑报 CommandNotFoundException；`$env:VAR="..."; cmd` 才对。给用户命令要按他们的 shell（PowerShell 5.1）写
  - **分发体积的隐藏膨胀在 devDependencies**：electron-builder 对 extraResources 不剪枝，原样复制 73MB node_modules（typescript 23MB + vitest 3MB 进用户分发包）。npm prune --omit=dev 在组装目录跑（需先复制 package.json+lockfile）→ 73→20MB
  - **extraResources 布局验证点**：win-unpacked/resources 下应只有 app.asar + backend/（无 node_modules 顶层混入）；keytar.node 在 build/Release/ 里 = 原生模块正确出 asar
  - **分类器不可用的协作模式**：文件编辑（Edit/Write）不需要分类器——主 agent 可以继续改代码；只有 Bash 命令需要用户终端。分工清晰即可推进


## 2026-08-05 01:10 分发功能 Task 6：README（Task 22 顺带落地）

- **触发技能**：`subagent-driven-development`（implementer a09d50b1）、`requesting-code-review`（评审 a139c6f5）
- **Subagent**：implementer a09d50b1（sonnet）
- **Prompt 要点**：需求源 = task-6-brief.md；README 正文逐字、目录结构/已知限制从现有文档提取不新造；不写凭据细节
- **产出**：
  - Commits: `9d241c8`（README）、`946386c`（产物路径修正）
  - 涉及文件: README.md（新建 57 行）
  - 测试: 无（文档任务）；命令逐一核验 + markdown 渲染检查
- **人工干预**：修正 brief 笔误 desktop/dist → desktop/build（Task 5 已改输出目录，README 代码块漏改——implementer 按"逐字使用"保留并报告，主 agent 修正）
- **教训**：
  - **文档里的产物路径要与实现同步**：Task 5 改 `directories.output: build` 时 Task 6 的 README 代码块还写 desktop/dist——跨任务的一致性靠 implementer 报告顾虑 + 主 agent 修正；写计划时文档与配置的路径引用应一次写对
  - **文档任务也走完整评审**：README 的命令核验（npm link bin 指向、vite 代理配置）由评审独立复核——文档错误同样误导用户


## 2026-08-05 01:40 分发功能最终全分支评审 + 修复波

- **触发技能**：`subagent-driven-development`（最终评审 ada79550 + fix afdce2a1 + 复评审 abab43d8）
- **Subagent**：评审 ada79550（opus）+ fix afdce2a1（sonnet）+ 复评审 abab43d8（sonnet）
- **Prompt 要点**：最终评审用最强大模型（opus）；评审包覆盖全部 21 commits（spec/plan/6 tasks）；triage ledger 全部 deferred minors；修复波 ONE fix subagent 带完整 findings
- **产出**：
  - Commit: `51b9996`（4 findings）
  - 修复内容：A（Critical）免 Node 硬约束——`ELECTRON_RUN_AS_NODE: '1'` + `process.execPath`（electron.exe 纯 Node 模式运行后端，零下载、ABI 与 electron-builder rebuild 的原生模块天然匹配）；B（Critical）webui-static POSIX 断言 path.resolve；C（Important）错误路径 cleanup + onExit → app.quit() 防僵尸应用；#4 resolveStaticDir 默认分支测试
  - 测试: desktop 12/12、webui-static 8/8、双 tsc 干净
- **人工干预**：无
- **教训**：
  - **「免 Node 打包」从 Electron 主进程 spawn 'node' 是个隐蔽的反模式**：Electron 自带 Node 运行时，但 process.execPath 指向 GUI 版 electron.exe——正确用法是 `ELECTRON_RUN_AS_NODE=1`（官方机制）把它当纯 Node 用。评审给的方向是"下载 node.exe 打进包"（+30MB），我否决后给出 run-as-node 方案：零下载 + ABI 天然匹配（electron-builder 的 @electron/rebuild 已按 electron ABI 重编译 keytar 等原生模块）——**熟悉框架的内置机制比外部下载更优**
  - **最终评审能抓到单 task 评审漏掉的跨层缺陷**：A（免 Node）是 spec §5.4 的判定标准，Task 3-5 的单 task 评审都看了局部正确（cmd:'node' 在开发机测试全绿）——最终评审以"用户验收标准"为透镜才暴露。验收标准（"对方机器无需装 Node"）必须贯穿每个 task 的实现验证
  - **Windows 与 POSIX 的路径断言差异直到 CI 视角才暴露**：`path.join('C:/fake/project', ...)` 在 Windows 上恰好等于 resolve 结果——本地全绿掩盖了 CI 必红。测试期望值用 path.resolve 构造（与实现同一表达式）是稳定写法
  - **错误路径必须显式退出**：无窗口场景 window-all-closed 不触发——showError 后不 onExit 就是僵尸应用。错误分支的退出接线（cleanup → onExit → app.quit）与正常路径同样重要


## 2026-08-05 02:15 分发功能收尾：ABI 主张修正 + CI desktop job（合并前）

- **触发技能**：`subagent-driven-development`（收尾 ae23e31f + 评审 aad499ac + fix a3cae12d）
- **Subagent**：ae23e31f（收尾）、aad499ac（评审）、a3cae12d（fix）
- **Prompt 要点**：收尾 = resolveNodePath（dev ABI）+ CI desktop job；评审发现 Important（ABI 主张错误）→ fix = docstring 如实化 + env 条件化
- **产出**：
  - Commits: `e20d6dd`（resolveNodePath）、`c0a6fdb`（CI desktop job）、`5339d2c`（ABI 主张修正 + ELECTRON_RUN_AS_NODE 条件化）
  - 测试: desktop 14/14、双 tsc 干净
- **人工干预**：KNOWN_ISSUES 新增 #12（打包 keytar ABI 缺口 + 两条修复路径）；**本条更正**「最终全分支评审 + 修复波」条目里的错误主张——「@electron/rebuild 已按 electron ABI 重编译原生模块」不成立（见教训）
- **教训**：
  - **「electron-builder 会 rebuild 原生模块」是我从打包日志（executing @electron/rebuild）做的过度推断**：实际 @electron/rebuild 只重建 **app 目录**（desktop/，零依赖）的依赖，extraResources 内容是 verbatim 复制。评审用管线事实（prepare-resources 的 cpSync + npm prune）逐层证伪。写 ABI/运行时论证要追到管线每一层的实际行为，日志关键词不等于行为
  - **修复链要把错误主张同步从文档里清掉**：修 ABI 时我把「天然匹配」写进了 docstring 和 AGENT_LOG——错误论证被固化后要再一轮评审才暴露。论证、docstring、日志三者要同步诚实化
  - **CI job 的 node 版本选择有隐藏语义**：desktop job 用 Node 20 对齐 electron 33 内嵌 Node 20.18——CI 环境选择也可以成为打包机的 ABI 锚点


## 2026-08-05 03:30 真实测试反馈：WebUI 供应商 registry 持久化（重启后 baseUrl 丢失）

- **触发技能**：`systematic-debugging`（根因：两套持久化不对称）、`subagent-driven-development`（implementer a8ab8ea2 + 评审 a168c665）
- **Subagent**：implementer a8ab8ea2（sonnet）、评审 a168c665（sonnet）
- **Prompt 要点**：用户在密钥持久化讨论中暴露新症状——nju 供应商重启后 baseUrl 空（key 在、行在）。根因调查：CLI `key status` 只查当前 provider（非 bug）→ WebUI 与 CLI 读同一 store（key 在 keytar 正常）→ baseUrl 来自 config.llm.providers registry → persistConfig 链路 no-op
- **产出**：
  - Commit: `5cb74ce`（createDefaultPersistConfig + runWebAction 接线 + 2 测试：单测 + 集成回归）
  - 涉及文件: src/cli/commands/start.ts、tests/unit/cli/start.test.ts
  - 测试: 全量 633/633（631+2）、start.test.ts 25/25、tsc 干净；CI 全绿（3 job）
- **人工干预**：无（评审 2 LOW defer——webui.token 复制进项目文件与 PUT 既有行为一致；persist 无串行化是既有设计）
- **教训**：
  - **"注释说 defaults to project file" 与实现不符是 bug 温床**：`StartCommandDeps.persistConfig` 的注释声明默认写项目文件，但 `runWebAction` 直接透传、`createProgram` 从不提供 → 整个链路 no-op。注释承诺的默认行为必须由实现兑现，或在注释中写明"调用方必须提供"
  - **两套持久化路径必须同构**：PUT /api/config 的 config 路由自带默认写盘（cwd/.codeharness.json），POST /api/keys 的 registry 走注入回调（无默认）——不对称导致"config 编辑器保存持久、添加供应商不持久"。持久化责任应收敛到单一实现
  - **用户"密钥为什么持久"的疑问引出真 bug**：用户观察到 deepseek key 持久（keytar）而 nju baseUrl 丢——对比中暴露了 registry 与 key 存储的生命周期差异。用户的疑问往往比表面问题更有诊断价值
  - **CLI key status 只查当前 provider**：用户以为它列全部——设计上只显示 account=llm.provider。诊断时先确认命令语义再下结论（差点误判 key 丢失）

---

## 2026-08-05 17:00 Task 20：机制演示（§A.6 三项演示测试）

- **触发技能**：`using-git-worktrees`（阶段 12 新模块 → worktree-demo 分支）、`test-driven-development`（RED/GREEN 独立 commit）、`requesting-code-review`（两阶段评审）
- **Subagent**：implementer a78d2962（RED+GREEN）、reviewer a5313d24（两阶段评审 PASS）
- **Prompt 要点**：仅新增 tests/demo/ 三个文件、零 src/ 改动；演示 2 禁止真实 eslint/tsc 子进程（mock 校验器注入 FeedbackResult）；RED 先单独 commit；Windows worker flaky 提示（重跑即可全绿）；demo 测试自给自足（CI 不联网不构建 client）
- **产出**：
  - Commits: `d1d0ca3`（RED，5 例失败）+ `9810d95`（GREEN，11/11）+ `246b04a`（主 agent CR Minor 修复）
  - 涉及文件: tests/demo/guardrail-demo.test.ts（演示 1 护栏拦截）、feedback-demo.test.ts（演示 2 反馈闭环）、deep-dimension-demo.test.ts（演示 3 主力维度深链路）
  - 测试: demo 11/11（guardrail 2 + feedback 1 + deep-dimension 8）；全量 644/644；tsc 干净
- **人工干预**：评审 4 条 Minor 无 Critical/Important；顺手修复 2 条（246b04a）——FailureClassifier 单测标题如实化（该测试实为透传断言，eslint→syntax 映射发生在真实校验器内部）、guardMsg 补 `approvalRequired: false` 与 main-loop 同构；另 2 条 Minor 记录不修（拦截通知的 tool 错误配对属演示边界；callLog 模块级变量在串行执行下无 flaky）
- **教训**：
  - **演示胶水必须逐字段镜像真实链路消息**：评审逐字段核对 main-loop guardMsg 抓出缺 `approvalRequired`——"与 main-loop 同构"的注释承诺了结构一致，就要逐字段兑现
  - **空洞透传测试的标题就是误导读物**：FailureClassifier 只是透传 failureCategory（映射在真实 validator 内），测试除 throw 外永远通过——保留它可以，但标题不能把映射责任错记到分类器头上；机制演示的意义在于展示真实管线（e2e 用例），不是孤立类冒烟
  - **Windows 本地 vitest worker 偶发崩溃**（Worker exited unexpectedly）：全量回归首跑 631/644、重跑 644/644——验收判据要以"重跑后全绿"为准，不要被首跑 flaky 误导判错
  - **演示测试的模块选材决定 CI 独立性**：不 import 真实 validator（eslint/tsc validator 会 spawn 子进程）→ demo 测试在 CI/本地零外部调用，符合 §A.4-C 硬性判据
  - **`tsc --noEmit` 不覆盖 tests/（tsconfig include 只有 src/）**：项目 tsconfig `exclude: ["tests"]`——声称"tsc 干净"仅对 src/ 成立；vitest 用 esbuild 转译不做类型检查。这次把 `approvalRequired` 放错层级（应在 metadata 内，main-loop.ts:418 同构）就是被 VSCode 语言服务抓到、被 tsc 放过的实例。测试文件类型检查需显式传文件：`npx tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --skipLibCheck --esModuleInterop <测试文件...>`（修复 commit 后补验）


---

## 2026-08-05 17:59 Task 21：Docker + npm 分发

- **触发技能**：`using-git-worktrees`（阶段 13 新模块 → worktree-dist 分支）、`requesting-code-review`（两阶段评审 REVISE → 修复 → 主 agent 复核实测）
- **Subagent**：implementer ac7fba14（配置 + CI + 验证）、implementer a37d38ce（CR 修复多阶段构建）
- **Prompt 要点**：Docker 本机可用（29.1.3）→ 必须真实 docker build/run 验证；keytar 是原生模块无 alpine prebuilt——SPEC「Docker 不走 keytar」；.dockerignore 必须排除 .claude/（否则 worktree 副本进上下文）；npm publish 保持待办只加配置；TDD 豁免（配置类），验收动作=构建验证
- **产出**：
  - Commits: `7b3c0a4`（Dockerfile/.dockerignore/package.json files+publishConfig）、`1f30811`（CI docker-build job）、`9df1b74`（CR 修复：多阶段构建 + tag 钉版 + dockerignore 补漏）、`f11e311`（主 agent：CI 版本断言不硬编码）
  - 涉及文件: Dockerfile、.dockerignore、package.json、.github/workflows/ci.yml
  - 验证: docker build 成功（235MB）、`--version`→0.1.0、`--help` exit 0、容器内 `start --web` 挂载配置后真实 listen（resolveStaticDir 找到 client dist）、npm pack 126 文件 97.4kB、全量 644/644、tsc 干净
- **人工干预**：CI 版本断言从 `test "$VERSION" = "0.1.0"` 改为 `test -n "$VERSION"`（硬编码版本升级会挂 CI，f11e311）；评审 2 条 Minor（tag 钉版、dockerignore 补 .codeharness.json/.npmrc）由 implementer 在 9df1b74 一并修复
- **教训**：
  - **EXPOSE 声明的能力必须真实存在**：评审实测抓到"容器内 --web 报 client dist 缺失"——Dockerfile 只 COPY tsc 产物时 EXPOSE 3000 是虚假声明。多阶段构建（镜像内 tsc + vite）让 docker build 自包含，是兑现 SPEC「Docker 作为 WebUI 验证备选」的正解
  - **.dockerignore 的模式锚定**：`credentials` 无锚定模式在 src 进上下文后误杀 `src/credentials/` 源码——排除模式要么根锚定（/credentials）要么明确目录
  - **npm ci --ignore-scripts 在 build 阶段也要**：keytar 编译在 alpine 直接失败（无工具链）；编译期不需要原生绑定（动态 import 降级），build/runtime 两阶段都跳过 install scripts 是正确姿势
  - **容器内凭据层先行失败**：`start --web` 无 TTY 时先死在 CredentialStore 主密码提示（非交互 stdin EOF）而非 dist 缺失——验证"镜像完整性"要用挂载配置/交互模式，且报错定位要分清"镜像缺产物"与"运行时交互"两类
  - **分类器不可用期间 subagent 产出要亲自复核**：两次派发（ac7fba14、a37d38ce）期间安全分类器不可用，主 agent 逐一 Read Dockerfile/.dockerignore/ci.yml 全文 + 复跑 docker build/run 实测确认声称


---

## 2026-08-05 22:42 B11 桌面验收：后端 spawn 稳定 cwd（backendCwd=userData）修复 baseUrl 重启丢失

- **触发技能**：`systematic-debugging`（两次验收失败 → 全链路证据收集）、`requesting-code-review`（B11 CR REVISE → 门控修复）、TDD 红→绿（lifecycle 单测）
- **Subagent**：无——B11 是验收阶段补丁（非 PLAN task），主 agent 直接完成
- **Prompt 要点**：/（bug 由用户实测报告：重启后 nju 的 baseUrl 空、key 还在）
- **产出**：
  - Commits: `211048d`（fix: 后端 spawn 稳定 cwd）、`bd6de0e`（chore: spawn 前 mkdir userData 防 ENOENT）、`6909df5`（fix: CR — backendCwd 门控 app.isPackaged）
  - 涉及文件: desktop/src/lifecycle.ts（`buildBackendCommand` 加 `options.cwd` + `DesktopLifecycleDeps.backendCwd`）、desktop/src/main.ts（isPackaged 传 `app.getPath('userData')` + mkdirSync）、desktop/src/lifecycle.test.ts（新增 2 例 RED→GREEN）
  - 测试: desktop 16/16；主项目 644/644；tsc 干净
  - 验收: 21:52 构建 win-unpacked 实测——添加 nju（baseUrl）→ `%APPDATA%\codeharness-desktop\.codeharness.json` 落盘 → 重启后 baseUrl 保留 ✓
- **人工干预**：全部主 agent 完成；CR 修复门控——backendCwd 无条件传 userData 会改写 dev 语义（dev 后端 cwd=项目根、配置在仓库根），`app.isPackaged` 门控后 dev 行为不变
- **教训**：
  - **验收必须先确认被测产物版本与代码指纹**：21:52 重建只出了 Setup 安装器（nsis target），`CodeHarness 0.1.0.exe`（portable）仍是 18:28 旧版——用户启动旧 portable 验收，修复代码从未被测试到，误报"还是空的"。验收第一步应是核对构建产物时间戳 + grep asar 指纹（`backendCwd` 命中数）
  - **cwd 漂移根因链**：portable 每次自解压到新 `%TEMP%` 目录 → 后端 cwd 漂移 → projectConfigPath/registry 持久化（均基于 cwd）写入临时目录 → 重启即失；keytar 是系统级（%APPDATA% 凭据库）不受影响——"key 还在、baseUrl 空"恰好暴露了凭据（系统级）与配置（cwd 级）的存储分层
  - **同一 POST 的存储分层可作故障二分**：POST /api/keys 先写 keytar（key）再 persistConfig（baseUrl）——`node dist/cli/index.js key status` 验证 keytar 状态，可快速区分"保存链路失败"与"持久化路径漂移"两类故障（本次 keytar 无 nju 说明旧会话保存从未成功，用户看到的行属 UI 内存态）
  - **全盘搜索配置文件是高效证据**：`.codeharness.json` 搜索（%TEMP%/%APPDATA%/%USERPROFILE%）一次排除所有候选写入位置——30+ 解压目录全部无文件，直接把怀疑从"哪个 cwd"逼到"写没写入"


---

## 2026-08-05 23:22 Task 22：README 补充（Docker 用法 + npm 全局安装 + 机制演示）

- **触发技能**：`using-git-worktrees`（阶段 14 文档模块 → worktree-docs 分支）、`requesting-code-review`（两阶段评审 REVISE → 修复 → 容器实测）
- **Subagent**：implementer 2e36ca82（README 三处增量，commit `805d2c4`）；reviewer af30f06a（两阶段评审）
- **Prompt 要点**：Task 22 在 PLAN 已由 Task 33 落地（README 基础版），本次补充分发专项后的三个增量（容器化运行 / npm 全局安装 / 机制演示）；纪律要求"先读后写"——每条命令/路径/名称必须以真实文件为依据（Dockerfile、ci.yml、options.ts、encrypted-file-backend.ts、tests/demo），禁止凭训练数据编造
- **产出**：
  - Commits: `805d2c4`（subagent 增量）、`cba722f`（CR 修复，主 agent）、`f4eaa53`（merge PR #13）
  - 涉及文件: README.md（+38 行）、.github/workflows/ci.yml（断言补强 +7 行）
  - 评审: REVISE → 修复 → 容器内实测（`docker run --rm codeharness start --web` 不再报 unknown option，正确走到凭据层）
- **人工干预**：① subagent 把 commit 落在了 master（派发未指定 worktree）——cherry-pick 到 worktree-docs + master reset 纠偏，请用户手动跑 git 命令；② CR 修复全部由主 agent 完成（C1 容器命令前缀、C2 ci.yml 弱断言、I1 npm 包名占用、M1 措辞）
- **教训**：
  - **ENTRYPOINT exec 形式下 docker run 尾部参数直接拼接**：`docker run ... codeharness start --web` 实际执行 `node dist/cli/index.js codeharness start --web` → commander 把多余 operand 解析错乱报 unknown option（--version/--help 因短路不受影响，恰好只咬 start）——README 写了带前缀命令，评审实测揪出。验证 docker 命令必须考虑 ENTRYPOINT 拼接语义
  - **弱断言 CI 是"绿得心安理得"的温床**：ci.yml 的 start --web 检查用 `|| true` + 仅 grep 一个错误串——命令行解析错误（unknown option）永远发现不了。评审 C2 补 grep 后，"容器内 --web 可用"的 Task 21 结论才真正有护栏
  - **README 的"可复制执行命令"必须逐条实测**：`npm install -g codeharness` 一行——npm registry 上该包名已被无关第三方占用（评审 WebFetch 查证），install 会装上别人家的软件。写安装文档前要查包名占用
  - **派发 subagent 必须显式指定 worktree**：Agent 工具默认在主工作目录跑——不传 isolation 或 cd 指令，subagent 会把 commit 落在 master。纠偏成本（cherry-pick + reset + 用户手动命令）远高于派发时多写一句"在 <worktree 路径> 下操作"
  - **"命令与 CI 实测一致"是内部行话**：README 面向用户，应写事实（多阶段自包含）而非流程（ci.yml 怎么验的）——且断言修复前"实测一致"本身不成立


---

## 2026-08-06 02:44 方案 B：config.llm.masterPassword 预置口令（线上部署阻塞修复）

- **触发技能**：`systematic-debugging`（线上容器启动崩溃根因调查）、TDD 红→绿（unit + integration）
- **Subagent**：无——部署阻塞补丁，主 agent 直接完成（分类器不可用期间按既定预案主 agent 亲自复核）
- **Prompt 要点**：/（bug 由线上实测报告：`docker run` 后容器 Restarting，日志 `Master password for encrypted key storage:` + `CredentialStore requires at least one backend`——alpine 无 keytar 原生绑定 + 无 TTY 交互）
- **产出**：
  - Commits: `6b16c77`（.gitlab-ci.yml 四 job 对等 GitHub Actions）、`cc2366d`（方案 B 核心）、`53c31a3`（README 凭据模型 + KNOWN_ISSUES untrack）、`06aa988`（DESIGN_BRIEF untrack）
  - 涉及文件: src/types.ts（`Config.llm.masterPassword?`）、src/config/schema.ts（DEFAULT_CONFIG 默认 undefined）、src/credentials/store.ts（buildCredentialStore 转发）、src/cli/store.ts（新增 buildStoreFromConfig）、src/cli/index.ts + src/cli/commands/start.ts（注入点替换）、tests/unit/cli/store.test.ts、tests/unit/config/loader.test.ts、README.md、.gitlab-ci.yml
  - 测试: 647/647（含新增 encrypted-file 激活无提示 + env 转发用例）
  - 部署: 阿里云学生机 139.224.16.44（Ubuntu + docker.io），容器 codeharness:3000，挂载 /root/.codeharness，`{"llm":{"masterPassword":"<口令>"}}` 预置后容器 Up、WebUI 正常 listen
- **人工干预**：全部主 agent；关键决策——初始建议 apiKeySource: env 被用户追问"UI key 设置还能用吗"否决（EnvBackend 只读，UI 写 key 会坏）→ 改为方案 B；用户对"masterPassword 明文存服务器"的疑虑以威胁模型回答（服务器 root 即可读 secrets.enc，主密码防的是服务间/备份泄漏）
- **教训**：
  - **keytar 在 alpine 容器里是"静默缺失 + 交互死锁"**：动态 import 失败 → 链上只剩 encrypted-file → 无 TTY 时交互提示直接 EOF → 报"无可用 backend"。容器部署必须预置主密码或显式选择后端，二者缺一必崩
  - **只读后端（env）会破坏 UI 写路径**：配置层"能用"不等于"功能完整"——env 模式 GET 显示 key、POST 报错，UI 语义残缺。修复方向应保持功能全量可用，而非降级可用
  - **部署验证必须分「构建验证」与「运行验证」**：docker build 成功只证明镜像完整；`docker run` 挂配置后真实 listen + curl API 才是运行验证。此前 Task 21 的教训在此复现（容器报错先死在凭据层而非 dist）
  - **GitLab CI 与 GitHub Actions 的对等映射**：unit-test(node:22)/webui-client(node:20)/desktop(node:20)/docker-build(docker:27+dind) 四 job 一一对应，`~/.npm` 缓存；docker-build 含 ENTRYPOINT 拼接注释 + start --web 断言（unknown option / WebUI 产物 grep）


---

## 2026-08-06 02:44 线上 bug 修复：DELETE /api/keys/:provider 同步清理 registry（删除供应商刷新后复活）

- **触发技能**：`systematic-debugging`（用户实测报告 → 根因链）、TDD 红→绿（integration，650/650 两连跑稳定）
- **Subagent**：无——验收阶段线上 bug，主 agent 直接完成
- **Prompt 要点**：/（bug 由用户线上实测报告：Settings 删除新增供应商 nju 后刷新页面 nju 又出现，仅 apikey 消失）
- **产出**：
  - Commit: `2a11aeb`（fix: DELETE /api/keys/:provider 同步清理 registry 并持久化）
  - 涉及文件: src/webui/api/keys.ts（DELETE 处理：registry 清理 + persistConfig + 活跃 provider 回退 DEFAULT_CONFIG.llm.provider + onConfigChanged 同契约）、tests/integration/webui-api.test.ts（新增 3 例：registry 清理后 GET 不再返回 / registry-only 供应商 DELETE / 活跃 provider 删除后回退 deepseek）
  - 测试: 650/650（两连跑稳定）
- **人工干预**：测试编写中修正一个理解错误——POST apiKey-only（无 baseUrl）不写 registry，活跃-provider 删除测试必须带 {apiKey, baseUrl} 才能验证 llm.provider 回退路径
- **教训**：
  - **线上 bug 的根因常在"状态分散在两层"**：GET 枚举 = credentialStore.list（keyed）∪ config.llm.providers（registered）——DELETE 只删前者，后者让供应商复活（无 key 状态）。删除操作必须对**枚举来源**做清理，否则"删了"只是 UI 假象
  - **持久化必须与状态变更同事务**：仅清内存 registry 不 persistConfig，重启后复活（与 B11 的 cwd 漂移同族：状态写到错误/临时层）。DELETE 现在走完整 persistConfig 链路
  - **活跃供应商删除是悬空引用**：llm.provider 指向已删供应商 → 回退 DEFAULT_CONFIG.llm.provider（deepseek），并触发 onConfigChanged 让运行中会话按新 provider 重启（与 POST 编辑活跃 provider 同一契约）
  - **线上实例仍跑旧镜像**：2a11aeb 尚未重建/部署，需本地 docker build + save + scp + 服务器 load + run 后验证

---

## 2026-08-06 16:21 CI 修复：DirectoryPicker 测试竞态（GitLab webui-client 偶发失败）

- **触发技能**：`systematic-debugging`（日志现场 → 根因链，无修复先于根因）
- **Subagent**：无——CI 偶发失败，主 agent 直接完成
- **Prompt 要点**：/（用户报告 GitLab pipeline webui-client job 失败：`selecting a drive fills the parent form` 用例报 `Unable to find ... "选择 C:\"`，DOM dump 停在「加载目录…」加载态）
- **产出**：
  - Commit: `1ff00d7`（fix: DirectoryPicker 测试竞态——getByRole 改 findByRole，等待异步加载的根目录/条目按钮）
  - 涉及文件: src/webui/client/src/components/DirectoryPicker.test.tsx（`expand()` helper + 用例 1/2 的 5 处同步查询改异步）
  - 测试: 222/222（webui-client 全量，本地复跑通过）
  - 推送: origin(GitHub) + gitlab(NJU) 双远程
- **人工干预**：主 agent 全量；修改仅测试代码，组件/产品代码零改动
- **教训**：
  - **对话框元素同步渲染 ≠ 内容同步存在**：DirectoryPicker 的 dialog 元素挂载即出现，但根目录在 `fetchMachineRoots()` 异步 resolve 前停留在 `phase==='loading'`（只有「加载目录…」spinner）。`findByRole('dialog')` 在 loading 态就 resolve，紧跟着的同步 `getByRole('选择 C:\')` 是竞态——mockResolvedValue 的微任务 resolve 与测试续体的执行顺序无保证
  - **同文件铁证排除平台差异**：用例 1 用同样的同步 getByRole 却通过（同一 beforeEach/同一渲染路径），失败只在用例 2——纯时序问题，GitLab 共享 runner 较慢丢失竞态，GitHub Actions 与本地恰好每次都赢，所以此前从未暴露。CI 偶发 = 测试写错，不是环境怪癖
  - **规则化：对异步加载内容的查询一律 findBy*/waitFor，对同步渲染内容的查询才用 getBy***：本文件用例 4/8 作者已用了 findByRole（异步内容），用例 1/2/3/7 与 expand() helper 漏了——同一文件的风格分裂是竞态温床

## 2026-08-06 19:31 GitLab CI docker-build job 定稿：dind → kaniko → 镜像站 → 构建逻辑等价验证（§五.7 CI 留档）

- **触发技能**：`systematic-debugging`（含 Phase 4.5 架构质疑——3+ 修复失败后与用户决策降级方案）
- **Subagent**：无——CI 运维类修复，主 agent 直接完成（用户提供每次 pipeline 日志 + 最终方案决策）
- **Prompt 要点**：/（目标：GitLab CI 4 job 全绿留档 §五.7；共享 runner 约束逐轮实测：无特权容器 / 校园网屏蔽 Docker Hub 与 CloudFront）
- **产出**：
  - Commits: `36021f5`（kaniko 取代 dind）、`7a1a253`（gcr 换 DaoCloud 代理）、`9918c90`（gcr.m.daocloud.io 专用端点）、`e013353`（kaniko ENTRYPOINT 清空 + :debug 标签）、`cdd53b0`（--registry-mirror）、`7e96097`（docker.1panel.live 完整代理）、`3a40bcc`（镜像探测循环）、`7d0314d`（等价验证定稿）、`2dbb89f`（cd 层级修复）
  - 涉及文件: .gitlab-ci.yml（docker-build job 注释完整记录各轮失败实测结论）
  - 测试: GitLab 4 job 全绿（unit-test / webui-client / desktop / docker-build），§五.7 留档完成
- **人工干预**：全部主 agent；关键决策——用户选择「构建逻辑等价验证」方案（真实镜像构建 + 运行断言由 GitHub Actions 承担，§4.8 在 GitHub 侧完整满足）
- **教训**：
  - **无特权共享 runner 上 dind 必然不可用**（mount permission denied）——GitLab 官方推荐替代是 kaniko（daemonless）；但 kaniko 不借宿主 daemon 的镜像源，校园网屏蔽 index.docker.io 时必须 --registry-mirror
  - **镜像站分 redirect 与 full-proxy 两类**：docker.m.daocloud.io manifest 200 但 blob 302 到 production.cloudfront.docker.com（被 reset）；m.daocloud.io 带 token 仍 403（要账号）；1panel.live/xuanyuan.me 为 blob 自伺服完整代理（后者 429 限流）。选镜像站要看 blob 的最终 host，不能只看 manifest 200
  - **本机网络 ≠ runner 网络**：1panel.live 本机可用但从 runner 挂起、docker.nju.edu.cn 本机 403 从 runner 也挂起——本机探测结论不能外推到 CI
  - **busybox wget --timeout 在 kaniko 容器不生效**（DNS/connect 阶段无限等待），探测循环静默卡满 job 超时（实测 1h）——依赖超时兜底的探测方案不可行
  - **3+ 修复失败后必须质疑架构（Phase 4.5）**：无特权 + 屏蔽 Docker Hub/CloudFront 的双重约束下，该 runner 无法真实构建镜像——不是再试第 7 个方案，而是与用户确认降级为「Dockerfile 构建逻辑等价验证」，真实构建由 GitHub Actions 承担
  - **等价验证脚本要防路径算术错误**：`cd src/webui/client && ... && cd ../..` 从 client 只回到 src/（少跳一级，client 在仓库根下第 3 级），后续 test -f 查错目录——日志里"最后一条 `$` 行 + 无下一条"即可定位断言位置

## 2026-08-06 19:55 README 补 CI/CD 小节（§五.7 留档收尾）

- **触发技能**：`requesting-code-review`（两阶段评审自查，随本条一并执行）
- **Subagent**：无——主 agent 直接完成（用户问「等价验证是否意味着测试不完整」，回答后要求把对应关系写进 README）
- **Prompt 要点**：/（README 此前无任何 CI 段落；需要向读者说明 GitLab docker-build 等价验证与 GitHub 真实构建的职责分工）
- **产出**：
  - Commit: `d997817`
  - 涉及文件: README.md（新增「## CI/CD」小节 7 行：双平台对等流水线、GitHub Actions 真实构建 + 容器运行断言（§4.8）、GitLab 等价验证的实测原因与职责边界）
  - 测试: 无代码改动；GitLab 4 job 全绿 + GitHub Actions 全绿已留档（§五.7）
- **人工干预**：全部主 agent
- **教训**：
  - **"不完整"的测试必须把对应关系写进交付文档**：GitLab docker-build 降级为等价验证后，只看 GitLab 截图会误以为镜像从未被验证——README 写明「真实构建与运行断言由 GitHub Actions 承担」后，GitLab/GitHub 两张留档截图才自洽
  - **README 新章节复用既有锚点**：§4.8（CI 构建镜像）、`COPY --from=build`（容器化运行节既有概念）、dind/校园网屏蔽（.gitlab-ci.yml 注释已有逐轮实测记录）——新章节与旧章节互相指涉，不重复展开
