# SPEC_PROCESS — CodeHarness 规约与计划过程文档

> AI4SE 期末项目 A · Coding Agent Harness
> 创建日期：2026-07-27

---

## 一、brainstorming 过程记录

### 1.1 关键节点

brainstorming 技能介入后，智能体按顺序逐一追问了以下关键问题，每个问题都直接影响了最终设计：

**节点 1：编程语言选型。** 智能体给出了 4 个选项（TypeScript/Go/Python/Rust）的对比，推荐 TypeScript。理由：接口抽象天然适合 mock/real 切换（契合 §A.4-C 判据）、CI 模板已预配、同语言覆盖 CLI + WebUI。这让我意识到选型标准不应该是"我最熟悉什么"，而应该是"什么语言能让 mock-LLM 单测最顺手"——这个判据贯穿了整个项目的设计。

**节点 2：LLM 供应商。** 当我表示没有 Anthropic API 访问条件后，智能体推荐了 DeepSeek（OpenAI 兼容协议），理由是 tool calling 可用、国内可充值、接口兼容性方便将来切换。这让我修正了"供应商绑定"的隐忧——设计一个 OpenAI 兼容的抽象层即可。

**节点 3：主力维度。** 智能体给出了治理/反馈/扩展三个选项的对比，我选了反馈闭环。智能体随后追问了"反馈闭环做深后长什么样"，促成了 5 层架构（ActionClassifier → ValidatorSelector → ValidatorChain → FailureClassifier → RoundManager）的设计。

**节点 4：架构方案三选一。** 智能体提出了固定流水线/自适应校验器/自我反思循环三种架构，推荐 B（自适应校验器），理由是它在工程深度和 mock 可测性之间找到了最佳平衡点。C 方案的"根因分析"被否掉，因为它依赖 LLM 做语义判断，不符合 §A.4-C。

**节点 5：设计逐节审查。** 每一节设计呈现后，智能体都有自检环节（"你检查一下有没有遗漏"）。这在护栏模式清单、配置系统、凭据设计三个环节暴露了关键遗漏。

### 1.2 关键迭代（至少 3 轮）

| 轮次 | 对话摘要 | 我的决策 | 决策理由 |
|------|---------|---------|---------|
| 1 | 智能体审查 PatternGuard 危险模式清单，发现原 5 条遗漏了 windows 删除命令、git 破坏操作、shell 注入、数据库操作等 14 条 | 同意补充，从 5 条扩展到 19 条 | 原清单以 Linux 为中心，遗漏了大量跨平台和数据库场景 |
| 2 | 智能体自审 PatternGuard 的 block/warn 分类，建议 `git push --force` 从 block 降为 warn（feature branch force push 是标准操作），`sudo` 降为 warn（容器内 apt-get 是合理需求），移除不可靠的 `eval` 检测 | 我要求参考 Claude Code 等产品重新审视分类。最终调整了 6 条分类，并增加"保护分支"子规则：`git push --force origin main/master` 仍为 block | 分类标准应该清晰：block = 任何场景下都不存在合理用途；warn = 有合理用途但高风险 |
| 3 | 智能体审查凭据设计，发现 3 个问题：keytar native 编译在 npm 分发中的兼容性风险、Docker 容器中无 keychain、`get()` 裸返回 key 的安全隐患 | 要求全部处理。最终设计改为后端优先级链（keytar → 加密文件 → 环境变量）+ SecureHandle 闭包限制 + Docker 引导流程 | 安全问题不能留已知缺口——加密文件 fallback 同时解决了 npm 编译失败和 Docker 两个场景 |
| 4 | 智能体自审反馈闭环，发现遗漏 `parse_error` 类别和校验器链缺少 `collect_all` 模式 | 同意两个调整。增加了 `parse_error` → `format_retry` 路径，校验器链增加 `fail_fast` 和 `collect_all` 双模式 | parse_error 在 mock 测试中极易验证（注入垃圾 JSON），是有价值的确定性反馈路径 |
| 5 | 智能体建议第三层记忆（检索式记忆）使用 minisearch 做关键词检索 | 追问"在第二层使用按需检索合适吗？"智能体自省后承认项目级记忆数据量有界，全量加载就够，YAGNI。撤回建议 | 不要解决不存在的问题——`.harness/` 下几个 markdown 文件总共几百 token |
| 6 | 智能体审查会话记忆的"全量加载"策略 | 我指出 Claude Code 等产品不会全量加载 messages[]。智能体修正为加入上下文窗口管理（最近 8 轮全文 + 旧轮摘要 + important 标记保护） | 没有上下文窗口管理，agent 跑不了几轮就崩，这是正确性的基础设施 |
| 7 | HITL 状态机设计包含 120 秒超时自动拒绝 | 我指出 Claude Code 的做法是无限等待——"HITL 的本质是人类做决定需要任意长的时间"。智能体同意去掉超时 | 用超时截断是在替人类做决定，与 HITL 的初衷矛盾 |
| 8 | WebUI 设计中包含独立 `/approvals` 页面 | 我指出 HITL 审批应该在对应会话详情页中内联进行，像 Claude Code 一样。智能体同意简化，去掉独立页面 | 用户体验：审批卡片嵌在消息流中比切到另一个页面更自然 |

