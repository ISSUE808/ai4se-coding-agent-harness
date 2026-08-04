# CodeHarness 修复验收测试流程

> 覆盖 enhance 分支已归档的 KNOWN_ISSUES 修复：**9.5、1、2、3/4、5、9.6、6、7、9**。
> 每项给出：准备 → 操作 → 预期（通过标准）→ 失败定位（该修复对应的自动化测试）。
> 手工测试需要真实 LLM（DeepSeek，密钥已在 keytar）——mock provider 不覆盖这些场景。

---

## 0. 前置准备

```bash
# 分支前提：这批修复在 worktree-enhance，master 尚未合并
cd ".claude/worktrees/enhance"

# 1) 构建（dist 要包含最新改动）
npm run build

# 2) 启动后端（终端 A，保持运行）——只挂 API + WS（/api、/ws），不服务页面
node dist/cli/index.js start --web

# 3) 启动 client dev server（终端 B，保持运行）——Vite 代理 /api、/ws 到后端
cd src/webui/client && npm run dev
# → 打开 http://localhost:5173（Vite 默认端口；若被占用会顺延 5174…），
#   右上角确认模型为 deepseek。3000 是后端端口，浏览器只访问 5173。

# 4) 准备测试工作区（在项目根下，之后所有测试文件放这里）
mkdir -p test-verify
```

> **CLI 直跑**（B8 需要）：另开终端 C，`cd .claude/worktrees/enhance` 后用
> `node dist/cli/index.js start "任务"` 跑单次任务。

---

## A. 自动化回归（5 分钟，所有修复的底线）

```bash
cd ".claude/worktrees/enhance"
npm test                    # 主套件：614 passed（0 failed）
npx tsc --noEmit            # 主工程类型检查：无输出即过

cd src/webui/client
npm test                    # client 套件：216 passed
npx tsc --noEmit            # client 类型检查：无输出即过
```

**通过标准**：4 条命令全部无失败、无类型错误。
**失败定位**：任意失败 = 有回归，先看失败测试名再进手工部分。

---

## B. 手工验收（按修复逐项）

### B1. #9.5 markdown 不再误判（parseActions）

| | |
|---|---|
| 操作 | WebUI 新建会话，任务输入：`用md格式写一段话，其中包含一个[链接](https://example.com)和一段typescript代码块` |
| 预期 | 会话 **1 轮完成**（顶部轮次显示 1）；消息区**无** parse_error 反馈；输出是完整 markdown（链接 + 代码块原样保留） |
| 修复前行为 | 同一任务回复 3 次（parse_error → 重写 → 再误判） |
| 失败定位 | `tests/integration/main-loop.test.ts` → 「Markdown 含链接不触发 parse_error」 |

### B2. #2 read_file 编码检测

```bash
# 准备：UTF-16LE 文件（PowerShell 默认 BOM）+ 无 BOM 的 GBK 文件（记事本"另存为"选 ANSI）
powershell -NoProfile -Command "Out-File -FilePath .\test-verify\u16.txt -Encoding utf16 -InputObject '你好 world'"
# GBK 文件：记事本打开 test-verify/gbk.txt 输入"中文乱码测试"，另存为 → 编码选"ANSI"
```

| | |
|---|---|
| 操作 | 会话任务：`读取 test-verify/u16.txt 和 test-verify/gbk.txt，报告内容` |
| 预期 | ① UTF-16 文件内容正确显示「你好 world」（此前是乱码）② GBK 无 BOM 文件：read_file 返回**明确错误**（含 `iconv`/`file` 兜底指引），agent 应改用 run_shell `iconv` 兜底读出内容 |
| 失败定位 | `tests/unit/tools/read-file.test.ts`（+13 编码测试） |

### B3. #9.6 run_test 真实解析

