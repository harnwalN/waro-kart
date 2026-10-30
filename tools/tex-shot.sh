#!/bin/sh
# Usage: tools/tex-shot.sh <page-with-query> <out.png> [W,H]
# e.g. tools/tex-shot.sh "tex-preview.html?part=agv" /tmp/agv.png 1600,1000
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --allow-file-access-from-files --hide-scrollbars --virtual-time-budget=1500 \
  --screenshot="$2" --window-size="${3:-1400,1800}" "file:///Users/nharnwal/agv-rally/tools/$1" >/dev/null 2>&1
