# REFLECTION — AI4SE Final Project（A 类：Coding Agent Harness）

## 一、项目概览

这个项目里，我从零构建了一个 Coding Agent Harness——CodeHarness。核心命题：**Agent = LLM + Harness**——治理、反馈、工具、记忆全部由代码实现，而非提示词堆砌。项目按 `docs/PLAN.md` 拆成 22 个 task（实际拆解后 30+），跨 14 个开发阶段，650 个测试全绿；WebUI 部署到阿里云，桌面应用打包验收，CI 覆盖 GitHub Actions 与 GitLab 双平台。

项目从零开始，无遗留代码——`CLAUDE.md` 工作纪律、`docs/PLAN.md` 计划、`docs/SPEC.md` 规约先行，实现与文档同步演进，22 个 task 全部走完。

选这个题目，是想亲手回答：agent 是"会写代码的程序"，还是一个软件系统？写 prompt 调 agent 谁都会，但把 agent 当系统设计时——什么样的反馈能让它自我修正、什么样的护栏挡得住危险操作、什么样的状态值得持久化——只有亲手实现一遍才能真懂。

## 二、关键技术决策

**凭据链三后端**（keytar → 加密文件 → 环境变量）按可用性探测降级：keytar 桌面可用、Docker alpine 静默缺失，降级链成了必需品——线上容器无交互终端，主密码提示 EOF 死锁，最终用 `config.llm.masterPassword` 预置（方案 B）解决。§A.4-C 判据：核心机制须能用 MockProvider 确定性单测、不依赖真实 LLM，凭据层同理。

**反馈闭环 5 层管线**（动作分类 → 校验器选择 → 校验链 → 失败归类 → 修正策略）是主力维度：LLM 生成代码必然出错，harness 的价值在于错误分类得准（语法/类型/运行时/断言），修正策略才选得对（auto_fix / targeted_fix / 人工介入），再配合轮次升级。

**三层护栏**（PatternGuard / ScopeFence / HITL）：demo 里 MockProvider 提议 `rm -rf /`，命令在到达执行器前被拦下——代码层的硬约束，不是提示词告诫。

**配置三层覆盖**（用户 → 项目 → CLI，泛化 deepMerge）：容器挂载、桌面 userData、CLI 参数全走同一套合并逻辑，线上 masterPassword 预置也靠它落进配置。

## 三、开发过程与纪律执行

CLAUDE.md 强制每个 task 的流程：worktree 模块化（14 阶段独立 worktree + PR）→ subagent 执行 TDD 红→绿→重构 → 两阶段评审（spec 合规 + 代码质量）→ AGENT_LOG 记录 → 模块收尾 merge。

真实执行远比计划颠簸：subagent 把 commit 落在 master（派发没指定 worktree）、评审抓到容器命令带多余前缀、CI 断言弱到"绿得心安理得"、npm 包名被无关第三方占用。但纪律的价值正在这些时刻：**每个"必挂"的坑都在评审或测试环节被拦下，而不是上线后由用户报告**。README 的新机可复制性审计（补 `npm install`、前端产物、容器主密码预置这些"照做必死"的步骤）就是评审文化沉淀下来的习惯。AGENT_LOG 逐条记录了每个 task 的触发技能、subagent、人工干预与教训，事后复盘全靠它。

## 四、踩坑

**cwd 漂移（桌面版）**：portable 每次自解压到新 `%TEMP%`，后端 cwd 漂移，基于 cwd 的配置写进临时目录，重启即失。用户报告"重启后 baseUrl 空、key 还在"——keytar 是系统级存储不受影响，恰好暴露了凭据与配置的存储分层。修复：spawn 稳定 cwd 到 userData（`app.isPackaged` 门控，不破坏 dev 语义）。教训：验收先核对产物时间戳——第一轮"验收"验的是旧 portable，修复代码从未被测到。

**容器凭据死锁**：线上容器 Restarting，日志停在 `Master password for encrypted key storage:`。keytar 动态 import 失败 → 链上只剩加密文件 → 无 TTY 交互 EOF → 崩溃。最初想用 env 后端绕过，但它是只读的，UI 写 key 会坏——"配置层能用"不等于"功能完整"。最终方案 B：`llm.masterPassword` 预置，非交互激活。

**"删除供应商刷新复活"**：删除 nju 后刷新又出现。根因：GET 枚举的是凭据存储 ∪ 配置 registry 两个来源，DELETE 只清了前者。修复：DELETE 同步清理 registry 并持久化、活跃供应商回退默认。教训：删除必须清理"枚举来源"本身，且持久化与状态变更同事务——否则"删了"只是 UI 假象。

**subagent 提交落错分支**：派发没指定 worktree，commit 落在 master，纠正成本（cherry-pick + reset + 手动命令）远高于派发时多写一句。

## 五、与课程方法论的对照

§4.6 的 agent 工程纪律（TDD / 两阶段评审 / AGENT_LOG）执行一整轮后的体感：

- **评审最有价值**：抓到的几乎全是"文档承诺了能力、代码没兑现"——容器命令解析错乱、`start --web` 报 unknown option、弱断言 CI 永远发现不了命令行错误。评审员是另一双眼睛，专找"我以为对"的东西。
- **TDD 的"红"最难写**：配置类、文档类 task 很难写出有意义的失败测试——"README 命令可复制"用什么红色测试表达？我用构建验证和命令实测替代，是对纪律的务实取舍。
- **治理为什么要代码化**：prompt 里的"你要小心"是软约束，PatternGuard 的 block 是硬约束；prompt 里的"先写测试"是建议，TDD 的红色门禁是纪律。把后者从提示词搬进代码，才是 harness 区别于"会写代码的对话框"的地方。
- **AGENT_LOG 的复利**：逐条记录教训在当下是"额外成本"，但学期末回看，正是这些细节——cwd 漂移的时间戳教训、容器死锁的交互点清单——让这份反思能写具体、写真实。没有它，我大概率只记得"项目做完了"，说不出为什么做成了。

## 六、收获与展望

从"用 agent 写代码"到"实现一个 agent"。650 个测试、30+ task 走下来，最深的体感：**agent 系统的调试对象不是代码，而是状态流**——cwd 漂移、registry 复活、容器死锁，全是"状态写到了错误的地方"。

已知限制：WebUI 无用户隔离（单实例共享凭据）、容器内主密码明文存服务器、npm 发布待办（包名被占用）、未做真实模型端到端验证。若继续：多用户认证、容器内真正的系统凭据方案、真实模型评测集——方向已经清楚，剩下的主要是工程投入。

回看整个项目，最值钱的不只是 650 个测试和一个能跑的 Harness，而是把"想当然"变成"可验证"的习惯——先写失败测试再写实现，先定评审标准再声称完成。这个习惯会带到下一个项目去。
