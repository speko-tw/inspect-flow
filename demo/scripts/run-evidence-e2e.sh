#!/usr/bin/env bash
# 每次重建自己的示範資料，照片、截圖與 log 全部留在 repo 外。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
export DEMO_WORK_DIR="${DEMO_WORK_DIR:-/private/tmp/inspectflow-evidence-demo}"
export EVIDENCE_DIR="${EVIDENCE_DIR:-$DEMO_WORK_DIR/screenshots}"
export BACKEND_PORT="${BACKEND_PORT:-18410}"
export FRONTEND_PORT="${FRONTEND_PORT:-18411}"
export DEMO_BASE_URL="http://localhost:$FRONTEND_PORT"
export EVIDENCE_FIXTURE="$EVIDENCE_DIR/demo.jpg"
mkdir -p "$EVIDENCE_DIR"
trap '"$HERE/scripts/stop.sh"' EXIT
"$HERE/scripts/start.sh" >"$EVIDENCE_DIR/start.log" 2>&1
"$REPO/backend/.venv/bin/python" "$HERE/scripts/evidence_photos.py" \
  "$EVIDENCE_FIXTURE"
node "$HERE/e2e/evidence-acceptance.mjs"
