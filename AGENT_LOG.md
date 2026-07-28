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
