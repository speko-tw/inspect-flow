# T10 元件規範與跨頁驗收紀錄

**狀態：PASS（UDS-AC12／14 依裁定延後，不列實測通過）**　**工作線：#686**　**日期：2026-10-19**

本紀錄依 `ui-design-system` T10、UDS-AC01、09–16 執行。來源快照為本分支合併 `origin/main` 後的程式碼；指南示範畫面取自隔離副本（本分支 `git archive` 加上 `origin/381-demo-seed-walkthrough` 的 `demo/` archive），服務及 SQLite 資料只存在 `/private/tmp`。詳見本表與 #700 指南截圖；未完成的檢查明列 `NOT_RUN`。

| AC | 結果 | 實際證據與界線 |
|---|---|---|
| UDS-AC01 | PASS | [規格](spec.md#驗收條件)連至負責人核可的第 2 版原型，引用 KD-70；重大畫面依 RG-M21 原型關卡。核對 `spec.md`、`plan.md` 及 #686 issue 討論。 |
| UDS-AC09 | PASS | `frontend/src/styles/tokens.test.ts` 驗證淺／深色語意文字對背景 ≥4.5:1，狀態及控制組合有對比斷言；`components.module.css` 定義 focus-visible；九個示範帳號登入頁的淺／深色鍵盤 Tab 首焦點均實測為 3px outline。完整測試結果以本紀錄末的 `make check` 為準。獨立 axe 執行 `NOT_RUN`；以 token 對比測試及真瀏覽器鍵盤走查作等效證據。 |
| UDS-AC10 | PASS | 九個登入入口在 1280/360 CSS px、淺／深色共 36 組檢查；深層頁面另做 8 路徑 × 4 組。水平溢位為 0。修前真 360px 的帳號姓名連結為 44.30×21px，修後為 44.30×44px；帳號選單為 78.06×44px，原已符合。桌機姓名連結 44.30×21px、選單 78.06×32.39px 保持原樣，字級未變。L1 的選單 78×32 記錄來自漏設 viewport 的量測（innerWidth=800），於 L2 以明確設定 360/1280 的真 Chrome 更正。 |
| UDS-AC11 | PASS | 360px 實際新增帳號精靈截圖 `docs/user-guide/images/account-create-step-1-360-light.png`；畫面在 360 CSS px 無水平溢位，短中文標籤未於詞中斷行，長欄位說明正常換行，步驟標示保留文字。功能頁圖片與所有示範登入入口一併檢視。 |
| UDS-AC12 | 延後到 #286 | **維護者補充裁定（2026-10-19）**：#286 member_count 排在 v0.5.0 之後 PATCH 包；本包不定義欄位或口徑。`ProjectsPage` 不以 UI 推算數字。此 AC 不阻擋本包，也不算實測通過。 |
| UDS-AC13 | PASS | 隔離 demo 真後端以 `GET /api/v1/projects?limit=1` 取得第一頁（HTTP 200、含 `next_cursor`），再用 cursor 取得第二頁（HTTP 200）；UI 搜尋不存在名稱顯示空結果。瀏覽器暫時離線時出現「無法連線到伺服器，請稍後再試。」；恢復後重按「搜尋」取得空結果。51 筆載入更多按鈕流程由 `ProjectsAdmin.test.tsx` 覆蓋；示範資料只有兩個專案，故實頁沒有顯示「載入更多」按鈕。
| UDS-AC14 | 延後到 #515 | **維護者補充裁定（2026-10-19）**：#515 外觀偏好排在 v0.5.0 之後 PATCH 包；本包不假設偏好欄位/API，跨裝置保存及首次繪製前套用待該契約。此 AC 不阻擋本包，也不算實測通過。 |
| UDS-AC15 | PASS | 初次真瀏覽器走查發現明確淺色主題 selector 特異性蓋過 reduced-motion media rule；本分支以淺/深/系統/未設定 selector 修正，並在 `tokens.test.ts` 增 regression assertion。修正後八個深層頁面在淺/深主題、1280/360 共 32 組均讀回 `--motion-fast: 0ms`；reduced-motion regression test 7 項通過。 |
| UDS-AC16 | PASS | 本分支新增[元件規範與使用指引](component-guidelines.md)，列出元件狀態矩陣及功能頁套用範圍。七項回饋及外部交付來源見 #686 issue 討論：`HANDOFF.md` 與 `OpsWorkbench.dc.html` 已交付外部專案，`/design-sync` 尚待進行；外部 repo 不在本分支改動範圍，也不宣稱已同步其實作。 |

## 2026-10-20 #413／#286 後續驗收（歷史紀錄）

- 當時暫採「目前啟用中的專案成員」口徑；`domain-model` 的 `member_count` 契約尚未凍結。本節是歷史實測，不代表 UDS-AC12 全部 PASS；2026-10-22 的正式契約與新驗收見下節。
- 真 demo 的 `GET /api/v1/projects?limit=50` 回 HTTP 200：`DEMO-A=3`、`DEMO-B=4`；各自 `/members` API 的啟用列數同為 3、4，畫面顯示「成員數：3／4」。

- Admin 真 Chromium 搜尋 `DEMO-B` 唯一命中；不存在名稱顯示空結果與清除搜尋。1280px、360px 均無水平溢位（`scrollWidth === innerWidth`）；截圖見 `design/413/1280-light-projects.png`、`design/413/360-light-projects.png`。
- `test_project_list_counts_only_active_members` 驗證停用成員不計入（計數 2）及零成員專案回 0；`test_project_list_query_count_does_not_grow`、`test_project_list_search_cursor_and_validation` 覆蓋查詢數、搜尋與 API cursor。
- `ProjectsAdmin.test.tsx` 的 `searches projects and loads the next cursor page` 與 `renders the API member count, including zero, after cursor paging` 使用 51 筆資料；第 1 筆顯示 0、第 51 筆顯示 API 值 7，載入請求帶 `cursor=50`。
- 定向結果：`backend/tests/api/test_projects.py` 63 passed、`backend/tests/services/test_projects.py` 4 passed、`ProjectsAdmin.test.tsx` 88 passed，均 exit 0。完整 `make check` exit 0：backend 1390 passed／22 skipped、PostgreSQL 595 passed／5 skipped、frontend 72 files／1478 passed；Prettier、ESLint、TypeScript、build、PWA 與拆包檢查均通過。
- NOT_RUN：當時真 demo 僅兩個專案，未以真瀏覽器驗證 50 筆以上的續載；此情境由上述 51 筆 UI 測試覆蓋。


## 2026-10-22 #286 裁定後驗收（UDS-AC12）

- 負責人裁定：成員數計算有效啟用的專案成員，含外部協作與無角色成員；停用及到期外部帳號不計。清單與專案首頁摘要顯示「啟用成員 N 人」；成員頁停用者以灰色標示「已停用」。契約凍結於 `domain-model` DOM-R77／DOM-AC76。
- 紅燈：`PYTEST_ADDOPTS='-p no:cacheprovider' backend/.venv/bin/pytest backend/tests/api/test_projects.py::test_project_list_counts_only_active_members backend/tests/api/test_project_workflow_summary.py::test_summary_counts_active_external_member_but_not_expired_account -q`，實作前 2 failed；到期但仍標記啟用的外部帳號被兩處錯誤計入。
- 綠燈：同一命令實作後 2 passed；涵蓋停用帳號、到期外部帳號、到期日當天仍有效、啟用外部成員無角色仍計入，並驗證清單與首頁摘要的計數。
- Vitest 定向：`VITEST_MAX_WORKERS=4 npm test -- --run src/admin/projects/ProjectsAdmin.test.tsx src/admin/projectHome/ProjectHomePage.test.tsx`，142 passed；最終完整前端驗收為 72 files／1478 passed。
- 最新共用 `account_status.py` clause 的定向 API tests：2 passed；完整 E2E 四個 Playwright suites 均 PASS，runner exit 0。
- 完整 `make check` 使用專用 PostgreSQL URL `inspectflow_test_413`、`VITEST_MAX_WORKERS=4`，exit 0：default backend 1391 passed／22 skipped、PostgreSQL 595 passed／5 skipped、frontend 72 files／1478 passed；format、Ruff、Pyright、Prettier、ESLint、TypeScript、Vite build、PWA 與 split checks 均通過。
- 真 demo 截圖：`/Users/kavy/.local/state/inspect-flow-handoff/design/286/` 下 `projects-1280.png`（1280×900）、`projects-390.png`（390×1126）、`project-home-1280.png`（1280×900）、`project-home-390.png`（390×949）、`members-1280.png`（1280×1586）、`members-390.png`（390×2051）。Playwright 用真 Chrome 登入隔離 demo，停用 `demo-field-b` 的 API 回 HTTP 200；清單與首頁顯示 DEMO-B 啟用 3 人，兩尺寸成員頁均讀到「陳柏勳（已停用）」；停用卡片與連結 computed color 均為 `rgb(83, 97, 116)`（淺色 token `#536174`）。父層另視覺複核 desktop list、mobile homepage、mobile members 三張。
- 截圖時的共享計數函式與最新 `account_status.py` clause 條件逐項相同；最新來源定向 API tests 與 E2E 均通過。截圖保留，不重截。

## 實際走查範圍

- 九個登入身分：`admin`、`demo-manager`、`demo-office`、`demo-field-a`、`demo-field-b`、`demo-template-manager`、`demo-template-delegate`、`demo-consultant`、`demo-no-access`。每個身分均實際登入；首頁與可見導覽已依畫面記錄於 #700 指南。
- 深層頁面：帳號清單、帳號詳情、角色、專案成員、專案查核項目、總覽、總覽專案任務清單、個人設定。
- 版面：1280 與 360 CSS px；淺色與深色；檢查 `document.documentElement.scrollWidth` 對照 `innerWidth`。所有已走查組合皆無水平溢位。
- 鍵盤：各登入入口以 Tab 進入第一個導覽連結，讀回 3px focus outline；元件及表單互動的完整行為由 `make check` 覆蓋。未執行獨立 axe 掃描。
- 停用流程：在隔離資料中對 `demo-no-access` 實際停用，`PUT /api/v1/users/{id}/active` 回 HTTP 200，畫面與重載皆顯示「已停用」；截圖後反向啟用，重載顯示「啟用中」。未修改 repo 內 demo 種子資料。
- 易用性發現：`/overview/projects/:projectId` 可直接重現未登記路由 404，但主管總覽中的專案選擇與清單沒有指向該路徑的連結，故一般導覽不會走入死路；未擴充路由。外部協作的專案查核項目頁沒有套用範本操作，符合角色限制。
- 易用性發現：診斷建議的「專案工程師」包含多項管理能力，畫面提示先比較角色並前往專案成員設定，不能描述為一鍵補權限；指南已改成先核對角色範圍，不替使用者選角色。
- 觸控目標修正：360px 姓名連結由 44.30×21px 擴為 44.30×44px；帳號選單在修前已是 78.06×44px，桌機尺寸及字級不變。L1 的選單 78×32px 是量測腳本未設定 viewport 的假陽性 (innerWidth=800)，由 L2 以真 Chrome 更正紀錄。
- `demo-manager` 查詢非成員的專案診斷時曾收到 404；這與「總覽」本身可看所有專案進度不同。列為待維護者釐清的可用性發現，不改授權或 API 契約。
- AC15 修正限定於 `frontend/src/styles/tokens.css` 的 reduced-motion selector，避免淺色主題的變數 specificity 蓋過媒體偏好；regression assertion 在 `frontend/src/styles/tokens.test.ts`。

## 命令與輸出

| 命令 | 結果 |
|---|---|
| `git fetch origin && git merge origin/main` | exit 0；merge commit `772b484`，無衝突 |
| 隔離 demo `demo/scripts/start.sh` | exit 0；服務啟動，九帳號均可登入 |
| 1280/360 × 淺/深色瀏覽器矩陣 | 九個登入入口 36 組與八個深層頁面 32 組均完成；水平溢位 0 |
| `make check`（`INSPECTFLOW_TEST_POSTGRES_URL` 指向專用 `inspectflow_test_686`） | 修正前 backend pytest 約 16% 收到 Ctrl-C（exit 130）；修正後 exit 0：backend 1371 passed／22 skipped，指定 PostgreSQL gate 595 passed／5 skipped，前端 71 files／1395 tests passed，typecheck、build、PWA artifact、split checks 均通過 |
| 獨立 axe 掃描 | NOT_RUN；使用 repo 對比測試與真瀏覽器鍵盤／幾何走查作等效驗收 |
