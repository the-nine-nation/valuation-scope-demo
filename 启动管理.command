#!/bin/zsh
# 双击启动本地管理页（仅 127.0.0.1:5567，不部署）

set -e
cd "$(dirname "$0")"

PORT=5567
URL="http://127.0.0.1:${PORT}/admin"

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js。请先安装 Node.js 22 或更高版本后再试。"
  read -k 1 "?按任意键退出..."
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "正在安装首次运行所需组件..."
  npm install
fi

echo "确保端口 ${PORT} 可用..."
node tools/scripts/ensure-port.mjs "${PORT}"

echo "正在启动本地管理页 → ${URL}"
echo "关闭此窗口即可停止。"

(
  for _ in {1..40}; do
    if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
      open "${URL}"
      exit 0
    fi
    sleep 0.25
  done
) &

exec npm run admin
