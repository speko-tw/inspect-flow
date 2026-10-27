# 簡易試用部署：實作計畫

**規格**：[spec.md](spec.md)

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1 | 打包靜態服務與 login cookie 設定 | `backend/app/main.py`、`backend/app/static_files.py`、`backend/app/api/no_store.py`、`backend/app/auth/`、`backend/tests/` | — | DPL-AC04、DPL-AC05 | #758 |
| T2 | 建立 image、Compose storage、首次設定流程、發布 workflow 與不啟動 daemon 的 Compose config 檢查 | `Dockerfile`、`.dockerignore`、`compose.yaml`、`deploy/.env.example`、`backend/app/cli/ensure_initial_setup.py`、`.github/workflows/publish-image.yml`、`scripts/check-compose-config.py`、`.github/workflows/ci.yml` | T1 | DPL-AC01～DPL-AC03、DPL-AC07、DPL-AC08 | #758 |
| T3 | 撰寫安裝手冊、精簡規格與版本治理同步 | `docs/deployment/pilot-install.md`、`docs/specs/pilot-install/`、`docs/specs/README.md`、`docs/intents/06-versioning-and-milestone-governance.md`、`README.md`、`README.zh-TW.md`、`.env.example` | T1、T2 | DPL-AC06、DPL-AC07、DPL-AC08 | #758 |
| T4 | 執行期路徑與 Nginx HTTPS、停機備份及安全回滾驗收 | `deploy/nginx/*`、`frontend/index.html`、`frontend/src/**`、`frontend/vite.config.ts`、`scripts/check-pilot-browser.mjs`、`docs/deployment/pilot-install.md` | T1、T2、T3 | DPL-AC09、DPL-AC10 | #758 |

## 並行分組

- 第 1 波：T1。
- 第 2 波：T2。
- 第 3 波：T3。
- 第 4 波：T4；沿用前波文件與程式進行驗收。

## 風險

- 首次設定服務需避免一般重啟時廢止尚未使用的有效設定碼；以現有 `SetupCode` 到期與 `UserPassword` 狀態判斷。
- `/` 的靜態 fallback 必須讓未知 `/api` 與不存在的檔案維持 404。
- 綁定主機資料夾時，容器以 UID/GID 999 執行；主機目錄須先授予該 UID/GID 存取權。
- 照片上傳功能尚未在來源分支實作；`/uploads` 只預留具名 volume，不聲稱完成照片持久化。

## 驗證（Proof）

| AC | 驗證方式 |
|---|---|
| DPL-AC01 | `docker build`；`docker image inspect` 與容器內 `id`。 |
| DPL-AC02 | `docker compose up -d`、migration/init/app logs、healthcheck 狀態。 |
| DPL-AC03 | 檢查首次設定碼、重啟確認碼未替換、設定 admin 密碼及登入。 |
| DPL-AC04 | curl 首頁、SPA 深路由、未知 API、`sw.js`；檢查 Cache-Control。 |
| DPL-AC05 | 既有 `backend/tests/auth/test_setup_api.py` 的 AUT-R12 安全屬性測試、完整後端測試與兩種 HTTPS 模式的 cookie 驗收。 |
| DPL-AC06 | 建立專案，確認資料在 down/up 及換 image tag 後仍可讀。 |
| DPL-AC07 | bind 模式對指定 worktree 的 `.pilot-test/bind/`，用 `127.0.0.1` 非預設 port 驗證寫入、權限與重啟讀回。 |
| DPL-AC08 | `actionlint`（若可用）或 workflow 靜態設定檢查；不觸發 workflow。 |
| DPL-AC09 | 同一 image 以 `scripts/check-pilot-browser.mjs` 驗根目錄與子路徑 HTTPS；檢查代理 IP、Secure cookie、UI 與資源。 |
| DPL-AC10 | 停機備份先寫 `.part` 並驗 gzip；以截斷檔確認還原在刪除前停止，正常還原後切回舊 image 才啟動。 |
| Compose config | `python3 scripts/check-compose-config.py` 驗證 default/bind render JSON；不需要 Docker daemon。 |

## 範圍調整紀錄

- 負責人 2026-10-27 指示：簡易 Docker 試用部署提前至 0.6.x；照片上傳改以現有資料寫入驗證持久性，照片 API 待 field-evidence 完成後驗收；新增主機 port、bind address 與 bind mount 驗收。

## 考慮過但沒採用的做法

- 單一 image 由 FastAPI 提供前端，避免另維護 proxy 服務與跨服務 `/api` 路由設定；正式 HTTPS 維運仍由 0.9.x 處理。

## 第 2 輪補強（負責人 2026-10-28 指示）

- 靜態掛載集中於 static_files.py，GET／HEAD fallback 避開 API，保留 405。
- Runtime base path 注入 HTML meta 及資源網址；Router basename、三個 API 入口與 manifest 共用部署前綴。cookie Path=/ 遵守 AUT-R12；service worker 維持停用。
- 單一 compose.yaml 切換 storage；預設固定具名 volume；bind 先建目錄；停機 tar 備份及還原同時涵蓋 /data、/uploads。
- 新增根目錄／子路徑 Nginx 範例與 `scripts/check-pilot-browser.mjs` HTTPS 瀏覽器驗收。
- DPL-AC09：同 image 的兩種 Nginx HTTPS 模式，含 UI 與資源狀態。
- DPL-AC10：備份前資料、變更後資料、還原後資料三階段實測。
- 首次設定補四分支單元測試；CI 驗 Compose 並 build image、health smoke，不 push。
- 完整驗收及實際證據路徑：`/Users/kavy/.local/state/inspect-flow-handoff/codex-reports/w-758-r3.md`；原始 log 放同目錄的 `w-758-r3-evidence/`。

- 第 3 輪依負責人指示將原 AC09～AC11 重編為 AC08～AC10，消除缺號；T4 與 Proof 涵蓋原 AC10／AC11。
