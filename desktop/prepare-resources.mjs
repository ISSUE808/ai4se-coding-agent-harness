// 打包前组装：把构建后的后端三件套复制到 desktop/backend-pack/
// （dist/ + node_modules/ + client 产物 webui/）——electron-builder
// 的 extraResources 会把 backend-pack → resources/backend。
// keytar 原生模块必须走 resources（不进 asar），此布局天然满足。
// CR Important-2（2026-08-05）：复制后 npm prune --omit=dev 剪掉 devDependencies
// （typescript/vitest 等 26MB 不进用户分发包）——npm prune 需要 package.json
// 与 lockfile，复制根配置；根依赖的 prod 部分（express/keytar/openai/ws）保留。
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packDir = resolve(dirname(fileURLToPath(import.meta.url)), 'backend-pack');
const webuiDir = resolve(root, 'src', 'webui', 'client', 'dist');

for (const p of [resolve(root, 'dist'), resolve(root, 'node_modules'), webuiDir]) {
  if (!existsSync(p)) {
    console.error(`缺失：${p}——请先 npm run build 与 cd src/webui/client && npm run build`);
    process.exit(1);
  }
}
rmSync(packDir, { recursive: true, force: true });
mkdirSync(packDir, { recursive: true });
cpSync(resolve(root, 'dist'), resolve(packDir, 'dist'), { recursive: true });
cpSync(resolve(root, 'node_modules'), resolve(packDir, 'node_modules'), { recursive: true });
cpSync(webuiDir, resolve(packDir, 'webui'), { recursive: true });
// npm prune 需要 package.json（复制根的声明，含 dependencies/devDependencies）
cpSync(resolve(root, 'package.json'), resolve(packDir, 'package.json'));
cpSync(resolve(root, 'package-lock.json'), resolve(packDir, 'package-lock.json'));
console.log('剪除 devDependencies（npm prune --omit=dev）…');
execSync('npm prune --omit=dev', { cwd: packDir, stdio: 'inherit' });
console.log(`backend-pack 就绪：${packDir}`);
