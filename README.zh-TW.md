# inspect-flow

[English](README.md) | **繁體中文**

InspectFlow 工程查核系統（Engineering Inspection Management System）

## 執行檢查

需求：[uv](https://docs.astral.sh/uv/)、Node.js（版本見
`frontend/.nvmrc`）、`make`。

- `make setup` 安裝前後端依賴。
- `make version` 顯示發布版本；能取得 Git 資訊時也會顯示 commit 短 SHA。
- `make check` 對前後端依序執行格式檢查、lint、型別檢查、測試與
  build，並包含前端的拆包檢查。
- CI 在每個 PR 與每次 push 到 `main` 時，執行同一個 `make check`。
- 本機環境變數請複製 `.env.example` 為 `.env` 使用；`.env` 不得
  提交。

## 本機執行

先執行 `make setup`。以下指令都在 repo 根目錄執行。

執行 `make version` 可查詢目前發布版本與來源 commit。

1. **環境變數**（可省略）。後端從 shell 環境讀取，不會自動載入
   `.env`。`INSPECTFLOW_DATABASE_URL` 未設定時，資料庫是 SQLite
   檔案 `backend/data/inspectflow.db`（已被 git 忽略）。要改用別的
   資料庫或調整其他設定，就把 `.env.example` 複製為 `.env` 並編輯，
   再載入目前的 shell：

   `INSPECTFLOW_VERSION` 與 `INSPECTFLOW_COMMIT` 可覆寫後端及前端
   顯示的發布版本與 commit 短 SHA。未設定時，版本讀取 `VERSION`，
   commit 則在 Git 資訊可用時自動取得。

   ```bash
   set -a; . ./.env; set +a
   ```

2. **套用 migration**：`make migrate`。
3. **初始化系統**：`make init`。抄下指令印出的一次性首次登入碼。
   `admin` 尚未設定密碼時重跑，會讓舊碼失效並印出新碼。初始化只建立
   內建 `admin`；角色之後由 Admin 在系統內新增。
4. **啟動後端與前端**，各開一個終端機：
   - `make run-backend`：API 在 `http://127.0.0.1:8000`。
   - `make run-frontend`：Vite 在 `http://localhost:5173`，會把
     `/api` 轉給後端。
5. **設定 admin 密碼**：開啟首次設定頁
   `http://localhost:5173/setup`（設定完成前，開 `/` 或 `/login`
   都會導向這裡）。輸入 `make init` 印出的首次登入碼，並兩次輸入
   新密碼（8 到 128 個字元）。首次登入碼 24 小時後到期；過期或被
   鎖時，重跑 `make init` 就會換發新碼。設定成功後即以 `admin`
   登入；頁面接著讓你新增第一個使用者（臨時密碼只顯示一次），
   也可以略過直接進管理頁。
6. **需要重設 admin 密碼時**：在伺服器執行
   `make reset-admin-password`，依提示輸入兩次新密碼（不回顯）。指令
   也接受管線提供的兩行標準輸入供自動化使用，不接受密碼參數。

Safari 限制：登入 Cookie 用 `__Host-` 前綴，必須帶 `Secure`，Safari
在 `http://localhost` 不送，因此無法登入。Chrome、Firefox 可用；
要用 Safari 請見下一節。

## 用 Safari／iPhone 測試

改用 HTTPS 開發伺服器。需要 [mkcert](https://github.com/FiloSottile/mkcert)
（只需一次：`brew install mkcert`，再執行 `mkcert -install` 讓本機
信任它的根憑證）。接著在 `make run-backend` 已啟動的情況下，兩行指令
即可：

```bash
make dev-cert            # 產生 frontend/.cert/，已存在就跳過
make run-frontend-https  # 以 HTTPS 啟動前端
```

用 Safari 開 `https://localhost:5173`。`frontend/.cert/` 已被 git
忽略，不得提交。沒裝 mkcert 時 `make dev-cert` 會停下並提示安裝方式。
要換 port，執行 `make run-frontend-https FRONTEND_PORT=<port>`。
`make run-frontend` 仍是原本的 HTTP。

**iPhone／iPad**（同一個區網）設定與實機驗收（#231）：

- 重新產生含這台電腦區網 IP 的憑證：

  ```bash
  mkdir -p frontend/.cert
  mkcert -cert-file frontend/.cert/dev.pem \
    -key-file frontend/.cert/dev-key.pem \
    localhost 127.0.0.1 <區網 IP>
  ```

  將 `<區網 IP>` 換成開發電腦的 IPv4 位址。這會覆寫
  `make dev-cert` 產生的檔案。
- 在 iPhone 的 Wi-Fi 網路詳細資料查看 IPv4 位址與子網路遮罩。例如
  兩台裝置都在 `192.168.1.x` 時，允許網段可用 `192.168.1.0/24`。
  用以下指令啟動前端：

  ```bash
  make run-frontend-https \
    INSPECTFLOW_DEV_HOST=192.168.1.20 \
    INSPECTFLOW_DEV_ALLOWED_CIDR=192.168.1.0/24
  ```

  請將範例 IP 換成憑證使用的區網 IP，並將 CIDR 換成實際允許的
  子網。伺服器只會綁定該網卡，區網防護也只接受該 Host（HTTP/1.1 看 `Host` 標頭，手機走 HTTPS 時
  用的 HTTP/2 看 `:authority`）；網段外的
  請求會收到 HTTP 403。
  `INSPECTFLOW_DEV_HOST` 與 `INSPECTFLOW_DEV_ALLOWED_CIDR` 只能在 HTTPS
  模式下使用，且必須一起設定；未設定時 Vite 只監聽本機。後端仍只
  綁 `127.0.0.1`，前端負責轉送 `/api`。
- 在開發電腦執行 `mkcert -CAROOT`，只把該目錄中的 `rootCA.pem`
  傳到 iPhone（例如使用 AirDrop）。這是公開根憑證。**不得傳送
  `rootCA-key.pem` 或任何 CA 私鑰。** 在 iPhone 開啟憑證並到「設定」
  安裝已下載的憑證描述檔，再前往「設定 > 一般 > 關於本機 > 憑證
  信任設定」，為該根憑證開啟完整信任。
- 用 Safari 開啟 `https://<區網 IP>:5173/field/` 並登入；重新整理，
  確認仍維持登入，再登出。要加入主畫面，使用「分享 > 加入主畫面」；
  再從新圖示開啟一次，確認以獨立視窗顯示。

  **實機驗收：NOT_RUN（需負責人的 iPhone）。** 確認允許網段可連線、
  網段外來源收到 HTTP 403，再完成上述 Safari 登入、重新整理、登出與
  主畫面步驟。

## 文件

- [設計意圖（Design Intents）](docs/intents/README.md)：說明 InspectFlow 為什麼這樣設計，包含總覽與架構圖、設計原則、關鍵決策與技術棧、名詞對照，以及待決議事項。