### 1.3 AI 建议的采纳与推翻

**采纳的建议：**

| # | AI 建议 | 采纳理由 |
|---|--------|---------|
| 1 | 推荐 TypeScript 作为编程语言 | 接口抽象天然适合 mock/real 切换；CI 零摩擦；同语言覆盖 CLI + WebUI |
| 2 | 推荐 DeepSeek 作为 LLM 供应商 | OpenAI 兼容协议，便于切换供应商；国内可充值；tool calling 可用 |
| 3 | 推荐"自适应校验器"架构（方案 B） | 在工程深度和 mock 可测性之间找到平衡；C 的根因分析依赖 LLM，滑向提示词范畴 |
| 4 | 推荐 npm + Docker 双分发 | npm 对 TS 项目最自然；Docker 为零依赖备选 |
| 5 | 推荐反馈闭环作为主力维度 | 天然由确定性代码构成；coding 领域有编译器/测试/linter 的客观信号；mock 测试最顺手 |
| 6 | 补充 `edit_file` 工具（原只有 `write_file` 全量覆写） | 全量覆写对微小编辑不经济；`edit_file` 更贴近真实 agent 编辑模式 |
| 7 | PatternGuard 危险模式完整审计（从 5 条扩展到 20 条） | 覆盖了 Windows 命令、git 破坏操作、shell 注入、数据库操作等原遗漏类别 |
| 8 | 凭据后端优先级链（keytar → 加密文件 → 环境变量） | 同时解决了 keytar 编译失败和 Docker 无 keychain 两个场景 |
| 9 | 增加 `parse_error` 失败类别和校验器链 `collect_all` 模式 | parse_error 在 mock 测试中极易确定性验证；collect_all 让反馈粒度可控 |
| 10 | 移除记忆系统中的 minisearch 检索 | 项目记忆数据量小有界，全量加载即可；YAGNI |
| 11 | 上下文窗口管理加入会话记忆层 | 没有它 agent 运行 20+ 轮后上下文必然溢出 |
| 12 | Config 四项修正（guardrail 双向配置、per-validator 开关、memory 路径、apiKeySource） | 原设计有 4 个明确缺陷 |
| 13 | 加密文件 fallback 作为 keytar 不可用时的降级方案 | 解决 npm 用户编译 native addon 失败 + Docker 容器两个关键场景 |
| 14 | `get()` 返回 SecureHandle 而非裸字符串 | 通过闭包限制 key 传播范围，配合 ESLint 禁止日志泄露 Bearer token |

**推翻或修正的建议：**

| # | AI 建议 | 我的修正 | 推翻理由 |
|---|--------|---------|---------|
| 1 | HITL 状态机设置 120 秒超时自动拒绝 | 改为无超时、无限等待，仅显示"已等待 N 秒"提示 | Claude Code 等产品都是无限等待——HITL 的本质是人类做决定需要任意长时间，用超时截断是替人类做决定 |
| 2 | PatternGuard 中 `git push --force` 全部 block | 区分处理：`git push --force origin main/master` → block（保护分支）；其他 force push → warn | feature branch force push 是日常标准操作，不应拦截 |
| 3 | PatternGuard 中 `sudo`/`su` 全部 block | 降为 warn，因为 `rm -rf /` 等真正危险的操作已被第 1 条拦截 | 容器内 `sudo apt-get install` 是合理需求 |
| 4 | PatternGuard 中 `eval`/`source` 非白名单文件 block | 移除该规则。可靠检测太困难（`eval "$VAR"` 有无数变体），写了也是虚假安全感 | 不如依赖 HITL 层的 shell 工具级权限提示 |
| 5 | 会话记忆"全量加载 messages[]" | 改为上下文窗口管理（最近 8 轮全文 + 旧轮摘要 + important 保护） | 真实产品中 messages[] 20+ 轮后轻松突破几十万 token，全量加载不可行 |
| 6 | 第三层记忆用 minisearch 检索 | 直接去掉检索，所有层全量加载 | 项目记忆几百 token 级别，检索是过度工程 |
| 7 | WebUI 独立 `/approvals` 审批中心页面 | 改为在会话详情页中内联 `ApprovalCard` 组件 | Claude Code 式体验：审批请求嵌在消息流中，用户体验更好 |
| 8 | 凭据后端用环境变量作为第一优先级 | 降为最后 fallback，且需用户显式选择 `apiKeySource: 'env'` | 环境变量是明文，shell history 和进程环境都可见，风险最高 |

