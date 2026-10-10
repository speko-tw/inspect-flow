# 現場介面（field-ui）

**代碼**：`FUI`　**Phase**：P5　**狀態**：草稿
**前置規格**：`inspection-planning`、`state-machines`、`authentication`、`domain-model`、`api-conventions`
**引用意圖**：[PR-01](../../intents/02-principles.md#pr-01)、[PR-10](../../intents/02-principles.md#pr-10)、[KD-21](../../intents/03-decisions-and-stack.md#kd-21)、[KD-12](../../intents/03-decisions-and-stack.md#kd-12)、[KD-59](../../intents/03-decisions-and-stack.md#kd-59)、[KD-58](../../intents/03-decisions-and-stack.md#kd-58)、[KD-69](../../intents/03-decisions-and-stack.md#kd-69)、[OQ-08](../../intents/05-open-questions.md#oq-08)、[OQ-21](../../intents/05-open-questions.md#oq-21)
**被擋議題**：無。`OQ-21` 已裁定；Plan／Task 行為依已凍結的 `state-machines` 與 `inspection-planning`。

## 目的

讓現場查核人員以手機或平板登入後，查看已派出的任務、閱讀任務建立時的查核需求，並開始查核；同專案具現場查核權限的成員可協助執行，不受建議指派人限制（依據：架構基準 §5.3、§6.1、§13A.13、§31；[PR-10](../../intents/02-principles.md#pr-10)、[KD-59](../../intents/03-decisions-and-stack.md#kd-59)、[STM-R11](../state-machines/spec.md#需求)）。

## 範圍

**包含**：

- 單一 React application 的 `/field/*` 路由與依路由拆分程式碼；Field 不載入 Admin 程式（[KD-12](../../intents/03-decisions-and-stack.md#kd-12)、[OQ-21](../../intents/05-open-questions.md#oq-21)）。
- 今日任務入口、任務清單、任務詳情、唯讀需求快照及開始查核操作。
- 新增跨專案現場任務列表 API，遵守登入、專案權限、cursor 分頁及共用 API 錯誤契約；另需安全地讀取 Field 可見任務詳情。
- 手機／平板操作、Online-first 的 PWA-ready 基礎，以及區網 HTTPS 開發與 iPhone 實機驗收說明。
- 將現有 `/field/*` 個人工作台轉為現場首頁；範本瀏覽及套用範本移至 `/admin/...` 內業路由。

**不包含**：

- 拍照、Evidence 建立與上傳、影像編輯及上傳佇列：移至 `field-evidence`（0.6.x）。
- 查核結果、實測值填寫及任務完成操作：移至 `completion-validation`（0.7.x）；本階段只允許開始查核。
- Plan、Task、Snapshot 的資料欄位與狀態轉換：由 `domain-model`、`inspection-planning`、`state-machines` 負責，本規格只消費其契約。
- Admin 功能內容（管理者範本庫、專案設定等）：由 `admin-dashboard` 負責；本規格僅要求將現有範本頁面移入其 `/admin/...` 路由範圍。
- 離線編輯、離線同步及背景上傳：PWA 卡片明定 MVP 為 Online-first，未來依試用資料再評估。

## 使用情境

- 現場查核人員登入後，從今日任務看到預設指派給自己的已派任務，並可切換檢視自己有權限的專案中所有未完成已派任務；清單下方另有「近期已完成」區（預設最近 14 天，可展開），方便確認剛完成的任務。
- 現場查核人員開啟一筆任務，查看專案、任務地點、狀態、建議執行人，以及每項需求快照和需檢查／拍攝／量測的說明。
- 同專案具 `inspection_task.inspect` 權限的成員，即使不是建議指派人，也能開始該任務；系統記錄實際開始者。
- 管理者或專案管理者在區網提供開發中的前端給 iPhone／iPad 測試時，使用 HTTPS 與受信任的開發憑證登入，不降低 Cookie 安全要求。

## 需求

凡下列細節未由來源直接指定者，明確標為**規格設計（非負責人裁定）**；這些設計不改變已凍結的領域與狀態契約。

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| FUI-R01 | Field **必須**在同一 React application 中提供 `/field/*` 路由，並依路由拆分程式碼，使 Field 路由不載入 Admin 程式。 | 必須 | [KD-12](../../intents/03-decisions-and-stack.md#kd-12)、[OQ-21](../../intents/05-open-questions.md#oq-21)；路由組織為規格設計 |
| FUI-R02 | 今日任務頁**必須**預設列出登入者在其具 `inspection_task.inspect` 權限的專案中、建議指派給本人的未完成已派 Task（`PENDING`、`IN_PROGRESS`）。「今日」不按日期欄位篩選。頁面**必須**可切換到所有有權限專案的未完成已派 Task。未派出的 `DRAFT` 不得出現在 Field 清單或詳情。建議指派只作預設篩選，不限制同專案其他具 `inspection_task.inspect` 權限成員開始任務。 | 必須 | 今日任務與後續日期檢視：[今日任務裁定](https://github.com/speko-tw/inspect-flow/issues/104#issuecomment-5977711401)、[日期需求檢視裁定](https://github.com/speko-tw/inspect-flow/issues/104#issuecomment-5977713303)；範圍切換及排序為規格設計；[IP-R05](../inspection-planning/spec.md#需求)、[IP-R09](../inspection-planning/spec.md#需求)、[STM-R11](../state-machines/spec.md#需求) |
| FUI-R03 | 任務詳情**必須**呈現 Task 狀態、專案、任務地點及 Task Requirement Snapshot。需求清單逐項顯示內容與必要照片／量測要求；唯讀呈現不得建立 Evidence 或 Result。Snapshot 預設為建立 Task 時的需求；符合 [KD-55](../../intents/03-decisions-and-stack.md#kd-55) 的更正例外時，Field 顯示 Task API 回傳的最新內容。`DRAFT` Task 對 Field 清單及詳情 API 必須由後端隱藏，詳情統一回 404。草稿、取消及封存不得呈現為可操作狀態。 | 必須 | [不開放完成裁定](https://github.com/speko-tw/inspect-flow/issues/104#issuecomment-5977723428)、[PR-04](../../intents/02-principles.md#pr-04)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[KD-58](../../intents/03-decisions-and-stack.md#kd-58)、[DOM-R57](../domain-model/spec.md)、[STM-R09](../state-machines/spec.md#需求)；Field 專用詳情端點與呈現方式為規格設計，後端依賴 #361、#416 |
| FUI-R04 | 對 `PENDING` Task，Field **必須**提供「開始查核」操作；只有登入者具該專案 `inspection_task.inspect` 權限且 Plan 未封存時可操作。操作呼叫既有開始端點，由伺服器覆核狀態與權限；成功後顯示最新狀態與實際開始者。`IN_PROGRESS` 顯示進行中且不得重複開始，其他狀態不提供開始操作。 | 必須 | [IP-R05](../inspection-planning/spec.md#需求)、[IP-R09](../inspection-planning/spec.md#需求)、[STM-R01](../state-machines/spec.md#需求)、[STM-R11](../state-machines/spec.md#需求)；按鈕與回應呈現為規格設計 |
| FUI-R05 | 系統**必須**提供跨專案 Field Task 清單端點，預設只回傳登入者有 `inspection_task.inspect` 權限專案中的 `PENDING`、`IN_PROGRESS` 已派 Task；另可用 `status=COMPLETED` 查詢「近期已完成」：同樣範圍中 `COMPLETED` 且 `completed_at` 在最近 `completed_within_days` 天內的 Task，`completed_within_days` 預設 14（範圍 1–90，範圍為規格設計），排序為 `completed_at` 新到舊、再以 Task UUID 排序。未完成查詢採 `dispatched_at` 新到舊、再以 Task UUID 排序；`limit` 預設 50、上限 100，使用不透明 cursor。不得以客戶端提供的 User ID 決定本人任務。API 宣告「模組權限或任一專案權限」存取層級（AUT-R18；程式改造完成前為系統角色或任一專案權限）；非 Admin 且任何專案都沒有該權限時回 403；有權限但沒有符合資料時回 200 空清單。指定 `project_id` 而使用者不是該專案成員或無 `inspection_task.inspect` 權限時回 403。兩種查詢都不含 `DRAFT`、`CANCELLED`；省略 `status` 的預設查詢不含 `COMPLETED`。今日任務頁在未完成清單下方增設「近期已完成」區，預設收合並顯示筆數，可展開列出最近 14 天完成的任務，點進去是唯讀詳情。首次派送時間使用 Task 的 `dispatched_at` 欄位；歷史非 DRAFT Task 依 `created_at` 近似回填。 | 必須 | 跨專案端點為 0.4.x 缺漏（#104）；[KD-69](../../intents/03-decisions-and-stack.md#kd-69)、[OQ-08](../../intents/05-open-questions.md#oq-08)（權限範圍為專案；此規格選用的代碼名稱是規格設計）、[PR-01](../../intents/02-principles.md#pr-01)、[API-R01](../api-conventions/spec.md#需求)、[API-R06](../api-conventions/spec.md#需求)、[API-R08](../api-conventions/spec.md#需求)、[DOM-R35](../domain-model/spec.md#需求)、[AUT-R18](../authentication/spec.md#權限檢查)、[AUT-R19](../authentication/spec.md#權限檢查)；派送時間依 #416 維護者裁定；近期已完成區依[負責人直接指示（2026-10-10，#105）](https://github.com/speko-tw/inspect-flow/issues/105#issuecomment-6093842135)（裁定 FEV-Q14，見 [`field-evidence`](../field-evidence/spec.md)，預設 14 天、可展開）；端點與分頁細節為規格設計 |
| FUI-R06 | Field 清單與詳情都**必須**以 `inspection_task.inspect` 作為專案權限。跨專案列表逐筆只回傳有權限專案資料；無權限的其他專案不影響列表。Field 詳情對不存在、`DRAFT` 或無該 Task 權限者統一回 404；不得讓只具 `inspection_task.read` 的唯讀成員看見現場任務。管理者依現有 Admin 規則放行。依兩層權限模型，現場查核另需查核模組「可使用」（`authentication` AUT-R19）；程式改造完成前維持現行行為（只看專案角色）。 | 必須 | [KD-69](../../intents/03-decisions-and-stack.md#kd-69)、[AUT-R18](../authentication/spec.md#權限檢查)、[AUT-R19](../authentication/spec.md#權限檢查)、[IP-R09](../inspection-planning/spec.md#需求)；現場查核權限的專案範圍與查核模組「可使用」依 KD-69；API 錯誤碼及 Field 隱藏草稿詳情契約為規格設計，後端依賴 #361、#416 |
| FUI-R07 | 登入狀態**必須**沿用 `authentication` 的伺服器端 Session 與 HttpOnly、Secure Cookie。未登入進入 Field 頁面時導向既有登入流程，登入成功後返回原請求路徑；Session 失效時依 `authentication` 的 401 契約重新登入。403 不得偽裝成空清單或登出。Field 頁面**必須**提供登出操作。 | 必須 | [KD-21](../../intents/03-decisions-and-stack.md#kd-21)、[AUT-R14](../authentication/spec.md#需求)、[AUT-R18](../authentication/spec.md#權限檢查)、[PR-01](../../intents/02-principles.md#pr-01)；返回路徑處理為規格設計 |
| FUI-R08 | Field **必須**提供適配手機與平板的觸控介面，基準寬度為 360px、390px、768px，主要觸控目標至少 44×44 CSS px；主要內容不得需要水平捲動即可閱讀。`viewport` meta **必須**允許使用者縮放。不得顯示範本庫設定、資料庫 ID、Requirement Schema、Project Configuration、Storage Key、metadata 或資料庫管理功能；唯一例外是 Field 量測欄位與其數值標準間關聯所需的 `measurement_fields[].id`、`numeric_standard.measurement_field_id`，供表單正確對應欄位，不得用於其他資料操作。另一個例外限於 [`field-evidence`](../field-evidence/spec.md) 的現場照片端點：回傳 `item_id`、`point_ids` 供前端對應查核項目與項次，畫面不顯示（FEV-R13）。 | 必須／不得 | [PR-10](../../intents/02-principles.md#pr-10)；尺寸及觸控基準與量測欄位關聯回應為規格設計（#416） |
| FUI-R09 | 現場 Web **必須**提供最小 Web App Manifest，含應用名稱、圖示、`display: standalone`、`start_url: /field/` 及主題色，並提供 iOS 主畫面捷徑所需圖示與 meta。MVP **不得**註冊快取型 Service Worker；採 Online-first，不宣稱離線查核、同步或背景上傳。 | 必須／不得 | [PWA 技術棧卡片](../../intents/03-decisions-and-stack.md#stack-pwa)、[KD-12](../../intents/03-decisions-and-stack.md#kd-12)；最小 manifest 與 iOS meta 為規格設計 |
| FUI-R10 | 設定 `INSPECTFLOW_DEV_HOST` 開放區網時，開發伺服器**必須**限制連入至明確指定的網段或介面，實際方式依 Vite 能力定案；**必須**提供 iPhone 安裝並明確信任 mkcert 根憑證的逐步指引，以及 iPhone 實測登入、Session 維持、登出流程。保留 Secure Cookie 所需 HTTPS；根憑證私鑰不得傳至裝置或提交 repository，後端仍只綁 localhost、由 HTTPS 前端代理 API。開發流程不得被描述為正式部署設定。 | 必須 | [KD-21](../../intents/03-decisions-and-stack.md#kd-21)、[#231](https://github.com/speko-tw/inspect-flow/issues/231)、[README iPhone 測試流程](../../../README.zh-TW.md)；網段限制技術方式為規格設計 |
| FUI-R11 | 現有 `/field/*` 個人工作台**必須**轉為今日任務現場首頁；範本瀏覽與專案套用範本為內業功能，**必須**移至 `/admin/...`，舊現場路徑轉址至新內業路徑。Field 保留個人資料、密碼變更與登出入口；公司資訊、專案清單及專案管理細節不得留在 Field 工作台，相關管理入口由 `admin-dashboard` 負責。任務本身所需的專案名稱及地點仍顯示於 Field 任務清單與詳情。 | 必須 | [PR-10](../../intents/02-principles.md#pr-10)、[OQ-21](../../intents/05-open-questions.md#oq-21)；現有 route 調整為規格設計；管理頁整合依賴 `admin-dashboard` |
| FUI-R12 | Field 首頁**不得**提供範本瀏覽、套用或存為範本入口；內業使用者由 `/admin/projects` 專案工作台卡片進入 `/admin/projects/{project_id}/templates`。舊 `/field/projects/{project_id}` 網址**必須**轉址至對應內業路徑。 | 不得／必須 | 負責人直接指示（#429，原型核可 2026-10-05）；入口與轉址細節為規格設計。 |

## 資料

本規格不新增資料實體或欄位。`Inspection Task`、Task 項目與 `Task Requirement Snapshot` 沿用 [domain-model](../domain-model/spec.md)；Project、Task 地點與派任務規則沿用 [inspection-planning](../inspection-planning/spec.md)；狀態與轉換沿用 [state-machines](../state-machines/spec.md)。Task Requirement Snapshot 建立時保存需求；依 KD-55 核准的文字更正例外由 Task API 回傳更新後內容，Field 只呈現伺服器權威資料，不自行修改或還原快照。Task 地點使用 Task 回應內嵌的分區 `{id, name}` 與 `location_text`；Field 不呼叫分區列表 API，也不要求 `project_zone.read`。無分區時只顯示 `location_text`。

排序使用 `Inspection Task.dispatched_at`，首次派送時記錄伺服器時間；既有非 DRAFT Task 以 `created_at` 近似回填，細節見 [DOM-R56](../domain-model/spec.md#plan-task-與需求快照-部分凍結)、[IP-R11](../inspection-planning/spec.md#需求) 與 #416。

## 介面

畫面路由及新增 API 的精確形式為**規格設計（非負責人裁定）**。清單與詳情均使用 `inspection_task.inspect`；跨專案列表為逐筆篩選，指定單一專案時依該專案權限拒絕存取。Field 詳情須使用能將 `DRAFT` 與無權限資源隱藏的端點；通用 Task 讀取端點的 `inspection_task.read` 契約不等同 Field 可見性。

| 方法 | 路徑 | 用途 | 權限 |
|---|---|---|---|
| GET | `/field/tasks` | 今日任務及跨專案已派任務清單；預設本人建議指派，可切換全部可查核任務；`limit`／`cursor` 分頁 | 前端需登入；後端逐筆套用 `inspection_task.inspect` |
| GET | `/field/tasks/{task_id}` | 現場任務詳情與需求快照 | 前端需登入；後端 `inspection_task.inspect`；不存在、`DRAFT` 或無權限一律 404 |
| GET | `/api/v1/field/inspection-tasks` | 跨專案列出 `PENDING`、`IN_PROGRESS` 已派任務；`assigned_to_me=true` 預設，`false` 列出所有可查核專案任務；可選 `project_id`、`status=PENDING\|IN_PROGRESS\|COMPLETED`（省略為全部未完成狀態，不含 `COMPLETED`）、`completed_within_days`（只在 `status=COMPLETED` 時有效，預設 14，範圍 1–90）、`limit`（預設 50、範圍 1–100）、`cursor`。狀態在資料庫查詢層篩選，與 cursor 分頁共用相同排序。回 `{items,next_cursor}`；每筆含 `id`、`project_id`、`project_name`、`status`、`dispatched_at`、`location: {zone_name,location_text}`、`completed_at`（只有 `COMPLETED` 非空）、`suggested_assignee: {name_zh}\|null`、`item_summary: {first_title: string\|null, item_count: number}`。摘要採第一個 Task 查核項目之目前需求快照標題與項目總數；無目前快照時標題為 null，前端以「查核任務」呈現。全部檢視中的建議執行人姓名可見，以便同專案協作 | `SYSTEM_ROLE_OR_ANY_PROJECT_PERMISSION`；逐筆檢查 `inspection_task.inspect`；Admin 即使無專案或指定不存在的 `project_id` 仍回 200 空頁；非 Admin 無任何專案權限或指定專案無權限回 403；有權限無符合資料為空頁 |
| GET | `/api/v1/field/inspection-tasks/{task_id}` | 現場安全詳情，含分區名稱、補充位置、建議執行人及目前需求快照；另含 `suggested_assignee.is_me`（登入者是否為建議執行人）、`started_by: {name_zh,is_me}\|null`（實際開始者顯示名稱，未開始為 null）、`cancellation_reason: string\|null`（僅 `CANCELLED` 回原因，其餘為 null）；只給顯示名稱與是否為本人，不給使用者 ID 或帳號。不回傳 Plan ID、其他人帳號、歷史 Snapshot 或內業專用欄位。量測欄位回 `id`、`name`、`field_type`、`unit`；數值標準回 `measurement_field_id` 以關聯量測欄位 | `inspection_task.inspect`；`DRAFT`／不存在／無權限統一回 404；只具 `inspection_task.read` 回 404 |
| POST | `/api/v1/inspection-tasks/{task_id}:start` | 開始查核；既有端點，本規格定義 Field 呼叫行為與被拒絕時的說明（見表後說明） | `inspection_task.inspect`，後端覆核 Task 與 Plan 狀態 |

開始查核被拒絕時，前端依後端回應對應說明，並顯示在操作旁、聚焦錯誤訊息；不做樂觀更新，成功與否以後端回應為準。回應為 409 且錯誤碼 `inspection_plan.archived` 時說明計畫已封存；409 且錯誤碼 `inspection_task.invalid_transition` 時表示狀態已變，前端重抓 Field 詳情，依權威狀態說明已取消（附取消原因）、已由他人開始或已完成，若其實是登入者自己已開始則直接顯示進行中；403 說明權限不足；404 說明找不到任務；401 重新登入；其餘狀態碼與網路中斷視為任務未開始，保留確認並允許再試。

列表排序鍵為 `dispatched_at DESC, id DESC`，只查詢 `dispatched_at IS NOT NULL` 的非草稿資料，NULL 明確排在最後；游標包含此排序鍵並遵循 API-R08，不能以 `updated_at` 作游標或排序鍵；開始查核不得改變派送順序。Field 詳情只回目前 Snapshot 的使用者可見內容；不包含來源範本名、Task/Plan/項目關聯 ID、Snapshot 歷史、其他使用者帳號或內業專用資料。數值標準與量測欄位以來源欄位 UUID 對應；量測欄位按 `sort_order, id` 排序。不存在資源、DRAFT、只具 read 權限或無專案 inspect 權限統一回 404 `resource.not_found`；列表入口無任何 inspect 權限或指定專案無權限的非 Admin 回 403 `permission.denied`。Admin 有權限但無符合資料（含不存在的 `project_id`）回 200 空頁。有權限但沒有符合資料回 200 空頁。未登入回 401。端點與回應欄位為規格設計（非負責人裁定）；#416 實作契約依 #417 前端需求對齊。

## 現況與銜接

現有 `/field/*` 的個人工作台含個人資料、公司、專案、範本瀏覽、變更密碼、登出及 Admin 入口；`/field/projects/:projectId` 用於專案範本套用。Field UI 交付時，工作台內容改為今日任務首頁；範本瀏覽及專案套用頁搬至 `/admin/...`，舊網址轉址至對應新路由。個人資料、變更密碼與登出仍可由 Field 存取；公司資訊、專案清單及專案管理細節由 `admin-dashboard` 負責，Field 任務只顯示完成查核所需的專案名稱與地點。若 Admin 未提供目標路由，列為整合依賴，不把範本或專案管理功能留在 Field。

## 驗收條件

以下 AC 必須以真實 API／後端整合驗證；mock 僅可用於單元與元件呈現測試，不能作為 API、權限或端到端驗收證據。

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| FUI-AC01 | 真實後端有兩個具 `inspection_task.inspect` 權限的專案，含本人／他人／未指派及各種狀態任務；另有無權限專案 | 讀取今日清單、切換全部可查核任務，並展開「近期已完成」區 | 預設只見本人建議指派的未完成任務；切換後見所有有權限專案的未完成任務；只具 `inspection_task.read` 者看不到任務；`DRAFT`、`CANCELLED` 及無權限專案資料均不可見；未完成清單不含 `COMPLETED`；「近期已完成」區（`status=COMPLETED`）預設只列最近 14 天完成的任務、依 `completed_at` 新到舊排序、預設收合並可展開，超過天數的已完成任務不出現；調整 `completed_within_days` 範圍隨之改變，超出 1–90 回 422 | FUI-R02、R05、R06 |
| FUI-AC02 | 真實 API 中，非 Admin 對任何專案皆無 `inspection_task.inspect` 權限；另有有權限但無符合資料的使用者 | 呼叫跨專案列表；再以無權限及有權限的 `project_id` 篩選 | 無任何專案權限回 403；有權限但無符合資料回 200 空清單；指定專案無成員資格或無權限回 403；有權限的跨專案清單逐筆過濾 | FUI-R05、R06 |
| FUI-AC03 | 真實 Task API 回應含分區名稱及補充位置文字；另有僅 `location_text` 的 Task；需求快照含照片／量測要求，其中一筆已依 KD-55 更正文字 | 開啟現場任務詳情 | 顯示內嵌分區名稱與補充文字，無分區時只顯示補充文字；不呼叫分區列表 API；唯讀呈現 API 回傳的當前需求文字（含 KD-55 授權更正）及其要求；不寫入 Evidence、Result 或自行修改快照 | FUI-R03、R06 |
| FUI-AC04 | 真實後端有 `DRAFT` Task；使用者僅有 `inspection_task.inspect`，沒有計畫管理權限 | 以列表與詳情 API 直接請求該 Task ID | 列表排除該 Task，詳情回 404；直接知道 ID 不會繞過 Field 隱藏規則 | FUI-R03、R06 |
| FUI-AC05 | 真實後端有未封存專案中的 `PENDING` Task，登入者具 `inspection_task.inspect` 但不是建議指派人 | 使用者按開始查核 | 後端接受合法動作，變為 `IN_PROGRESS` 並記錄實際使用者；介面顯示伺服器最新狀態 | FUI-R04 |
| FUI-AC06 | 真實後端有 `IN_PROGRESS`、`COMPLETED`、`CANCELLED` 及封存 Plan 的 Task | 查看操作並直接重送開始請求 | UI 不提供非法開始操作；後端拒絕非法狀態或權限請求且 Task 不變；封存 Task 唯讀 | FUI-R04 |
| FUI-AC07 | 真實 API 有超過一頁且具相同派送時間的資料 | 使用預設與全部任務篩選，以 `limit`／cursor 取完資料並開始其中一筆 | `limit` 預設 50、拒絕或限制至上限 100；依 `dispatched_at DESC` 再 Task UUID 穩定排序，無重複遺漏；開始查核不改變排序；cursor 不透明且本人條件由 Session 決定 | FUI-R02、R05 |
| FUI-AC08 | 使用者未登入、Session 失效、只具 read 權限，或沒有 inspect 權限；含 403 與 401 情境 | 開啟 Field 路由或呼叫列表／詳情 API | 未登入依登入流程成功後返回原路徑；Session 失效依 401 重新登入；403／404 不偽裝成空清單或登出；read-only 使用者不可見現場任務 | FUI-R06、R07 |
| FUI-AC09 | 以真實前端及後端在 360px、390px、768px viewport 檢視列表、詳情、操作區 | 使用觸控閱讀需求及操作允許的 Task，檢查頁面 meta | 主要觸控目標至少 44×44 CSS px；內容無水平捲動；viewport 可縮放；無 PR-10 禁止內容 | FUI-R08 |
| FUI-AC10 | 前端建置產物包含 Field 路由，且開啟 `/field/` | 檢查 manifest、iOS 主畫面捷徑與 Service Worker | manifest 含名稱、圖示、`display: standalone`、`start_url: /field/`、主題色；iOS 圖示及 meta 可用；未註冊快取型 Service Worker；Field 不載入 Admin chunk，資料由線上 API 提供 | FUI-R01、R09 |
| FUI-AC11 | `INSPECTFLOW_DEV_HOST` 啟用區網 HTTPS 開發伺服器，並有 iPhone 與開發機同網段 | 從允許網段／非允許來源連線；在 iPhone 安裝並信任 mkcert 根憑證，登入、重新載入、登出 | 僅指定網段或介面可連入；指引可依序完成根憑證安裝與完整信任；Safari 可登入、維持 Session 並登出；Secure Cookie 與 HTTPS API proxy 可用；不傳送 CA 私鑰 | FUI-R07、R10 |
| FUI-AC12 | 現有 `/field/*` 工作台及 `/field/projects/:projectId` 範本頁仍可由瀏覽器直接開啟 | 導入 Field 首頁與管理路由 | Field 首頁為今日任務；範本瀏覽與專案套用移至 `/admin/...`，舊路徑轉址；Field 保留個人資料、密碼變更及登出，不保留公司資訊、專案清單或專案管理細節；任務所需的專案名稱與地點仍可見 | FUI-R07、R11 |
| FUI-AC13 | Field 首頁、內業專案工作台及既有 `/field/projects/{project_id}` 網址 | 導入 #429 專案套用入口 | Field 首頁沒有範本瀏覽、套用或存為範本連結；專案卡片提供套用範本主要動作並連至內業套用頁；舊網址直接轉址至同一專案的內業套用頁，不顯示 UUID | FUI-R11、R12 |

## 待釐清

- `dispatched_at`、Field 清單及安全詳情 API 已由 #416 提供；前端整合由 T2、T3 驗收。
- Field 安全詳情對 DRAFT 與無 inspect 權限回 `404 resource.not_found`；不得以目前通用 `inspection_task.read` 詳情端點取代。
- #231 的區網限制落實方式須依 Vite 能力於實作時選定；若 Vite 無法限制來源網段或介面，先提出可驗證替代設計再實作。
- 範本頁遷移需要 `admin-dashboard` 提供目標路由；若時程交錯，維持此項為明確整合依賴，不得保留在 Field。

## 變更紀錄

- 規格設計（非負責人裁定，#419）：Field 安全詳情增列 `suggested_assignee.is_me`、`started_by`（顯示名稱與是否本人）與 `cancellation_reason`（僅已取消任務），讓開始查核後顯示實際開始者、非建議指派者的提示及取消競態的原因；開始被拒絕的說明文案依後端錯誤碼對應，屬規格設計。
- 規格設計（非負責人裁定，#417）：Field 列表增列目前查核項目摘要及資料庫層 `status` 篩選；卡片多項目文案為「第一項等 N 項」，返回清單時以 URL 保留範圍與狀態、Field 頁面記憶保留已載入頁數及捲動位置；離開 Field 頁面後清除記憶。
- 依 PR #443 第 1 輪審查補充 Field API 邊界、量測欄位對應與排序契約 — #416
- 規格設計（非負責人裁定，#416）：明定 Field 列表／安全詳情 API 的端點、參數、回應欄位、錯誤碼、逐專案權限過濾及 `dispatched_at` 排序來源；詳情只回 Field 安全欄位 — [#416 維護者裁定](https://github.com/speko-tw/inspect-flow/issues/416#issuecomment-5987138346)

- FUI-R12、FUI-AC13：依 #429 核可原型，Field 首頁移除範本入口並由內業專案工作台卡片提供套用入口；路徑行為屬規格設計。
- 修正草稿：補齊來源裁定連結、權限與草稿保護、PWA/iPhone 驗收及現有路由銜接；未改變領域模型。
- 意圖變更跟進（負責人裁定，[#538](https://github.com/speko-tw/inspect-flow/issues/538)）：FUI-R06 補現場查核另需查核模組「可使用」，過渡期維持現行行為；引用意圖改為 KD-69 — [#538 裁定留言](https://github.com/speko-tw/inspect-flow/issues/538#issuecomment-6081327833)
- 範圍變更（負責人指示，#105）：FUI-R05、FUI-AC01 增設「近期已完成」區，預設最近 14 天、可展開，清單端點新增 `status=COMPLETED` 與 `completed_within_days`；FUI-R08 宣告現場照片端點回傳 `item_id`、`point_ids` 的例外 — [負責人直接指示](https://github.com/speko-tw/inspect-flow/issues/105#issuecomment-6093842135)
