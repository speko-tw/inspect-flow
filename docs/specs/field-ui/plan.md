# 現場介面（field-ui）：實作計畫

**規格**：[spec.md](spec.md)

計畫記錄「為什麼這樣拆」。實作中發現更好的拆法就直接更新本檔（屬於「計畫調整」）；進度看 issue，不在這裡打勾。

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1 | 補齊跨專案已派 Task API 與 Field 安全詳情 API：逐筆權限過濾、無權限專案 403、預設本人、cursor 分頁、`dispatched_at` 排序及 `DRAFT` 詳情隱藏。前端假資料不可作為完成條件；若現有凍結 Task 契約缺少派送時間，先確認並完成規格變更流程。 | API router／schema／service、API 測試、錯誤碼與權限登記；精確檔案依 #361 實際落點 | #361；與 T2 response contract 對齊 | FUI-AC01–04、AC07–08 | — |
| T2 | 將現有 Field 個人工作台改為 `/field/` 今日任務首頁，提供登入保護、列表、載入／空／錯誤／403 狀態及兩種範圍切換；可先用 fixture 寫元件測試，但此任務完成前必須改接真實 API，並以真實後端驗證相關 AC。將變更密碼／適用個人入口保留在 Field，登出可用。 | 前端路由、Field layout、清單頁、API client 與前端測試 | 已有前端基礎（0.1／0.2）；T1 API 可用；不得依賴 #363 作為前端基礎 | FUI-AC01–02、AC07–10、AC12 | — |
| T3 | 建立真實 Task 詳情頁與唯讀需求快照清單，呈現位置、專案、狀態及照片／量測要求；完成條件包含接上真實詳情 API。`DRAFT` 隱藏須依 T1 後端保證，不可只靠前端過濾。 | Field task detail、需求呈現元件、API client 與前端測試 | T2；#361 Task 詳情／Snapshot API 與 Field 安全詳情契約 | FUI-AC03–04、AC08–09 | — |
| T4 | 串接開始查核操作，依 Task／Plan 狀態顯示控制項，以真實後端回應更新權威狀態；完成條件含非指派但有權限成員開始任務的整合驗證。 | Field start action、API client 整合及前後端測試 | T3；#361 開始 Task API 與狀態契約 | FUI-AC05–08 | — |
| T5 | 落實區網開發伺服器來源限制，完成 iPhone／iPad mkcert 根憑證安裝及信任指引，並實機驗收 HTTPS 登入、Session 維持及登出。需確認 Vite 限制手段可驗證；文件須涵蓋根憑證信任步驟及不得傳送 CA 私鑰。 | `frontend/vite.config.ts`、`Makefile`、README iPhone 測試段落及必要 Field 文件；依責任分支同步範圍 | #231 的 LAN 防護、憑證信任與實機測試要求；既有 #363 不作此任務前置基礎 | FUI-AC10–11 | — |
| T6 | 以真實後端及真實資料完成端對端「登入 → 今日／全部任務 → 查看快照 → 開始查核」演示，提供 #381 demo 所需種子資料／情境；不得使用 mocked API response。 | E2E 測試、後端 seed 與其專用資料；精確檔案依 #381 實際責任區 | T1–T4；#381 示範流程整合 | FUI-AC01–08、AC10、AC12 | #381（示範流程） |
| T7 | 將現有範本瀏覽與專案套用範本移至 Admin 路由，將舊 `/field` 範本路徑轉址至對應 `/admin/...` 頁，確認 Field 首頁與個人操作入口不洩漏管理功能。 | 共用路由、範本頁路由與測試；Admin 目標路由依 `admin-dashboard` 責任安排 | `admin-dashboard` 目標路由；與 #363 的內業 Plan／Task UI 共用 route/API client 需先協調責任，不能假設其為前端基礎 | FUI-AC12 | — |
| T8 | 整合並完成真實 API 驗收、Manifest／viewport／觸控尺寸及 Field/Admin chunk 檢查；mock 僅留單元／元件測試。以真實後端重跑受影響 AC，彙整可供審查的證據。 | Field 整合與瀏覽器測試、build 驗收設定（如需）；不得以 fake response 代替後端 | T1–T7；#363 若同時變更共用 routes／API client，需依共用檔案規則串行整合 | FUI-AC01–12 | — |

- 每個任務一個 PR 就能完成，並能單獨驗收；需跨任務共用路由或 API client 時依責任區串行。
- 每個任務至少對應一條 AC；每條 AC 至少被一個任務涵蓋。
- 跨規格依賴寫 issue 編號；依賴之外的執行先後列於跨規格依賴或並行分組。
- T2–T4 可在單元／元件測試使用 mock，但任務完成條件一律要接真實 API 並以真實後端驗證相關 AC；T6 的 E2E 與 demo 必須使用真實後端及資料。

## 跨規格依賴