### 1.4 brainstorming 反思

**做得好的地方：**

1. **逐一追问的设计节奏。** 智能体没有一次性抛出 10 个问题，而是每次一个问题，在得到回答后再进入下一步。这让每个决策都能被充分思考，而非仓促勾选。尤其是架构三选一环节——如果一开始就扔给我三种方案，我很可能选最简单的 A（固定流水线），而不是最有深度的 B。

2. **自审机制（"你检查一下有没有遗漏"）。** 这是整个 brainstorming 中最有价值的模式。智能体在护栏清单、配置系统、凭据设计三个环节主动自审，每次都能发现 3-4 个实际遗漏。这说明"让智能体审查自己的输出"是一个低成本、高回报的质量门。

3. **参照市面上同类产品。** 智能体多次引用 Claude Code 的实际行为作为参照（HITL 审批、消息流设计、上下文窗口管理），这让很多"应该是怎样"的讨论有了客观锚点，而非纯粹的主观偏好。

**不满意的地方：**

1. **设计呈现时"给自己打满分"的倾向。** 每节设计呈现时智能体都会问"这个设计 OK 吗？"，但在我质疑之前从未主动说"这里少了 X"。比如最初的 PatternGuard 只有 5 条规则、配置系统有 4 个问题、凭据设计有 3 个问题——这些都是在我接受设计之后，智能体自己"再检查一遍"才发现的。如果自审在呈现设计之前做，会节省更多时间。

2. **过早追求"完整"而非"正确"。** 智能体有时会补全它不确定的内容（如记忆系统引入 minisearch、HITL 加 120 秒超时）——这些是在"完成 checklist"而非"做对设计"。好在每次我追问时都能修正，但更好的做法是遇到不确定时先问，而非先补一个可能错误的答案。

3. **SPEC 中的隐含假设未在 brainstorming 中显式化。** 分支名、`.gitignore` 基线、import 路径约定、接口定义点——这些在 brainstorming 中从未被讨论，但在冷启动验证中被证实是关键的隐性上下文。brainstorming 技能聚焦于"做什么"，但没有强制性的"基线配置检查"环节。

4. **承认错误时没有防御性。** 当我在记忆系统、HITL 超时、PatternGuard 分类等环节质疑智能体时，它每次都直接说"你说得对"然后修正，这可能会导致设计被我带偏。

---

## 二、冷启动验证

### 2.1 agent 在哪里暂停并提问

**全程零提问。**

新 agent 拿到 SPEC 和 PLAN 后，直接按照 PLAN 中的代码块逐项实现，完成了 Task 1 和 Task 2 的全部产出（项目脚手架、类型定义、事件系统、MockProvider、CI 配置、测试），7/7 个测试全部通过，**没有在任何一个环节暂停或提问**。

这个结果本身是本次冷启动验证最重要的发现。它不意味着 SPEC/PLAN 写得完美——恰恰相反，它说明：

1. PLAN 中 Task 1-2 的代码块过于完整，agent 在"照抄"而非"理解"，自然不需要提问
2. SPEC/PLAN 中的隐含假设（分支名、`.gitignore` 内容、import 风格）没有被 agent 视作"需要确认的事项"——它直接用了自己的默认值
3. 不同 agent 的"提问倾向"差异巨大，有的默认遇到歧义会追问，有的默认"猜一个最合理的"

### 2.2 暴露的 SPEC 缺陷

| # | 缺陷 | 具体表现 | 是 spec 写错还是没写 |
|---|------|---------|-------------------|
| 1 | **接口定义位置未约定** | PLAN 说 `provider.ts`「导出 LLMProvider 接口」，但接口实际定义在 `types.ts`。agent 将 `provider.ts` 写成了一行 re-export（`export type { LLMProvider, LLMResponse } from '../types.js'`），文件形同虚设 | 没写——SPEC 和 PLAN 都没说 `types.ts` 是所有接口的唯一定义点 |
| 2 | **分支名未约定** | 项目用 `master`，agent 在 CI 中配成了 `[main]`。SPEC 和 PLAN 都没声明分支名 | 没写 |
| 3 | **`.gitignore` 内容未指定** | SPEC 威胁模型表中提了排除 `.env`、`secrets/`、`*.cred`，但没给完整基线。agent 自行补充了 `.codex/` 和 `.agents/`——这两个目录跟本项目毫无关系，是 agent 自身训练数据（Codex CLI）的"幻觉" | 没写完整 |
| 4 | **ESM import 的 `.js` 扩展名未说明** | agent 的所有 import 都带 `.js` 后缀，`NodeNext` 下这是正确的，但 SPEC/PLAN 完全没提——agent 依赖自身训练知识补全了 | 没写 |

