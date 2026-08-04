# CodeHarness — 已知问题与改进清单（Known Issues & Product Gaps）

> 本文档汇总真实测试暴露的产品边界、评审发现的改进项与设计决策。
> 来源标注：**[实测]** = 用户真实 LLM 测试暴露；**[评审]** = 两阶段代码评审发现；**[设计]** = 需求/架构决策。
> 状态：`待改进` / `已修复`（含 commit）/ `计划内`（对应 PLAN Task）。

---

## 一、待改进（按优先级）

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
| **应用 nju 后调用仍发 deepseek**（应用按钮只切 WebUI 层 liveConfig，agent loop 每次 `buildAgentLoop` 用 createWebHarness 启动快照 config → 新会话/恢复/重启仍用旧供应商；且 abort 只在轮边界检查，慢 LLM 调用期间的中断被当前轮跑完抑制了重启）[实测] | ① runSession 改用 liveConfig 构建 provider（persistConfig 包装同步，应用立即生效）② `onConfigChanged`：llm.provider/baseUrl/model 变化 → 重启所有 running 会话 ③ main-loop `llm.complete()` 返回后补 abort 检查（轮内中断立即 break） | `366c6b2` |
| **LLM call failed 裸报错**（"404 openai_error" 无端点/状态/响应信息——多供应商下无法判断是 baseUrl 填错还是协议不兼容）[实测] | provider 增强：HTTP 错误（数字 status）抛 `LLM API 调用失败（{baseUrl}/chat/completions，HTTP {status}）：{消息} 响应：{body 前 200 字符}——请检查 API 地址是否为 OpenAI 兼容端点（通常以 /v1 结尾）`；非 HTTP 错误（网络）原样透传 | `27d320b` |
| **供应商信息编辑后行内/下方配置不刷新**（① 更新 baseURL 后需刷新页面左侧才显示新值——KeyRow 保存后不通知父级，KeyManagementCard.meta 是行内 baseUrl 显示源；② 修改供应商信息后需"先应用别的供应商再重新应用 + 刷新"下方配置才更新——POST /api/keys 只写 registry 不同步激活供应商的 llm.baseUrl，且前端 Settings.config 保存后不重拉）[实测] | ① KeyRow 加 `onSaved` → KeyManagementCard `load()` 重拉列表 + Settings `handleRegistryChanged` 重拉 config（仅 registry 实际变化时触发，纯 key 保存不打扰未保存的表单编辑）② keys.ts：`provider === config.llm.provider && hasBaseUrl` 时同一 persist 内同步 `llm.baseUrl` 并触发 `onConfigChanged`（运行中 loop 重启契约，评审补）③ 负向测试：非激活供应商编辑不误伤 llm.baseUrl | `8612a61` |
| **会话详情 tab 恒跳第一个会话**（多会话时从详情页切走再切回，打开的是 sessions[0] 而非切换前查看的会话——SessionDetailTab 无记忆）[实测] | App.tsx sessionStorage 记忆 lastSessionId（pathname useEffect 记录，刷新可恢复；点击 tab 优先跳 lastSessionId，会话被删回退 sessions[0]；decodeURIComponent try/catch 防畸形 % 编码白屏） | `8612a61` |
| **配置编辑板块不跟随 config 变化**（编辑激活供应商端点后，模型与护栏处立即更新但 JSON 编辑器仍显示旧值——ConfigEditorCard 只在自己 mount 时加载一次，保留静态快照；编辑器保存后模型卡也不跟随）[实测] | ConfigEditorCard 接收共享 config：外部变化（registry 编辑/供应商切换）时同步编辑器文本（baselineRef 脏检测——用户未保存的编辑不被覆盖）；保存成功后 merged 通过 onSaved 反向传播到设置页 config（模型与护栏/通用卡跟随）——三板块同一真源 | `dbae4f9` |
| **parseActions 对 markdown 总结误判 JSON**（agent 输出含代码块/链接的 markdown 总结被判定"看起来像 JSON" → JSON.parse 失败 → 回灌 parse_error → 白重写；真实会话 a4b7e7fe 复现：`用md格式写一段话` 含 `[链接](…)` → 回复 3 次才完成，严重度实测升中）[实测] | JSON 判定收紧为 **trim 后以 `{` 或 `[` 开头** 才算 JSON 尝试（`content.includes` → `startsWith`，文本中间的括号不再误伤）；parse_error 恢复测试参数化覆盖 `{`/`[` 两种残缺开头；回归测试：markdown 含链接+ts 代码块 → 无 parse_error、1 轮完成 | `[未提交]` |
| **CLI 模式 HITL 暂停后无恢复指引**（`start <task>` 直跑触发 maxRounds 升级暂停后进程退出，仅输出 `[session] paused`——升级暂停无 pending command，stdin 交互循环不触发，用户不知如何恢复）[实测] | runStartTask 结束时 status=paused 输出恢复指引：重跑（提高 maxRounds）或改用 `codeharness start --web`（WebUI 批准恢复，`continueSession` 的 `maxRounds += currentRound` 路径已核实）；测试断言指引含 `--web`/`maxRounds` | `07a1111` |
| **read_file 无编码检测**（UTF-16 含 BOM 文件按 UTF-8 读取乱码——PowerShell 5.1 重定向默认写 UTF-16LE 触发；无 BOM 的 GBK 静默乱码）[实测] | BOM 驱动的编码探测：UTF-8（剥 BOM）/UTF-16LE/BE（TextDecoder fatal，奇数长度与孤立代理 → per-file error）/UTF-32LE/BE（手写解码，%4 校验 + 码点范围校验）全覆盖；无 BOM → `TextDecoder('utf-8', {fatal:true})` 严格校验，失败返回带 `file`/`iconv` 兜底指引的明确错误（"正确或明确失败优先"——无 BOM 编码不可判定，不做猜测；对比 Claude Code 官方是静默 U+FFFD 乱码）。评审发现并修复静默损坏路径：UTF-16 奇数长度丢字节、UTF-32 截断、孤立代理。测试 +12（红→绿） | `81f1aab` |
| **run_test/testRunner 无环境前提检查**（run_test 工具与 TestResultValidator 在无 vitest 环境触发 `npx vitest` 下载；`npx tsc` 在无本地 TypeScript 时下载废弃同名包 `tsc@2.0.4`、`npx eslint` 同理——环境噪音污染反馈闭环）[实测] | 统一"环境前提检查"模式（`src/utils/env-prereq.ts` `hasLocalBin`，覆盖 POSIX sh / .cmd / .ps1 三种 bin 变体）：① run_test 无本地 vitest → `success:false` + 可操作错误（`npm i -D vitest` 指引）② TestResultValidator 无 vitest → passed:true + skipped ③ eslint/tsc 有配置文件但无本地 bin → skip（`npx tsc` 的废弃包陷阱根除；npx 保留，前置 bin 检查保证 npx 只解析本地）。run_shell 未拦（npx 是 agent 合法工具，守卫只落在确定性代码路径）。测试 +8（4 skip 红→绿 + 4 hasLocalBin 直测）；评审 Minor×4 全部处理（清理 try/finally、.ps1 直测、tsbuildinfo 删除、import 顺序） | `08b5469` |
| **scope-fence 词法路径校验的符号链接局限**（`validatePath` 为 `path.resolve` + 前缀匹配（无 realpath）——会话根内符号链接（`root/link → /etc`）可绕过围栏读写根外）[评审] | 两层校验：① 词法快路径（根外直接拒绝，零 IO）② canonical 校验——`canonicalize()` 对**最近存在祖先** realpath（写入目标可能尚不存在，ENOENT 走 walk-up 重挂词法尾部；叶子不存在时**不可能**是 symlink，截断安全）再前缀比较（win32 大小写归一）。**fail-closed（评审 Important）**：ELOOP/EACCES/EMFILE 等非 ENOENT 错误返回 null → 拒绝——叶子可能是真实逃逸 symlink 而截断接受会放行。canonical root 按 workspaceRoot memoize（热路径每工具动作从 2 次 realpath 降到 1 次）。测试 +5（真实 junction/symlink：逃逸拦截 ×2、根内放行、不存在目标放行、ELOOP 双向循环 fail-closed；skipIf 链接不可用） | `4ba6eaa` `f66dbd8` |
| **多会话并发 HITL 键控**（HITLManager 全局单例，pending 命令无会话归属——两个会话同时触发 warn 第二个静默变 "HITL busy"；`POST /api/approvals/:sessionId` 不校验 id 归属）[评审] | HITLManager 全部方法显式 `sessionId` 参数，状态 Map 键控（`Map<string, SessionHITL>` 惰性创建）；`removeSession` 删除条目（REPL /clear 接线——**行为变化**：新会话新 id → 重发已批准命令需重新确认，比旧共享 cache 更安全，注释文档化）；approvals API 归属校验：`getState(session.id) !== AWAITING_APPROVAL` → 409 带当前状态（400→404→409 顺序保持契约；try/catch 保留防御状态守卫）。CLI 侧（repl/start）循环与 main-loop 全部传 `session.id`。测试 +7（键控单测 ×4、approvals 归属 409、main-loop 集成：两 loop 共享 HITLManager 各会话独立 pending/批准互不影响、removeSession ×2） | `7929b1a` `f66dbd8` |
| **Windows 工具差异**（agent 调用 `xxd`（Unix 工具）在 Windows 上不存在——真实执行失败并消耗轮次；调查确认 harness 原本无主 system prompt，LLM 只能靠踩坑学习平台限制）[实测] | 新建 `src/utils/platform-guidance.ts`：`platformGuidance(platform)` 纯函数，win32 返回环境提示（xxd→`od -A x -t x1z` 替代、`command -v` 确认、Git Bash 存在性限定、PowerShell 5.1 UTF-16LE、裸 npx 废弃包陷阱），POSIX 返回 undefined 零噪音；main-loop run() 初始化注入 system 消息（幂等守卫防恢复/重启累积——评审发现双写会在 resume 路径每条 guidance 重复 seed 两次）。测试 +5（4 单测 + 2 集成含幂等回归，skipIf 非 win32 保 CI 可移植）；评审 Important×1（幂等守卫）+ Minor×4 全部处理 | `146cb75` |
| **run_test 无 pattern 参数行为不明确**（真实抓取 vitest v2.1.9 输出发现根因：**pipe 下仍输出 ANSI SGR 颜色码**——`\x1b[32m✓\x1b[39m path`、`\x1b[1m\x1b[32m48 passed\x1b[39m`，旧正则假设 ✓ 后直接是文件名、summary 数字直接跟在 Test Files 后，全部匹配失败 → 恒返回 `{passed:false, results:[]}`——587 测试全过也报失败，agent 困惑后改用 run_shell 直跑）[实测] | ① 解析前 `stripAnsi()` 剥离 CSI 序列（`\x1b\[[0-9;?]*[a-zA-Z]`，`?` 覆盖私有序列）——根因修复 ② summary 行解析重构（`2 failed \| 46 passed (48)`→false、`48 passed (48)`→true、全 failed→false）③ 完全无法解析（新版本/语言/包装器）→ output 附 `rawOutput`（截断 4000 + 显式标记），不再静默报 `{passed:false}` ④ output 附 `command` 字段（agent 知道实际执行了什么，无 pattern 即跑全部）。测试 +6（fixture 来自真实 `npx vitest run \| cat -v` 抓取 + 评审补 3 边界：**skipped 后缀行误报 passed**（`(5 tests \| 1 failed \| 2 skipped)` 使正则不匹配失败行、其他 ✓ 行短路 passed:true——Important 已修：per-file 分支也 consult summary 行）、全 failed summary、4000 截断）；评审对照 vitest 2.1.9 dist 源码逐一核实 fixture 真实性 | `4da212b` `22cc72a` |

---

## 三、测试盲区教训（真实 LLM 测试的价值）

1. **Mock fixture 与真实代码格式不一致**：DeepSeek 测试 fixture 用标准 JSON Schema，真实工具用属性表——436 个测试全绿也掩盖了 schema 契约错误。**测试 fixture 必须来自真实代码路径**。
2. **协议契约只能真实 API 暴露**：tool_call_id、feedback 角色、schema 格式——三个 400 错误都是 Mock 测试覆盖不到的协议层。
3. **环境差异是真实测试的职责**：UTF-16 文件、Windows 缺 xxd、npx 下载陷阱——这些不属于 Mock 测试范围，但直接影响真实用户。

---

*维护：测试/评审过程中发现的新问题按「来源 + 现象 + 建议」追加到第一节；已修复的移到第二节归档。*
