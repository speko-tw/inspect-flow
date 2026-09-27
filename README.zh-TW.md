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
3. **初始化系統**：`make init`。會詢問本公司的代碼與名稱，以及內建
   `admin` 與負責人個人帳號的必填基本欄位；對已初始化的資料庫再執行
   一次，會回報已初始化並且不寫入任何資料。**設定密碼**：由 #154
   提供，合併後補上。
4. **啟動後端與前端**，各開一個終端機：
   - `make run-backend`：API 在 `http://127.0.0.1:8000`。
   - `make run-frontend`：Vite 在 `http://localhost:5173`，會把
     `/api` 轉給後端。
5. **登入**：用瀏覽器開 `http://localhost:5173`。

Safari 限制：登入 Cookie 用 `__Host-` 前綴，必須帶 `Secure`，Safari
在 `http://localhost` 不送，因此無法登入。Chrome、Firefox 可用；
要用 Safari 請見下一節。

## 用 Safari／iPhone 測試

改用 HTTPS 開發伺服器。憑證用 [mkcert](https://github.com/FiloSottile/mkcert)
在本機產生，放在已被 git 忽略的 `frontend/.cert/`，不得提交。

1. **安裝 mkcert**（只需一次）：`brew install mkcert`，再執行
   `mkcert -install` 讓本機信任它的根憑證。
2. **產生憑證**：

   ```bash
   mkdir -p frontend/.cert
   mkcert -cert-file frontend/.cert/dev.pem \
     -key-file frontend/.cert/dev-key.pem localhost 127.0.0.1
   ```

   要給 iPhone 連，最後再加上這台電腦的區網 IP。
3. **啟動**：後端照上一節執行 `make run-backend`；前端改成：

   ```bash
   export INSPECTFLOW_DEV_HTTPS_CERT="$PWD/frontend/.cert/dev.pem"
   export INSPECTFLOW_DEV_HTTPS_KEY="$PWD/frontend/.cert/dev-key.pem"
   make run-frontend
   ```

   用 Safari 開 `https://localhost:5173`。兩個變數都不設就是原本的
   HTTP。
4. **iPhone／iPad**（同一個區網）：
   - 啟動前端前再 `export INSPECTFLOW_DEV_HOST=0.0.0.0`，讓前端對
     區網開放；這個變數只在 HTTPS 模式有效。後端仍只綁 127.0.0.1，
     由前端轉送 `/api`。
   - 把 `mkcert -CAROOT` 目錄裡的 `rootCA.pem` 傳到 iPhone 安裝，
     再到「設定 > 一般 > 關於本機 > 憑證信任設定」開啟信任。
   - 用 `https://<區網 IP>:5173` 開啟。

## 文件

- [設計意圖（Design Intents）](docs/intents/README.md)：說明 InspectFlow 為什麼這樣設計，包含總覽與架構圖、設計原則、關鍵決策與技術棧、名詞對照，以及待決議事項。
