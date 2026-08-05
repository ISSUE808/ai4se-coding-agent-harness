# CodeHarness

从零构建的 AI 编码智能体运行框架（Coding Agent Harness）。核心命题：**Agent = LLM + Harness**——治理、反馈、工具、记忆全部由代码而非提示词实现。

## 安装

```bash
npm run build
npm link          # 全局 codeharness 命令（任意目录可用）
```

### 桌面应用（可选）

```bash
cd desktop && npm install && npm run dist
# 产物：desktop/build/CodeHarness*.exe（portable 免安装 / NSIS 安装程序）
```

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

## 安全边界

- 工作区外操作需 HITL 人工确认（symlink 逃逸在 canonical 层拦截）
- 凭据不入代码/Git/日志/历史

## 已知限制

已知问题与改进清单见 [KNOWN_ISSUES.md](KNOWN_ISSUES.md)——含 CLI `--cwd` 可选增强未实现、目录选择器整机浏览端点（安全取舍，仅元数据不返回内容）等，按优先级维护。
