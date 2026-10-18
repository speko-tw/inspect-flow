#!/usr/bin/env bash
# 依本示範目錄的 PID 檔停止服務，確認程序後才送出訊號。
set -uo pipefail
DEMO_WORK_DIR="${DEMO_WORK_DIR:-${TMPDIR:-/private/tmp}/inspectflow-demo}"
BACKEND_PORT="${BACKEND_PORT:-8300}"
FRONTEND_PORT="${FRONTEND_PORT:-5300}"

descendants() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do
    echo "$child"
    descendants "$child"
  done
}

stop_one() {
  local name="$1" marker="$2" file="$DEMO_WORK_DIR/$1.pid"
  local pid cmd all
  [ -f "$file" ] || { echo "$name: 沒有 PID 檔"; return; }
  pid="$(cat "$file")"
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "$name: PID $pid 已停止"
    rm -f "$file"
    return
  fi
  cmd="$(ps -o command= -p "$pid" 2>/dev/null)"
  case "$cmd" in
    *"$marker"*) ;;
    *) echo "$name: PID $pid 不屬於示範程序，保留程序"
       rm -f "$file"
       return ;;
  esac
  all="$(descendants "$pid") $pid"
  kill $all 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.25
  done
  kill -9 $all 2>/dev/null || true
  rm -f "$file"
  echo "$name: 已停止 PID $pid"
}

stop_one backend "uvicorn app.main:app"
stop_one frontend "vite"
for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "連接埠 $port 仍在使用（沒有停止該程序）"
  else
    echo "連接埠 $port 可用"
  fi
done
