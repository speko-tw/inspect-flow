# 管理後台（admin-dashboard）

**代碼**：`ADM`　**Phase**：P5　**狀態**：草稿
**前置規格**：`inspection-planning`、`authentication`、`audit-log`、`domain-model`；模組權限、委派與權限組合依 [KD-69](../../intents/03-decisions-and-stack.md#kd-69) 與 `domain-model`（DOM-R59～DOM-R67）、`authentication`（AUT-R48～AUT-R50）
**引用意圖**：[PR-03](../../intents/02-principles.md#pr-03)、[PR-08](../../intents/02-principles.md#pr-08)、[KD-13](../../intents/03-decisions-and-stack.md#kd-13)、[KD-24](../../intents/03-decisions-and-stack.md#kd-24)、[KD-49](../../intents/03-decisions-and-stack.md#kd-49)、[KD-66](../../intents/03-decisions-and-stack.md#kd-66)、[KD-69](../../intents/03-decisions-and-stack.md#kd-69)、[04-glossary](../../intents/04-glossary.md)
**被擋議題**：無 OQ／G；模組權限畫面的需求及範圍依已裁定的 [KD-69](../../intents/03-decisions-and-stack.md#kd-69)；實作依賴 `domain-model` 後續任務 L（模組權限資料與 Service 介面）與 `authentication` 任務 P

## 目的

讓內勤人員監看已派出的查核工作與工程師工作量，讓 Admin 管理人員的模組權限、委派與權限組合，並查詢唯讀稽核紀錄。Dashboard 是管理工具，不是正式交付物；正式報告仍由 `report-delivery` 負責（依據：[01-overview.md](../../intents/01-overview.md#查核生命週期)，架構基準 §20.1、§20.22）。

## 範圍

**包含**：

- 管理後台唯讀總覽及 Dashboard 查詢 API：今日工作量、完成數、完成率、專案進度、工程師工作量。
- 依存取權限呈現單一專案或全部專案；全部專案總覽只供具專案模組「看全部專案進度」模組權限者。
- 工程師工作量並列「派給誰」的待辦數與「誰查的」實際完成數。
- Admin 專用、唯讀的稽核紀錄查詢頁與 API，依專案、操作者、時間、動作類型篩選並分頁。
- 人員的模組權限勾選、權限組合（一鍵勾選與維護）、模組委派（指派與收回委派者）、建立者角色設定等管理畫面；Admin 擁有全部權限，被委派者在自己被委派的模組內可授予與收回權限。
- 專案列表顯示成員數（#286）；若 API 契約尚未落地，先完成所需規格變更再實作。
- 已有簡便版管理功能維持由 0.2.x 規格負責；本規格承接進階管理畫面及搜尋、分頁、批次能力（依 #259 裁定與既有規格）。

**不包含**（注明移到哪份規格，或屬於哪一條非目標）：

- 建立、派出、取消、恢復或封存 Plan／Task 的操作，屬 `inspection-planning` 與現場工作流程；本規格只讀取並呈現其資料（#363）。
- 完成查核所需的證據或影像編修，屬 `field-evidence`；完成數與完成率在 0.5.x 依 Task 狀態計算，0.7.x 完成驗證上線後改採伺服器驗證完成，維持相同指標（依 [KD-66](../../intents/03-decisions-and-stack.md#kd-66)）。
- 定義角色、權限資料模型或重新制定存取控制規則；模型由 `authentication`、`domain-model` 與 intents 負責，本規格只使用（#538）。
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
| 角色變更前影響範圍（PR-18） | 專案角色介面已有 `user_count`、`project_count`；模組權限、委派與權限組合由 `domain-model` DOM-R59～DOM-R63 定義，現有介面尚未提供 | 本規格要求收回模組權限、收回委派與刪除權限組合前顯示對象與後果並確認（ADM-R10）；專案角色沿用 DOM-AC47 |
| #286 專案成員數 | `backend/app/api/v1/projects.py` 的專案列表回應尚無 `member_count`；#286 要求 API 與列表提供此數值 | 納入本規格；先依規格變更流程更新 `domain-model` API 契約，再實作 |

## 使用情境

- 內勤人員開啟後台，依自己的專案權限查看工作量、完成情況及專案進度。
- 具專案模組「看全部專案進度」權限者查看跨專案總覽與任務明細，並比較各專案及工程師的進度與工作量。
- 內勤人員比較任務建議指派給誰與實際由誰完成查核，辨識代查情形。
- Admin 在人員頁勾選人員的模組權限、套用權限組合、指派委派者；被委派者在自己被委派的模組內替別人開通權限；有「開設專案」權限的人開專案並自動成為成員。
- Admin 依專案、操作者、時間及動作類型查詢稽核紀錄；頁面不提供修改或刪除操作。

## 需求

除明確標為負責人裁定的項目外，本規格所選的呈現方式、批次操作與 API 路徑屬**規格設計（非負責人裁定）**；不得據此新增或改寫 intents、角色資料模型或權限代碼。模組權限與專案角色的權限表依 [OQ-08](../../intents/05-open-questions.md#oq-08)／[KD-69](../../intents/03-decisions-and-stack.md#kd-69)；schema 依 `domain-model`（DOM-R59～DOM-R67），存取檢查依 `authentication`（AUT-R48～AUT-R50）。

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| ADM-R01 | 後台**必須**提供唯讀總覽及查詢 API；Dashboard 不得包裝成正式報告或正式交付物 | 必須 | 0.5.x 雛形流程依負責人補充（[#107 留言](https://github.com/speko-tw/inspect-flow/issues/107#issuecomment-5977852498)）；Dashboard 不作正式交付物依 #375 與 [01-overview.md](../../intents/01-overview.md#查核生命週期)，屬範圍依據 |
| ADM-R02 | 今日工作量與「派給誰」**必須**只計非封存 Plan 下狀態為 `PENDING` 或 `IN_PROGRESS` 的 Task；不依日期篩選，排除 `DRAFT`、`CANCELLED` 及封存 Plan 下的 Task | 必須 | 負責人裁定（[#104 留言](https://github.com/speko-tw/inspect-flow/issues/104#issuecomment-5977711401)）；`inspection-planning`、`state-machines` |
| ADM-R03 | 完成數**必須**只計 `COMPLETED` Task；完成率**必須**為 `COMPLETED` 數 ÷ 同一查詢範圍內所有非取消且已派出的 Task 數（含 `PENDING`、`IN_PROGRESS`、`COMPLETED`）。分母為 0 時回傳 `0` | 必須 | 完成數與完成率 0.5.x 依 Task 狀態計算（依 [KD-66](../../intents/03-decisions-and-stack.md#kd-66) 與 #388）；公式為規格設計（非負責人裁定） |
| ADM-R04 | 專案進度**必須**按專案呈現已派出 Task 總數、完成數與完成率，使用 ADM-R03 口徑；封存 Plan 不排除在歷史完成數與分母之外 | 必須 | 功能範圍依 #375、#388；封存 Plan 的計算口徑為規格設計（非負責人裁定） |
| ADM-R05 | 工程師工作量**必須**分開呈現「派給誰」的 `PENDING`／`IN_PROGRESS` 數與「誰查的」依 `completed_by` 歸屬的 `COMPLETED` 數；不得混為單一數字。另應呈現由 `started_by` 歸屬的 `IN_PROGRESS` 開始者數 | 必須／應 | 負責人裁定（[#107 留言](https://github.com/speko-tw/inspect-flow/issues/107#issuecomment-5977779246)）；額外開始者數為規格設計（非負責人裁定） |
| ADM-R06 | 專案範圍總覽**必須**只回傳目前使用者具「看專案進度與工作量」專案權限（且具查核模組「可使用」，AUT-R19）可存取的專案；全部專案總覽**必須**要求專案模組「看全部專案進度」模組權限（`all_project_progress.read`），專案權限不得擴大成全部專案範圍。「看全部專案進度」是唯讀：可看各專案的進度與任務明細（任務清單、狀態、地點、建議指派，任務明細另需查核模組「可使用」），**不得**回傳照片或查核結果；要看照片與結果，須加入該專案並取得唯讀的專案角色（例如「檢視者」）；此權限**不得**用來修改任何專案（DOM-R66） | 必須 | 負責人裁定（[#538](https://github.com/speko-tw/inspect-flow/issues/538)，2026-10-09）（問題 4、補充裁定第 9 項：跨專案只給唯讀的「看全部專案進度」，到任務明細、不含照片與查核結果）；權限名稱與分組依 [OQ-08](../../intents/05-open-questions.md#oq-08) 及 [KD-69](../../intents/03-decisions-and-stack.md#kd-69) |
| ADM-R07 | 只有 Admin **得**進入稽核查詢頁及呼叫查詢 API；介面唯讀，不新增、修改或刪除紀錄 | 必須 | 負責人裁定（[#107 留言](https://github.com/speko-tw/inspect-flow/issues/107#issuecomment-5977843511)）；[KD-24](../../intents/03-decisions-and-stack.md#kd-24)、ALG-R04 |
| ADM-R08 | 稽核查詢**必須**支援專案、操作者、時間範圍、事件類型篩選與穩定 cursor 分頁；沿用 `audit-log` 定義的事件及欄位 | 必須 | 負責人裁定選 C（[#107 留言](https://github.com/speko-tw/inspect-flow/issues/107#issuecomment-5977843511)）；欄位及 cursor 契約沿用 [audit-log](../audit-log/spec.md) 與 [KD-13](../../intents/03-decisions-and-stack.md#kd-13) |
| ADM-R09 | Admin 與被委派者**必須**能在人員頁勾選人員的模組權限（授予與收回，DOM-R62）：Admin 可管理所有模組的權限，被委派者只看到並只能授予、收回自己被委派模組內的權限，不能指派委派者、不能轉委派（DOM-R61）；選項從 `domain-model` 權限登記表取得（DOM-R60），不得為單一模組另寫勾選畫面。模組權限畫面不得混入專案角色／專案動作權限；Admin 的有效權限維持全部權限 | 必須 | 負責人裁定（[#538](https://github.com/speko-tw/inspect-flow/issues/538)，2026-10-09）（兩層模型、委派以模組為單位、被委派者只能授予自己被委派模組內的權限、不能轉委派）；新模組接入規則見 [KD-69](../../intents/03-decisions-and-stack.md#kd-69)；畫面形式為規格設計（非負責人裁定） |
| ADM-R10 | 收回模組權限、收回委派者，以及刪除權限組合前，**必須**顯示對象與後果（該人收回後失去哪些權限；刪除組合不影響已套用的人）並要求明確確認後才送出，取消不得送出請求；授予成功後顯示該人目前的模組權限。專案角色沿用 0.2.x DOM-AC47 已有的 `user_count`／`project_count` 影響資訊 | 必須 | 修改前顯示影響範圍並確認依 PR-18；確認內容與時機為規格設計（非負責人裁定）；專案角色依 [角色管理 API](../domain-model/spec.md#角色管理-api)（DOM-R55、DOM-AC47） |
| ADM-R11 | 範本管理（`template.manage`）與其他模組權限一樣是人員頁可勾選的模組權限，**不得**寫死成不可修改的角色；人員頁可看到每個人被委派的模組。既有 `template_admin` 的遷移依 `domain-model` 後續任務 M 與 `template-system` TPL-R09（逐人轉換、不得失去權限） | 必須 | 負責人裁定（[#538](https://github.com/speko-tw/inspect-flow/issues/538)，2026-10-09）（範本管理改為範本模組的模組權限）；遷移方式見 [KD-69](../../intents/03-decisions-and-stack.md#kd-69) 與 `domain-model` plan |
| ADM-R12 | 專案列表**必須**顯示後端契約提供的成員數；若契約未定，先依流程完成 `domain-model` 規格變更，不得以 UI 假值通過驗收 | 必須 | [#286](https://github.com/speko-tw/inspect-flow/issues/286)、[變更規則](../README.md#change) |
| ADM-R13 | 已交付的 0.2.x 基本管理不得重做；本規格**必須**補使用者／公司搜尋、cursor 分頁、批次啟用狀態、專案搜尋／分頁、成員批次指派／撤銷及 Admin 為既有使用者設定臨時密碼 | 必須 | 基本功能與進階功能分工依 #259、[authentication](../authentication/spec.md#範圍)、[domain-model](../domain-model/spec.md#範圍)；批次操作與既有使用者臨時密碼端點屬規格設計（非負責人裁定） |
| ADM-R14 | 0.5.x 主要流程**應**涵蓋派出 Task、現場查看／開始 Task、後台查看進度與工作量；0.5.x 不提供現場完成 Task，因此完成數、完成率及「誰查的」得為 0；示範資料建議含 `COMPLETED` Task | 應 | 主要流程依負責人補充（[#107 留言](https://github.com/speko-tw/inspect-flow/issues/107#issuecomment-5977852498)），Field 尚不能完成依負責人裁定（[#104 留言](https://github.com/speko-tw/inspect-flow/issues/104#issuecomment-5977711401)）；seed 建議依 #381，非負責人裁定 |
| ADM-R15 | 使用者建立成功後，前端**必須**在獨立結果畫面顯示帳號與只存在記憶體的臨時密碼，提供複製操作，說明離開後無法再次查看且首次登入必須變更密碼；只有使用者按「已抄下，回到使用者列表」才離開結果畫面。指派／收回管理者與停用使用者前，**必須**在該使用者列顯示說明對象及後果的頁內確認，取消不得送出請求。專案新增／編輯表單有未儲存內容時，切換新增與編輯或前往其他專案前**必須**詢問「保留編輯／捨棄」 | 必須 | 負責人直接指示（[#430](https://github.com/speko-tw/inspect-flow/issues/430)，2026-10-04 核可範圍）；結果畫面、訊息與轉場細節屬規格設計（非負責人裁定） |
| ADM-R16 | 專案管理介面**必須**提供專案首頁，以專案代號及名稱識別專案；首頁依 workflow summary 的 `primary_step` 顯示唯一主要下一步及前往連結，沒有待處理步驟時顯示「追蹤進度」；關鍵數字呈現成員、查核項目、草稿任務、已派出未完成及待重查，`task_counts_visible=false` 時不得以 0 代替隱藏數字，並顯示「無權查看任務」 | 必須 | 範圍變更（負責人指示，#447）；欄位與顯示細節為規格設計（非負責人裁定） |
| ADM-R17 | 專案首頁**必須**提供「專案首頁、成員、查核項目、分區、計畫與任務、進度」區段導覽；各項只在 `viewer_permission_codes` 含該區段讀取權限時顯示，其中成員區段要求 `project_member.manage`；手機版以「區段選單」抽屜呈現，觸控目標至少 44px、可用鍵盤操作，當前區段使用 `aria-current`；專案各區段共用一個頁面 `<h1>` 和一個「返回專案清單」連結，區段標題使用 `<h2>` | 必須 | 範圍變更（負責人指示，#447）；權限對應及介面細節為規格設計（非負責人裁定）；[PR-19](../../intents/02-principles.md#pr-19) |
| ADM-R18 | 只有 `inspection_task.inspect`／`inspection_task.read` 現場執行權限，且沒有任何內業專案權限者，**必須**隱藏專案內業區段並導向 Field；前端依 workflow summary 的 `viewer_permission_codes` 有效專案權限判斷，不得用任務數字或 DRAFT 可見性推測；有效權限含任何內業權限時可進入專案區段 | 必須 | 範圍變更（負責人指示，#447）；現場／內業權限判斷與 UI 路由細節為規格設計（非負責人裁定）；PR-10、AUT-R19 |
| ADM-R19 | 專案列表**必須**提供「開啟專案」連結；建立專案成功後**必須**導向該專案首頁；若 API 回傳專案代號重複警告，首頁**必須**顯示仍已儲存的可關閉警告 | 必須 | 範圍變更（負責人指示，#447）；導向與警告呈現方式為規格設計（非負責人裁定）；警告語意依 DOM-R42 |
| ADM-R20 | 專案成員 API 的「加入成員」與「以完整集合取代角色」**必須**至少帶一個角色；`role_ids` 為空陣列（或加入時省略）回 HTTP 422 與專用錯誤碼（見 `domain-model` 的管理介面錯誤清單），成員資料不變。資料庫與 service 層仍允許沒有角色的成員（DOM-R36，例如更早加入的舊資料），API 不自動補角色；移出專案不受此限 | 必須 | 範圍變更（負責人核可 #445 原型，#449）；錯誤碼與驗證順序（權限與資源不存在先於角色檢查）為規格設計（非負責人裁定）；`domain-model` 專案管理 API 介面表同步 |
| ADM-R21 | 成員區段「加入成員」**必須**同時選人與至少一個專案角色才能送出；未選人或未選角色時，錯誤顯示在該欄位下方並把焦點移到第一個有錯的欄位，已選的人與角色保留；伺服器回上述專用錯誤碼時同樣對應到角色欄，不只顯示通用錯誤。每個角色名稱旁**必須**附一行白話說明（依該角色實際持有的權限碼組成，例如「可建立計畫、派出任務」「可到現場查核」），**不得**顯示權限碼；每個權限碼各自對照、措辭不得超出後端該權限實際保護的操作；權限碼沒有對照時只顯示「可使用部分功能」 | 必須 | 範圍變更（負責人核可 #445 原型，#449）；說明文字的措辭與對照為規格設計（非負責人裁定），對照表維護在 `frontend/src/admin/projects/roleDescriptions.ts`；[PR-19](../../intents/02-principles.md#pr-19) |
| ADM-R22 | 成員清單**必須**以卡片列出成員與角色摘要（手機與桌面同一種卡片，不用靠橫向捲動的表格）；沒有角色的舊成員顯示「尚未指派角色，請修改角色」。「修改角色」**必須**進入獨立畫面（與加入表單分開），同樣至少一個角色，有未儲存變更時取消會先確認；「移出專案」**必須**先在該成員卡片內確認。操作結果與錯誤顯示在操作附近，下一次操作前清除；360px 觸控目標至少 44px、可用鍵盤操作（Esc 取消確認） | 必須 | 範圍變更（負責人核可 #445 原型，#449）；畫面細節為規格設計（非負責人裁定）；[PR-19](../../intents/02-principles.md#pr-19) |
| ADM-R23 | 登入、變更密碼與開啟 `/` 的預設落點**必須**只依後端 `/auth/me` 的存取摘要（AUT-R08）決定：系統管理者進 `/admin`；有內業權限（含內業與現場兩者皆有）進 `/admin/projects`；只有現場權限（含現場加範本）進 `/field`；只有範本管理權限（`has_template_access`，沒有內業也沒有現場）進 `/admin/templates`；都沒有進 `/field` 並顯示沒有權限的說明。`/field` 顯示「沒有現場權限」時，帳號有內業權限**必須**提供至少 44px 高的「前往我的專案」按鈕連到 `/admin/projects`，有範本管理權限**必須**提供「前往範本管理」按鈕連到 `/admin/templates`，兩者都有就都顯示；頂端列同樣依權限顯示「我的專案」「範本管理」入口（有權限的任一入口都要能從 `/field` 點到）。登入後去哪一頁（#489）：剛主動登出時，不論誰登入一律去新帳號的落點，登出後按上一頁再登入也一樣；沒有上一位使用者記錄時（直接開深層連結、重新整理頁面後），依 AUT-R29 回到原頁面，只要新帳號看得到；有記錄時，同一位使用者重新登入（例如登入逾時）且原頁面新帳號看得到才回原頁面，換人一律去落點。前端依 AUT-R30 不得把登入資訊寫進 `localStorage`、`sessionStorage`，上一位使用者只存在記憶體，所以重新整理頁面後無法辨識上一位，此時只擋新帳號看不到的原頁面 | 必須 | 範圍變更（負責人指示，[#480](https://github.com/speko-tw/inspect-flow/issues/480#issuecomment-6013263124)）；落點與按鈕細節為規格設計（非負責人裁定），內業專案清單一律先進清單、不因只有一個專案就直接進專案首頁，理由是落點不必多一次請求且畫面一致；[PR-10](../../intents/02-principles.md#pr-10)、AUT-R08 |
| ADM-R24 | 有內業權限的非系統管理者進入 `/admin/projects` **必須**看到「我的專案」：只列自己有內業權限的專案（`GET /me/projects` 的 `has_office_access` 為 `true`），版面沿用專案卡片，不顯示編輯、搜尋或其他系統管理功能（具專案模組「開設專案」權限者另顯示「新增專案」，見 ADM-R32），點專案進專案首頁；沒有專案時顯示下一步說明。沒有內業權限的非管理者直接開 `/admin/projects` 時，導回自己的落點（ADM-R23），不顯示空清單。管理頁頂部導覽對非管理者**必須**只列有權限的項目：「我的專案」（只有內業權限；管理者的同一入口維持「專案」）、「範本管理」（`has_template_access`，即具範本模組管理權限或被委派範本模組者；只有專案 `project_inspection_item.edit` 的人不列，直接開 `/admin/templates` 也顯示無權限頁，不顯示寫入按鈕）、「今日任務」（`has_field_access`）與「變更密碼」；使用者、公司、角色管理不得出現，也不得有點了才 403 的入口 | 必須 | 範圍變更（負責人指示，[#480](https://github.com/speko-tw/inspect-flow/issues/480#issuecomment-6013263124)）；[#489 負責人指示](https://github.com/speko-tw/inspect-flow/issues/489#issuecomment-6051721016)：「我的專案」入口只給有內業權限的人，沒有權限者導回落點；清單與導覽細節為規格設計（非負責人裁定）；沿用既有 `GET /me/projects`（DOM-AC50）而不新增端點；[PR-10](../../intents/02-principles.md#pr-10)、AUT-R08 |
| ADM-R25 | 任何「無權限」畫面（非管理者的無權限頁、專案無權限頁、`/admin/templates` 無權限頁）**必須**有出路：依權限落點的「返回管理頁／我的專案／今日任務」連結，頂端列保留登出；專案頁底部的返回與「專案不屬內業」的導向一律走落點，不得固定回 `/field` 形成迴圈。非管理者的專案頁**必須**有頂端列（帳號名稱、我的專案、變更密碼、登出）。變更密碼頁（非強制變更時）**必須**有依落點的「返回」連結；兩種權限都有的帳號，現場頁頂端列**必須**有「我的專案」連結回 `/admin/projects`（管理頁已有「今日任務」連結）；「我的專案」入口只對系統管理者或有內業權限的人顯示，沒有內業權限的人直接開 `/admin/projects` 時導回自己的落點（ADM-R24）。專案區段導覽目前**必須**隱藏只有佔位內容的「分區」與「進度」（管理者與非管理者皆然；正式內容見 [#451](https://github.com/speko-tw/inspect-flow/issues/451)、[#452](https://github.com/speko-tw/inspect-flow/issues/452)；分區管理實際在「計畫與任務」頁），專案首頁的下一步與「追蹤任務進度」改指向「計畫與任務」。不存在的網址**必須**顯示 404 頁並附「回首頁」連結。找不到與無權限的分界如下：<br>1. 帶 id 的頁面（專案、查核項目、現場任務），id 格式不對（HTTP 422）或不存在（404），**必須**顯示找不到並附「回首頁」。<br>2. 專案底下與 `/admin`、`/field` 底下各層不存在的子路徑，同樣顯示找不到。<br>3. 無權限頁只用在確實存在、但使用者沒有權限的頁面：後端回 403 的頁面；非管理者開使用者、公司、角色這些管理者專用頁；沒有範本管理權限的人開範本管理。<br>4. 例外一：非管理者查格式正確但不存在的專案，後端回 403（避免洩漏專案是否存在），顯示無權限頁。<br>5. 例外二：非管理者開管理者專用頁底下的任何路徑（例如 `/admin/users/abc`），沒有範本管理權限的人開 `/admin/templates` 底下的任何路徑（例如 `/admin/templates/abc`），都沿用無權限頁 | 必須 | 範圍變更（負責人指示，[#480](https://github.com/speko-tw/inspect-flow/issues/480#issuecomment-6013263124)）；細節為規格設計（非負責人裁定）；[PR-10](../../intents/02-principles.md#pr-10)、ADM-R23、ADM-R24 |
| ADM-R26 | 非系統管理者只要持有該專案的 `project_member.manage`，成員區段**必須**能完整使用（查看、加入、修改角色、移出），不得依賴只開放給 Admin 的 `GET /users`、`GET /roles`。後端**必須**提供專案範圍的候選端點：可加入的使用者（啟用、非系統帳號、尚未加入此專案；非 Admin 呼叫者只看到與自己同公司的人，沒有公司的呼叫者看不到任何人，Admin 看全部公司）與可指派的角色（全部角色，只回傳 `id`、`name`、`permission_codes`，供白話說明使用）；`POST /projects/{id}/members` 由非 Admin 呼叫時，伺服器**必須**以同一套規則檢查：被加入者須與呼叫者同公司，呼叫者沒有公司則一律拒絕，回 HTTP 422 與專用錯誤碼（見 `domain-model` 的管理介面錯誤清單）（資源是否存在先於此檢查，此檢查先於零角色檢查），Admin 不受此限；前端把該錯誤對應到使用者欄，不只顯示通用錯誤；兩支端點的權限同 `project_member.manage`，**不得**放寬全域 `/users`、`/roles` 的讀取權限，也**不得**回傳 email、公司或其他顯示不需要的欄位。前端成員區段的成員列表、候選使用者、角色（與 Admin 的專案基本資料）各自呼叫、各自處理錯誤：任何一支失敗只在該區塊顯示原因與「重新載入」，其餘區塊與成員操作照常；專案不存在（404 或 422）才整頁顯示找不到 | 必須 | 範圍變更（負責人指示，#481）：[負責人指示](https://github.com/speko-tw/inspect-flow/issues/481#issuecomment-6013263458)；候選條件、同公司的判讀、伺服器端同公司檢查、`/projects/{id}/member-candidates` 與 `/assignable-roles` 的路徑與分頁欄位為規格設計（非負責人裁定）；不新增 migration；#449 的必選角色、白話說明、新增與修改分開、移出確認、360px 與 44px 規則全部保留 |
| ADM-R27 | 沒有 `project_member.manage` 的專案成員**不顯示**成員區段（ADM-R17 導覽隱藏）；直接輸入網址進入時，成員 API 回 403，頁面只顯示「你沒有權限管理這個專案的成員」，不顯示成員列表，也不顯示加入、修改、移出任何操作。**不提供**唯讀成員列表：`GET /projects/{id}/members` 的權限維持 `project_member.manage`（`domain-model` API 表），放寬讀取需另走範圍變更 | 必須 | 規格設計（非負責人裁定，#481 在「唯讀列表」與「不顯示」之間擇一）；理由：成員列表含 email 與公司，放寬讀取是權限範圍變更，且導覽（#447）本來就不對這類成員顯示成員區段 |
| ADM-R28 | 管理頁與現場頁的入口名稱**必須**統一：非管理者的專案入口叫「我的專案」，管理者維持「專案」（管理者專案清單頁的標題同樣叫「專案」）；現場入口一律叫「今日任務」，不得再用「現場任務」「專案管理」等不同名稱指同一個入口；現場頁頂端列給內業用的入口叫「我的專案」，範本入口叫「範本管理」。畫面文案**必須**是白話中文，不得出現 Snapshot、Task 等英文術語。操作成功後**必須**在該操作所屬的區塊旁顯示簡短提示（`role="status"`，沿用既有提示樣式，下一次操作就清掉舊提示）：非管理者套用範本後導回專案首頁要顯示提示；計畫與任務頁的新增與改名分區、刪除分區、建立與改名計畫、封存與取消封存、建立任務、修改地點與建議指派、派出、刪除草稿、取消、恢復都要有提示。修改專案查核項目的儲存確認依受影響任務狀態分兩種說法：只有草稿任務受影響時，說明草稿會直接更新為新內容，只有一個「確認儲存」，不問是否重新查核（前端仍送出 `reinspect: false`，後端只要有任務使用此項目就要求帶這個欄位）；有已派出任務受影響時，才讓使用者選「要重新查核」或「不要，只更正文字」，每個選項旁用一句白話說明後果。建立任務時的查核項目清單**不得**顯示各範本自己的項次編號（跨範本會重複或跳號）。專案成員頁沒有任何可加入的人時，**必須**隱藏角色勾選與加入按鈕，只顯示說明。存為範本成功後，範本樹中目標系統的項目數**必須**重新載入。變更密碼頁**必須**事先顯示密碼規則（8～128 個字元，依 AUT-R04） | 必須 | 範圍變更（負責人指示，#487）：[負責人指示](https://github.com/speko-tw/inspect-flow/issues/480#issuecomment-6013263124)；細節為規格設計（非負責人裁定）：v0.3.0 角色走查發現的不順之處；名稱統一的理由是同一個入口在不同畫面叫不同名字，試用時會以為是不同功能；不含專案項目修改頁的數值標準編輯，屬 #450 |
| ADM-R29 | 新增使用者的畫面**必須**提供權限組合（例如「內業常用」）一鍵勾選多個模組權限；也得逐項勾選。系統管理者**必須**能新增、修改、刪除權限組合（DOM-R63），修改或刪除組合時畫面**必須**說明不會追改已套用過的人。新增使用者後再套用組合，兩個呼叫非同一交易：使用者建立成功但套用失敗時，畫面**必須**保留已建立的結果並顯示「權限尚未套用，請到人員頁重試」，不得假裝整體成功 | 必須 | 負責人裁定（[#538](https://github.com/speko-tw/inspect-flow/issues/538)，2026-10-09）（問題 7：新增使用者畫面提供常用組合一鍵勾選；權限組合修改不追改已套用的人）；兩步呼叫與失敗處理為規格設計（非負責人裁定），也得改為在建立使用者 API 增加選填欄位，屬 `authentication` 規格變更 |
| ADM-R30 | 系統管理者**必須**能在人員頁指派與收回模組委派者（DOM-R61）；被委派者的人員頁**只**顯示自己被委派模組的授予選項，**不**顯示指派委派者、權限組合維護與建立者角色設定的操作。畫面**必須**說明被委派者可以授予該模組權限並做該模組的編輯動作，但不能再轉委派 | 必須 | 負責人裁定（[#538](https://github.com/speko-tw/inspect-flow/issues/538)，2026-10-09）（補充裁定第 8 點與 [#538 內文](https://github.com/speko-tw/inspect-flow/issues/538) 確認的三條委派規則）；畫面文字為規格設計（非負責人裁定） |
| ADM-R31 | 專案成員區段「加入成員」時，若被加入者尚未開通該專案需要的模組「可使用」（專案模組 `project.use`、查核模組 `inspection.use`），畫面**必須**在該人旁提示「尚未開通 X 模組，請系統管理者或被委派者開通」，不阻擋加入；成員清單同樣標示已加入但未開通模組者。提示資料由專案成員候選與成員列表端點回傳（只含是否具備各模組「可使用」，不得回傳其他權限） | 必須 | 負責人裁定（[#538](https://github.com/speko-tw/inspect-flow/issues/538)，2026-10-09）（問題 2：加入成員時若此人未開通模組，畫面要提示，由系統管理者開通）；提示放置位置、端點欄位為規格設計（非負責人裁定） |
| ADM-R32 | 具專案模組「開設專案」權限者（含 Admin）的專案清單**必須**顯示「新增專案」；新增成功後**必須**導向該專案首頁（沿用 ADM-R19），建立者已是成員並持有建立者角色（DOM-R65）。系統管理者**必須**能在設定畫面查看與修改建立者角色（DOM-R64）；建立者角色未設定時，「新增專案」的錯誤（`project.creator_role_unset`）對 Admin 顯示「請先設定建立者角色」並連到設定畫面，對非 Admin 顯示「請洽系統管理者」。沒有「開設專案」權限者看不到入口，API 回 403 | 必須 | 負責人裁定（[#538](https://github.com/speko-tw/inspect-flow/issues/538)，2026-10-09）（問題 3、問題 4：開設專案是逐人給予的權限、建立者自動成為成員並取得建立者角色，預設內業、系統管理者可改）；設定畫面與錯誤文字為規格設計（非負責人裁定） |
| ADM-R33 | 專案成員清單**必須**標示已停用的成員（「已停用」），停用成員保留原角色與模組權限（DOM-R67）；停用使用者前的確認（ADM-R15）**必須**說明「保留模組權限與專案成員關係，未完成任務請由內業改派」，並提供前往「計畫與任務」改派的連結；重新啟用後原權限原樣恢復 | 必須 | 負責人裁定（[#538](https://github.com/speko-tw/inspect-flow/issues/538)，2026-10-09）（問題 5：離職先停用、保留模組權限與成員關係、成員清單標已停用、未完成任務由內業改派）；連結與文案為規格設計（非負責人裁定） |

## 資料

本規格不新增領域實體。Task 狀態、`assignee_id`、`started_by`、`completed_by` 與 Plan 狀態沿用 [domain-model](../domain-model/spec.md)、[inspection-planning](../inspection-planning/spec.md) 與 [state-machines](../state-machines/spec.md)；稽核資料沿用 [audit-log](../audit-log/spec.md)。模組權限、委派、權限組合與建立者角色設定的資料由 `domain-model`（DOM-R59～DOM-R64）定義，權限名稱依 [OQ-08](../../intents/05-open-questions.md#oq-08) 與 [KD-69](../../intents/03-decisions-and-stack.md#kd-69)；schema、權限代碼、seed 與 migration 依 `domain-model` 與 `authentication` 前置規格，不在此預設。

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
| `GET /api/v1/admin/dashboard/summary?project_id=<uuid>` | 單一物件：`pending_count`、`in_progress_count`、`completed_count`、`completion_rate`；不分頁。省略 `project_id` 查全公司；提供時限單一專案 | 「看專案進度與工作量」專案權限（另需查核模組「可使用」）或專案模組「看全部專案進度」模組權限；未登入 401，無權限 403；越權或不存在的專案均 403，遵守現有專案端點避免洩漏資源存在性 |
| `GET /api/v1/admin/dashboard/projects?cursor=&limit=&q=` | `{items:[{project_id,name,pending_count,in_progress_count,completed_count,completion_denominator_count,completion_rate,member_count}],next_cursor}`；依 `(project.name, project.id)` 升冪；`q` 為專案名稱／代碼不分大小寫子字串；`member_count` 僅在 #286 契約先合併後提供 | 各專案只套用呼叫者持有「看專案進度與工作量」權限的範圍；全部專案查詢需專案模組「看全部專案進度」模組權限。錯誤同 summary；cursor／limit／q 無效 422 |
| `GET /api/v1/admin/dashboard/engineers?project_id=<uuid>&cursor=&limit=&q=` | `{items:[{user_id,username,name_zh,assigned_pending_count,assigned_in_progress_count,completed_by_count,started_in_progress_count}],next_cursor}`；依 `(username,user_id)` 升冪；`q` 搜尋 username、中英文姓名、email、employee number | 「看專案進度與工作量」專案權限（另需查核模組「可使用」）或專案模組「看全部專案進度」模組權限；project scope 必須提供 `project_id`；不得藉參數擴權；錯誤同 summary |
| `GET /api/v1/audit-logs?project_id=&actor_id=&from=&to=&event_type=&cursor=&limit=` | `{items:[既有 AuditLog 欄位],next_cursor}`；依 `(created_at,id)` 降冪；`from`／`to` 為 UTC ISO-8601，含起不含迄；多條件 AND 篩選；指定格式正確但不存在的 `project_id` 回 200 空頁 `{items:[],next_cursor:null}` | Admin；401 未登入、403 非 Admin；不存在專案為空結果而非權限錯誤；格式錯誤 422；只讀 |
| `GET /api/v1/users?q=&cursor=&limit=` | 將目前全量列表改為 cursor page `{items:[既有 User 欄位],next_cursor}`；依 `(username,id)` 升冪；`q` 不分大小寫搜尋 username、姓名、email、employee number | Admin（沿用 AUT-R20）；401／403／422 如上；保留現有單筆及寫入端點 |
| `POST /api/v1/users:batch-active-status` | 本體 `{user_ids:[uuid],is_active:boolean}`；成功回 `{items:[User]}`；整批原子提交；重複或空 ID、未知 ID、停用最後一位 Admin 等驗證失敗時不改任何列 | Admin；401／403；輸入或管理規則違反 422，衝突依既有管理錯誤映射 409 |
| `POST /api/v1/users/{user_id}/temporary-password` | 空本體；經 AUT-R36 設定系統產生的臨時密碼並標 `must_change_password=true`；回 `{user_id,username,temporary_password,must_change_password:true}` 一次，回應設 `Cache-Control: no-store`；呼叫 AUT-R36 的工作階段撤銷、失敗計數重設與稽核行為 | Admin；401／403；未知使用者 404；不得重設內建 `admin` 或外部身分帳號，回 422；成功後舊 session 失效 |
| `GET /api/v1/companies?q=&cursor=&limit=` | `{items:[既有 Company 欄位],next_cursor}`；依 `(name,id)` 升冪；`q` 不分大小寫搜尋名稱 | Admin；401／403／422 如上；保留既有單筆及寫入端點 |
| `POST /api/v1/companies:batch-status` | 本體 `{items:[{company_id,is_active,disable_user_ids:[uuid]}]}`；逐公司套用既有停用語意，成功回 `{items:[Company]}`；整批原子提交，避免部分公司更新 | Admin；401／403；未知 ID、重複項目或不屬於該公司的 `disable_user_ids` 回 422 且整批不變 |
| `GET /api/v1/projects?q=&cursor=&limit=` | 將既有列表回應改為 `{items:[既有 Project 欄位],next_cursor}`；依 `(name,id)` 升冪；`q` 搜尋專案名稱／代碼；`member_count` 仍待 #286 `domain-model` 契約完成後另行加入 | 過渡期沿用既有 Admin／SystemRole 檢查，正式行為見 `domain-model` 專案管理 API（Admin、`all_project_progress.read` 或 `template.manage` 可列全部專案）；401／403／422 |
| `GET /api/v1/projects/{project_id}/workflow-summary` | 依 `inspection-planning` IP-R11 回傳 `project: {id, project_code, name}`、專案摘要、`next_steps`、`primary_step`、`task_counts_visible`、`draft_tasks_missing_assignee` 及 `viewer_permission_codes`；前端依 `primary_step` 選主要動作，專案識別欄位不需另呼叫需 `inspection_plan.read` 的專案詳情端點 | 依 IP-R11；非成員或無專案讀取權限 403；Admin 全部可讀 |
| `GET /api/v1/projects/{project_id}/member-candidates?cursor=&limit=` | `{items:[{id,username,name_zh}],next_cursor}`；可加入此專案的使用者：啟用、非系統帳號、尚未是此專案成員；非 Admin 呼叫者只含同公司的人（呼叫者沒有公司時回空清單），Admin 含全部公司；依 `(username,id)` 升冪，`limit` 預設 50、範圍 1–100 | 需專案權限 `project_member.manage`（Admin 依 AUT-R19 放行）；401／403／專案不存在 404；無效 cursor 或 `limit` 422 |
| `GET /api/v1/projects/{project_id}/assignable-roles?cursor=&limit=` | `{items:[{id,name,permission_codes}],next_cursor}`；角色是全系統共用（DOM-R19），全部都可指派，`permission_codes` 依字母排序，供前端產生白話說明；依 `(created_at,id)` 升冪，分頁同上 | 同上 |
| `POST /api/v1/projects/{project_id}/members:batch-roles` | 本體 `{items:[{user_id,role_ids:[uuid]}]}`，在同一專案批次替換各成員角色集合；成功回 `{items:[既有 ProjectMember 欄位]}`；全批原子提交 | Admin；401／403；未知使用者／角色、重複使用者或跨專案角色回 422；不得更改模組權限 |
| `GET /api/v1/admin/dashboard/projects/{project_id}/tasks?cursor=&limit=` | `{items:[{task_id,status,location,suggested_assignee:{user_id,name_zh}|null}],next_cursor}`；依 `(created_at,task_id)` 升冪；唯讀，**不含**照片與查核結果；供「看全部專案進度」看任務明細 | 專案模組「看全部專案進度」且具查核模組「可使用」，或專案角色含「看專案進度與工作量」（另需查核模組「可使用」）；Admin 放行；401／403；不存在專案 403 |
| `GET /api/v1/module-permissions` | `{items:[{code,module,description}]}`；`domain-model` 登記表的模組範圍權限，依 `(module,code)` 排序 | Admin 或被委派任一模組者（被委派者只回自己被委派模組的項目，AUT-R49）；401／403 |
| `GET /api/v1/users/{user_id}/module-permissions` | `{permission_codes:[...],delegated_modules:[...]}`，依字母排序 | Admin 或被委派者（被委派者只看到自己被委派模組內的項目）；401／403；未知使用者 404 |
| `PUT /api/v1/users/{user_id}/module-permissions/{code}`、`DELETE /api/v1/users/{user_id}/module-permissions/{code}` | 授予／收回一項模組權限；成功 204，重複授予與收回沒有的權限同樣 204 且不寫稽核（DOM-R62）；UI 在收回前依 ADM-R10 確認 | AUT-R48（Admin 或被委派該代碼所屬模組者）；401／403；未知使用者 404；未登記或非模組範圍代碼 422 |
| `PUT /api/v1/users/{user_id}/module-delegations/{module}`、`DELETE /api/v1/users/{user_id}/module-delegations/{module}` | 指派／收回模組委派者；成功 204，重複狀態同樣 204 且不寫稽核（DOM-R61） | 需 Admin（AUT-R49）；401／403；未知使用者 404；未知模組 422 |
| `GET /api/v1/permission-bundles`、`POST /api/v1/permission-bundles`、`PATCH /api/v1/permission-bundles/{bundle_id}`、`DELETE /api/v1/permission-bundles/{bundle_id}` | 權限組合清單（`{items,next_cursor}`，依 `(created_at,id)` 升冪）與維護；建立本體 `{name,permission_codes}`，PATCH 至少一欄且 `permission_codes` 為完整替換集合；刪除成功 204；修改與刪除不追改已套用的人（DOM-R63） | 清單：Admin 或被委派者（供套用）；維護：需 Admin（AUT-R49）；重複名稱 409；未登記或非模組範圍代碼、空更新 422；不存在 404 |
| `POST /api/v1/users/{user_id}/permission-bundles/{bundle_id}:apply` | 把組合當下內容套用到使用者；回 `{user_id,granted_codes:[...]}`（實際新增的代碼）；含呼叫者無權授予的代碼時整筆 403、資料不變（DOM-R63） | AUT-R49；401／403；未知使用者或組合 404 |
| `GET /api/v1/settings/creator-role`、`PUT /api/v1/settings/creator-role` | 讀取與修改建立者角色：`{creator_role_id: uuid|null}`；PUT 本體相同，角色必須存在；修改寫稽核（DOM-R64） | 需 Admin（AUT-R49）；401／403；角色不存在 422 |

所有新管理 API 的模組權限 schema 與代碼依 `domain-model` DOM-R59～DOM-R64；路徑與回應形狀為規格設計（非負責人裁定）；本節只凍結本規格所需的使用流程、HTTP 操作與錯誤邊界。程式改造完成前，過渡期端點（`system-role-assignments`）維持不變。稽核查詢 API 實作需先將 ALG-Q2 的方案裁定同步到 `audit-log`，該同步是獨立前置任務。

## 驗收條件

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| ADM-AC01 | 有 `DRAFT`、`PENDING`、`IN_PROGRESS`、`COMPLETED`、`CANCELLED` Task，另有封存 Plan 下的未完成 Task，日期各異 | 查詢今日工作量 | 只計非封存 Plan 的 `PENDING`／`IN_PROGRESS`；草稿、取消、完成及封存 Plan Task 均排除，日期不影響結果 | ADM-R02 |
| ADM-AC02 | 專案含各狀態 Task，包括封存 Plan 下完成 Task | 查詢完成數與完成率 | 完成數僅為 `COMPLETED`；分母為所有非取消已派出狀態；封存 Plan 的完成項仍列入歷史完成數與分母；分母 0 時率為 0 | ADM-R03、ADM-R04 |
| ADM-AC03 | `PENDING`／`IN_PROGRESS` Task 有建議指派人；`IN_PROGRESS` 有開始者；`COMPLETED` 有實際完成者，且至少一筆由非指派人完成 | 查詢工程師彙總 | 三類數字各自歸屬 `assignee_id`、`started_by`、`completed_by`；不得互相替代；Field 尚無完成資料時完成數可為 0 | ADM-R05、ADM-R14 |
| ADM-AC04 | 使用者只有部分專案權限 | 呼叫總覽並指定有權及無權 project_id | 可查有權專案；無權／不存在 project_id 都回 403，且不洩漏專案是否存在 | ADM-R06 |
| ADM-AC05 | 使用者具專案模組「看全部專案進度」模組權限（`all_project_progress.read`），不具查核模組「可使用」；另有使用者只具單一專案的「看專案進度與工作量」 | 省略 project_id 查總覽，查任務明細，再嘗試讀照片與查核結果與修改專案；之後撤銷權限再查 | 有權時可讀全部專案的進度；任務明細需另具查核模組「可使用」，缺少時回 403；任何情況都看不到照片與查核結果，也不能修改專案；撤權後回 403；單一專案權限不能取代全部專案權限 | ADM-R06 |
| ADM-AC06 | 非 Admin 或未登入者 | 開啟稽核頁並呼叫查詢 API | 未登入回 401、非 Admin 回 403，均不回稽核內容 | ADM-R07 |
| ADM-AC07 | 多專案、操作者、時間及事件類型的稽核資料；資料時間可能相同 | 組合篩選並跨 cursor 翻頁，另以不存在的合法 UUID 作 `project_id` 篩選 | 結果符合 AND 篩選、`(created_at,id)` 穩定排序且無重複遺漏；不存在 project_id 時仍回 200、`items: []`、`next_cursor: null`；GET 不改資料 | ADM-R07、ADM-R08 |
| ADM-AC08 | Admin A、被委派範本模組的 D、一般使用者 V；人員 W 具若干模組權限 | A 在人員頁授予、收回 W 的模組權限並指派、收回委派者；D 開人員頁授予範本模組權限、嘗試授予其他模組權限；V 開人員頁；收回權限與委派、刪除組合時分別按取消與確認 | A 可管理所有模組；D 只看到並只能授予範本模組的選項，看不到指派委派者、組合維護與建立者角色設定；V 看不到入口，API 回 403；收回與刪除前顯示對象與後果，取消不送出、確認才變更；選項來自登記表（新增測試模組即出現） | ADM-R09、ADM-R10、ADM-R11、ADM-R30 |
| ADM-AC09 | 專案列表有不同成員數，含零成員專案 | 開啟專案清單 | API 與 UI 顯示符合 #286 凍結契約的計數；契約未合併前不得假造數值 | ADM-R12 |
| ADM-AC10 | 0.2.x 現有使用者、公司與專案資料 | 以搜尋、cursor 翻頁及批次操作管理 | 搜尋大小寫不敏感；跨頁無重複遺漏；任一批次項目失敗時整批資料不變；基本 CRUD 沿用已交付能力 | ADM-R13 |
| ADM-AC11 | 有既有使用者及符合 AUT-R36 的密碼服務 | Admin 重設其臨時密碼，再嘗試取得第二次 | 僅成功回應顯示一次；標記臨時、舊 session 失效、登入失敗鎖定計數清除並寫既定稽核；不可再次取得密碼 | ADM-R13、AUT-R36、AUT-R37 |
| ADM-AC12 | 驗收資料由 API／seed 建立已完成 Task；0.5.x Field 使用者只能開始而不能完成 Task | 開啟後台試用流程 | 示範完成數、完成率及「誰查的」可由 seed 顯示；無完成紀錄時三者為 0；現場主要流程可從派出、查看／開始至後台監看 | ADM-R14 |
| ADM-AC13 | 各管理端點收到未登入、無權限、跨專案、無效 cursor／limit、未知 ID 請求 | 逐一呼叫 API | 一般專案受限端點依契約回 401／403／422／404 且不洩漏；Admin 稽核端點以不存在 project_id 篩選必須回 200 空頁；所有錯誤符合 API-R05 envelope | ADM-R06～ADM-R13 |
| ADM-AC14 | Admin 新增使用者；使用者含管理者與啟用狀態；專案表單有未儲存變更 | 建立使用者、離開結果畫面；取消及確認管理者指派／收回與停用；在新增／編輯模式間及不同專案間切換 | 建立後獨立顯示帳號與臨時密碼，複製可用，離頁後密碼清除；未確認／取消時沒有寫入請求，確認後才送出且提示對象與後果；未儲存時可保留原表單，捨棄後才切換模式或專案 | ADM-R15、AUT-R46 |
| ADM-AC15 | 專案摘要 `next_steps` 各代碼分別為主要待辦，另有 `primary_step=null` 的全完成摘要 | 開啟專案首頁 | 首頁以 API 的 `primary_step` 顯示正確白話文案與對應區段連結；全完成時顯示「追蹤進度」；不自行從單一計數推導主要步驟 | ADM-R16 |
| ADM-AC16 | 專案摘要包含各項非零數字；另一摘要為 `task_counts_visible=false` 且固定 Task 計數為 0 | 開啟專案首頁 | 首頁顯示成員、查核項目、草稿、已派出未完成、待重查數；無任務讀取權限時顯示「無權查看任務」，不顯示任務的零值卡片 | ADM-R16 |
| ADM-AC17 | 使用者位於專案首頁或任一專案區段；另有缺少 `project_member.manage` 的使用者 | 以桌面滑鼠、360px 觸控及鍵盤開啟與切換區段 | 桌面顯示側欄；手機以區段選單抽屜顯示；只顯示具讀取權限的區段，缺少成員管理權限時不顯示「成員」；連結皆可用鍵盤操作、觸控目標至少 44px，每個區段恰一個目前頁連結帶 `aria-current="page"`；頁面恰有一個 `<h1>` 與一個「返回專案清單」連結 | ADM-R17 |
| ADM-AC18 | workflow summary 回傳只有 `inspection_task.inspect`／`inspection_task.read` 的有效專案權限；另有含 `project_member.manage` 或其他內業專案權限的摘要 | 現場專屬使用者與內業使用者開啟專案路由 | 現場專屬使用者導向 `/field` 且不載入內業專案資料；內業使用者留在專案介面並可使用其可見區段；不得以 `task_counts_visible` 代替權限判斷 | ADM-R18 |
| ADM-AC19 | 專案列表有既有專案；Admin 建立新專案成功，包含 API 回傳重複代號警告 | 開啟專案清單或送出新增專案表單 | 每列「開啟專案」導向對應首頁；建立後直接導向新專案首頁，編輯既有專案仍留在清單；重複代號情況在首頁明示「仍已儲存」且警告可關閉 | ADM-R19、DOM-R42 |
| ADM-AC20 | 專案 P 有一位具 `project_member.manage` 的成員，另有一位尚未加入的使用者 U 與角色 R | 以 API 對 P：加入 U 但 `role_ids` 為空或省略；加入 U 並帶 R；再以空集合取代 U 的角色；以含 R 的集合取代；無權限者送零角色 | 前兩種零角色與取代為空集合都回 422 與專用錯誤碼，U 不被加入、角色不變；帶 R 的加入回 201、取代回 200；無權限者回 403，不因角色檢查而洩漏 422 | ADM-R20、DOM-R36 |
| ADM-AC21 | 加入成員表單已選人但沒勾角色；另有後端回上述零角色專用錯誤碼的情況；各角色持有不同權限碼 | 按「加入成員」；勾選角色後再送出；讓伺服器回 422 | 沒勾角色時不送出、錯誤顯示在角色欄下方、焦點移到第一個角色、已選的人保留；勾選後錯誤消失並成功加入；伺服器 422 同樣顯示在角色欄並聚焦；每個角色旁有依權限碼產生的白話說明，頁面不出現權限碼 | ADM-R21 |
| ADM-AC22 | 專案有多位成員（含一位沒有角色的舊成員）；360px 與 1280px 視窗 | 開啟成員區段；修改角色（含取消全部角色、有未儲存變更時取消）；移出成員（取消、Esc、確認） | 成員以卡片呈現且無橫向捲動、觸控目標至少 44px；修改角色在獨立畫面，零角色擋下並在欄旁顯示錯誤；未儲存取消先確認；移出需確認，成功後顯示結果訊息且不殘留舊訊息；舊成員顯示「尚未指派角色」 | ADM-R22 |
| ADM-AC23 | 六種帳號：系統管理者、純內業、純現場、兩者皆有、兩者皆無、只有範本管理權限者（另有範本管理權限兼現場）（存取摘要依 AUT-AC70）；另有一個只有內業權限的帳號參與專案 A、B，以及一個只有現場權限的專案 C | 各自登入、變更密碼成功、直接開 `/`；兩者皆無的帳號開 `/field`；內業帳號進入 `/admin/projects` | 落點依序為 `/admin`、`/admin/projects`、`/field`、`/admin/projects`、`/field`、`/admin/templates`（範本管理權限兼現場為 `/field`，且現場頁有「範本管理」入口）；兩者皆無的 `/field` 顯示「目前無法查看現場任務」且沒有前往我的專案，有內業權限者才有 44px 以上的「前往我的專案」，有範本管理權限者有「前往範本管理」；內業帳號看到專案 A、B（不含 C）、沒有新增專案，點專案進專案首頁 | ADM-R23、ADM-R24 |
| ADM-AC24 | 非系統管理者四種：只有內業、內業加現場、只有現場、有範本權限；直接輸入 `/admin/users`、`/admin/templates`（無範本權限者）、`/admin/projects`（無內業權限者） | 檢視頂部導覽與直接輸入網址 | 導覽依 ADM-R24 只列有權限的項目，不含使用者、公司、角色，「我的專案」只有內業權限者看得到；無權限的網址顯示「無權限」，有內業權限者導覽仍可回到專案，其他人有返回自己落點的連結；沒有內業權限者開 `/admin/projects` 導回自己的落點 | ADM-R24 |
| ADM-AC25 | 內業、現場、混合與系統管理者帳號各一；專案頁、變更密碼頁、不存在的網址、無權限畫面 | 各角色從登入開始只靠點擊（不改網址）走：登入 → 專案清單 → 專案 → 頂端列各項 → 變更密碼 → 返回；開專案無權限畫面；開不存在的網址；開格式不對或不存在的專案、任務 id | 每一步都有可點的出路，沒有迴圈或死路；專案導覽不含分區與進度，專案首頁下一步不指向它們；404 頁的「回首頁」回到該角色的落點；格式不對（422）的 id，所有帳號都顯示找不到而非「資料格式不正確」的空頁框；格式正確但不存在的專案，系統管理者顯示找不到（404），非管理者顯示無權限頁（後端回 403，不洩漏專案是否存在）；沒有範本管理權限者直接開 `/admin/templates` 看到無權限頁而非寫入按鈕 | ADM-R25 |
| ADM-AC26 | 專案 P；呼叫者 M 是非 Admin，只在 P 持有 `project_member.manage`，屬於公司 A；P 外有同公司 A 的使用者（含已加入 P、已停用者）、另一公司 B 的使用者、沒有公司的呼叫者；全域 `GET /users`、`GET /roles` 對 M 回 403 | 對 P 呼叫候選使用者與可指派角色端點；M 在成員區段用點擊加入成員（必選角色）、修改角色、移出；任一候選或角色 API 失敗；缺少 `project_member.manage` 者直接開成員網址 | 非 Admin 只得到同公司、啟用、未加入的使用者且欄位僅 `id`、`username`、`name_zh`；沒有公司的呼叫者得到空清單；Admin 得到各公司的候選；角色只有 `id`、`name`、`permission_codes`；非 Admin 對 P 加入他公司或沒有公司的使用者、或呼叫者沒有公司，回 422 與專用錯誤碼 且不加入，Admin 不受限，候選清單列出的人都能被加入；無權限者 403、401 未登入、他專案 403、專案不存在 404；全域 `/users`、`/roles` 仍只給 Admin；成員頁完全不呼叫全域 `/users`、`/roles`，加入／修改／移出都成功；候選或角色失敗時成員列表仍顯示、失敗區塊有重新載入；無權限者看不到任何成員操作 | ADM-R26、ADM-R27 |
| ADM-AC27 | 內業、現場與混合帳號各一；專案 P 有草稿任務、已派出任務；P 的成員候選已全部加入；範本庫有可存入的系統 | 各角色從登入開始只靠點擊：看頂端列名稱；內業套用範本、建分區與計畫、建立並派出任務、刪除草稿、取消、恢復；修改專案查核項目（只有草稿任務受影響、有已派出任務受影響各一次）；成員頁加完最後一人；存為範本；開變更密碼頁 | 非管理者入口叫「我的專案」、現場入口叫「今日任務」、現場頁頂端列有「我的專案」「範本管理」；上述每個操作成功後在該區塊旁看到 `role="status"` 提示，下一次操作舊提示消失；只有草稿受影響時沒有重新查核選項、只有「確認儲存」，有已派出任務時兩個選項各附一句說明；畫面沒有 Snapshot、Task 等英文術語；建立任務的項目清單沒有項次編號；沒有候選人時成員頁只有說明，沒有角色勾選與加入按鈕；存為範本後範本樹項目數增加；變更密碼頁顯示 8～128 個字元的規則 | ADM-R28 |
| ADM-AC28 | 權限組合「內業常用」；Admin 與被委派者 D；新增使用者畫面 | Admin 新增使用者並勾選組合；套用失敗（測試以故障注入）；修改組合後讀取先前套用者的權限 | 新增後該人持有組合當下的模組權限；套用失敗時使用者已建立、畫面顯示「權限尚未套用」且可重試；修改組合不改變先前套用者；刪除組合前顯示不影響已套用的人 | ADM-R29 |
| ADM-AC29 | 被委派專案模組的 D；人員 W；D 的人員頁 | D 開人員頁、授予 W 專案模組權限、嘗試指派委派者與維護組合 | D 的畫面只有專案模組選項，沒有指派委派者、組合維護與建立者角色設定；授予成功；直接呼叫被禁止的 API 回 403；畫面說明可授予與編輯但不能轉委派 | ADM-R30 |
| ADM-AC30 | 專案 P；使用者 U1 具 `project.use` 與 `inspection.use`、U2 缺 `inspection.use`、U3 兩者皆缺 | 在 P 的成員區段加入 U1、U2、U3；開成員清單 | 三人都能加入（不阻擋）；U2、U3 旁顯示尚未開通的模組名稱；成員清單同樣標示；端點只回傳各模組是否可使用，不含其他權限 | ADM-R31 |
| ADM-AC31 | 建立者角色已設定；使用者 U 具 `project.create`、V 不具；Admin A；建立者角色為空的情境 | U、A 各新增專案；V 開專案清單與直接呼叫 API；清空建立者角色後 U、A 再新增 | U、A 成功並導向專案首頁，成為成員且持有建立者角色；V 看不到「新增專案」，API 回 403；建立者角色為空時 A 看到「請先設定建立者角色」並可連到設定畫面，U 看到「請洽系統管理者」，專案未建立 | ADM-R32 |
| ADM-AC32 | 專案成員 M 已被停用，原有角色與模組權限 | 開成員清單；Admin 在停用前看確認；重新啟用 M | 清單標「已停用」並保留原角色；確認說明保留權限與成員關係並連到「計畫與任務」；啟用後原權限原樣恢復 | ADM-R33 |

## 待釐清

- 模組權限的欄位、權限代碼、委派及 migration 依 [OQ-08](../../intents/05-open-questions.md#oq-08)／[KD-69](../../intents/03-decisions-and-stack.md#kd-69) 與 `authentication`／`domain-model` 前置規格（DOM-R59～DOM-R67、AUT-R48～AUT-R50）；若其契約和本規格的 endpoint/schema 衝突，先以前置規格為準更新本規格及 plan，再開實作 task。
- #286 的 `member_count` 已列本規格範圍，但欄位與停用成員計數口徑仍須由 `domain-model` 規格變更凍結後才能實作。
- ALG-Q2 已由負責人裁定選 C（[#107 留言](https://github.com/speko-tw/inspect-flow/issues/107#issuecomment-5977843511)）。T5a 將此裁定獨立同步至 `audit-log` spec／plan；T5b 依賴 T5a 合併後即可實作稽核查詢 API／頁面。
- 完成數與完成率依 Task 狀態計算；0.7.x 完成驗證上線後，同一指標改採伺服器驗證完成（依 [KD-66](../../intents/03-decisions-and-stack.md#kd-66)），不另增新完成率。

## 變更紀錄

- 規格澄清（#493）：ADM-R25 寫明帶 id 的頁面 id 格式不對（422）或不存在（404）、各層不存在的子路徑都顯示找不到，無權限頁只用在確實存在但沒有權限的頁面；ADM-R26 的 404 補 422；ADM-AC25 補開格式不對或不存在 id 的步驟。行為與範圍不變 — [#493](https://github.com/speko-tw/inspect-flow/issues/493)
- 範圍變更（負責人指示，#489）：換帳號登入一律去新帳號的落點，主動登出後不保留原頁面（ADM-R23）；「我的專案」入口只給系統管理者與有內業權限的人，沒有內業權限者直接開 `/admin/projects` 導回落點，取消原本「非管理者都看得到」與「沒有範本權限也列」的規則（ADM-R24、ADM-R25、ADM-AC24）；`authentication` AUT-R29 補一句指向。細節為規格設計（非負責人裁定）— [負責人指示紀錄](https://github.com/speko-tw/inspect-flow/issues/489#issuecomment-6051721016)、[#378](https://github.com/speko-tw/inspect-flow/issues/378)
- 範圍變更（負責人指示，#487）：統一入口名稱（非管理者「我的專案」、現場「今日任務」、現場頁頂端列「我的專案」「範本管理」；修改 ADM-R23～ADM-R25、ADM-AC23），新增 ADM-R28、ADM-AC27：操作成功提示、項目修改確認依任務狀態分兩種說法、白話文案、成員頁無候選時隱藏表單、存為範本後更新項目數、變更密碼頁顯示規則。細節為規格設計（非負責人裁定）；管理者專案清單頁標題改為「專案」— [負責人指示](https://github.com/speko-tw/inspect-flow/issues/480#issuecomment-6013263124)、[#487](https://github.com/speko-tw/inspect-flow/issues/487)
- 範圍變更（負責人指示，#480）：新增登入落點與 `/field` 前往專案管理按鈕、非管理者的我的專案清單與導覽、無權限畫面的出路、專案頁頂端列、變更密碼返回、隱藏分區與進度、404 頁（ADM-R23～ADM-R25、ADM-AC23～ADM-AC25）；後端存取摘要見 `authentication` AUT-R08 — [#480](https://github.com/speko-tw/inspect-flow/issues/480#issuecomment-6013263124)。細節為規格設計（非負責人裁定）
- 範圍變更（負責人指示，#481）：非 Admin 的內業只要有 `project_member.manage` 就能完整使用成員區段；新增專案範圍的候選使用者與可指派角色端點（ADM-R26、ADM-R27、ADM-AC26），非 Admin 加入成員時伺服器端同樣檢查同公司（`project.member_company_mismatch`）；成員頁各 API 各自處理錯誤，不再因全域 `/users`、`/roles` 403 整頁失敗；沒有管理權限者不顯示成員區段、不提供唯讀列表。端點細節、同公司判讀與伺服器端檢查為規格設計（非負責人裁定）；同步 `domain-model` 專案管理 API 介面表 — [負責人指示](https://github.com/speko-tw/inspect-flow/issues/481#issuecomment-6013263458)、[#481](https://github.com/speko-tw/inspect-flow/issues/481)
- 範圍變更（負責人核可 #445 原型，#449）：專案成員加入與取代角色至少一個，零角色回 422 `project.member_roles_required`；成員區段加入表單附角色白話說明與欄旁錯誤，成員清單改卡片、修改角色獨立畫面、移出確認（ADM-R20～ADM-R22、ADM-AC20～ADM-AC22）；同步 `domain-model` 專案管理 API 介面表。畫面與錯誤碼細節為規格設計（非負責人裁定）— [#445 負責人指示](https://github.com/speko-tw/inspect-flow/issues/445#issuecomment-5988461779)、[原型核可](https://github.com/speko-tw/inspect-flow/issues/445#issuecomment-5988590932)、[#449](https://github.com/speko-tw/inspect-flow/issues/449)
- 範圍變更（負責人指示，#447）：新增專案首頁、下一步與關鍵數字、區段導覽、現場專屬使用者路由及專案建立導向（ADM-R16～ADM-R19、ADM-AC15～ADM-AC19）— [#445 負責人指示](https://github.com/speko-tw/inspect-flow/issues/445#issuecomment-5988461779)。介面細節為規格設計（非負責人裁定）。
- 初稿：依 #107、#375、#387、#388、#390 及 #286 整理 0.5.x 範圍；權限與前置規格仍待各自變更完成。
- 使用者結果畫面、管理者／停用確認及專案未儲存提示 — 負責人直接指示（#430，2026-10-04 核可範圍）；細節屬規格設計（非負責人裁定）。
- 範圍變更（負責人指示，[#538](https://github.com/speko-tw/inspect-flow/issues/538)，意圖變更見 KD-69，裁定留言：[問題 1～5](https://github.com/speko-tw/inspect-flow/issues/538#issuecomment-6081228914)、[補充裁定 6～9](https://github.com/speko-tw/inspect-flow/issues/538#issuecomment-6081327833)）：「全公司角色」管理改為人員的模組權限、權限組合、委派與建立者角色設定（ADM-R09～ADM-R11，新增 ADM-R29～ADM-R33、ADM-AC28～ADM-AC32）；ADM-R06 改為專案模組「看全部專案進度」且到任務明細、不含照片與結果；介面表移除 `company-roles` 草稿 API，改列模組權限、委派、權限組合、建立者角色與任務明細端點；ADM-R23、ADM-R24 的「範本管理員」改為範本管理權限；ADM-AC05、ADM-AC08 改寫；路徑與回應形狀、畫面文案為規格設計（非負責人裁定） — [#538](https://github.com/speko-tw/inspect-flow/issues/538)
