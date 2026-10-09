# 完成驗證（completion-validation）：實作計畫

**規格**：[spec.md](spec.md)

計畫記錄「為什麼這樣拆」。實作中發現更好的拆法就直接更新本檔（屬於「計畫調整」）；進度看 issue，不在這裡打勾。

規格由「撰寫規格」的 PR 合併後才算已凍結；本計畫隨同一個 PR 提交，供負責人審查拆法。task issue 在規格合併後依本表逐一開立，「Issue」欄先填 `#?`。本規格依賴 `field-evidence`（[PR #545](https://github.com/speko-tw/inspect-flow/pull/545)）的覆蓋計算、照片管線與 `has_result` 定義；下表的「FEV T<n>」指該計畫的任務，該 PR 合併前，這些依賴只是預定接點。

## 任務

先做後端資料與契約，再做兩個畫面。畫面屬重大新畫面，依[原型關卡](../README.md#ui-prototype-gate)，T7 的原型與試用腳本經負責人親手操作核可後，T8、T9 才開工。

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T0 | 共用規格同步（只改文件）：`domain-model` 的 `Result` 草稿條目改指向本規格；`state-machines` 的 STM-R10、STM-AC08 與 Task 表的完成與更正說明改為引用本規格；`inspection-planning` 的 `:complete` 介面列、IP-R08／IP-AC09 的 0.7.x 說明、`has_result`（含結果）與 Task 回應新增三個欄位；`audit-log` 事件目錄登記兩個事件；`admin-dashboard` 計畫 T8 的依賴欄指向本計畫 T3；`field-evidence` 依 CMV-Q8 對齊（覆蓋計算、`has_result`、`Evidence` 種類、已取消任務恢復時的照片作廢、FEV-Q3 改由本規格承接）。各檔只改自己負責的段落。 | `docs/specs/domain-model/spec.md`、`docs/specs/state-machines/spec.md`、`docs/specs/inspection-planning/spec.md`、`docs/specs/audit-log/spec.md`、`docs/specs/admin-dashboard/plan.md`、`docs/specs/field-evidence/spec.md`、`docs/specs/field-evidence/plan.md` | 本規格合併；[PR #545](https://github.com/speko-tw/inspect-flow/pull/545) 合併；[#538](https://github.com/speko-tw/inspect-flow/issues/538) 的規格 PR 合併（它正在改 `domain-model`、`audit-log` 等同檔，後合併者先 rebase） | 無（文件一致性；不新增 AC） | #? |
| T1 | 結果資料表與權限登記：`inspection_results`、`result_measurements` 與 migration（含 `outcome`／`severity` 的 `CHECK`、同任務同項次最多一筆有效結果的唯一約束）；登記 `inspection_result.read`、`inspection_result.follow_up`、`inspection_task.correct`；migration 不改既有 Task 與 Plan 的狀態 | `backend/app/models/inspection_results.py`（新增）、`backend/app/models/__init__.py`、新增 Alembic migration、`backend/app/permission_codes.py`、`backend/tests/db/test_inspection_results.py`（新增）、`backend/tests/db/test_migrations.py`、`backend/tests/contract/test_permission_codes.py` | 本規格合併（實體以本規格為準，不等 T0） | CMV-AC23、AC24（遷移不改既有資料）、AC05（代碼登記） | #? |
| T2 | 作答寫入與讀取 API：`PUT` 結果（規則驗證、`revision` 衝突、狀態矩陣、權限、實際操作者）、現場作答表、內業結果、作廢結果清單；錯誤碼與請求上限登記；結果寫入同交易維護 `item_status` 並在項目補查完成時清除待重查旗標 | `backend/app/api/v1/inspection_results.py`（新增）、`backend/app/services/inspection_results.py`（新增）、`backend/app/api/errors.py`（只加錯誤碼）、`backend/app/api/limits.py`（只加欄位上限）、`backend/app/main.py`（只加一行路由註冊）、`backend/tests/api/test_results_write.py`（新增）、`backend/tests/api/test_results_read.py`（新增）、`backend/tests/api/test_results_query_counts.py`（新增）、`backend/tests/contract/test_route_access.py` | T1；[field-ui](../field-ui/plan.md) T1（Field 安全詳情與 DRAFT 隱藏契約） | CMV-AC01～AC07、AC23（讀回追溯）、AC24（進行中任務補結果） | #? |
| T3 | 完成驗證 service 與完成端點：依目前快照核實判定、欄位規則與待重查，沿用 `field-evidence` 覆蓋計算核實照片（不適用豁免）；`:complete` 失敗回全部缺項、成功同交易寫入完成者與時間並重算 Plan；完成預檢端點與完成共用同一函式；Plan 與 Task 取鎖；Task 回應新增 `has_defects` | `backend/app/services/completion_validation.py`（新增）、`backend/app/api/v1/completion_validation.py`（新增）、`backend/app/services/inspection_planning.py`（只動 `complete_inspection_task`）、`backend/app/api/v1/inspection_planning.py`（完成路由與 Task 摘要新增 `has_defects`）、`backend/app/main.py`（只加一行路由註冊）、`backend/tests/api/test_completion_validation.py`（新增）、`backend/tests/api/test_inspection_planning_api.py`（補完成與旗標）、`backend/tests/api/test_planning_query_counts.py`（確認查詢數不隨任務與結果數成長）、`backend/tests/contract/test_route_access.py` | T2；FEV T3（覆蓋計算 service 函式） | CMV-AC08～AC12、AC25、AC32 | #? |
| T4 | 標準變更連動：KD-55 選「要」時同一交易作廢被修改項目的有效結果（含其改善登記）、已取消任務恢復時作廢、`has_result` 含結果與有效照片、待重查標記改依 `has_result`；作廢結果不計入覆蓋與 `has_defects` | `backend/app/services/inspection_planning.py`（只動作廢連動、恢復與待重查標記相關函式）、`backend/app/services/inspection_results.py`（只加作廢函式）、`backend/app/api/v1/inspection_planning.py`（`has_result` 與項目影響列表）、`backend/tests/api/test_results_voiding.py`（新增）、`backend/tests/api/test_inspection_planning_api.py`（補作廢與 `has_result`） | T3（同改 `inspection_planning.py`，須在其後）；FEV T5（同改作廢連動與 `has_result`，須在其後） | CMV-AC21、AC22 | #? |
| T5 | 完成後更正：`task_corrections` 與 migration、更正結果文字與實測值、更正照片註記、取代現場版（沿用 FEV 上傳驗證）、更正紀錄清單、`inspection_task.corrected` 稽核事件；更正不離開完成狀態 | `backend/app/models/task_corrections.py`（新增）、`backend/app/models/__init__.py`、新增 Alembic migration、`backend/app/api/v1/result_corrections.py`（新增）、`backend/app/services/result_corrections.py`（新增）、`backend/app/services/audit.py`（登記事件）、`backend/app/main.py`（只加一行路由註冊）、`backend/tests/api/test_result_corrections.py`（新增）、`backend/tests/db/test_task_corrections.py`（新增）、`backend/tests/contract/test_route_access.py`、`backend/tests/contract/test_multipart_conventions.py`（補現場版取代端點） | T3；FEV T2、T5（上傳驗證函式與照片狀態規則）；T0 已登記事件 | CMV-AC13～AC16、AC26（更正事件）、AC15 | #? |
| T6 | 簡易改善追蹤：`result_follow_ups` 與 migration（並在 `evidence` 新增可空的 `result_id`、`follow_up_id`）、改善照片兩步上傳、登記複查、歷史清單、改善狀態與 Task 回應新增 `defect_count`、`improved_count`、照片清單預設排除改善照片、`inspection_result.follow_up_registered` 稽核事件 | `backend/app/models/result_follow_ups.py`（新增）、`backend/app/models/evidence.py`（只加兩個欄位）、`backend/app/models/__init__.py`、新增 Alembic migration、`backend/app/api/v1/result_follow_ups.py`（新增）、`backend/app/services/result_follow_ups.py`（新增）、`backend/app/services/evidence_queries.py`（只加預設排除改善照片的條件）、`backend/app/services/audit.py`（登記事件）、`backend/app/api/v1/inspection_planning.py`（Task 摘要新增兩個計數）、`backend/app/main.py`（只加一行路由註冊）、`backend/tests/api/test_result_follow_ups.py`（新增）、`backend/tests/db/test_result_follow_ups.py`（新增）、`backend/tests/api/test_planning_query_counts.py`、`backend/tests/contract/test_route_access.py` | T4（同改 `inspection_planning.py` API 檔）、T5（migration 鏈與 `audit.py`，須在其後）；FEV T2、T3、T5 | CMV-AC17～AC20、AC19、AC26（改善事件）、AC21（改善登記隨作廢保留） | #? |
| T7 | 【人工關卡】現場作答與內業結果檢視的可點互動原型與試用腳本，先與顧問討論並以「好用、業界常見、不易犯錯」評選方案，負責人親手操作核可；腳本涵蓋一次一個項次填寫、結果依賴欄位、缺項提示、完成確認、完成後更正、內業登記複查、手機與鍵盤操作 | `docs/specs/completion-validation/ui-field-prototype.html`、`docs/specs/completion-validation/ui-office-prototype.html`（新增）；試用腳本寫入本檔「UI 原型與試用腳本」段 | 本規格合併 | 無（取得核可後 CMV-AC27～AC30 的畫面細節才定案） | #? |
| T8 | 現場作答 UI：結果區與進度、一次一個項次的填寫畫面、依結果出現的欄位、欄位錯誤對應與聚焦、儲存並到下一項、離開提示、完成確認與缺項提示、完成後唯讀與更正入口、「有缺失」標示；接真實 API | `frontend/src/field/results/`（新增）、`frontend/src/field/TaskDetail.tsx`（加入結果區）、`frontend/src/field/api.ts`、`frontend/src/ui/statusBadge.ts`（新增「有缺失」標示）、`frontend/src/ui/ConfirmBox.tsx`（只沿用，不改）、`frontend/src/styles.css`（只加本畫面樣式）、前端測試 | T7 核可；T2、T3、T5（真 API）；FEV T7（`TaskDetail.tsx` 與 `styles.css` 由其先合併）；[field-ui](../field-ui/plan.md) T3、T4 | CMV-AC27～AC29、AC31（現場）、AC33 | #? |
| T9 | 內業結果頁籤：依查核項目分組的結果與改善狀態、篩選、作廢結果、更正紀錄、登記複查（含改善照片上傳）、清單與 Plan 頁的「有缺失」與改善計數；接真實 API | `frontend/src/admin/results/`（新增）、`frontend/src/admin/planning/PlanningPage.tsx`（只加「有缺失」標示與結果頁籤入口，依 #363 的內業任務頁檔案責任安排）、`frontend/src/App.tsx`（只加一行路由）、`frontend/src/styles.css`（只加本畫面樣式）、前端測試 | T7 核可；T3、T5、T6（真 API）；FEV T8（內業照片頁籤）；#363（內業任務頁）；T8 先合併 `styles.css` 與 `statusBadge.ts` 後 rebase | CMV-AC30、AC31（內業）、AC33 | #? |
| T10 | 真後端走查與示範資料：SQLite 真後端、Vite、無頭瀏覽器從登入開始只靠點擊走完「現場逐項次填寫 → 缺項被擋 → 補齊完成 → 內業登記複查 → 完成後更正 → 內業改標準選『要』重查 → 補查再完成」，保存桌面與 360px 淺色模式截圖；為 #381 的 demo 補結果與改善示範資料；重跑 AC01～AC33 彙整證據 | 走查腳本與截圖放置位置依 #381 實際責任區（`demo/`）；後端 seed；不改產品程式碼 | T1～T9 | CMV-AC01～AC33（彙整）；重點 AC27～AC33 | #? |

- 每個任務一個 PR 就能完成，並能單獨驗收；T0 與 T7 沒有產品程式碼。
- 每個任務至少對應一條 AC；每條 AC 至少被一個任務涵蓋（AC01～AC33 的覆蓋見上表，T10 為總驗收）。
- 跨規格依賴寫 issue 編號或 PR 編號；T1～T6 的後端任務完成條件含真實後端契約測試，不以前端 mock 代替（[RG-M22](../../review-guidelines.md)）。
- 全部任務合併後，把本規格改為「已完成」並更新索引，`admin-dashboard` 計畫 T8 依 [KD-66](../../intents/03-decisions-and-stack.md#kd-66) 切換完成數與完成率（最後一個任務的 PR 內一併修改；T10 沒有產品程式碼時另開收尾 task）。

## 並行分組

依「改動的檔案」分波；同一波內的任務檔案不重疊。碰到[共用檔案](../README.md#parallel)的任務已在表中注明。

- 第 1 波：T0（文件，等 #545 與 #538 規格 PR；只動各規格文件）、T1（資料表，新增一支 migration）、T7（原型，人工關卡，可與後端並行）。
- 第 2 波：T2（作答 API，需 T1）。
- 第 3 波：T3（完成驗證，需 T2 與 FEV T3；會動 `inspection_planning.py`，不與 T4 同波）。
- 第 4 波：T4（標準變更連動，需 T3 與 FEV T5）、T5（完成後更正，新增一支 migration，需 T3 與 FEV T2、T5）、T8（現場 UI，需 T7 核可與 FEV T7）。T4 與 T5 的檔案不重疊（T5 只新增檔案與各加一行路由、登記事件）；兩者與 T8 分屬後端與前端。
- 第 5 波：T6（改善追蹤，新增一支 migration，需 T4 與 T5 先合併）。
- 第 6 波：T9（內業 UI，需 T6、T8 與 FEV T8）。
- 第 7 波：T10（真後端走查）。

## 風險

- **與 `field-evidence` 的接點**：T3、T5、T6 依賴 FEV 的覆蓋計算、上傳驗證函式與 `Evidence` 資料表。PR #545 在審查中可能調整這些細節；CMV-Q8 列出的六個對齊點若有變，T3、T5、T6 與 T0 同步調整。覆蓋計算只能有一份，T3 不得複製。
- **完成與作答並行**：完成驗證與結果寫入都要取 Plan 與 Task 的鎖（沿用既有鎖定做法），否則會出現「驗證通過後才被改壞」或「完成後才有結果寫入」。T2、T3 必須有並行請求測試，SQLite 與 PostgreSQL 的鎖行為都要驗證（`make check-postgres`）。
- **預檢與完成漂移**：預檢是給畫面用的唯讀提示，完成才是權威。兩者共用同一個驗證函式並有測試斷言結果一致，避免畫面說可完成、伺服器卻拒絕。
- **對目前快照重新驗證**：完成驗證讀目前快照；KD-55 選「不要」的更正若改動項次或實測欄位集合，舊結果可能不再合法。T3 以 `result_invalid` 缺項呈現並以測試覆蓋（AC08），不默默放行。
- **作廢連動漏掉結果或改善登記**：KD-55 的作廢發生在 `inspection-planning` 的同一交易；T4 必須有「中途失敗全部回滾」的測試，並確認 `has_result` 含結果與照片，否則重查說明會寫錯、待重查旗標漏標。
- **共用檔案多任務輪流改**：`inspection_planning.py`（服務與 API 兩個檔案）會被 T3、T4、T6 與 FEV T5 依序修改，只在各自的函式內動；後合併者先 rebase，不手動合併衝突。
- **migration 鏈**：T1、T5、T6 各新增一支 migration；T5 與 T6 分屬不同波，後合併者把 `down_revision` 改接到最新 head，不留多個 head。T6 修改 FEV T1 建立的 `evidence`，須在 FEV T1 合併後。
- **查詢數成長**：結果聚合、`has_defects` 與改善計數會出現在清單與 Plan 詳情，容易 N+1。T2、T3、T6 以查詢數測試確認不隨結果與任務數成長。
- **舊資料**：migration 不改既有 Task 與 Plan 的狀態；已完成任務沒有逐項結果，畫面與 API 要處理「空結果的已完成任務」（AC24）。進行中的舊任務完成時會因缺結果被擋，這是預期行為，發版前需在發布說明提醒。
- **孤兒檔案**：改善照片先上傳、後掛到登記，可能留下沒掛上的照片。MVP 以唯讀檢查指令列出，不自動清除（保存期限隨專案，[KD-62](../../intents/03-decisions-and-stack.md#kd-62)）。
- **UI 複雜度**：一次一個項次的流程在手機上容易漏存、迷路。原型關卡必須走過「漏填、離開未儲存、被擋後跳回缺項、多人同時改同一項次」；T8 在 iPhone 實機驗證（沿用 [FUI-AC11](../field-ui/spec.md#驗收條件) 的區網 HTTPS 流程）。
- **權限模型變動**：#538 把權限改成兩層。本規格只引用專案角色動作代碼；兩層判斷落地後，T2～T6 的存取宣告改用新入口，AC05、AC16、AC20 的人員矩陣要補「未開通模組」案例，該案例由 #538 規格負責定義。
- **範圍蔓延**：改善追蹤只是簡易版。審查時檢查不得出現期限、逾期、通知、自動判定的欄位或畫面控制項（AC18）。
- **零項次項目**：若 `template-system` 允許查核項目沒有項次，完成驗證對它視為無需作答（CMV-Q7）；是否應在建立任務時擋下，屬其他規格。
- **未裁定議題**：[OQ-07](../../intents/05-open-questions.md#oq-07)（報告如何呈現結果）屬 0.8.x，本計畫不實作任何報告端行為。

## UI 原型與試用腳本

T7 完成時，於此段補上負責人核可的試用腳本（逐步編號列出，不用表格），並連到兩份原型。腳本至少涵蓋：

1. 現場開始任務，進入一個項次：看標準、填數字與文字實測值，選符合並儲存到下一項。
2. 選不符合：確認嚴重度與註解此時才出現，故意不填就儲存，確認錯誤在欄位旁、焦點移過去。
3. 選不適用：只出現原因欄；量不到實測值時改選不適用。
4. 填到一半離開，確認有未儲存提示；另開裝置修改同一個項次，確認衝突提示並保留自己的草稿。
5. 還有項次沒填就按完成查核：確認缺項列表、一鍵跳到第一個缺項、照片不足的項次有提示。
6. 全部填好後完成：確認頁內說明（不能重開、只能更正錯字與照片、有 n 項不符合會標示「有缺失」），完成後畫面唯讀。
7. 完成後更正：改註解、實測值、照片註記、換現場版，確認更正前的說明與更正紀錄。
8. 內業開啟結果頁籤：依項目看結果、篩選不符合與待改善、對不符合項次登記複查（已改善必須附照片）、查看更正紀錄與作廢結果。
9. 內業改專案標準選「要」重查，回現場看到該項目需要補查。
10. 以上全部在 360px 手機與鍵盤各走一次。

## 驗證（Proof）

所有 API、權限與端對端 AC 以真實後端驗證；mock 限單元或元件呈現測試。UI 驗收保存桌面與 360px 淺色模式截圖。

| AC | 驗證方式 |
|---|---|
| CMV-AC01 | `backend/tests/api/test_results_write.py`：只寫一個項次，其餘為空；缺少或非法 `outcome` 回 422 且資料不變 |
| CMV-AC02 | `test_results_write.py`：結果與必填欄位的組合矩陣（符合、不符合三種嚴重度、不適用）與 `error.details.fields` |
| CMV-AC03 | `test_results_write.py`：實測值必填、數字格式、單位不可帶、超出與在標準範圍內都照選；`backend/tests/db/test_inspection_results.py` 確認值以字串保存 |
| CMV-AC04 | `test_results_write.py` 與 `test_results_read.py`：各 Task 狀態與封存 Plan 的狀態矩陣；被拒絕時資料不變 |
| CMV-AC05 | `test_results_write.py`、`test_results_read.py`、`test_completion_validation.py`：U1～U4 與 Admin 矩陣；`test_route_access.py` 驗證存取層級宣告；`test_permission_codes.py` 驗證三個新代碼已登記 |
| CMV-AC06 | `test_results_write.py`：實際操作者、版本號衝突、並行建立（SQLite 與 PostgreSQL 各跑一次，`make check-postgres`） |
| CMV-AC07 | `test_results_read.py`：作答表與內業結構、作廢清單分頁；`test_results_query_counts.py` 驗證查詢數不隨項次數成長 |
| CMV-AC08 | `backend/tests/api/test_completion_validation.py`：缺判定、結果對目前快照不合法、待重查，一次回全部缺項且資料不變 |
| CMV-AC09 | `test_completion_validation.py`：`min_count` 為 1 與 2、不適用豁免、總覽、已刪除、已作廢；斷言覆蓋數與 FEV 覆蓋函式一致 |
| CMV-AC10 | `test_completion_validation.py`：帶自報欄位的完成請求無效、預檢與完成缺項一致且預檢不改資料 |
| CMV-AC11 | `test_completion_validation.py` 與 `test_inspection_planning_api.py`：含三種嚴重度仍可完成、Plan 自動完成、三個欄位值 |
| CMV-AC12 | `test_completion_validation.py`：作廢結果不計入；資料表沒有 `has_defects` 儲存欄位 |
| CMV-AC13 | `backend/tests/api/test_result_corrections.py`：更正註解、原因、文字與數字實測值，任務維持完成，紀錄可查 |
| CMV-AC14 | `test_result_corrections.py`：註記更正、取代現場版（儲存只有兩個檔案、內業版重設、非法與雜湊不符不留檔案） |
| CMV-AC15 | `test_result_corrections.py`：帶結果或嚴重度被拒、無結果項次、新增刪除照片被鎖、取消被拒；`test_route_access.py` 與路由清單檢查沒有重開端點；`IN_PROGRESS` 使用更正端點被拒 |
| CMV-AC16 | `test_result_corrections.py`：U1～U4 與 Admin 矩陣、已取消與封存 Plan、更正紀錄讀取 |
| CMV-AC17 | `backend/tests/api/test_result_follow_ups.py`：三次登記、只增不改、最新一筆決定狀態、原結果與完成不變 |
| CMV-AC18 | `test_result_follow_ups.py`：照片與說明規則、目標不合法、回應與資料表沒有期限或通知欄位；改善照片不計入覆蓋數 |
| CMV-AC19 | `test_result_follow_ups.py` 與 `test_planning_query_counts.py`：三個計數在 Task、清單、Plan 詳情一致；查詢數不隨任務數成長 |
| CMV-AC20 | `test_result_follow_ups.py`：權限與狀態矩陣 |
| CMV-AC21 | `backend/tests/api/test_results_voiding.py` 與 `test_inspection_planning_api.py`：選「要」同交易作廢結果與改善登記、Y 項目不變、Task 與 Plan 退回、補查清除旗標、中途失敗回滾 |
| CMV-AC22 | `test_results_voiding.py`：選「不要」不變、只有結果沒照片也標待重查、已取消任務恢復時作廢、`has_result` 含結果與照片 |
| CMV-AC23 | `backend/tests/db/test_inspection_results.py`：追溯查詢、唯一約束；`test_completion_validation.py` 修改範本與專案副本後驗證結果不變 |
| CMV-AC24 | `backend/tests/db/test_migrations.py`：升級前已完成與進行中的 Task 狀態不變；`test_results_read.py` 空結構；`test_completion_validation.py` 進行中舊任務須補齊 |
| CMV-AC25 | `test_completion_validation.py` 與 `backend/tests/contract/test_route_access.py`：只有 `:complete` 能令 Task 成為已完成；通用更新端點拒絕寫狀態；儀表板切換由 `admin-dashboard` T8 驗收 |
| CMV-AC26 | `test_result_corrections.py`、`test_result_follow_ups.py`：兩個事件的內容與交易回滾；事件目錄測試確認已登記 |
| CMV-AC27 | 前端元件測試加無頭瀏覽器在 360、390、768 px 驗證觸控目標、無水平捲動、依賴欄位、必填標示、錯誤聚焦、離開提示、鍵盤路徑與無技術資訊；保存截圖 |
| CMV-AC28 | 前端元件測試加無頭瀏覽器：完成確認說明的 n 取自預檢、缺項列表與跳到缺項、輸入保留、完成後唯讀與「有缺失」；真後端驗證 422 的 `problems` 被正確對應 |
| CMV-AC29 | 前端元件測試加無頭瀏覽器：更正入口與說明、可改欄位範圍、結果與嚴重度不可改、不具權限者無入口；iPhone 實機走一次現場流程（AC27～AC29） |
| CMV-AC30 | 前端元件測試加無頭瀏覽器在桌面與 360px 驗證分組、篩選、作廢標示、登記複查的欄位錯誤與計數更新、未儲存提示、沒有限期與通知控制項；保存截圖 |
| CMV-AC31 | 以真實後端的前端契約測試：填寫、讀回、預檢、完成、更正、登記複查被後端接受並能讀回，缺項與欄位錯誤正確對應；不使用 mock 回應 |
| CMV-AC32 | `test_completion_validation.py`：完成與作答並行請求序列化，SQLite 與 PostgreSQL 各跑一次 |
| CMV-AC33 | 前端測試斷言任務清單、現場詳情、內業結果頁與 Plan 頁都走 `statusBadge` 的「有缺失」標示；真後端走查截圖 |

## 考慮過但沒採用的做法

- **完成時由前端送「結果快照」或「已齊全」給後端**：不採用，違反 [PR-01](../../intents/02-principles.md#pr-01)；前端只做提示，完成端點不讀任何自報內容。
- **在伺服器保存半成品結果（草稿）**：不採用。每次儲存即驗證讓資料庫的結果永遠合法；草稿只留在前端，離開前提示（符合 MVP 不做離線與草稿持久化）。
- **把結果存成 Task 上的一個 JSON**：不採用，結果需要作廢、聚合（有缺失、改善計數）、追溯與唯一約束，用資料表才能查詢與驗證。
- **改善追蹤做成流程（指派、期限、逾期、通知、自動判定）**：不採用，[KD-65](../../intents/03-decisions-and-stack.md#kd-65) 明定只做簡易登記。
- **完成後允許更正結果與嚴重度、或重開任務**：不採用，更正結果等於推翻查核，重查一律走 KD-55；見 CMV-Q1。
- **把「有缺失」存成 Task 狀態或欄位**：不採用，[STM-R10](../state-machines/spec.md#需求) 定為旗標，由有效結果即時推導才不會不同步。
- **改善照片另建獨立資料表、只存一版**：不採用，重用 `Evidence` 的兩版模型與上傳管線才符合 [PR-05](../../intents/02-principles.md#pr-05)，也少維護一套驗證。
- **不適用項次也要求照片覆蓋**：不採用，[KD-54](../../intents/03-decisions-and-stack.md#kd-54) 明定不適用時照片選填。
- **依標準值自動判定符合與否**：不採用，[KD-37](../../intents/03-decisions-and-stack.md#kd-37)、[KD-65](../../intents/03-decisions-and-stack.md#kd-65)。
