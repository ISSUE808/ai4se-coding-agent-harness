# CodeHarness 分发镜像（PLAN Task 21，SPEC §8.4）
# 多阶段构建（Task 21 CR）：build 阶段在镜像内完成 tsc + WebUI client 构建，
# 自包含、不依赖宿主机预构建；runtime 阶段只带生产依赖与编译产物。
# 基准镜像钉版到具体 tag（node 20 LTS 最终补丁 × alpine 3.22，构建时已验证可拉取）。

# ===== Stage 1: build（镜像内完成全部构建） =====
FROM node:20.19.4-alpine3.22 AS build

WORKDIR /app

# 先 COPY package*.json 以利用层缓存；安装全部依赖（含 devDeps——tsc/vite 需要）。
# --ignore-scripts：keytar 的原生编译需要 python3/make/g++/libsecret-dev 工具链
# （alpine 无 prebuilt，见下方 runtime 注释），且编译期用不到它——keytar-backend
# 是动态 import + try/catch，tsc 不需要其原生绑定。其余 install scripts 在 alpine
# 上为 no-op：esbuild 二进制随 optionalDependencies 平台包提供，fsevents 仅 macOS。
COPY package*.json ./
RUN npm ci --ignore-scripts

# 拷贝全部源码与构建配置（tsconfig.json/vitest.config.ts 等在仓库根，client 自带
# package-lock.json，其 npm ci 在构建阶段使用各自 lockfile，互不影响）。
# .dockerignore 已排除 node_modules/构建产物/文档等，只进源码与配置。
COPY . .

# 根项目 tsc 构建（tsconfig rootDir=src → 产出 dist/）。
RUN npm run build

# WebUI client 构建（vite 产物 → src/webui/client/dist，即 `start --web`
# resolveStaticDir 的默认解析路径，见 src/cli/commands/start.ts）。
RUN cd src/webui/client && npm ci && npm run build

# ===== Stage 2: runtime =====
FROM node:20.19.4-alpine3.22

WORKDIR /app

# 先 COPY package*.json 以利用层缓存；再安装生产依赖。
# --ignore-scripts 的理由（SPEC §3.7/§8.5 风险表「Docker 不走 keytar」）：
#   keytar 是原生模块，无 musl (alpine) prebuilt，源码编译需要 python3/make/g++/
#   libsecret-dev 工具链，且容器内没有系统 keychain/secret service——
#   即使编译成功也无法使用，只会放大镜像。keytar-backend 是动态 import + try/catch
#   （src/credentials/backends/keytar-backend.ts），绑定缺失时 isAvailable() 返回
#   false，凭据自动降级到 encrypted-file 后端（容器内唯一可用后端）。
# 跳过 install scripts 后 keytar 仅以 JS 桩存在，运行期加载失败即优雅降级。
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# 编译产物（Stage 1 产出，不再依赖宿主机 dist/）。
COPY --from=build /app/dist ./dist/
# WebUI client 构建产物（Stage 1 产出；容器内 `start --web` 可用）。
COPY --from=build /app/src/webui/client/dist ./src/webui/client/dist/

# WebUI 服务端口（`codeharness start --web`，容器内现可用）。
EXPOSE 3000

# 用户手册式启动：`docker run --rm codeharness --version` / `--help`
ENTRYPOINT ["node", "dist/cli/index.js"]
