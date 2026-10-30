#!/bin/sh
# Usage: tools/gfx-shot.sh <query> <out.png> [WxH]
Q="$1"; OUT="$2"; SIZE="${3:-1400,1800}"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --allow-file-access-from-files --enable-logging=stderr --v=0 --virtual-time-budget=3000 \
  --screenshot="$OUT" --window-size="$SIZE" "file:///Users/nharnwal/agv-rally/tools/gfx-preview.html?$Q" 2>&1 \
  | grep -iE "uncaught|error:" | grep -v -iE "gpu|dbus|sandbox|crashpad|gcm|registration|display_link|task_policy" | head -20
