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
- 現場填寫查核結果、實測值、照片及任務完成欄位驗證；依 `state-machines`／[KD-54](../../intents/03-decisions-and-stack.md#kd-54)，結果寫入屬 0.7.x。
- Evidence 的獨立刪除與保留政策；受 G-05 阻擋，屬 `field-evidence`。
- Report 狀態、快照邊界與產製失敗；受 G-06、G-07 阻擋。已核發報告規則見 [KD-57](../../intents/03-decisions-and-stack.md#kd-57)，不在本規格實作。
- 不符合結果的改善追蹤與缺失管理；屬 0.7.x（[KD-54](../../intents/03-decisions-and-stack.md#kd-54)）。

## 使用情境

- 具專案查核計畫管理權限的內業人員，建立計畫並從該專案的查核項目逐筆建立任務。
- 內業建立任務時可填建議執行人；指派不構成排他限制，同專案具現場查核權限的成員皆可執行，系統記錄實際操作者（SM-Q12）。
- 內業修改專案查核項目時，系統詢問是否重新查核；內業選擇後，系統只處理使用該項次的任務並記錄選擇者、時間及結果（[KD-55](../../intents/03-decisions-and-stack.md#kd-55)）。
- 同專案具現場查核權限的成員，依 `state-machines` 規則開始、完成任務；完成任務後需要修正文字或圖片時，任務仍維持完成（[KD-42](../../intents/03-decisions-and-stack.md#kd-42)）。

## 需求

以下技術欄位、端點與表示法若沒有直接的已裁定來源，均屬**規格設計（非負責人裁定）**；本規格整體仍為草稿，待 IP-Q 題目裁定及 OQ-09 未定邊界釐清前不得凍結。

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| IP-R01 | 系統**必須**提供專案範圍的 `Inspection Plan`，並由後端依專案權限檢查建立、讀取與修改；端點使用 `/api/v1`、UUID 與共用錯誤契約。 | 必須 | [PR-01](../../intents/02-principles.md#pr-01)、[API-R01](../api-conventions/spec.md#需求)、[API-R06](../api-conventions/spec.md#需求)；欄位及端點為規格設計（非負責人裁定） |
| IP-R02 | 內業人員**必須**依專案既有 `ProjectInspectionItem` 手動建立 `Inspection Task`。MVP 不自動依起訖點、間距或其他推算規則產生任務；系統不得要求 interval 才能建立計畫或任務。 | 必須／不得 | [KD-36](../../intents/03-decisions-and-stack.md#kd-36)、[G-01](../../intents/05-open-questions.md#g-01) |
| IP-R03 | 建立 `Inspection Task` 時，系統**必須**保存當時有效的 `Task Requirement Snapshot`；後續範本或專案查核項目變更不得一般性地改寫該快照。僅 KD-55 明確規定的「不要重新查核」文字更正可更正相關已建立任務內容；結果、照片與狀態不變，並記錄誰、何時、改了什麼。 | 必須 | [PR-04](../../intents/02-principles.md#pr-04)、[KD-03](../../intents/03-decisions-and-stack.md#kd-03)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)；Snapshot 的欄位結構為規格設計（非負責人裁定） |
| IP-R04 | 內業修改專案查核項目並存檔時，系統**必須**詢問是否讓現場重新查核並清楚說明後果。選「要」時，同專案使用被修改項次的未開始、進行中及已完成任務**必須**作廢並保留完整舊紀錄；選「不要」時，上述任務**必須**一併更正文字，不更動結果、照片及狀態。只影響使用該項次的任務；系統記錄選項、操作者、時間與更正內容。 | 必須 | [KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[PR-04](../../intents/02-principles.md#pr-04)；欄位與介面呈現為規格設計（非負責人裁定） |
| IP-R05 | 任務指派**必須**只作為建議；同專案具現場查核權限的成員皆得開始與完成任務。系統**必須**記錄實際開始及完成操作者，不得以指派人取代實際操作者。 | 必須 | SM-Q12：[state-machines](../state-machines/spec.md#sm-q12) |
| IP-R06 | Plan 有任務派出時，系統**必須**自動進入「進行中」；所有納入完成判定的任務完成時，系統**必須**自動將 Plan 設為「已完成」，人員不得手動完成 Plan。KD-55 作廢任務使已完成 Plan 回到進行中；重查任務完成後再自動完成。內業手動封存及取消封存。 | 必須／不得 | [KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[STM-R02](../state-machines/spec.md#需求) |
| IP-R07 | Task 取消若依適用條件獲准，**必須**記錄原因、保留並顯示取消紀錄，且不計入 Plan 完成判定。允許取消的來源狀態、已完成 Task 是否可取消及取消後能否恢復，維持草稿並由 IP-Q 題目裁定前不得定為正式行為。 | 必須／草稿 | [KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[OQ-09](../../intents/05-open-questions.md#oq-09)、[STM-R12](../state-machines/spec.md#需求) |
| IP-R08 | Task 完成後的資料更正不得令 Task 離開完成狀態或要求再次完成；Task 不提供「重新開啟」流程。 | 必須／不得 | [KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[STM-R03](../state-machines/spec.md#需求) |
| IP-R09 | 系統**必須**以資料表示各專案的查核項目與任務，不得為特定項目寫死條件分支；所有狀態與權限變更由後端覆核。 | 必須 | [PR-01](../../intents/02-principles.md#pr-01)、[PR-09](../../intents/02-principles.md#pr-09) |

## 資料

共通 UUID、建立／修改時間及操作者欄位沿用 `database-foundation`。完整的 `Inspection Plan`、`Inspection Task`、`Task Requirement Snapshot` 欄位與關聯由本規格補充；`Project`、`User`、`ProjectMember` 沿用 `domain-model`；`ProjectInspectionItem` 的範本結構與子表沿用 `template-system`，本規格只定義 P4 擴充部分。

以下為**規格設計（非負責人裁定）**，待本規格凍結：`Inspection Plan` 以 `project_id` 關聯專案；`Inspection Task` 以 `plan_id` 關聯計畫，並以 `project_inspection_item_id` 指向來源副本；任務另記可空的建議指派人。`Task Requirement Snapshot` 以不可變的明確欄位／子表保存建立當時任務需求，不以讀取目前範本或目前專案項目代替；不把專案項目副本與任務快照合併。精確欄位型別、唯一性與刪除約束由 T1 設計並以 migration 驗收。

`ProjectInspectionItem` 的來源名稱、套用時間與既有結構沿用 `template-system` TPL-R08；本規格增補足以支援後續任務建立、修改影響追蹤及 KD-55 作廢／更正紀錄的欄位。任何歷史任務資料不得因來源項目變動而無聲改寫。

## 介面

下列路徑與方法為**規格設計（非負責人裁定）**；實作須遵守 [api-conventions](../api-conventions/spec.md)，權限代碼依 `authentication`／`domain-model` 登記，預設拒絕。IP-Q 題目裁定前，涉及未定狀態轉換的端點僅為提案。

| 方法 | 路徑 | 用途 | 權限 |
|---|---|---|---|
| GET | `/api/v1/projects/{project_id}/inspection-plans` | 列出專案計畫 | 專案計畫讀取權限 |
| POST | `/api/v1/projects/{project_id}/inspection-plans` | 建立計畫 | 專案計畫建立權限 |
| GET | `/api/v1/inspection-plans/{plan_id}` | 讀取計畫、任務與摘要 | 該專案計畫讀取權限 |
| PATCH | `/api/v1/inspection-plans/{plan_id}` | 修改草稿計畫資料 | 該專案計畫管理權限；可改狀態欄位不得由用戶端直接傳入 |
| POST | `/api/v1/inspection-plans/{plan_id}/tasks` | 由一個專案查核項目建立一筆任務及快照 | 該專案任務建立權限 |
| POST | `/api/v1/inspection-tasks/{task_id}:assign` | 設定或清除建議執行人 | 該專案任務管理權限 |
| POST | `/api/v1/inspection-tasks/{task_id}:start` | 開始執行任務 | 該專案現場查核權限 |
| POST | `/api/v1/inspection-tasks/{task_id}:complete` | 提交任務完成動作 | 該專案現場查核權限；完成條件依現場規格 |
| POST | `/api/v1/inspection-plans/{plan_id}:archive` | 封存計畫 | 該專案計畫封存權限 |
| POST | `/api/v1/inspection-plans/{plan_id}:unarchive` | 取消封存 | 該專案計畫封存權限 |
| PATCH | `/api/v1/projects/{project_id}/inspection-items/{item_id}` | 修改專案查核項目；要求提供重新查核選項 | 專案查核項目管理權限 |

任務取消 API、修改項目時的確認傳輸欄位與作廢後重查 API，待相關待決題裁定後確認；不得依本提案先實作未定轉換。具體成功回應、分頁與錯誤碼沿用 API 共用契約，資源專屬錯誤採 `<resource>.<reason>`。

## 驗收條件

本表明確區分已裁定行為與待決議題守門條件。實作任務僅能涵蓋凍結後確認的規則；目前規格維持草稿。

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| IP-AC01 | 使用者對專案有／沒有計畫建立權限 | 建立計畫 | 有權限者可建立且資料關聯正確；無權限者被拒絕，資料不變；用戶端不能任意設定狀態 | IP-R01、IP-R09 |
| IP-AC02 | 專案有多筆查核項目，沒有任何 interval | 內業建立計畫並逐筆建立任務 | 任務只由明確選取的專案項目建立；不要求 interval，不產生未選取任務 | IP-R02 |
| IP-AC03 | 專案項目含完整結構，且範本來源之後可能被修改 | 建立任務後修改來源範本或其他專案項目 | 任務快照仍代表建立當時內容；查詢任務需求不依賴目前範本內容 | IP-R03 |
| IP-AC04 | 一個專案項次已被未開始、進行中、已完成任務使用 | 內業修改項次並選「要」重新查核 | 僅使用該項次的任務依 KD-55 作廢並保留；其餘項目任務不變；系統記錄操作者、時間及選擇 | IP-R04 |
| IP-AC05 | 一個專案項次已被未開始、進行中、已完成任務使用 | 內業修改文字並選「不要」重新查核 | 相關任務文字一併更正，結果、照片與狀態不變；系統記錄操作者、時間、選擇與更正內容 | IP-R04、IP-R08 |
| IP-AC06 | 任務有建議指派人，且同專案另有現場查核權限成員 | 非指派成員開始／完成任務 | 有權限者可執行；系統保存實際操作者而非建議指派人 | IP-R05 |
| IP-AC07 | Plan 尚未派出任務，或至少有一項納入判定任務 | 建立／派出任務、全部納入判定任務完成，或 KD-55 作廢任務 | Plan 依已裁定條件自動進入進行中、完成或退回進行中；用戶端不能手動設為完成 | IP-R06 |
| IP-AC08 | Task 取消來源狀態、恢復規則或全部任務取消的 Plan 狀態尚未裁定 | 規格凍結或實作取消流程前檢查 | 相應轉換維持草稿並列待決；不得把技術提案視為核准規則 | IP-R07 |
| IP-AC09 | 已完成 Task 有文字或圖片需要更正 | 有相應權限者修正資料 | Task 維持完成；不要求再次完成，也不提供重開轉換 | IP-R08 |
| IP-AC10 | 有管理 Plan、Task 或項目之請求 | 以非預期狀態值、跨專案識別碼或無權限帳號呼叫 API | 後端拒絕不合法狀態或越權存取，其他專案資料不變；回應遵守 api-conventions | IP-R01、IP-R09 |

## 待釐清

以下情境題是現場業務規則，需負責人以實際案例對答裁定；題內選項只呈現可選作法與影響，不代表本規格已選定。技術選擇另標「規格設計（非負責人裁定）」。

<a id="ip-q01"></a>
- **IP-Q01：Plan 從建立到派出任務前，要有哪些狀態與哪些操作？** 情境：內業先建立一個計畫，查核項目還在整理，尚未建立任何任務。內業能否先儲存後續再補？如果可以，應如何表示「尚未準備好」？選項：（A）建立時即視為可派任務的計畫；（B）允許草稿，另由內業明確標成就緒；（C）其他做法。影響：決定建立後可編輯範圍、何時可新增任務與哪些事件需稽核；OQ-09 未裁定 DRAFT／READY 的使用方式。
<a id="ip-q02"></a>
- **IP-Q02：內業實際怎麼把項目分成任務？** 情境：一個專案包含許多查核項目，有些同一趟能一起查、有些需要不同時間或不同人員。內業要逐項建立任務，還是能選多項組成一個任務？選項：（A）一個 `ProjectInspectionItem` 建一個 `Inspection Task`；（B）一次選多個項目組成一個 Task；（C）由內業選擇上述兩種方式。影響：決定任務與快照資料結構、現場畫面顯示單位、完成判定及改標準時受影響任務範圍；目前業務來源只要求內業事先給項目並手動建任務，未裁定如何分組。
<a id="ip-q03"></a>
- **IP-Q03：計畫建立後，專案查核項目還能不能增刪？** 情境：計畫已開始執行，業主後來要求多查一個項次，或發現原本有一項不需要查。選項：（A）只要未完成就能新增／移除，移除時逐項處理已建立任務；（B）開始後鎖定清單，新增另開計畫；（C）允許修改，但明確要求處理受影響任務。影響：決定 Plan 是否固定項目清單、舊 Task 和 Snapshot 如何保留，以及計畫完成判定會否改變；不得以工程便利自行裁定。
<a id="ip-q04"></a>
- **IP-Q04：某一項次同時用在多個計畫時，內業選「要重新查核」影響哪些任務？** 情境：內業修改一個專案查核項次；它已被同一專案兩份計畫引用，其中一份已完成，另一份還未開始。選項：（A）依 KD-55，修改影響該專案內所有使用此項次的任務；（B）只處理操作者目前開啟的計畫，其他計畫另行確認；（C）要求先逐計畫確認範圍。影響：決定 KD-55 的「同一專案內」如何落在 Plan 關聯上、一次確認後作廢數量及稽核紀錄。KD-55 已確定同專案相關任務一律受影響，若要選 B/C 代表變更既有裁定，須先處理意圖變更。
<a id="ip-q05"></a>
- **IP-Q05：任務取消的來源狀態與恢復方式為何？** 情境：現場發現任務重複建立；另有一個任務已開始但工程範圍取消，還有一個已完成任務被發現不應執行。內業要在哪些情況可取消？取消後是否可恢復？選項：（A）只允許取消未開始任務，錯誤時另建任務；（B）未開始與進行中可取消，已完成不可取消，取消不可恢復；（C）允許已完成取消或允許恢復；（D）其他。影響：決定歷史完成數、取消紀錄與 Plan 終態；KD-56 只裁定內業可取消、需填原因、保留且不計入完成，未裁定上述邊界。
<a id="ip-q06"></a>
- **IP-Q06：Plan 底下任務全部取消時，Plan 顯示什麼狀態？** 情境：原計畫有三個任務，後來三個都取消，未有任務完成。Plan 應算已完成、維持進行中、回到草稿，還是另設「已取消」？選項：（A）沿用原 Plan 狀態並由內業封存；（B）系統自動設為取消／無待辦狀態；（C）允許內業取消 Plan。影響：決定 Plan 狀態機、列表呈現、統計與後續新增任務規則；OQ-09 明列此情況未定。
<a id="ip-q07"></a>
- **IP-Q07：KD-55 選「要」後，是重用原任務還是建立新任務？** 情境：某任務已開始，內業修改被查核項次並選「要重新查核」。舊紀錄要怎麼呈現？現場接著操作哪一筆任務？選項：（A）保留已作廢任務並建立新 Task，兩者可追溯關聯；（B）在同一 Task 開新一輪，但另存每輪不可變紀錄；（C）其他。影響：決定任務 ID、舊結果／照片保留、快照生命週期與現場待辦；KD-55 要求舊任務完整保留，但明確把重查方式留給 0.4.x 規格設計。本規格提出（A）作為**規格設計（非負責人裁定）**，待確認。
<a id="ip-q08"></a>
- **IP-Q08：「尚未查核」在使用者畫面代表什麼？** 情境：新任務尚未有人開始，以及因 KD-55 標準變更而作廢舊任務、待重新查核。兩者是否應顯示相同文字？選項：（A）兩者都顯示「尚未查核」，另以作廢紀錄保留差異；（B）新任務顯示「待開始」，新 Task 顯示「待重新查核」；（C）其他。影響：決定任務狀態與作廢標記的呈現、內業能否辨識新任務與重查任務；來源未定義「尚未查核」對應狀態。
<a id="ip-q09"></a>
- **IP-Q09：新增 Task 時，如何決定要不要讓 Plan 進入「進行中」？** 情境：內業為了預先排程，先在 Plan 裡建立了任務，但現場尚未收到或看見任務。這算 KD-56 所說的「任務派出」嗎？選項：（A）建立 Task 即派出並進入進行中；（B）建立 Task 先保留草稿，內業另按派出才進入進行中；（C）任務指派給人時才算派出。影響：決定 Plan 轉態時點、未派出任務可否編輯，以及現場何時看到待辦；KD-56 明確把「任務派出」定義留給本規格。
<a id="ip-q10"></a>
- **IP-Q10：只有部分任務完成時，內業可否封存 Plan？** 情境：現場已完成大部分工作，但餘下項目因工程暫停不會繼續。內業想停止待辦提示並保留未完成紀錄。選項：（A）可封存，未完成任務保留且不算完成；（B）必須先逐一取消任務再封存；（C）未完成任務存在時不可封存。影響：決定封存的前置條件、任務取消與 Plan 完成統計；KD-56 只裁定內業可封存及取消封存，未定義封存條件與取消封存的狀態效果。

## 變更紀錄

- 無。
