# 管理後台（admin-dashboard）：實作計畫

**規格**：[spec.md](spec.md)

計畫記錄「為什麼這樣拆」。實作中發現更好的拆法就直接更新本檔（屬於「計畫調整」）；進度看 issue，不在這裡打勾。

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1 | Dashboard 彙總 API：按登入者權限彙總已派出 Task、今日工作量、完成數／率及專案進度；不依賴 Evidence。先以 Task 狀態做 0.5.x 指標 | `backend/app/api/v1/`、`backend/app/services/`、`backend/tests/api/`、`backend/tests/services/`、`backend/tests/contract/`、`docs/specs/admin-dashboard/` | #361（Plan／Task API）；`inspection-planning`、`state-machines` 已凍結 | ADM-AC01、ADM-AC02、ADM-AC04、ADM-AC05 | 待開 task |
| T2 | 唯讀總覽 UI：呈現專案進度與工作量；全公司總覽與專案總覽分別套用授權範圍。頁面可先用 mock query client 與假資料接上布局，#361 API 可用後再替換 | `frontend/src/admin/dashboard/`（新增）、`frontend/src/admin/AdminPage.tsx`（只新增導覽／路由）、`frontend/tests/`、`docs/specs/admin-dashboard/` | T1；#361；與 #104 的 Field UI 分開路由與檔案；依 #363 的先 mock 慣例，先接 mock 再換真 API | ADM-AC01、ADM-AC02、ADM-AC04、ADM-AC05、ADM-AC11 | 待開 task |
| T3 | 工程師彙總：並列建議指派人的未完成任務與實際查核人的完成數；沿用 Task 的 assignee 與實際操作者資料 | `backend/app/services/`、`backend/tests/services/`、`frontend/src/admin/dashboard/`、`frontend/tests/`、`docs/specs/admin-dashboard/` | #361；`inspection-planning` 的 `assignee_id`、實際查核者欄位；T1 | ADM-AC03 | 待開 task |
| T4 | 全公司角色管理 UI：列表、建立、修改同範圍權限與指派給使用者；API、角色 schema、預設角色、migration 依 #390 更新後的 `authentication`／`domain-model` 規格實作 | `frontend/src/admin/company-roles/`（新增）、`frontend/src/admin/AdminPage.tsx`（只新增路由）、`frontend/tests/`、`backend/app/`、`backend/tests/`、`docs/specs/admin-dashboard/` | #387 intents 合併；#390 前置規格與其 plan 任務完成；Admin 授權依更新後 `authentication` | ADM-AC08 | #390；實作 task 待開 |
| T5 | 稽核紀錄查詢：依專案、操作者、時間、動作類型查詢及 cursor 分頁；新增 Admin 唯讀 API 與查詢頁；同步 `audit-log` 的 ALG-Q2 及對應 AC／介面描述，紀錄 #107 負責人裁定連結 | `backend/app/api/v1/`、`backend/app/services/`、`backend/tests/api/`、`backend/tests/services/`、`frontend/src/admin/audit-log/`（新增）、`frontend/tests/`、`docs/specs/audit-log/spec.md`、`docs/specs/admin-dashboard/` | #107 裁定；`audit-log` T1～T2 與其資料 API；`authentication` Admin 存取檢查 | ADM-AC06、ADM-AC07 | 待開 task |
| T6 | 專案列表成員數：先依規格變更流程把成員數回應契約加入 `domain-model`，再實作 API 聚合欄位與列表欄位 | `docs/specs/domain-model/spec.md`、`docs/specs/domain-model/plan.md`、`backend/app/api/v1/projects.py`、`backend/app/services/projects.py`、相關 API／service tests、既有專案列表 UI 與測試 | #286；需先完成 `domain-model` 規格變更與 task issue；#275／#277 的專案列表 API／UI | ADM-AC09 | #286（目前仍 open）及其規格變更 task |
| T7 | 進階使用者／公司／角色／專案管理：逐項盤點 0.2.x 已交付頁面與 API，只補搜尋、分頁、批次等未涵蓋能力；與 T4 的全公司角色區隔 | 依盤點結果限縮到既有 admin 頁/API 與測試；本規格文件 | #263、#265、#274、#275、#277 已完成；#390 更新後的角色前置規格 | ADM-AC10 | 待盤點後開 task；已完成部分不開工 |
| T8 | 指標補齊：0.6.x Evidence 與 0.7.x Completion Validation 交付後，將同一完成指標改為伺服器驗證完成，維持現有 Dashboard 契約並補對應測試 | `backend/app/services/`、相關 API／service tests、`frontend/src/admin/dashboard/`、相關 tests、`docs/specs/admin-dashboard/` | 0.6.x `field-evidence`、0.7.x `completion-validation` 對應 tasks 完成；#388 | ADM-AC02、ADM-AC11 | 依前置規格開 task |

- 每個 task 一個 PR 就能完成，並能單獨驗收。
- 每個任務至少對應一條 AC；每條 AC 至少被一個任務涵蓋。
- 跨規格的依賴寫 issue 編號（例如 `#361`）。T6 先開規格變更工作，不得以本規格直接改凍結中的 `domain-model`。
- T7 是需求盤點，不代表重做已完成功能；盤點若確認 0.2.x 範圍已完整交付，可關閉為無需實作。

