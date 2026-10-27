# 簡易試用部署

本指南適用於 Linux x86_64 試用主機。簡易 Docker Compose 部署納入 0.6.x；正式 HTTPS、自動備份與完整維運仍屬 0.9.x（[#109](https://github.com/speko-tw/inspect-flow/issues/109)）。

## 安裝 Docker

依 Docker 官方 [Engine 安裝指南](https://docs.docker.com/engine/install/) 安裝 Docker Engine 與 Compose plugin，並確認 `docker compose version` 可正常執行。本指南以 Python 3 解析 Compose 輸出的 JSON；先執行 `command -v python3 && python3 --version` 確認可用。

## 取得 Compose 設定

在主機建立專用目錄，下載發布版的 `compose.yaml` 與 `.env.example`，再複製環境設定：

```sh
mkdir -p ~/inspect-flow
cd ~/inspect-flow
curl -fLO https://raw.githubusercontent.com/speko-tw/inspect-flow/main/compose.yaml
curl -fLO https://raw.githubusercontent.com/speko-tw/inspect-flow/main/.env.example
cp .env.example .env
```

編輯 `.env`：設定 `INSPECTFLOW_VERSION` 為要安裝的 image tag。`latest` 用於最新試用版；固定版本可使用不含 `v` 的版本號。預設對外連接埠為 `18700`，對應容器固定的 `8000`。`INSPECTFLOW_BIND_ADDRESS=0.0.0.0` 會監聽所有網卡；若只透過同機反向代理存取，改為 `127.0.0.1`。`INSPECTFLOW_COOKIE_SECURE=true` 應保留給 HTTPS；僅在隔離的內網 HTTP 測試時才設為 `false`。

## 儲存位置

預設資料庫與預留的上傳目錄使用 Docker named volumes，由 Docker 管理。若需指定主機資料夾，下載 `compose.bind.yaml`，在 `.env` 設定 `INSPECTFLOW_DATA_DIR` 和 `INSPECTFLOW_UPLOADS_DIR`，並以兩個 Compose 檔啟動：

```sh
curl -fLO https://raw.githubusercontent.com/speko-tw/inspect-flow/main/compose.bind.yaml
set -a; . ./.env; set +a
sudo install -d -o 999 -g 999 "$INSPECTFLOW_DATA_DIR" "$INSPECTFLOW_UPLOADS_DIR"
docker compose -f compose.yaml -f compose.bind.yaml up -d
```

容器程序以 UID/GID `999:999` 執行。bind mount 主機資料夾必須允許該身份讀寫；請先在 `.env` 設定絕對路徑，再依實際 `.env` 值建立目錄。上傳資料夾目前只是預留位置，照片上傳待 0.6.x field-evidence 功能完成後另行驗收。

### bind mount 備份與還原

備份前先停止所有 Compose 服務，確認 bind 路徑沒有被其他容器使用，再複製兩個資料夾。以下範例假設 `.env` 中兩個路徑是絕對路徑：

```sh
(
set -eu
set -a; . ./.env; set +a
docker compose -f compose.yaml -f compose.bind.yaml down
for path in "$INSPECTFLOW_DATA_DIR" "$INSPECTFLOW_UPLOADS_DIR"; do
  running="$(docker ps -q --filter "volume=$path")"
  if [ -n "$running" ]; then
    echo "停止仍使用 $path 的容器後再繼續。"
    exit 1
  fi
done
mkdir -p backups
tar -C "$INSPECTFLOW_DATA_DIR" -czf backups/inspectflow-data.tgz .
tar -C "$INSPECTFLOW_UPLOADS_DIR" -czf backups/inspectflow-uploads.tgz .
)
```

還原會覆蓋現有資料。確認備份檔完整後，先停止服務，再確認沒有容器使用目標路徑；先驗證兩個壓縮檔，再清空目標資料夾並還原：

```sh
(
set -eu
set -a; . ./.env; set +a
docker compose -f compose.yaml -f compose.bind.yaml down
for path in "$INSPECTFLOW_DATA_DIR" "$INSPECTFLOW_UPLOADS_DIR"; do
  running="$(docker ps -q --filter "volume=$path")"
  if [ -n "$running" ]; then
    echo "停止仍使用 $path 的容器後再繼續。"
    exit 1
  fi
done
tar -tzf backups/inspectflow-data.tgz >/dev/null
tar -tzf backups/inspectflow-uploads.tgz >/dev/null
find "$INSPECTFLOW_DATA_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
find "$INSPECTFLOW_UPLOADS_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
tar -C "$INSPECTFLOW_DATA_DIR" -xzf backups/inspectflow-data.tgz
tar -C "$INSPECTFLOW_UPLOADS_DIR" -xzf backups/inspectflow-uploads.tgz
sudo chown -R 999:999 "$INSPECTFLOW_DATA_DIR" "$INSPECTFLOW_UPLOADS_DIR"
docker compose -f compose.yaml -f compose.bind.yaml up -d
)
```

### 從 named volume 搬到 bind mount

先在 `.env` 設定兩個新的、空的絕對路徑並建立目錄。停止服務後，依 Compose 實際解析結果取得 volume 名稱；不要自行假設 Compose project 名稱：

```sh
set -a; . ./.env; set +a
sudo install -d -o 999 -g 999 "$INSPECTFLOW_DATA_DIR" "$INSPECTFLOW_UPLOADS_DIR"
docker compose down
DATA_VOLUME="$(docker compose -f compose.yaml config --format json | \
  python3 -c 'import json,sys; print(json.load(sys.stdin)["volumes"]["inspectflow-data"]["name"])')"
UPLOADS_VOLUME="$(docker compose -f compose.yaml config --format json | \
  python3 -c 'import json,sys; print(json.load(sys.stdin)["volumes"]["inspectflow-uploads"]["name"])')"
for volume in "$DATA_VOLUME" "$UPLOADS_VOLUME"; do
  if [ -n "$(docker ps -q --filter "volume=$volume")" ]; then
    echo "停止仍掛載 $volume 的容器後再繼續。"
    exit 1
  fi
done
docker run --rm -v "$DATA_VOLUME:/source:ro" \
  -v "$INSPECTFLOW_DATA_DIR:/destination" alpine:3.22 \
  sh -eu -c 'tar -C /source -cf - . | tar -C /destination -xf -'
docker run --rm -v "$UPLOADS_VOLUME:/source:ro" \
  -v "$INSPECTFLOW_UPLOADS_DIR:/destination" alpine:3.22 \
  sh -eu -c 'tar -C /source -cf - . | tar -C /destination -xf -'
sudo chown -R 999:999 "$INSPECTFLOW_DATA_DIR" "$INSPECTFLOW_UPLOADS_DIR"
docker compose -f compose.yaml -f compose.bind.yaml up -d
```

更換 bind mount 主機路徑或搬移到另一台主機時，也先停止所有使用資料的服務；將資料庫與 uploads 兩個資料夾完整複製到新位置，更新 `.env` 的絕對路徑，確認新資料夾 UID/GID 為 `999:999` 後再啟動 overlay。不要讓新舊服務同時寫入同一份資料。

## 啟動及首次設定

```sh
docker compose up -d
docker compose ps
docker compose logs initialize
```

首次設定碼只在尚未建立 admin 密碼且沒有仍有效設定碼時產生。從 `initialize` logs 取得設定碼，開啟 `http://<主機位址>:<INSPECTFLOW_HOST_PORT>/setup` 設定 admin 密碼。一般 down/up 不會換發有效設定碼。資料庫只保存設定碼雜湊，無法查回舊碼；忘記、過期或被鎖定時，請在伺服器目錄執行以下命令簽發新碼：

```sh
docker compose run --rm --no-deps --entrypoint python initialize \
  -m app.cli.init_system
```

將此命令當次輸出的 `First-login code` 用於設定頁；不要從舊的 `initialize` logs 複製舊碼。此命令會作廢舊碼並簽發新碼，只適用於 admin 尚未設定密碼的初始設定階段。若 admin 已設定密碼但忘記密碼，改用伺服器端密碼重設命令；它會互動讀取兩次新密碼，不會刪除資料庫：

```sh
docker compose run --rm --no-deps --entrypoint python app \
  -m app.cli.reset_admin_password
```

不要刪除資料庫來重設首次設定或 admin 密碼；刪除資料庫會一併刪除已建立的資料。

## 更新、停止與備份

更新時先在 `.env` 改 `INSPECTFLOW_VERSION`，再執行：

```sh
docker compose pull
docker compose up -d
docker compose ps
```

停止服務但保留資料：`docker compose down`。此命令會停止並移除 app、initialize、migrate 容器，但保留資料。備份前確認沒有其他容器使用這兩個 volume；下列命令會依 Compose 設定讀出實際 volume 名稱，不假設 project name：

```sh
docker compose down
DATA_VOLUME="$(docker compose -f compose.yaml config --format json | \
  python3 -c 'import json,sys; print(json.load(sys.stdin)["volumes"]["inspectflow-data"]["name"])')"
UPLOADS_VOLUME="$(docker compose -f compose.yaml config --format json | \
  python3 -c 'import json,sys; print(json.load(sys.stdin)["volumes"]["inspectflow-uploads"]["name"])')"
for volume in "$DATA_VOLUME" "$UPLOADS_VOLUME"; do
  if [ -n "$(docker ps -q --filter "volume=$volume")" ]; then
    echo "停止仍掛載 $volume 的容器後再繼續。"
    exit 1
  fi
done
mkdir -p backups
docker run --rm -v "$DATA_VOLUME:/source:ro" \
  -v "$PWD/backups:/backup" alpine:3.22 \
  sh -c 'tar -C /source -czf /backup/inspectflow-data.tgz .'
docker run --rm -v "$UPLOADS_VOLUME:/source:ro" \
  -v "$PWD/backups:/backup" alpine:3.22 \
  sh -c 'tar -C /source -czf /backup/inspectflow-uploads.tgz .'
```

將兩個備份檔存放於安全位置。資料庫備份包含系統資料，請限制備份檔的存取權。

還原前先把兩個備份檔放回 `backups/`，停止 Compose，並確認沒有其他容器掛載 volumes。以下整段在任一命令失敗時立即停止，不會繼續啟動服務；會先驗證兩個壓縮檔，再清空 volumes、解壓縮並恢復 UID/GID `999:999`。還原會取代目前資料：

```sh
(
set -eu
docker compose down
DATA_VOLUME="$(docker compose -f compose.yaml config --format json | \
  python3 -c 'import json,sys; print(json.load(sys.stdin)["volumes"]["inspectflow-data"]["name"])')"
UPLOADS_VOLUME="$(docker compose -f compose.yaml config --format json | \
  python3 -c 'import json,sys; print(json.load(sys.stdin)["volumes"]["inspectflow-uploads"]["name"])')"
tar -tzf backups/inspectflow-data.tgz >/dev/null
tar -tzf backups/inspectflow-uploads.tgz >/dev/null
for volume in "$DATA_VOLUME" "$UPLOADS_VOLUME"; do
  running="$(docker ps -q --filter "volume=$volume")"
  if [ -n "$running" ]; then
    echo "停止仍掛載 $volume 的容器後再繼續。"
    exit 1
  fi
done
docker volume create "$DATA_VOLUME" >/dev/null
docker volume create "$UPLOADS_VOLUME" >/dev/null
docker run --rm -v "$DATA_VOLUME:/restore" \
  -v "$PWD/backups:/backup:ro" alpine:3.22 sh -eu -c \
  'find /restore -mindepth 1 -maxdepth 1 -exec rm -rf {} + && \
   tar -C /restore -xzf /backup/inspectflow-data.tgz && \
   chown -R 999:999 /restore'
docker run --rm -v "$UPLOADS_VOLUME:/restore" \
  -v "$PWD/backups:/backup:ro" alpine:3.22 sh -eu -c \
  'find /restore -mindepth 1 -maxdepth 1 -exec rm -rf {} + && \
   tar -C /restore -xzf /backup/inspectflow-uploads.tgz && \
   chown -R 999:999 /restore'
docker compose up -d
)
```

不可用 `docker compose down -v` 作一般停止，該選項會刪除 named volume。

## 常見問題與限制

- Port 已被佔用：把 `.env` 的 `INSPECTFLOW_HOST_PORT` 改成未使用的主機 port；容器內 port 固定為 `8000`。
- 無法從其他電腦連線：確認 `INSPECTFLOW_BIND_ADDRESS=0.0.0.0`、主機防火牆允許設定的 port，且客戶端可路由到該主機。
- 忘記首次設定碼：檢查 `docker compose logs initialize`。設定碼已過期或遭鎖定時依產品既有流程處理；一般重啟不會替換仍有效的碼。
- 內網 HTTP 不支援手機 PWA 安裝及離線功能，需 HTTPS。正式 HTTPS 部署規劃在 0.9.x/#109；目前原始碼沒有 `sw.js` 產物，因此本版本不宣稱 service worker 或離線功能已驗收。

## 驗收範圍

本簡易部署以建立專案、公司等現有資料驗證重啟及 image 更新後持久性。照片上傳待 0.6.x field-evidence 功能完成後再驗收；本版本沒有照片上傳 API。
