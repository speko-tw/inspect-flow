# 簡易試用部署規格

**代碼**：DPL　**Phase**：P6（自 P9 提前）　**狀態**：草稿

**前置規格**：`skeleton`、`authentication`

**引用意圖**：PR-13、PR-14、KD-08、KD-09、KD-30

**被擋議題**：無

## 目的

維護者能以 Docker Compose 在單一 Linux x86_64 主機啟動試用系統，並在重啟及更新 image 後保留資料。簡易部署依負責人指示提前納入 0.6.x；正式 HTTPS、自動備份與完整維運仍在 0.9.x（依據：架構基準 §22.1–22.20）。

## 範圍

**包含**：

- 多階段建置前端與後端 image，使用非 root 帳號執行，平台為 `linux/amd64`。
- Compose migration、首次設定、API 與 health check；SQLite 與預留的上傳目錄使用具名 volume，也可由同一份 Compose 與 `.env` 改為主機資料夾。
- 由 `.env` 設定主機 port 與綁定位址；容器 port 固定。
- FastAPI 提供 SPA 靜態檔、深層路由 fallback、PWA 快取標頭與 `/api` 路由隔離。
- 固定安全 login cookie、Nginx HTTPS 與執行期子路徑與手動 image 發布 workflow。
- 中文安裝說明及以現有可寫入資料驗證重啟、更新後持久性。

**不包含**：

- 照片上傳 API／畫面：待 0.6.x `field-evidence` 功能完成後另驗收，見 [field-evidence 規格](../field-evidence/spec.md)。
- 正式 HTTPS 憑證管理、自動備份與完整部署 DoD：留在 0.9.x、#109。

## 使用情境

- 維護者依安裝說明在 Linux x86_64 主機啟動系統、設定首次 admin 密碼、建立資料並更新版本。
- 試用人員經公司 VPN 以 Nginx HTTPS 登入，可掛在網域根目錄或子路徑。

## 需求

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| DPL-R01 | image 必須以多階段建置，並以非 root 使用者提供 API 與前端靜態檔。 | 必須 | #758、KD-09 |
| DPL-R02 | 更新前必須備份並停止舊版寫入；Compose 必須先成功套用 migration，再初始化及啟動 API；失敗須停機還原備份與舊版。資料預設存於具名 volume。 | 必須 | PR-13、KD-08、#758 |
| DPL-R03 | 有效首次設定碼必須跨一般重啟保留；設定完成後不得再次簽發設定碼。 | 必須 | #758、authentication AUT-R42～AUT-R45 |
| DPL-R04 | login cookie 必須永遠維持 `Secure`、`HttpOnly`、`SameSite=Strict`、`__Host-` 與 `Path=/`；不得提供關閉設定。 | 必須 | KD-30、#758 |
| DPL-R05 | 主機 port 與綁定位址必須由 `.env` 設定；資料目錄可選具名 volume 或 bind mount，bind mount 由同一 Compose 讀取 `.env` 的主機路徑。 | 必須 | #758、負責人指示（2026-10-27） |
| DPL-R06 | SPA 深層路由必須提供 `index.html`；未知 `/api` 路徑不得回傳前端頁面；`index.html` 與 `sw.js` 不得長期快取。 | 必須 | #758 |
| DPL-R07 | 發布 workflow 必須只建置 `linux/amd64`；v-tag push 發布去除 `v` 的版本標籤，只有完整 `vX.Y.Z` 更新 `latest`；手動 tag 不得為 `latest` 或以數字三段版本開頭。 | 必須 | #758 |
| DPL-R08 | SQLite 與預留的上傳路徑必須在 down/up、換 image 與 bind mount 重啟後保留資料。照片上傳功能尚未提供時另列未驗收。 | 必須 | KD-08、#758、負責人指示（2026-10-27） |

| DPL-R09 | 同一 image 必須由執行期 `INSPECTFLOW_BASE_PATH` 支援根目錄及子路徑；Nginx 剝除前綴，入口資源、Router、API 與 manifest 必須一致。靜態 fallback 只處理 GET／HEAD，保留 API 405。 | 必須 | #758、負責人指示（2026-10-28） |

