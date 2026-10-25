#!/usr/bin/env bash
# Code-OSS（microsoft/vscode, MIT）の Web 版をソースから作り、IDE の静的ファイルを dist/ にまとめる。
#   使い方: VSCODE_VERSION=1.142.0 ide/build.sh [出力先]
# 必要なもの: git, Node（vscode の .nvmrc の版）, python3, make, g++, libx11-dev libxkbfile-dev libsecret-1-dev libkrb5-dev
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
VERSION=${VSCODE_VERSION:-$(cat "$HERE/VSCODE_VERSION")}
OUT=$(realpath -m "${1:-$HERE/dist}")
WORK=${WORK:-$(mktemp -d)}

if [ ! -d "$WORK/vscode" ]; then
  git clone --depth 1 -b "$VERSION" https://github.com/microsoft/vscode.git "$WORK/vscode"
fi
cd "$WORK/vscode"
export ELECTRON_SKIP_BINARY_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 NODE_OPTIONS=--max-old-space-size=8192
npm ci
npm run gulp vscode-web-min

rm -rf "$OUT" && mkdir -p "$OUT/extensions"
cp -r "$WORK/vscode-web/." "$OUT/"
cp "$HERE/index.html" "$OUT/index.html"
cp -r "$HERE/extension" "$OUT/extensions/pf-repo"
echo "$VERSION" > "$OUT/VSCODE_VERSION"
echo "built Code-OSS $VERSION web into $OUT"
