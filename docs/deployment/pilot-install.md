# 簡易試用安裝（Docker Compose）

適用 Linux x86_64，使用 SQLite，客戶既有 Nginx 以公司 fullchain 憑證處理 HTTPS。手機經公司 VPN 連線，VPN DNS 必須能解析憑證上的網域。本系統只能透過 HTTPS 使用；容器內仍用 HTTP，由本機 Nginx 轉送。

安裝 [Docker Engine](https://docs.docker.com/engine/install/) 與 **[Docker Compose plugin 2.20.0](https://github.com/docker/compose/releases/tag/v2.20.0) 或更新版本**（本文使用 `up --wait --wait-timeout`；舊版須先升級）。執行者須在 docker 群組，或在本文所有 docker 指令前加 sudo。docker 群組具有主機管理權限。

## 1. 取得同版設定

先由負責人完成首次發布（見文末），公開的 GHCR package 不需要 `docker login`。首次試用 image tag 是 `pilot-test`。image 與設定必須取自同一份來源，避免新版 Compose 搭配舊 image。

在專用目錄執行；首次發布時 `SOURCE_REF=main` 是發布該 image 的 default branch。正式版本改成對應 Git tag（例如 `v0.6.0`，發布的 image tag 是 `0.6.0`，不含 `v`）；若 main 已前進，使用 workflow 發布時的完整 commit SHA 下載。

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

下載區塊在子 shell 執行；接著切換目前終端的工作目錄：

```sh
cd inspectflow
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
)
```

預設固定 Docker 子網 `172.31.250.0/24`，信任 `127.0.0.1` 加上整個該子網，涵蓋不同 Docker 實作的本機 port 轉送來源，省去首次安裝手動查 gateway。port 只綁 `127.0.0.1`，遠端無法直接連入；此私有 bridge 子網只供本機 Docker 服務使用。因此只有本機程序及同網路的容器能提供受信任標頭；不要將不受信任的容器加入此網路。Nginx 範例覆寫用戶端提供的 X-Forwarded-For。

> **警告：若將 `INSPECTFLOW_BIND_ADDRESS` 改成任何非 `127.0.0.1` 位址，必須將 `INSPECTFLOW_FORWARDED_ALLOW_IPS` 改成只信任 Nginx 主機的精確 IP，不可再信任整個 Docker 子網，也不可用 `*`。** 同時限制只有 Nginx 能連入發布 port；以 app logs 確認轉送來源，不能直接沿用同機預設。

若子網和公司 VPN／既有 Docker 網路重疊，先 `docker compose down`，在 `.env` 將 `INSPECTFLOW_NETWORK_SUBNET` 改成經網管確認未使用的私網 /24（例如 `172.30.249.0/24`），讓 `INSPECTFLOW_FORWARDED_ALLOW_IPS` 留空以同步套用新子網，再 `docker compose up -d --wait --wait-timeout 120`。若自行填寫信任清單，也須同步修改。

**安裝後必驗：** 從另一台 VPN 用戶端透過 Nginx HTTPS 開啟頁面，再執行 `docker compose logs app`。access log 必須顯示真實用戶端 IP，不能是 Docker gateway。Docker Desktop 的轉送可能使用 VM 內部位址，不能代替客戶 Linux 主機的這項驗證；若出現 gateway，核對 Nginx 覆寫標頭及實際代理來源後調整精確信任 IP。

將下載的 `inspectflow.conf` 中的網域、port 與公司憑證路徑改成實際值，放到 Nginx 的設定目錄（例如 `/etc/nginx/conf.d/inspectflow.conf`）。`ssl_certificate` 必須包含完整中繼鏈，私鑰權限僅給 Nginx 管理者與程序讀取。依主機管理方式執行：

```sh
( set -eu
  sudo nginx -t
  sudo systemctl reload nginx
)
```

80 轉 443；VPN 環境不須對網際網路開放。換證時替換 Nginx 的 fullchain 與私鑰，重新 `nginx -t` 及 reload。手機顯示不安全時，檢查完整憑證鏈、公司 CA 信任與 VPN DNS。範例預留 25 MiB 上傳大小及 60 秒讀取逾時；照片 API 尚未完成，啟用後須依後端上限調整。

### 子路徑 `/inspectflow/`

優先使用專用主機名稱；與其他應用共用主機名稱時，只放受信任的應用，因為同源頁面的 XSS 可以呼叫 InspectFlow API。

改下載同版 `deploy/nginx/inspectflow-subpath.conf.example`，並在 `.env` 設 `INSPECTFLOW_BASE_PATH=/inspectflow` 後重建容器：`docker compose up -d`。若同網域已有 `server` 區塊，只複製範例中的兩個 `location` 區塊到既有 HTTPS server，不要再建重複的 server。Nginx 將 `/inspectflow` 轉至 `/inspectflow/`，再剝掉前綴轉送。不要同時由代理與 app 各剝一次。

同一個 image 在執行期注入入口資源、React Router basename、API 前綴與 manifest 的 start_url、scope、icons。深層網址重新整理也會使用絕對的部署前綴。因 `__Host-` 規則要求 Path=/，cookie 維持整個主機的 `/`，登出以同一路徑清除；同網域只部署一份 InspectFlow。現階段產品未註冊 service worker，沒有離線功能；本次保持停用，日後啟用時須一起驗證 scope。

## 3. 首次設定與登入

開啟 `https://公司網域/`（或 `/inspectflow/`），從 `docker compose logs initialize` 取得 `First-login code`，在首次設定頁設定密碼。設定碼有效 **24 小時**；一般重啟不會換掉有效碼。完成後登入帳號是 **admin**。

尚未設定密碼時，`docker compose down` 或還原會使原初始化 logs 消失，須用下列救援指令重新產生設定碼。logs 遺失或設定碼過期，在仍未設定密碼時重新產生：

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
    -czf - /data /uploads > "$BACKUP.part"
  gzip -t "$BACKUP.part"
  mv "$BACKUP.part" "$BACKUP"
  docker compose up -d --wait --wait-timeout 120
)
```

## 5. 更新與失敗還原

更新前先記下目前 image 的 digest，保存到備份旁：

```sh
docker image inspect "$(docker compose images -q app)" \
  --format '{{json .RepoDigests}}'
