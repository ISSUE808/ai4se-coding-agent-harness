# CodeHarness — 已知问题与改进清单（Known Issues & Product Gaps）

> 本文档汇总真实测试暴露的产品边界、评审发现的改进项与设计决策。
> 来源标注：**[实测]** = 用户真实 LLM 测试暴露；**[评审]** = 两阶段代码评审发现；**[设计]** = 需求/架构决策。
> 状态：`待改进` / `已修复`（含 commit）/ `计划内`（对应 PLAN Task）。

---

## 一、待改进（按优先级）

### 1. CLI 模式 HITL 暂停后无恢复指引（中）[实测]
- **现象**：`start <task>` 直跑时触发 HITL（warn 批准或 maxRounds 升级），会话 `paused` 后进程退出，输出仅有 `[session] paused`——用户不知道如何恢复，也没有 CLI 内交互批准途径。
- **建议**：CLI 在 HITL 暂停时输出可操作指引（如"使用 `codeharness start --web` 或 WebUI 批准 API 恢复会话"）；或为 CLI 增加交互式批准模式（读 stdin）。
- **位置**：`src/cli/commands/start.ts`（runStartTask 的状态输出）。

### 2. read_file 无编码检测（中）[实测]
- **现象**：UTF-16（含 BOM）文件按 UTF-8 读取产生乱码（PowerShell 5.1 重定向默认写 UTF-16LE 触发）。node 运行带 BOM 的 UTF-16 文件成功，但 `read_file` 乱码——同一文件两种行为。
- **建议**：`read_file` 增加 BOM/编码探测（UTF-8 BOM、UTF-16LE/BE BOM 检测，非 UTF-8 时返回明确提示或尝试解码）。
- **位置**：`src/tools/read-file.ts`。
- **关联**：开发环境提醒——PowerShell 用户创建文件应显式 `-Encoding utf8`。

### 3. 其余校验器的环境前提检查（中）[实测]
- **现象**：eslint/tsc 校验器已实现"无配置 → 跳过"（SPEC §10 未决问题 2），但 `run_test` 工具在无 vitest 环境会触发 `npx vitest` 下载；TestResultValidator 同样依赖环境。
- **建议**：对 run_test / testRunner 校验器做同样的前提检测（package.json 声明 vitest/jest 才执行）；统一封装"环境前提检查"模式。
- **位置**：`src/tools/run-test.ts`、`src/feedback/validators/test-result-validator.ts`。

### 4. npx 依赖下载陷阱（中）[实测]
- **现象**：`npx tsc` 在无本地 TypeScript 时下载 npm 上的**废弃同名包** `tsc@2.0.4`（非 TypeScript 官方）；`npx eslint` 同理。环境噪音曾污染反馈闭环（已通过 skip 缓解）。
- **建议**：run_shell / 校验器层优先使用本地 `node_modules/.bin`，避免裸 `npx`；或对 npx 下载行为显式提示。

### 5. Windows 工具差异（中）[实测]
- **现象**：agent 调用 `xxd`（Unix 工具）在 Windows 上不存在——真实执行失败并消耗轮次。
- **建议**：agent system prompt 注入平台感知（Windows 可用工具清单/替代品，如 `certutil`/PowerShell）；或工具层做平台适配（`xxd` → 内置 read 原始字节）。

### 6. 多会话并发 HITL 键控（架构级，后续版本）[评审]
- **现象**：HITLManager 为全局单例，pending 命令无会话归属——两个会话同时触发 warn 时，第二个静默变 "HITL busy"；`POST /api/approvals/:sessionId` 不校验 id 归属。
- **建议**：HITL 状态按 sessionId 键控；approvals API 校验 pending 命令所属会话。
- **位置**：`src/guardrail/hitl-manager.ts`、`src/webui/api/approvals.ts`。
- **状态**：已在 `createWebHarness.runSession` 注释注明为已知限制。

