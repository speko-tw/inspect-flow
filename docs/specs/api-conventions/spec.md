# API 共用慣例（api-conventions）

**代碼**：`API`　**Phase**：全部　**狀態**：草稿
**前置規格**：無（`skeleton` 已完成，提供可掛載測試路由的後端骨架）
**引用意圖**：[PR-17](../../intents/02-principles.md#pr-17)、[PR-02](../../intents/02-principles.md#pr-02)、[KD-07](../../intents/03-decisions-and-stack.md#kd-07)
**被擋議題**：無

## 目的

所有 `/api/v1` 端點共用同一套路徑、內容型別、錯誤回應與 ID 表示慣例，讓不同規格各自實作端點時不必重新設計這些細節，也讓前端與未來的第三方整合者能用一致的方式處理成功與失敗回應（依據：架構基準 §14、§25）。

## 範圍

**包含**：

- `/api/v1` 路徑前綴與 REST 慣例（資源路徑、HTTP 方法、HTTP 狀態碼的使用方式）。
- 非上傳請求／回應本體的內容型別（JSON）。
- 檔案上傳的共用介面層慣例（`multipart/form-data`；上傳端點回應不得回傳原始位元組或以原始檔名當識別碼）。
- 統一的錯誤回應 envelope，含結構化 `error.code`。
- API 路徑與回應中主要實體 ID 的表示方式（UUID 字串）。

**不包含**（注明移到哪份規格，或屬於哪一條非目標）：

- 認證方式、Authorization 標頭與目前使用者判斷：移至 `authentication`。
- 檔案的實際儲存機制、Storage 抽象介面：屬 [PR-02](../../intents/02-principles.md#pr-02)／[KD-02](../../intents/03-decisions-and-stack.md#kd-02)，落地於各自需要儲存檔案的規格（例如未來的 `field-evidence`）。
- 個別端點的完整資料欄位、上傳欄位名稱、檔案張數與大小限制：屬各功能規格自己的「介面」段（例如 `field-evidence`）；本規格只規定「用 multipart、回應不吐原始檔案」這條共用邊界。
- 分頁機制、時間戳格式、`error.code` 的具體命名法與登錄方式：intents 沒有依據，不由本規格自行定案，見〈待釐清〉。
- API 版本淘汰／`v2` 過渡流程：目前只有 `v1`，等真的需要第二版再處理。

## 使用情境

- 工程師新增一個 `/api/v1` 端點時，直接套用本規格的路徑前綴、JSON／multipart 慣例與 UUID ID 格式，不必每個端點重新設計。
- 工程師處理找不到資源、輸入不合法或未預期例外時，拋出共用的錯誤型別，由共用例外處理器轉成統一的 `error.code` envelope，不必在每個端點手刻錯誤回應。
- 前端或未來的第三方整合者收到失敗回應時，讀 `error.code` 做程式化分支，不必解析錯誤訊息文字。

## 需求

用「必須／應／得」，每條附依據；來源只是建議的，不得寫成「必須」。

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| API-R01 | 所有 Backend API 端點的路徑**必須**以 `/api/v1` 為前綴；資源**必須**用（複數）名詞路徑表示，操作以 HTTP 方法表達，路徑中**不得**放動詞（例如 `/getTask`） | 必須 | [PR-17](../../intents/02-principles.md#pr-17)（架構基準 §14） |
| API-R02 | API **必須**用 HTTP 狀態碼表達結果類別（2xx 成功、4xx 用戶端錯誤、5xx 伺服器錯誤）；**不得**一律回傳 200，只在回應本體標示失敗 | 必須 | [PR-17](../../intents/02-principles.md#pr-17)（REST 慣例，架構基準 §14） |
| API-R03 | 非檔案上傳的請求與回應本體**必須**使用 JSON（`Content-Type: application/json`） | 必須 | [PR-17](../../intents/02-principles.md#pr-17) |
| API-R04 | 接受檔案（例如照片）的端點**必須**使用 `multipart/form-data`；**不得**以 JSON 內嵌 base64 或其他編碼取代大型檔案上傳 | 必須 | [PR-17](../../intents/02-principles.md#pr-17) |
| API-R05 | 上傳端點的回應**不得**回傳檔案原始位元組，也**不得**以使用者上傳時的原始檔名作為資源識別；**必須**回傳後端產生的資源 ID 與 metadata | 必須 | [PR-02](../../intents/02-principles.md#pr-02) |
| API-R06 | API 錯誤回應**應**以 JSON 表示，並含巢狀欄位 `error.code`（非空字串，供程式化判斷用）；**不得**只用錯誤訊息文字替代結構化的 `error.code` | 應 | [PR-17](../../intents/02-principles.md#pr-17)（架構基準 §25） |
| API-R07 | API 路徑與回應中，`Project`、`User`、`Plan`、`Task`、`Evidence` 等主要實體的 ID **必須**以 UUID 字串表示；**不得**使用資料庫自增整數作為對外識別 | 必須 | [KD-07](../../intents/03-decisions-and-stack.md#kd-07) |

## 資料

本規格不建立資料庫或實體。API-R07 的 ID 格式規則供 `domain-model` 與其他建立實體的規格採用；本規格不定義任何實體自己的欄位。

## 介面

本規格是共用慣例，不新增產品端點；下表是所有 `/api/v1` 端點都要遵守的契約物件，取代模板中的「方法／路徑」表：

| 契約物件 | 內容 | 對應需求 |
|---|---|---|
| 路徑前綴 | `/api/v1` | API-R01 |
| 錯誤回應 envelope | `{"error": {"code": "<非空字串>"}}`；HTTP 狀態碼另依實際錯誤類別（4xx／5xx） | API-R02、API-R06 |
| JSON 請求／回應 | `Content-Type: application/json` | API-R03 |
| 上傳請求 | `Content-Type: multipart/form-data`；回應只含後端產生的 ID 與 metadata | API-R04、API-R05 |
| 實體 ID | UUID 字串（例如 `550e8400-e29b-41d4-a716-446655440000`） | API-R07 |

## 驗收條件

每條至少對應一個需求；每條都要能用測試或具體操作驗證。以下 AC 皆以自動化契約測試驗證，測試路由僅存在於測試模組中（不掛進正式 `app/main.py` 的路由表），用來在沒有實際業務端點前先證明共用慣例可行；日後第一個實作真實 multipart 上傳端點的規格（例如 `field-evidence`）**應**在自己的 `plan.md` 引用 API-AC05、API-AC06 補一份對真實端點的驗證。

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| API-AC01 | 後端已掛載的所有正式路由 | 檢查每條路由的路徑 | 全部以 `/api/v1/` 開頭 | API-R01 |
| API-AC02 | 已掛載的 API | 對一個不存在的資源路徑（例如 `/api/v1/does-not-exist`）發出 `GET` | 回應狀態碼為 404，不是 200 | API-R01、API-R02 |
| API-AC03 | 一個僅存在於測試中、刻意拋出未攔截例外的路由 | 呼叫該路由 | 回應狀態碼為 500，不是 200 加錯誤內容 | API-R02、API-R06 |
| API-AC04 | 任一非上傳端點的成功回應（例如 `GET /api/v1/health`） | 檢查回應標頭 | `Content-Type` 為 `application/json` | API-R03 |
| API-AC05 | 一個僅存在於測試中、模擬檔案上傳的路由 | 分別以 `multipart/form-data` 送出檔案、以 JSON 內嵌 base64 送出同一檔案 | 前者被正常處理；後者回應 415，且回應本體符合 API-AC07 的統一格式 | API-R04 |
| API-AC06 | 同一個測試用上傳路由，以 `multipart/form-data` 上傳成功 | 檢查回應本體 | 只含後端產生的資源 ID 與 metadata；找不到請求中的原始檔名字串被當成 ID 使用 | API-R05 |
| API-AC07 | 三個僅存在於測試中的路由，分別觸發驗證錯誤（422）、找不到資源（404）、未攔截例外（500） | 呼叫這三個路由 | 三種情況的回應本體都能解析出 `error.code`，其值為非空字串，且三者彼此不同 | API-R06 |
| API-AC08 | 一個回傳含實體 ID 欄位的測試回應 | 檢查該 ID 欄位的值 | 可被解析為合法 UUID（例如 `uuid.UUID(...)` 不拋例外），不是遞增整數 | API-R07 |

## 待釐清

以下慣例 intents 沒有依據，本規格不自行定案；待團隊決定後另開規格澄清或範圍變更更新本文件：

- **分頁機制**：cursor-based 或 offset/limit、預設與上限頁大小、清單回應是否需要 `meta`／`total` 等欄位——intents 未提及分頁。
- **時間戳格式**：是否強制 ISO 8601、是否強制 UTC 與 `Z` 後綴、精度到秒或毫秒——intents 未提及時間格式。
- **`error.code` 的命名法與登錄方式**：例如 dot-namespace（`resource.reason`）或 SCREAMING_SNAKE_CASE 全域列舉；是否需要一份集中對照表文件與由誰維護——[PR-17](../../intents/02-principles.md#pr-17) 只要求「結構化的 `error.code`」，未定義命名法或登錄機制。

## 變更紀錄

- 無（本規格尚未凍結）。