```

記下 `ghcr.io/speko-tw/inspect-flow@sha256:...` 的 digest；回滾時 `.env` 可填 `INSPECTFLOW_IMAGE_TAG=pilot-test@sha256:...`，鎖定原 image，避免同名 tag 已被覆蓋。

更新專用的備份流程如下；完成後維持停機，避免備份後又產生未納入備份的寫入（PR-13）。

```sh
( set -eu
  docker compose down
  mkdir -p backups
  BACKUP="backups/inspectflow-$(date +%Y%m%d-%H%M%S).tar.gz"
  docker compose run --rm --no-deps -T --entrypoint tar app \
    -czf - /data /uploads > "$BACKUP.part"
  gzip -t "$BACKUP.part"
  mv "$BACKUP.part" "$BACKUP"
)
```

接著依備份 → `down` → 改 tag → `pull` → `up -d` → healthy 的順序，將 `.env` 中 `INSPECTFLOW_IMAGE_TAG` 改為目標版本，並從新 image 的來源 tag/SHA **只下載 `compose.yaml`**。部署範本另存為 `.env.example` 以供比對，逐項合入新增設定，**不得覆蓋自己的 `.env`**：

```sh
( set -eu
  SOURCE_REF=v0.6.0 # 改成新 image 的來源 tag 或完整 SHA
  SOURCE="https://raw.githubusercontent.com/speko-tw/inspect-flow/$SOURCE_REF"
  curl -fL "$SOURCE/compose.yaml" -o compose.yaml
  curl -fL "$SOURCE/deploy/.env.example" -o .env.example
)
```

再執行：

```sh
( set -eu
  docker compose down
  docker compose pull
  docker compose up -d --wait --wait-timeout 120
  docker compose ps -a
)
```

migration 失敗先看 `docker compose logs migrate`，再 `down`，還原完整備份，將 `.env` image tag 改回舊版後才 `up -d`。不得讓舊版直接連到已升級的資料庫。

還原會取代目前資料；先在主機以 `gzip -t` 與 `tar -tzf` 驗證，**兩者都通過才可刪除舊資料**。失敗立即停止，先找出有效備份；不可跳過檢查。下列區塊只還原，不啟動 app：

```sh
( set -eu
  docker compose down
  BACKUP=backups/inspectflow-YYYYmmdd-HHMMSS.tar.gz
  gzip -t "$BACKUP"
  tar -tzf "$BACKUP" >/dev/null
  docker compose run --rm --no-deps -T --entrypoint /bin/sh app \
    -ec 'find /data /uploads -mindepth 1 -maxdepth 1 -exec rm -rf {} +'
  docker compose run --rm --no-deps -T --entrypoint tar app \
    -xzf - -C / < "$BACKUP"
)
```

回滾依序操作：

1. 依上列區塊停機、驗證並還原備份。
2. 將 `.env` 的 `INSPECTFLOW_IMAGE_TAG` 改回備份時的舊版 tag 或先前記下的 `pilot-test@sha256:...`。
3. 執行 `docker compose up -d --wait --wait-timeout 120`，確認 healthy 與原資料後才恢復使用。

一般停止用 `docker compose down`。**不要加 `-v`**，那會刪除具名資料 volume。

## 6. 排錯

- 空白頁或資源 404：檢查 `INSPECTFLOW_BASE_PATH` 與 Nginx location／前綴剝除設定是否一致。
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

在 `.env` 填 `INSPECTFLOW_DATA_DIR=/var/lib/inspectflow/data`、`INSPECTFLOW_UPLOADS_DIR=/var/lib/inspectflow/uploads`，所有 Compose 指令不變。預設具名 volume 不附加 SELinux bind 標記。只有啟用 SELinux 的主機使用 bind mount 時，才在 `.env` 設 `INSPECTFLOW_SELINUX=:z`，讓三個服務可共享目錄；不要指向系統目錄，以免重標籤影響其他服務。確定 UID/GID 999 對應的本機帳號存取權符合主機政策。

由具名 volume 切到 bind、換資料夾或搬機：先在舊設定停寫並備份；建立新目錄、修改 `.env`，再在新設定下依上節還原。直接改路徑不會搬資料，會看到空資料庫。搬機也要保留版本對應、`.env` 及公司 Nginx 設定。

## 負責人首次發布順序

1. 人工 merge 本 PR 到 default branch。
2. 在 default branch 手動執行 Publish Docker image workflow，tag 輸入 `pilot-test`。
3. 首次發布後在 GHCR package 設定把 visibility 改成 **public**。
4. 確認匿名 pull 成功，記錄發布來源 SHA，再交安裝者下載同版設定與安裝。

手動 tag 禁止 `latest` 或以數字三段版本開頭；只有完整 `vX.Y.Z` Git tag 更新 latest，rc 等預發布不更新。本工作不建立 tag、不觸發 workflow、不推送 image。正式憑證管理、自動備份、監控及完整 Deployment DoD 留在 0.9.x 的 `pilot-deployment`。
