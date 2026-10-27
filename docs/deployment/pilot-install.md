# 簡易試用安裝（Docker Compose）

適用 Linux x86_64，使用 SQLite，客戶既有 Nginx 以公司 fullchain 憑證處理 HTTPS。手機經公司 VPN 連線，VPN DNS 必須能解析憑證上的網域。本系統只能透過 HTTPS 使用；容器內仍用 HTTP，由本機 Nginx 轉送。

安裝 [Docker Engine](https://docs.docker.com/engine/install/) 與 Compose plugin。執行者須在 docker 群組，或在本文所有 docker 指令前加 sudo。docker 群組具有主機管理權限。

## 1. 取得同版設定

先由負責人完成首次發布（見文末），公開的 GHCR package 不需要 `docker login`。首次試用 image tag 是 `pilot-test`。image 與設定必須取自同一份來源，避免新版 Compose 搭配舊 image。

在專用目錄執行；首次發布時 `SOURCE_REF=main` 是發布該 image 的 default branch。正式版本改成對應 Git tag（例如 `v0.6.0`）；若 main 已前進，使用 workflow 發布時的完整 commit SHA 下載。

```sh
( set -eu
  mkdir -p inspectflow
  cd inspectflow
  SOURCE_REF=main
  SOURCE="https://raw.githubusercontent.com/speko-tw/inspect-flow/$SOURCE_REF"
  curl -fL "$SOURCE/compose.yaml" -o compose.yaml
  curl -fL "$SOURCE/deploy/.env.example" -o .env
  curl -fL "$SOURCE/deploy/nginx/inspectflow-root.conf.example" \
    -o inspectflow.conf
)
```

後續指令均在 `inspectflow` 目錄執行。編輯 `.env`：

- `INSPECTFLOW_IMAGE_TAG=pilot-test`：映像標籤，不使用開發用的 `INSPECTFLOW_VERSION`。
- `INSPECTFLOW_HOST_PORT=8080`、`INSPECTFLOW_BIND_ADDRESS=127.0.0.1`：主機 `127.0.0.1:8080` 對應容器 `8000`。Docker 發布的 port 會繞過 ufw，因此建議只綁 loopback。Nginx 在另一台主機時，才綁指定內網位址，並在網路層限制來源。
- `INSPECTFLOW_BASE_PATH=`：根目錄留空；子路徑填 `/inspectflow`，無結尾斜線。只接受英數字、底線、連字號的路徑片段。
- 資料路徑先留空，使用固定具名 volumes `inspectflow-data`、`inspectflow-uploads`。不用 Python 3。

只支援部署範本列出的調校變數；Compose 明列轉送項目，不整份載入 `.env`。登入驗證採 DB 內的 opaque token hash，不需要 SECRET_KEY。登入 cookie 永遠是 Secure、HttpOnly、SameSite Strict、`__Host-`，無關閉設定。

## 2. 啟動與設定 Nginx

```sh
( set -eu
  docker compose pull
  docker compose up -d --wait --wait-timeout 120
  docker compose ps -a
  docker compose logs initialize
  docker inspect "$(docker compose ps -q app)" \
    --format '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}'
)
```

最後一行查出 Docker bridge gateway。Linux 上同機 Nginx 經發布 port 連入時，容器通常看見此位址；將 `.env` 的 `INSPECTFLOW_FORWARDED_ALLOW_IPS` 設為此代理來源的精確 IP，再執行 `docker compose up -d`。若來源不同，以實際網路配置核對，可填逗號分隔 IP/CIDR。預設 `127.0.0.1` 是保守值；不要在任意來源可直連容器時設成 `*`。容器使用 `--proxy-headers --forwarded-allow-ips`，只有受信任的來源能提供轉送標頭。

將下載的 `inspectflow.conf` 中的網域、port 與公司憑證路徑改成實際值，放到 Nginx 的設定目錄（例如 `/etc/nginx/conf.d/inspectflow.conf`）。`ssl_certificate` 必須包含完整中繼鏈，私鑰權限僅給 Nginx 管理者與程序讀取。依主機管理方式執行：

```sh
( set -eu
  sudo nginx -t
  sudo systemctl reload nginx
)
```

80 轉 443；VPN 環境不須對網際網路開放。換證時替換 Nginx 的 fullchain 與私鑰，重新 `nginx -t` 及 reload。手機顯示不安全時，檢查完整憑證鏈、公司 CA 信任與 VPN DNS。範例預留 25 MiB 上傳大小及 60 秒讀取逾時；照片 API 尚未完成，啟用後須依後端上限調整。

### 子路徑 `/inspectflow/`

改下載同版 `deploy/nginx/inspectflow-subpath.conf.example`，並在 `.env` 設 `INSPECTFLOW_BASE_PATH=/inspectflow` 後重建容器：`docker compose up -d`。Nginx 將 `/inspectflow` 轉至 `/inspectflow/`，再剝掉前綴轉送。不要同時由代理與 app 各剝一次。

同一個 image 在執行期注入入口資源、React Router basename、API 前綴與 manifest 的 start_url、scope、icons。深層網址重新整理也會使用絕對的部署前綴。因 `__Host-` 規則要求 Path=/，cookie 維持整個主機的 `/`，登出以同一路徑清除；同網域只部署一份 InspectFlow。現階段產品未註冊 service worker，沒有離線功能；本次保持停用，日後啟用時須一起驗證 scope。

## 3. 首次設定與登入

開啟 `https://公司網域/`（或 `/inspectflow/`），從 `docker compose logs initialize` 取得 `First-login code`，在首次設定頁設定密碼。設定碼有效 **24 小時**；一般重啟不會換掉有效碼。完成後登入帳號是 **admin**。

logs 遺失或設定碼過期，在仍未設定密碼時重新產生：

```sh
docker compose run --rm --no-deps -T initialize python -m app.cli.init_system
```

這會廢止舊碼。已完成設定時不能重做；忘記 admin 密碼用互動救援：

```sh
docker compose run --rm --no-deps app python -m app.cli.reset_admin_password
```

以首頁、深層網址、建立專案及登出確認部署。主機本機 `http://localhost:8080` 測試時，支援 localhost Secure cookie 例外的瀏覽器可以登入；Safari 等瀏覽器行為可能不同，正式驗收用 HTTPS。`http://<IP>:8080` 不會送出 Secure cookie，無法維持登入是預期行為。

## 4. 手動備份

先停止所有寫入，再由容器 tar 將資料庫與預留的上傳目錄打包到主機，不需要 sudo 或查 volume 名稱。具名與 bind 模式使用完全相同的指令。保留原本 `.env` 及相同版本的 Compose（另行安全備份）。

```sh
( set -eu
  docker compose down
  mkdir -p backups
  BACKUP="backups/inspectflow-$(date +%Y%m%d-%H%M%S).tar.gz"
  docker compose run --rm --no-deps -T --entrypoint tar app \
    -czf - /data /uploads > "$BACKUP"
  test -s "$BACKUP"
  docker compose up -d --wait --wait-timeout 120
)
```

## 5. 更新與失敗還原

依上一節完成備份 → `down` → 改 `.env` 中 `INSPECTFLOW_IMAGE_TAG` → `pull` → `up -d` → 確認 healthy。先停舊版，避免 migration 期間舊 API 持續寫入（PR-13）。同時從新 image 的來源 tag/SHA 取得同版設定，保留自己的 `.env` 值。

```sh
( set -eu
  docker compose down
  # 此處先將 .env 的 INSPECTFLOW_IMAGE_TAG 改為目標版本。
  docker compose pull
  docker compose up -d --wait --wait-timeout 120
  docker compose ps -a
)
```

migration 失敗先看 `docker compose logs migrate`，再 `down`，還原完整備份，將 `.env` image tag 改回舊版後才 `up -d`。不得讓舊版直接連到已升級的資料庫。

還原會取代目前資料；確認備份正確且服務已停：

```sh
( set -eu
  docker compose down
  BACKUP=backups/inspectflow-YYYYmmdd-HHMMSS.tar.gz
  test -s "$BACKUP"
  docker compose run --rm --no-deps -T --entrypoint /bin/sh app \
    -ec 'find /data /uploads -mindepth 1 -maxdepth 1 -exec rm -rf {} +'
  docker compose run --rm --no-deps -T --entrypoint tar app \
    -xzf - -C / < "$BACKUP"
  # 回滾時先把 .env 的 INSPECTFLOW_IMAGE_TAG 改回備份時版本。
  docker compose up -d --wait --wait-timeout 120
)
```

一般停止用 `docker compose down`。**不要加 `-v`**，那會刪除具名資料 volume。

## 6. 排錯

- port 衝突：改 `.env` 主機 port，Nginx upstream 一起調整。
- app 一直重啟：`docker compose logs app`；檢查調校值是否為正整數。
- migration 失敗：`docker compose logs migrate`，依前節還原。
- 初始化失敗：`docker compose logs initialize`；檢查資料目錄寫入權限。
- 健康檢查：`docker compose ps -a`；容器內 HTTP healthcheck 不依賴 Nginx 憑證。
- Compose 已設定每份 log 上限 10 MiB、保留 3 份；設定碼 logs 可能輪替，使用上述救援指令。
- 代理 IP：目前登入鎖定以帳號為準，認證與稽核紀錄沒有記錄來源 IP；可由 Uvicorn access log 驗證實際解析 IP。Nginx 覆寫 X-Forwarded-For，避免信任用戶端偽造的值。

## 進階：主機資料夾與搬機

SQLite 與上傳資料必須放在**本機磁碟，不可用 NFS／CIFS**。容器固定 UID/GID 999，先建立資料夾並交付權限，避免 Docker 用 root 自動建立：

```sh
( set -eu
  sudo install -d -o 999 -g 999 -m 750 \
    /var/lib/inspectflow/data /var/lib/inspectflow/uploads
)
```

在 `.env` 填 `INSPECTFLOW_DATA_DIR=/var/lib/inspectflow/data`、`INSPECTFLOW_UPLOADS_DIR=/var/lib/inspectflow/uploads`，所有 Compose 指令不變。Compose 的 `:z` 讓 SELinux 主機的三個服務可共享目錄；不要指向系統目錄，以免重標籤影響其他服務。確定 UID/GID 999 對應的本機帳號存取權符合主機政策。

由具名 volume 切到 bind、換資料夾或搬機：先在舊設定停寫並備份；建立新目錄、修改 `.env`，再在新設定下依上節還原。直接改路徑不會搬資料，會看到空資料庫。搬機也要保留版本對應、`.env` 及公司 Nginx 設定。

## 負責人首次發布順序

1. 人工 merge 本 PR 到 default branch。
2. 在 default branch 手動執行 Publish Docker image workflow，tag 輸入 `pilot-test`。
3. 首次發布後在 GHCR package 設定把 visibility 改成 **public**。
4. 確認匿名 pull 成功，記錄發布來源 SHA，再交安裝者下載同版設定與安裝。

手動 tag 禁止 `latest` 或以數字三段版本開頭；只有完整 `vX.Y.Z` Git tag 更新 latest，rc 等預發布不更新。本工作不建立 tag、不觸發 workflow、不推送 image。正式憑證管理、自動備份、監控及完整 Deployment DoD 留在 0.9.x 的 `pilot-deployment`。