| | |
|---|---|
| 操作 | 会话任务：`运行项目测试并报告结果`（工作区= enhance worktree） |
| 预期 | agent 调用 run_test 后返回 **passed:true + 48 个测试文件逐项结果**；消息里工具输出是结构化 JSON（含 `command` 字段，证明跑的是全部测试） |
| 修复前行为 | 无论 587 个测试是否全过，恒返回 `{passed:false, results:[]}`，agent 被迫改用 run_shell 直跑 |
| 失败定位 | `tests/unit/tools/run-test.test.ts`（ANSI fixture 解析 + skipped 行兜底） |

### B4. #3/4 环境前置检查（无 npx 下载陷阱）

| | |
|---|---|
| 准备 | 建一个**没有 node_modules** 的临时目录（如 `C:\Users\ISSUE\Desktop\empty-ws`），新建会话时工作目录选它 |
| 操作 | 会话任务：`运行测试` |
| 预期 | ① run_test **立即失败**并返回可操作错误（"vitest is not installed…`npm i -D vitest`"）② 会话期间**网络无 npx 下载**（npm 缓存/抓包不可行则观察：错误消息直接给出，无等待下载的迹象）③ agent 转而用 run_shell 或告知用户安装 |
| 补充（CLI） | 在 empty-ws 里 `npx tsc --version` —— 应**失败**（无本地 TypeScript），而不是下载废弃包 `tsc@2.0.4` 打印版本 |
| 失败定位 | `tests/unit/tools/run-test.test.ts`「vitest 未安装时明确失败」+ `tests/unit/utils/env-prereq.test.ts` |

### B5. #5 平台感知注入（Windows 工具差异）

| | |
|---|---|
| 操作 | 新建会话，任务：`查看 test-verify/u16.txt 的原始字节（前 16 字节的十六进制）` |
| 预期 | agent **不调用 `xxd`**——首轮直接 `od -A x -t x1z`（platformGuidance 已在首轮注入 system 上下文）。顺带验证输出首字节是 `FF FE`（UTF-16LE BOM） |
| 修复前行为 | agent 首轮调 `xxd` 失败烧掉一个轮次，第二/三轮才换工具 |
| 失败定位 | `tests/unit/utils/platform-guidance.test.ts` + `tests/integration/main-loop.test.ts`（skipIf 非 win32 的两个注入测试） |

### B6. #6 HITL 多会话键控（并发 pending 互不干扰）

| | |
|---|---|
| 准备 | 确认工作区有 test-verify 目录（作为"工作区外"的对照目标） |
| 操作 | ① 会话 A 任务：`创建文件 C:\Users\ISSUE\Desktop\hitl-outside-a.txt 内容为 test` → A 暂停，出现批准卡片 ② **A 仍 pending 时**创建会话 B，任务：`创建文件 C:\Users\ISSUE\Desktop\hitl-outside-b.txt 内容为 test` |
| 预期 | ② B **也出现自己的批准卡片**（修复前：第二个会话静默 "HITL busy"、无卡片）③ 在 A 上点批准 → A 执行并恢复；**B 的卡片仍在** ④ 在 B 上点拒绝 → B 记录 denied 且不执行 |
| 失败定位 | `tests/unit/guardrail/hitl-manager.test.ts`（4 键控测试）+ `tests/integration/webui-api.test.ts`（409 归属）+ `tests/integration/main-loop.test.ts`（共享 HITL 集成） |

### B7. #7 scope-fence symlink 逃逸

```bash
# 准备：会话根内建 junction 指向工作区外（mklink /J 无需管理员）
cmd //c "mklink /J .\test-verify\esc C:\Windows"
```

| | |
|---|---|
| 操作 | 会话任务：`读取 test-verify\esc\win.ini 的内容`（词法上在根内：`root\test-verify\esc\win.ini`） |
| 预期 | 该读取**触发 HITL 批准**（"Read outside workspace"）——围栏在 canonical 层识破 symlink 逃逸；批准后 agent 才读到内容。**不会**静默直读 |
| 失败定位 | `tests/unit/guardrail/scope-fence.test.ts`（junction 逃逸拦截 ×2 + ELOOP fail-closed） |

### B8. #1 CLI 暂停恢复指引