### 2.3 与原意不一致的解读

| # | 差异 | PLAN 原文 | agent 的实际解读 | 是 spec 写错还是 agent 读错 |
|---|------|---------|----------------|--------------------------|
| 1 | `provider.ts` 定位 | 「导出 `LLMProvider` 接口，`complete(messages, tools) → Promise<LLMResponse>`」 | 接口既然在 `types.ts` 里，`provider.ts` 就只需一行 re-export | PLAN 写错——没有明确 `types.ts` 是唯一定义点，`provider.ts` 应从 `types.ts` import 而非 re-export |
| 2 | 分支名 | 无 | 自动用了 `main`（GitHub 新默认），未从 `.git/HEAD` 推断 | PLAN 没写——agent 用了训练数据中的合理默认值 |
| 3 | `.codex/`、`.agents/` 目录 | 无 | 写进了 `.gitignore`，看起来是 agent 从 Codex CLI 的训练数据中"借"来的 | PLAN 没写——agent 自行从训练数据补全 |
| 4 | CI 缺少 `cache: 'npm'` | PLAN 模板中有 `cache: 'npm'` | agent 生成的 CI 配置缺少此选项 | agent 读漏了 |

### 2.4 产出与预期差距

| 维度 | 评估 |
|------|------|
| **代码可运行性** | ✅ 7/7 测试全部通过，`tsc --noEmit` 无报错 |
| **代码质量** | ✅ 类型定义完整，事件系统、MockProvider 实现正确 |
| **与 SPEC 一致性** | ⚠️ 大体一致，但 CI 分支名不对、`.gitignore` 有幻觉条目、`provider.ts` 是空壳 re-export |
| **是否需要人工修正** | 是。需要修正 4 处（分支名 ×1、`.gitignore` ×2、`provider.ts` ×1）才能达到正式实现的标准 |

### 2.5 据此对 SPEC / PLAN 做的修订

#### 修订 1：SPEC 新增 §十二「项目约定与基线配置」

**修订前**：SPEC 没有「项目约定」章节，分支名、import 风格、`.gitignore` 基线均为隐性上下文。

**修订后**：新增 §十二，显式声明 4 项基础约定 + `.gitignore` 完整基线（40 行），并明确「新 agent 启动时必须创建完整的 `.gitignore`，不得依赖 agent 自身训练数据自行补充」。

**关键 diff**：
```diff
+ ## 十二、项目约定与基线配置
+ 
+ ### 12.1 基础约定
+ | Git 分支名 | `master` |
+ | 接口定义点 | `src/types.ts` 为所有共享接口的唯一定义点 |
+ | 模块解析 | `NodeNext`（ESM），import 路径须带 `.js` 扩展名 |
+ 
+ ### 12.2 `.gitignore` 基线
+ [40 行完整内容，覆盖凭据/OS/IDE/依赖/构建/日志/临时文件]
```

#### 修订 2：SPEC 风险表新增一条

**修订前**：风险表共 7 条，未涵盖「不同 agent 默认值差异」风险。

**修订后**：
```diff
+ | **不同 agent 使用自身默认值覆盖未约定项** | 
+   分支名、.gitignore 内容、import 风格等隐性约定在新 agent 上不成立 | 
+   **已通过冷启动验证确认**；§十二将基础约定显式化 |
```

#### 修订 3：PLAN 全局约束新增 4 条

**修订前**：全局约束未提及分支名、`.gitignore` 基线、接口定义点、ESM 约定。

**修订后**：
```diff
+ - **Git 分支名**：统一使用 `master`
+ - **`.gitignore` 基线**：不得由 agent 自行补充条目；使用 SPEC §12.2 的基线内容
+ - **接口定义点**：`src/types.ts` 为所有共享接口的唯一定义点
+ - **Import 路径**：`NodeNext` 模块解析，所有相对 import 须带 `.js` 扩展名
```

#### 修订 4：PLAN Task 1 新增 `.gitignore` 步骤 + CI 确认点 + 完成条件

**修订前**：
- 步骤列表无 `.gitignore` 创建
- CI 步骤只说「将 TODO 模板替换为生产步骤」
- 无完成条件

