# CLAUDE.md — CodeHarness 项目指南

> 本文件在每次会话启动时自动加载。所有 subagent 必须在派发 prompt 中引用本文件的核心约束。

---

## 项目概述

**CodeHarness** 是一个 Coding Agent Harness——从零构建的、用于软件开发场景的 AI 编码智能体运行框架。核心命题：**Agent = LLM + Harness**，所有机制（治理、反馈、工具、记忆）必须由代码而非提示词实现。

关键文档：
- `docs/SPEC.md` — 完整设计规约
- `docs/PLAN.md` — 22 个 task 的实现计划与依赖图
- `docs/SPEC_PROCESS.md` — brainstorming 与冷启动验证过程记录

---

## 实现工作流（每个 task 强制执行）

以下流程对应课程 §4.6 要求，**不得跳过任何步骤**。
主 agent 的角色是**派发者 + 评审者**，subagent 的角色是**执行者**。

### 1. 每个模块第一个 task 前：创建 worktree

**"模块"的定义：docs/PLAN.md「实现阶段」中的每个阶段是一个模块。**

```
/using-git-worktrees
```
为该模块创建独立 git worktree，对应一个 PR。同一模块包含的所有 task 共用此 worktree。

模块与 worktree 映射（共 14 个阶段，其中标注 ⑂ 的可并行开启独立 worktree）：

| 阶段 | 模块 | 包含 Task | 备注 |
|------|------|----------|------|
| 1 | 基础 | Task 1 | |
| 2 ⑂ | LLM 层 | Task 2-3 | 可与阶段 3 并行 |
| 3 ⑂ | 工具 | Task 4-5 | 可与阶段 2 并行 |
| 4 ⑂ | 配置 + 记忆 | Task 6-7 | 可与阶段 5 并行 |
| 5 ⑂ | 护栏 | Task 8-9 | 可与阶段 4 并行 |
| 6 ⑂ | 反馈闭环 | Task 10, 11a, 11b, 12 | 主力维度；11a→11b 顺序执行，可与阶段 8 并行 |
| 7 | 主循环 | Task 13a, 13b | 13a→13b 严格依赖；依赖阶段 4-6 完成 |
| 8 ⑂ | 凭据 | Task 14-15 | 可与阶段 6 并行 |
| 9 | CLI | Task 16 | 依赖阶段 8 完成 |
| 10 ⑂ | WebUI | Task 17, 18a, 18b | 18a→18b 顺序依赖（18b 需脚手架）；可与阶段 12 并行 |
| 11 | 集成 | Task 19 | 依赖阶段 7, 9, 10 完成 |
| 12 ⑂ | 演示 | Task 20 | 可与阶段 10 并行 |
| 13 | 分发 | Task 21 | |
| 14 | 文档 | Task 22 | |

> 并行模块（标注 ⑂）需要各自独立的 worktree。依赖关系见 docs/PLAN.md 任务依赖图。

### 2. 每个 task：派发 subagent，由 subagent 执行 TDD

**主 agent 操作**：使用 Subagent-Driven 模式派发一个**新鲜 subagent**，在派发 prompt 中要求：

```
请按以下纪律完成 PLAN Task [编号]：[名称]。

1. /test-driven-development — 先写失败测试 → 确认红色 → 写最少代码变绿 → 重构。
   绝不先写实现再补测试。
2. 涉及文件：[列表]
3. SPEC 对应规约：[引用 SPEC 相关章节]
4. 完成条件：[来自 PLAN 的完成条件]
5. 完成后输出 commit hash。
```

**Subagent commit message 格式（强制）**：

每个 subagent 产出的 commit message 必须遵循以下格式，标注 subagent 信息：

```
feat: [简述] — by subagent [agentId前8位]

Subagent: [agentId前8位]
人工修改: [无/具体修改内容]
```

示例：
- Subagent 无人工修改：`feat: add MockProvider — by subagent a6a57567`
- 主 agent 修复了 CR issue：`fix: CR — .gitignore matches baseline — manual fix by 主 agent`
- AGENT_LOG commit：`docs: AGENT_LOG — Task 2`
- Merge commit：`merge: Phase 2 LLM Layer — Tasks 2-3 by subagents a6a57567, a3641485`

**Subagent 职责**：
- 在自己内部执行完整的 TDD 红→绿→重构循环
- 产出 commit（按上述格式标注 subagent）+ 测试全部通过
- 不确定时暂停提问，不凭猜测继续