## 並行分組

依「改動的檔案」分波；同一波內的任務檔案不重疊。碰到[共用檔案](../README.md#parallel)的任務要注明。

- 第 1 波：T1、T4、T5 可分開啟動；T4 等 #390 前置規格更新後才實作，T5 會改 `audit-log/spec.md`，不能與其他改該規格的工作同時進行。T1、T4、T5 的 `backend/app/main.py` router 註冊若有需要，必須採共用檔案單行新增規則並錯開 PR。
- 第 2 波：T2、T3 依賴 T1 的 API／資料契約；T2 與 T3 共用 Dashboard 前端區域，應同一責任人串接或錯開，不能同波寫重疊檔案。
- 第 3 波：T6 等 #286 的規格變更先合併；T7 在盤點 0.2.x 交付後再決定是否開實作 task。
- 後續版本：T8 等 Evidence 與 Completion Validation 的資料契約及實作完成後執行。
- #104 Field UI 的檔案由其 task 負責；只在路由或共用 client 等檔案不重疊時與本規格任務並行。

## 風險

- 權限模型正在由 #387、#390 更新；若在前置規格合併前凍結 API 權限代碼或資料 schema，會與全公司角色／專案角色分層衝突。T4 等前置規格完成後再實作。
- #286 要求新增專案 API 回應欄位，可能影響已凍結的 `domain-model` API 契約；先走規格變更流程並增加 API／service 驗收，避免只在前端顯示推算值。
- 完成率與專案進度先依 Task 狀態計算；分子／分母、取消 Task 的排除方式是本規格設計細節。未來依 #388 及 `completion-validation` 更新時應維持同一指標定義，避免新舊數字並存。
- 工程師兩種工作量來源不同：建議指派人與實際查核人不能混用。測試需安排一筆由非指派人完成的 Task，確保代查歸屬正確。
- 稽核查詢是 Admin-only 且唯讀；需同時驗證 API 與 UI 的拒絕行為，不能只隱藏導覽連結。
- 總覽查詢可能聚合大量 Task；先採授權範圍限制及 cursor 分頁，效能門檻依實際資料量測訂定，不在本規格臆設數值。

## 驗證（Proof）

| AC | 驗證方式 |
|---|---|
| ADM-AC01 | 後端 API 測試：建立日期不同的未完成已派出 Task、草稿與完成 Task，斷言日期不影響今日工作量且狀態範圍正確；前端測試確認顯示查詢結果 |
| ADM-AC02 | 後端 service/API 測試以各 Task 狀態驗證完成數、分母、百分比；0.7.x 再測完成驗證結果改變同一指標。公式依 spec 的「待釐清」裁定後固定 |
| ADM-AC03 | 後端與前端測試：建議指派人 A、實際由 B 完成，分別斷言未完成數及完成數歸屬；依賴 `inspection-planning` 實際操作者欄位 |
| ADM-AC04 | API 權限測試：有權限專案可見、無權限專案不可見；含直接指定專案 ID 的越權案例 |
| ADM-AC05 | API 權限測試：全公司權限可讀全部專案；撤權後拒絕；專案權限不等同全公司權限 |
| ADM-AC06 | API 與前端測試：非 Admin 查詢拒絕且不回傳紀錄；不能只靠隱藏連結 |
| ADM-AC07 | API 測試覆蓋四類篩選組合、cursor 邊界及穩定排序；資料庫與 service 測試確認查詢不執行任何寫入／刪除 |
| ADM-AC08 | 前後端測試建立全公司角色、拒絕混入專案權限、修改權限及指派；確認 Admin 的有效權限不受指派變動影響 |
| ADM-AC09 | 專案列表 API 測試多專案成員筆數及空成員專案，前端驗證欄位呈現；先通過 #286 規格變更 |
| ADM-AC10 | 盤點 #263、#265、#274、#275、#277 issue／merged PR 與現有前端及 API；對新增進階行為補 API／UI 測試，重用既有 0.2.x 驗收 |
| ADM-AC11 | 使用 0.4.x Plan／Task API 與 0.5.x 前端走端到端流程；在 Evidence／Completion Validation 未完成時，確認後台仍以 Task 狀態呈現而不要求照片資料 |

各 task PR 執行其範圍所需的 `make check` 及必要資料庫檢查；本規格文件 PR 不跑 build/test。PostgreSQL 本機未設定時記錄為 SKIPPED，不能當作 PASS。

## 考慮過但沒採用的做法

- 把 Dashboard 當正式交付報告：不採用，正式報告應有自己的版本、快照及 DOCX／PDF 交付流程。
- 把指派人直接當成實際查核人：不採用；`inspection-planning` 已要求記錄實際操作人，且負責人裁定要並列兩種人員數字。
- 將照片統計加入 0.5.x：不採用；#375 更正明確指出原範圍沒有照片統計，且 0.5.x 先使用已有的 Plan／Task 資料。
