# API 共用慣例（api-conventions）：實作計畫

**規格**：[spec.md](spec.md)

計畫記錄「為什麼這樣拆」。實作中發現更好的拆法就直接更新本檔（屬於「計畫調整」）；進度看 issue，不在這裡打勾。

本規格沒有自己的業務端點，任務都是「共用工具程式 + 契約測試」，證明慣例本身可行；測試路由只存在於測試模組中，不掛進 `app/main.py` 的正式路由表，避免污染骨架的路由清單。

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1 | 共用錯誤處理模組：`APIError` 例外類別（`code`／`status_code`／`message`）；為 `APIError`、`RequestValidationError`、未攔截 `Exception` 各註冊一個 FastAPI exception handler，統一轉成 `{"error": {"code": ...}}` | `backend/app/api/errors.py`（新增）、`backend/app/main.py`（`create_app()` 內註冊三個 handler，只加幾行）、`backend/tests/contract/test_error_envelope.py`（新增） | — | API-AC02、API-AC03、API-AC07 | #? |
| T2 | 路由與內容型別契約測試：走訪 `app.routes` 斷言前綴；對 `GET /api/v1/health` 斷言 `Content-Type` | `backend/tests/contract/test_route_conventions.py`（新增） | — | API-AC01、API-AC04 | #? |
| T3 | multipart 慣例契約測試：測試模組內建立一個臨時 `APIRouter`，掛一個只接受 `UploadFile` 的路由，分別以 multipart 與 JSON base64 送出同一檔案 | `backend/tests/contract/test_multipart_conventions.py`（新增）、`backend/pyproject.toml`（新增 `python-multipart` 依賴）、`backend/uv.lock` | T1（415／錯誤回應要符合統一 envelope） | API-AC05、API-AC06 | #? |
| T4 | ID 格式契約測試與共用型別：一個回傳 UUID 字串 ID 的最小 Pydantic model／輔助函式，供其他規格之後引用 | `backend/app/api/schemas.py`（新增）、`backend/tests/contract/test_id_format.py`（新增） | — | API-AC08 | #? |

- 每個任務一個 PR 就能完成，並能單獨驗收。
- 每個任務至少對應一條 AC；每條 AC 至少被一個任務涵蓋。
- T1～T4 完成、且規格所有需求都有對應驗證後，依 [docs/specs/README.md](../README.md#狀態) 由最後一個任務的 PR 把本規格改為「已完成」並更新索引。
- 依 plan 開 task issue 時才建立上表的 issue 編號；本 PR 只寫文件，不開 task issue。

## 並行分組

依「改動的檔案」分波；同一波內的任務檔案不重疊。

- 第 1 波：T1、T2、T4（`backend/app/api/errors.py`、`backend/tests/contract/test_route_conventions.py`、`backend/app/api/schemas.py` 互不重疊，`backend/main.py` 只有 T1 動）。
- 第 2 波：T3（415 情境要沿用 T1 的錯誤 envelope，且新增 `backend/pyproject.toml`／`backend/uv.lock` 依賴，與其他任務同波容易撞共用檔案，故獨立一波）。

碰到[共用檔案](../README.md#parallel)的地方：

- `backend/uv.lock`：只有 T3 改，且獨立一波，降低與其他 in-flight PR 撞 lockfile 的機率；若當時有其他 PR 也在改 lockfile，依共用檔案規則先合併的一方優先，T3 再 rebase 重新產生。
- `backend/app/main.py`：只有 T1 加 exception handler 註冊，符合「入口只加一行註冊」的共用檔案規則。

## 風險

- **測試路由若不小心掛進正式 app，會污染 `skeleton` 的路由表**：T1～T4 一律在測試模組內用獨立的 `FastAPI()`／`APIRouter()` 實例掛測試路由，不 import 或修改 `create_app()` 之外的正式路由；T2 的路由前綴檢查另外針對「正式 app 的路由表」斷言，避免把測試路由算進去。
- **`error.code` 的具體命名法未定案**（見 spec.md〈待釐清〉）：T1 先用三個佔位命名（例如 `validation_error`、`not_found`、`internal_error`）滿足「非空字串且彼此不同」的 API-AC07，不代表命名法已拍板；團隊裁定命名法後另開任務重構這三個值，屬計畫調整。
- **`python-multipart` 是新依賴**：T3 要先確認版本與授權，並在 PR 說明寫清楚新增理由；與其他同時新增後端依賴的 PR 衝突時，依共用檔案規則先合併者優先。
- **第一個真正的 multipart 上傳端點還沒實作**：API-AC05、API-AC06 目前只證明慣例可行，不是端到端驗證；日後 `field-evidence` 等規格加入真實端點時，**應**在自己的 `plan.md` 補一份對照驗證，本計畫不代管。

## 驗證（Proof）

| AC | 驗證方式 |
|---|---|
| API-AC01 | `backend/tests/contract/test_route_conventions.py`：走訪 `create_app().routes`，斷言每個 `route.path` 以 `/api/v1/` 開頭 |
| API-AC02 | `backend/tests/contract/test_error_envelope.py`：`TestClient` 對不存在路徑發 `GET`，斷言狀態碼 404 |
| API-AC03 | `backend/tests/contract/test_error_envelope.py`：測試模組內掛一個刻意 `raise Exception(...)` 的路由，斷言狀態碼 500 且回應非純文字 |
| API-AC04 | `backend/tests/contract/test_route_conventions.py`：`TestClient` 呼叫 `GET /api/v1/health`，斷言 `response.headers["content-type"]` 為 `application/json` |
| API-AC05 | `backend/tests/contract/test_multipart_conventions.py`：同一個測試路由分別以 `files=...`（multipart）與 JSON base64 呼叫，斷言前者成功、後者 415 |
| API-AC06 | `backend/tests/contract/test_multipart_conventions.py`：斷言 multipart 上傳成功後的回應本體鍵值只有 ID／metadata，且原始檔名字串不出現在回應的 ID 欄位 |
| API-AC07 | `backend/tests/contract/test_error_envelope.py`：三個測試路由（422／404／500）分別呼叫，斷言 `response.json()["error"]["code"]` 為非空字串，且三次取得的值互不相同 |
| API-AC08 | `backend/tests/contract/test_id_format.py`：對回傳 ID 的測試 model 呼叫，斷言 `uuid.UUID(value)` 不拋例外 |

## 考慮過但沒採用的做法

- **在 `field-evidence` 等第一個真正需要上傳端點的規格裡才驗證 multipart 慣例**：會讓 api-conventions 凍結後很長一段時間都沒有任何自動化證據，且 `field-evidence` 本身還被 [G-02](../../intents/05-open-questions.md#g-02)、[G-03](../../intents/05-open-questions.md#g-03) 等擋著；改用測試專用路由先行證明慣例本身可行，之後有真實端點時再補對照驗證（見〈風險〉）。
- **在正式 `app/main.py` 掛一個永久的「診斷用」失敗端點**：會讓正式 API 多一個非業務用途的公開路徑，且需要額外的權限與環境判斷（正式環境不該存在）；改用只存在於測試模組的臨時路由。
- **現在就拍板 `error.code` 命名法**：intents 沒有依據，屬於團隊需要拍板的慣例，不由本計畫自行定案（見 spec.md〈待釐清〉）。