**修订后**：
```diff
+ - [ ] **步骤 1.5：创建 .gitignore** — 按 SPEC §12.2 基线，一字不差
  - [ ] **步骤 7：更新 CI 配置** — 触发分支为 `master`（不是 `main`）
+   > ⚠️ **确认点**：如 agent 不确定当前 repo 的默认分支名，应查看 `git branch` 确认
+ **完成条件：** `npm install` 无报错；`npx tsc --noEmit` 通过；3 个测试通过
```

#### 修订 5：PLAN Task 2 明确 `provider.ts` 定位 + 完成条件

**修订前**：
```
`src/llm/provider.ts`：导出 `LLMProvider` 接口
```

**修订后**：
```diff
- `src/llm/provider.ts`：导出 `LLMProvider` 接口
+ `src/llm/provider.ts`：从 `../types.js` import `LLMProvider`、`LLMResponse` 接口。
+   **不是接口的 re-export 文件**——接口定义在 `types.ts`。
+ **完成条件：** 4 个测试全部通过；MockProvider 满足 §A.4-C 判据
```

#### 修订前后对照汇总

| 修订项 | 涉及文件 | 变更类型 | 原因 |
|--------|---------|---------|------|
| SPEC §十二 项目约定 | SPEC.md | 新增章节 | 分支名/import/接口定义点/.gitignore 基线均未约定 |
| SPEC §十 风险表 | SPEC.md | 新增一行 | 不同 agent 默认值差异风险未被识别 |
| PLAN 全局约束 ×4 条 | PLAN.md | 新增条目 | 隐性约定未在 PLAN 中复述 |
| PLAN Task 1 步骤 1.5 | PLAN.md | 新增步骤 | `.gitignore` 创建被遗漏 |
| PLAN Task 1 步骤 7 确认点 | PLAN.md | 增加注释 | CI 分支名 agent 会假设 `main` |
| PLAN Task 1 完成条件 | PLAN.md | 新增字段 | 无客观完成标准 |
| PLAN Task 2 provider.ts 说明 | PLAN.md | 改写 | 原描述导致 agent 做成 re-export |
| PLAN Task 2 完成条件 | PLAN.md | 新增字段 | 无客观完成标准 |

---

## 三、冷启动验证反思

### 3.1 SPEC 质量自评

冷启动验证前，我认为 SPEC 已经足够清晰——毕竟 brainstorming 花了大量时间推敲每个细节。但一个从未参与那场对话的 agent 在几个小时内就暴露了 4 类我之前完全没意识到的缺陷。

我和主 agent 在 brainstorming 阶段沉淀的大量共享的隐性上下文确实让我严重高估了 spec 的清晰度。

### 3.2 为什么 agent 没提问

这个问题比「暴露了哪些缺陷」更值得深思。

1. **SPEC 没有「必须确认」的标记**。PLAN 是一份指令列表，而非一份要求 agent 在关键节点停下确认的工作流。agent 遇到分支名、`.gitignore` 内容等隐性约定时，不会想到"这需要确认"——它直接用了自己的默认值。
2. **PLAN 有动作、无"完成"定义**。agent 不知道什么时候算一个 task 结束——它只是把步骤做完就停了，没有自检。这导致了"代码能跑就算完成"的行为，而非"代码符合预期才算完成"。
3. **PLAN 代码块足够详细，但缺失了关键的检查点**。Task 1-2 的代码块本身是好的——详细代码块能在实现阶段减少 subagent 之间的不一致。问题不在于"太完整"，而在于完整中漏掉了两个关键信息：**这些代码依赖什么隐性约定**（分支名、import 约定）以及 **做完之后怎样算合格**（完成条件）。

以上三点中，第 1 和第 2 点已通过修订解决：确认点（Task 1 步骤 7 的 ⚠️ 标记）、完成条件（Task 1、Task 2 新增的验收标准）、基础约定（SPEC §十二 + PLAN 全局约束 4 条）。第 3 点中「代码块缺失关键上下文」已通过 SPEC 和 PLAN 的全局约束补足——代码块本身保留，但 agent 现在有了额外的约束清单。

### 3.3 冷启动验证的价值

如果不做冷启动验证，上述 4 个缺陷将一直潜伏到正式实现阶段。届时很可能出现一个 subagent 在 worktree 中创建了 branch `main` 而仓库默认是 `master` 的合并混乱，或 `.gitignore` 中混杂着跟项目无关的条目却不为人知。

冷启动验证是单人项目中最接近"同侪评审"的机制——它不检查你的实现是否正确（那要等到测试），而是检查你的规约是否真正写清楚了。
