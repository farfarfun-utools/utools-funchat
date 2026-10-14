#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT_DIR"
# 一律用相对路径喂给 node：CI 的 Windows 作业跑在 Git Bash 里，$ROOT_DIR 是 /d/a/... 这种
# MSYS 路径，Windows 版 node 解析不了；而 node 继承的工作目录本来就是这里。
PLUGIN_DIR=utools

command -v node >/dev/null || { echo "error: Node.js is required" >&2; exit 1; }
command -v pnpm >/dev/null || { echo "error: pnpm is required, run: corepack enable" >&2; exit 1; }

# 版本只卡下限，不卡死某一个版本：本机已有的新 pnpm 可以直接用，不必为本项目再装一个。
# 但低于 12 必须拦住——lockfile 用的是 pnpm 12 的多文档格式，旧版本读不了；
# pnpm-workspace.yaml 里的 allowBuilds 也是 12 才认的键名，旧版本会静默跳过 esbuild 的构建。
PNPM_VERSION=$(pnpm --version)
PNPM_MAJOR=${PNPM_VERSION%%.*}
if ! [ "$PNPM_MAJOR" -ge 12 ] 2>/dev/null; then
  echo "error: pnpm >= 12 is required, found $PNPM_VERSION" >&2
  echo "       run: corepack enable  (then pnpm follows package.json#packageManager)" >&2
  exit 1
fi

pnpm install --frozen-lockfile
pnpm test
# 类型检查已经清零，纳入构建流程防止回归
pnpm typecheck
# eslint 的 error 也已清零，同样纳入。--quiet 只看 error：剩下的一千多条 warning 全是
# .vue 的排版类（每行几个属性、单标签怎么闭合），封个数字没人会去维护。
pnpm lint:check
node --check "$PLUGIN_DIR/preload.js"
# 版本号在 package.json 和 plugin.json 里各写一份：前者给工具链，后者是 uTools 判断「有没有
# 新版」的唯一依据。漂移了不会有任何报错，只会表现成「发版了但用户收不到更新」，所以在这里卡住。
node -e "
  const fs = require('fs');
  const plugin = JSON.parse(fs.readFileSync('$PLUGIN_DIR/plugin.json', 'utf8'));
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  if (plugin.version !== pkg.version) {
    console.error('error: version mismatch, package.json=' + pkg.version + ' plugin.json=' + plugin.version);
    process.exit(1);
  }
"
rm -rf -- "$PLUGIN_DIR/dist"
pnpm build
test -f "$PLUGIN_DIR/dist/index.html"
test -f "$PLUGIN_DIR/preload.js"
test -f "$PLUGIN_DIR/logo.png"
test ! -e "$PLUGIN_DIR/.git"
echo "uTools plugin ready: $PLUGIN_DIR/plugin.json"
