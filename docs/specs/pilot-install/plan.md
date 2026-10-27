# 簡易試用部署：實作計畫

**規格**：[spec.md](spec.md)

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1 | 打包靜態服務與 login cookie 設定 | `backend/app/main.py`、`backend/app/static_files.py`、`backend/app/api/no_store.py`、`backend/app/auth/`、`backend/app/api/v1/auth.py`、`backend/tests/` | — | DPL-AC04、DPL-AC05 | #758 |
| T2 | 建立 image、Compose storage overlay、首次設定流程、發布 workflow 與不啟動 daemon 的 Compose config 檢查 | `Dockerfile`、`.dockerignore`、`compose.yaml`、`compose.bind.yaml`、`.env.example`、`backend/app/cli/ensure_initial_setup.py`、`.github/workflows/publish-image.yml`、`scripts/check-compose-config.py` | T1 | DPL-AC01～DPL-AC03、DPL-AC07、DPL-AC09 | #758 |
| T3 | 撰寫安裝手冊、精簡規格與版本治理同步 | `docs/deployment/pilot-install.md`、`docs/specs/pilot-install/`、`docs/specs/README.md`、`docs/intents/06-versioning-and-milestone-governance.md`、`README.md`、`README.zh-TW.md` | T1、T2 | DPL-AC06～DPL-AC09 | #758 |

## 並行分組

- 第 1 波：T1。
- 第 2 波：T2、T3；兩者修改的檔案互不重疊。

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
| DPL-AC05 | `backend/tests/auth/test_cookie_secure.py` 與完整後端測試。 |
| DPL-AC06 | 建立專案、公司，確認資料在 down/up 及換 image tag 後仍可讀。 |
| DPL-AC07 | bind overlay 對 `/private/tmp/w758-*`，用 `127.0.0.1` 非預設 port 驗證寫入、權限與重啟讀回。 |
| DPL-AC08 | Field UI 與 API 原始碼盤點；照片上傳個別 deferred/NOT_RUN。 |
| DPL-AC09 | `actionlint`（若可用）或 workflow 靜態設定檢查；不觸發 workflow。 |
| Compose config | `python3 scripts/check-compose-config.py` 驗證 default/bind render JSON；不需要 Docker daemon。 |

## 範圍調整紀錄

- 負責人 2026-10-27 指示：簡易 Docker 試用部署提前至 0.6.x；照片上傳改以現有資料寫入驗證持久性，照片 API 待 field-evidence 完成後驗收；新增主機 port、bind address 與 bind mount 驗收。

## 考慮過但沒採用的做法

- 單一 image 由 FastAPI 提供前端，避免另維護 proxy 服務與跨服務 `/api` 路由設定；正式 HTTPS 維運仍由 0.9.x 處理。
