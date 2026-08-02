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

### 10. 计划内未完成（Task 20/21/22）[计划内]
- Task 20 机制演示（§A.6 三项 mock 演示）
- Task 21 分发（`npm install -g` + `docker build && docker run`）
- Task 22 文档（README）

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

---

## 三、测试盲区教训（真实 LLM 测试的价值）

1. **Mock fixture 与真实代码格式不一致**：DeepSeek 测试 fixture 用标准 JSON Schema，真实工具用属性表——436 个测试全绿也掩盖了 schema 契约错误。**测试 fixture 必须来自真实代码路径**。
2. **协议契约只能真实 API 暴露**：tool_call_id、feedback 角色、schema 格式——三个 400 错误都是 Mock 测试覆盖不到的协议层。
3. **环境差异是真实测试的职责**：UTF-16 文件、Windows 缺 xxd、npx 下载陷阱——这些不属于 Mock 测试范围，但直接影响真实用户。

---

*维护：测试/评审过程中发现的新问题按「来源 + 现象 + 建议」追加到第一节；已修复的移到第二节归档。*