- `#361`：inspection-planning T3，提供 Plan、Task 與專案項目 API（含 Task 詳情、開始及 Field 所需查詢）。Field 列表需 `inspection_task.inspect` 權限及安全隱藏 `DRAFT` 詳情。API/RBAC 契約若不符，先更新來源規格與 issue，不以 UI mock 代替。`dispatched_at` 目前不在凍結 Task 模型；如必須新增持久欄位，先走規格變更流程。
- `#363`：inspection-planning T4，內業 Plan／Task 管理 UI，不是 Field 前端基礎；它可能同時修改共用路由或 API client。由責任方先協調共用檔案及接合順序，Field 任務不將 #363 寫成基礎設施前置。
- 前端基礎與認證路由已由 0.1／0.2 建立；Field 依現有單一 React app 與 code-splitting 契約增補 `/field/*`。
- `admin-dashboard`：提供範本頁搬遷目標路由；若尚未完成，T7 需作為依賴協調，不把內業範本功能留在 Field。
- `inspection-planning`：Task 可見範圍、Task 詳情、內嵌分區名稱、`location_text` 與開始端點。Field 不呼叫分區列表 API。
- `state-machines`、`authentication`、`domain-model`、`api-conventions`：狀態、Session、權限、cursor 契約依其凍結內容；要更動共用規格或登記表時另開適當任務。
- `#231`：區網開發伺服器防護、mkcert 根憑證信任步驟及 iPhone 實機 Session 驗收，納入 T5；實際 Vite 限制方式依能力選定並做可重現驗證。
- `#381`：提供真實後端及 seed 的端到端示範，依賴 Field 清單、詳情與開始流程，不以 mock 或假回應驗收。

## 並行分組

同一波以互不重疊檔案為前提；共用路由／API client 等依[共用檔案規則](../README.md#parallel)由單一任務依序修改。

- 第 1 波：T1 後端 API／權限／草稿隱藏；T2 Field 列表 UI 可先開發元件，但真 API 接合需等待 T1。#363 如修改共用 routes/API client，須先確認所有權並串行。
- 第 2 波：T3 詳情；T5 LAN 防護及 iPhone 手動驗收可在不同檔案責任區並行。
- 第 3 波：T4 開始查核，依賴 T1 與 T3 的真實 API 整合。
- 第 4 波：T7 範本頁移轉需等 Admin 目標路由；T8 以真實後端整合驗收全部 AC。
- 第 5 波：T6 真實 E2E／seed 演示，依賴 T1–T4 及 demo 的資料準備。

## 風險

- `#361` 未提供 Field 跨專案列表或安全詳情契約時，真實 API AC 不能通過；不可用 fixture／mock 報稱完成。
- `dispatched_at` 不在目前凍結資料模型。排序必須先依 inspection-planning/API 契約提供；若需改模型先走規格變更，不得在此規格直接新增欄位。
- Task 指派是建議而非排他權限。清單預設只影響本人篩選，開始權限仍由後端依同專案 `inspection_task.inspect` 覆核。
- 登入 Cookie 帶 `Secure`；iPhone／iPad 區網測試需 HTTPS、憑證 SAN 涵蓋 IP、裝置明確信任根憑證且開發伺服器限制來源。CA 私鑰留在開發機。
- Task 詳情的需求快照唯讀；Evidence／Result 實體仍受各自階段規格限制，不提前實作照片上傳、結果輸入或完成動作。
- 範本路由移轉須有 Admin 目標路由；與 `admin-dashboard`／#363 的共用 route 檔案要串行安排。

## 驗證（Proof）

所有 API、權限及端對端 AC 以真實後端驗證；mock 限單元或元件呈現測試。

| AC | 驗證方式 |
|---|---|
| FUI-AC01 | 真實 API 整合測試涵蓋多專案、assigned/unassigned、各 Task 狀態與無權限專案；驗證預設及全部範圍。 |
| FUI-AC02 | 真實 API 測試驗證無任一專案權限回 403、有權限但空結果回 200，及指定專案無權限回 403。 |
| FUI-AC03 | 以真實 Task 詳情 response 驗證分區名稱、補充文字／純文字位置、快照呈現；確認不呼叫 zone list、不寫 Evidence／Result。 |
| FUI-AC04 | 後端直接以 inspect-only 使用者請求 DRAFT ID，驗證清單排除且安全詳情回 `404 task.not_found`。 |
| FUI-AC05 | 使用非建議指派但有權限的使用者呼叫真實開始 API，驗證狀態及實際操作者。 |
| FUI-AC06 | 真實 API 測試對進行中、完成、取消、封存 Task 執行開始請求；前端驗證控制項顯示。 |
| FUI-AC07 | 建立多頁且派送時間相同的真實資料，逐頁驗證 `dispatched_at DESC, task_id DESC`、預設 50／上限 100、cursor 不重複遺漏及開始後順序不變。 |
| FUI-AC08 | 真實前後端分別驗證未登入、401、403、404、read-only 權限，確認錯誤不顯示成空資料或登出。 |
| FUI-AC09 | Browser viewport 360／390／768px 實測主要觸控目標至少 44×44 CSS px、無水平捲動、meta 允許縮放；人工檢查無 PR-10 禁止內容。 |
| FUI-AC10 | 檢查 production build 的 manifest 欄位、iOS icon/meta、未註冊快取 Service Worker、Field route chunk 不含 Admin；資料透過線上 API 載入。 |
| FUI-AC11 | 依 #231 文件使用真 iPhone Safari：允許網段可連、未允許來源不可連；驗證 mkcert 根憑證安裝與信任、登入、Session 維持、登出、Secure Cookie 及 proxy。 |
| FUI-AC12 | 瀏覽器直接開舊 Field 工作台及範本路徑，驗證今日任務首頁、轉址到 Admin 範本頁、個人操作入口仍可用。 |

## 考慮過但沒採用的做法

- 另建 Field 前端專案：不採用，`OQ-21` 已裁定維持單一 React application，除非未來 PWA 需要獨立發布週期再評估拆分。
- 讓指派成為唯一可執行人：不採用，違反 [STM-R11](../state-machines/spec.md#需求)；指派只影響清單預設篩選。
- 只在前端隱藏 DRAFT：不採用；API 直接請求任務 ID 仍可洩漏草稿內容，必須由 Field 安全詳情 API 保障。
