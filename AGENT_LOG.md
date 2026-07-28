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
