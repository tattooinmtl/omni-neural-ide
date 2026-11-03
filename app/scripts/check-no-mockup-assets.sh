#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0
# Forbidden path patterns in source + built bundle
PATTERNS=(
  'mock-plain'
  'mock-ultra'
  'mockup-cover'
  '/chrome/plain_'
  '/chrome/ultra_'
  'chrome/mock'
  'plain_title.png'
  'ultra_title.png'
  'plain_activity.png'
  'ultra_activity.png'
  'plain_status.png'
  'ultra_status.png'
  'plain_sidebar.png'
  'ultra_sidebar.png'
  'plain_editor.png'
  'ultra_editor.png'
  'plain_chat.png'
  'ultra_chat.png'
  'plain_menu.png'
  'plain_logo_mark'
  'omni-spec/omni-code'
)
SEARCH_DIRS=("$ROOT/ui/src" "$ROOT/ui/index.html" "$ROOT/ui/dist")
for pat in "${PATTERNS[@]}"; do
  if grep -R --include='*.{ts,tsx,js,css,html,svg,json}' -n -F "$pat" "$ROOT/ui/src" "$ROOT/ui/index.html" 2>/dev/null; then
    echo "FAIL: source references banned mockup asset pattern: $pat"
    FAIL=1
  fi
  if [ -d "$ROOT/ui/dist" ]; then
    if grep -R -n -F "$pat" "$ROOT/ui/dist" 2>/dev/null | head -5; then
      echo "FAIL: dist bundle references banned mockup asset pattern: $pat"
      FAIL=1
    fi
  fi
done
# Forbidden directories that hold mockup crops
for d in "$ROOT/ui/public/chrome" "$ROOT/ui/dist/chrome"; do
  if [ -d "$d" ]; then
    echo "FAIL: mockup chrome directory exists: $d"
    FAIL=1
  fi
done
# public/icons must not contain act_plain / plain_ft crops from mockups
if [ -d "$ROOT/ui/public/icons" ]; then
  if ls "$ROOT/ui/public/icons"/act_* "$ROOT/ui/public/icons"/plain_ft_* "$ROOT/ui/public/icons"/ultra_ft_* "$ROOT/ui/public/icons"/logo_plain* 2>/dev/null | head -1 | grep -q .; then
    echo "FAIL: mockup-extracted icon crops still in public/icons"
    FAIL=1
  fi
fi
if [ "$FAIL" -ne 0 ]; then
  echo "check-no-mockup-assets: FAILED"
  exit 1
fi
echo "check-no-mockup-assets: OK"
