# API 共用慣例（api-conventions）：實作計畫

**規格**：[spec.md](spec.md)

計畫記錄「為什麼這樣拆」。實作中發現更好的拆法就直接更新本檔（屬於「計畫調整」）；進度看 issue，不在這裡打勾。

本規格沒有自己的業務端點，任務都是「共用工具程式 + 契約測試」，證明慣例本身可行；測試路由只存在於測試模組中，不掛進 `app/main.py` 的正式路由表，避免污染骨架的路由清單。

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1 | 共用錯誤處理模組：`ErrorCode`（dot-namespace 字串列舉，依 [KD-15](../../intents/03-decisions-and-stack.md#kd-15)）與由它產生的描述對照表 `ERROR_CODE_DESCRIPTIONS`；`APIError` 例外類別（`code`／`status_code`／`message`）；`register_error_handlers(app)` 註冊函式，為 `APIError`、`RequestValidationError`、`StarletteHTTPException`（涵蓋框架自動產生的 404）、未攔截 `Exception` 各註冊一個 FastAPI exception handler，統一轉成 `{"error": {"code": ...}}` | `backend/app/api/errors.py`（新增）、`backend/app/main.py`（`create_app()` 內呼叫 `register_error_handlers(app)`，只加一行）、`backend/tests/contract/test_error_envelope.py`（新增；測試 app 與正式 app 一樣呼叫 `register_error_handlers`；500 測試使用 `TestClient(app, raise_server_exceptions=False)`） | — | API-AC02、API-AC03、API-AC08、API-AC10、API-AC11 | #? |
| T2 | 路由與內容型別契約測試：走訪 `create_app().routes`，只挑 `isinstance(route, fastapi.routing.APIRoute)` 的業務路由斷言前綴（排除框架自動產生的 `/openapi.json`、`/docs`、`/docs/oauth2-redirect`、`/redoc`，它們不是 `APIRoute`）；對 `GET /api/v1/health` 斷言 `Content-Type`；新增請求側內容型別測試：對一個測試用 JSON 端點以非 JSON `Content-Type` 送出請求本體，斷言回應為 4xx 且符合共用錯誤 envelope | `backend/tests/contract/test_route_conventions.py`（新增） | T1（請求側情境要靠 `register_error_handlers` 已註冊在 `create_app()`，才能拿到統一 envelope） | API-AC01、API-AC04、API-AC05 | #? |
| T3 | multipart 慣例契約測試：測試模組內建立一個臨時 `APIRouter`，掛一個只接受 `UploadFile` 的路由，回應含後端依 UUID 產生的資源 ID；分別以 multipart 與 JSON base64 送出同一檔案。JSON base64 因缺少必要的 multipart 欄位，由 FastAPI 產生 `RequestValidationError`，經 T1 的 handler 轉成統一 envelope（4xx），不需要另外實作特定狀態碼的處理邏輯；另檢查 multipart 上傳成功後，回應 ID 欄位為合法 UUID 且不含原始檔名字串 | `backend/tests/contract/test_multipart_conventions.py`（新增）、`backend/pyproject.toml`（新增 `python-multipart` 依賴）、`backend/uv.lock` | T1（統一錯誤 envelope 與 handler） | API-AC06、API-AC07 | #? |
| T4 | ID 格式契約測試與共用型別：一個回傳 UUID 字串 ID 的最小 Pydantic model／輔助函式，供其他規格之後引用 | `backend/app/api/schemas.py`（新增）、`backend/tests/contract/test_id_format.py`（新增） | — | API-AC09 | #? |
| T5 | 時間格式與 cursor 分頁契約測試：共用的 UTC ISO-8601 秒精度時間序列化輔助函式（依 [KD-14](../../intents/03-decisions-and-stack.md#kd-14)）；一個不透明的 cursor 編碼／解碼輔助函式，排序鍵為「時間＋UUID」（依 [KD-13](../../intents/03-decisions-and-stack.md#kd-13)）；測試模組內建立測試路由驗證兩者可行。這兩個輔助函式與測試路由只證明機制可行，不代表任何清單端點的正式頁大小或回應 envelope 形狀——那些留給第一個實作清單端點的功能規格決定 | `backend/app/api/time_format.py`（新增）、`backend/app/api/pagination.py`（新增）、`backend/tests/contract/test_time_format.py`（新增）、`backend/tests/contract/test_pagination_conventions.py`（新增） | — | API-AC12、API-AC13 | #? |

- 每個任務一個 PR 就能完成，並能單獨驗收。
- 每個任務至少對應一條 AC；每條 AC 至少被一個任務涵蓋。
- T1～T5 完成、且規格所有需求都有對應驗證後，依 [docs/specs/README.md](../README.md#狀態) 由最後一個任務的 PR 把本規格改為「已完成」並更新索引。
- 依 plan 開 task issue 時才建立上表的 issue 編號；本 PR 只寫文件，不開 task issue。

## 並行分組

依「改動的檔案」與「依賴」分波；同一波內的任務檔案不重疊，也互不依賴。

- 第 1 波：T1、T4、T5（`backend/app/api/errors.py`／`backend/app/main.py`、`backend/app/api/schemas.py`、`backend/app/api/time_format.py`／`backend/app/api/pagination.py` 互不重疊；三者彼此不依賴）。
- 第 2 波：T2（依賴 T1 的 `register_error_handlers`；只改 `backend/tests/contract/test_route_conventions.py`，與其他任務不重疊）。
- 第 3 波：T3（依賴 T1；新增 `backend/pyproject.toml`／`backend/uv.lock` 依賴，與其他任務同波容易撞共用檔案，故獨立一波）。

碰到[共用檔案](../README.md#parallel)的地方：

- `backend/uv.lock`：只有 T3 改，且獨立一波，降低與其他 in-flight PR 撞 lockfile 的機率；若當時有其他 PR 也在改 lockfile，依共用檔案規則先合併的一方優先，T3 再 rebase 重新產生。
- `backend/app/main.py`：只有 T1 加 `register_error_handlers(app)` 這一行註冊，符合「入口只加一行註冊」的共用檔案規則。

## 風險

- **測試路由若不小心掛進正式 app，會污染 `skeleton` 的路由表**：T1～T5 一律在測試模組內用獨立的 `FastAPI()`／`APIRouter()` 實例掛測試路由，不 import 或修改 `create_app()` 之外的正式路由；T2 的路由前綴檢查另外針對「正式 app 的業務路由」斷言，避免把測試路由或框架文件路由算進去。
- **`error.code` 命名法已依 [KD-15](../../intents/03-decisions-and-stack.md#kd-15) 定案為 dot-namespace**：T1 的三個碼（`request.validation_failed`、`resource.not_found`、`server.internal_error`）是 api-conventions 共用錯誤處理器實際使用、非佔位的碼；個別資源自己的碼（例如 `task.not_found`）由各功能規格依同一套命名法自行決定，不在本計畫範圍。
- **`python-multipart` 是新依賴**：T3 要先確認版本與授權，並在 PR 說明寫清楚新增理由；與其他同時新增後端依賴的 PR 衝突時，依共用檔案規則先合併者優先。
- **第一個真正的 multipart 上傳端點還沒實作**：API-AC06、API-AC07 目前只證明慣例可行，不是端到端驗證；日後 `field-evidence` 等規格加入真實端點時，**應**在自己的 `plan.md` 補一份對照驗證，本計畫不代管。
- **分頁與時間格式的測試路由不代表正式清單端點的頁大小或回應 envelope 形狀**：[KD-13](../../intents/03-decisions-and-stack.md#kd-13)／[KD-14](../../intents/03-decisions-and-stack.md#kd-14) 只定案分頁機制與時間格式本身；T5 的測試路由只用固定的測試資料證明 cursor 排序與時間序列化可行，實際頁大小、上限與清單回應形狀留給第一個實作清單端點的功能規格決定。

## 驗證（Proof）

| AC | 驗證方式 |
|---|---|
| API-AC01 | `backend/tests/contract/test_route_conventions.py`：走訪 `create_app().routes`，只保留 `isinstance(route, fastapi.routing.APIRoute)` 的路由，斷言每個 `route.path` 以 `/api/v1/` 開頭 |
| API-AC02 | `backend/tests/contract/test_error_envelope.py`：`TestClient` 對不存在路徑發 `GET`，斷言狀態碼 404 |
| API-AC03 | `backend/tests/contract/test_error_envelope.py`：測試模組內掛一個刻意 `raise Exception(...)` 的路由，使用 `TestClient(app, raise_server_exceptions=False)`，斷言狀態碼 500 且回應非純文字 |
| API-AC04 | `backend/tests/contract/test_route_conventions.py`：`TestClient` 呼叫 `GET /api/v1/health`，斷言 `response.headers["content-type"]` 為 `application/json` |
| API-AC05 | `backend/tests/contract/test_route_conventions.py`：對一個測試用 JSON 端點分別以 `Content-Type: text/plain` 與 `application/json` 送出同一請求本體，斷言前者為 4xx 且回應符合共用錯誤 envelope，後者成功處理 |
| API-AC06 | `backend/tests/contract/test_multipart_conventions.py`：同一個測試路由分別以 `files=...`（multipart）與 JSON base64 呼叫，斷言前者成功（2xx）、後者因驗證失敗回應 4xx 且符合共用錯誤 envelope |
| API-AC07 | `backend/tests/contract/test_multipart_conventions.py`：斷言 multipart 上傳成功後回應的 ID 欄位可被 `uuid.UUID(...)` 解析，且原始檔名字串不出現在該欄位中 |
| API-AC08 | `backend/tests/contract/test_error_envelope.py`：三個測試路由（422／404／500）分別呼叫，斷言 `response.json()["error"]["code"]` 為非空字串，且三次取得的值互不相同 |
| API-AC09 | `backend/tests/contract/test_id_format.py`：對回傳 ID 的測試 model 呼叫，斷言 `uuid.UUID(value)` 不拋例外 |
| API-AC10 | `backend/tests/contract/test_error_envelope.py`：對 API-AC08 觸發的三個 `error.code` 值，斷言每個都符合 regex `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$` |
| API-AC11 | `backend/tests/contract/test_error_envelope.py`（或獨立檔案）：斷言 `set(ErrorCode)` 與 `set(ERROR_CODE_DESCRIPTIONS.keys())` 相等 |
| API-AC12 | `backend/tests/contract/test_time_format.py`：呼叫測試路由，斷言回應時間欄位字串符合 regex `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$` |
| API-AC13 | `backend/tests/contract/test_pagination_conventions.py`：建立多筆同一秒的測試記錄，依 cursor 逐頁呼叫測試路由直到沒有下一頁，斷言每筆記錄恰好出現一次，且整體順序與依「時間＋UUID」排序的結果一致 |

## 考慮過但沒採用的做法

- **在 `field-evidence` 等第一個真正需要上傳端點的規格裡才驗證 multipart 慣例**：會讓 api-conventions 凍結後很長一段時間都沒有任何自動化證據，且 `field-evidence` 本身還被 [G-02](../../intents/05-open-questions.md#g-02)、[G-03](../../intents/05-open-questions.md#g-03) 等擋著；改用測試專用路由先行證明慣例本身可行，之後有真實端點時再補對照驗證（見〈風險〉）。
- **在正式 `app/main.py` 掛一個永久的「診斷用」失敗端點**：會讓正式 API 多一個非業務用途的公開路徑，且需要額外的權限與環境判斷（正式環境不該存在）；改用只存在於測試模組的臨時路由。
- **讓每份功能規格各自決定 `error.code` 的命名法**：會導致格式各自發明、無法用單一 regex 驗證是否符合共用慣例；已依 [KD-15](../../intents/03-decisions-and-stack.md#kd-15) 統一為 dot-namespace，各功能規格只需依此決定自己資源的 `<reason>` 部分。