### 3. 每个 task 完成后：主 agent 做两阶段评审

```
/requesting-code-review
```
**两阶段评审**：
- 第一阶段：spec 合规检查（产出是否符合 SPEC 规约？）
- 第二阶段：代码质量检查（正确性、可读性、测试覆盖）
- Critical issue → 必须修复才能进入下一 task

**代码评审通过后，立即追加 docs/AGENT_LOG.md 条目**（见下方「AGENT_LOG 维护」节）。
在 commit message 中标注由哪个 subagent 完成和人工修改部分。

### 4. 模块所有 task 完成后：完成分支

```
/finishing-a-development-branch
```
决定 merge / PR / 保留 / 丢弃。

**Merge commit 格式（强制）**：必须汇总本模块所有 subagent 和人工修改。

```
merge: Phase [X] [模块名称] — Tasks [编号范围] by subagents [ID1前8位], [ID2前8位]

人工修改: [无/具体条目]
```

### 流程总结

```
主 agent                          Subagent
  │                                  │
  ├─ /using-git-worktrees            │
  ├─ 派发 subagent ─────────────────→ │
  │                                  ├─ /test-driven-development
  │                                  ├─ 红 → 绿 → 重构
  │                                  └─ commit → 返回 commit hash
  ├─ /requesting-code-review         │
  ├─ 追加 docs/AGENT_LOG.md               │
  ├─ (模块完成时)                     │
  └─ /finishing-a-development-branch │
```

---

## 全局约束（来自 docs/PLAN.md）

1. **TDD 强制**：红 → 绿 → 重构，每个 task 都要走这个循环
2. **§A.4-C 硬性判据**：核心机制必须能用 MockProvider 做确定性单测——不依赖真实 LLM
3. **凭据不入代码/Git/日志/历史**
4. **每个 task commit 标注 subagent**：按 §2 格式标注 subagent ID + 人工修改（§4.7 要求）。merge commit 汇总本模块所有 subagent
5. **完成条件必验**：每个 task 的「完成条件」部分必须在声称完成前逐一验证
6. **docs/PLAN.md 持续更新**：每完成一个 task 即标记 `[x]` 并附 commit hash

---

## 开发环境

- **语言**：TypeScript 5.x，ES modules（`"type": "module"`）
- **运行时**：Node.js 20+
- **测试框架**：vitest
- **LLM SDK**：OpenAI Node.js SDK（接 DeepSeek）
- **CI**：GitHub Actions，job 名 `unit-test`，触发分支 `master`

---

## 关键约定（来自冷启动验证修订）

- **Git 分支名**：`master`
- **接口定义点**：`src/types.ts` 是所有共享接口的唯一定义点；其他模块从它 import，不做 re-export
- **Import 路径**：`NodeNext` 模式，相对 import 须带 `.js` 扩展名
- **`.gitignore`**：按 SPEC §12.2 基线创建，不得自行补充或从训练数据添加额外条目

---

## AGENT_LOG 维护（每个 task 后强制）

### 触发时机

代码评审通过、commit 完成后，**立即**调用 Read 工具打开 `docs/AGENT_LOG.md`，在文件末尾追加一条新条目。

### 条目格式

```markdown
## [时间戳] Task [编号]：[task 名称]

- **触发技能**：[如 test-driven-development, subagent-driven-development, requesting-code-review]
- **Subagent**：[派发的 subagent 标识或描述]
- **Prompt 要点**：[关键 context 配置、特殊指令]
- **产出**：
  - Commit: `<commit-hash>`
  - 涉及文件: [列表]
  - 测试: [通过数/总数]
- **人工干预**：[修改了什么、为什么；如无干预则写"无"]
- **教训**：[本 task 中学到的经验、踩到的坑]
```

### 要求

- 时间戳格式：`YYYY-MM-DD HH:MM`
- 必须在你（主 agent）的回合中直接编辑 `docs/AGENT_LOG.md`，不要让 subagent 代写
- Commit hash 从 subagent 返回结果或 `git log` 中提取
- 「人工干预」如实记录——你做了什么修改、为什么
- 「教训」写具体的、下次能用的东西，不写空话
- 每次追加后 commit：`git add docs/AGENT_LOG.md && git commit -m "docs: AGENT_LOG — Task [编号]"`
