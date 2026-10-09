# 管理後台（admin-dashboard）：實作計畫

**規格**：[spec.md](spec.md)

計畫記錄「為什麼這樣拆」。實作中發現更好的拆法就直接更新本檔（屬於「計畫調整」）；進度看 issue，不在這裡打勾。

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T0 | 修改既有 users、companies、projects 清單契約，加入 `q` 與 cursor paging，將陣列回應改為 `{items,next_cursor}`；更新後端、前端呼叫端、測試與受影響規格。`member_count` 依 T6a／#286 另行處理 | `docs/specs/authentication/spec.md`、`docs/specs/domain-model/spec.md`（介面表）、`docs/specs/admin-dashboard/spec.md`、`backend/app/api/pagination.py`、`backend/app/api/v1/users.py`、`companies.py`、`projects.py`、相關 API tests、`frontend/src/admin/api.ts`、`UsersPage.tsx`、`CompaniesPage.tsx`、`projects/api.ts`、`ProjectsPage.tsx`、`ProjectDetailPage.tsx` 與相關測試 | [#407 維護者留言](https://github.com/speko-tw/inspect-flow/issues/407#issuecomment-5979672050) 確認同 PR 同步規格與前後端；此變更不包含 #286 的 `member_count` | ADM-AC10、13 的前置 | #407 |
| T1 | Dashboard summary、projects、engineers API；落實狀態計數、權限範圍、游標分頁、錯誤及工程師三種歸屬數 | `backend/app/api/v1/`、`backend/app/services/`、`backend/tests/api/`、`backend/tests/services/` | #361（Plan／Task API）；`inspection-planning`、`state-machines` | ADM-AC01～05、13 | 待開 task |
| T2 | Dashboard 總覽 UI；依授權呈現單專案或全公司範圍，完成率與零資料狀態沿用 T1 契約 | `frontend/src/admin/dashboard/`（新增）、`frontend/src/admin/AdminPage.tsx`（僅新增入口）、`frontend/tests/` | T1；#361；與 #104 Field UI 分開路由及檔案；先以 mock 接版型，再替換為 API | ADM-AC01～05、12 | 待開 task |
| T3 | 工程師工作量視圖，分別顯示 assignee、started_by、completed_by 統計，不混用人員歸屬 | `backend/app/services/`、`backend/tests/services/`、`frontend/src/admin/dashboard/`、`frontend/tests/` | T1；`inspection-planning` 的指派及實際操作者欄位 | ADM-AC03、12 | 待開 task |
| T4 | 全公司角色管理與影響預覽：CRUD、權限選擇、指派／撤銷；所有變更前先顯示 affected users、權限差異並確認 | `frontend/src/admin/company-roles/`（新增）、`frontend/src/admin/AdminPage.tsx`（僅新增入口）、`backend/app/`、`backend/tests/`、`frontend/tests/` | #387 intents 已合併；#390 更新 `authentication`／`domain-model` 契約與計畫任務完成；Admin 權限依更新後規格 | ADM-AC08、13 | #390；實作 task 待開 |
| T5a | 將負責人已裁定的 ALG-Q2 選項 C 獨立同步到 `audit-log` 的需求、介面與驗收；只修改 audit-log 規格與其 plan，不與實作同 PR | `docs/specs/audit-log/spec.md`、`docs/specs/audit-log/plan.md` | 已裁定：[#107 負責人留言](https://github.com/speko-tw/inspect-flow/issues/107#issuecomment-5977843511)；先依規格變更流程開獨立 issue／PR，同步 `audit-log` 規格 | ADM-AC06、07 的前置 | 待開 task |
| T5b | Admin 唯讀稽核查詢 API 與頁面；按專案、操作者、時間、事件類型篩選並 cursor 分頁；不存在的合法 `project_id` 篩選回 200 空頁 | `backend/app/api/v1/`、`backend/app/services/`、`backend/tests/api/`、`backend/tests/services/`、`frontend/src/admin/audit-log/`（新增）、`frontend/tests/` | ALG-Q2 已裁定 C；T5a 合併同步 `audit-log` 契約後實作；`authentication` Admin 存取檢查 | ADM-AC06、07、13 | 待開 task |
| T6a | 依 #286 變更 `domain-model` 的專案列表契約，定義 `member_count` 欄位及停用成員口徑 | `docs/specs/domain-model/spec.md`、`docs/specs/domain-model/plan.md` | T0 已先更新專案列表 cursor 契約；#286；規格變更 issue／流程 | ADM-AC09 前置 | #286 後續規格變更 task |
| T6b | 專案列表 API cursor 分頁、搜尋與成員數欄位，更新專案列表 UI | `backend/app/api/v1/projects.py`、`backend/app/services/projects.py`、相關測試、`frontend/src/admin/projects/ProjectsPage.tsx` 及測試 | T0 既有列表契約變更與 T6a `member_count` 規格變更均合併；#275／#277 既有專案列表 | ADM-AC09、10、13 | 前置規格變更完成後開 task |
| T7 | 進階管理：既有 user/company list 增加搜尋及 cursor 分頁，加入全批原子狀態操作、專案成員批次角色操作、既有使用者臨時密碼重設；不重做 0.2.x 基本 CRUD | `backend/app/api/v1/users.py`、`companies.py`、必要 services／測試；`frontend/src/admin/UsersPage.tsx`、`CompaniesPage.tsx`、`frontend/src/admin/projects/ProjectDetailPage.tsx` 及測試 | T0 的 user/company/project 既有列表 cursor 契約變更合併；#263、#265、#274、#275、#277 已完成；AUT-R36／R37；T4 前置角色契約依賴 #390 | ADM-AC10、11、13 | 待開 task |
| T8 | 0.7.x 完成驗證上線後，將 Dashboard 的完成數與完成率這兩個既有指標改採伺服器驗證完成，維持欄位與指標名稱並補測試 | `backend/app/services/`、相關 API／service tests、Dashboard UI／tests | `completion-validation` 完成驗證契約與實作；依 [KD-66](../../intents/03-decisions-and-stack.md#kd-66)；0.5.x seed 的完成 Task 由 ADM-AC12 對應 task 準備 | ADM-AC02 | 0.7.x 前置規格完成後開 task |
| T9 | U1 使用者建立結果畫面、U2 管理者指派／收回與停用的列內確認，以及 P1 專案表單未儲存轉場提示 | `frontend/src/admin/AdminPage.tsx`、`UsersPage.tsx`、`projects/ProjectsPage.tsx`、`frontend/src/styles.css`、相關前端測試 | 負責人直接指示（#430，2026-10-04 核可範圍）；使用者建立沿用 AUT-R46，變更既有列表能力不得回退 | ADM-AC14 | #430 |
| T10 | 建立專案首頁、流程摘要顯示、依有效權限過濾區段及現場專屬路由；專案建立成功後導向新首頁並保留重複代號警告。`AdminPage` 移除專用 `MemberProjectItems` 元件，管理者與非管理者共用 `ProjectSectionPage` 區段殼；非管理者 planning 路由移入同一殼層，調整區段頁標題階層及唯一回清單連結；#470 讓首頁與第一個區段共用同一份短效摘要，離開專案／切換使用者時不沿用；補前端契約測試、瀏覽器走查及真後端驗證 | `docs/specs/admin-dashboard/spec.md`、`docs/specs/admin-dashboard/plan.md`、`frontend/src/admin/projectHome/`（新增與測試）、`frontend/src/admin/AdminPage.tsx`、`frontend/src/admin/AdminPage.test.tsx`、`frontend/src/admin/projectHome/ProjectHomePage.test.tsx`、`frontend/src/admin/projects/ProjectsPage.tsx`、`frontend/src/admin/projects/ProjectsAdmin.test.tsx`、`frontend/src/admin/projects/ProjectDetailPage.tsx`、`frontend/src/admin/projectItems/ProjectItemChangePage.tsx`、`frontend/src/admin/planning/PlanningPage.tsx`、`frontend/src/styles.css` | #454 workflow summary API；#470；原型由負責人操作核可；Field/內業分類及各區段可見性依摘要 `viewer_permission_codes` 與各區段讀取權限 | ADM-AC15～19 | #447、#470 |
| T11 | 專案成員區段：加入成員必選至少一個角色並附白話說明、成員卡片清單、修改角色獨立畫面、移出確認；後端專案成員 API 零角色回 422 專用錯誤碼；補 API 測試、前端 UI 測試與前後端契約 fixture、真後端瀏覽器走查 | `docs/specs/admin-dashboard/spec.md`、`docs/specs/admin-dashboard/plan.md`、`docs/specs/domain-model/spec.md`、`backend/app/api/errors.py`、`backend/app/api/v1/projects.py`、`backend/tests/api/test_projects.py`、`frontend/src/admin/projects/ProjectDetailPage.tsx`、`frontend/src/admin/projects/MemberRoleFields.tsx`、`frontend/src/admin/projects/roleDescriptions.ts`、`frontend/src/admin/projects/ProjectMembers.css`、`frontend/src/admin/projects/fixtures/`、`frontend/src/admin/projects/ProjectsAdmin.test.tsx` | T10（專案區段殼）；原型由負責人操作核可（#445） | ADM-AC20～22 | #449 |
| T12 | 非 Admin 內業的成員頁：後端新增專案範圍候選使用者與可指派角色端點（權限同 `project_member.manage`、同公司、不 N+1）；前端成員頁改用候選端點並讓各 API 各自處理錯誤；沒有管理權限者不顯示成員操作；補 API 測試、前端測試、契約 fixture 與真後端內業走查 | `docs/specs/admin-dashboard/spec.md`、`docs/specs/admin-dashboard/plan.md`、`docs/specs/domain-model/spec.md`、`backend/app/api/v1/projects.py`、`backend/tests/api/test_projects.py`、`backend/tests/contract/test_route_access.py`、`frontend/src/admin/projects/ProjectDetailPage.tsx`、`frontend/src/admin/projects/api.ts`、`frontend/src/admin/projects/ProjectMembers.css`、`frontend/src/admin/projects/fixtures/`、`frontend/src/admin/projects/ProjectsAdmin.test.tsx` | T11（成員區段）；不新增 migration | ADM-AC26 | #481 |
| T13 | v0.3.0 角色走查後的操作回饋與文案整理：統一入口名稱、非管理者外殼與計畫任務頁的成功提示、項目修改確認依任務狀態分兩種說法並拿掉英文術語、建立任務的項目清單不顯示項次、成員頁無候選時隱藏表單、存為範本後更新範本樹項目數、變更密碼頁顯示密碼規則；補前端測試與真後端無頭瀏覽器走查 | `docs/specs/admin-dashboard/spec.md`、`docs/specs/admin-dashboard/plan.md`、`frontend/src/admin/AdminPage.tsx`、`frontend/src/admin/planning/PlanningPage.tsx`、`frontend/src/admin/projectItems/ProjectItemChangePage.tsx`、`frontend/src/admin/projects/ProjectDetailPage.tsx`、`frontend/src/field/FieldPage.tsx`、`frontend/src/field/ProjectTemplatesPage.tsx`、`frontend/src/auth/ChangePasswordPage.tsx` 及各自的前端測試 | T10、T11、T12 已合併；專案項目修改頁不能改數值標準屬 #450，不在此 | ADM-AC27 | #487 |
| T14 | 角色摘要與完整權限清單：依 #496 顯示摘要、可展開清單、項目計數與未知碼回退；補混合已知／未知碼、雙未知碼及組件行為測試，並同步規格 | `docs/specs/admin-dashboard/spec.md`、`docs/specs/admin-dashboard/plan.md`、`frontend/src/admin/projects/roleDescriptions.ts`、`roleDescriptions.test.ts`、`RolePermissionSummary.tsx`、`RolePermissionSummary.css`、`RolePermissionSummary.test.tsx`、`RolesPage.tsx` | 負責人已同意 #496 提案；依權限 registry 次序產生摘要及清單 | ADM-AC21 | #496 |

- 每個 task 一個 PR 即可單獨驗收；每個 AC 至少由一個 task 涵蓋。
- T5a 是已裁定選項 C 的 audit-log 契約同步，T5b 是依同步契約進行實作；兩者不得合併成同一 PR。決議已完成，T5b 只等待 T5a 合併。
- T0 已同步 user/company/project 清單契約、後端與前端；T6a（#286）依賴 T0，T6b 依賴 T0 與 T6a，T7 依賴 T0。T0 不包含 #286 的 `member_count`。
- T6a 先完成規格變更，再開 T6b；不得直接在本規格或實作 PR 修改已凍結的 `domain-model`。
- T7 根據本規格的 0.2.x 現況表執行；實作前若現況改變，更新該表及對應 task。已交付基本管理不得重做。
- T10 首頁與區段導覽依賴 #454 的 workflow summary 欄位；未合併前只依其最新已核定回應契約建置 mock，合併後必須 merge 最新 `main` 再完成真後端走查。現場專屬帳號的權限分類依 `viewer_permission_codes`，不得從 `task_counts_visible` 或零計數推斷。

## 並行分組

依改動檔案分波；有相同 API router、`AdminPage.tsx`、Dashboard 前端區域或規格檔的工作須錯開。

- 第 1 波：T0、T1、T4、T5a 可分別進行；T0 是先行 spec-change，T4 等 #390，T5a 只負責把已裁定 C 同步到 audit-log。若 T1／T4 等需共用 `backend/app/main.py` 註冊，依 README 的共用檔案規則錯開。
- 第 2 波：T2、T3 依賴 T1；兩者共用 Dashboard 前端區域，應同一責任人串接或錯開。T5b 在 T5a 合併後開始。T6a 在 T0 合併後開始；T6b 等 T0、T6a 都合併後開始。
- 第 3 波：T7 等 T0 合併後開始；與 T4 若共用角色／使用者路由，錯開實作；其餘檔案不重疊時可並行。
- 0.7.x 後續版本：T8 等 `completion-validation` 契約與實作完成後執行，僅切換既有完成數與完成率的計算來源。
- #104 Field UI 僅在路由、共用 API client 或共用元件有重疊時錯開；其餘可平行。

## 風險

- 全公司角色與權限模型依 [KD-60](../../intents/03-decisions-and-stack.md#kd-60)、[KD-67](../../intents/03-decisions-and-stack.md#kd-67)；T4 必須等待 #390 將 schema、預建角色及 API 契約更新至前置規格。發現衝突先同步文件，不以本計畫推論覆蓋。
- PR-18 影響預覽需在寫入前取得最新受影響者及權限差異；測試修改／刪除角色及指派／撤銷角色的不同影響集合。
- T0 與 T6a 是已凍結清單端點的規格變更，必須在 `authentication`／`domain-model` spec-change PR 合併後才可實作；#286 的 `member_count` 另需 T6a 合併。未合併 T6a 前不得呈現前端推算的成員數。
- Dashboard 彙總可能讀取大量 Task；先受授權範圍及 cursor 查詢限制，效能門檻依實際量測訂定。
- Project home 的內業／現場路由依賴摘要 API 回傳呼叫者的有效 `viewer_permission_codes`；契約缺欄時須先補 API，不得由前端自行猜測專案角色。
- 0.5.x Field 不提供完成 Task；若 seed 沒有 `COMPLETED` 資料，完成數、完成率與實際查核人數為 0，應在 demo fixture 中準備可重現案例。

## 驗證（Proof）

| AC | 驗證方式 |
|---|---|
| ADM-AC01、02 | API/service 測試建立各 Task 狀態及封存 Plan，驗證今日工作、完成數與分母公式；前端驗證零值顯示 |
| ADM-AC03 | service/API 與 UI 測試使用指派者 A、開始者 B、完成者 C 的任務，確認三種歸屬獨立；含代查任務 |
| ADM-AC04、05、13 | API 測試覆蓋專案可見／不可見、指定越權 ID、全公司權限撤銷、未登入、一般使用者、無效 cursor／limit 和錯誤 envelope |
| ADM-AC06、07 | API／UI 測試非 Admin 拒絕、四類篩選 AND 組合、同 timestamp 的 cursor 穩定性及唯讀資料庫行為 |
| ADM-AC08 | 前後端測試覆蓋公司角色新增／修改／刪除及指派／撤銷前的影響清單和權限差異、確認門檻、取消不送出 |
| ADM-AC09 | #286 契約合併後 API 測試多專案及零成員筆數；UI 使用 API 值，不在契約尚未完成時推算 |
| ADM-AC10、11 | user/company 搜尋、cursor、原子批次 rollback、臨時密碼一次性回傳、舊 session 失效、計數與稽核，以及專案成員批次角色操作的 API/UI 測試 |
| ADM-AC12 | demo seed／API fixture 建立已完成、進行中及取消 Task；走通派出、現場開始、Dashboard 查看，並驗證沒有完成資料時指標為 0 |
| ADM-AC15、16 | 前端摘要 mock 驗證五種 `primary_step`、全完成狀態、各數字、未指派草稿數與 `task_counts_visible=false`；#454 合併後再用真後端確認 |
| ADM-AC17 | Testing Library 驗證每個區段恰一個目前頁、缺少各區段權限時導覽隱藏、頁面單一 `<h1>` 與唯一「返回專案清單」連結、手機選單展開及 Escape 關閉；真實 Vite 與無頭瀏覽器分別走查 1280px、360px 並保存截圖 |
| ADM-AC18 | 前端測試以 `viewer_permission_codes` 只含 `inspection_task.inspect`／`inspection_task.read` 的帳號驗證導向 Field，並以任一內業權限驗證留在專案；真後端登入測試帳號走查權限結果 |
| ADM-AC19 | 專案清單測試建立成功導向新首頁、重複代號仍已儲存警告顯示且可關閉、每列「開啟專案」及「成員」各自連至正確區段 |
| ADM-AC20 | `backend/tests/api/test_projects.py`：零角色加入／取代回 422 且資料不變、帶角色成功、無權限先 403；同檔契約測試讀取 `frontend/src/admin/projects/fixtures/member-roles-contract.json`，驗證真 API 的欄位集合與錯誤碼和前端 mock 一致（RG-M22） |
| ADM-AC21 | `ProjectsAdmin.test.tsx`、`roleDescriptions.test.ts`、`RolePermissionSummary.test.tsx`：未選角色擋下＋欄旁錯誤＋聚焦、伺服器 422 對應、後端 registry 完整覆蓋、依 registry 順序摘要與清單、合併後項目計數一致、混合已知／未知碼及雙未知碼回退、兩個角色各自展開、零權限無按鈕、固定可及名稱；SQLite 真後端、Vite 與無頭瀏覽器走查 360px／1280px，記錄 HTTP 狀態與截圖 |
| ADM-AC22 | `ProjectsAdmin.test.tsx`：修改角色、未儲存確認、移出確認與 Esc、卡片清單與舊成員提示；SQLite 真後端、Vite 與無頭瀏覽器走查 360px／1280px，記錄 HTTP 狀態與截圖 |
| ADM-AC26 | `backend/tests/api/test_projects.py`：同公司／跨公司不洩漏、已加入與停用者排除、無公司呼叫者為空、Admin 看全部、欄位與契約 fixture 一致、cursor、權限（401／403／他專案 403／404）、全域 `/users`、`/roles` 仍 403、非 Admin 加入他公司或無公司對象回 422 與專用錯誤碼 而 Admin 不受限、查詢數不隨資料增加；`test_route_access.py` 登記兩條新路由；`ProjectsAdmin.test.tsx`：內業以點擊加入（必選角色）、修改角色、移出，全程不呼叫全域 `/users`、`/roles`，伺服器 422 公司不符對應到使用者欄；候選或角色失敗時成員列表仍顯示並可重新載入，無權限者看不到操作；SQLite 真後端、Vite 與無頭瀏覽器以內業帳號走查 1280px／360px，記錄 HTTP 狀態與截圖 |
| ADM-AC27 | 各畫面的前端測試：入口名稱、非管理者外殼與計畫任務頁的成功提示（`role="status"`、舊提示清除）、項目修改確認的兩種說法（草稿只有確認儲存、已派出才有選項與說明）、成員頁無候選時隱藏表單、存為範本後項目數更新、變更密碼頁規則；SQLite 真後端、Vite 與無頭瀏覽器從登入開始只靠點擊走查內業、現場、混合三種帳號並保存桌面與 360px 截圖 |
| ADM-AC14 | UI 測試驗證一次性密碼結果／離頁清除、三種高風險操作的取消不送出與確認送出、專案未儲存時保留或捨棄；以 SQLite 真後端、Vite 與無頭瀏覽器走通流程並記錄 HTTP 狀態與桌面／360px 截圖 |

純文件規格 PR 不跑 `make setup`／`make check`。產品實作 task 依範圍執行必要檢查及資料庫驗收；PostgreSQL 未設定時記為 SKIPPED，不能當成 PASS。
