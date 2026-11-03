#!/usr/bin/env bash
# 範本建議（TPL-AC33～AC43）真後端整合驗收：臨時資料庫、真 HTTP、
# 真瀏覽器。用法：
#   demo/scripts/suggestion-acceptance.sh sqlite
#   INSPECTFLOW_ACCEPTANCE_POSTGRES_URL=postgresql+psycopg://... \
#     demo/scripts/suggestion-acceptance.sh postgres
# 截圖與 log 一律放 EVIDENCE_DIR（repo 外），不提交。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
BACKEND="${1:-sqlite}"
DEFAULT_WORK="${TMPDIR:-/private/tmp}/inspectflow-suggest-$BACKEND"
DEMO_WORK_DIR="${DEMO_WORK_DIR:-$DEFAULT_WORK}"
BACKEND_PORT="${BACKEND_PORT:-18320}"
FRONTEND_PORT="${FRONTEND_PORT:-18321}"
EVIDENCE_DIR="${EVIDENCE_DIR:-$DEMO_WORK_DIR/evidence}"
SKIP_BROWSER="${SKIP_BROWSER:-0}"
export DEMO_WORK_DIR BACKEND_PORT FRONTEND_PORT EVIDENCE_DIR
export DEMO_BASE_URL="http://localhost:$FRONTEND_PORT"

die() { echo "suggestion acceptance: $*" >&2; exit 1; }

[ -x "$REPO/backend/.venv/bin/python" ] || die "先在 $REPO 執行 make setup"
[ -d "$REPO/frontend/node_modules" ] || die "先在 $REPO 執行 make setup"

case "$BACKEND" in
  sqlite)
    mkdir -p "$DEMO_WORK_DIR"
    DB_FILE="$DEMO_WORK_DIR/demo.db"
    rm -f "$DB_FILE" "$DB_FILE-shm" "$DB_FILE-wal"
    DB_URL="sqlite:///$DB_FILE"
    ;;
  postgres)
    DB_URL="${INSPECTFLOW_ACCEPTANCE_POSTGRES_URL:-}"
    [ -n "$DB_URL" ] || die "postgres 模式需要 INSPECTFLOW_ACCEPTANCE_POSTGRES_URL"
    # 為什麼：下面會清空 public schema；只允許名稱明示為測試的資料庫，
    # 避免誤指到開發或正式資料。
    DB_NAME="${DB_URL##*/}"
    DB_NAME="${DB_NAME%%\?*}"
    case "$DB_NAME" in
      *test*|*e2e*) ;;
      *) die "拒絕清空非測試資料庫：$DB_NAME" ;;
    esac
    ;;
  *) die "第一個參數必須是 sqlite 或 postgres" ;;
esac

mkdir -p "$DEMO_WORK_DIR" "$EVIDENCE_DIR"
rm -f "$DEMO_WORK_DIR"/{backend,frontend,init,migrate}.log
rm -f "$DEMO_WORK_DIR"/{backend,frontend}.pid "$DEMO_WORK_DIR"/*.json

cleanup() {
  "$HERE/stop.sh" >/dev/null 2>&1 || true
}
trap cleanup EXIT
"$HERE/stop.sh" >/dev/null 2>&1 || true
for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    die "連接埠 $port 已被使用；不會停止其他程序"
  fi
done

if [ "$BACKEND" = postgres ]; then
  (cd "$REPO/backend" && \
    INSPECTFLOW_TEST_POSTGRES_URL="$DB_URL" \
    .venv/bin/python -m tests.db.reset_postgres_schema)
fi
export INSPECTFLOW_DATABASE_URL="$DB_URL"

make -C "$REPO" migrate >"$DEMO_WORK_DIR/migrate.log" 2>&1 \
  || { cat "$DEMO_WORK_DIR/migrate.log"; die "migration 失敗"; }
make -C "$REPO" init >"$DEMO_WORK_DIR/init.log" 2>&1 \
  || { cat "$DEMO_WORK_DIR/init.log"; die "初始化失敗"; }
CODE="$(sed -n 's/^First-login code: //p' \
  "$DEMO_WORK_DIR/init.log" | head -1)"
[ -n "$CODE" ] || die "初始化輸出沒有首次登入碼"

(cd "$REPO/backend"; nohup .venv/bin/python -m uvicorn \
  app.main:app --host 127.0.0.1 --port "$BACKEND_PORT" \
  >"$DEMO_WORK_DIR/backend.log" 2>&1 &
  echo $! >"$DEMO_WORK_DIR/backend.pid")
for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$BACKEND_PORT/api/v1/version" \
    >/dev/null 2>&1 && break
  kill -0 "$(cat "$DEMO_WORK_DIR/backend.pid")" 2>/dev/null \
    || { tail -20 "$DEMO_WORK_DIR/backend.log"; die "後端已停止"; }
  sleep 0.5
done
curl -fsS "http://127.0.0.1:$BACKEND_PORT/api/v1/version" >/dev/null \
  || die "後端啟動逾時"

export VITE_BACKEND_URL="http://127.0.0.1:$BACKEND_PORT"
(cd "$REPO/frontend"; nohup node_modules/.bin/vite \
  --host 127.0.0.1 --port "$FRONTEND_PORT" --strictPort \
  >"$DEMO_WORK_DIR/frontend.log" 2>&1 &
  echo $! >"$DEMO_WORK_DIR/frontend.pid")
for _ in $(seq 1 60); do
  curl -fsS "http://localhost:$FRONTEND_PORT/" >/dev/null 2>&1 && break
  kill -0 "$(cat "$DEMO_WORK_DIR/frontend.pid")" 2>/dev/null \
    || { tail -20 "$DEMO_WORK_DIR/frontend.log"; die "前端已停止"; }
  sleep 0.5
done
curl -fsS "http://localhost:$FRONTEND_PORT/" >/dev/null \
  || die "前端啟動逾時"

PY="$REPO/backend/.venv/bin/python"
BASE="http://127.0.0.1:$BACKEND_PORT"
"$PY" "$HERE/seed.py" --base "$BASE" --code="$CODE" \
  --out "$DEMO_WORK_DIR/seed-result.json" >"$DEMO_WORK_DIR/seed.log"

echo "== API 整合驗收（${BACKEND}）"
"$PY" "$HERE/suggestion_integration.py" --base "$BASE" \
  --seed-result "$DEMO_WORK_DIR/seed-result.json" \
  --out "$EVIDENCE_DIR/api-$BACKEND.json"

if [ "$SKIP_BROWSER" != 1 ]; then
  echo "== 瀏覽器走查（${BACKEND}）"
  "$PY" "$HERE/suggestion_integration.py" --base "$BASE" \
    --seed-result "$DEMO_WORK_DIR/seed-result.json" --world-only \
    --tag ui --out "$DEMO_WORK_DIR/ui-world.json"
  UI_WORLD="$DEMO_WORK_DIR/ui-world.json" \
  ACCEPT_BACKEND="$BACKEND" \
    node "$HERE/../e2e/template-suggestion-acceptance.mjs"
fi
echo "suggestion acceptance (${BACKEND}): PASS"