```bash
# 准备：临时把项目级配置 maxRounds 调小（测试后还原）
echo '{"agent":{"maxRounds":2}}' > ./.codeharness.json
node dist/cli/index.js config show | grep -A 2 '"agent"'   # 确认 maxRounds=2
# 终端 B 直跑一个需要多轮的任务：
node dist/cli/index.js start "读取 test-verify/u16.txt 并用 write_file 复制到 test-verify/copy.txt"
```

| | |
|---|---|
| 预期 | 2 轮后会话暂停，终端输出**恢复指引**：「会话已暂停（达到轮次上限升级暂停…）请重新运行任务（提高 maxRounds），或改用 `codeharness start --web`…」 |
| 还原 | `rm ./.codeharness.json`，`config show` 确认 maxRounds 恢复 0 |
| 失败定位 | `tests/unit/cli/start.test.ts`（暂停指引输出断言） |

### B9. #9 WebUI 新功能（终端 tab / Token 明细 / 清空 / 单删）

**① 终端 tab**
| | |
|---|---|
| 操作 | 新建会话，任务：`读取 test-verify/u16.txt，把内容写到 test-verify/copy.txt，然后删除 copy.txt`（多轮、多工具） |
| 预期 | 会话运行期间，左侧切到「终端」tab：实时出现 `[tool] read_file ✓`、`[feedback]`、`[round]`、`[session]` 行，**每行带时间戳**（评审修复后不再空列） |

**② Token 明细**
| | |
|---|---|
| 操作 | 同一会话完成后，看上下文栏「Token 使用」 |
| 预期 | 显示 输入/输出/缓存命中/总计（真实计费数字）+ 上下文估计（两者并存，数值可不同——计费 vs 估算语义） |

**③ 单会话删除**
| | |
|---|---|
| 操作 | Dashboard 会话列表 → 悬停行尾 → 点垃圾桶 |
| 预期 | ① completed/paused 会话：直接删除、列表刷新消失 ② **running 会话：按钮禁用**（悬停提示"运行中会话需先停止再删除"）③ 打开一个被删会话的旧链接 → 显示"会话不存在" |
| 失败定位 | `src/webui/client/src/pages/Dashboard.test.tsx`（删除 + running 禁用 + 失败提示）+ `tests/integration/webui-api.test.ts`（DELETE 端点 4 测试） |

**④ 清空会话（批量）**
| | |
|---|---|
| 操作 | Settings 页 → 「清空所有会话」→ 点「清空会话」→ 按钮变「确认清空？」→ 再点 |
| 预期 | ① 第一次点击**不发请求**（必须两次确认）② 确认后非运行中会话全删，显示「已清空 N 个会话」③ 若有运行中会话：显示「N 个运行中会话已保留」且它们仍在列表 |
| 失败定位 | `src/webui/client/src/pages/Settings.test.tsx`（两步确认 + kept-running 提示） |

---

## C. 快速核对表（验收完打勾）

- [ ] A：自动化回归 4 命令全绿
- [ ] B1：markdown 会话 1 轮完成、无 parse_error
- [ ] B2：UTF-16 读出中文；GBK 明确失败 + 兜底成功
- [ ] B3：run_test 返回 passed:true + 逐文件结果
- [ ] B4：空工作区 run_test 立即失败、无 npx 下载；裸 `npx tsc` 不装废弃包
- [ ] B5：agent 首轮用 `od`、不碰 `xxd`
- [ ] B6：双会话各自 pending 卡片、批准互不影响
- [ ] B7：symlink 逃逸读取触发批准而非直读
- [ ] B8：CLI 升级暂停输出恢复指引
- [ ] B9：终端带时间戳、Token 四项明细、单删（running 禁用）、清空两步确认

## 失败报告格式

```
修复项：B3（#9.6）
操作：……
实际：……
预期：……
会话 ID：xxx（WebUI 会话列表可复制）
截图/输出粘贴：……
```

自动化测试已覆盖的路径（A 节命令）若红，先把失败测试名附上——这是第一手定位线索。
