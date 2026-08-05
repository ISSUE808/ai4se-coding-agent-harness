# CodeHarness

从零构建的 AI 编码智能体运行框架（Coding Agent Harness）。核心命题：**Agent = LLM + Harness**——治理、反馈、工具、记忆全部由代码而非提示词实现。

## 安装

```bash
npm run build
npm link          # 全局 codeharness 命令（任意目录可用）
npm install -g codeharness  # 发布后用法（项目尚未 publish，当前以 npm link 为主路径）
```

### 桌面应用（可选）

```bash
cd desktop && npm install && npm run dist
# 产物：desktop/build/CodeHarness*.exe（portable 免安装 / NSIS 安装程序）
```

## 容器化运行

多阶段镜像（Task 21，SPEC §8.4）：build 阶段在镜像内完成 tsc + WebUI client 构建，自包含、不依赖宿主机预构建（命令与 `.github/workflows/ci.yml` docker-build job 实测一致）。

```bash
docker build -t codeharness .
docker run --rm codeharness --version   # 验证版本号
docker run --rm codeharness --help      # 验证 CLI 可用
```

容器内运行 WebUI（端口映射 + 挂载配置/凭据目录）：

```bash
docker run --rm -p 3000:3000 \
  -v "$HOME/.codeharness:/root/.codeharness" \
  codeharness start --web
```

- `-p 3000:3000`：映射 WebUI 端口（Dockerfile `EXPOSE 3000`，浏览器访问 http://localhost:3000）
- `-v "$HOME/.codeharness:/root/.codeharness"`：挂载用户级配置与凭据（容器内用户级配置 `~/.codeharness/config.json`，见 src/cli/options.ts）
- 容器内 keytar 不可用（alpine 无原生绑定、无系统 keychain），凭据自动降级到 encrypted-file 后端（`~/.codeharness/secrets.enc`，与配置同目录，随挂载复用）

## 快速开始

```bash
codeharness key update           # 配置 API 密钥（keytar 安全存储）
codeharness start "任务描述"      # CLI 单次任务
codeharness                       # 交互式 REPL
codeharness start --web           # WebUI（浏览器 http://localhost:3000）
```

## WebUI 说明

- 开发模式：`node dist/cli/index.js start --web`（后端 :3000）+ `cd src/webui/client && npm run dev`（Vite :5173，代理 /api 与 /ws）
- 生产模式：`codeharness start --web` 单命令（server 服务构建后的前端）
- 密钥只经 `/api/keys` 链路，config 拒绝明文密钥字段

## 目录结构

```
src/
  cli/          # CLI 入口（commander）：start / key / config 命令 + 交互式 REPL
  core/         # Agent 主循环 + 停机判断
  tools/        # 7 个工具（文件读写、内容搜索、编辑、shell、测试）
  feedback/     # 反馈闭环（主力维度）：5 层管线——动作分类 → 校验器选择 → 校验链 → 失败归类 → 修正策略
  guardrail/    # 三层治理护栏：危险命令模式（PatternGuard）、作用域围栏（ScopeFence）、HITL 人工确认
  memory/       # 3 层记忆（会话 / 项目 / 用户）+ 上下文压缩
  credentials/  # 凭据存储：keytar / 加密文件 / 环境变量三后端链 + SecureHandle
  webui/        # Express + WebSocket 服务器 + React SPA 客户端
  config/       # 三层配置覆盖加载（用户级 → 项目级 → CLI 参数）
  utils/        # 通用工具（环境前提检查、平台差异指引）
```

## 机制演示

`tests/demo/` 三项确定性演示（Task 20，SPEC §A.6）——全部基于 MockProvider 与 mock 校验器，零外部调用（无真实 LLM / HTTP / shell 子进程），可离线复现核心机制：

1. **护栏拦截**（guardrail-demo.test.ts）：MockProvider 提议执行 `rm -rf /` → PatternGuard 判定 block → 命令绝不到达执行器 → agent 收到拦截通知
2. **反馈闭环自我修正**（feedback-demo.test.ts）：连续 3 轮修复——类型错误（targeted_fix）→ 语法错误（auto_fix）→ 通过完成
3. **主力维度确定性行为**（deep-dimension-demo.test.ts）：动作分类 → 校验器选择 → 校验链（fail_fast / collect_all）→ 失败归类 → 策略匹配 → 轮次升级全链路

```bash
npx vitest run tests/demo   # 仅运行三项机制演示
npm test                    # 全量测试（含演示）
```

## 安全边界

- 工作区外操作需 HITL 人工确认（symlink 逃逸在 canonical 层拦截）
- 凭据不入代码/Git/日志/历史

## 已知限制

已知问题与改进清单见 [KNOWN_ISSUES.md](KNOWN_ISSUES.md)——含 CLI `--cwd` 可选增强未实现、目录选择器整机浏览端点（安全取舍，仅元数据不返回内容）等，按优先级维护。
