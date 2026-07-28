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
