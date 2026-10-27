# 簡易試用部署規格

**代碼**：DPL　**Phase**：P9　**狀態**：草稿

**前置規格**：`skeleton`、`authentication`、`field-evidence`

**引用意圖**：PR-13、PR-14、KD-08、KD-09、KD-30

**被擋議題**：無

## 目的

維護者能以 Docker Compose 在單一 Linux x86_64 主機啟動試用系統，並在重啟及更新 image 後保留資料。簡易部署依負責人指示提前納入 0.6.x；正式 HTTPS、自動備份與完整維運仍在 0.9.x（依據：架構基準 §22.1–22.20）。

## 範圍

**包含**：

- 多階段建置前端與後端 image，使用非 root 帳號執行，平台為 `linux/amd64`。
- Compose migration、首次設定、API 與 health check；SQLite 與預留的上傳目錄使用具名 volume，也可用 overlay 改為主機資料夾。
- 由 `.env` 設定主機 port 與綁定位址；容器 port 固定。
- FastAPI 提供 SPA 靜態檔、深層路由 fallback、PWA 快取標頭與 `/api` 路由隔離。
- 可控制 login cookie 的 Secure 屬性與手動 image 發布 workflow。
- 中文安裝說明及以現有可寫入資料驗證重啟、更新後持久性。

**不包含**：

- 照片上傳 API／畫面：待 0.6.x `field-evidence` 功能完成後另驗收，見 [field-evidence 規格](../field-evidence/spec.md)。
- 正式 HTTPS 憑證管理、自動備份與完整部署 DoD：留在 0.9.x、#109。

## 使用情境

- 維護者依安裝說明在 Linux x86_64 主機啟動系統、設定首次 admin 密碼、建立資料並更新版本。
- 試用人員以內網 HTTP 登入；只有受限內網測試才能停用 cookie 的 Secure 屬性。

## 需求

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| DPL-R01 | image 必須以多階段建置，並以非 root 使用者提供 API 與前端靜態檔。 | 必須 | #758、KD-09 |
| DPL-R02 | Compose 必須先成功套用 Alembic migration，再初始化首次設定並啟動 API；資料必須預設存於具名 volume。 | 必須 | PR-13、KD-08、#758 |
| DPL-R03 | 有效首次設定碼必須跨一般重啟保留；設定完成後不得再次簽發設定碼。 | 必須 | #758、authentication AUT-R42～AUT-R45 |
| DPL-R04 | 未設定時 login cookie 必須維持 `Secure` 與 `SameSite=Strict`；受限 HTTP 測試可明確停用 `Secure`。 | 必須 | KD-30、#758 |
| DPL-R05 | 主機 port 與綁定位址必須由 `.env` 設定；資料目錄可選具名 volume 或 bind mount，bind mount 由 overlay 指定主機路徑。 | 必須 | #758、負責人指示（2026-10-27） |
| DPL-R06 | SPA 深層路由必須提供 `index.html`；未知 `/api` 路徑不得回傳前端頁面；`index.html` 與 `sw.js` 不得長期快取。 | 必須 | #758 |
| DPL-R07 | 發布 workflow 必須只建置 `linux/amd64`；v-tag push 發布去除 `v` 的版本標籤與 `latest`，手動 tag 不得覆蓋 `latest`。 | 必須 | #758 |
| DPL-R08 | SQLite 與預留的上傳路徑必須在 down/up、換 image 與 bind mount 重啟後保留資料。照片上傳功能尚未提供時另列未驗收。 | 必須 | KD-08、#758、負責人指示（2026-10-27） |

## 資料

本規格不新增資料實體。SQLite 預設檔案位置為 `/data/inspectflow.db`；預留的上傳 volume 掛載至 `/uploads`，待 `field-evidence` 啟用實際儲存路徑。

## 介面

| 方法 | 路徑 | 用途 | 權限 |
|---|---|---|---|
| GET | `/`、SPA client routes | 靜態前端；未命中的 client route 回傳 `index.html` | 公開 |
| GET | `/api/v1/health` | Compose 健康檢查 | 公開 |
| Compose | 根目錄 `compose.yaml` | migration、初始化與 API 服務 | 主機管理者 |
| Compose overlay | 根目錄 `compose.bind.yaml` | 把資料 volume 改為主機資料夾 | 主機管理者 |

## 驗收條件

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| DPL-AC01 | 乾淨建置環境 | 建置 image 並檢查執行身份 | image 含前端 build、API 依賴，程序非 root | DPL-R01 |
| DPL-AC02 | 空資料 volume | 執行 Compose 啟動 | migration 成功後才啟動初始化與 API；healthcheck healthy | DPL-R02 |
| DPL-AC03 | 初次啟動尚未設定 admin | 讀取初始化服務 logs，再重啟 | 顯示一次設定碼；有效設定碼不因重啟而被替換；設定完成後不再簽發 | DPL-R03 |
| DPL-AC04 | 已建置前端 | 開啟首頁、`/projects/new` 與未知 `/api` 路徑 | SPA 頁面可重新整理；未知 API 回 404；`index.html`、`sw.js` 不可長期快取 | DPL-R06 |
| DPL-AC05 | Secure 預設及 HTTP 測試設定 | 分別登入與登出 | 預設 cookie 為 Secure、SameSite Strict；明確關閉 Secure 後可用一般 cookie 登入及登出 | DPL-R04 |
| DPL-AC06 | 已建立專案、公司等資料 | `down`/`up` 並更換 image tag | migration 自動執行，API 可讀回原資料，具名 volume 持續存在 | DPL-R02、DPL-R08 |
| DPL-AC07 | 主機資料夾已設為容器 UID/GID 可寫 | 以 bind overlay 在非預設 port 啟動、寫入資料，再 `down`/`up` | 服務健康、資料仍可讀，容器仍以非 root 身份執行 | DPL-R05、DPL-R08 |
| DPL-AC08 | 照片上傳功能尚未完成 | 嘗試照片 API 驗收 | 標示 deferred/NOT_RUN，不以其他檔案寫入冒稱照片上傳通過 | DPL-R08 |
| DPL-AC09 | workflow 定義完成 | 靜態檢查 workflow | v-tag/manual tag 驗證正確，只有 v-tag 更新 `latest`，平台限定 amd64；不觸發發布 | DPL-R07 |

## 待釐清

- 無。照片上傳依賴 `field-evidence`，不是本規格的驗收條件。

## 變更紀錄

- 範圍變更（負責人指示，2026-10-27，[#758](https://github.com/speko-tw/inspect-flow/issues/758)）：簡易部署提前至 0.6.x；照片 AC 改以其他產品資料寫入與重啟／換版持久性驗證，照片功能完成後另驗收；新增可設定主機連接埠、綁定位址與 bind mount。