### 7. scope-fence 词法路径校验的符号链接局限（安全增强）[评审]
- **现象**：`validatePath` 为 `path.resolve` + 前缀匹配（无 realpath）——会话根内符号链接（`root/link → /etc`）可绕过围栏读写根外。
- **评估**：信任模型为"用户本地授权目录"，风险低（Task 8 起既有）。
- **建议**：校验时对最终路径做 `fs.realpath` 后再前缀匹配；在 scope-fence.ts 头注释注明已知限制。

### 8. CLI `--cwd` 未实现（可选增强）[设计]
- **现象**：PLAN Task 19 需求备注第 5 项"CLI start 加 --cwd 选项"标注可选增强，未实现。
- **建议**：`start` 增加 `--cwd <path>` 覆盖 `config.agent.workspaceRoot`（复用会话级 workspaceRoot 链路）。
- **位置**：`src/cli/commands/start.ts`（已注释注明）。

### 9. WebUI 功能占位项（低）[设计]
| 项 | 现状 | 建议 |
|----|------|------|
| 顶部搜索框 | 纯装饰（⌘K 无行为） | 实现前端过滤（Dashboard 会话/任务/文件） |
| 会话详情「终端」tab | 占位提示（"Task 19 接入"） | 接入 agent 运行日志/终端流 |
| Settings「清空会话」danger-zone | 按钮 disabled（"Task 19 后提供"） | 新增 DELETE 端点（会话批量清空） |
| 上下文栏 Token 明细 | 仅总计 | 后端提供输入/输出/缓存命中统计 |

### 9.5 parseActions 对 markdown 总结误判 JSON（低）[实测]
- **现象**：agent 输出含代码块的 markdown 总结（如 `**add.ts** — ...` + ts 代码块）被 `parseActions` 判定为"看起来像 JSON" → 尝试 `JSON.parse` 失败 → 回灌 `parse_error` 反馈 → agent 多消耗一轮重新输出纯文本才完成。
- **建议**：`parseActions` 的 JSON 判定收紧（如仅当 content 以 `{`/`[` 开头且 trim 后首尾配对才尝试解析），或 parse_error 反馈带上更明确的格式要求。
- **位置**：`src/core/main-loop.ts`（parseActions）。

### 9.6 run_test 无 pattern 参数行为不明确（低）[实测]
- **现象**：`run_test` 无参数调用返回 `{passed:false, results:[]}`（无 pattern 匹配），agent 困惑后自适应改用 `run_shell` 直跑 vitest 成功——工具默认行为（无 pattern 时跑全部？）与反馈信息不清晰。
- **建议**：`run_test` 无 pattern 时明确跑全部测试并解析结果（或返回可操作的错误信息说明默认行为）；结果解析失败时输出原始 stdout 帮助 agent 理解。
- **位置**：`src/tools/run-test.ts`。

### 10. 计划内未完成（Task 20/21/22）[计划内]
- Task 20 机制演示（§A.6 三项 mock 演示）
- Task 21 分发（`npm install -g` + `docker build && docker run`）
- Task 22 文档（README）

### 11. 目录选择器整机浏览端点放开（安全取舍，接受）[设计]
- **背景**：用户需求"目录选择器可以选择整台电脑的任何目录"→ 新增 `GET /api/fs/browse` 无授权浏览端点；`/api/fs/tree` 保持授权根不变。
- **评估**：任何能访问 WebUI 的客户端可枚举本机目录结构（目录/文件名、类型、大小）——仅**元数据**、不返回文件内容，与本地 CLI `ls` 等价的信息暴露；配合用户在场监督模式（创建会话时选中的目录成为授权根），风险可接受。
- **边界**：会话详情文件树仍走 `GET /api/fs/tree`（仅授权根）；browse 不跟随 symlink（标记 `link`）。**内容分级**：`GET /api/fs/file`（内容预览）收紧到 /tree 的授权根边界（realpath 防逃逸 + 256KB 上限 413）——元数据可整机浏览，文件内容只在授权根内可读（1.5 跟进，commit `24d39b5`）。
- **位置**：`src/webui/api/fs.ts`（/browse、/file 路由）、`src/webui/client/src/components/DirectoryPicker.tsx`。

