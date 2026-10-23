#!/usr/bin/env bash
# 啟動使用臨時 SQLite 的示範環境。
# 可以覆寫工作目錄與連接埠。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="${REPO:-$(cd "$HERE/../.." && pwd)}"
DEMO_WORK_DIR="${DEMO_WORK_DIR:-${TMPDIR:-/private/tmp}/inspectflow-demo}"
BACKEND_PORT="${BACKEND_PORT:-8300}"
FRONTEND_PORT="${FRONTEND_PORT:-5300}"
DB_FILE="$DEMO_WORK_DIR/demo.db"
DB_URL="sqlite:///$DB_FILE"
HTTPS=0
if [ "${1:-}" = "--https" ]; then HTTPS=1; fi

die() { echo "demo start: $*" >&2; exit 1; }

[ -x "$REPO/backend/.venv/bin/python" ] || die "先在 $REPO 執行 make setup"
[ -d "$REPO/frontend/node_modules" ] || die "先在 $REPO 執行 make setup"
case "$DB_FILE" in
  *"$REPO/backend/data"*|*inspectflow.db*) die "拒絕使用開發資料庫" ;;
esac

DEMO_WORK_DIR="$DEMO_WORK_DIR" \
BACKEND_PORT="$BACKEND_PORT" \
FRONTEND_PORT="$FRONTEND_PORT" \
  "$HERE/stop.sh" >/dev/null 2>&1 || true
for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    die "連接埠 $port 已被使用；不會停止其他程序"
  fi
done

mkdir -p "$DEMO_WORK_DIR"
rm -f "$DB_FILE" "$DB_FILE-shm" "$DB_FILE-wal"
rm -f "$DEMO_WORK_DIR/backend.log" "$DEMO_WORK_DIR/frontend.log"
rm -f "$DEMO_WORK_DIR/init.log" "$DEMO_WORK_DIR/migrate.log"
rm -f "$DEMO_WORK_DIR/backend.pid" "$DEMO_WORK_DIR/frontend.pid"
rm -f "$DEMO_WORK_DIR/seed-result.json"
export INSPECTFLOW_DATABASE_URL="$DB_URL"

make -C "$REPO" migrate >"$DEMO_WORK_DIR/migrate.log" 2>&1 \
  || { cat "$DEMO_WORK_DIR/migrate.log"; die "migration 失敗"; }
make -C "$REPO" init >"$DEMO_WORK_DIR/init.log" 2>&1 \
  || { cat "$DEMO_WORK_DIR/init.log"; die "初始化失敗"; }
CODE="$(sed -n 's/^First-login code: //p' \
  "$DEMO_WORK_DIR/init.log" | head -1)"
[ -n "$CODE" ] || die "初始化輸出沒有首次登入碼"

cleanup_on_error() {
  local status="$?"
  if [ "$status" -ne 0 ]; then
    DEMO_WORK_DIR="$DEMO_WORK_DIR" BACKEND_PORT="$BACKEND_PORT" \
      FRONTEND_PORT="$FRONTEND_PORT" "$HERE/stop.sh" || true
  fi
}
trap cleanup_on_error EXIT

(cd "$REPO/backend"; nohup .venv/bin/python -m uvicorn \
  app.main:app --host 127.0.0.1 --port "$BACKEND_PORT" \
  >"$DEMO_WORK_DIR/backend.log" 2>&1 &
  echo $! >"$DEMO_WORK_DIR/backend.pid")
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$BACKEND_PORT/api/v1/version" \
    >/dev/null 2>&1; then break; fi
  kill -0 "$(cat "$DEMO_WORK_DIR/backend.pid")" 2>/dev/null \
    || { tail -20 "$DEMO_WORK_DIR/backend.log"; die "後端已停止"; }
  sleep 0.5
done
curl -fsS "http://127.0.0.1:$BACKEND_PORT/api/v1/version" \
  >/dev/null || die "後端啟動逾時"

SCHEME=http
WEB_HOST=localhost
# 預設只綁本機：示範帳號密碼寫在 README，綁全部介面等於讓同網段的
# 人都能登入。只有 --https 手機走查才改綁區網 IP（見下方）。
HOST_ARGS=(--host 127.0.0.1)
CURL_OPTS=()
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
if [ "$HTTPS" = 1 ]; then
  [ -n "$LAN_IP" ] || die "找不到區域網路 IP"
  command -v mkcert >/dev/null || die "請先安裝 mkcert"
  mkdir -p "$DEMO_WORK_DIR/cert"
  mkcert -cert-file "$DEMO_WORK_DIR/cert/demo.pem" \
    -key-file "$DEMO_WORK_DIR/cert/demo-key.pem" \
    localhost 127.0.0.1 "$LAN_IP" >/dev/null
  export INSPECTFLOW_DEV_HTTPS_CERT="$DEMO_WORK_DIR/cert/demo.pem"
  export INSPECTFLOW_DEV_HTTPS_KEY="$DEMO_WORK_DIR/cert/demo-key.pem"
  export INSPECTFLOW_DEV_HOST="$LAN_IP"
  export INSPECTFLOW_DEV_ALLOWED_CIDR="${LAN_IP%.*}.0/24"
  HOST_ARGS=()
  CURL_OPTS=(-k)
  SCHEME=https
  WEB_HOST="$LAN_IP"
fi
export VITE_BACKEND_URL="http://127.0.0.1:$BACKEND_PORT"
(cd "$REPO/frontend"; nohup node_modules/.bin/vite \
  ${HOST_ARGS[@]+"${HOST_ARGS[@]}"} --port "$FRONTEND_PORT" \
  --strictPort >"$DEMO_WORK_DIR/frontend.log" 2>&1 &
  echo $! >"$DEMO_WORK_DIR/frontend.pid")
for _ in $(seq 1 60); do
  if curl -fsS ${CURL_OPTS[@]+"${CURL_OPTS[@]}"} \
    "$SCHEME://$WEB_HOST:$FRONTEND_PORT/" >/dev/null 2>&1; then break; fi
  kill -0 "$(cat "$DEMO_WORK_DIR/frontend.pid")" 2>/dev/null \
    || { tail -20 "$DEMO_WORK_DIR/frontend.log"; die "前端已停止"; }
  sleep 0.5
done
curl -fsS ${CURL_OPTS[@]+"${CURL_OPTS[@]}"} \
  "$SCHEME://$WEB_HOST:$FRONTEND_PORT/" >/dev/null \
  || die "前端啟動逾時"

"$REPO/backend/.venv/bin/python" "$HERE/seed.py" \
  --base "http://127.0.0.1:$BACKEND_PORT" --code="$CODE" \
  --out "$DEMO_WORK_DIR/seed-result.json"
trap - EXIT

cat <<MESSAGE
示範環境已啟動
網頁：$SCHEME://$WEB_HOST:$FRONTEND_PORT/
任務：$SCHEME://$WEB_HOST:$FRONTEND_PORT/tasks
後端：http://127.0.0.1:$BACKEND_PORT
資料與 log：$DEMO_WORK_DIR
停止：DEMO_WORK_DIR="$DEMO_WORK_DIR" BACKEND_PORT="$BACKEND_PORT" \\
  FRONTEND_PORT="$FRONTEND_PORT" "$HERE/stop.sh"
MESSAGE
