# 查核計畫與任務（inspection-planning）

**代碼**：`IP`　**Phase**：P4　**狀態**：草稿<br>
**前置規格**：`template-system`、`state-machines`、`domain-model`、`authentication`、`audit-log`、`api-conventions`<br>
**引用意圖**：[PR-01](../../intents/02-principles.md#pr-01)、[PR-04](../../intents/02-principles.md#pr-04)、[KD-03](../../intents/03-decisions-and-stack.md#kd-03)、[KD-36](../../intents/03-decisions-and-stack.md#kd-36)、[KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-54](../../intents/03-decisions-and-stack.md#kd-54)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[KD-57](../../intents/03-decisions-and-stack.md#kd-57)<br>
**被擋議題**：[OQ-09](../../intents/05-open-questions.md#oq-09)（Plan／Task 未定狀態轉換與取消邊界）

## 目的

讓有權限的內業人員依專案已建立的查核項目建立 `Inspection Plan`，並為現場查核建立 `Inspection Task`；任務固定建立當時的查核需求，讓後續修改能依裁定流程保留歷史（依據：架構基準 §2.5、§12.9、§18；[PR-04](../../intents/02-principles.md#pr-04)）。

## 範圍

**包含**：

- `Inspection Plan` 與 `Inspection Task` 的本功能資料欄位、關聯、API 與授權。
- 由內業依專案查核項目手動建立任務；MVP 不自動切分或產生任務。
- 任務建立時產生 `Task Requirement Snapshot`。
- 專案查核項目修改時，詢問是否重新查核；依回答作廢相關任務，或按裁定更正既有任務文字。
- `ProjectInspectionItem` 的 P4 擴充欄位，以及與 Plan、Task、Snapshot 的關聯。
- `state-machines` 已定義的 Plan／Task 規則；未定轉換仍列為草稿與待釐清。

**不包含**（注明移到哪份規格，或屬於哪一條非目標）：

- 依起訖點與 interval 自動產生任務；MVP 由內業手動建立，未來選用功能另議（[KD-36](../../intents/03-decisions-and-stack.md#kd-36)、[G-01](../../intents/05-open-questions.md#g-01)）。
- 範本庫與範本版本；由 `template-system` 定義，`Inspection Template` 不版本化（[KD-03](../../intents/03-decisions-and-stack.md#kd-03)）。
- 現場填寫及更正查核結果、實測值與照片，及任務完成欄位驗證；依 `state-machines`／[KD-54](../../intents/03-decisions-and-stack.md#kd-54)，結果與照片端點屬 0.7.x。P4 的 KD-55「不要重新查核」只更正 `Task Requirement Snapshot` 的文字，不改現場結果、照片或任務狀態。
- Evidence 的獨立刪除與保留政策；受 G-05 阻擋，屬 `field-evidence`。
- Report 狀態、快照邊界與產製失敗；受 G-06、G-07 阻擋。已核發報告規則見 [KD-57](../../intents/03-decisions-and-stack.md#kd-57)，不在本規格實作。
- 不符合結果的改善追蹤與缺失管理；屬 0.7.x（[KD-54](../../intents/03-decisions-and-stack.md#kd-54)）。

## 使用情境

- 具專案查核計畫管理權限的內業人員，建立計畫並從該專案的查核項目逐筆建立任務。
- 內業建立任務時可填建議執行人；指派不構成排他限制，同專案具現場查核權限的成員皆可執行，系統記錄實際操作者（SM-Q12）。
- 內業修改專案查核項目時，系統詢問是否重新查核；內業選擇後，系統只處理使用該項次的任務並記錄選擇者、時間及結果（[KD-55](../../intents/03-decisions-and-stack.md#kd-55)）。
- 同專案具現場查核權限的成員，依 `state-machines` 規則開始、完成任務；實際查核人記在 Task 的領域資料欄位。完成任務後的結果或照片更正屬 0.7.x；P4 不提供這些更正端點（[KD-42](../../intents/03-decisions-and-stack.md#kd-42)）。

## 需求

以下技術欄位、端點與表示法若沒有直接的已裁定來源，均屬**規格設計（非負責人裁定）**；本規格整體仍為草稿，待 IP-Q 題目裁定及 OQ-09 未定邊界釐清前不得凍結。

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| IP-R01 | 系統**必須**提供專案範圍的 `Inspection Plan`，並由後端依專案權限檢查建立、讀取與修改；端點使用 `/api/v1`、UUID 與共用錯誤契約。 | 必須 | [PR-01](../../intents/02-principles.md#pr-01)、[API-R01](../api-conventions/spec.md#需求)、[API-R06](../api-conventions/spec.md#需求)；欄位及端點為規格設計（非負責人裁定） |
| IP-R02 | 內業人員**必須**依專案既有 `ProjectInspectionItem` 手動建立 `Inspection Task`。MVP 不自動依起訖點、間距或其他推算規則產生任務，也不得要求 interval 才能建立計畫或任務；依 KD-55 修改標準後自動建立的重查 Task 不在此限。任務與 `ProjectInspectionItem` 的暫定對應方式見[資料](#資料)，待 IP-Q02 裁定。 | 必須／不得 | [KD-36](../../intents/03-decisions-and-stack.md#kd-36)、[G-01](../../intents/05-open-questions.md#g-01)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)；對應方式為規格設計（非負責人裁定） |
| IP-R03 | 建立 `Inspection Task` 時，系統**必須**保存當時有效的 `Task Requirement Snapshot`；後續範本或專案查核項目變更不得一般性地改寫快照。只有 KD-55 選「不要重新查核」時，才一併更正相關已建立任務的 Snapshot 文字；現場結果、照片及任務狀態不變。系統**必須**以稽核事件記錄此項目修改的內容、重新查核選擇、操作者與時間。 | 必須 | [PR-04](../../intents/02-principles.md#pr-04)、[KD-03](../../intents/03-decisions-and-stack.md#kd-03)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)；Snapshot 欄位結構及稽核事件代碼為規格設計（非負責人裁定） |
| IP-R04 | 內業修改專案查核項目或其查核項次並存檔時，系統**必須**詢問是否讓現場重新查核並清楚說明後果。選「要」時，同專案所有 Plan 中使用該項目／項次的未開始、進行中及已完成 Task **必須**作廢；「使用」指 Task 的來源專案項目及需求 Snapshot 含該項目／項次。作廢舊 Task、結果、照片與當時標準**必須**保留，標示「標準變更作廢」，並讓內業可查找；系統自動建立重查 Task，方式見 IP-Q07（規格設計）。若受影響 Task 屬於已封存 Plan，內業**必須**先取消封存該 Plan 才能修改標準。選「不要」時，相關既有 Task 的 Snapshot **必須**一併更正文字，不更動結果、照片及狀態。系統**必須**在同一交易寫入 `project_inspection_item.updated` 稽核事件，記錄修改內容、選擇、操作者與時間。 | 必須 | [KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[PR-04](../../intents/02-principles.md#pr-04)；事件代碼與 API 欄位為規格設計（非負責人裁定） |
| IP-R05 | 任務指派**必須**只作為建議；同專案具現場查核權限的成員皆得開始與完成任務。實際開始及完成操作者**必須**記錄在 Task 領域欄位（暫定為 `started_by`、`completed_by`），不得以指派人取代實際操作者，也不得以 AuditLog 取代這些欄位。 | 必須 | SM-Q12：[state-machines](../state-machines/spec.md#sm-q12)；欄位名稱為規格設計（非負責人裁定） |
| IP-R06 | 有任務派出時，系統**必須**自動將 Plan 設為「進行中」。只有至少一個納入完成判定的 Task，且所有納入判定的 Task 均完成時，系統才**必須**自動將 Plan 設為「已完成」；已取消及依 KD-55 作廢的 Task 不納入判定。KD-55 作廢使已完成 Plan 回到進行中，重查 Task 完成後再自動完成。已完成 Plan 新增 Task 時依任務進度自動退回進行中；已封存 Plan 必須先取消封存才能新增 Task。內業手動封存及取消封存，不得手動將 Plan 設為完成。 | 必須／不得 | [KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[STM-R02](../state-machines/spec.md#需求)；已完成後新增 Task 的處理為規格設計（非負責人裁定） |
| IP-R07 | Task 取消若依適用條件獲准，**必須**記錄原因、保留並顯示取消紀錄，且不計入 Plan 完成判定。允許取消的來源狀態、已完成 Task 是否可取消及取消後能否恢復，維持草稿並由 IP-Q 題目裁定前不得定為正式行為。 | 必須／草稿 | [KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[OQ-09](../../intents/05-open-questions.md#oq-09)、[STM-R12](../state-machines/spec.md#需求) |
| IP-R08 | P4 **不得**提供修改已完成 Task 的現場結果或照片的端點，亦**不得**提供使 `COMPLETED` Task 離開完成狀態或重新開啟的轉換。KD-42 所述已完成任務結果／照片更正與修正紀錄屬 0.7.x；本規格所稱任務需求文字只指 `Task Requirement Snapshot`，其 KD-55「不要重新查核」更正例外依 IP-R03。 | 不得 | [KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[STM-R03](../state-machines/spec.md#需求)；版本範圍依 `state-machines` 與 06-versioning-and-milestone-governance |
| IP-R09 | 系統**必須**以資料表示各專案的查核項目與任務，不得為特定項目寫死條件分支；所有狀態與權限變更由後端覆核。 | 必須 | [PR-01](../../intents/02-principles.md#pr-01)、[PR-09](../../intents/02-principles.md#pr-09) |

## 資料

共通 UUID、建立／修改時間及操作者欄位沿用 `database-foundation`。完整的 `Inspection Plan`、`Inspection Task`、`Task Requirement Snapshot` 欄位與關聯由本規格補充；`Project`、`User`、`ProjectMember` 沿用 `domain-model`；`ProjectInspectionItem` 的範本結構與子表沿用 `template-system`，本規格只定義 P4 擴充部分。

以下為**規格設計（非負責人裁定）**，待本規格凍結：`Inspection Plan` 以 `project_id` 關聯專案；`Inspection Task` 以 `plan_id` 關聯計畫，並以 `project_inspection_item_id` 指向來源副本。`Task Requirement Snapshot` 以不可變的明確欄位／子表保存建立當時任務需求，不以讀取目前範本或目前專案項目代替；不把專案項目副本與任務快照合併。精確欄位型別、唯一性與刪除約束由 T1 設計並以 migration 驗收。

任務與專案查核項目的模型暫採 IP-Q02（A）：一筆 Task 指向一筆 `ProjectInspectionItem`，不把多筆專案項目合成一筆 Task；此預設待 IP-Q02 裁定後可調整，會影響 `project_inspection_item_id` 關聯與 Snapshot 結構。Task 另記可空的 `assignee_id` 作為建議指派。實際查核者是 Task 領域資料，暫定欄位為 `started_by`、`completed_by`（及相應時間欄位）；這些不是 `AuditLog` 事件的替代物。

Plan 初始狀態與派出時點暫採 IP-Q09 的技術預設：建立後為可編輯的 `DRAFT`；建立第一筆 Task 即視為派出並讓 Plan 進入 `IN_PROGRESS`，不設另一步驟的 `READY` 或「派出」動作。內業於建立 Task 時即將其提供給現場。現場何時可看見待辦仍列為 IP-Q09 的業務問題，待裁定後可調整此預設及建立／派出 API。

KD-55 重查暫採 `state-machines` 的 SM-Q03 規格設計：保留並標示作廢舊 Task，於同一交易自動建立新 Task，連結至舊 Task（暫定 `recheck_of_task_id`），使用修改後的 Snapshot；新 Task 為 `PENDING`，顯示「尚未查核」。這是 IP-Q07／IP-Q08 的已採用規格設計（非負責人裁定）。

`ProjectInspectionItem` 的來源名稱、套用時間與既有結構沿用 `template-system` TPL-R08；本規格增補足以支援後續任務建立、修改影響追蹤及 KD-55 作廢／更正紀錄的欄位。任何歷史任務資料不得因來源項目變動而無聲改寫。

`project_inspection_item.updated` 是 KD-55 項目修改及重新查核選擇的 AuditLog 事件；事件目錄的 `before`／`after` 登記項目修改欄位與所選重新查核旗標。它與 Task 的 `started_by`、`completed_by` 領域欄位用途不同，後兩者不作為稽核事件寫入。

## 介面

下列路徑與方法為**規格設計（非負責人裁定）**；實作須遵守 [api-conventions](../api-conventions/spec.md)，權限代碼依 `authentication`／`domain-model` 登記，預設拒絕。IP-Q 題目裁定前，涉及未定狀態轉換的端點僅為提案。

| 方法 | 路徑 | 用途 | 權限 |
|---|---|---|---|
| GET | `/api/v1/projects/{project_id}/inspection-plans` | 列出專案計畫 | `inspection_plan.read` |
| POST | `/api/v1/projects/{project_id}/inspection-plans` | 建立計畫，初始為 `DRAFT` | `inspection_plan.create` |
| GET | `/api/v1/inspection-plans/{plan_id}` | 讀取計畫、任務與摘要 | `inspection_plan.read` |
| PATCH | `/api/v1/inspection-plans/{plan_id}` | 修改計畫資料；用戶端不得直接設定狀態 | `inspection_plan.manage` |
| POST | `/api/v1/inspection-plans/{plan_id}/tasks` | 暫採由一筆專案查核項目建立一筆任務及快照；建立即派出 | `inspection_task.create` |
| POST | `/api/v1/inspection-tasks/{task_id}:assign` | 設定或清除建議執行人 | `inspection_task.assign` |
| POST | `/api/v1/inspection-tasks/{task_id}:start` | 開始執行任務 | `inspection_task.inspect` |
| POST | `/api/v1/inspection-tasks/{task_id}:complete` | 提交任務完成動作 | `inspection_task.inspect`；完成欄位驗證與結果寫入依現場規格 |
| POST | `/api/v1/inspection-tasks/{task_id}:cancel` | 取消任務；body 必含原因；可取消來源狀態仍待 IP-Q05 裁定 | `inspection_task.cancel` |
| GET | `/api/v1/inspection-tasks/{task_id}` | 讀取任務及需求快照 | `inspection_task.read` |
| POST | `/api/v1/inspection-plans/{plan_id}:archive` | 封存計畫 | `inspection_plan.archive` |
| POST | `/api/v1/inspection-plans/{plan_id}:unarchive` | 取消封存 | `inspection_plan.archive` |
| PATCH | `/api/v1/projects/{project_id}/inspection-items/{project_inspection_item_id}` | 修改專案查核項目及子表；契約見下 | `project_inspection_item.edit` |

權限代碼**規格設計（非負責人裁定）**：依 [DOM-R30](../domain-model/spec.md#需求) 的 `<resource>.<action>` 格式及 [DOM-R35](../domain-model/spec.md#需求) 集中登記規則。各 task 所需代碼如下：

| 權限代碼 | 用途 |
|---|---|
| `inspection_plan.read` | 讀取計畫與所屬任務 |
| `inspection_plan.create` | 建立計畫 |
| `inspection_plan.manage` | 修改計畫非狀態資料 |
| `inspection_plan.archive` | 封存及取消封存計畫 |
| `inspection_task.read` | 讀取任務 |
| `inspection_task.create` | 建立任務 |
| `inspection_task.assign` | 修改建議指派人 |
| `inspection_task.inspect` | 開始與完成任務 |
| `inspection_task.cancel` | 取消任務 |
| `project_inspection_item.edit` | 修改專案查核項目；沿用 `template-system` TPL-R09，不重複新增代碼 |

修改專案查核項目的 PATCH body 可帶項目欄位及完整子表集合；未提供的頂層欄位不變，若提供查核項次、標準、實測欄位或照片需求集合，該集合以完整取代方式處理。若有 Task 使用此專案查核項目，body **必須**帶布林值 `reinspect`；未提供時回 422 `project_inspection_item.reinspection_choice_required`。沒有任何 Task 使用時可省略，由後端判斷。整次修改、KD-55 選擇、Snapshot 更正／Task 作廢及重查 Task 建立須在同一交易內完成；任何一步失敗則全部回滾。選「要」後，新重查 Task 由系統建立；IP-Q02 的任務分組裁定會決定一次要建立幾筆。

若被修改項目關聯的 Task 位於已封存 Plan，請求須先被拒絕；內業取消相關 Plan 封存後才可重送修改。依 `state-machines` 的 `COMPLETED ↔ ARCHIVED` 技術設計，封存前置條件及取消封存後狀態須與實際任務狀態一致；若業務裁定允許未完成 Plan 封存，取消封存狀態的技術處理見 IP-Q10（規格設計，非負責人裁定）。

`project_inspection_item.updated` 稽核事件採 ALG-R07～ALG-R10 欄位規則，由實作 task 登記至 [audit-log 事件目錄](../audit-log/spec.md#template-system-事件)的本規格專屬區段。此事件至少包含變更內容與 `reinspect` 選擇，並與項目、快照及任務變更同一交易寫入。其他實際查核者資料寫在 Task 欄位，不新增替代稽核事件。其餘成功回應、分頁與錯誤格式沿用 API 共用契約。

## 驗收條件

本表明確區分已裁定行為與待決議題守門條件。實作任務僅能涵蓋凍結後確認的規則；目前規格維持草稿。

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| IP-AC01 | 使用者對專案有／沒有計畫建立權限 | 建立計畫 | 有權限者可建立且資料關聯正確；無權限者被拒絕，資料不變；用戶端不能任意設定狀態 | IP-R01、IP-R09 |
| IP-AC02 | 專案有多筆查核項目，沒有任何 interval | 內業建立計畫並逐筆建立任務 | 任務只由明確選取的專案項目建立；不要求 interval，不產生未選取任務 | IP-R02 |
| IP-AC03 | 專案項目含完整結構，且範本來源之後可能被修改 | 建立任務後修改來源範本或其他專案項目 | 任務快照仍代表建立當時內容；查詢任務需求不依賴目前範本內容 | IP-R03 |
| IP-AC04 | (1) 多 Plan 的 Task 使用同專案項次且 Plan 未封存；或 (2) 至少一筆受影響 Task 所屬 Plan 已封存 | (1) 選「要」修改項次；或 (2) 直接修改項次，再先取消封存所有受影響 Plan 後重送 | (1) 同專案所有相關 Task 依 KD-55 作廢並保留、可搜尋，新重查 Task 自動建立；(2) 原請求拒絕且資料不變，取消封存後重送才成功；其餘項目任務不變，記錄操作者、時間及選擇 | IP-R04 |
| IP-AC05 | 一個專案項次已被未開始、進行中、已完成任務使用 | 內業修改文字並選「不要」重新查核 | 相關 Task 的 Snapshot 文字一併更正，Task 狀態、結果與照片不變；系統記錄操作者、時間、選擇與更正內容 | IP-R03、IP-R04、IP-R08 |
| IP-AC06 | 任務有建議指派人，且同專案另有現場查核權限成員 | 非指派成員開始／完成任務 | 有權限者可執行；系統保存實際操作者而非建議指派人 | IP-R05 |
| IP-AC07 | Plan 尚無 Task、至少一項合格 Task、所有 Task 均已取消，或只剩已取消／KD-55 作廢 Task | 建立 Task、完成合格 Task 或作廢 Task | 無 Task 或無合格 Task 時不得自動完成；至少一項非取消且非作廢 Task 全部完成才自動完成；KD-55 作廢已完成 Task 使 Plan 回到進行中；用戶端不能手動設為完成 | IP-R06 |
| IP-AC08 | Task 取消來源狀態、恢復規則或全部任務取消的 Plan 狀態尚未裁定 | 規格凍結或實作取消流程前檢查 | 相應轉換維持草稿並列待決；不得把技術提案視為核准規則 | IP-R07 |
| IP-AC09 | Task 已完成，或 KD-55 選「不要重新查核」且需更新需求文字 | 呼叫 P4 API | 不存在結果／照片新增或更正端點，也不能將 Task 從完成狀態轉出；KD-55 例外只更新 Snapshot 文字，Task 狀態、結果與照片不變；結果／照片更正屬 0.7.x | IP-R03、IP-R08 |
| IP-AC10 | 有管理 Plan、Task 或項目之請求 | 以非預期狀態值、跨專案識別碼或無權限帳號呼叫 API | 後端拒絕不合法狀態或越權存取，其他專案資料不變；回應遵守 api-conventions | IP-R01、IP-R09 |

## 待釐清

以下仍待決議題是現場業務規則，需負責人以實際案例對答裁定；題內選項只呈現可選作法與影響，不代表本規格已選定。技術選擇另標「規格設計（非負責人裁定）」。已解決題保留錨點供既有連結使用，並明確標示狀態。

<a id="ip-q01"></a>
- **IP-Q01：已併入 IP-Q09，不再是獨立待決題。** 原情境是 Plan 從建立至派出前的狀態與操作；其業務問題與「建立 Task 何時算派出」同屬 IP-Q09。保留本錨點供既有連結使用。
<a id="ip-q02"></a>
- **IP-Q02：內業實際怎麼把項目分成任務？** 情境：一個專案有多個查核項目，有些可同趟查、有些需不同時間或人員。內業應逐項建任務，還是可合併多項？選項：（A）一個 `ProjectInspectionItem` 建一個 `Inspection Task`；（B）一次選多個項目組成一個 Task；（C）兩種都可，由內業選擇。影響：決定資料結構、現場顯示單位、完成判定及 KD-55 影響範圍；目前只裁定由內業依專案項目手動建立任務，未裁定分組。本規格及介面暫採 A 作為**規格設計（非負責人裁定）**，待業務裁定後可調整。
<a id="ip-q03"></a>
- **IP-Q03：已解決的技術規則（規格設計，非負責人裁定）。** 情境：Plan 已完成後，內業新增一筆 Task。依任務衍生狀態，Plan 回到 `IN_PROGRESS`；若 Plan 已封存，必須先取消封存才可新增。這沿用 `state-machines` 的狀態轉換設計，不表示已裁定項目清單的其他業務規則。
<a id="ip-q04"></a>
- **IP-Q04：已裁定（KD-55），不再是待決題。** 情境：同一專案的多份 Plan 都引用被修改的項次。KD-55 要求處理該專案所有使用此項次的相關任務，不限目前開啟的 Plan；修改及重新查核選擇留有稽核紀錄。若改成只影響單一 Plan，須先處理意圖變更。保留本錨點供既有連結使用。
<a id="ip-q05"></a>
- **IP-Q05：任務取消的來源狀態與恢復方式為何？** 情境：現場發現任務重複建立；另有一個任務已開始但工程範圍取消，還有一個已完成任務被發現不應執行。內業要在哪些情況可取消？取消後是否可恢復？選項：（A）只允許取消未開始任務，錯誤時另建任務；（B）未開始與進行中可取消，已完成不可取消，取消不可恢復；（C）允許已完成取消或允許恢復；（D）其他。影響：決定歷史完成數、取消紀錄與 Plan 終態；KD-56 只裁定內業可取消、需填原因、保留且不計入完成，未裁定上述邊界。
<a id="ip-q06"></a>
- **IP-Q06：Plan 底下任務全部取消時，Plan 顯示什麼狀態？** 情境：原計畫有三個任務，後來三個都取消，未有任務完成。Plan 應算已完成、維持進行中、回到草稿，還是另設「已取消」？選項：（A）沿用原 Plan 狀態並由內業封存；（B）系統自動設為取消／無待辦狀態；（C）允許內業取消 Plan。影響：決定 Plan 狀態機、列表呈現、統計與後續新增任務規則；OQ-09 明列此情況未定。
<a id="ip-q07"></a>
- **IP-Q07：已採用的技術設計（非負責人裁定，依 state-machines SM-Q03）。** KD-55 選「要」時保留舊 Task 並標示作廢，系統自動建立連結至舊 Task 的新 Task；新 Task 使用更新後 Snapshot 且為 `PENDING`。這是自動建立重查 Task 的例外；一般任務仍由內業手動建立。保留本錨點供既有連結使用。
<a id="ip-q08"></a>
- **IP-Q08：「尚未查核」在畫面如何呈現？** 情境：一般新 Task 尚未有人開始，或舊 Task 因 KD-55 標準變更作廢並由系統建立重查 Task。選項：（A）兩者都顯示「尚未查核」，另用作廢標示區分舊 Task；（B）一般新 Task 顯示「待開始」，系統建立的重查 Task 顯示「尚未查核」，舊 Task 標示「標準變更作廢」；（C）其他。影響：決定現場與內業如何辨認一般待辦及重查來源。採用 SM-Q03 的規格設計（非負責人裁定）：重查 Task 為 `PENDING` 並顯示「尚未查核」，舊 Task 保留「標準變更作廢」標示；一般 Task 狀態仍依一般建立流程呈現。此處修正原選項 B 表述，讓它明確指向系統自動建立的重查 Task，不改變業務待決範圍。
<a id="ip-q09"></a>
- **IP-Q09：新增 Task 時，何時算派出？** 情境：內業先建立 Task 排程，但現場尚未收到或看見。選項：（A）建立 Task 即派出並進入進行中；（B）Task 先保留草稿，內業另按派出才進入進行中；（C）指派給人時才算派出。影響：決定 Plan 轉態、Task 可編輯時點及現場可見性；KD-56 將「任務派出」定義留給本規格。技術預設暫採 A：Plan 建立為 `DRAFT`，建立第一筆 Task 即視為派出，不設中間 `READY` 或派出步驟；這是規格設計（非負責人裁定），待業務裁定。原 IP-Q01 已併入本題。
<a id="ip-q10"></a>
- **IP-Q10：只有部分任務完成時，內業可否封存 Plan？** 情境：現場完成大部分工作，餘下項目因工程暫停不會繼續；內業想停止待辦提示並保留未完成紀錄。選項：（A）可封存，未完成任務保留且不算完成；（B）先逐一取消未完成任務再封存；（C）未完成任務存在時不可封存。影響：決定封存前置條件、取消任務與完成統計；KD-56 已裁定內業可封存及取消封存，未裁定這些業務條件。技術設計依 `state-machines` 的 `COMPLETED ↔ ARCHIVED`：若業務裁定允許封存未完成 Plan，取消封存後狀態須依當時 Task 狀態推導，不得一律強制 `COMPLETED`；此為規格設計（非負責人裁定）。

## 變更紀錄

- 無。
