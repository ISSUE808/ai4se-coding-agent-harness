# CodeHarness 分发镜像（PLAN Task 21，SPEC §8.4）
# 构建前需先在宿主机执行 `npm run build`（CI 中 docker-build job 会先 build）——
# 镜像只 COPY 编译产物 dist/，不携带 src/ 与构建工具链。

FROM node:20-alpine

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

# 编译产物（宿主机 `npm run build` 产出，见 .dockerignore：dist 不排除）
COPY dist/ ./dist/

# WebUI 服务端口（`codeharness start --web`）
EXPOSE 3000

# 用户手册式启动：`docker run --rm codeharness --version` / `--help`
ENTRYPOINT ["node", "dist/cli/index.js"]
