# inspect-flow

[English](README.md) | **繁體中文**

InspectFlow 工程查核系統（Engineering Inspection Management System）

## 執行檢查

需求：[uv](https://docs.astral.sh/uv/)、Node.js（版本見
`frontend/.nvmrc`）、`make`。

- `make setup` 安裝前後端依賴。
- `make check` 對前後端依序執行格式檢查、lint、型別檢查、測試與
  build，並包含前端的拆包檢查。
- CI 在每個 PR 與每次 push 到 `main` 時，執行同一個 `make check`。
- 本機環境變數請複製 `.env.example` 為 `.env` 使用；`.env` 不得
  提交。

## 本機執行

先執行 `make setup`。以下指令都在 repo 根目錄執行。

1. **環境變數**（可省略）。後端從 shell 環境讀取，不會自動載入
   `.env`。`INSPECTFLOW_DATABASE_URL` 未設定時，資料庫是 SQLite
   檔案 `backend/data/inspectflow.db`（已被 git 忽略）。要改用別的
   資料庫或調整其他設定，就把 `.env.example` 複製為 `.env` 並編輯，
   再載入目前的 shell：

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

**iPhone／iPad**（同一個區網）仍需手動設定（#231）：

- 重新產生含這台電腦區網 IP 的憑證：

  ```bash
  mkdir -p frontend/.cert
  mkcert -cert-file frontend/.cert/dev.pem \
    -key-file frontend/.cert/dev-key.pem \
    localhost 127.0.0.1 <區網 IP>
  ```

  這會覆寫 `make dev-cert` 產生的檔案。
- 啟動前端前再 `export INSPECTFLOW_DEV_HOST=0.0.0.0`，讓前端對區網
  開放；這個變數只在 HTTPS 模式有效。後端仍只綁 127.0.0.1，由前端
  轉送 `/api`。
- 把 `mkcert -CAROOT` 目錄裡的 `rootCA.pem` 傳到 iPhone 安裝，再到
  「設定 > 一般 > 關於本機 > 憑證信任設定」開啟信任。
- 用 `https://<區網 IP>:5173` 開啟。

## 文件

- [設計意圖（Design Intents）](docs/intents/README.md)：說明 InspectFlow 為什麼這樣設計，包含總覽與架構圖、設計原則、關鍵決策與技術棧、名詞對照，以及待決議事項。
