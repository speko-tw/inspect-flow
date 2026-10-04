# 管理後台（admin-dashboard）：實作計畫

**規格**：[spec.md](spec.md)

計畫記錄「為什麼這樣拆」。實作中發現更好的拆法就直接更新本檔（屬於「計畫調整」）；進度看 issue，不在這裡打勾。

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1 | Dashboard summary、projects、engineers API；落實狀態計數、權限範圍、游標分頁、錯誤及工程師三種歸屬數 | `backend/app/api/v1/`、`backend/app/services/`、`backend/tests/api/`、`backend/tests/services/` | #361（Plan／Task API）；`inspection-planning`、`state-machines` | ADM-AC01～05、13 | 待開 task |
| T2 | Dashboard 總覽 UI；依授權呈現單專案或全公司範圍，完成率與零資料狀態沿用 T1 契約 | `frontend/src/admin/dashboard/`（新增）、`frontend/src/admin/AdminPage.tsx`（僅新增入口）、`frontend/tests/` | T1；#361；與 #104 Field UI 分開路由及檔案；先以 mock 接版型，再替換為 API | ADM-AC01～05、12 | 待開 task |
| T3 | 工程師工作量視圖，分別顯示 assignee、started_by、completed_by 統計，不混用人員歸屬 | `backend/app/services/`、`backend/tests/services/`、`frontend/src/admin/dashboard/`、`frontend/tests/` | T1；`inspection-planning` 的指派及實際操作者欄位 | ADM-AC03、12 | 待開 task |
| T4 | 全公司角色管理與影響預覽：CRUD、權限選擇、指派／撤銷；所有變更前先顯示 affected users、權限差異並確認 | `frontend/src/admin/company-roles/`（新增）、`frontend/src/admin/AdminPage.tsx`（僅新增入口）、`backend/app/`、`backend/tests/`、`frontend/tests/` | #387 intents 已合併；#390 更新 `authentication`／`domain-model` 契約與計畫任務完成；Admin 權限依更新後規格 | ADM-AC08、13 | #390；實作 task 待開 |
| T5a | 由負責人裁定 ALG-Q2 後，獨立同步 `audit-log` 的查詢方案、欄位與驗收契約；只修改 audit-log 規格與其 plan，不與 Dashboard 實作同 PR | `docs/specs/audit-log/spec.md`、`docs/specs/audit-log/plan.md` | ALG-Q2 負責人裁定；依規格變更流程 | ADM-AC06、07 的前置 | 待裁定後開 task |
| T5b | Admin 唯讀稽核查詢 API 與頁面；按專案、操作者、時間、事件類型篩選並 cursor 分頁 | `backend/app/api/v1/`、`backend/app/services/`、`backend/tests/api/`、`backend/tests/services/`、`frontend/src/admin/audit-log/`（新增）、`frontend/tests/` | T5a 合併；`authentication` Admin 存取檢查 | ADM-AC06、07、13 | T5a 後開 task |
| T6a | 依 #286 走 `domain-model` API 契約規格變更，定義 `member_count` 欄位及停用成員口徑 | `docs/specs/domain-model/spec.md`、`docs/specs/domain-model/plan.md` | #286；規格變更 issue／流程 | ADM-AC09 前置 | #286 後續規格變更 task |
| T6b | 專案列表 API cursor 分頁、搜尋與成員數欄位，更新專案列表 UI | `backend/app/api/v1/projects.py`、`backend/app/services/projects.py`、相關測試、既有專案列表 UI 與測試 | T6a 合併；#275／#277 既有專案列表 | ADM-AC09、10、13 | T6a 後開 task |
| T7 | 進階管理：既有 user/company list 增加搜尋及 cursor 分頁，加入全批原子狀態操作、專案成員批次角色操作、既有使用者臨時密碼重設；不重做 0.2.x 基本 CRUD | `backend/app/api/v1/users.py`、`companies.py`、必要 services／測試；`frontend/src/admin/UsersPage.tsx`、`CompaniesPage.tsx`、專案成員介面及測試 | #263、#265、#274、#275、#277 已完成；AUT-R36／R37；T4 前置角色契約僅在涉及公司角色時依賴 #390 | ADM-AC10、11、13 | 待開 task |
| T8 | 0.6.x／0.7.x 完成驗證就緒後，以驗證完成更新相同 Dashboard 指標，維持既有 API 欄位並補測試；示範 seed 含已完成 Task | `backend/app/services/`、相關 API／service tests、Dashboard UI／tests、`demo/` fixture（若由該 task 負責） | `field-evidence`、`completion-validation` 的資料契約及實作完成；#388、#381 | ADM-AC02、12 | 依前置規格開 task |

- 每個 task 一個 PR 即可單獨驗收；每個 AC 至少由一個 task 涵蓋。
- T5a 是跨規格契約同步，T5b 是實作；兩者不得合併成同一 PR。ALG-Q2 未裁定前不得開 T5b。
- T6a 先完成規格變更，再開 T6b；不得直接在本規格或實作 PR 修改已凍結的 `domain-model`。
- T7 根據第 1 輪審查前已檢查的現況表執行，不再把散落項目留到實作階段才盤點。已交付基本管理不得重做。

## 並行分組

依改動檔案分波；有相同 API router、`AdminPage.tsx`、Dashboard 前端區域或規格檔的工作須錯開。

- 第 1 波：T1、T4、T5a、T6a 可分別進行；T4 等 #390，T5a 等 ALG-Q2 裁定。T1／T4 等若需共用 `backend/app/main.py` 註冊，依 README 的共用檔案規則錯開。
- 第 2 波：T2、T3 依賴 T1；兩者共用 Dashboard 前端區域，應同一責任人串接或錯開。T5b 只在 T5a 合併後開始；T6b 只在 T6a 合併後開始。
- 第 3 波：T7 與 T4 若共用角色／使用者路由，錯開實作；其餘檔案不重疊時可並行。
- 後續版本：T8 等 Evidence 與 Completion Validation 契約和實作完成後執行。
- #104 Field UI 僅在路由、共用 API client 或共用元件有重疊時錯開；其餘可平行。

## 風險

- #387／#390 正在更新全公司角色模型；T4 必須等待權限範圍、schema、預建角色及 API 契約落入前置規格。發現衝突先同步文件，不以本計畫推論覆蓋。
- PR-18 影響預覽需在寫入前取得最新受影響者及權限差異；測試修改／刪除角色及指派／撤銷角色的不同影響集合。
- #286 是 `domain-model` API 契約變更；未合併 T6a 前不得呈現前端推算的成員數。
- Dashboard 彙總可能讀取大量 Task；先受授權範圍及 cursor 查詢限制，效能門檻依實際量測訂定。
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

純文件規格 PR 不跑 `make setup`／`make check`。產品實作 task 依範圍執行必要檢查及資料庫驗收；PostgreSQL 未設定時記為 SKIPPED，不能當成 PASS。
