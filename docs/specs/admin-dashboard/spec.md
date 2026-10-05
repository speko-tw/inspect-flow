# 管理後台（admin-dashboard）

**代碼**：`ADM`　**Phase**：P5　**狀態**：草稿
**前置規格**：`inspection-planning`、`authentication`、`audit-log`；全公司角色依 [KD-60](../../intents/03-decisions-and-stack.md#kd-60)／[KD-67](../../intents/03-decisions-and-stack.md#kd-67) 與 #390 前置規格更新
**引用意圖**：[PR-03](../../intents/02-principles.md#pr-03)、[PR-08](../../intents/02-principles.md#pr-08)、[KD-13](../../intents/03-decisions-and-stack.md#kd-13)、[KD-24](../../intents/03-decisions-and-stack.md#kd-24)、[KD-49（已由 KD-60 取代）](../../intents/03-decisions-and-stack.md#kd-49)、[KD-60](../../intents/03-decisions-and-stack.md#kd-60)、[KD-66](../../intents/03-decisions-and-stack.md#kd-66)、[KD-67](../../intents/03-decisions-and-stack.md#kd-67)、[04-glossary](../../intents/04-glossary.md)
**被擋議題**：無 OQ／G；全公司角色與權限畫面的需求及範圍依已裁定的 [KD-60](../../intents/03-decisions-and-stack.md#kd-60)、[KD-67](../../intents/03-decisions-and-stack.md#kd-67)；實作依賴 #390 更新 authentication／domain-model 前置規格

## 目的

讓內勤人員監看已派出的查核工作與工程師工作量，讓 Admin 管理全公司角色及查詢唯讀稽核紀錄。Dashboard 是管理工具，不是正式交付物；正式報告仍由 `report-delivery` 負責（依據：[01-overview.md](../../intents/01-overview.md#查核生命週期)，架構基準 §20.1、§20.22）。

## 範圍

**包含**：

- 管理後台唯讀總覽及 Dashboard 查詢 API：今日工作量、完成數、完成率、專案進度、工程師工作量。
- 依存取權限呈現單一專案或全部專案；全部專案總覽只供具全公司「看全部專案進度」權限者。
- 工程師工作量並列「派給誰」的待辦數與「誰查的」實際完成數。
- Admin 專用、唯讀的稽核紀錄查詢頁與 API，依專案、操作者、時間、動作類型篩選並分頁。
- 全公司角色的列表、建立、修改權限勾選、指派給使用者等管理畫面；Admin 擁有全部權限。
- 專案列表顯示成員數（#286）；若 API 契約尚未落地，先完成所需規格變更再實作。
- 已有簡便版管理功能維持由 0.2.x 規格負責；本規格承接進階管理畫面及搜尋、分頁、批次能力（依 #259 裁定與既有規格）。

**不包含**（注明移到哪份規格，或屬於哪一條非目標）：

- 建立、派出、取消、恢復或封存 Plan／Task 的操作，屬 `inspection-planning` 與現場工作流程；本規格只讀取並呈現其資料（#363）。
- 完成查核所需的證據或影像編修，屬 `field-evidence`；完成數與完成率在 0.5.x 依 Task 狀態計算，0.7.x 完成驗證上線後改採伺服器驗證完成，維持相同指標（依 [KD-66](../../intents/03-decisions-and-stack.md#kd-66)）。
- 定義角色、權限資料模型或重新制定存取控制規則；模型由 `authentication`、`domain-model` 與 intents 負責，本規格只使用（#387、#390）。
- 稽核事件寫入、保留與不可變更規則，屬 `audit-log`。
- 正式報告、報告範本及核發流程，屬 `report-delivery`。
- 全公司使用者／公司基本管理、基本角色與專案管理的 0.2.x 簡便功能；其已交付部分見 `domain-model`、`authentication` 及 #263、#265、#274、#275、#277。

### 0.2.x 現況與散落工作處置

以下依目前程式碼確認既有交付與缺口；「本規格」代表本規格涵蓋的新功能，不代表相關 API 已實作。

| 項目 | 0.2.x 現況（程式證據） | 處置 |
|---|---|---|
| 使用者基本管理 | `backend/app/api/v1/users.py` 提供列表、單筆、建立、修改、公司連結、Admin 與啟用狀態；`frontend/src/admin/UsersPage.tsx` 提供基本管理及搜尋、cursor 分頁 | 搜尋與 cursor 分頁已完成；基本 CRUD 沿用既有功能，批次啟用狀態仍由本規格處理 |
| 公司基本管理 | `backend/app/api/v1/companies.py` 提供列表、單筆、建立、修改、啟用狀態及停用前指定使用者；`frontend/src/admin/CompaniesPage.tsx` 提供影響確認、搜尋及 cursor 分頁 | 搜尋與 cursor 分頁已完成；既有單筆 CRUD 沿用，批次狀態操作仍由本規格處理 |
| Admin 為既有使用者重設臨時密碼 | `backend/app/api/v1/users.py` 目前僅在建立使用者時回傳臨時密碼，沒有既有使用者重設路由；`authentication` AUT-R36／AUT-R37 已定義共用入口與臨時密碼規則 | 本規格加入 Admin 重設端點及一次性顯示流程，呼叫 AUT-R36，不另定密碼機制 |
| 專案角色管理 | `backend/app/api/v1/roles.py`、`frontend/src/admin/roles/RolesPage.tsx` 已實作全系統角色 CRUD；`domain-model` DOM-R55、DOM-AC47 定義 cursor API 與 `user_count`／`project_count` 影響數 | 已完成；本規格沿用專案角色管理與既有影響資訊，不重做角色模型 |
| 專案與成員基本管理 | `backend/app/api/v1/projects.py`、`frontend/src/admin/projects/ProjectsPage.tsx`、`frontend/src/admin/projects/ProjectDetailPage.tsx` 提供專案及成員基本操作；專案角色指派沿用既有角色 API | 基本管理與列表搜尋／cursor 分頁已完成；成員批次指派／撤銷仍由本規格處理 |
| 角色變更前影響範圍（PR-18） | 專案角色介面已有 `user_count`、`project_count`；全公司角色由 #387／#390 前置規格定義，現有介面尚未提供公司角色變更前的受影響人員與權限差異 | 本規格要求公司角色修改、刪除、指派及撤銷前顯示受影響人數、名單、權限差異並確認；專案角色沿用 DOM-AC47 |
| #286 專案成員數 | `backend/app/api/v1/projects.py` 的專案列表回應尚無 `member_count`；#286 要求 API 與列表提供此數值 | 納入本規格；先依規格變更流程更新 `domain-model` API 契約，再實作 |

## 使用情境

- 內勤人員開啟後台，依自己的專案權限查看工作量、完成情況及專案進度。
- 具全公司「看全部專案進度」權限者查看跨專案總覽，並比較各專案及工程師的進度與工作量。
- 內勤人員比較任務建議指派給誰與實際由誰完成查核，辨識代查情形。
- Admin 建立或調整全公司角色、勾選該範圍可用的權限並指派給使用者。
- Admin 依專案、操作者、時間及動作類型查詢稽核紀錄；頁面不提供修改或刪除操作。

## 需求

除明確標為負責人裁定的項目外，本規格所選的呈現方式、批次操作與 API 路徑屬**規格設計（非負責人裁定）**；不得據此新增或改寫 intents、角色資料模型或權限代碼。角色範圍與權限矩陣依 [OQ-08](../../intents/05-open-questions.md#oq-08)／[KD-60](../../intents/03-decisions-and-stack.md#kd-60)；schema 與 API 契約依 #390 前置規格。

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| ADM-R01 | 後台**必須**提供唯讀總覽及查詢 API；Dashboard 不得包裝成正式報告或正式交付物 | 必須 | 0.5.x 雛形流程依負責人補充（[#107 留言](https://github.com/speko-tw/inspect-flow/issues/107#issuecomment-5977852498)）；Dashboard 不作正式交付物依 #375 與 [01-overview.md](../../intents/01-overview.md#查核生命週期)，屬範圍依據 |
| ADM-R02 | 今日工作量與「派給誰」**必須**只計非封存 Plan 下狀態為 `PENDING` 或 `IN_PROGRESS` 的 Task；不依日期篩選，排除 `DRAFT`、`CANCELLED` 及封存 Plan 下的 Task | 必須 | 負責人裁定（[#104 留言](https://github.com/speko-tw/inspect-flow/issues/104#issuecomment-5977711401)）；`inspection-planning`、`state-machines` |
| ADM-R03 | 完成數**必須**只計 `COMPLETED` Task；完成率**必須**為 `COMPLETED` 數 ÷ 同一查詢範圍內所有非取消且已派出的 Task 數（含 `PENDING`、`IN_PROGRESS`、`COMPLETED`）。分母為 0 時回傳 `0` | 必須 | 完成數與完成率 0.5.x 依 Task 狀態計算（依 [KD-66](../../intents/03-decisions-and-stack.md#kd-66) 與 #388）；公式為規格設計（非負責人裁定） |
| ADM-R04 | 專案進度**必須**按專案呈現已派出 Task 總數、完成數與完成率，使用 ADM-R03 口徑；封存 Plan 不排除在歷史完成數與分母之外 | 必須 | 功能範圍依 #375、#388；封存 Plan 的計算口徑為規格設計（非負責人裁定） |
| ADM-R05 | 工程師工作量**必須**分開呈現「派給誰」的 `PENDING`／`IN_PROGRESS` 數與「誰查的」依 `completed_by` 歸屬的 `COMPLETED` 數；不得混為單一數字。另應呈現由 `started_by` 歸屬的 `IN_PROGRESS` 開始者數 | 必須／應 | 負責人裁定（[#107 留言](https://github.com/speko-tw/inspect-flow/issues/107#issuecomment-5977779246)）；額外開始者數為規格設計（非負責人裁定） |
| ADM-R06 | 專案範圍總覽**必須**只回傳目前使用者具「看專案進度與工作量」專案權限可存取的專案；全公司總覽**必須**要求「看全部專案進度」全公司權限，專案權限不得擴大成全公司範圍 | 必須 | 權限名稱、範圍與分組依 [OQ-08](../../intents/05-open-questions.md#oq-08) 及 [KD-60](../../intents/03-decisions-and-stack.md#kd-60)；完整角色管理排入 0.5.x 依 [KD-67](../../intents/03-decisions-and-stack.md#kd-67)，schema 與 API 依 #390 前置規格 |
| ADM-R07 | 只有 Admin **得**進入稽核查詢頁及呼叫查詢 API；介面唯讀，不新增、修改或刪除紀錄 | 必須 | 負責人裁定（[#107 留言](https://github.com/speko-tw/inspect-flow/issues/107#issuecomment-5977843511)）；[KD-24](../../intents/03-decisions-and-stack.md#kd-24)、ALG-R04 |
| ADM-R08 | 稽核查詢**必須**支援專案、操作者、時間範圍、事件類型篩選與穩定 cursor 分頁；沿用 `audit-log` 定義的事件及欄位 | 必須 | 負責人裁定選 C（[#107 留言](https://github.com/speko-tw/inspect-flow/issues/107#issuecomment-5977843511)）；欄位及 cursor 契約沿用 [audit-log](../audit-log/spec.md) 與 [KD-13](../../intents/03-decisions-and-stack.md#kd-13) |
| ADM-R09 | Admin **必須**能管理全公司角色並指派給使用者，僅選全公司權限；不得混入專案角色／專案權限。Admin 的有效權限維持全部權限 | 必須 | #387／#390 權限需求來源；資料與權限模型以合併後 intents／前置規格為準 |
| ADM-R10 | 修改或刪除全公司角色，以及指派或撤銷角色前，**必須**顯示受影響人數、受影響人員名單及各人的權限變化，並要求明確確認後才送出變更；專案角色沿用 0.2.x DOM-AC47 已有的 `user_count`／`project_count` 影響資訊 | 必須 | 角色修改／刪除影響確認依 PR-18；公司角色指派／撤銷前的名單與權限差異屬規格設計（非負責人裁定）；專案角色依 [角色管理 API](../domain-model/spec.md#角色管理-api)（DOM-R55、DOM-AC47） |
| ADM-R11 | 全公司角色管理**必須**呈現可修改的預建角色；範本管理權限不得寫死成不可修改角色。既有角色遷移依 #390 更新後規格 | 必須 | 需求來源：#387、#390；既有角色遷移依更新後規格 |
| ADM-R12 | 專案列表**必須**顯示後端契約提供的成員數；若契約未定，先依流程完成 `domain-model` 規格變更，不得以 UI 假值通過驗收 | 必須 | [#286](https://github.com/speko-tw/inspect-flow/issues/286)、[變更規則](../README.md#change) |
| ADM-R13 | 已交付的 0.2.x 基本管理不得重做；本規格**必須**補使用者／公司搜尋、cursor 分頁、批次啟用狀態、專案搜尋／分頁、成員批次指派／撤銷及 Admin 為既有使用者設定臨時密碼 | 必須 | 基本功能與進階功能分工依 #259、[authentication](../authentication/spec.md#範圍)、[domain-model](../domain-model/spec.md#範圍)；批次操作與既有使用者臨時密碼端點屬規格設計（非負責人裁定） |
| ADM-R14 | 0.5.x 主要流程**應**涵蓋派出 Task、現場查看／開始 Task、後台查看進度與工作量；0.5.x 不提供現場完成 Task，因此完成數、完成率及「誰查的」得為 0；示範資料建議含 `COMPLETED` Task | 應 | 主要流程依負責人補充（[#107 留言](https://github.com/speko-tw/inspect-flow/issues/107#issuecomment-5977852498)），Field 尚不能完成依負責人裁定（[#104 留言](https://github.com/speko-tw/inspect-flow/issues/104#issuecomment-5977711401)）；seed 建議依 #381，非負責人裁定 |
| ADM-R15 | 專案管理介面**必須**提供專案首頁，以專案代號及名稱識別專案；首頁依 workflow summary 的 `primary_step` 顯示唯一主要下一步及前往連結，沒有待處理步驟時顯示「追蹤進度」；關鍵數字呈現成員、查核項目、草稿任務、已派出未完成及待重查，`task_counts_visible=false` 時不得以 0 代替隱藏數字，並顯示「無權查看任務」 | 必須 | 範圍變更（負責人指示，#447）；欄位與顯示細節為規格設計（非負責人裁定） |
| ADM-R16 | 專案首頁**必須**提供「專案首頁、成員、查核項目、分區、計畫與任務、進度」區段導覽；手機版以「區段選單」抽屜呈現，觸控目標至少 44px、可用鍵盤操作，當前區段使用 `aria-current` | 必須 | 範圍變更（負責人指示，#447）；介面細節為規格設計（非負責人裁定）；[PR-19](../../intents/02-principles.md#pr-19) |
| ADM-R17 | 只有 `inspection_task.inspect`／`inspection_task.read` 現場執行權限，且沒有任何內業專案權限者，**必須**隱藏專案內業區段並導向 Field；前端依 workflow summary 的 `viewer_permission_codes` 有效專案權限判斷，不得用任務數字或 DRAFT 可見性推測；有效權限含任何內業權限時可進入專案區段 | 必須 | 範圍變更（負責人指示，#447）；現場／內業權限判斷與 UI 路由細節為規格設計（非負責人裁定）；PR-10、AUT-R19 |
| ADM-R18 | 專案列表**必須**提供「開啟專案」連結；建立專案成功後**必須**導向該專案首頁 | 必須 | 範圍變更（負責人指示，#447）；導向方式為規格設計（非負責人裁定） |

## 資料

本規格不新增領域實體。Task 狀態、`assignee_id`、`started_by`、`completed_by` 與 Plan 狀態沿用 [domain-model](../domain-model/spec.md)、[inspection-planning](../inspection-planning/spec.md) 與 [state-machines](../state-machines/spec.md)；稽核資料沿用 [audit-log](../audit-log/spec.md)。角色範圍及權限名稱依 [OQ-08](../../intents/05-open-questions.md#oq-08) 與 [KD-60](../../intents/03-decisions-and-stack.md#kd-60)；schema、permission code、seed 與 migration 依 #390 更新後的前置規格，不在此預設。

#286 的 `member_count` 是專案回應契約變更；先更新 `domain-model` 並完成其規格流程再實作。規格設計（非負責人裁定）：數值計算該專案現存 `ProjectMember` 關聯列數；是否排除停用使用者須由 `domain-model` 變更一併明定。

### 指標口徑

- **今日工作量／派給誰**：查詢時有效權限範圍內，Plan 非 `ARCHIVED` 且 Task 為 `PENDING` 或 `IN_PROGRESS` 的數量；不以日期過濾。取消與草稿不計。
- **完成數**：`COMPLETED` Task 數，按 `completed_by` 歸屬「誰查的」。0.5.x Field 尚不能完成 Task（#104），故正式串接尚無完成紀錄時數值為 0；驗收與示範資料必須透過 API／seed 準備已完成 Task，不得假設現場畫面能建立它。
- **完成率**：分子為 `COMPLETED` 數；分母為同範圍內 `PENDING`、`IN_PROGRESS`、`COMPLETED` 數。Task 所屬 Plan 為 `ARCHIVED` 時，不納入今日工作量，但仍納入歷史完成數及完成率。分母為 0 時回傳 0。
- **工程師彙總**：`assignee_id` 的進行中未完成數、`completed_by` 的完成數、`started_by` 的進行中數分開分組；一人可同時出現在不同欄位，三者不可相加當作互斥總人數。

上述完成率分母及封存 Plan 的歷史統計處理為規格設計（非負責人裁定）；若 #388 或正式前置規格後續有明確公式，依規格變更流程同步調整。

## 介面

本節列出具體 API 契約。`GET /api/v1/users`、`/api/v1/companies`、`/api/v1/projects` 依 #407 同 PR 範圍變更採用 cursor 回應；`authentication`／`domain-model` 介面同步列出契約。清單端點遵守 API-R08：`cursor` 是不透明字串，`limit` 預設 50、範圍 1–100，回應 `{items, next_cursor}`；排序鍵均含 UUID。這組 page-size 預設是規格設計，沿用既有 `GET /api/v1/roles` 慣例。所有端點使用 API-R01 前綴 `/api/v1`、API-R02 HTTP 狀態及 API-R05 錯誤 envelope；錯誤代碼由共用 ErrorCode 列舉提供，不在本規格另列代碼對照表。

| 方法與路徑 | 契約與回應 | 權限與錯誤 |
|---|---|---|
| `GET /api/v1/admin/dashboard/summary?project_id=<uuid>` | 單一物件：`pending_count`、`in_progress_count`、`completed_count`、`completion_rate`；不分頁。省略 `project_id` 查全公司；提供時限單一專案 | 「看專案進度與工作量」專案權限或「看全部專案進度」全公司權限；未登入 401，無權限 403；越權或不存在的專案均 403，遵守現有專案端點避免洩漏資源存在性 |
| `GET /api/v1/admin/dashboard/projects?cursor=&limit=&q=` | `{items:[{project_id,name,pending_count,in_progress_count,completed_count,completion_denominator_count,completion_rate,member_count}],next_cursor}`；依 `(project.name, project.id)` 升冪；`q` 為專案名稱／代碼不分大小寫子字串；`member_count` 僅在 #286 契約先合併後提供 | 各專案只套用呼叫者持有「看專案進度與工作量」權限的範圍；全公司查詢需「看全部專案進度」權限。錯誤同 summary；cursor／limit／q 無效 422 |
| `GET /api/v1/admin/dashboard/engineers?project_id=<uuid>&cursor=&limit=&q=` | `{items:[{user_id,username,name_zh,assigned_pending_count,assigned_in_progress_count,completed_by_count,started_in_progress_count}],next_cursor}`；依 `(username,user_id)` 升冪；`q` 搜尋 username、中英文姓名、email、employee number | 「看專案進度與工作量」專案權限或「看全部專案進度」全公司權限；project scope 必須提供 `project_id`；不得藉參數擴權；錯誤同 summary |
| `GET /api/v1/audit-logs?project_id=&actor_id=&from=&to=&event_type=&cursor=&limit=` | `{items:[既有 AuditLog 欄位],next_cursor}`；依 `(created_at,id)` 降冪；`from`／`to` 為 UTC ISO-8601，含起不含迄；多條件 AND 篩選；指定格式正確但不存在的 `project_id` 回 200 空頁 `{items:[],next_cursor:null}` | Admin；401 未登入、403 非 Admin；不存在專案為空結果而非權限錯誤；格式錯誤 422；只讀 |
| `GET /api/v1/users?q=&cursor=&limit=` | 將目前全量列表改為 cursor page `{items:[既有 User 欄位],next_cursor}`；依 `(username,id)` 升冪；`q` 不分大小寫搜尋 username、姓名、email、employee number | Admin（沿用 AUT-R20）；401／403／422 如上；保留現有單筆及寫入端點 |
| `POST /api/v1/users:batch-active-status` | 本體 `{user_ids:[uuid],is_active:boolean}`；成功回 `{items:[User]}`；整批原子提交；重複或空 ID、未知 ID、停用最後一位 Admin 等驗證失敗時不改任何列 | Admin；401／403；輸入或管理規則違反 422，衝突依既有管理錯誤映射 409 |
| `POST /api/v1/users/{user_id}/temporary-password` | 空本體；經 AUT-R36 設定系統產生的臨時密碼並標 `must_change_password=true`；回 `{user_id,username,temporary_password,must_change_password:true}` 一次，回應設 `Cache-Control: no-store`；呼叫 AUT-R36 的工作階段撤銷、失敗計數重設與稽核行為 | Admin；401／403；未知使用者 404；不得重設內建 `admin` 或外部身分帳號，回 422；成功後舊 session 失效 |
| `GET /api/v1/companies?q=&cursor=&limit=` | `{items:[既有 Company 欄位],next_cursor}`；依 `(name,id)` 升冪；`q` 不分大小寫搜尋名稱 | Admin；401／403／422 如上；保留既有單筆及寫入端點 |
| `POST /api/v1/companies:batch-status` | 本體 `{items:[{company_id,is_active,disable_user_ids:[uuid]}]}`；逐公司套用既有停用語意，成功回 `{items:[Company]}`；整批原子提交，避免部分公司更新 | Admin；401／403；未知 ID、重複項目或不屬於該公司的 `disable_user_ids` 回 422 且整批不變 |
| `GET /api/v1/projects?q=&cursor=&limit=` | 將既有列表回應改為 `{items:[既有 Project 欄位],next_cursor}`；依 `(name,id)` 升冪；`q` 搜尋專案名稱／代碼；`member_count` 仍待 #286 `domain-model` 契約完成後另行加入 | 沿用既有 Admin／SystemRole 檢查；401／403／422 |
| `GET /api/v1/projects/{project_id}/workflow-summary` | 依 `inspection-planning` IP-R11 回傳 `project: {id, project_code, name}`、專案摘要、`next_steps`、`primary_step`、`task_counts_visible`、`draft_tasks_missing_assignee` 及 `viewer_permission_codes`；前端依 `primary_step` 選主要動作，專案識別欄位不需另呼叫需 `inspection_plan.read` 的專案詳情端點 | 依 IP-R11；非成員或無專案讀取權限 403；Admin 全部可讀 |
| `POST /api/v1/projects/{project_id}/members:batch-roles` | 本體 `{items:[{user_id,role_ids:[uuid]}]}`，在同一專案批次替換各成員角色集合；成功回 `{items:[既有 ProjectMember 欄位]}`；全批原子提交 | Admin；401／403；未知使用者／角色、重複使用者或跨專案角色回 422；不得更改公司角色 |
| `POST /api/v1/company-roles/impact-preview` | 本體指定 `{operation: "update"|"delete"|"assign"|"revoke",role_id,user_id?,permission_codes?}`；回 `{affected_user_count,affected_users:[{user_id,username,name,permissions_before,permissions_after,permissions_added,permissions_removed}]}`；update/delete 涵蓋該角色全體持有人，assign/revoke 涵蓋指定使用者 | Admin；401／403；未知 ID 404；非法權限代碼／本體 422；角色與權限 schema 依 #387／#390 前置規格 |
| `GET /api/v1/company-roles?cursor=&limit=`、`GET /api/v1/company-roles/{role_id}`、`GET /api/v1/company-roles/permission-codes` | 角色清單使用 `{items,next_cursor}`、依 `(created_at,id)` 升冪；單筆及權限代碼清單沿用更新後 `domain-model` 回應 schema | Admin；401／403；未知角色 404；錯誤 envelope 依 API-R05 |
| `POST /api/v1/company-roles`、`PATCH /api/v1/company-roles/{role_id}`、`DELETE /api/v1/company-roles/{role_id}` | 建立本體 `{name,permission_codes}`；PATCH 至少一欄、`permission_codes` 為完整替換集合；刪除成功 204。建立／修改／刪除前 UI 必須呈現 impact-preview 結果並取得明確確認 | Admin；401／403；不存在 404；重複名稱 409；未登記／錯誤權限代碼或空更新 422；依 #390 更新後 schema |
| `PUT /api/v1/users/{user_id}/company-roles/{role_id}`、`DELETE /api/v1/users/{user_id}/company-roles/{role_id}` | 指派／撤銷既有公司角色；成功分別回 204；呼叫前 UI 顯示該使用者權限變化並確認 | Admin；401／403；未知 user／role 404；不允許範圍或重複狀態依更新後角色契約回 422／409 |

所有新管理 API 的具體角色 schema 與權限代碼依 #390 更新後的前置規格；本節只凍結本規格所需的使用流程、HTTP 操作與錯誤邊界。稽核查詢 API 實作需先將 ALG-Q2 的方案裁定同步到 `audit-log`，該同步是獨立前置任務。

## 驗收條件

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| ADM-AC01 | 有 `DRAFT`、`PENDING`、`IN_PROGRESS`、`COMPLETED`、`CANCELLED` Task，另有封存 Plan 下的未完成 Task，日期各異 | 查詢今日工作量 | 只計非封存 Plan 的 `PENDING`／`IN_PROGRESS`；草稿、取消、完成及封存 Plan Task 均排除，日期不影響結果 | ADM-R02 |
| ADM-AC02 | 專案含各狀態 Task，包括封存 Plan 下完成 Task | 查詢完成數與完成率 | 完成數僅為 `COMPLETED`；分母為所有非取消已派出狀態；封存 Plan 的完成項仍列入歷史完成數與分母；分母 0 時率為 0 | ADM-R03、ADM-R04 |
| ADM-AC03 | `PENDING`／`IN_PROGRESS` Task 有建議指派人；`IN_PROGRESS` 有開始者；`COMPLETED` 有實際完成者，且至少一筆由非指派人完成 | 查詢工程師彙總 | 三類數字各自歸屬 `assignee_id`、`started_by`、`completed_by`；不得互相替代；Field 尚無完成資料時完成數可為 0 | ADM-R05、ADM-R14 |
| ADM-AC04 | 使用者只有部分專案權限 | 呼叫總覽並指定有權及無權 project_id | 可查有權專案；無權／不存在 project_id 都回 403，且不洩漏專案是否存在 | ADM-R06 |
| ADM-AC05 | 使用者具「看全部專案進度」全公司權限 | 省略 project_id 查總覽，之後撤銷權限再查 | 有權時可讀全公司範圍；撤權後回 403；單一專案權限不能取代全公司權限 | ADM-R06 |
| ADM-AC06 | 非 Admin 或未登入者 | 開啟稽核頁並呼叫查詢 API | 未登入回 401、非 Admin 回 403，均不回稽核內容 | ADM-R07 |
| ADM-AC07 | 多專案、操作者、時間及事件類型的稽核資料；資料時間可能相同 | 組合篩選並跨 cursor 翻頁，另以不存在的合法 UUID 作 `project_id` 篩選 | 結果符合 AND 篩選、`(created_at,id)` 穩定排序且無重複遺漏；不存在 project_id 時仍回 200、`items: []`、`next_cursor: null`；GET 不改資料 | ADM-R07、ADM-R08 |
| ADM-AC08 | Admin 嘗試建立／修改／刪除公司角色或指派／撤銷角色 | UI 先載入 impact-preview，查看受影響人員及前後權限，確認後提交 | 未確認不得送出；確認後才變更；impact-preview 不包含專案角色權限；角色 schema 依 #390 | ADM-R09、ADM-R10、ADM-R11 |
| ADM-AC09 | 專案列表有不同成員數，含零成員專案 | 開啟專案清單 | API 與 UI 顯示符合 #286 凍結契約的計數；契約未合併前不得假造數值 | ADM-R12 |
| ADM-AC10 | 0.2.x 現有使用者、公司與專案資料 | 以搜尋、cursor 翻頁及批次操作管理 | 搜尋大小寫不敏感；跨頁無重複遺漏；任一批次項目失敗時整批資料不變；基本 CRUD 沿用已交付能力 | ADM-R13 |
| ADM-AC11 | 有既有使用者及符合 AUT-R36 的密碼服務 | Admin 重設其臨時密碼，再嘗試取得第二次 | 僅成功回應顯示一次；標記臨時、舊 session 失效、登入失敗鎖定計數清除並寫既定稽核；不可再次取得密碼 | ADM-R13、AUT-R36、AUT-R37 |
| ADM-AC12 | 驗收資料由 API／seed 建立已完成 Task；0.5.x Field 使用者只能開始而不能完成 Task | 開啟後台試用流程 | 示範完成數、完成率及「誰查的」可由 seed 顯示；無完成紀錄時三者為 0；現場主要流程可從派出、查看／開始至後台監看 | ADM-R14 |
| ADM-AC13 | 各管理端點收到未登入、無權限、跨專案、無效 cursor／limit、未知 ID 請求 | 逐一呼叫 API | 一般專案受限端點依契約回 401／403／422／404 且不洩漏；Admin 稽核端點以不存在 project_id 篩選必須回 200 空頁；所有錯誤符合 API-R05 envelope | ADM-R06～ADM-R13 |
| ADM-AC14 | 專案摘要 `next_steps` 各代碼分別為主要待辦，另有 `primary_step=null` 的全完成摘要 | 開啟專案首頁 | 首頁以 API 的 `primary_step` 顯示正確白話文案與對應區段連結；全完成時顯示「追蹤進度」；不自行從單一計數推導主要步驟 | ADM-R15 |
| ADM-AC15 | 專案摘要包含各項非零數字；另一摘要為 `task_counts_visible=false` 且固定 Task 計數為 0 | 開啟專案首頁 | 首頁顯示成員、查核項目、草稿、已派出未完成、待重查數；無任務讀取權限時顯示「無權查看任務」，不顯示任務的零值卡片 | ADM-R15 |
| ADM-AC16 | 使用者位於專案首頁或任一專案區段 | 以桌面滑鼠、360px 觸控及鍵盤開啟與切換區段 | 桌面顯示側欄；手機以區段選單抽屜顯示；連結皆可用鍵盤操作、觸控目標至少 44px，當前區段帶 `aria-current="page"` | ADM-R16 |
| ADM-AC17 | workflow summary 回傳只有 `inspection_task.inspect`／`inspection_task.read` 的有效專案權限；另有含 `project_member.manage` 或其他內業專案權限的摘要 | 現場專屬使用者與內業使用者開啟專案路由 | 現場專屬使用者導向 `/field` 且不載入內業專案資料；內業使用者留在專案介面並可使用其可見區段；不得以 `task_counts_visible` 代替權限判斷 | ADM-R17 |
| ADM-AC18 | 專案列表有既有專案；Admin 建立新專案成功 | 開啟專案清單或送出新增專案表單 | 每列「開啟專案」導向對應首頁；建立後直接導向新專案首頁，編輯既有專案仍留在清單 | ADM-R18 |

## 待釐清

- 全公司角色的欄位、權限代碼、角色指派及 migration 依 [OQ-08](../../intents/05-open-questions.md#oq-08)／[KD-60](../../intents/03-decisions-and-stack.md#kd-60) 與 #390 更新後的 `authentication`／`domain-model` 前置規格；若其契約和本規格的 endpoint/schema 衝突，先以新權威更新本規格及 plan，再開實作 task。
- #286 的 `member_count` 已列本規格範圍，但欄位與停用成員計數口徑仍須由 `domain-model` 規格變更凍結後才能實作。
- ALG-Q2 已由負責人裁定選 C（[#107 留言](https://github.com/speko-tw/inspect-flow/issues/107#issuecomment-5977843511)）。T5a 將此裁定獨立同步至 `audit-log` spec／plan；T5b 依賴 T5a 合併後即可實作稽核查詢 API／頁面。
- 完成數與完成率依 Task 狀態計算；0.7.x 完成驗證上線後，同一指標改採伺服器驗證完成（依 [KD-66](../../intents/03-decisions-and-stack.md#kd-66)），不另增新完成率。

## 變更紀錄

- 範圍變更（負責人指示，#447）：新增專案首頁、下一步與關鍵數字、區段導覽、現場專屬使用者路由及專案建立導向（ADM-R15～ADM-R18、ADM-AC14～ADM-AC18）— [#445 負責人指示](https://github.com/speko-tw/inspect-flow/issues/445#issuecomment-5988461779)。介面細節為規格設計（非負責人裁定）。
- 初稿：依 #107、#375、#387、#388、#390 及 #286 整理 0.5.x 範圍；權限與前置規格仍待各自變更完成。
