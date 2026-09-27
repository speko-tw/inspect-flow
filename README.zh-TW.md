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
3. **初始化與設定密碼**：指令由 #134、#154 提供，合併後補上。
4. **啟動後端與前端**，各開一個終端機：
   - `make run-backend`：API 在 `http://127.0.0.1:8000`。
   - `make run-frontend`：Vite 在 `http://localhost:5173`，會把
     `/api` 轉給後端。
5. **登入**：用瀏覽器開 `http://localhost:5173`。

已知限制：登入 Cookie 用 `__Host-` 前綴，必須帶 `Secure`。Safari
在 `http://localhost` 不送這種 Cookie，因此無法登入（見 #169）；
Chrome、Firefox 可用。

## 文件

- [設計意圖（Design Intents）](docs/intents/README.md)：說明 InspectFlow 為什麼這樣設計，包含總覽與架構圖、設計原則、關鍵決策與技術棧、名詞對照，以及待決議事項。
