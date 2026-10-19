# T10 元件規範與跨頁驗收紀錄

**狀態：PASS（UDS-AC12／14 依裁定延後，不列實測通過）**　**工作線：#686**　**日期：2026-10-19**

本紀錄依 `ui-design-system` T10、UDS-AC01、09–16 執行。來源快照為本分支合併 `origin/main` 後的程式碼；指南示範畫面取自隔離副本（本分支 `git archive` 加上 `origin/381-demo-seed-walkthrough` 的 `demo/` archive），服務及 SQLite 資料只存在 `/private/tmp`。詳見本表與 #700 指南截圖；未完成的檢查明列 `NOT_RUN`。

| AC | 結果 | 實際證據與界線 |
|---|---|---|
| UDS-AC01 | PASS | [規格](spec.md#驗收條件)連至負責人核可的第 2 版原型，引用 KD-70；重大畫面依 RG-M21 原型關卡。核對 `spec.md`、`plan.md` 及 #686 issue 討論。 |
| UDS-AC09 | PASS | `frontend/src/styles/tokens.test.ts` 驗證淺／深色語意文字對背景 ≥4.5:1，狀態及控制組合有對比斷言；`components.module.css` 定義 focus-visible；九個示範帳號登入頁的淺／深色鍵盤 Tab 首焦點均實測為 3px outline。完整測試結果以本紀錄末的 `make check` 為準。獨立 axe 執行 `NOT_RUN`；以 token 對比測試及真瀏覽器鍵盤走查作等效證據。 |
| UDS-AC10 | PASS，附偏差 | 九個登入入口在 1280/360 CSS px、淺／深色共 36 組檢查；深層頁面另做 8 路徑 × 4 組。水平溢位為 0。主要表單、行動和導覽可於窄版操作；管理帳號清單的人名連結為 46×21px、帳號選單為 78×32px，低於 44px 高度建議，視覺列距仍可辨識。此偏差列為可用性建議，未改 UI。 |
| UDS-AC11 | PASS | 360px 實際新增帳號精靈截圖 `docs/user-guide/images/account-create-step-1-360-light.png`；畫面在 360 CSS px 無水平溢位，短中文標籤未於詞中斷行，長欄位說明正常換行，步驟標示保留文字。功能頁圖片與所有示範登入入口一併檢視。 |
| UDS-AC12 | 延後到 #286 | **維護者補充裁定（2026-10-19）**：#286 member_count 排在 v0.5.0 之後 PATCH 包；本包不定義欄位或口徑。`ProjectsPage` 不以 UI 推算數字。此 AC 不阻擋本包，也不算實測通過。 |
| UDS-AC13 | PASS | 隔離 demo 真後端以 `GET /api/v1/projects?limit=1` 取得第一頁（HTTP 200、含 `next_cursor`），再用 cursor 取得第二頁（HTTP 200）；UI 搜尋不存在名稱顯示空結果。瀏覽器暫時離線時出現「無法連線到伺服器，請稍後再試。」；恢復後重按「搜尋」取得空結果。51 筆載入更多按鈕流程由 `ProjectsAdmin.test.tsx` 覆蓋；示範資料只有兩個專案，故實頁沒有顯示「載入更多」按鈕。
| UDS-AC14 | 延後到 #515 | **維護者補充裁定（2026-10-19）**：#515 外觀偏好排在 v0.5.0 之後 PATCH 包；本包不假設偏好欄位/API，跨裝置保存及首次繪製前套用待該契約。此 AC 不阻擋本包，也不算實測通過。 |
| UDS-AC15 | PASS | 初次真瀏覽器走查發現明確淺色主題 selector 特異性蓋過 reduced-motion media rule；本分支以淺/深/系統/未設定 selector 修正，並在 `tokens.test.ts` 增 regression assertion。修正後八個深層頁面在淺/深主題、1280/360 共 32 組均讀回 `--motion-fast: 0ms`；reduced-motion regression test 7 項通過。 |
| UDS-AC16 | PASS | 本分支新增[元件規範與使用指引](component-guidelines.md)，列出元件狀態矩陣及功能頁套用範圍。七項回饋及外部交付來源見 #686 issue 討論：`HANDOFF.md` 與 `OpsWorkbench.dc.html` 已交付外部專案，`/design-sync` 尚待進行；外部 repo 不在本分支改動範圍，也不宣稱已同步其實作。 |

## 實際走查範圍

- 九個登入身分：`admin`、`demo-manager`、`demo-office`、`demo-field-a`、`demo-field-b`、`demo-template-manager`、`demo-template-delegate`、`demo-consultant`、`demo-no-access`。每個身分均實際登入；首頁與可見導覽已依畫面記錄於 #700 指南。
- 深層頁面：帳號清單、帳號詳情、角色、專案成員、專案查核項目、總覽、總覽專案任務清單、個人設定。
- 版面：1280 與 360 CSS px；淺色與深色；檢查 `document.documentElement.scrollWidth` 對照 `innerWidth`。所有已走查組合皆無水平溢位。
- 鍵盤：各登入入口以 Tab 進入第一個導覽連結，讀回 3px focus outline；元件及表單互動的完整行為由 `make check` 覆蓋。未執行獨立 axe 掃描。
- 停用流程：在隔離資料中對 `demo-no-access` 實際停用，`PUT /api/v1/users/{id}/active` 回 HTTP 200，畫面與重載皆顯示「已停用」；截圖後反向啟用，重載顯示「啟用中」。未修改 repo 內 demo 種子資料。
- 易用性發現：`/overview/projects/:projectId` 可直接重現未登記路由 404，但主管總覽中的專案選擇與清單沒有指向該路徑的連結，故一般導覽不會走入死路；未擴充路由。外部協作的專案查核項目頁沒有套用範本操作，符合角色限制。
- 易用性發現：診斷建議的「專案工程師」包含多項管理能力，畫面提示先比較角色並前往專案成員設定，不能描述為一鍵補權限；指南已改成先核對角色範圍，不替使用者選角色。
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
