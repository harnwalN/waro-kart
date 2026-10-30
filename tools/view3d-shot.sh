#!/bin/sh
# Usage: tools/view3d-shot.sh <name> "<query>"  -> scratchpad/view3d-<name>.png
OUT="${SHOT_DIR:-/private/tmp/claude-501/-Users-nharnwal/3e7be929-73b5-40c1-a1d2-a0518b2c8ff3/scratchpad}/view3d-$1.png"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --allow-file-access-from-files --hide-scrollbars --enable-logging=stderr --v=0 --virtual-time-budget=3000 \
  --screenshot="$OUT" --window-size=960,600 "file:///Users/nharnwal/agv-rally/tools/view3d-preview.html?$2" 2>&1 \
  | grep -iE "uncaught|error:|view3d" | grep -v -iE "gpu|dbus|sandbox|crashpad|gcm|registration|display_link|task_policy" | head -20
echo "$OUT"
