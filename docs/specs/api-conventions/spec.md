# API 共用慣例（api-conventions）

**代碼**：`API`　**Phase**：全部　**狀態**：已完成
**前置規格**：無（`skeleton` 已完成，提供可掛載測試路由的後端骨架）
**引用意圖**：[PR-17](../../intents/02-principles.md#pr-17)、[PR-02](../../intents/02-principles.md#pr-02)、[PR-19](../../intents/02-principles.md#pr-19)、[KD-07](../../intents/03-decisions-and-stack.md#kd-07)、[KD-13](../../intents/03-decisions-and-stack.md#kd-13)、[KD-14](../../intents/03-decisions-and-stack.md#kd-14)、[KD-15](../../intents/03-decisions-and-stack.md#kd-15)
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
- 可選的欄位層級錯誤 `error.fields`：欄位路徑格式、欄位錯誤碼、使用範圍，以及不得回傳原始輸入值（[#432](https://github.com/speko-tw/inspect-flow/issues/432)）。
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
- 各端點實際採用 `error.fields` 時的欄位路徑與資源專屬欄位錯誤碼：屬各功能規格自己的「介面」段；範本 API 先採用（見 [`template-system`](../template-system/spec.md) 的 TPL-R24）。請求本文以外的來源（query、path、header）的欄位錯誤：本規格暫不定義，有需要時另議。
- 前端各表單如何顯示欄位錯誤：屬各畫面所在的功能規格（範本管理見 TPL-R18）；本規格只定義伺服器端回應的契約。

## 使用情境

- 工程師新增一個 `/api/v1` 端點時，直接套用本規格的路徑前綴、JSON／multipart 慣例與 UUID ID 格式，不必每個端點重新設計。
- 工程師實作清單端點時，直接採用 cursor-based 分頁與統一的時間欄位格式，不必自己選擇分頁策略或時間精度。
- 工程師處理找不到資源、輸入不合法或未預期例外時，拋出共用的錯誤型別，由共用例外處理器轉成統一的 `error.code` envelope，不必在每個端點手刻錯誤回應，也不必自己決定 `error.code` 的命名法。
- 前端或未來的第三方整合者收到失敗回應時，讀 `error.code` 做程式化分支，不必解析錯誤訊息文字。
- 前端送出表單後收到 422，若回應帶 `error.fields`，就在對應欄位旁顯示錯誤並聚焦第一個錯誤；沒有 `fields` 時顯示一般提示並保留使用者輸入。

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
| API-R10 | 422 回應（請求本文驗證失敗）**得**含可選的 `error.fields`：陣列，每筆 `{"path": "<JSON Pointer>", "code": "<欄位錯誤碼>"}`，指出能確定的欄位。**只**有能確定欄位的 422 才回傳（請求模型驗證、服務層已知的驗證錯誤）；資料庫約束等無法對應欄位的 422 維持只有 `error.code`，**不得**為了湊欄位而推測；`fields` **不得**出現在 422 以外的狀態碼。同一 path 與同一 code 的錯誤只列一筆，去重在套用 100 筆上限之前（重複項不占用額度）；單次回應最多 100 筆，順序為請求本文中的出現順序（陣列依索引，物件欄位依 API 結構定義的順序，同一請求每次相同），超過者省略；用戶端聚焦第一個錯誤時以畫面順序為準，不依 `fields` 的順序 | 得／不得 | [#432](https://github.com/speko-tw/inspect-flow/issues/432) 內文（範圍段）；只用在 422、筆數上限與順序為規格設計（非負責人裁定） |
| API-R11 | `path` **必須**是 [RFC 6901](https://www.rfc-editor.org/rfc/rfc6901) JSON Pointer，相對於請求本文（JSON 物件）的根：欄位名稱與陣列索引（從 0 起）以 `/` 分隔，例如 `/inspection_points/1/measurement_fields/0/unit`；名稱中的 `~`、`/` 依 RFC 6901 轉義為 `~0`、`~1`；空字串代表整個請求本文。路徑指到有問題的那個欄位；規則涉及整個物件時指到該物件；規則涉及重複（例如 `sequence` 重複）時，所有取值重複的項目（含第一個）各一筆。路徑中的名稱**必須**是請求模型定義的欄位名：`loc` 中不是請求模型定義的片段（`extra_forbidden` 的鍵、union 分支標籤、`[key]` 這類）與使用者輸入的動態鍵，一律停在上一層，`code` 用 `field.invalid`，**不得**把它們放進 `path` | 必須／不得 | [#432](https://github.com/speko-tw/inspect-flow/issues/432) 內文（範圍段）；格式選擇為規格設計（非負責人裁定），理由見〈介面〉的路徑格式說明 |
| API-R12 | `fields[].code` **必須**是非空字串，命名法同 [KD-15](../../intents/03-decisions-and-stack.md#kd-15)（`<resource>.<reason>`）；它是獨立於 `error.code` 的代碼空間，**不受** [API-R07](#需求) 三個共用 namespace 的限制：共用原因統一用 `field.*`（最小集合為 `field.required`、`field.invalid`、`field.too_long`、`field.too_short`、`field.out_of_range`、`field.duplicate`，最終成員以程式的列舉為準），資源專屬原因用 `<resource>.<reason>`；對照表**必須**由程式的欄位錯誤碼列舉自動產生（與 `ErrorCode` 分開的列舉），不手寫維護；用戶端依 `code` 決定顯示文案，**不得**解析訊息文字 | 必須／不得 | [KD-15](../../intents/03-decisions-and-stack.md#kd-15)；[#432](https://github.com/speko-tw/inspect-flow/issues/432) 內文（範圍段）；`field.*` 最小集合與獨立列舉為規格設計（非負責人裁定） |
| API-R13 | `fields` 每筆**只**含 `path` 與 `code` 兩個鍵；**不得**回傳請求中的原始輸入值、框架的錯誤訊息文字、預期值或限制值（例如長度上限）、`input`、`ctx` 等；也**不得**以輸入值組成 `path`。錯誤訊息、日誌與回應同樣不得夾帶原始值 | 不得 | [#432](https://github.com/speko-tw/inspect-flow/issues/432) 內文（範圍段）（不得回傳原始輸入值）、[PR-14](../../intents/02-principles.md#pr-14)（機密不外洩）；兩個鍵的限定為規格設計（非負責人裁定） |
| API-R14 | `error.fields` 是可選的新增欄位：既有的 `error.code`（API-R05、API-R07）與 `error.details` 的語意不變（`details` 的內容仍由各端點的功能規格決定）；請求欄位錯誤一律用 `fields`，`details` 不另立欄位錯誤陣列。`fields` 不保證涵蓋全部錯誤：不可定位的錯誤（例如 query、path、header 的驗證錯誤）不會出現在其中，用戶端除了欄位錯誤，也要顯示一般提示。用戶端**不得**假設 `fields` 一定存在；沒有 `fields`、或路徑對不到任何欄位時，**必須**以一般錯誤處理並保留使用者輸入，不得推測欄位位置 | 必須／不得 | [#432](https://github.com/speko-tw/inspect-flow/issues/432) 內文（範圍段）（向下相容、沒有欄位資訊時維持一般提示並保留草稿）、[PR-19](../../intents/02-principles.md#pr-19) |
| API-R15 | 共用的請求驗證錯誤處理器（`RequestValidationError`）**必須**對所有端點的 JSON 本文驗證錯誤填入 `fields`（可選的新增欄位，向下相容）；服務層已知的驗證錯誤**得**由各端點以共用錯誤型別明確提供 `fields`。逐步採用的是各端點的服務層欄位錯誤與前端畫面，範本 API 與範本管理畫面先落地（TPL-R24） | 必須／得 | [#432](https://github.com/speko-tw/inspect-flow/issues/432) 內文（範圍段）（先從範本 API 落地，其他 API 之後逐步採用）；全域 handler 的做法為規格設計（非負責人裁定） |

## 資料

本規格不建立資料庫或實體。API-R06 的 ID 格式規則供 `domain-model` 與其他建立實體的規格採用；本規格不定義任何實體自己的欄位。

## 介面

本規格是共用慣例，不新增產品端點；下表是所有 `/api/v1` 端點都要遵守的契約物件，取代模板中的「方法／路徑」表：

| 契約物件 | 內容 | 對應需求 |
|---|---|---|
| 路徑前綴 | `/api/v1` | API-R01 |
| 錯誤回應 envelope | `{"error": {"code": "<非空字串，dot-namespace 命名>", "details": <選填，既有，內容由各端點規格決定>, "fields": <選填，僅 422，見下列>}}`；HTTP 狀態碼另依實際錯誤類別（4xx／5xx） | API-R02、API-R05、API-R07、API-R14 |
| 欄位層級錯誤（選填） | `"fields": [{"path": "/items/1/name", "code": "field.required"}]`；只在能確定欄位的 422 回傳，不含原始輸入值 | API-R10～API-R13、API-R15 |
| JSON 請求／回應 | `Content-Type: application/json` | API-R03 |
| 上傳請求 | `Content-Type: multipart/form-data` | API-R04 |
| 實體 ID | UUID 字串（例如 `550e8400-e29b-41d4-a716-446655440000`） | API-R06 |
| 分頁（清單端點） | cursor-based；cursor 視為不透明字串，排序鍵包含時間＋UUID | API-R08 |
| 時間欄位 | ISO 8601（RFC 3339）字串，UTC，`Z` 後綴，精度到秒（例如 `2026-09-26T08:30:00Z`） | API-R09 |

**路徑格式的選擇（規格設計）**：選 JSON Pointer 而非點號路徑。RFC 6901 是標準，鍵名含 `.` 或 `/` 時有明確的轉義規則，陣列索引沒有歧義，也與 JSON Schema 驗證錯誤常見的 instance path 一致；前端以 `/` 切割即可對應到表單欄位。代價是比點號路徑長，且把 Pydantic 的 `loc`（去掉開頭的 `body`）轉成路徑時要加上轉義。點號路徑（`a.0.b`）在鍵名含點時有歧義，索引寫法各家不一，所以不採用。

**Pydantic 錯誤對照（規格設計）**：框架的錯誤類型轉成共用欄位錯誤碼——`missing` 為 `field.required`、字串或陣列過長為 `field.too_long`、過短為 `field.too_short`、數值上下限（大於、小於、介於）為 `field.out_of_range`，其餘（含 `extra_forbidden`、型別不符、格式不符與未知類型）一律 `field.invalid`，不回框架的類型名稱。

**使用規則**：只有請求本文（JSON）的欄位錯誤會產生 `fields`；來自 query、path、header 的驗證錯誤不產生（本規格暫不定義，有需要時另議）；multipart 表單欄位也暫不產生。無法解析的 JSON、不支援的 `Content-Type` 與服務層無法對應欄位的驗證錯誤，都只回 `error.code`。

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
| API-AC11 | 一個僅存在於測試中、回傳時間欄位的測試路由，以及兩個格式無效的時間字串範例（例如 `2026-99-99T99:99:99Z`、含小數秒的 `2026-09-26T08:30:00.000Z`） | 呼叫該路由取得回應時間欄位；另將兩個無效範例字串交由同一套時間驗證邏輯處理 | 回應的時間欄位須先以 regex `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$` 檢查原始字串形狀（不得含小數秒），再用 RFC 3339 解析器（例如 `datetime.fromisoformat` 或等效解析器）驗證可成功解析、`tzinfo` 對應 UTC（offset 為 0）、`microsecond == 0`、字串以 `Z` 結尾；兩個無效範例字串皆須被判定為不合法（regex 不符，或解析失敗，或未通過上述任一斷言） | API-R09 |
| API-AC12 | 一個僅存在於測試中、模擬同一秒建立多筆記錄並依「時間＋UUID」排序回傳清單的測試路由，初始資料已知 | 取得第一頁後，插入一筆排序鍵（時間＋UUID）落在已讀範圍內的新資料（同一秒、UUID 排序在已讀最後一筆之前），再依 cursor 翻完剩餘頁 | 原始資料每筆恰好出現一次（不重複也不遺漏）；且將 cursor 解碼後可驗證其綁定的是「時間＋UUID」而非位移（offset）——例如在已讀範圍之前增減資料筆數不影響下一頁的起點 | API-R08 |
| API-AC13 | 一個僅存在於測試中、接受巢狀 JSON（物件內含陣列，陣列元素內有必填、長度受限與數值受限欄位）的路由 | 送出多個欄位都不合法的請求，其中一個在陣列第 2 個元素；另送一個錯誤超過 100 筆的請求；同一請求重送兩次 | 回 422，`error.code` 仍為 `request.validation_failed`；`error.fields` 為陣列，每筆的 `path` 是 JSON Pointer（例如 `/items/1/name`，不含開頭的 `body`），`code` 屬 `field.*`（必填缺漏為 `field.required`、過長為 `field.too_long`、數值超出範圍為 `field.out_of_range`）；整個請求本文層級的錯誤 `path` 為空字串；順序為請求本文中的出現順序；同一 path 與 code 的重複錯誤只列一筆，且去重先於 100 筆上限（例如重複項加上 100 筆互異錯誤時，回的是 100 筆互異錯誤）；超過 100 筆時只回 100 筆；兩次重送的 `fields` 內容與順序完全相同；既有端點的 JSON 本文驗證錯誤也由共用 handler 填入 `fields` | API-R10、API-R11、API-R15 |
| API-AC14 | 測試路由：無法解析的 JSON 本文；不支援的 `Content-Type`；以共用錯誤型別拋出、未提供欄位的 422（模擬資料庫約束）；404、409 與 500 | 各呼叫一次 | 這些回應都只有 `error.code`（以及該端點原有的 `details`），回應中沒有 `fields` 鍵；`fields` 不會出現在 422 以外的狀態碼；另有一個同時含可定位與不可定位錯誤的請求，只列可定位者 | API-R10 |
| API-AC15 | 路徑轉換函式與一個含動態鍵（`dict[str, ...]`）欄位、並禁止多餘鍵的測試模型 | 轉換 `("body", "a/b", "~c", 0)` 與只含 `body` 的位置；對動態鍵內的值送出不合法資料；多送一個模型沒有定義的鍵；對 union 欄位送出不合法資料 | 前者得到 `/a~1b/~0c/0`，後者得到空字串；動態鍵的值出錯、多送未定義的鍵、union 分支內出錯時，路徑都停在上一層容器（例如 `/labels`），`code` 為 `field.invalid`，不含使用者輸入的鍵或框架的分支標籤；`body` 以外的來源（`query`、`path`、`header`）不產生 `fields` 項目 | API-R11 |
| API-AC16 | 欄位錯誤碼列舉，以及一個臨時擴充成員的測試專用列舉；各種框架錯誤類型（缺漏、過長、過短、數值上下限、未知類型） | 對正式列舉與測試列舉呼叫同一個對照表生成函式；送出會觸發這些錯誤類型的請求 | 所有 `fields[].code` 符合 regex `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$`（資源專屬原因可使用 `field.*` 以外的 namespace，不受三個共用 namespace 限制）；對照表的鍵集合與列舉成員一一對應，repo 內不存在獨立維護的手寫欄位錯誤碼對照表；各錯誤類型依〈介面〉的對照得到 `field.required`、`field.too_long`、`field.too_short`、`field.out_of_range`，未知類型回 `field.invalid`，不洩漏框架的類型名稱 | API-R12 |
| API-AC17 | 一個請求，其不合法欄位的值、動態鍵、多送的未定義鍵與其他欄位都含可辨識的測試字串（sentinel） | 送出請求並檢查 422 的原始回應文字與日誌 | 回應文字與日誌都不含 sentinel（含多送的未定義鍵名）；每筆 `fields` 只有 `path` 與 `code` 兩個鍵；沒有 `input`、`msg`、`ctx`、預期值或限制值 | API-R13 |
| API-AC18 | API-AC07、API-AC09 的既有測試；一個以 `details` 拋出共用錯誤型別的路由；既有端點的 422 回應 | 執行既有錯誤格式測試；呼叫該路由；比對採用前後的 422 回應 | 既有測試只需調整原本斷言整份 422 本文逐字相等的地方（改為只斷言 `error.code` 或容許 `fields`）即通過；沒有 `fields` 的 422 與先前逐字相同，帶 `fields` 的 422 除 `fields` 以外的鍵不變；`error.code` 與 `error.details` 內容與先前相同，沒有因 `fields` 而改變；全域 handler 對所有端點的 JSON 本文驗證錯誤填入 `fields`（API-R15） | API-R14、API-R15 |
| API-AC19 | 前端共用的 HTTP 請求輔助函式與表單錯誤對應工具 | 分別以帶 `fields` 的 422、沒有 `fields` 的 422、`fields` 形狀錯誤（非陣列、缺鍵）與路徑對不到任何欄位的 422 呼叫 | 帶 `fields` 時，錯誤出現在對應欄位旁、聚焦第一個錯誤；其餘三種情況顯示一般提示、保留使用者輸入且不聚焦任何欄位；`fields` 形狀錯誤不造成例外 | API-R14 |

## 待釐清

- **API-Q1**：請求本文以外的來源（query、path、header）與 multipart 表單欄位是否也要有欄位錯誤。目前只有範本管理表單需要，暫不定義；有第一個需要的表單時再補（路徑格式可沿用 JSON Pointer 加上來源標示）。

## 變更紀錄

- 範圍變更（#432）：新增可選的 `error.fields`（API-R10～API-R15、API-AC13～API-AC19）；既有 `error.code` 與 `error.details` 語意不變；共用 handler 對所有端點的 JSON 本文驗證錯誤填入 `fields`；狀態由已完成改為已凍結，實作任務（計畫 T7、T8）完成後改回已完成。欄位路徑、欄位錯誤碼、筆數上限與全域 handler 的做法是規格設計（非負責人裁定） — [#432](https://github.com/speko-tw/inspect-flow/issues/432)
