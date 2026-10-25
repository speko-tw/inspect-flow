# 查核計畫與任務（inspection-planning）：實作計畫

**規格**：[spec.md](spec.md)

本計畫依已凍結的 Plan／Task、ProjectZone 與 Task 地點需求及驗收條件拆分工作。KD-56 沒有涵蓋的細節及本規格選定的規格設計見 [spec.md](spec.md#開工門檻逐實體比對)；實作 task 開立前仍須核對最新來源及責任檔案。

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1 | 定義 P4 `ProjectInspectionItem` 擴充欄位、`ProjectZone`、Plan、Task、多項目關聯、Task 地點、每項 Snapshot／狀態／歷史及 KD-55 修改紀錄資料結構；建立 migration 與資料庫約束 | `backend/app/models/`、`backend/alembic/versions/`、`backend/tests/db/` | `template-system`、`domain-model`、`database-foundation`；核對已合併的 KD-55／KD-56 與 `state-machines` SM-Q03 凍結規則 | IP-AC02～IP-AC05、IP-AC11 | #359 |
| T2 | 實作 ProjectZone CRUD 與稽核、Plan／Task／Snapshot 服務層（含查詢、修改與建議指派）、派出／草稿刪除／取消／恢復（恢復沿用取消權限且不要求原因）、KD-55 項目級重新查核及衍生狀態；受影響的 `COMPLETED` Task 回到 `IN_PROGRESS`，`PENDING`／`IN_PROGRESS` Task 維持原狀並標記有舊結果的項目待重查；草稿 Task 原位更新，已取消 Task 恢復時才套用目前標準；加入 Task 地點修改與稽核（僅 `DRAFT`、`PENDING`、`IN_PROGRESS` 可修改）；封存期間 Task 唯讀、取消封存後重算 Plan 狀態。集中登記權限代碼與稽核事件 | `backend/app/services/inspection_planning.py`、`backend/app/services/inspection_planning_snapshots.py`、`backend/tests/services/test_inspection_planning.py`、`backend/tests/api/test_roles_api.py`、`backend/app/permission_codes.py`、`docs/specs/audit-log/spec.md`、`docs/specs/inspection-planning/plan.md` | T1、`authentication`、`state-machines`；依 KD-55／KD-56 與已合併的 `state-machines` 規則實作；TPL 已登記的權限沿用 | IP-AC03～IP-AC09、IP-AC11 | #360 |
| T3 | 實作 ProjectZone 與 Plan／Task／專案項目修改 API，含 Task 地點建立與修改端點、回應內嵌分區 ID／名稱、同專案檢查、狀態與權限檢查、UUID、分頁、錯誤契約及快照讀寫 | `backend/app/api/`、`backend/app/schemas/`、`backend/tests/api/`、`backend/tests/db/` | T1、T2、`api-conventions` | IP-AC01～IP-AC11 | #361 |
| T4 | 建立內業 ProjectZone 管理、Plan 管理、手動建立多項目 Task 與地點輸入／修改、派出／草稿刪除／取消／恢復操作與任務建議指派 UI；草稿 Task 僅內業可見；封存 Plan 的 Task 唯讀 | `frontend/src/features/`、`frontend/src/routes/`、`frontend/tests/` | T3；核對 KD-55／KD-56 及已合併的 `state-machines` 契約 | IP-AC01、IP-AC02、IP-AC06～IP-AC08、IP-AC11 | #363 |
| T5 | 建立專案查核項目修改確認介面，說明重新查核後果；呈現受影響項目作廢歷史、其他項目保留及來源 Task 為 `DRAFT` 時原位更新 | `frontend/src/features/`、`frontend/tests/` | T3；依 IP-Q07／IP-Q08 的項目級技術設計及已合併的補充裁定 | IP-AC04、IP-AC05、IP-AC08 | #362 |
| T6 | 端到端驗收 IP-AC01～IP-AC11，涵蓋快照隔離、修改影響範圍、權限、指派非排他性、自動 Plan 狀態與歷史保存；以前後端共用 wire fixture 驗證真 API 與 production client 契約，完成文件及索引收尾 | `backend/app/services/inspection_planning.py`、`backend/app/api/errors.py`、`backend/tests/`、`frontend/src/admin/planning/`、`frontend/src/admin/planning/fixtures/`、`docs/specs/inspection-planning/`、`docs/specs/README.md` | T1～T5；業務行為依已裁定來源，規格設計項依 spec 明示範圍驗收 | IP-AC01～IP-AC11 | #364 |
| T7 | 新增專案流程摘要 API，以資料庫聚合回傳成員、項目、分區、計畫、可見 Task 狀態及待重查數；落實各專案讀取權限與 DRAFT 可見性，補充 API 規格與測試 | `backend/app/api/v1/projects.py`、`backend/app/services/project_workflow_summary.py`、`backend/app/services/inspection_planning.py`、`backend/tests/api/test_project_workflow_summary.py`、`backend/tests/contract/test_route_access.py`、`docs/specs/inspection-planning/spec.md` | T1、T2；共用 API、權限與資料模型已就緒（#446） | IP-AC12 | #446 |
| T8 | 批次篩選 Field 任務清單的專案 inspect 權限與可指派候選人；候選人排序及 cursor 分頁在資料庫執行，並以小／大專案與成員資料量驗證查詢次數不線性增加。`make check-postgres` 另以 PostgreSQL backend 執行兩個 API 的權限、回應、排序與 cursor 驗收 | `backend/app/services/inspection_planning.py`、`backend/app/api/v1/inspection_planning.py`、`backend/tests/api/test_planning_query_counts.py`、`backend/tests/db/test_planning_api_postgresql.py`、`docs/specs/inspection-planning/spec.md`、`docs/specs/inspection-planning/plan.md` | T2、T3 | IP-R01、IP-AC06 | #468、#552 |
| T9 | 修正內業 planning mock 的 Plan 列表分頁，採用與後端一致的 `(created_at,id)` cursor shape 與續頁排序；頁大小對齊 HTTP client 明確指定的 limit，補 cursor round-trip、tie-break、非法輸入與頁面邊界測試 | `frontend/src/admin/planning/api.mock.ts`、`frontend/src/admin/planning/api.test.ts`、`docs/specs/inspection-planning/plan.md` | T3；核對後端 pagination helper 與前端 HTTP client 的實際 limit | N/A（契約來源 API-R08） | #471 |
| T10 | `Inspection Task.inspection_level`：新增不可空欄位並以一支 migration 依所屬專案 `company_role` 回填既有 Task（升級當下既有專案都是承攬施工方，結果為 `self_inspection`）；建立 Task 時依專案當時的 `company_role` 帶入、建立請求不接受此欄；Task API 回應含此欄；外部協作人員派出時指定層級的部分待 [#550](https://github.com/speko-tw/inspect-flow/issues/550) | 依當時程式碼盤點，預計 `backend/app/models/`、`backend/alembic/versions/`（一支 migration）、`backend/app/services/inspection_planning.py`、`backend/app/api/v1/inspection_planning.py`、`backend/tests/` | `domain-model` 任務 R（`company_role` 與登記表） | IP-AC16 | [#646](https://github.com/speko-tw/inspect-flow/issues/646) |
| T11 | 專案流程摘要的 `project` 物件加 `company_role`（IP-R11（流程摘要）），供專案首頁顯示本公司角色；補 API 測試與契約 fixture | `backend/app/services/project_workflow_summary.py`、`backend/app/api/v1/projects.py`、`backend/tests/api/test_project_workflow_summary.py`、`frontend/src/admin/` 摘要型別（依當時程式碼盤點） | `domain-model` 任務 R | IP-AC12 | [#559](https://github.com/speko-tw/inspect-flow/issues/559) |
| T12 | 序列化 Task 建立快照與專案項目修改，固定項目／Plan 鎖順序，並以 PostgreSQL 並行 API 測試驗證快照一致與鎖序一致 | `backend/app/services/inspection_planning.py`、`backend/tests/db/test_project_item_edit_concurrency.py`、`backend/tests/services/test_inspection_planning.py`、`docs/specs/inspection-planning/plan.md` | T2、T3 | IP-R03、IP-AC03 | #555 |
| T14 | 專案進度區段所需的後端：專案 Task 清單的 `status`、`needs_reinspection=true` 篩選、排序與每筆 `plan`／`item_summary`（IP-R18），單筆 Task 讀取加 `plan`、`started_by_user`、`completed_by_user`（IP-R19）；以資料庫與批次載入完成；補 API 測試與前後端契約 fixture | 依當時程式碼盤點，預計 `backend/app/api/v1/inspection_planning.py`、`backend/app/services/inspection_planning.py`、`backend/tests/api/` | T3、T7 | IP-AC18、IP-AC19 | 待開 task（母 issue [#452](https://github.com/speko-tw/inspect-flow/issues/452)；先於 `admin-dashboard` T21 合併） |
| T15 | 將專案查核項目 PATCH 的查詢、驗證、寫入與受影響 Task 組裝移入 Service 層；同一來源項目的 Task 以批次查詢載入，每個受影響 Plan 只重算一次；以服務層委派契約、既有 PATCH 行為測試及多 Plan／多 Task 回歸測試驗證行為不變 | `backend/app/api/v1/inspection_planning.py`、`backend/app/services/inspection_planning.py`、`backend/tests/contract/test_project_item_edit_service_boundary.py`、`backend/tests/services/test_inspection_planning.py` | T2、T3、T12 | IP-AC03～IP-AC05 | #622 |
| T13 | 草稿 Task 修改查核項目（IP-R20）：新增 `PUT /api/v1/inspection-tasks/{task_id}/items` 與服務層；入口先預檢封存 Plan 與 Task 狀態、鎖後複檢，依來源項目、Plan、Task 的鎖序在同一交易重建明細與 Snapshot，持鎖後重讀舊項目集合，並寫入 `inspection_task.items_updated`；計畫頁草稿任務加「修改查核項目」原地表單（含取消、未儲存提醒、錯誤在欄位旁），缺查核項目的派出阻擋捷徑改開此表單；補後端、PostgreSQL 並行與前端測試 | `backend/app/services/inspection_planning.py`、`backend/app/api/v1/inspection_planning.py`、`backend/tests/services/test_inspection_planning.py`、`backend/tests/api/test_inspection_planning_api.py`、`backend/tests/db/test_project_item_edit_concurrency.py`、`backend/tests/services/test_audit.py`、`frontend/src/admin/planning/` | T3、T4、T12 | IP-AC20、ADM-AC42 | [#615](https://github.com/speko-tw/inspect-flow/issues/615) |

- 每個 task issue 開立前，應將路徑清單縮到具體檔案，並依共用 migration、model registry、router、API client 等實際重疊情況調整責任界線。
- 所有 AC 至少由一個 task 涵蓋（IP-AC11 由 T1～T4 涵蓋；IP-AC12 由 T7 涵蓋，其 `project.read` 分支與 IP-R12、IP-AC13 由 `authentication` 任務 P 涵蓋）；IP-Q 業務裁定已納入 KD-55／KD-56；KD-55 項目級補充依負責人留言 5970063986，`state-machines` 的 SM-Q03 已同步並凍結。本規格 Plan／Task 原範圍已凍結；依 #369 擴增的 ProjectZone、Task 地點與對應驗收納入本次凍結範圍。
- 任務按專案查核項目手動建立，並由內業選擇專案分區或填補充地點；本計畫不包含依 interval、起訖點或間距自動切分任務。
- IP-R18、IP-R19 與 IP-AC18、IP-AC19 由 T14 涵蓋，是 `admin-dashboard` 專案進度區段（[#452](https://github.com/speko-tw/inspect-flow/issues/452)）的後端契約。
- IP-R13～IP-R15 與 IP-AC14～IP-AC15 屬 [負責人直接指示（2026-10-10，#106）](https://github.com/speko-tw/inspect-flow/issues/106#issuecomment-6093842438) 的範圍變更；實作不在本計畫另開任務：點位與實測欄位帶 `id`、選「不要」不得增減項次、零項次擋下與 `has_result` 納入有效照片由 `field-evidence` T5 實作，Task 回應新增三個欄位與 `has_result` 納入結果由 [`completion-validation`](../completion-validation/plan.md) T3、T4、T6 實作。
- IP-R20 與 IP-AC20 屬負責人指示的範圍變更（[#615](https://github.com/speko-tw/inspect-flow/issues/615)，2026-10-12 裁定），由 T13 在同一 PR 落地；IP-R17～IP-R19、IP-AC17～IP-AC19 由 #497、#452 使用。

## 並行分組

依檔案責任與資料相依分波。下列為初步安排，具體檔案清單須在開 task 前再檢查；Alembic migration 鏈是共用檔案，每波最多一支 migration，並按 [共用檔案規則](../README.md#parallel) 處理。

- 第 1 波：T1（資料模型與 migration；獨占 migration 鏈及相關 model registry）。
- 第 2 波：T2（服務、權限與狀態行為；依賴 T1）。
- 第 3 波：T3（API 與 schema；依賴 T1、T2）。
- 第 4 波：T4 與 T5（前端；只有路由、共用 client 與 feature 檔案責任確認不重疊時才並行，否則依序）。
- 第 5 波：T6（跨端驗收與文件收尾；依賴 T1～T5）。

## Issue #624 維護者決定（2026-10-16）

- `GET /api/v1/inspection-tasks/{task_id}` 的讀取權限及 DRAFT 規則只改規格；以既有 API 權限測試核對。
- 專案項目 PATCH 相同內容回 200，不新增修訂、變更列或 audit；實作與 `backend/tests/api/test_inspection_planning_api.py` 驗收。
- 依據：維護者決定（#624，2026-10-16）。

## Issue #667 來源路徑快照

- `ProjectInspectionItem` 增加可空的來源工程類別／系統名稱快照，單項與整系統套用時保存當下值；舊資料不回填，避免從可能不唯一的 `source_template_name` 猜測。
- 專案項目 API 回傳這兩欄，畫面顯示類別／系統；歷史路徑未知時明示未記錄。來源日後改名或刪除不改寫既有快照。
- migration 可升級與降級；以 API、DB migration 和前端測試驗收。

## 風險

- **KD-55 與項目級補充的文字需一併理解**：依負責人補充裁定 5970063986，只作廢受影響項目的舊 Snapshot、結果與照片，保留同 Task 其他項目；符合條件的 `COMPLETED` Task 回到 `IN_PROGRESS`、`PENDING`／`IN_PROGRESS` Task 保持原狀，來源為 `DRAFT` 時原位更新。#346 的 PR #347 與 state-machines PR #349 均已合併；實作依已凍結規則。
- **狀態機規格同步與凍結門檻**：依 KD-56，Plan 任意狀態可封存；本規格採封存時 Task 唯讀、取消封存後依現況重算，且草稿 Task 阻止完成。`state-machines` 的 Plan／Task 行為已依 PR #349 合併。KD-56 沒有涵蓋的表示細節，在規格中明標為規格設計（非負責人裁定）；Plan／Task 凍結範圍與 Evidence／Report 阻擋邊界見規格逐項比對表。
- **Task 組成**：負責人已裁定一個 Task 得含多個項目；關聯表／明細表、各項 Snapshot／狀態／歷史結構仍為規格設計，需涵蓋 KD-55 只作廢受影響項目且 Task 重回 `IN_PROGRESS`。
- **快照結構與更正**：Snapshot 必須保存建立時需求；KD-55 的「不要」重新查核是明確更正例外，需確保結果、照片與狀態不變且有可追溯紀錄。欄位採明確欄位或關聯子表為**規格設計（非負責人裁定）**，實作前確認不破壞歷史追溯。
- **專案項目修改範圍**：KD-55 只影響同專案使用該項次的任務；若跨 Plan，必須確保查全所有關聯，而不是只查目前頁面或目前 Plan。
- **取消與完成判定**：未派出的 `DRAFT` Task 可刪除、不可取消；派出後未完成 Task 可取消及恢復，完成 Task 不可取消。恢復時若標準變更，改用目前標準並將被修改項目的舊結果標示待重查；此行為依裁定 5970733042。恢復沿用取消權限、不要求恢復原因為規格設計。草稿 Task 阻止 Plan 完成且不算已取消；零 Task 維持 `DRAFT`，全取消且至少一筆為 `CANCELLED`，有完成且其餘取消為 `COMPLETED`。取消封存後依當前 Task 重算 Plan。
- **報告與 Evidence 範圍**：KD-55 對作廢資料保存與已發出報告的要求，不等於 Report 狀態與快照（G-06／G-07）已裁定；不可在本規格自行補足 Evidence 刪除（依 KD-62）或 Report 狀態政策。
- **共用檔案競爭**：Plan／Task models、router 註冊、權限表及 migration 都可能與其他 P4 工作重疊；開 task 時需依最新 main 及 issue 狀態確認，不以本草稿推定可同波。

## 驗證（Proof）

每條 AC 的實際命令與證據應在對應實作 PR 記錄；純文件規格草稿階段不執行產品驗收。

| AC | 驗證方式 |
|---|---|
| IP-AC01 | API 整合測試：授權與拒絕任意狀態輸入；跨專案存取測試。 |
| IP-AC02 | API／服務測試：內業建立含多個明選項目的 Task 與只含單項的 Task；確認建立後為草稿且現場不可見，沒有 interval 仍可建立，也不自動切分任務。 |
| IP-AC03 | 服務／資料庫測試：建立 Task 後修改 Template 與 ProjectInspectionItem，確認 Snapshot 仍為建立時內容；PostgreSQL 並行 API 測試驗證 Task 建立與項目 PATCH 依相同鎖順序序列化，且快照與最終標準一致。 |
| IP-AC04 | 服務／API 測試：驗證跨 Plan 多項目 Task 僅作廢受影響項目、舊 Snapshot／結果／照片可查找、其他項目保持有效；僅 `COMPLETED` Task 回到 `IN_PROGRESS`，`PENDING`／`IN_PROGRESS` Task 狀態不變並標記項目待重查；DRAFT Task 原位更新；有效照片或結果的項目才作廢並標待重查（只有照片也算），已取消 Task 恢復時才作廢；封存中拒絕修改且唯讀，取消封存後重算狀態再成功。 |
| IP-AC05 | 服務／API 測試：選「不要」後比對 Snapshot 文字更新且 Task 狀態、結果與照片不變，稽核含選擇者及時間。 |
| IP-AC06 | 權限整合測試：非指派但有專案現場權限的成員可操作；實際操作者欄位記錄該成員。 |
| IP-AC07 | 狀態機整合測試：零 Task 維持 `DRAFT`；`DRAFT` Task 阻止 Plan 完成，可硬刪除但不可取消且不計入全取消判定，刪除另寫 `inspection_task.deleted` 稽核事件；已完成 Plan 新增草稿 Task 後回 `IN_PROGRESS`；派出後才可取消，取消保留結果／照片與取消前狀態；恢復沿用取消權限、不要求原因，且還原至取消前狀態；若取消期間標準變更，恢復採目前標準並將被修改項目的舊結果標示待重查，其他項目不變；完成不可取消；全取消且至少一筆成為 `CANCELLED`，已有完成且其餘取消則 `COMPLETED`。 |
| IP-AC08 | 狀態機整合測試：封存各有效 Plan 狀態後確認所屬 Task 唯讀；取消封存後依目前 Task 狀態重算有效狀態，不直接還原封存前狀態。核對 KD-56 與 `state-machines` 同步後的狀態轉換。 |
| IP-AC09 | API／服務測試：P4 不存在結果或照片新增／更正端點，也不提供一般人工將 Task 從 `COMPLETED` 重開的端點；KD-55「不要」只更新 Snapshot 文字且狀態、結果、照片不變；KD-55「要」是明確系統例外，可使受影響的 `COMPLETED` Task 自動回 `IN_PROGRESS`；`PENDING`／`IN_PROGRESS` Task 保持狀態但項目標記待重查，待重查完成前 Task 與 Plan 均不得完成；只有照片、尚無結果的項目也作廢並標待重查。 |
| IP-AC10 | API 整合測試：權限、專案邊界、非法狀態輸入與共用錯誤格式。 |
| IP-AC11 | API／服務／前端測試：分區 CRUD 權限、名稱唯一性、Task 同專案地點欄位與有／無分區的建立規則；地點可修改狀態、已完成／取消及封存時拒絕、地點修改稽核；Task 讀取回應含分區 ID／名稱且不要求 `project_zone.read`；引用分區不可刪除，Snapshot 排除地點欄位。 |
| IP-AC12 | `backend/tests/api/test_project_workflow_summary.py` 驗證空專案步驟數、五種 Task 狀態、待重查 Task 數、DRAFT 可見性、403／404 與跨專案隔離；`backend/tests/contract/test_route_access.py` 驗證路由權限宣告。 |
| IP-AC14 | 真後端 API 測試（隨 `field-evidence` T5）：PATCH 帶 `id` 保留識別、選「不要」拒絕增減項次與欄位集合、`id` 不屬於該項目、選「要」時被刪除的點位連同結果與照片作廢。 |
| IP-AC15 | 真後端 API 測試（隨 `field-evidence` T5）：建立含零項次項目的 Task 被拒絕、已使用項目改成零項次被拒絕、未使用項目可暫時零項次。 |
| IP-AC18 | 真後端 API 測試：每個 `status` 與 `needs_reinspection=true` 的筆數對照 workflow summary、兩者並用取交集、非法值 422、只有 `inspection_task.inspect` 者看不到 DRAFT 且回 200 空頁、封存 Plan 只被待重查排除、排序與 cursor 無重複遺漏、`plan`／`item_summary` 欄位、查詢次數不隨每頁筆數成長；契約 fixture 與前端 mock 一致（RG-M22） |
| IP-AC19 | 真後端 API 測試：單筆 Task 含 `plan`、`started_by_user`、`completed_by_user`（只有 `id`、`name_zh`），沒有 `inspection_plan.read` 仍可讀，沒有 `inspection_task.read` 被拒 |
| IP-AC20 | 服務／API 測試：成功取代後項目、Snapshot、Task 識別碼與名稱、`updated_at` 與稽核；同集合回 200 不重建不寫稽核；空集合、重複、201 筆、不存在、跨專案、無項次項目回 422 且資料與稽核筆數不變；已派出 Task 與封存 Plan 下的 `DRAFT` Task 不論項目合法與否一律 409（封存優先）；無權限 403。PostgreSQL 並行測試（`backend/tests/db/test_project_item_edit_concurrency.py`，以事件與 `pg_stat_activity` 固定交錯順序）：兩個取代請求同時送出時後到者以持鎖後重讀的集合記錄稽核 before；取代項目與 PATCH 同一來源項目在兩種先後下，新 Snapshot 的來源標準修訂等於來源目前修訂。前端測試見 ADM-AC42。 |

Issue #406 補齊以下測試對應，不變更產品行為：

- IP-AC04：封存 Plan 下修改被拒且沒有項目變更、Snapshot 或更新稽核；取消封存後重送成功；同一項目跨多個 Plan 的 Task 與 Snapshot 一併更新，無關項目不變。驗證位於 `backend/tests/services/test_inspection_planning.py`。
- IP-AC06、STM-AC09：非指派但具 `inspection_task.inspect` 權限的成員可開始 Task，且 `started_by` 記錄實際操作者。驗證位於 `backend/tests/services/test_inspection_planning.py`。
- IP-AC07、STM-AC02：PostgreSQL 以兩個獨立 transaction 並發完成同一 Plan 的最後兩個 Task，確認兩個 Task 與 Plan 最終均為 `COMPLETED`。驗證位於 `backend/tests/db/test_inspection_planning.py`。

## 考慮過但沒採用的做法

- **依 interval 自動切分任務**：MVP 已由 KD-36 定為不要求，任務由內業依專案項目建立。
- **以目前專案／範本資料即時組裝舊任務內容**：違反 PR-04 的任務需求快照；每個 Task 必須保有建立當時的 Snapshot。
- **直接覆寫已建立任務的 Snapshot**：KD-55 只允許「不要重新查核」時更正任務文字，並保留結果、照片與狀態；此例外需留下操作者、時間與內容紀錄。
- **已完成 Task 重新開啟**：KD-56 不允許重新開啟已完成 Task。KD-55 標準變更是明確的系統例外：受影響的已完成 Task 自動回到 `IN_PROGRESS`，只使相關項目的結果／照片作廢以重新查核；不提供一般人工重開 Task 的端點。此規則依負責人補充裁定 5970063986，並已反映於合併的 `state-machines` SM-Q03。


## Issue #435：專案查核項目移除與改名

- 依負責人 2026-10-22 裁定，在既有 #622 worktree 接續；不建立停用或恢復功能。
- 專案項目 DELETE 依編輯權限覆核，鎖來源項目後查所有 Task 明細（含草稿、取消），沒有引用才清除子結構與變更紀錄，並於同交易新增 `project_inspection_item.deleted`。回應帶任務數，操作紀錄加白話標籤。
- PATCH 改名與套用範本共用名稱檢查鎖，trim／casefold、排除自身；409 保留 UI 編輯內容並提示換名。含非草稿引用時，只有純改名預設不要且保留確認；其他修改須明確選擇。只有草稿（含改名）不詢問、送 true，Snapshot 原位更新。
- 實作範圍：`backend/app/services/inspection_planning.py`、`project_templates.py`、`backend/app/api/v1/inspection_planning.py`、`backend/app/api/errors.py`、前端 `projectItems/` 與 `audit-log/auditLabels.ts`；不需 migration。
- 驗收：`tests/api/test_project_item_removal.py`、`tests/db/test_project_item_removal.py`（SQLite／PostgreSQL）、`tests/db/test_project_item_edit_concurrency.py`、`tests/services/test_audit.py`、`ProjectItemLinks.test.tsx`、`ProjectItemChangePage.test.tsx` 與 `auditLabels.test.ts`。
- IP-AC21～IP-AC22：先取得新增測試紅燈，再執行 `make check`（專用 `inspectflow_test_622`、4 個前端 worker）、demo E2E 與 1280／390 真畫面截圖；報告保留命令、退出碼、需求與 commit 對照。


### W-P1c 審查修正（#435）

- IP-R22／TPL-R27 與 ADM-R28／AC27 一致：純改名才有隱含預設；其他內容改變時未選不可存；草稿不詢問。
- 刪除提示明確說明保留紀錄與草稿刪除的解除方式，取消不解除引用。
- 舊資料已有同名時，正規化標題未變的編輯仍可成功；新增 API 與 PostgreSQL 重用驗收。
- 存為範本持來源 `FOR SHARE` 到複製及稽核完成；PostgreSQL 以固定交錯及 `pg_stat_activity` 驗證兩種先後均互斥：先存完整複製、先刪回 404。
- 先紅後綠，補主線的未選阻擋測試；完整 `make check` 使用 `inspectflow_test_622` 與 4 個前端 worker。

## Issue #717：專案查核項目停用與恢復

延續 #435 的刪除限制；該次未做停用的範圍限制只適用原任務。

- 一支線性 migration `d717a4c9e201`，來源項目新增預設 true 的 `is_active`，SQLite／PostgreSQL 升降版保留來源與任務。
- 服務層沿用來源項目鎖；停用／恢復與稽核原子寫入；草稿持鎖後判定原集合，允許保留而不允許新加入停用項目。不得改派出 guard 去阻擋既有停用項目。
- 名稱檢查仍包含所有項目；停用名稱衝突用專用錯誤，存為範本選到停用來源時引導先恢復。
- 前端只修改 projectItems、projects、planning 的項目選單過濾；auditLabels 兩檔各純新增兩筆；既有說明面板接就近確認及停用收合區。
- 驗證 IP-AC23～IP-AC26：`test_project_item_activation.py`、`test_project_item_activation_migration.py`、`ProjectItemActivation.test.tsx`、`PlanningPage.test.tsx`、既有名稱錯誤與稽核標籤測試、demo 真 Chrome E2E；1280 淺色與 360 深色各拍停用確認、停用清單與恢復結果。
- 新增檔案之外，涉及專案項目的 model、service、API、錯誤碼及清單序列化；不修改帳號、角色、權限或範本頁。
- 整合回歸補齊 `tests/contract/test_route_access.py` 的兩個專案項目動作權限宣告；`tests/db/test_migrations.py` 的三個舊版測試以實際歷史欄位及既有綁定型別種入項目，避免目前 ORM 的 `is_active` Python 預設值滲入尚無此欄位的舊 schema，原 migration 與驗收斷言不變。

## #717 第 2 輪審查修正

依負責人工作單修正既有停用範圍的規格澄清與驗收：錯誤優先序、啟用同名優先、摘要只計啟用項目、選單重載裁除、草稿停用標示、兩個存為範本入口過濾、錯誤聚焦，以及 PostgreSQL 雙連線鎖等待。不新增或重用 R／AC 編號；仍為規格設計（非負責人裁定），沿用 #717 的負責人指示範圍。
