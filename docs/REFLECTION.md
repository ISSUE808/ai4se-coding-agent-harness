# REFLECTION

> 说明：本文稿由开发智能体辅助起草与润色，作者本人逐段改写、核对事实后定稿（AI 辅助润色，按学术规范声明标注）。

## 哪些 Superpowers 技能发挥了最大作用，哪些"形式大于实质"？

作用最大的无疑是 `requesting-code-review` 的两阶段评审。项目里最重要的一批 bug 全是评审抓的，比如容器命令带 `codeharness` 前缀（ENTRYPOINT 是 exec 形式，尾部参数直接拼接，命令解析错乱报 unknown option）、CI 断言弱到用 `|| true` 兜底（命令行错误永远发现不了）、README 里 `npm install -g codeharness` 的包名已被无关第三方占用（评审用 WebFetch 查证）、桌面后端 spawn 的 cwd 不加门控会改写 dev 语义。`test-driven-development` 和 `using-git-worktrees` 则次之——核心机制全部走红→绿，14 个阶段模块靠 worktree 隔离并行。

"形式大于实质"的是 `brainstorming`：A 类项目设计空间小、SPEC 先行，brainstorming 的产出与最终实现偏离明显，过程记录的意义大于实质指导。TDD 在配置类和文档类 task 上也基本是仪式

## TDD 强制在 AI 协作下是阻碍还是放大器？

对核心机制是放大器。红→绿循环给了 subagent 一个明确的终点：先写失败测试，测试就定义了"完成"；文档要求机制能用 MockProvider 确定性单测、不依赖真实 LLM，这使得凭据链和反馈管线全部可离线验证。

但TDD强制对配置类、文档类任务来说却是阻碍。比如"README 命令可复制"难以用红色测试表达。当写不出有意义的失败测试时，我会使用构建验证和命令实测替代，这算是对纪律的务实取舍。因此，TDD 的适用边界是"有可断言行为"的代码，而不是所有任务。

## subagent 工作流能让智能体自主运行多久而不偏离主题？

单 task 内基本不偏离——派发 prompt 给了涉及文件列表、SPEC 章节引用、完成条件，subagent 只需要执行。偏离全部发生在 prompt 没给全的地方：Task 22 派发时没指定 worktree，subagent 把 commit 落在 master（cherry-pick + reset 才纠回来）；README 容器命令没给 ENTRYPOINT 拼接语义，subagent 写了带前缀的启动命令。

并且subagent 宁可依靠猜测继续工作，也几乎从不执行"不确定时暂停提问"的约定。新鲜 subagent 零会话污染也是把双刃剑，虽然不会想歪，但也没有上下文积累，除了prompt 之外没有任何护栏，所以只能把reviewer 作为最后的防线。

## 什么样的 task 颗粒度最优？

"一个 task 等于一个可验证的完成条件"最优，例如"新增一个凭据后端 + 它的单测"。拆分依据是task间的依赖关系而不是工作量。本次开发中的一个反例是 Task 22：有三条不相关的增量（Docker 用法、npm 全局安装、机制演示）捆绑在一个 task 里，一次派发就带偏一次。

## SPEC/PLAN 质量如何影响实现质量？

影响是直接的，规约每少写一处就是 subagent 一个偏离点。比如SPEC 写了"编辑 provider 端点"，但没写"编辑活跃 provider 时 `llm.baseUrl` 必须同步"，这导致初期实现只更新了配置 registry，运行中的会话用的还是旧端点。这个契约是 reviewer 在代码评审中指出的，补上后编辑活跃 provider 才真正生效。这也让我意识到单人项目里"陌生 subagent 冷启动验证"的重要性，这有利于检验SPEC与PLAN的质量。

## 最有效的 prompt/context 策略是什么、为什么有效？

派发 prompt 的四要素模板：TDD 纪律（先写失败测试）、涉及文件列表、SPEC 章节引用、完成条件。有效的原因很朴素：新鲜 subagent 的唯一上下文就是 prompt，给多少上下文，偏离面就有多小；引用 SPEC 章节而非口头复述，是为了避免我自己的理解污染它。还有一个踩过坑后的补强是"在 `<worktree 路径>` 下操作"，从那以后 subagent 再没落错过分支。

## 凭据与分发这两条工程要求，迫使我想清楚了哪些原本会忽略的问题？

凭据要求（不入代码/Git/日志/历史）逼出了 SecureHandle 闭包设计——`#private` 字段让 `Object.keys`/`JSON.stringify`/`structuredClone` 都拿不到密钥；还逼出了三后端降级链：keytar 在桌面可用、在 alpine 容器静默缺失（无 musl 预编译、无系统 keychain），于是加密文件后端和"动态 import + 可用性探测"成了必需。线上容器无交互终端，主密码提示直接 EOF 死锁，最终用 `config.llm.masterPassword` 预置解决，这些只有在必须上线时才想得到。而密钥只经 /api/keys 链路、config 拒绝明文密钥字段，也是同一原则的延续。

分发要求则逼出了多阶段自包含镜像：最初 Dockerfile 只 COPY tsc 产物，评审实测发现容器内 `--web` 报 client dist 缺失——EXPOSE 3000 成了虚假声明，改成像内完成 tsc + vite 构建后才自包含；还有 `.dockerignore` 的模式锚定（无锚定的 `credentials` 会误杀 `src/credentials/` 源码）、CI 断言的强度（弱断言等于没断言，用 `|| true` 兜底的检查永远发现不了命令行解析错误）。

## 如果重做我会改变什么？

我会让派发模板从第一天就标准化（worktree 路径进模板）；配置/文档类 task 直接用验收清单，不为 TDD 而 TDD；新机可复制性审计提前到文档完成当天（README 缺 `npm install`、缺前端产物、容器缺主密码预置都是收尾阶段才补的）；验收先核对产物时间戳（桌面版第一轮"验收"验的是旧 portable，修复代码从未被测到）。

## 对 Superpowers 方法论的批判——它假设了什么，假设成立吗？

它假设了 agent 的工具环境稳定：本次开发时Claude Code的安全分类器多次不可用，subagent 经常有些操作无法完成，主 agent 只能代劳——这个假设不成立，且没有预案。它假设 subagent 会"不确定时暂停提问"：实际几乎不执行，宁可根据猜测继续——不成立，因此 reviewer 必须存在。它假设 TDD 普适：配置/文档类不适用——成立但不完备。它还假设主 agent 有足够的评审带宽：反馈闭环 4 个 task 并行时评审明显滞后——部分成立。这些假设的共性是"agent 是可靠的执行者"，而真实项目里 agent 是"需要兜底的协作者"，这正是 harness 存在的理由。

---

回看整个项目，最有价值的是把"想当然"变成"可验证"的习惯，先写失败测试再写实现，先定评审标准再声称完成。这个习惯会让开发更加工程化且可控。