## 資料

本規格不新增資料實體。SQLite 預設檔案位置為 `/data/inspectflow.db`；預留的上傳 volume 掛載至 `/uploads`，待 `field-evidence` 啟用實際儲存路徑。

## 介面

| 方法 | 路徑 | 用途 | 權限 |
|---|---|---|---|
| GET | `/`、SPA client routes | 靜態前端；未命中的 client route 回傳 `index.html` | 公開 |
| GET | `/api/v1/health` | Compose 健康檢查 | 公開 |
| Compose | 根目錄 `compose.yaml` | migration、初始化與 API 服務 | 主機管理者 |

## 驗收條件

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| DPL-AC01 | 乾淨建置環境 | 建置 image 並檢查執行身份 | image 含前端 build、API 依賴，程序非 root | DPL-R01 |
| DPL-AC02 | 空資料 volume | 執行 Compose 啟動 | migration 成功後才啟動初始化與 API；healthcheck healthy | DPL-R02 |
| DPL-AC03 | 初次啟動尚未設定 admin | 讀取初始化服務 logs，再重啟 | 顯示一次設定碼；有效設定碼不因重啟而被替換；設定完成後不再簽發 | DPL-R03 |
| DPL-AC04 | 已建置前端 | 開啟首頁、`/projects/new` 與未知 `/api` 路徑 | SPA 頁面可重新整理；未知 API 回 404；`index.html`、`sw.js` 不可長期快取 | DPL-R06 |
| DPL-AC05 | 根目錄及子路徑 HTTPS 設定 | 分別登入與登出 | cookie 固定為 Secure、HttpOnly、SameSite Strict、__Host-、Path=/，登出可清除 | DPL-R04 |
| DPL-AC06 | 已建立專案、公司等資料 | `down`/`up` 並更換 image tag | migration 自動執行，API 可讀回原資料，具名 volume 持續存在 | DPL-R02、DPL-R08 |
| DPL-AC07 | 主機資料夾已設為容器 UID/GID 可寫 | 以 bind 模式 在非預設 port 啟動、寫入資料，再 `down`/`up` | 服務健康、資料仍可讀，容器仍以非 root 身份執行 | DPL-R05、DPL-R08 |
| DPL-AC09 | workflow 定義完成 | 靜態檢查 workflow | v-tag/manual tag 驗證正確，只有完整穩定版 v-tag 更新 `latest`，平台限定 amd64；不觸發發布 | DPL-R07 |

| DPL-AC10 | 同一 image | 以 Nginx HTTPS 分別代理根目錄及 `/inspectflow/` | 首頁、深層網址、設定、登入、登出、建立專案及資源載入成功；cookie Secure；manifest 前綴一致 | DPL-R04、DPL-R09 |
| DPL-AC11 | 已建資料 | 停機備份、變更資料、再還原 | 還原後可讀回原資料，更新先停舊版，migration 成功才啟動 | DPL-R02、DPL-R08 |

目前不註冊 service worker；沿用既有停用策略，不宣稱離線可用。cookie 維持 Path=/ 以符合 __Host- 限制；同一網域僅部署一份。完整 `pilot-deployment` 仍在 0.9.x，本規格僅為精簡子集。

## 待釐清

- 無。照片上傳依賴 `field-evidence`，不是本規格的驗收條件。

## 變更紀錄

- 範圍變更（負責人指示，2026-10-27，[#758](https://github.com/speko-tw/inspect-flow/issues/758)）：簡易部署提前至 0.6.x；照片 AC 改以其他產品資料寫入與重啟／換版持久性驗證，照片功能完成後另驗收；新增可設定主機連接埠、綁定位址與 bind mount。

- 負責人 2026-10-28 裁定（#758）：移除不安全 cookie 開關、採既有 Nginx 處理公司憑證、加入執行期子路徑與停機備份還原。作廢 Caddy 與 uvicorn TLS 方案。
