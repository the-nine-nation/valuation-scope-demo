#!/bin/zsh
# 双击此文件即可启动本地的「估值刻度」页面。

set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js。请先安装 Node.js 22 或更高版本后再试。"
  read -k 1 "?按任意键退出..."
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "正在安装首次运行所需组件..."
  npm install
fi

echo "正在启动估值刻度，浏览器将自动打开页面。"
echo "关闭此窗口即可停止本地服务。"
exec npm run dev -- --open
