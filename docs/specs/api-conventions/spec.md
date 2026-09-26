# API 共用慣例（api-conventions）

**代碼**：`API`　**Phase**：全部　**狀態**：草稿
**前置規格**：無（`skeleton` 已完成，提供可掛載測試路由的後端骨架）
**引用意圖**：[PR-17](../../intents/02-principles.md#pr-17)、[PR-02](../../intents/02-principles.md#pr-02)、[KD-07](../../intents/03-decisions-and-stack.md#kd-07)、[KD-13](../../intents/03-decisions-and-stack.md#kd-13)、[KD-14](../../intents/03-decisions-and-stack.md#kd-14)、[KD-15](../../intents/03-decisions-and-stack.md#kd-15)
**被擋議題**：無

**關於開工門檻**：[05-open-questions.md §E〈開工門檻〉](../../intents/05-open-questions.md#gate)列出的 G-01～G-07、OQ-06 **不適用**本規格：這些議題全是資源層契約（interval 歸屬、原圖來源、上傳時序、報告核可、刪除保留、報告狀態機、Result 欄位），由各功能規格與 `domain-model` 的端點與資料模型承擔；本規格不定義任何資源端點，只定義跨端點共用的慣例（路徑前綴、內容型別、錯誤 envelope、分頁、時間格式、ID 表示法），不受該門檻約束（依據：負責人決定，PR #30，2026-09-26；另見 [05-open-questions.md §E 的澄清](../../intents/05-open-questions.md#gate)）。因此「被擋議題」維持「無」，索引欄維持「—」。

## 目的

所有 `/api/v1` 端點共用同一套路徑、內容型別、錯誤回應與 ID 表示慣例，讓不同規格各自實作端點時不必重新設計這些細節，也讓前端與未來的第三方整合者能用一致的方式處理成功與失敗回應（依據：架構基準 §14、§25）。

## 範圍

**包含**：

- `/api/v1` 路徑前綴與 REST 慣例（HTTP 方法、HTTP 狀態碼的使用方式）。
- 非上傳請求／回應本體的內容型別（JSON）。
- 檔案上傳的共用介面層慣例（`multipart/form-data`）。
- 統一的錯誤回應 envelope，含結構化 `error.code`（dot-namespace 命名，對照表由程式的錯誤碼列舉自動產生）。
- API 路徑與回應中主要實體 ID 的表示方式（UUID 字串）。
- 清單端點的分頁機制（cursor-based，排序鍵含 UUID）。
- 時間欄位的格式（ISO 8601／UTC／精度到秒）。

**不包含**（注明移到哪份規格，或屬於哪一條非目標）：

- 認證方式、Authorization 標頭與目前使用者判斷：移至 `authentication`。
- 檔案的實際儲存機制、Storage 抽象介面，以及上傳資源的儲存鍵（storage key）產生規則（例如以 UUID 產生、不以原始檔名當唯一識別）：屬 [PR-02](../../intents/02-principles.md#pr-02)／[KD-02](../../intents/03-decisions-and-stack.md#kd-02)，落地於各自需要儲存檔案的規格（例如未來的 `field-evidence`）。
- 個別端點的完整資料欄位、上傳欄位名稱、檔案張數與大小限制：屬各功能規格自己的「介面」段（例如 `field-evidence`）；本規格只規定「用 multipart」這條共用邊界。
- 分頁的預設／上限頁大小、清單回應 envelope 的完整形狀（例如是否需要 `meta`／`total` 等欄位）：intents 沒有依據，由第一個實作清單端點的功能規格決定；本規格只規定「cursor-based、排序鍵含 UUID 以保證穩定」（依據：[KD-13](../../intents/03-decisions-and-stack.md#kd-13)）。
- 時間欄位輸入端的解析寬鬆度（是否接受小數秒、`+08:00` 等時區偏移）：不在本規格範圍，之後另議（依據：[KD-14](../../intents/03-decisions-and-stack.md#kd-14)）。
- API 版本淘汰／`v2` 過渡流程：目前只有 `v1`，等真的需要第二版再處理。

## 使用情境

- 工程師新增一個 `/api/v1` 端點時，直接套用本規格的路徑前綴、JSON／multipart 慣例與 UUID ID 格式，不必每個端點重新設計。
- 工程師實作清單端點時，直接採用 cursor-based 分頁與統一的時間欄位格式，不必自己選擇分頁策略或時間精度。
- 工程師處理找不到資源、輸入不合法或未預期例外時，拋出共用的錯誤型別，由共用例外處理器轉成統一的 `error.code` envelope，不必在每個端點手刻錯誤回應，也不必自己決定 `error.code` 的命名法。
- 前端或未來的第三方整合者收到失敗回應時，讀 `error.code` 做程式化分支，不必解析錯誤訊息文字。

## 需求

用「必須／應／得」，每條附依據；來源只是建議的，不得寫成「必須」。

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| API-R01 | 所有 Backend API 端點的路徑**必須**以 `/api/v1` 為前綴，操作以 HTTP 方法表達 | 必須 | [PR-17](../../intents/02-principles.md#pr-17)（架構基準 §14） |
| API-R02 | API **必須**用 HTTP 狀態碼表達結果類別（2xx 成功、4xx 用戶端錯誤、5xx 伺服器錯誤）；**不得**一律回傳 200，只在回應本體標示失敗 | 必須 | [PR-17](../../intents/02-principles.md#pr-17)（REST 慣例，架構基準 §14） |
| API-R03 | 非檔案上傳的請求與回應本體**必須**使用 JSON（`Content-Type: application/json`） | 必須 | [PR-17](../../intents/02-principles.md#pr-17) |
| API-R04 | 接受檔案（例如照片）的端點**必須**使用 `multipart/form-data`；**不得**以 JSON 內嵌 base64 或其他編碼取代大型檔案上傳 | 必須 | [PR-17](../../intents/02-principles.md#pr-17) |
| API-R05 | API 錯誤回應**應**以 JSON 表示，並含巢狀欄位 `error.code`（非空字串，供程式化判斷用） | 應 | [PR-17](../../intents/02-principles.md#pr-17)（架構基準 §25） |
| API-R06 | API 路徑與回應中，`Project`、`User`、`Plan`、`Task`、`Evidence` 等主要實體的 ID **必須**以 UUID 字串表示；**不得**使用資料庫自增整數作為對外識別 | 必須 | [KD-07](../../intents/03-decisions-and-stack.md#kd-07) |
| API-R07 | `error.code` 的值**必須**採 dot-namespace 命名（`<resource>.<reason>`，例如 `task.not_found`）；不特定於單一資源的錯誤**必須**依錯誤性質歸入 `request.*`（請求本身的問題）、`resource.*`（不特定於某資源的通用資源錯誤）、`server.*`（伺服器端錯誤）三個共用 namespace 之一；對照表**必須**由程式的錯誤碼列舉自動產生，不手寫維護獨立文件 | 必須 | [KD-15](../../intents/03-decisions-and-stack.md#kd-15) |
| API-R08 | 清單端點的分頁**必須**採 cursor-based 分頁；排序與 cursor 使用的鍵**必須**包含 UUID，不得只靠時間欄位排序 | 必須 | [KD-13](../../intents/03-decisions-and-stack.md#kd-13) |
| API-R09 | API 回應中的時間欄位**必須**為 ISO 8601（RFC 3339）字串，一律 UTC 並帶 `Z` 後綴，精度到秒 | 必須 | [KD-14](../../intents/03-decisions-and-stack.md#kd-14) |

## 資料

本規格不建立資料庫或實體。API-R06 的 ID 格式規則供 `domain-model` 與其他建立實體的規格採用；本規格不定義任何實體自己的欄位。

## 介面

本規格是共用慣例，不新增產品端點；下表是所有 `/api/v1` 端點都要遵守的契約物件，取代模板中的「方法／路徑」表：

| 契約物件 | 內容 | 對應需求 |
|---|---|---|
| 路徑前綴 | `/api/v1` | API-R01 |
| 錯誤回應 envelope | `{"error": {"code": "<非空字串，dot-namespace 命名>"}}`；HTTP 狀態碼另依實際錯誤類別（4xx／5xx） | API-R02、API-R05、API-R07 |
| JSON 請求／回應 | `Content-Type: application/json` | API-R03 |
| 上傳請求 | `Content-Type: multipart/form-data` | API-R04 |
| 實體 ID | UUID 字串（例如 `550e8400-e29b-41d4-a716-446655440000`） | API-R06 |
| 分頁（清單端點） | cursor-based；cursor 視為不透明字串，排序鍵包含時間＋UUID | API-R08 |
| 時間欄位 | ISO 8601（RFC 3339）字串，UTC，`Z` 後綴，精度到秒（例如 `2026-09-26T08:30:00Z`） | API-R09 |

## 驗收條件

每條至少對應一個需求；每條都要能用測試或具體操作驗證。以下 AC 皆以自動化契約測試驗證，測試路由僅存在於測試模組中（不掛進正式 `app/main.py` 的路由表），用來在沒有實際業務端點前先證明共用慣例可行；日後第一個實作真實 multipart 上傳端點的規格（例如 `field-evidence`）**應**在自己的 `plan.md` 引用 API-AC06 補一份對真實端點的驗證。

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| API-AC01 | 後端已掛載的所有業務 API 路由（`fastapi.routing.APIRoute` 這類路由，不含框架自動產生的文件路由，例如 `/openapi.json`、`/docs`、`/docs/oauth2-redirect`、`/redoc`） | 檢查每條業務路由的路徑 | 全部以 `/api/v1/` 開頭 | API-R01 |
| API-AC02 | 已掛載的 API | 對一個不存在的資源路徑（例如 `/api/v1/does-not-exist`）發出 `GET` | 回應狀態碼為 404，不是 200 | API-R01、API-R02 |
| API-AC03 | 一個僅存在於測試中、刻意拋出未攔截例外的路由 | 呼叫該路由 | 回應狀態碼為 500，不是 200 加錯誤內容 | API-R02、API-R05 |
| API-AC04 | 任一非上傳端點的成功回應（例如 `GET /api/v1/health`） | 檢查回應標頭 | `Content-Type` 為 `application/json` | API-R03 |
| API-AC05 | 一個僅存在於測試中、非上傳的 JSON 端點 | 分別以非 JSON 的 `Content-Type`（例如 `text/plain`）與 `application/json` 送出同一請求本體 | 前者回應 4xx，且回應本體符合共用錯誤 envelope；後者被正確解析並成功處理 | API-R03 |
| API-AC06 | 一個僅存在於測試中、要求 `multipart/form-data` 上傳（`UploadFile` 參數）的路由 | 分別以 `multipart/form-data` 送出檔案、以 JSON 內嵌 base64 送出同一檔案 | 前者回應 2xx 且檔案被正常處理；後者因未提供必要的 multipart 欄位而回應 4xx，且回應本體符合共用錯誤 envelope | API-R04 |
| API-AC07 | 三個僅存在於測試中的路由，分別觸發驗證錯誤（422）、找不到資源（404）、未攔截例外（500） | 呼叫這三個路由 | 三種情況的回應本體都能解析出 `error.code`，其值為非空字串，且三者彼此不同；本 AC 驗證共用錯誤處理器的預設行為，個別端點**得**另行設計自己的錯誤回應 | API-R05 |
| API-AC08 | 一個回傳含實體 ID 欄位的測試回應 | 檢查該 ID 欄位的值 | 可被解析為合法 UUID（例如 `uuid.UUID(...)` 不拋例外），不是遞增整數 | API-R06 |
| API-AC09 | API-AC07 觸發的三個 `error.code` 值 | 檢查每個字串 | 皆符合 regex `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$`（dot-namespace） | API-R07 |
| API-AC10 | 一個由列舉產生對照表的生成函式（例如 `build_error_code_descriptions(enum_cls)`），以及一個臨時擴充或替換成員的測試專用列舉 | 分別對正式的 `ErrorCode` 列舉與該測試專用列舉呼叫同一生成函式 | 兩次輸出的鍵集合分別與各自列舉成員一一對應（新增成員即出現於輸出、移除成員即從輸出消失），證明對照表並非另行手寫固定內容；repo 內不存在與生成函式輸出不同步、獨立維護的手寫對照表檔 | API-R07 |
| API-AC11 | 一個僅存在於測試中、回傳時間欄位的測試路由，以及一個格式無效的時間字串範例（例如 `2026-99-99T99:99:99Z`） | 呼叫該路由取得回應時間欄位；另將無效範例字串交由同一套時間解析邏輯處理 | 回應的時間欄位可用 RFC 3339 解析器（例如 `datetime.fromisoformat` 或等效解析器）成功解析，且 `tzinfo` 對應 UTC（offset 為 0）、`microsecond == 0`、字串以 `Z` 結尾；無效範例字串則被判定為不合法（解析失敗，或未通過上述任一斷言） | API-R09 |
| API-AC12 | 一個僅存在於測試中、模擬同一秒建立多筆記錄並依「時間＋UUID」排序回傳清單的測試路由，初始資料已知 | 取得第一頁後，插入一筆排序鍵（時間＋UUID）落在已讀範圍內的新資料（同一秒、UUID 排序在已讀最後一筆之前），再依 cursor 翻完剩餘頁 | 原始資料每筆恰好出現一次（不重複也不遺漏）；且將 cursor 解碼後可驗證其綁定的是「時間＋UUID」而非位移（offset）——例如在已讀範圍之前增減資料筆數不影響下一頁的起點 | API-R08 |

## 待釐清

無。

## 變更紀錄

- 無（本規格尚未凍結）。
