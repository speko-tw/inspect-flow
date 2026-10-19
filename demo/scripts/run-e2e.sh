#!/usr/bin/env bash
# 啟動臨時示範環境，以真瀏覽器走查並自動清理服務。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
DEMO_WORK_DIR="${DEMO_WORK_DIR:-${TMPDIR:-/private/tmp}/inspectflow-demo-e2e}"
BACKEND_PORT="${BACKEND_PORT:-18310}"
FRONTEND_PORT="${FRONTEND_PORT:-18311}"
export DEMO_WORK_DIR BACKEND_PORT FRONTEND_PORT
export DEMO_BASE_URL="http://localhost:$FRONTEND_PORT"

cleanup() {
  "$HERE/scripts/stop.sh" || true
}
trap cleanup EXIT
npm ci --prefix "$HERE" --offline
"$HERE/scripts/start.sh"
npm run --prefix "$HERE" test:e2e
