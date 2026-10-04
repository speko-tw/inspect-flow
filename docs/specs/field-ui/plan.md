# 現場介面（field-ui）：實作計畫

**規格**：[spec.md](spec.md)

計畫記錄「為什麼這樣拆」。實作中發現更好的拆法就直接更新本檔（屬於「計畫調整」）；進度看 issue，不在這裡打勾。

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1 | 補齊跨專案已派 Task 清單 API：登入者權限過濾、預設指派給本人、全部可查核切換、cursor 分頁及錯誤契約。0.4.x API 尚未完成時，可先用 fixture／fake response 開發前端，不得將假資料當成 API 已可用。 | API router／schema／service、API 測試、錯誤碼登記及權限代碼登記；精確檔案依 #361 實際落點 | `#361`（0.4.x API）；與 T2 的 response contract 對齊 | FUI-AC01、FUI-AC02、FUI-AC06 | — |
| T2 | 建立 `/field/*` 路由、登入保護、今日任務清單、載入／空／錯誤／403 狀態及兩種任務範圍切換；前端初期可使用 fixture。 | 前端路由、Field layout、清單頁與對應前端測試 | `#363`（前端基礎）；T1 contract 可先用 fake response | FUI-AC01、FUI-AC02、FUI-AC06、FUI-AC07、FUI-AC09 |
| T3 | 建立任務詳情頁與唯讀需求快照檢查清單，呈現位置、專案、狀態與必要照片／量測要求。 | Field task detail、需求呈現元件及前端測試 | T2；`#361` Task 詳情／Snapshot API | FUI-AC03、FUI-AC06、FUI-AC07 |
| T4 | 串接開始查核操作，依 Task／Plan 狀態顯示控制項，呈現伺服器成功或錯誤結果，刷新權威狀態。 | Field start action、API client 整合及前後端測試 | T3；`#361` 開始 Task API 與狀態契約 | FUI-AC04、FUI-AC05、FUI-AC06 |
| T5 | 完成區網 iPhone／iPad HTTPS 手動驗收流程與必要文件補充，檢查開發憑證及 Secure Cookie 路徑。 | 預計只需新增 Field 專屬文件或 `docs/specs/field-ui/` 中的驗收說明；若須改 README、Makefile、Vite 設定，先更新計畫並確認任務責任區 | `#363` 前端啟動方式；本 repo 現有 #231 文件與開發設定 | FUI-AC08 | — |
| T6 | 端對端演示「登入 → 現場看已派任務 → 查看快照 → 開始查核」，確認結果可供 #381 demo 使用。 | E2E 測試與其專用 fixture；精確檔案依 `frontend/` 現有測試結構 | T1～T4；`#381` 示範流程所需整合 | FUI-AC01～FUI-AC07、FUI-AC09 | `#381`（示範流程） |

- 每個任務一個 PR 就能完成，並能單獨驗收。
- 每個任務至少對應一條 AC；每條 AC 至少被一個任務涵蓋。
- 跨規格的依賴寫 issue 編號（例如 `#361`）。

## 跨規格依賴

- `#361`：0.4.x API。若該 issue 已完成相關 Task 查詢與開始端點，可直接整合；若未完成，前端 T2／T3 得先以假資料完成畫面骨架，不能假稱端到端流程已通過。
- `#363`：前端基礎，提供單一 React application、路由／拆包及開發伺服器整合。
- `inspection-planning`：Task 可見範圍、Task 詳情與開始端點；新增清單 API 是該規格既有業務資料的查詢入口，不新增 Task 欄位。
- `state-machines`、`authentication`、`domain-model`、`api-conventions`：狀態、Session、權限及 API 共用契約依其凍結內容。若實作需要更動共用規格或登記表的其他責任區，另開任務，不在本工作單擴寫。
- `#381`：端到端演示流程；此為驗證情境，不改寫 Field 的資料或業務範圍。

## 並行分組

同一波以互不重疊檔案為前提；若前端路由／入口屬共用檔案，依 [共用檔案規則](../README.md#parallel) 由單一任務變更。

- 第 1 波：T1 後端清單 API；T2 前端 Field 清單骨架（fixture），分別由後端與前端責任區實作。兩者先共同確認 response contract，避免對同一檔案並行修改。
- 第 2 波：T3 任務詳情；T5 區網與裝置 HTTPS 手動驗收，可在不同檔案責任區並行。
- 第 3 波：T4 開始查核串接；依賴 T3 與開始端點可用。
- 第 4 波：T6 全流程 E2E；依賴 T1～T4。

## 風險

- 0.4.x 尚未提供跨專案任務列表：先固定前端契約與 fake response；API 未就緒時，真實整合 AC 保持未驗證，不能用畫面測試代替 API 驗收。
- Task 指派是建議而非排他權限。查詢預設與「專案全部可查核」切換必須只改變清單篩選，開始權限仍由後端依同專案 `inspection_task.inspect` 覆核。
- 登入 Cookie 帶 `Secure`；HTTP localhost 不適用 Safari 登入。iPhone／iPad 區網測試要使用 HTTPS、含區網 IP 的憑證及裝置端根憑證信任；CA 私鑰不得離開開發機。
- Task 詳情含 Evidence requirement 的快照描述，但 Evidence／Result 實體仍受各自階段規格限制。Field 只讀需求，不得提前實作照片上傳、結果輸入或完成動作。
- 「今日」目前無對應 Task 日期欄位，故先視為現場工作清單入口；新增排程日期需走需求裁定。

## 驗證（Proof）

| AC | 驗證方式 |
|---|---|
| FUI-AC01 | API 整合測試涵蓋兩專案、指派／未指派／草稿／無權限 Task；前端測試驗證預設與切換列表。 |
| FUI-AC02 | API 測試建立跨多頁且排序鍵相同時間的資料，逐頁取完並檢查 UUID cursor 無重複／遺漏及登入者篩選。 |
| FUI-AC03 | 詳情頁測試以包含照片與量測需求的 Snapshot response 驗證呈現，並確認請求只讀且沒有 Evidence／Result 寫入呼叫。 |
| FUI-AC04 | API 與前端整合測試由非指派但有權限的使用者開始 `PENDING` Task，檢查狀態與實際操作者。 |
| FUI-AC05 | API 測試對進行中、完成、取消、封存 Task 執行開始請求；前端測試確認按鈕顯示條件。 |
| FUI-AC06 | 前端整合及 API 測試分別驗證 401、403 與 Session 失效；讀取失敗不得顯示為空清單。 |
| FUI-AC07 | 瀏覽器 viewport／觸控操作驗收涵蓋手機與平板寬度；人工檢查畫面無 PR-10 禁止內容。 |
| FUI-AC08 | 依 repo #231 iPhone／iPad HTTPS 步驟，以同一區網實機 Safari 登入；檢查憑證 SAN、Secure Cookie 與 API proxy。 |
| FUI-AC09 | 前端 route-based chunk 檢查確認 Field route 不載入 Admin chunk；線上流程以網路 API 完成，不測試或宣稱離線同步。 |

## 考慮過但沒採用的做法

- 另建 Field 前端專案：不採用，`OQ-21` 已裁定維持單一 React application，除非未來 PWA 需要獨立發布週期再評估拆分。
- 讓指派成為唯一可執行人：不採用，違反 [STM-R11](../state-machines/spec.md#需求)；指派只影響清單預設篩選。
