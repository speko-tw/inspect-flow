# 現場照片佐證（field-evidence）：實作計畫

**規格**：[spec.md](spec.md)

計畫記錄「為什麼這樣拆」。實作中發現更好的拆法就直接更新本檔（屬於「計畫調整」）；進度看 issue，不在這裡打勾。

規格由「撰寫規格」的 PR 合併後才算已凍結；本計畫隨同一個 PR 提交，供負責人審查拆法。task issue 在規格合併後依本表逐一開立，「Issue」欄先填 `#?`。

## 任務

先做後端資料與契約，再做兩個畫面。畫面屬重大新畫面，依[原型關卡](../README.md#ui-prototype-gate)，T6 的原型與試用腳本經負責人親手操作核可後，T7、T8 才開工。

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T0 | 共用規格同步（只改文件）：`domain-model` 的 `Evidence`、`Evidence Variant` 條目改指向本規格；`inspection-planning` 修正「受 G-05 阻擋」的舊說明，並依 FEV-Q6 澄清 `has_result` 含照片、依 FEV-Q3 對齊 IP-R08；`intents/README.md` 第 3 條「編輯只能產生新版本」的舊說明改為兩版模型。各檔只改自己負責的段落。 | `docs/specs/domain-model/spec.md`、`docs/specs/inspection-planning/spec.md`、`docs/intents/README.md` | 本規格合併；[#538](https://github.com/speko-tw/inspect-flow/issues/538) 的規格 PR 合併（它正在改 `domain-model` 等同檔，後合併者先 rebase） | 無（文件一致性；不新增 AC） | #? |
| T1 | 資料表與儲存基礎：`evidence`、`evidence_variants`、`evidence_point_links` 與 migration；`Storage` 抽象介面與本機實作；設定（儲存位置、單檔上限、解碼像素上限）與 `.env.example`；登記 `evidence.read`、`evidence.manage`；加入影像處理套件 | `backend/app/models/evidence.py`、`backend/app/models/__init__.py`、新增 Alembic migration、`backend/app/storage/`（新增）、`backend/app/permission_codes.py`、`backend/pyproject.toml`、`backend/uv.lock`、`.env.example`、`backend/tests/db/`、`backend/tests/storage/`（新增）、`backend/tests/contract/test_permission_codes.py` | 本規格合併；本任務的 lockfile 規則見風險（不等 T0，實體以本規格為準） | FEV-AC01（儲存與資料表）、FEV-AC07（設定可調）、FEV-AC19 | #? |
| T2 | 上傳 API：multipart、冪等鍵、`sha256` 核對、大小與 JPEG 驗證、同一交易寫入現場版與初版內業版、失敗清理檔案；任務狀態、權限與 DRAFT 隱藏；錯誤碼登記；請求上限登記 | `backend/app/api/v1/evidence.py`（新增）、`backend/app/services/evidence.py`（新增）、`backend/app/services/evidence_images.py`（新增）、`backend/app/api/errors.py`（只加錯誤碼）、`backend/app/api/limits.py`（只加註記上限）、`backend/app/main.py`（只加一行路由註冊）、`backend/tests/api/test_evidence_upload.py`（新增）、`backend/tests/contract/test_route_access.py`、`backend/tests/contract/test_multipart_conventions.py`（補真實端點驗證，API-AC06） | T1；[field-ui](../field-ui/plan.md) T1（Field 安全詳情與 DRAFT 隱藏契約） | FEV-AC01、AC05～AC09、AC12（上傳部分）、AC13（上傳部分）、AC06（寫入） | #? |
| T3 | 讀取 API：現場覆蓋狀態與現場清單、內業清單與詳情、圖片串流與即時縮圖；覆蓋計算寫成可被 0.7.x 沿用的 service 函式 | `backend/app/api/v1/evidence_read.py`（新增）、`backend/app/services/evidence_queries.py`（新增）、`backend/app/main.py`（只加一行路由註冊）、`backend/tests/api/test_evidence_read.py`（新增）、`backend/tests/api/test_evidence_query_counts.py`（新增）、`backend/tests/contract/test_route_access.py` | T2 | FEV-AC04、AC06（讀取）、AC13、AC19、AC20 | #? |
| T4 | 內業版編修 API：以參數從現場版重新產生、新檔寫入後切換並刪舊檔、預設參數等同重設 | `backend/app/api/v1/evidence_office.py`（新增）、`backend/app/services/evidence_office.py`（新增）、`backend/app/main.py`（只加一行路由註冊）、`backend/tests/api/test_evidence_office.py`（新增）、`backend/tests/contract/test_route_access.py` | T2 | FEV-AC02、AC06（編修後註記不變）、AC13（編修權限） | #? |
| T5 | 修改註記與對應、軟刪除、`evidence.photo_deleted`／`photo_updated`／`office_version_edited` 稽核寫入、刪除守門（完成後、作廢、核發報告引用的檢查註冊點）、KD-55 作廢連動與 `has_result` 含照片、取消與封存唯讀 | `backend/app/api/v1/evidence.py`、`backend/app/services/evidence.py`、`backend/app/services/evidence_office.py`（只補稽核呼叫）、`backend/app/services/inspection_planning.py`（作廢連動與 `has_result`，只動本規格相關函式）、`backend/app/services/audit.py`（登記事件）、`docs/specs/audit-log/spec.md`（只新增本規格專屬事件區段，沿用既有規格的登記做法）、`backend/tests/api/test_evidence_mutations.py`（新增）、`backend/tests/api/test_inspection_planning_api.py`（補作廢與 `has_result`）、`backend/tests/api/test_planning_query_counts.py`（確認查詢數不隨照片成長） | T3、T4（同改 `evidence.py` 與 `evidence_office.py`，須在其後）；#538 的規格 PR 已合併（同改 `audit-log` 規格） | FEV-AC12（其餘狀態）、AC13、AC14～AC18、AC21、AC26（後端） | #? |
| T6 | 【人工關卡】現場拍照編修與內業照片頁的可點互動原型與試用腳本，先與顧問討論並以「好用、業界常見、不易犯錯」評選方案，負責人親手操作核可；腳本涵蓋拍照、編修、選項次與註記、失敗重送、修改、刪除、內業編修、手機與鍵盤操作 | `docs/specs/field-evidence/ui-field-prototype.html`、`docs/specs/field-evidence/ui-office-prototype.html`（新增）；試用腳本寫入本檔「UI 原型與試用腳本」段 | 本規格合併 | 無（取得核可後 FEV-AC22、AC23 的畫面細節才定案） | #? |
| T7 | 現場拍照與編修 UI：相機擷取、前端影像編修（縮放平移預覽、旋轉、裁切、亮度、重設）、壓縮、項次與註記選擇、上傳狀態清單、自動重試與手動重送、冪等鍵、修改與刪除入口、離開提示；接真實 API | `frontend/src/field/evidence/`（新增）、`frontend/src/field/TaskDetail.tsx`（加入照片區）、`frontend/src/field/api.ts`、`frontend/src/ui/ConfirmBox.tsx`（只沿用，不改）、`frontend/src/styles.css`（只加本畫面樣式）、前端測試 | T6 核可；T2、T3、T5（真 API）；[field-ui](../field-ui/plan.md) T3、T4 | FEV-AC03、AC10、AC11、AC22、AC24（現場部分）、AC06（畫面） | #? |
| T8 | 內業照片頁：依查核項目分組、現場版與內業版比較、作廢與已刪除篩選、內業版編修與頁內確認、刪除；接真實 API | `frontend/src/admin/evidence/`（新增）、`frontend/src/App.tsx`（只加一行路由）、內業任務頁的照片頁籤入口（依 `inspection-planning` #363 的內業任務頁檔案責任安排）、`frontend/src/styles.css`（只加本畫面樣式）、前端測試 | T6 核可；T3、T4、T5（真 API）；#363（內業任務頁）；T7 先合併 `styles.css` 後 rebase | FEV-AC23、AC24（內業部分） | #? |
| T9 | v0.3.1 走查補充：確認「已完成」標籤在現場清單、現場詳情與內業計畫頁都走 `statusBadge` 的 `badge-success`，不一致處修正；重查說明文字依 `has_result`（含照片）顯示 | `frontend/src/ui/statusBadge.ts`（必要時）、現場與內業計畫頁中直接寫狀態樣式的元件、`frontend/src/admin/projectItems/ProjectItemChangePage.tsx`、前端測試 | T5（`has_result` 含照片）；T7 | FEV-AC25、AC26 | #? |
| T10 | 真後端走查與示範資料：SQLite 真後端、Vite、無頭瀏覽器從登入開始只靠點擊走完「現場拍照上傳 → 內業編修 → 內業改標準選要重查 → 補拍」，保存桌面與 360px 淺色模式截圖；為 #381 的 demo 補照片示範資料；重跑 AC01～AC26 彙整證據 | 走查腳本與截圖放置位置依 #381 實際責任區（`demo/`）；後端 seed；不改產品程式碼 | T1～T9 | FEV-AC01～AC26（彙整）；重點 AC22～AC26 | #? |

- 每個任務一個 PR 就能完成，並能單獨驗收；T0 與 T6 沒有產品程式碼。
- 每個任務至少對應一條 AC；每條 AC 至少被一個任務涵蓋（AC01～AC26 的覆蓋見上表，T10 為總驗收）。
- 跨規格依賴寫 issue 編號；T1～T5 的後端任務完成條件含真實後端契約測試，不以前端 mock 代替（[RG-M22](../../review-guidelines.md)）。
- 全部任務合併後，把本規格改為「已完成」並更新索引（最後一個任務的 PR 內一併修改；T10 沒有產品程式碼時另開收尾 task）。

## 並行分組

依「改動的檔案」分波；同一波內的任務檔案不重疊。碰到[共用檔案](../README.md#parallel)的任務已在表中注明。

- 第 1 波：T0（文件，等 #538 規格 PR；只動 `domain-model`、`inspection-planning`、`intents/README.md`）、T1（後端基礎）、T6（原型，人工關卡，可與後端並行）。
- 第 2 波：T2（上傳 API）。
- 第 3 波：T3（讀取）與 T4（內業編修）：兩者各用獨立模組檔，只在 `main.py` 各加一行路由註冊，後合併者 rebase。
- 第 4 波：T5（修改、刪除、稽核與作廢連動，會再改 `evidence.py`、`evidence_office.py`，不能與 T3、T4 同波）；T7（現場 UI，需 T6 核可）。
- 第 5 波：T8（內業 UI，需 T7 先合併 `styles.css`）、T9。
- 第 6 波：T10（真後端走查）。

## 風險

- **lockfile 與影像套件**：T1 新增影像處理套件會動 `uv.lock`，依共用檔案規則先合併，其他分支再 rebase 並重新產生，不手動合併衝突。
- **migration 鏈**：T1 是唯一新增 migration 的任務（一個 PR 最多一支）；若 T5 需要補欄位，改在 T1 一併設計，或待 T1 合併後新增並接到最新 head。
- **同步產生內業版拖慢上傳**：照片已由前端壓縮，後端只複製位元組並驗證可解碼，成本低；編修時才重新編碼。試用若顯示過慢，依 FEV-Q10 評估非同步。T3 的圖片串流與即時縮圖（`max_edge`）會吃 CPU，需快取標頭與合理的 `max_edge` 上限，並在 T3 以測試確認。
- **孤兒檔案**：先寫檔、後寫資料庫；程序在兩步之間當掉會留下孤兒檔。MVP 以失敗時清理為主，T1 提供可列出「儲存有檔、資料庫無記錄」的檢查指令（只讀）供維運。
- **預覽與後端結果不一致**：內業編修預覽在前端、結果由後端產生。亮度公式與處理順序在規格固定，AC02 以尺寸與雜湊驗證，T8 另在走查中目視比對。
- **iOS Safari 相機與記憶體**：大張照片在畫布編修可能吃記憶體；壓縮前先縮到上限長邊，T7 在 iPhone 實機驗證（沿用 [FUI-AC11](../field-ui/spec.md#驗收條件) 的區網 HTTPS 流程）。
- **冪等與並行**：`(task_id, upload_key)` 唯一約束是並行安全的依據；T2 必須有並行請求測試，且兩種資料庫（SQLite、PostgreSQL）的唯一衝突處理都要驗證。
- **作廢連動漏掉照片**：KD-55 的作廢發生在 `inspection-planning` 的同一交易；T5 必須有「中途失敗全部回滾」的測試，並確認 `has_result` 含照片，否則重查說明會寫錯（FEV-R20）。
- **權限模型變動**：#538 把權限改成兩層。本規格只引用專案角色動作代碼；兩層判斷落地後，T2～T5 的存取宣告改用新入口，AC13 的人員矩陣要補「未開通模組」案例，該案例由 #538 規格負責定義。
- **0.7.x 銜接**：完成驗證沿用 T3 的覆蓋 service 函式，不得另寫第二份計算；完成後的現場版與註記更正由 0.7.x 負責（FEV-Q3）。
- **未裁定議題**：[OQ-19](../../intents/05-open-questions.md#oq-19) 與 G-04 餘項屬 0.8.x，本計畫不實作任何報告端行為。

## UI 原型與試用腳本

T6 完成時，於此段補上負責人核可的試用腳本（逐步編號列出，不用表格），並連到兩份原型。腳本至少涵蓋：

1. 現場拍照、縮放平移、旋轉、裁切、亮度、重設、確認。
2. 勾選同時佐證兩個項次、標為總覽、加註記、上傳。
3. 中斷網路造成失敗、自動重試後手動重送、放棄上傳的確認。
4. 修改已上傳照片的說明與項次、刪除並確認。
5. 內業開啟照片頁、比較兩版、編修內業版並確認套用、未儲存離開的提示。
6. 內業改標準選「要」重查，回現場看到補拍提示。
7. 以上全部在 360px 手機與鍵盤各走一次。

## 驗證（Proof）

所有 API、權限與端對端 AC 以真實後端驗證；mock 限單元或元件呈現測試。UI 驗收保存桌面與 360px 淺色模式截圖。

| AC | 驗證方式 |
|---|---|
| FEV-AC01 | `backend/tests/api/test_evidence_upload.py`：上傳後查資料庫只有一筆 `evidence`、兩筆 `evidence_variants`，儲存只多兩個檔案、儲存鍵為 UUID、schema 沒有 BLOB 欄位、回應不含儲存鍵；`backend/tests/db/` 檢查資料表約束；`backend/tests/storage/` 檢查儲存抽象介面 |
| FEV-AC02 | `backend/tests/api/test_evidence_office.py`：連續編修與重設，驗證檔案數、現場版雜湊不變、輸出尺寸、重設後雜湊、舊檔移除、非法參數 422 與內業版不變 |
| FEV-AC03 | 前端元件測試驗證編修狀態與輸出參數；無頭瀏覽器在真實 Vite 驗證縮放平移、旋轉、裁切、亮度、重設與確認後的上傳內容；人工檢查沒有對比、標註等控制項；檢查上傳前後沒有原圖寫入持久儲存 |
| FEV-AC04 | `backend/tests/api/test_evidence_read.py`：逐步上傳並讀覆蓋狀態，涵蓋 `min_count` 為 2、跨項次共用、總覽不計、一百張以上 |
| FEV-AC05 | `test_evidence_upload.py`：四種不合法對應皆 422 且無記錄與檔案 |
| FEV-AC06 | `test_evidence_upload.py`、`test_evidence_read.py`、`test_evidence_office.py`：註記經兩種視圖一致、編修內業版後不變、超長 422 |
| FEV-AC07 | `test_evidence_upload.py`：上限內外、非 JPEG、毀損、超過像素上限、調整設定值；逐一檢查無記錄與孤兒檔，413 在串流中拒收 |
| FEV-AC08 | `test_evidence_upload.py`：雜湊不符 422，相符時資料庫雜湊正確 |
| FEV-AC09 | `test_evidence_upload.py`：重複、不同內容、他人同鍵、並行請求、刪除後重放、任務狀態改變後重放；SQLite 與 PostgreSQL 各跑一次（`make check-postgres`） |
| FEV-AC10 | 前端測試以可控的失敗回應驗證自動重試次數、退避間隔與手動重送沿用同一鍵；真後端以故障注入代理驗證只有一筆照片；4xx 不重試 |
| FEV-AC11 | 檢查 production build 沒有 Service Worker 註冊；測試待上傳照片不寫入 IndexedDB 與 localStorage；離線情境失敗訊息與照片保留 |
| FEV-AC12 | `test_evidence_upload.py` 與 `test_evidence_mutations.py`：各 Task 狀態與封存 Plan 的狀態矩陣；被拒絕時資料不變 |
| FEV-AC13 | `test_evidence_upload.py`、`test_evidence_read.py`、`test_evidence_office.py`、`test_evidence_mutations.py`：U1～U5 與 Admin 矩陣；`test_route_access.py` 驗證存取層級宣告；回應不含儲存鍵、圖片需登入 |
| FEV-AC14 | `test_evidence_mutations.py`：非拍照者 403、拍照者與內業刪除成功，檢查軟刪除、檔案保留、稽核、覆蓋數與清單 |
| FEV-AC15 | `test_evidence_mutations.py`：完成、作廢、報告引用（測試替身註冊檢查）、已刪除四種鎖定與 `reason` |
| FEV-AC16 | `test_inspection_planning_api.py` 與 `test_evidence_mutations.py`：選「要」同交易作廢整個項目的照片、其他項目不變、內業可查、中途失敗回滾 |
| FEV-AC17 | 同上：選「不要」照片與對應不變 |
| FEV-AC18 | `test_evidence_mutations.py`：取消期間唯讀、恢復後可寫 |
| FEV-AC19 | `backend/tests/db/` 追溯查詢測試：內業版到現場版到 Evidence、項目明細與快照修訂、Task、Plan、Project；雜湊與編修參數已保存 |
| FEV-AC20 | `test_evidence_read.py`：跨頁排序、無重複遺漏、`limit` 預設與上限；`test_evidence_query_counts.py` 驗證查詢數不隨張數成長 |
| FEV-AC21 | `test_evidence_mutations.py`：三個事件的內容與交易回滾；T5 在 `audit-log` 事件目錄登記本規格區段並以既有的事件目錄測試確認 |
| FEV-AC22 | 前端元件測試加無頭瀏覽器在 360、390、768 px 驗證觸控目標、無水平捲動、無技術資訊、欄位錯誤聚焦、頁內確認、離開提示與鍵盤路徑；iPhone 實機走一次；保存截圖 |
| FEV-AC23 | 前端元件測試加無頭瀏覽器在桌面與 360px 驗證分組、標示、篩選、比較、編修確認、未儲存提示；保存截圖 |
| FEV-AC24 | 以真實後端的前端契約測試：前端送出的上傳、修改、刪除、編修被接受並能讀回；不使用 mock 回應 |
| FEV-AC25 | 前端測試斷言三處都使用 `statusBadge` 的 `COMPLETED` 與 `badge-success`；真後端走查把任務走到已完成並截圖 |
| FEV-AC26 | `ProjectItemChangePage.test.tsx` 斷言兩種情境的白話說明；後端測試斷言 `has_result` 在有有效照片時為真；真後端走查截圖 |

## 考慮過但沒採用的做法

- **保存原圖並以版本系譜記錄每次編輯**（原 KD-04）：已被 [KD-32](../../intents/03-decisions-and-stack.md#kd-32) 取代，只保存現場版與內業版。
- **非同步產生內業版（背景工作）**：不採用。同步產生讓一筆照片永遠是完整兩版，也不用多出「產製中」「產製失敗」狀態；試用顯示過慢時再依 FEV-Q10 評估。
- **前端直接產生內業版**：不採用，[KD-61](../../intents/03-decisions-and-stack.md#kd-61) 已決定由後端依編修操作產生，讓報告用圖一致且可追溯。
- **離線佇列與重新連線同步**：不採用，MVP 為 Online-first（[KD-61](../../intents/03-decisions-and-stack.md#kd-61)、[KD-63](../../intents/03-decisions-and-stack.md#kd-63)）。
- **保存縮圖**：不採用，縮圖會變成第三個保存的圖片；改為讀取時即時縮放。
- **每次內業編修在原內業版上累積處理**：不採用，反覆壓縮會累積畫質損失；改為每次由現場版重新產生。
- **把覆蓋達標只放在前端判斷**：不採用，覆蓋計算在後端，0.7.x 完成驗證沿用同一份計算。
- **自建即時取景相機**：不採用，MVP 用裝置相機的網頁檔案選擇，iOS 最可靠；日後再評估。
