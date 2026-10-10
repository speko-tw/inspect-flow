# 查核計畫與任務（inspection-planning）

**代碼**：`IP`　**Phase**：P4　**狀態**：已凍結<br>
**前置規格**：`template-system`、`state-machines`、`domain-model`、`authentication`、`audit-log`、`api-conventions`<br>
**引用意圖**：[PR-01](../../intents/02-principles.md#pr-01)、[PR-04](../../intents/02-principles.md#pr-04)、[KD-03](../../intents/03-decisions-and-stack.md#kd-03)、[KD-36](../../intents/03-decisions-and-stack.md#kd-36)、[KD-40](../../intents/03-decisions-and-stack.md#kd-40)、[KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-54](../../intents/03-decisions-and-stack.md#kd-54)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[KD-57](../../intents/03-decisions-and-stack.md#kd-57)、[KD-58](../../intents/03-decisions-and-stack.md#kd-58)、[OQ-03](../../intents/05-open-questions.md#oq-03)；恢復時套用目前標準依負責人[裁定](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970733042)，該裁定已同步至 intents（PR #351）。<br>
**被擋議題**：無；Evidence／Report 不屬本規格範圍，依各自規格處理。

## 目的

讓有權限的內業人員依專案已建立的查核項目建立 `Inspection Plan`，並為現場查核建立 `Inspection Task`；任務固定建立當時的查核需求，讓後續修改能依裁定流程保留歷史（依據：架構基準 §2.5、§12.9、§18；[PR-04](../../intents/02-principles.md#pr-04)）。

## 範圍

**包含**：

- `Inspection Plan` 與 `Inspection Task` 的本功能資料欄位、關聯、API 與授權。
- 由內業依專案查核項目手動建立任務；MVP 不自動切分或產生任務。
- 任務建立時產生 `Task Requirement Snapshot`。
- 專案查核項目修改時，詢問是否重新查核；依裁定只作廢受影響項目的需求、結果及照片歷史，或更正既有 Snapshot 文字。
- `ProjectInspectionItem` 的 P4 擴充欄位，以及與 Plan、Task、Snapshot 的關聯。
- 專案選用的 `ProjectZone` 維護，以及 Task 的分區與補充地點資料。
- `state-machines` 已定義的 Plan／Task 規則；Evidence／Report 尚未裁定的轉換不屬本規格範圍，依各自規格處理。

**不包含**（注明移到哪份規格，或屬於哪一條非目標）：

- 依起訖點與 interval 自動產生任務；MVP 由內業手動建立，未來選用功能另議（[KD-36](../../intents/03-decisions-and-stack.md#kd-36)、[G-01](../../intents/05-open-questions.md#g-01)）。
- 範本庫與範本版本；由 `template-system` 定義，`Inspection Template` 不版本化（[KD-03](../../intents/03-decisions-and-stack.md#kd-03)）。
- 現場填寫及更正查核結果、實測值與照片，及任務完成欄位驗證；依 `state-machines`／[KD-54](../../intents/03-decisions-and-stack.md#kd-54)，現場結果與照片的新增／更正端點屬 0.7.x。P4 的 KD-55「不要重新查核」只更正 `Task Requirement Snapshot` 文字；選「要」時依補充裁定只標示受影響項目的既有結果／照片為作廢歷史，不提供結果／照片端點。
- Evidence 的獨立刪除與保留政策；受 G-05 阻擋，屬 `field-evidence`。
- Report 狀態、快照邊界與產製失敗；受 G-06、G-07 阻擋。已核發報告規則見 [KD-57](../../intents/03-decisions-and-stack.md#kd-57)，不在本規格實作。
- 不符合結果的改善追蹤與缺失管理；屬 0.7.x（[KD-54](../../intents/03-decisions-and-stack.md#kd-54)）。

## 使用情境

- 具專案查核計畫管理權限的內業人員，建立計畫並從該專案的查核項目逐筆建立任務。
- 內業建立任務時可填建議執行人；指派不構成排他限制，同專案具現場查核權限的成員皆可執行，系統記錄實際操作者（SM-Q12）。
- 內業修改專案查核項目時，系統詢問是否重新查核；選擇重查時只使受影響項目的舊需求、結果及照片作廢並保留歷史，其他項目不變；選擇不重查時更正相關 Snapshot 文字。
- 同專案具現場查核權限的成員，依 `state-machines` 規則開始、完成任務；實際查核人記在 Task 的領域資料欄位。完成任務後的結果或照片更正屬 0.7.x；P4 不提供這些更正端點（[KD-42](../../intents/03-decisions-and-stack.md#kd-42)）。

## 需求

以下技術欄位、端點與表示法若沒有直接的已裁定來源，均屬**規格設計（非負責人裁定）**。業務依據為 main 的 [KD-55](../../intents/03-decisions-and-stack.md#kd-55)／[KD-56](../../intents/03-decisions-and-stack.md#kd-56) 及負責人補充情境裁定。本規格的 OQ-09 未定細節只以明示的規格設計（非負責人裁定）收斂，不表示負責人已裁定。

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| IP-R01 | 系統**必須**提供專案範圍的 `Inspection Plan`，並由後端依專案權限檢查建立、讀取與修改；端點使用 `/api/v1`、UUID 與共用錯誤契約。 | 必須 | [PR-01](../../intents/02-principles.md#pr-01)、[API-R01](../api-conventions/spec.md#需求)、[API-R06](../api-conventions/spec.md#需求)；欄位及端點為規格設計（非負責人裁定） |
| IP-R02 | 內業人員**必須**依專案既有 `ProjectInspectionItem` 手動建立 `Inspection Task`；一筆 Task 得包含多個項目，也得只含一個項目。MVP 不自動依起訖點、間距或其他推算規則產生任務，也不得要求 interval 才能建立計畫或任務。KD-55 標準變更不會自動建立 Task；依內業流程保留並更新原 Task，詳 IP-R04／IP-Q07。 | 必須／不得／得 | [KD-36](../../intents/03-decisions-and-stack.md#kd-36)、[G-01](../../intents/05-open-questions.md#g-01)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[負責人補充裁定](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970063986)；多對多／明細表表示為規格設計（非負責人裁定） |
| IP-R03 | 建立 `Inspection Task` 時，系統**必須**保存當時有效的 `Task Requirement Snapshot`；後續範本或專案查核項目變更不得一般性地改寫快照。KD-55 選「不要重新查核」時，相關且未取消 Task 的 Snapshot 文字**必須**一併更新，結果、照片及任務狀態不變；已取消 Task 恢復時的標準依 IP-R07。選「要重新查核」時，對未取消 Task 只將受影響項目的舊需求、結果與照片標示「標準變更作廢」並保留、可查找的歷史，並以新標準更新目前 Snapshot；已取消 Task 恢復時的標準依 IP-R07。同 Task 內未受影響項目及其結果、照片不變。系統**必須**以稽核事件記錄項目修改內容、選擇、操作者與時間。 | 必須 | [PR-04](../../intents/02-principles.md#pr-04)、[KD-03](../../intents/03-decisions-and-stack.md#kd-03)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[負責人補充裁定](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970063986)；Snapshot 欄位結構及稽核事件代碼為規格設計（非負責人裁定） |
| IP-R04 | 內業修改專案查核項目或查核項次並存檔時，系統**必須**詢問是否重新查核並說明後果。「使用」指同專案所有 Plan 中 Task 項目明細及 Snapshot 含該項目／項次。選「要」時，對已派出且未取消 Task 的受影響項目，舊需求／Snapshot 歷史**必須**標示「標準變更作廢」、保留並供搜尋，並以新標準更新目前 Snapshot。若該項目已有結果，系統另**必須**將其舊結果與照片標示「標準變更作廢」、保留可查並將該項目標記待重查；尚無結果時直接使用新 Snapshot，不標待重查。同 Task 其他項目及其結果、照片不變。受影響 Task 為 `COMPLETED` 時**必須**退回 `IN_PROGRESS`；為 `PENDING` 或 `IN_PROGRESS` 時維持原狀；有待重查項目的未取消 Task 不得完成。原 Task 為 `DRAFT` 時，在同一 Task 內套用新標準並更新 Snapshot，不保留作廢歷史、不改狀態、不建立新 Task。已取消 Task 若取消期間項目標準已修改，恢復時**必須**改用目前標準，並將原有結果中被修改的項目標示待重查；其他項目不受影響。此恢復行為依負責人裁定；如何在明細更新為目前標準時保留原 Snapshot、結果與待重查標記屬**規格設計（非負責人裁定）**。若任何受影響 Task 所屬 Plan 已封存，修改請求必須拒絕且不得寫入；內業先取消封存所有受影響 Plan 再重送。選「不要」時，相關且未取消 Task 的 Snapshot **必須**一併更正文字，不更動結果、照片及狀態；已取消 Task 恢復時的標準依 IP-R07。系統**必須**在同一交易寫入 `project_inspection_item.updated` 稽核事件，記錄修改內容、選擇、操作者與時間。 | 必須 | [KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[PR-04](../../intents/02-principles.md#pr-04)、[負責人補充裁定](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970063986)；歷史記錄方式與項目待重查表示為規格設計（非負責人裁定） |
| IP-R05 | 任務指派**必須**只作為建議；同專案具現場查核權限的成員皆得開始與完成已派出的任務。實際開始及完成操作者**必須**記錄在 Task 領域欄位（暫定為 `started_by`、`completed_by`），不得以指派人取代實際操作者，也不得以 AuditLog 取代這些欄位。 | 必須 | STM-R11：[SM-Q12](../state-machines/spec.md#sm-q12)；實際操作者欄位名稱為規格設計（非負責人裁定） |
| IP-R06 | 第一筆 Task 派出時，系統**必須**自動將 Plan 設為 `IN_PROGRESS`。零 Task 的 Plan 為 `DRAFT`；有任何 `DRAFT` Task 時 Plan 不得為 `COMPLETED`，且新增 `DRAFT` Task 至 `COMPLETED` Plan 時須回到 `IN_PROGRESS`。Plan 至少有一筆可納入完成判定的 Task，且所有未取消 Task 均為 `COMPLETED`、沒有待重查項目時，Plan **必須**自動完成；只要未取消 Task 仍有待重查項目，該 Task 不得完成，Plan 也不得完成。Task 至少一筆且全部 Task 均已取消時，Plan **必須**自動成為 `CANCELLED`；若至少一筆 Task 已完成、其餘均已取消，Plan **必須**為 `COMPLETED`。取消封存時，系統**必須**按當前 Task 狀態重新衍生 Plan 有效狀態；不得依封存前狀態直接還原。用戶端不得直接設定衍生狀態。 | 必須／得／不得 | [KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[STM-R02](../state-machines/spec.md#需求)；待重查項目完成門檻為規格設計（非負責人裁定） |
| IP-R07 | 尚未派出的 `DRAFT` Task 得由內業直接硬刪除，不得取消；刪除動作**必須**另寫 `inspection_task.deleted` AuditLog 事件，記錄操作者、時間與內容摘要。派出後的 `PENDING` 或 `IN_PROGRESS` Task 得取消，已完成 Task 不得取消。取消時**必須**填原因、保留既有結果與照片、顯示「已取消」，保存取消前狀態且不計入 Plan 完成判定。已取消 Task 得恢復至取消前狀態並繼續查核；若取消期間標準變更，恢復時**必須**改用目前標準，並將原有結果中被修改的項目標示待重查。恢復不要求原因，操作者、時間與狀態變更須保留為歷史紀錄。上述恢復標準依[負責人裁定](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970733042)；恢復沿用取消權限、不另設恢復原因為**規格設計（非負責人裁定）**。 | 必須／不得／得 | [KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[負責人裁定](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970733042)；刪除方式、AuditLog 事件與欄位為規格設計（非負責人裁定） |
| IP-R08 | P4 **不得**提供結果或照片新增／更正端點；本規格中的 Snapshot 文字更新，不屬結果或照片端點。KD-42 所述已完成任務結果／照片更正與修正紀錄屬 0.7.x。系統**不得**提供一般人工重新開啟 `COMPLETED` Task 的端點；但 KD-55 選「要」重新查核時，系統必須依項目級補充裁定自動將受影響 Task 由 `COMPLETED` 轉回 `IN_PROGRESS`，這是標準變更觸發的明確例外，不是人工重新開啟。 | 必須／不得 | [KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[負責人補充裁定](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970063986)、[STM-R03](../state-machines/spec.md#需求)；版本範圍依 `state-machines` 與 06-versioning-and-milestone-governance |
| IP-R09 | 系統**必須**以資料表示各專案的查核項目與任務，不得為特定項目寫死條件分支；所有狀態與權限變更由後端覆核。Task 建立後為 `DRAFT`，僅內業派出後才對現場可見；Plan 在第一筆 Task 派出時自動進入 `IN_PROGRESS`。 | 必須 | [PR-01](../../intents/02-principles.md#pr-01)、[PR-09](../../intents/02-principles.md#pr-09)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56) |
| IP-R11 | `Inspection Task.dispatched_at` **必須**在首次 `DRAFT → PENDING` 派送時於同一交易記錄伺服器 UTC 時間；之後的狀態轉換（含取消與恢復）不得更改。新建 `DRAFT` 為空值。migration 對既有非 `DRAFT` Task 以 `created_at` 近似回填、既有 `DRAFT` 留空；migration 只新增欄位與更新資料，不重建 Task 資料表。Task API 回應須包含 `dispatched_at`。不在本次新增派送稽核事件。以上是規格設計（非負責人裁定）。 | 必須 | `dispatched_at`、歷史回填及 API 回應依 #416 維護者裁定；資料演進與介面細節為規格設計（非負責人裁定） |
| IP-R12 | （#538 的正式行為，於 `authentication` 任務 P 合併時生效；此前維持現行行為。）可指派成員端點 `GET /api/v1/projects/{project_id}/inspection-task-assignees` **必須**只列啟用中（`is_active`）、同專案、具 `inspection_task.inspect` 且具查核模組「可使用」（`inspection.use`，AUT-R19）的成員；已停用的成員**不得**出現在候選。停用者在既有 Task 上的建議指派保持不變（DOM-R67）；未完成 Task 的改派由內業以既有的修改建議指派人操作（`inspection_task.assign`、`:assign`）完成，管理畫面在停用確認與成員清單提供前往「計畫與任務」的連結（ADM-R33）。新增停用者為建議指派人時，建立與派出的驗證回既有的指派人無效錯誤 | 必須 | 負責人裁定（[#538](https://github.com/speko-tw/inspect-flow/issues/538)，2026-10-09，問題 5：離職先停用、未完成任務由內業改派，見 [KD-69](../../intents/03-decisions-and-stack.md#kd-69)）；候選過濾的細節與新增指派的驗證為規格設計（非負責人裁定） |
| IP-R10 | `Project` **得**依需求設定零筆以上 `ProjectZone`；具 `project_zone.manage` 權限的專案內業人員**得**新增、改名及刪除分區；分區 CRUD 與列表 API 路徑見下方介面表。`Inspection Task` **得**保存同專案的 `zone_id` 與選填 `location_text`（補充文字，上限 256 字元）；地點屬單一 Task 的執行位置，不是查核需求，因此不納入 `Task Requirement Snapshot`；Snapshot 只保存查核標準。若專案有分區，建立 Task 時**必須**選一筆該專案分區；若沒有分區，`zone_id` **必須**為空，只能填補充文字。每個 API 均須確認分區、Task 與 Plan 屬於同一 Project。分區有 Task 引用時不得刪除，回應 409；新增、改名及刪除成功時各寫一筆 AuditLog。分區名稱最多 128 字元（沿用 `Project.name` 的暫定上限），輸入先 trim 並存為 trim 後的名稱；trim 後不得為空，否則回 422。再以 Unicode casefold 比對，在同專案內唯一；重複名稱回 409。`location_text` 最多 256 字元（沿用 `Project.site_location` 的暫定上限）。Task 地點由具 `inspection_task.manage` 權限者在 `DRAFT`、`PENDING`、`IN_PROGRESS` 狀態修改，且須遵守上述分區與文字規則；`COMPLETED`、`CANCELLED` Task 及封存 Plan 期間均不得修改。成功修改必須以 `inspection_task.location_updated` 稽核事件記錄操作者、時間及修改前後地點。讀取 Task 的回應**必須**內嵌所屬分區 ID 與名稱；授權只檢查 `inspection_task.read`，不得要求現場查核人員另有 `project_zone.read`。這些長度、空名稱拒絕、正規化算法、Task 地點可修改狀態與事件代碼為**規格設計（非負責人裁定）**。 | 必須／得／不得 | [KD-40](../../intents/03-decisions-and-stack.md#kd-40)、[KD-58](../../intents/03-decisions-and-stack.md#kd-58)、[OQ-03](../../intents/05-open-questions.md#oq-03)；技術細節為規格設計（非負責人裁定） |
| IP-R11 | 系統**必須**提供專案流程摘要 API，回傳專案識別 `{id, project_code, name}`、成員、查核項目、分區、計畫數、可見 Task 各狀態數、待重查 Task 數，以及缺少建議指派人的草稿數；所有具摘要讀取權限者均可讀專案識別欄位。非 Admin 必須是專案成員且具 `inspection_plan.read`、`project_zone.read`、`inspection_task.read` 或 `inspection_task.inspect` 任一權限。`viewer_permission_codes` 必須回傳呼叫者在該專案的有效權限碼；Admin 回傳全部專案權限碼。系統**必須**以資料庫聚合計數，不得載入完整資料列。`task_counts` 固定含 `DRAFT`、`PENDING`、`IN_PROGRESS`、`COMPLETED`、`CANCELLED` 五欄。Task 狀態數、待重查數、草稿待派出數及缺少建議指派人數是否可見，以 `task_counts_visible` 表示；只有 `inspection_plan.read` 或 `project_zone.read` 而沒有 `inspection_task.read`／`inspection_task.inspect` 時為 `false`，數值回 0。Task DRAFT 可見性沿用 `inspection_task_visibility_filters`：沒有 `inspection_task.read` 者看不到 DRAFT，其計數為 0。`dispatch_draft_tasks` 及 `draft_tasks_missing_assignee` 只計未封存 Plan 下可見的 DRAFT Task；缺少建議指派人是指 Task 的 `assignee_id` 為 null。`pending_reinspection_task_count` 只計至少一個項目待重查且狀態為 `PENDING` 或 `IN_PROGRESS`、所屬 Plan 未封存的不同 Task 數。`next_steps` **必須**依序列出 `add_members`、`add_inspection_items`、`create_plan`、`dispatch_draft_tasks`、`complete_reinspection`；每筆帶 `count` 與 `pending`，前三步在 count 為 0 時 pending，後兩步在 count 大於 0 時 pending。`primary_step` 為第一筆 pending 的代碼；全部完成時為 null。非法 UUID 路徑參數依 FastAPI 型別驗證回 422；非 Admin 對不存在或非成員專案回 403；Admin 查詢不存在專案回 404。欄位、代碼與詳細錯誤契約為**規格設計（非負責人裁定）**。 | 必須／不得 | [PR-01](../../intents/02-principles.md#pr-01)、[AUT-R19](../authentication/spec.md#需求)；API 表示為規格設計（非負責人裁定） |

## 資料

共通 UUID、建立／修改時間及操作者欄位沿用 `database-foundation`。完整的 `Inspection Plan`、`Inspection Task`、`Task Requirement Snapshot` 欄位與關聯由本規格補充；`Project`、`User`、`ProjectMember` 沿用 `domain-model`；`ProjectInspectionItem` 的範本結構與子表沿用 `template-system`，本規格只定義 P4 擴充部分。

以下為**規格設計（非負責人裁定）**：`Inspection Plan` 以 `project_id` 關聯專案；`Inspection Task` 以 `plan_id` 關聯計畫，並有選填 `zone_id` 與 `location_text`；分區外鍵必須與 Plan 所屬 Project 相同。Task 與 `ProjectInspectionItem` 採多對多關聯，可用 Task 項目明細表實作；每筆明細保存對應專案項目及建立當時的 `Task Requirement Snapshot`，不得以目前範本或目前專案項目內容靜默覆寫歷史。KD-55 選「不要」重新查核時，Snapshot 文字更正是明確例外，必須保留變更紀錄；其餘歷史需求仍須可追溯。精確欄位型別、唯一性、快照子表及刪除約束由 T1 設計並以 migration 驗收。

<a id="開工門檻逐實體比對"></a>
### 開工門檻逐實體比對

依 [README 部分凍結規則](../README.md#partial-freeze)，逐項核對 G-01～G-07、OQ-06 與 OQ-09 的「為什麼要先決定」及選項原文；「字面命中」只以引用另一實體 UUID 的欄位，不作為對被引用實體本身的阻擋。OQ-09 明確點名 Plan／Task，已裁定行為依 KD-42、KD-55～KD-57；本文未裁定的資料表示與剩餘狀態邊界均標為規格設計（非負責人裁定），不宣稱為負責人裁定。

| 實體 | 門檻與原文理由／選項比對 | 結論與理由 |
|---|---|---|
| `Inspection Plan` | G-01 的理由明列 `Inspection Plan`，選項 A 是 interval 屬 Template、B 是 Plan 輸入；KD-36 已定 MVP 不設 interval，未來選用欄位留待該功能。G-02 原文只談 Evidence 原圖模型及儲存鍵；G-03 選項只談編輯結果何時可見、原圖何時上傳及重試；G-04 選項只談 Evidence Variant 核可治理，裁定後尚有缺圖能否出報表等餘項；G-05 選項只談 Evidence DELETE、報告引用及保留期限；G-06 是 Report 狀態；G-07 是 Report 快照及版次；OQ-06 是 Result 欄位。以上均未要求 Plan 新欄位或狀態。OQ-09 明列 Plan 狀態，已裁定部分依 KD-56；派出前狀態、空 Plan 等細節在本規格標示規格設計。 | 凍結 MVP Plan 對 Project 關聯及需求 IP-R01、R06、R09。未來 interval 不在凍結欄位內；G-02～G-07／OQ-06 的選項不改變 Plan 本身欄位或狀態。OQ-09 未決細節不冒稱負責人裁定。 |
| `Inspection Task` | G-01 理由明列 Task 與 Snapshot，選項 A/B 決定的是未來 interval 歸屬；KD-36 已排除 MVP interval。G-02 儲存鍵路徑範例含 `<task_id>`，此為引用 Task 的 ID，不增加 Task 欄位或改其規則；G-02～G-05 的原文選項分別限於 Evidence 原圖、編輯上傳時序、Variant 核可、Evidence 刪除保留，未要求 Task 欄位或狀態改動。G-06／G-07 僅 Report 狀態與報告快照邊界。OQ-06「為什麼要先決定」明列任務完成判定邏輯；完成所需資料已依 KD-54 裁定，Task 的狀態轉換與伺服器覆核由 state-machines 定義，不新增 Task 欄位。OQ-09 明列 Task 狀態與更正例外；KD-42、KD-55、KD-56 已裁定的業務行為照文引用，未裁定的細節以規格設計標示。 | 凍結 Task 對 Plan 關聯及需求 IP-R02～R09。G-02 的 `task_id` 僅作 ID 引用，不改 Task 本身欄位／規則；OQ-06 的完成條件有 KD-54 依據，Task 狀態行為由 state-machines 負責；Evidence／Report／Result 議題不改 Task 定義。OQ-09 的未知細節依規格設計明示，不升格為負責人裁定。 |
| `ProjectInspectionItem`（P4 擴充） | G-01 選項討論 Template Item 與 Plan 的 interval 歸屬，KD-36 已定 MVP 項目由內業事先提供；G-02～G-05 的 why/options 分別談照片儲存、上傳編輯、核可、刪除政策，會影響被參照的歷史證據，不改此專案項目的欄位契約。G-06／G-07 是 Report 狀態及快照；OQ-06 的 Result 欄位由 `template-system`／Result 責任規格定義，不在 P4 擴充。OQ-09 明列標準變更與未開始 Task，KD-55 已定修改及重查流程；套用表示列作規格設計。 | 凍結本規格限定的 P4 標準修改與影響追蹤責任（IP-R03、R04）；不含 interval、Evidence 刪除或 Report／Result 欄位。KD-55 業務規則依原文，未定資料表示標為規格設計。 |
| Task 項目關聯 | G-01 原文問 interval 是否快照至 Task Requirement Snapshot，沒有裁定未來 interval；MVP 無 interval。G-02～G-05 只改 Evidence 本身及照片生命週期，沒有指定 Task 項目關聯鍵。G-06／G-07 只問 Report 狀態、快照時點與版次；OQ-06 只問 Result 語意。OQ-09 及 KD-55 補充明列只影響被修改項目；一筆 Task 得含多項目已依 #103 裁定。 | 凍結多項目關聯及項目級影響範圍（IP-R02～R04）；關聯表／明細表的具體結構是規格設計（非負責人裁定）。未來 interval、Evidence 與 Report 規則不納入此關聯。 |
| `Task Requirement Snapshot` | G-01 why 原文直接問 interval 是否快照到此實體，選項 A/B 尚有未來歸屬分歧；KD-36 已裁定 MVP 不設 interval，因此本期不存 interval。G-02～G-05 原文分別涉及 Evidence 版本、上傳編輯、核可、Evidence 獨立刪除／報告引用，不要求改 Snapshot 欄位；KD-55 作廢照片及結果另依其明確裁定保留歷史。G-06／G-07 的選項只談 Report 狀態及 Report Snapshot 邊界；OQ-06 的 Result 內容不是需求快照欄位。OQ-09 要求建立 Task 時有需求快照，KD-55「不要」是更正例外；未決新舊標準表示明標為規格設計。 | 凍結建立時保存項目需求、不可靜默覆寫及 KD-55 更正／作廢歷史責任（IP-R03、R04）。未來 interval 不進本期 Snapshot；具體欄位／子表及新舊版本並存方式是規格設計（非負責人裁定）。 |

任務組成依負責人[情境裁定](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5969654262)：一筆 Task 得含多筆查核項目；具體多對多關聯或明細表是**規格設計（非負責人裁定）**。依[補充裁定](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970063986)，選擇 KD-55 重查時只標示受影響項目的既有需求、結果與照片為「標準變更作廢」，保留並可查找；Task 其他項目與結果不變，Task 回到 `IN_PROGRESS` 以待重新查核。來源 Task 若為 `DRAFT`，則同一 Task 更新受影響標準及 Snapshot，不作廢、不改狀態、不建立新 Task。這項補充依負責人留言 5970063986；#346 是追蹤 issue，對應 PR #347 已合併。本項目明細各自保存狀態及歷史，是**規格設計（非負責人裁定）**。Task 另記可空的 `assignee_id` 作為建議指派；實際查核者是 Task 領域資料，暫定欄位為 `started_by`、`completed_by`（及相應時間欄位），非 AuditLog 替代物。

**規格設計（非負責人裁定）**：Plan 建立時為 `DRAFT`，空 Plan 保持 `DRAFT`；Task 建立後為 `DRAFT`，現場不可見。未派出的 `DRAFT` Task 不是 `CANCELLED`，不納入全數取消的判定。首次派出前 Plan 維持 `DRAFT`；具權限的內業派出 Task 後，該 Task 才對現場可見，首筆派出使 Plan 成為 `IN_PROGRESS`。任何 `DRAFT` Task 都阻止 Plan 成為 `COMPLETED`；新增 `DRAFT` Task 至 `COMPLETED` Plan 時，Plan 回到 `IN_PROGRESS`。Plan 狀態依當前 Task 重新衍生；`有缺失` 是顯示旗標，不是 Plan 或 Task 狀態。

KD-55 原 SM-Q03 技術提案是整筆 Task 作廢並建立新 Task；本規格依 2026-10-03 補充裁定改為項目級作廢，不再採用整筆 Task 取代。Task 項目明細各自保存狀態與歷史，只有受影響項目的結果／照片標記「標準變更作廢」；既有 Task 保持原識別碼並回到 `IN_PROGRESS`。原 Task 是 `DRAFT` 時直接更新該筆 Task 的標準及 Snapshot，不作廢也不更改狀態。上述流程及每項狀態欄位是依補充裁定形成的**規格設計（非負責人裁定）**；已合併的 `state-machines` SM-Q03 已反映 KD-55 項目級行為。

Plan 的有效狀態為 `DRAFT`、`IN_PROGRESS`、`COMPLETED`、`CANCELLED`；另有 `ARCHIVED` 封存狀態。依 KD-56，任何狀態皆可封存；封存中的 Plan 及所屬 Task 均唯讀。取消封存後依當前 Task 狀態重算 Plan 狀態，不保存或還原 `archived_from_status`（**規格設計（非負責人裁定）**）。已合併的 `state-machines` SM-Q03 已反映 KD-55 項目級規則。至少一筆 Task 且全部取消時 Plan 為 `CANCELLED`；至少一筆完成且其餘均取消時為 `COMPLETED`；零 Task 維持 `DRAFT`。Task 狀態為 `DRAFT`、`PENDING`、`IN_PROGRESS`、`COMPLETED`、`CANCELLED`；`DRAFT` 可硬刪除、不可取消，派出後為 `PENDING`，`PENDING`／`IN_PROGRESS` 得取消並可恢復至取消前狀態，完成 Task 不可取消。`有缺失` 為旗標而非狀態（**規格設計（非負責人裁定）**）。含 `DRAFT` Task 的 Plan 不得為 `COMPLETED`。任何 Task 仍有待重查項目時不得完成；KD-55 觸發的項目重查只讓原 `COMPLETED` Task 轉為 `IN_PROGRESS`，`PENDING`／`IN_PROGRESS` Task 維持原狀。項目層級狀態／待重查表示為規格設計（非負責人裁定）。

`ProjectInspectionItem` 的來源名稱、套用時間與既有結構沿用 `template-system` TPL-R08；本規格增補足以支援後續任務建立、修改影響追蹤及 KD-55 作廢／更正紀錄的欄位。任何歷史任務資料不得因來源項目變動而無聲改寫。

`project_inspection_item.updated` 是 KD-55 項目修改及重新查核選擇的 AuditLog 事件；事件目錄的 `before`／`after` 登記項目修改欄位與所選重新查核旗標。DRAFT Task 硬刪除另以 `inspection_task.deleted` 記錄 Task 識別碼、操作者、時間及內容摘要；刪除事件與硬刪除在同一交易寫入。Task 取消以 `inspection_task.cancelled` 記錄原因、操作者、時間及狀態；恢復以 `inspection_task.restored` 記錄操作者、時間及恢復前後狀態，不記恢復原因。Task 地點修改以 `inspection_task.location_updated` 記錄 Task 識別碼、操作者、時間及修改前後的 `zone_id`／`location_text`，與地點更新在同一交易寫入。上述新增事件的代碼與欄位為**規格設計（非負責人裁定）**，由 T2 登記。Task 的 `started_by`、`completed_by` 是領域資料欄位，與上述 AuditLog 事件用途不同。

## 介面

下列路徑與方法為**規格設計（非負責人裁定）**；實作須遵守 [api-conventions](../api-conventions/spec.md)，權限代碼依 `authentication`／`domain-model` 登記，預設拒絕。KD-55／KD-56 已是合併意圖；KD-55 項目級重查依負責人補充裁定，`state-machines` 的 SM-Q03 已依 KD-55 項目級裁定同步；本規格凍結範圍見標頭。

| 方法 | 路徑 | 用途 | 權限 |
|---|---|---|---|
| GET | `/api/v1/projects/{project_id}` | 讀取單一專案基本資料（`id`、`project_code`、`name`、預計起訖日）；Project 不設狀態欄位（DOM-R43） | `inspection_plan.read`；Admin 回完整欄位 |
| GET | `/api/v1/projects/{project_id}/workflow-summary` | 讀取專案識別（`id`、`project_code`、`name`）、流程計數、呼叫者有效權限碼、任務數可見旗標、待辦步驟與主要步驟；非法 UUID 回 422 | 專案成員具 `inspection_plan.read`、`project_zone.read`、`inspection_task.read` 或 `inspection_task.inspect` 任一權限；Admin 全部可讀 |
| GET | `/api/v1/projects/{project_id}/inspection-plans` | 列出專案計畫 | `inspection_plan.read` |
| POST | `/api/v1/projects/{project_id}/inspection-plans` | 建立計畫，初始為 `DRAFT` | `inspection_plan.create` |
| GET | `/api/v1/projects/{project_id}/zones` | 列出專案分區 | `project_zone.read` |
| POST | `/api/v1/projects/{project_id}/zones` | 新增專案分區 | `project_zone.manage` |
| PATCH | `/api/v1/projects/{project_id}/zones/{zone_id}` | 修改分區名稱 | `project_zone.manage` |
| DELETE | `/api/v1/projects/{project_id}/zones/{zone_id}` | 刪除未被 Task 引用的分區；被引用時回 409 | `project_zone.manage` |
| GET | `/api/v1/inspection-plans/{plan_id}` | 讀取計畫、任務與摘要 | `inspection_plan.read` |
| PATCH | `/api/v1/inspection-plans/{plan_id}` | 修改計畫資料；用戶端不得直接設定狀態 | `inspection_plan.manage` |
| POST | `/api/v1/inspection-plans/{plan_id}/tasks` | 由一筆或多筆專案查核項目建立一筆 `DRAFT` Task 及各項 Snapshot；輸入 `zone_id`、`location_text` 作為地點；現場不可見 | `inspection_task.create` |
| POST | `/api/v1/inspection-tasks/{task_id}:dispatch` | 內業派出草稿任務，使其對現場可見；第一筆派出時 Plan 進入 `IN_PROGRESS`，回應含首次派送時間 `dispatched_at` | `inspection_task.dispatch` |
| POST | `/api/v1/inspection-tasks/{task_id}:assign` | 設定或清除建議執行人 | `inspection_task.assign` |
| POST | `/api/v1/inspection-tasks/{task_id}:start` | 開始執行任務 | `inspection_task.inspect` |
| POST | `/api/v1/inspection-tasks/{task_id}:complete` | 提交任務完成動作 | `inspection_task.inspect`；完成欄位驗證與結果寫入依現場規格 |
| DELETE | `/api/v1/inspection-tasks/{task_id}` | 硬刪除尚未派出的 `DRAFT` Task；派出後不得刪除 | `inspection_task.delete_draft` |
| POST | `/api/v1/inspection-tasks/{task_id}:cancel` | 取消已派出且未完成的 Task，body 必含原因；保存取消前狀態、結果及照片。封存 Plan 下不得操作 | `inspection_task.cancel` |
| POST | `/api/v1/inspection-tasks/{task_id}:restore` | 恢復已取消任務至取消前狀態，若取消期間標準變更則恢復時依目前標準標記受影響項目待重查；body 不含原因 | `inspection_task.cancel`（沿用取消權限；規格設計，非負責人裁定） |
| PATCH | `/api/v1/inspection-tasks/{task_id}` | 修改 `DRAFT`、`PENDING`、`IN_PROGRESS` Task 地點；已完成、已取消 Task 或封存 Plan 下拒絕；回應含 `zone: {id, name}`，名稱隨 Task 讀取授權回傳 | `inspection_task.manage` |
| GET | `/api/v1/inspection-tasks/{task_id}` | 讀取任務及需求快照；回應內嵌所屬分區 `{id, name}`，不另要求 `project_zone.read` | `inspection_task.read` |
| POST | `/api/v1/inspection-plans/{plan_id}:archive` | 封存任何有效狀態的計畫 | `inspection_plan.archive` |
| POST | `/api/v1/inspection-plans/{plan_id}:unarchive` | 取消封存並依目前 Task 狀態重算 Plan 有效狀態 | `inspection_plan.unarchive` |
| PATCH | `/api/v1/projects/{project_id}/inspection-items/{project_inspection_item_id}` | 修改專案查核項目及子表；契約見下 | `project_inspection_item.edit` |
| GET | `/api/v1/inspection-plans/{plan_id}/tasks` | 以 cursor 列出計畫任務 | `inspection_plan.read` |
| GET | `/api/v1/projects/{project_id}/inspection-tasks` | 以 cursor 列出專案 Task；現場查核者看不到 DRAFT Task | `inspection_task.read` 或 `inspection_task.inspect` |
| GET | `/api/v1/projects/{project_id}/workflow-summary` | 回傳成員、查核項目、分區、計畫與可見 Task 的聚合數量，以及依序排列的 `next_steps` | 專案成員具 `inspection_plan.read`、`project_zone.read`、`inspection_task.read` 或 `inspection_task.inspect` 任一權限；Admin 全部可讀 |
| GET | `/api/v1/projects/{project_id}/inspection-items/{project_inspection_item_id}/tasks` | 列出使用此專案查核項目的 Task，含 Plan 名稱、封存狀態與 Task 狀態，供修改前確認影響 | `project_inspection_item.edit` |
| GET | `/api/v1/projects/{project_id}/inspection-task-assignees` | 列出同專案且具 `inspection_task.inspect` 的可指派成員 | `inspection_task.create` 或 `inspection_task.assign` |
| GET | `/api/v1/field/inspection-tasks` | 由 Field 查詢跨專案已派 Task；預設本人，支援全部範圍、專案篩選及 cursor | Admin 或任何專案的 `inspection_task.inspect`；逐筆只回有權限資料 |
| GET | `/api/v1/field/inspection-tasks/{task_id}` | Field 安全詳情，只回目前需求快照及必要顯示欄位；隱藏草稿與無權限資源 | `inspection_task.inspect`；不存在、DRAFT 或無權限回 404 |

被引用分區的刪除端點 `DELETE /api/v1/projects/{project_id}/zones/{zone_id}` 回 409 `project_zone.in_use`。

分區同名的新增與改名端點遇到衝突時，回 409 `project_zone.name_conflict`。

權限代碼**規格設計（非負責人裁定）**：依 [DOM-R30](../domain-model/spec.md#需求) 的 `<resource>.<action>` 格式及 [DOM-R35](../domain-model/spec.md#需求) 集中登記規則。各 task 所需代碼如下：

| 權限代碼 | 用途 |
|---|---|
| `project_zone.read` | 讀取專案分區 |
| `project_zone.manage` | 管理專案分區 |
| `inspection_plan.read` | 讀取計畫與所屬任務 |
| `inspection_plan.create` | 建立計畫 |
| `inspection_plan.manage` | 修改計畫非狀態資料 |
| `inspection_plan.archive` | 封存任何有效狀態的計畫 |
| `inspection_plan.unarchive` | 取消封存計畫 |
| `inspection_task.read` | 讀取任務 |
| `inspection_task.manage` | 修改非狀態欄位，包括地點；地點僅可在 `DRAFT`、`PENDING`、`IN_PROGRESS` Task 修改 |
| `inspection_task.create` | 建立任務 |
| `inspection_task.dispatch` | 派出任務並使其對現場可見 |
| `inspection_task.assign` | 修改建議指派人 |
| `inspection_task.inspect` | 開始與完成任務 |
| `inspection_task.delete_draft` | 刪除尚未派出的草稿 Task |
| `inspection_task.cancel` | 取消或恢復任務；恢復沿用此代碼，無獨立 `inspection_task.restore`（規格設計，非負責人裁定） |
| `project_inspection_item.edit` | 修改專案查核項目；沿用 `template-system` TPL-R09，不重複新增代碼 |

修改專案查核項目的 PATCH body 可帶項目欄位及完整子表集合；未提供的頂層欄位不變，若提供查核項次、標準、實測欄位或照片需求集合，該集合以完整取代方式處理，並套用與範本相同的結構驗證（每個項次恰好一筆照片需求、項次 `sequence` 不重複等），不符回 422。若有 Task 使用此專案查核項目，body **必須**帶布林值 `reinspect`；未提供時回 422 `project_inspection_item.reinspection_choice_required`。沒有任何 Task 使用時可省略，由後端判斷。整次修改、KD-55 選擇、Snapshot 更新／項目級結果及照片作廢須在同一交易內完成；任何一步失敗則全部回滾。「要」時只將相關 Task 明細中的受影響項目標示「標準變更作廢」，保留可搜尋的舊 Snapshot、結果與照片；`COMPLETED` Task 回到 `IN_PROGRESS`，`PENDING`／`IN_PROGRESS` Task 維持原狀，僅將受影響項目標記待重查；原 Task 為 `DRAFT` 則更新同一 Task 的標準與 Snapshot，不作廢、不改狀態。「不要」時更新相關 Task 的 Snapshot 文字，結果、照片、狀態不變。已取消 Task 遇標準變更時，在恢復操作依目前標準處理，規則見 IP-R07。

### API 表示與請求契約（規格設計，非負責人裁定）

- 單一專案 GET 對具 `inspection_plan.read` 的專案成員只回 `id`、`project_code`、`name`、`planned_start_date`、`planned_completion_date`。Admin 回傳 `client_name`、`site_location` 與 `warnings` 等完整欄位。Project 沒有狀態欄位（DOM-R43），因此回應不含 `status`；依 #361 審查裁決不新增衍生狀態。Plan 建立 body 為 `{ "name": string }`；修改 Plan 使用相同欄位的 PATCH，禁止提交狀態。Plan 回應含 `id`、`project_id`、`name`、`status`、`archived`、`created_at`、`updated_at`。計畫列表為 `{items, next_cursor}`，不內嵌 Tasks；單筆 Plan 詳情可內嵌 Tasks。
- 建立 Task body 為 `{ "item_ids": UUID[], "zone_id": UUID|null, "location_text": string|null, "suggested_assignee_id": UUID|null }`。Task 回應含 `id`、`project_id`、`plan_id`、`status`、`dispatched_at`、`zone_id`、`zone: {id,name}|null`、`location_text`、`assignee_id`、`assignee: {id,username,name_zh}|null`、`started_by`、`completed_by`、`cancellation_reason`、`cancelled_from`、`items`、建立與修改時間。`items` 含項目 ID、明細狀態、`needs_reinspection`、目前及歷史 Snapshot；Snapshot 含修訂、來源標準修訂、項目名稱／指示、來源範本名稱、有效性、作廢原因／時間與完整查核項次。
- 請求欄位上限（SEC-004，規格設計，非負責人裁定）：為擋下超大 payload，請求欄位在到達資料庫前先限制長度。計畫與分區名稱 body 上限 512 字元、`location_text` 1024 字元、取消原因 `reason` 與項目 `instruction` 2000 字元、項目 `title` 256 字元，`item_ids` 與 `inspection_points` 各最多 200 筆；超過回 422 `request.validation_failed`。計畫與分區名稱仍以 128 字元、`location_text` 仍以 256 字元為業務上限，超過這兩個值但未達請求上限時，維持回 `inspection_plan.invalid_name`、`project_zone.invalid_name`、`inspection_task.invalid_location`。巢狀項次欄位的上限見 [template-system](../template-system/spec.md#介面)。
- `:assign` body 為 `{ "assignee_id": UUID|null }`；`:cancel` body 為 `{ "reason": string }`；`:restore`、`:dispatch`、`:start`、`:complete`、`:archive`、`:unarchive` 不收 body。Task 地點 PATCH body 必含 `zone_id` 與 `location_text`，成功回應為完整 Task 表示，含分區 ID／名稱。
- Task 清單端點包含 Plan 下的 `/inspection-plans/{plan_id}/tasks`、專案下的 `/projects/{project_id}/inspection-tasks`，以及按專案查核項目列出的 `/projects/{project_id}/inspection-items/{project_inspection_item_id}/tasks`；三者均回 `{items, next_cursor}`。專案計畫列表不得內嵌 Task。項目影響列表的每筆回應另含 `plan_name`、`plan_archived`、`has_result`；結果 API 上線前（0.7.x）`has_result` 恆為 `false`。
- `workflow-summary` 回應欄位為 `member_count`、`inspection_item_count`、`zone_count`、`plan_count`、`task_counts`、`pending_reinspection_task_count` 與 `next_steps`。`task_counts` 固定包含 `DRAFT`、`PENDING`、`IN_PROGRESS`、`COMPLETED`、`CANCELLED` 五個整數欄位；`pending_reinspection_task_count` 計算至少有一筆待重查項目的不同 Task 數。聚合須由資料庫計數，不得先載入全部資料列。
- `next_steps` 固定依序回傳 `{code, count}`：`add_members`（成員數）、`add_inspection_items`（查核項目數）、`create_plan`（計畫數）、`dispatch_draft_tasks`（可見 DRAFT Task 數）、`complete_reinspection`（待重查 Task 數）。前三項的 count 為 0 時代表該步驟尚未完成；後兩項大於 0 時代表存在待處理工作。前端依此順序選取第一個符合條件的下一步。
- 此端點的讀取權限沿用專案讀取權限：非 Admin 必須是該專案成員，且具上述任一權限。沒有 `inspection_task.read` 的現場查核者不會取得 DRAFT 的 `task_counts` 或 DRAFT 導引數；其他 Task 狀態與待重查數依其可見 Task 計算。Admin 可讀全部狀態。專案其他彙總欄位只取路徑專案的資料。
- 權限不足回 `403 permission.denied`；通過權限檢查後專案不存在回 `404 resource.not_found`。非 Admin 查詢不存在或非成員專案依 AUT-R19 回 403。
- 可指派候選人端點只回同專案成員中具 `inspection_task.inspect` 權限者；列表外型為 `{items, next_cursor}`。候選人須在資料庫以成員、角色及權限關聯一次篩選，並在資料庫套用既有 `created_at, id` 排序、cursor 與 limit，不得先逐一讀取成員權限或載入全部候選人再分頁；SELECT 次數不得隨專案成員數線性增加。項目影響列表需 `project_inspection_item.edit`；候選人列表需 `inspection_task.create` 或 `inspection_task.assign`。
- `inspection_plan.read` 同時允許讀取 Plan 顯示所需的專案分區名稱；`project_zone.read` 仍是獨立分區列表權限。Task 回應內嵌 `zone` 不額外要求 `project_zone.read`。
- 具 `inspection_task.inspect` 而無 `inspection_task.read` 的使用者，讀取 `DRAFT` Task（Plan 詳情、Plan 任務列表、專案任務列表或 Task 詳情）一律隱藏；Task 詳情回 404 `resource.not_found`，列表不包含該 Task。
- 具體錯誤：不存在的資源回 404 `resource.not_found`。Plan／Task 是 global ID 路徑；所有單筆 Plan／Task 讀取、建立子 Task、修改、刪除、狀態轉換、封存及取消封存操作，非專案成員不論資源是否存在均回 404 `resource.not_found`，避免洩漏存在性；專案成員缺少對應操作權限依 AUT-R19 回 403 `permission.denied`，Admin 可操作。專案範圍的計畫／任務／項目影響列表先檢查專案權限，非成員回 403，且不查詢或回傳單筆資源存在資訊。Zone／項目以 `project_id` 為路徑範圍；資源屬於另一專案時回 404 `resource.not_found`，不洩漏跨專案存在性。所有格式錯誤的路徑 UUID 均在權限判斷前回 422 `request.validation_failed`，Admin 亦同。非法狀態轉換、封存中修改、地點不可修改、分區名稱重複或分區仍被引用分別回 409 `inspection_task.invalid_transition`、`inspection_plan.archived`、`inspection_task.location_locked`、`project_zone.name_conflict`、`project_zone.in_use`。取消原因 trim 後為空回 422 `inspection_task.reason_required`；Task 缺少項目、項目不屬於專案、分區缺少／不允許／跨專案、地點文字超過 256 字元、指派人不是同專案且具 `inspection_task.inspect` 的非 Admin 成員、項目重查選擇未提供，分別回 422 `inspection_task.items_required`、`inspection_task.invalid_project_item`、`inspection_task.invalid_zone`、`inspection_task.invalid_location`、`inspection_task.invalid_assignee`、`project_inspection_item.reinspection_choice_required`。Plan／分區名稱 trim 後為空或超過 128 字元，分別回 422 `inspection_plan.invalid_name`／`project_zone.invalid_name`；更新項目修訂未增加回 422 `project_inspection_item.revision_not_increased`；Task 有待重查項目未完成時回 422 `inspection_task.items_incomplete`。所有 404 使用共用 `resource.not_found`。
- Field API `GET /api/v1/field/inspection-tasks` 的回應為 `{items,next_cursor}`；每筆只含 `id`、`project_id`、`project_name`、`status`、`dispatched_at`、`location: {zone_name,location_text}`、`suggested_assignee: {name_zh}|null`。`GET /api/v1/field/inspection-tasks/{task_id}` 另含 `items`，每項只含目前 Snapshot 的標題、指示及查核點（文字／量測／照片要求）；不回傳 Plan ID、其他資料庫關聯 ID、其他人帳號、歷史 Snapshot 或內業專用欄位，但量測欄位 `id` 與 `numeric_standard.measurement_field_id` 為對應關係所需的例外。列表使用 `assigned_to_me=true` 預設篩選，可設 `false`；可選 `project_id`、`cursor`，`limit` 預設 50、範圍 1–100，排序及 cursor 均為 `dispatched_at DESC, id DESC`；量測欄位依 `sort_order, id` 排序。非 Admin 的專案可見範圍須由資料庫一次套用成員、角色與 `inspection_task.inspect` 權限關聯篩選；Admin 直接查詢符合條件的任務，不得先載入所有專案 ID。SELECT 次數不得隨該使用者的專案數線性增加。未登入 401；非 Admin 列表無任何專案 inspect 權限或指定專案無權限回 403 `permission.denied`；Admin 即使沒有專案權限或指定不存在的 `project_id` 仍回 200 空頁；有權限但無符合資料回 200 空頁；Field 詳情不存在、DRAFT 或無 inspect 權限一律回 404 `resource.not_found`。
- 專案查核項目 PATCH 成功回應包含修改後完整項目、`reinspection_selected`，以及 `affected_tasks`。每筆 Task 記錄 `task_id`、`prior_status`、目前 `status`、`needs_reinspection` 與處理動作 `draft_updated`、`returned_to_in_progress`、`needs_reinspection`、`updated` 或 `apply_current_standard_on_restore`。

若被修改項目關聯的 Task 位於已封存 Plan，請求須先被拒絕；內業取消相關 Plan 封存後才可重送修改。封存 Plan 的 Task 全部唯讀：`:start`、`:complete`、`:cancel`、`:restore`、DELETE 草稿及其他 Task 修改，均須先檢查所屬 Plan 是否封存；若已封存，一律回 409 `inspection_plan.archived`，再檢查 Task 狀態轉換。取消封存後依目前 Task 狀態重算 Plan 狀態。任何狀態皆可封存依 KD-56；取消封存後重算為本規格規則。已合併的 `state-machines` SM-Q03 已反映 KD-55 項目級行為。

`project_inspection_item.updated` 稽核事件採 ALG-R07～ALG-R10 欄位規則，由實作 task 登記至 [audit-log 事件目錄](../audit-log/spec.md#template-system-事件)的本規格專屬區段。此事件至少包含變更內容與 `reinspect` 選擇，並與項目、快照及任務變更同一交易寫入。其他實際查核者資料寫在 Task 欄位，不新增替代稽核事件。其餘成功回應、分頁與錯誤格式沿用 API 共用契約。

## 驗收條件

本表列出已裁定的業務行為，以及 OQ-09 留給本規格的規格設計（非負責人裁定）。

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| IP-AC01 | 使用者對專案有／沒有計畫建立權限 | 建立計畫 | 有權限者可建立且資料關聯正確；無權限者被拒絕，資料不變；用戶端不能任意設定狀態 | IP-R01、IP-R09 |
| IP-AC02 | 專案有多筆查核項目，沒有任何 interval | 內業建立一筆含多個項目的 Task，或建立只含單項的 Task | Task 僅含明確選取的項目；建立後為 `DRAFT` 且現場不可見；不要求 interval，不依間距自動產生任務 | IP-R02、IP-R09 |
| IP-AC03 | 專案項目含完整結構，且範本來源之後可能被修改 | 建立任務後修改來源範本或其他專案項目 | 任務快照仍代表建立當時內容；查詢任務需求不依賴目前範本內容 | IP-R03 |
| IP-AC04 | (1) 多 Plan 的 `PENDING`、`IN_PROGRESS` 或 `COMPLETED` Task 使用同專案項次，且 Plan 未封存；(2) 有受影響 Task 所屬 Plan 已封存；(3) 來源 Task 為 `DRAFT`；(4) 有目前為 `CANCELLED` 的 Task 使用同一項次 | (1) 選「要」修改項次；(2) 直接修改項次，再取消封存所有受影響 Plan 後重送；(3) 修改項次並選「要」；(4) 修改項次並選「要」 | (1) 保留並可搜尋受影響項目的舊需求／Snapshot，標示「標準變更作廢」；若已有結果，才另外將舊結果與照片標示作廢並將該項目標記待重查；尚無結果時直接使用新 Snapshot，不標待重查。其他項目不變。`COMPLETED` Task 回到 `IN_PROGRESS`；`PENDING`／`IN_PROGRESS` 維持原狀；有待重查項目時，完成該項目前 Task 不可完成；(2) 封存中請求拒絕且資料不變，Task 唯讀，取消封存後重送成功；(3) 原 `DRAFT` Task 更新標準及 Snapshot，不作廢、不改狀態、不硬刪除／建立新 Task；(4) 修改期間維持取消狀態及原紀錄；恢復時改用目前標準，僅在原結果有受影響項目時將其標記待重查，其他項目不變；皆記錄修改選擇與歷史 | IP-R03、IP-R04、IP-R06 |
| IP-AC05 | 一個專案項次已被未開始、進行中、已完成任務使用 | 內業修改 Snapshot 對應文字並選「不要」重新查核 | 相關 Task 的 Snapshot 文字一併更正，Task 狀態、結果與照片不變；系統記錄操作者、時間、選擇與更正內容 | IP-R03、IP-R04、IP-R08 |
| IP-AC06 | 任務有建議指派人，且同專案另有現場查核權限成員 | 非指派成員開始／完成任務 | 有權限者可執行；系統保存實際操作者而非建議指派人 | IP-R05 |
| IP-AC07 | (1) Plan 無 Task；(2) Plan 有 `DRAFT` Task；(3) Plan 已完成且新增一筆 `DRAFT` Task；(4) 有已派出未完成 Task；(5) Task 內有待重查項目；(6) 有一筆以上已完成 Task 且其餘取消；(7) 至少一筆 Task 且全部取消 | 建立／硬刪除草稿 Task、派出、完成、取消／恢復 Task | (1) 空 Plan 維持 `DRAFT`，且不能判為全取消；(2) `DRAFT` Task 阻止 Plan 完成，得硬刪除但不得取消，刪除時寫 `inspection_task.deleted` 事件且現場不可見；(3) Plan 回到 `IN_PROGRESS`，直至草稿刪除或派出並完成；(4) 派出後才可取消，取消保留結果／照片及取消前狀態，恢復沿用取消權限且不要求原因；若取消期間標準變更，恢復採目前標準並將受影響舊結果標示待重查，其他項目保留；完成 Task 不可取消；(5) 待重查項目完成前 Task 與 Plan 均不得完成；(6) Plan 為 `COMPLETED`；(7) Plan 為 `CANCELLED` | IP-R06、IP-R07、IP-R09 |
| IP-AC08 | Plan 處於 `DRAFT`、`IN_PROGRESS`、`COMPLETED` 或 `CANCELLED`；封存期間所屬 Task 不可操作 | 具權限者封存 Plan，再嘗試操作 Task，之後取消封存 | 任一狀態均可封存；封存期間 Task 唯讀；取消封存後依當前 Task 狀態重新計算有效 Plan 狀態，不使用封存前狀態欄位直接還原 | IP-R06 |
| IP-AC09 | `PENDING`、`IN_PROGRESS` 或 `COMPLETED` Task 使用被修改項次 | KD-55 選「要」或「不要」重新查核；呼叫 P4 API | 不存在結果／照片新增或更正端點，也不存在一般人工重新開啟 `COMPLETED` Task 的端點；「不要」只更新 Snapshot 文字且狀態、結果、照片不變；「要」保留並標示作廢受影響項目的舊需求／Snapshot 歷史，並以新標準更新目前 Snapshot；已有結果者另作廢舊結果與照片並標待重查，尚無結果者直接使用新 Snapshot、不標待重查。`COMPLETED` Task 回 `IN_PROGRESS`，`PENDING`／`IN_PROGRESS` 維持原狀；待重查項目完成前不得完成 Task；結果／照片更正端點仍屬 0.7.x | IP-R03、IP-R04、IP-R06、IP-R08 |
| IP-AC10 | 有管理 Plan、Task 或項目之請求；另有 Admin、具讀取權限的專案成員、無讀取權限的專案成員、非成員及不存在的 Plan／Task | 以非預期狀態值、跨專案識別碼或無權限帳號呼叫 API；非成員以全域 ID 讀取或操作既有 Plan／Task，或以各角色讀取、操作不存在的 ID | 後端拒絕不合法狀態或越權存取，其他專案資料不變；所有使用全域 ID 的單筆 Plan／Task 讀取、建立子 Task、修改、刪除、狀態轉換、封存及取消封存，對非專案成員與不存在資源均回 404；專案成員缺少對應操作權限回 403，Admin 維持可操作；專案範圍列表仍先檢查專案權限，不回傳單筆存在資訊；所有格式錯誤的路徑 UUID 均回輸入驗證錯誤，且不受 Admin 身分影響 | IP-R01、IP-R09 |
| IP-AC11 | 專案 P 有分區 Z1、專案 Q 有分區 Z2、專案 R 無分區；P、R 各有一筆尚無 Task 的 Plan | 以有／無 `project_zone.manage` 權限者新增 P 的未引用分區 Z3、修改 Z3 名稱並刪除 Z3；嘗試新增同名分區與 trim 後空白名稱；建立 P 的 T1 並引用 Z1，另嘗試引用 Q 的 Z2 或不提供分區；在 R 的 Plan 建立 T2；以 `inspection_task.manage` 修改 `DRAFT`、`PENDING`、`IN_PROGRESS` Task 地點，並嘗試修改 `COMPLETED`、`CANCELLED` Task 及封存 Plan 下的 Task；以只有 `inspection_task.read` 權限的現場查核者讀取 T1 | 有權限新增、改名及刪除未引用的 Z3 均成功且各產生一筆稽核事件，無權限回 403；同專案重複名稱（忽略前後空白及 Unicode casefold）回 409；trim 後空白名稱回 422；名稱與補充文字上限分別為 128、256 字元，超過回 422；T1 引用 Z2 或未提供 P 必要的 `zone_id` 回 422；R 的 T2 不得帶 `zone_id`，得單獨填 `location_text`；可編輯狀態的地點修改成功並各記一筆含前後值的稽核事件，跨專案分區拒絕；已完成、已取消或封存 Plan 下的地點修改拒絕且資料不變；Task 讀取回應含分區 ID 與名稱且不要求 `project_zone.read`；引用中的 Z1 刪除回 409 且資料不變。地點欄位不進 Task Requirement Snapshot | IP-R10 |
| IP-AC12 | 專案有各種 Task 狀態、已封存與未封存 Plan、待重查項目，且成員具不同專案讀取權限 | 以 Admin、具 `inspection_task.read` 權限者、只有現場查核權限者、只有 `inspection_plan.read` 或 `project_zone.read` 者讀取流程摘要；並以非成員、無讀取權限者及不存在專案查詢 | 回應只涵蓋指定專案；Task 狀態數符合可見性，`task_counts_visible` 正確，現場查核者的 DRAFT 數為 0；草稿待派出與缺少建議指派人數不含封存 Plan；待重查數只含未封存 Plan 下 `PENDING`／`IN_PROGRESS` Task，排除取消 Task；`next_steps` 每筆 `pending` 與 `primary_step` 正確，覆蓋中間狀態及全完成；非成員回 403、Admin 查不存在專案回 404、非法 UUID 回 422；聚合由資料庫完成 | IP-R11 |
| IP-AC13 | 專案有三位具 `inspection_task.inspect` 的成員：啟用且具 `inspection.use` 的 A、已停用的 B、啟用但缺 `inspection.use` 的 C；一筆未完成 Task 的建議指派人是 B（程式改造完成後的行為） | 呼叫可指派成員端點；內業把 Task 的建議指派人改為 A；嘗試把建議指派人設為 B、C | 候選只含 A；Task 原本指向 B 的建議指派保持到內業改派為止；改派 A 成功；指派 B、C 回既有的指派人無效錯誤；改派沿用既有行為 | IP-R12 |

## 決議追蹤

以下記錄 IP-Q01～IP-Q11 的處理狀態，供既有錨點連結使用。IP-Q02/Q05/Q06/Q09/Q10 已依 KD-55／KD-56 裁定更新；IP-Q11 已依負責人裁定改為恢復需求。逐條對照表見[開工門檻逐項比對](#開工門檻逐實體比對)；已裁定部分依 KD-54～KD-57 與 state-machines 凍結範圍引用，技術細節不得表述成負責人裁定。

<a id="ip-q01"></a>
- **IP-Q01：已併入 IP-Q09，不再是獨立待決題。** 原情境是 Plan 從建立至派出前的狀態與操作；其業務問題與「建立 Task 何時算派出」同屬 IP-Q09。保留本錨點供既有連結使用。
<a id="ip-q02"></a>
- **IP-Q02：已裁定。** 一個 Task 得包含多個查核項目；只查一項時也得建立只含該項目的 Task。情境：同趟檢查數個項目可放進同一任務，不同趟則分開建任務。Task 與項目的多對多／明細表方式為規格設計（非負責人裁定）；引用 KD-55／KD-56。保留本錨點。
<a id="ip-q03"></a>
- **IP-Q03：已解決的技術規則（規格設計，非負責人裁定）。** Plan 已完成後新增一筆 `DRAFT` Task，Plan 回到 `IN_PROGRESS`；有草稿 Task 時不得完成 Plan。草稿 Task 可刪除或派出；派出後須完成才可完成 Plan。若 Plan 已封存，須先取消封存；取消封存後依目前 Task 狀態重算 Plan 狀態。
<a id="ip-q04"></a>
- **IP-Q04：已裁定（KD-55），不再是待決題。** 情境：同一專案的多份 Plan 都引用被修改的項次。KD-55 要求處理該專案所有使用此項次的相關任務，不限目前開啟的 Plan；修改及重新查核選擇留有稽核紀錄。若改成只影響單一 Plan，須先處理意圖變更。保留本錨點供既有連結使用。
<a id="ip-q05"></a>
- **IP-Q05：已裁定。** 尚未派出的 `DRAFT` Task 得直接刪除，不得取消；派出後的未完成 Task 得取消，已完成 Task 不得取消。取消須填原因、顯示「已取消」、保留照片與結果，並保留取消前狀態及歷史；已取消 Task 得恢復至取消前狀態。硬刪除及刪除 AuditLog 事件為規格設計（非負責人裁定）。引用 KD-56。
<a id="ip-q06"></a>
- **IP-Q06：已裁定。** 至少一筆 Task 且全部 Task 均取消時 Plan 自動為 `CANCELLED`；至少一筆已完成、其餘均取消時為 `COMPLETED`；零 Task 維持 `DRAFT`，任何 `DRAFT` Task 阻止 Plan 完成。引用 KD-56。
<a id="ip-q07"></a>
- **IP-Q07：採用項目級重查技術設計（非負責人裁定）。** KD-55 選「要」時，舊需求／Snapshot 歷史均保留、標示「標準變更作廢」且可查找，並以新標準更新目前 Snapshot；已有結果的受影響項目，其舊結果與照片也標示作廢、保留可查，並標待重查；尚無結果的項目直接使用新 Snapshot，不標待重查。同 Task 其他項目維持有效。`COMPLETED` Task 回到 `IN_PROGRESS`；`PENDING`／`IN_PROGRESS` Task 維持原狀。來源 Task 為 `DRAFT` 時，在原 Task 套用新標準及 Snapshot，不保留作廢歷史。這依 KD-55 與負責人補充裁定整理為明細層級技術設計。
<a id="ip-q08"></a>
- **IP-Q08：技術呈現已採用（非負責人裁定）。** KD-55 選「要」時，舊需求／Snapshot 歷史標示「標準變更作廢」並保留；目前 Snapshot 套用新標準。已有結果的受影響項目之舊結果／照片也標示作廢並待重查；尚無結果者不標待重查。原 Task 狀態為 `IN_PROGRESS` 且有待重查項目時，完成補查後才可再次完成。其他項目及結果／照片仍有效。來源 Task 為 `DRAFT` 時直接更新原 Task，不顯示作廢。此處保留既有錨點。先前選項 B 的正確原意是一般 Task 顯示「待開始」、系統建立的重查 Task 顯示「尚未查核」，舊 Task 標示「標準變更作廢」；現依補充裁定不會系統建立重查 Task，因此該選項及「尚未查核」新 Task 呈現不再適用。
<a id="ip-q09"></a>
- **IP-Q09：已裁定（合併 IP-Q01）。** 新 Task 建立後為 `DRAFT`，現場不可見；內業派出後才對現場可見，第一筆 Task 派出時 Plan 自動進入 `IN_PROGRESS`。引用 KD-56。
<a id="ip-q10"></a>
- **IP-Q10：已裁定。** Plan 任何狀態都得封存；封存期間所屬 Task 唯讀。取消封存後依當前 Task 狀態重算 Plan 有效狀態，不依封存前狀態直接還原。引用 KD-56；`state-machines` 仍須在其責任範圍內與本規格狀態規則對齊。

## 變更紀錄

- 意圖變更跟進（負責人裁定，[#551](https://github.com/speko-tw/inspect-flow/issues/551)）：IP-Q02 的用語「抽查」改為「檢查」，行為與範圍不變；檢查層級改由專案設定帶出，欄位由 [#559](https://github.com/speko-tw/inspect-flow/issues/559) 處理 — [#551](https://github.com/speko-tw/inspect-flow/issues/551)
- 規格澄清（規格設計，非負責人裁定，#464）：專案查核項目 PATCH 提供子表集合時，改為套用與範本相同的結構驗證（每個項次恰好一筆照片需求、`sequence` 不重複等），不符回 422；原本重複 `sequence` 會回 500。合法輸入的行為不變 — [#464](https://github.com/speko-tw/inspect-flow/issues/464)
- 範圍變更（#472）：全域 ID 的 Plan／Task 讀取與操作對非成員隱藏存在性；格式錯誤的路徑 UUID 統一回 422 `request.validation_failed`。專案範圍列表維持先檢查專案權限 — [#472](https://github.com/speko-tw/inspect-flow/issues/472)
- 範圍變更（負責人指示，#446）：新增專案流程摘要 API、權限與聚合回應契約（IP-R11、IP-AC12）— [負責人指示](https://github.com/speko-tw/inspect-flow/issues/445#issuecomment-5988461779)
- 範圍變更（負責人指示，#369）：新增 `ProjectZone` 管理、Task 分區與補充地點欄位及其規則（IP-R10、IP-AC11）— [#73 裁定](https://github.com/speko-tw/inspect-flow/issues/73#issuecomment-5976192382)、[#369](https://github.com/speko-tw/inspect-flow/issues/369)
- 規格澄清（#369 留言，非負責人裁定）：分開說明 KD-55 選「要」與「不要」重新查核時對目前 Snapshot 的更新方式 — [#369](https://github.com/speko-tw/inspect-flow/issues/369)
- 凍結 Plan／Task、Task 項目關聯及 Snapshot 的 IP-R01～IP-R09、IP-AC01～IP-AC10；逐項核對開工門檻並更正 SM-Q12 的引用錨點 — #358
- 規格澄清：補充 Plan／Task 回應與動作 body、cursor 列表、項目使用 Task 清單、可指派候選人及錯誤碼；`inspection_plan.read` 可讀分區名稱，現場人員讀取 DRAFT Task 回 404；封存 Plan 下的 Task 動作一律先回 `inspection_plan.archived` — #361
- 規格設計（非負責人裁定，#416）：首次派送寫入 `dispatched_at`，後續狀態轉換維持不變；歷史非 DRAFT Task 以 `created_at` 近似回填；Task API 回應加入 `dispatched_at`，本次不新增派送稽核事件 — [#416 維護者裁定](https://github.com/speko-tw/inspect-flow/issues/416#issuecomment-5987138346)
- 規格澄清（#416，第 2 輪審查）：Field 詳情的量測欄位 ID 與數值標準對應為關聯 ID 例外；補充 Admin 列表空頁行為及量測欄位排序 — PR #443
- 規格澄清（規格設計，非負責人裁定，#462）：列表端點改以批次載入子資料，查詢數不隨每頁筆數成長；新增 Task 與 Plan 列表索引；請求欄位加長度與筆數上限。定為規格澄清，因為合法輸入的行為不變，上限都高於業務上限數倍，只是提早拒絕原本就不合理的超大請求 — [#462 盤點](https://github.com/speko-tw/inspect-flow/issues/462#issuecomment-5995612083)
- 意圖變更跟進（負責人裁定，[#538](https://github.com/speko-tw/inspect-flow/issues/538)，意圖見 KD-69）：新增 IP-R12、IP-AC13，可指派成員候選排除已停用者並依查核模組「可使用」過濾（正式行為，任務 P 合併時生效），並說明停用後改派的落點；細節為規格設計（非負責人裁定） — [#538](https://github.com/speko-tw/inspect-flow/issues/538)
- 規格澄清（#468）：Field Task 清單與可指派候選人以資料庫關聯批次篩選權限，並將候選人的排序及 cursor 分頁留在資料庫；確認查詢次數不隨專案數或成員數線性增加。既有權限、排序、cursor 與回應契約不變 — [#468](https://github.com/speko-tw/inspect-flow/issues/468)


<a id="ip-q11"></a>
- **IP-Q11：已裁定並轉為 IP-R07／IP-AC07。** 情境：Task 取消期間，專案查核項目標準被修改，之後內業恢復 Task。負責人選擇恢復時使用目前標準，原有結果中被修改的項目標示待重查；引用[負責人裁定](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970733042)。歷史資料表示、恢復權限重用及不要求原因是規格設計（非負責人裁定）。保留錨點供既有連結使用。