---

## 二、已修复（归档）

| 问题 | 修复 | commit |
|------|------|--------|
| 工具 parameters 属性表被 DeepSeek 400 拒绝（schema 需 `type:'object'`） | `toOpenAIToolParameters` 转换 + 测试（含 fixture 与真实格式不一致的教训） | `be7c51a` |
| OpenAI 工具调用协议：tool 消息缺 `tool_call_id`、assistant 未重发 tool_calls | id 贯穿链路（LLMResponse/Action/Message.metadata.toolCallId）+ 协议测试 | `e584e27` |
| `feedback` 角色不在 OpenAI 协议中（400 unknown variant） | provider 映射 feedback → system（反馈内容必须到达 LLM） | `1598dc1` |
| eslint 校验器在无配置项目报环境错误（污染反馈） | 无 `eslint.config.*` → 跳过（passed + skipped） | `1598dc1` |
| tsc 校验器触发 `npx tsc` 下载废弃包 | 无 `tsconfig.json` → 跳过 | `b1795eb` |
| HITLManager 批准后永不回 IDLE（第二次起静默拦截） | 每次 run 前 `hitl.reset()` + 第二次 warn 批准测试 | `d411349` |
| 升级暂停的会话无法恢复（批准后立即再升级死循环） | 批准恢复时 `maxRounds += currentRound` 写回持久化 | `d411349` |
| REST 控制端点假状态（resume 不启动 loop / pause 不感知） | AbortSignal 轮级取消 + activeRuns Map + 真实控制测试 | `d411349` |
| `start --help` 退出码 1（exitOverride 无条件启用） | 仅测试注入启用 + 白盒测试 | `d411349` |
| POST /api/sessions 静默丢弃 maxRounds | 透传 + `0=无上限` 语义（RoundManager/shouldTerminate） | `ab7a932` |
| PUT /api/config 接受明文密钥字段 | 400 拒绝 + 引导 /api/keys/:provider（SPEC §3.6） | Task 17 CR `6fe864d` |
| TopBar `isActive` 作用域白屏 + 无壳级测试 | render prop 修复 + App.test.tsx（120 client 测试） | `ab7a932` |
| CI 不跑 client 测试 | 新增 `webui-client` job（tests + build） | `ae024ca` |
| 真实 API 协议 400（schema/tool_call_id/feedback 角色/配对顺序，4 个） | schema 转换 + id 贯穿 + feedback→system + 连续化稳定 | `be7c51a` `e584e27` `1598dc1` `c5fbaae` |
| Windows shell 不兼容（cmd 不认 POSIX 命令/路径） | run_shell 用 Git Bash（存在时） | `f1ee861` |
| eslint/tsc 环境前提（无配置时 npx 下载废弃包） | 无配置 → 跳过 | `1598dc1` `b1795eb` |
| WS 广播截断（content substring 200，长消息实时截断） | 广播完整内容 | `3295dbb` |
| 消息流卡片刷新后塌陷成线（flex-shrink + overflow hidden） | 子项 flexShrink: 0 | `07464ec` |
| 行重叠（body 缺 line-height）+ 长 system 消息显示 | body 1.5 + SystemCard 折叠卡 | `ecdebb3` `e38bb6d` |
| 批准卡刷新消失 / completed 后僵尸卡 | 快照重建（仅 paused）+ 后端存 command/rule | `ecdebb3` `f1ee861` |
| completed 会话发消息无反应 | onMessageAdded → 恢复/中断注入 | `d320db5` |
| **用户在场监督模式（Claude Code 式）**：工作区外读写确认、批准后工具结果原地替换、CLI stdin 交互、已批准命令记忆 | 监督模式全链路 | `5acf8bd` `d934b08` `0e3c972` 等 |
| maxRounds 默认 3 太小 | 默认 0（无上限，参照 Claude Code --max-turns） | `553aa4d` |
| config PUT 只查固定路径 + 报错路径误导 + 编辑器 token 残留 | 深度密钥字段拒绝 + 精确报错 + 编辑器剥离 token | `6190334` |
| **1.4 文件树不随消息流刷新**（新建文件需刷新页面才出现——M5 静态快照取舍）[实测] | 新 tool 变更消息到达后 debounce 300ms 自动重取（首次快照吸收不重复 fetch + 请求代际防覆盖） | `2be2f88` |
| **1.5 预览为空**（write_file 无 output 摘要 → 预览占位；后端无 diff 端点）[实测] | 新增授权根内 `GET /api/fs/file` 内容端点 + 前端点击文件拉真实内容预览；工具摘要逻辑移除 | `24d39b5` |
| **1.6 W_OK 校验失效**（Windows `fs.access` 只查属性不查 ACL，`C:\Windows` 恒过——手动输入与选择器行为不一致）[实测] | 删除可写校验，任意已存在目录可建会话（选择器/手动输入等价，监督模式"选中即授权"）；树加载错误保留为可见反馈 | `f1f60fd` |
| **4.1 模型选择器不渲染**（前端读顶层 `config.model`，真实 Config 的 model 在 `config.llm.model` → `configModel` 恒 null → 渲染条件恒假；测试 mock 恰好用了错误结构所以全绿）[实测] | 改为 `llm.model` 读取（窄化风格同 guardrails）+ 测试 mock 修正为真实结构 | `976b611` |
| **自定义模型与配置不联动**（会话页手动填模型只改会话 override，设置里的全局默认 llm.model 不变，下次会话仍用旧模型）[实测] | ① 新增 `GET /api/llm/models`（后端持 key 调供应商 `/models`，密钥不出服务端）② 选择器列表模式：仅列出已获取模型（拉取失败回退手动输入+提示）③ 选择模型时 PATCH 会话 override **并** PUT config llm.model 双更新（config 失败不阻断会话切换）④ 设置页"供应商模型列表"区块（自动加载+刷新+点选填入表单） | `a8eca19` `7553229` |
| **模型列表只显示当前供应商**（设置里只有 deepseek 的模型，无法看/切其他供应商）[实测] | ① 供应商注册表 `llm.providers`（baseUrl + defaultModel，key 仍存凭据层）② key 行加"应用"按钮：激活 = 切 llm.provider/baseUrl，有 defaultModel 直接带、否则取新供应商模型列表第一个 ③ 添加供应商表单（名称 + baseUrl 必填 + 默认模型可选）④ GET /api/keys 返回 baseUrl/isActive，列表 = 凭据 ∪ 注册表 ⑤ liveConfig 重构：PUT config 后模型列表/keys 端点跟随（getConfig 函数式） | `9b097d8` `69997df` |
| **切换供应商后已注册供应商被清掉**（nju → deepseek → 再应用 nju 报"未配置 API 地址"——config router 持启动快照 `current`，POST keys 注册只更新 liveConfig，后续 PUT config 以旧快照 merge 把注册表条目覆盖删除，含持久化文件）[实测] | config router 去状态化：GET/PUT 统一读 `getConfig()（liveConfig 单一真源）`，删除 `current` 快照；+回归测试（注册→应用 A→应用 B→注册表存活） | `b6efc7b` |

---

## 三、测试盲区教训（真实 LLM 测试的价值）

1. **Mock fixture 与真实代码格式不一致**：DeepSeek 测试 fixture 用标准 JSON Schema，真实工具用属性表——436 个测试全绿也掩盖了 schema 契约错误。**测试 fixture 必须来自真实代码路径**。
2. **协议契约只能真实 API 暴露**：tool_call_id、feedback 角色、schema 格式——三个 400 错误都是 Mock 测试覆盖不到的协议层。
3. **环境差异是真实测试的职责**：UTF-16 文件、Windows 缺 xxd、npx 下载陷阱——这些不属于 Mock 测试范围，但直接影响真实用户。

---

*维护：测试/评审过程中发现的新问题按「来源 + 现象 + 建议」追加到第一节；已修复的移到第二节归档。*
