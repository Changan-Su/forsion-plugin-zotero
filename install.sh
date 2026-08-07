#!/usr/bin/env bash
# 装/更新「文献工作台」插件到 Forsion 家目录。
#   用法:sh install.sh [dev|prod]     缺省 dev(~/.forsion-dev);prod=~/.forsion
# 本仓即插件本体(纯 UI 插件,无内嵌 agent/技能/Space):整目录拷到 <home>/plugins/zotero/ 即完成,
#   桌面识别 manifest.json(UI 插件)。重开 Forsion 后在 设置 → Forsion → 社区插件 里启用。
set -euo pipefail
MODE="${1:-dev}"
case "$MODE" in
  dev)  HOME_DIR="$HOME/.forsion-dev" ;;
  prod) HOME_DIR="$HOME/.forsion" ;;
  *) echo "用法:sh install.sh [dev|prod]" >&2; exit 2 ;;
esac
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME_DIR/plugins/zotero"

# 不许从已安装目录内自更新:下面的 rm -rf 会先删掉复制源(自己),把插件卸成空壳
if [ "$HERE" = "$(cd "$DEST" 2>/dev/null && pwd || true)" ]; then
  echo "❌ 正在从已安装目录运行,请从源码仓的 forsion-plugin-zotero/ 目录执行 install.sh" >&2
  exit 2
fi

mkdir -p "$HOME_DIR/plugins"
rm -rf "$DEST"
cp -R "$HERE" "$DEST"

echo "✅ 已安装插件 → $DEST"
echo "重开 Forsion(dev:重启 desktop)后:命令面板「文献工作台:打开」。"
echo "使用前先开 Zotero 7 → 设置 → 高级 → 勾选「允许本机其他应用与 Zotero 通信」。"
