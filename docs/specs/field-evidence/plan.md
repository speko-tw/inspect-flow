# 現場照片佐證（field-evidence）：實作計畫

**規格**：[spec.md](spec.md)

計畫記錄「為什麼這樣拆」。實作中發現更好的拆法就直接更新本檔（屬於「計畫調整」）；進度看 issue，不在這裡打勾。

規格由「撰寫規格」的 PR 合併後才算已凍結；本計畫隨同一個 PR 提交，供負責人審查拆法。原六項待負責人裁定（spec 的 FEV-Q1、Q6、Q12～Q15）已於 2026-10-10 裁定並寫入規格。仍待定的只有工程標示的欄位內容（[#588](https://github.com/speko-tw/inspect-flow/issues/588)，T2 先以「預設不加標示」的規則機制實作）。T5 依賴 `inspection-planning` 的 IP-R04、IP-R07、IP-R13、IP-R14 與 `has_result` 定義已合併（隨 `completion-validation` 規格一起合併）。task issue 在規格合併後依本表逐一開立，「Issue」欄先填 `#?`。

## 任務

先做後端資料與契約，再做兩個畫面。畫面屬重大新畫面，依[原型關卡](../README.md#ui-prototype-gate)，T6 的原型與試用腳本經負責人親手操作核可後，T7、T8 才開工。

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T0 | 意圖文件同步（只改文件）：`docs/intents/README.md` 第 3 條「編輯只能產生新版本」的舊說明改為兩版模型（意圖文件，另依 AGENTS.md 的規則處理）；確認 `completion-validation` 規格已合併，使 `inspection-planning` 的 IP-R04、IP-R07、IP-R13、IP-R14 與 `has_result` 定義生效。`field-ui`（FUI-R05、FUI-R08）、`domain-model`、`state-machines` 與 `docs/intents/04-glossary.md` 已隨本規格的 PR 依負責人直接指示同步，不再另開任務 | `docs/intents/README.md` | 本規格合併；`completion-validation` 規格合併 | 無（文件一致性；不新增 AC） | #? |
| T1 | 資料表與儲存基礎：`evidence`、`evidence_variants`、`evidence_point_links` 與 migration；`Storage` 抽象介面與本機實作；設定（儲存位置、單檔上限、解碼像素上限）與 `.env.example`；登記 `evidence.read`、`evidence.manage`（屬查核模組，`external_allowed` 依 DOM-R35）；存取分類：`evidence.manage` 是內業碼；`evidence.read` 在 #576 合併前的過渡期（分類表只把 `inspection_task.inspect` 與單獨的 `inspection_task.read` 排除在內業之外）要先加進分類表、比照 `inspection_task.read` 歸既非內業也非現場，#576 合併後依唯讀碼規則，移除這個暫時例外；預建角色初始內容：專案工程師含 `evidence.read`、`evidence.manage`，現場工程師不含 `evidence.read`，專案查閱人員含 `evidence.read`；`evidence` 加上傳者身分快照欄位；加入影像處理套件 | `backend/app/models/evidence.py`、`backend/app/models/__init__.py`、新增 Alembic migration、`backend/app/storage/`（新增）、`backend/app/permission_codes.py`、`backend/app/services/access_summary.py`（只加分類）、`backend/tests/api/test_access_summary.py`、`backend/pyproject.toml`、`backend/uv.lock`、`.env.example`、`backend/tests/db/`、`backend/tests/storage/`（新增）、`backend/tests/contract/test_permission_codes.py` | 本規格合併；[#576](https://github.com/speko-tw/inspect-flow/issues/576)（authentication 任務 P：模組權限存取層級與兩層檢查，存取分類依其規則）；`completion-validation` T1（兩個任務共改 `permission_codes.py` 與 migration 鏈，`completion-validation` T1 先做，本任務的 migration 接在其後）；身分快照的格式與寫入函式依 [#550](https://github.com/speko-tw/inspect-flow/issues/550)（未合併時先以同欄位結構實作並於 #550 對齊）；本任務的 lockfile 規則見風險（不等 T0，實體以本規格為準） | FEV-AC01（儲存與資料表）、FEV-AC07（設定可調）、FEV-AC19 | #? |
| T2 | 上傳 API：multipart、冪等鍵與請求指紋、`sha256` 核對、大小與 JPEG 驗證、鎖定 Task 項目明細並重驗快照修訂、同一交易寫入現場版與初版內業版（內業版依標示規則寫入工程標示，預設不加標示；含中文字型）、失敗清理檔案；依檢查順序處理任務狀態、權限與 DRAFT 隱藏；錯誤碼登記；請求上限登記 | `backend/app/api/v1/evidence.py`（新增）、`backend/app/services/evidence.py`（新增）、`backend/app/services/evidence_images.py`（新增）、`backend/app/services/evidence_labels.py`（新增，標示規則與繪製）、`backend/app/assets/fonts/`（新增，隨後端打包的中文字型與授權說明）、`backend/tests/services/test_evidence_labels.py`（新增）、`backend/app/api/errors.py`（只加錯誤碼）、`backend/app/api/limits.py`（只加註記上限）、`backend/app/main.py`（只加一行路由註冊）、`backend/tests/api/test_evidence_upload.py`（新增）、`backend/tests/contract/test_route_access.py`（本規格的存取層級宣告只由 T2 登記一次）、`backend/tests/contract/test_multipart_conventions.py`（補真實端點驗證，API-AC06）、`backend/tests/contract/test_error_envelope.py`（`evidence.*` 錯誤碼加入 `ErrorCode` 後，把本規格與計畫加入 `ALLOWED_CODE_MENTIONS`，沿用 `template-system` 的先例，否則「不得另有手寫錯誤碼表」的檢查會因 Markdown 表格列出現錯誤碼而失敗） | T1；[field-ui](../field-ui/plan.md) T1（Field 安全詳情與 DRAFT 隱藏契約） | FEV-AC01、AC05～AC09、AC12（上傳部分）、AC13（上傳部分）、AC06（寫入）、AC28（上傳側）、AC29（`captured_at`）、AC30（工程標示） | #? |
| T3 | 讀取 API：現場覆蓋狀態與現場清單、內業清單與詳情、圖片串流與即時縮圖；已刪除與已作廢照片的讀取行為；覆蓋計算寫成可被 0.7.x 沿用的 service 函式 | `backend/app/api/v1/evidence_read.py`（新增）、`backend/app/services/evidence_queries.py`（新增）、`backend/app/main.py`（只加一行路由註冊）、`backend/tests/api/test_evidence_read.py`（新增）、`backend/tests/api/test_evidence_query_counts.py`（新增）、`backend/tests/contract/test_evidence_read_access.py`（新增，不改 `test_route_access.py`） | T2 | FEV-AC04、AC06（讀取）、AC13、AC19、AC20、AC29（讀取與 `max_edge`） | #? |
| T4 | 內業版編修 API：以參數從現場版重新產生、新檔寫入後切換並刪舊檔、預設參數等同重設、回應依呼叫者權限；編修後重新寫入工程標示；標示規則改變時重新產生內業版的維運指令（沿用編修參數，跳過被核發報告引用的照片，每張寫稽核事件） | `backend/app/api/v1/evidence_office.py`（新增）、`backend/app/services/evidence_office.py`（新增）、`backend/app/cli/regenerate_office_versions.py`（新增，維運指令；實際位置依既有指令慣例）、`backend/app/main.py`（只加一行路由註冊）、`backend/tests/api/test_evidence_office.py`（新增）、`backend/tests/contract/test_evidence_office_access.py`（新增，不改 `test_route_access.py`） | T2 | FEV-AC02、AC06（編修後註記不變）、AC13（編修權限）、AC29（編修回應）、AC30（編修後標示仍在）、AC31（重新產生） | #? |
| T5 | 修改註記與對應、軟刪除、三個稽核事件（`photo_deleted`、`office_version_edited` 每次都寫，`photo_updated` 只記有變動，皆填 `project_id`）、刪除守門（完成後、作廢、核發報告引用的檢查註冊點）、KD-55 作廢連動（被修改的項目；只有照片也作廢）與 `has_result`（納入有效照片）、已取消 Task 恢復時作廢、點位穩定身分與相關規則（IP-R13：PATCH 保留點位與實測欄位 `id`；選「不要」時不接受增減項次或實測欄位，也不接受變更既有欄位類型；選「要」時被刪除的點位隨項目作廢。PATCH 身分與結構鎖已由 #595 完成，作廢連動仍屬本任務。IP-R14：PATCH 擋下零項次已由 #595 完成；建立 Task 擋下零項次仍屬本任務）、取消與封存唯讀、上傳與作廢並行的鎖定 | `backend/app/api/v1/evidence.py`、`backend/app/services/evidence.py`、`backend/app/services/evidence_office.py`（只補稽核呼叫）、`backend/app/api/v1/inspection_planning.py`（PATCH 點位保留 `id`、`:restore` 路徑）、`backend/app/api/errors.py`（`structure_locked`、`points_required`）、`frontend/src/admin/projectItems/api.ts`、`ProjectItemChangePage.tsx` 與對應測試、`backend/tests/db/test_project_item_edit_concurrency.py`（PostgreSQL 項次互換）、`backend/app/services/inspection_planning.py`（作廢連動、恢復時作廢與 `has_result`，只動本規格相關函式）、`backend/app/services/inspection_planning_snapshots.py`（快照點位對應與作廢）、`backend/app/services/audit.py`（登記事件）、`docs/specs/audit-log/spec.md`（只新增本規格專屬事件區段，沿用既有規格的登記做法）、`backend/tests/api/test_evidence_mutations.py`（新增）、`backend/tests/api/test_inspection_planning_api.py`（補作廢、恢復與 `has_result`）、`backend/tests/api/test_planning_query_counts.py`（確認查詢數不隨照片成長） | T3、T4（同改 `evidence.py` 與 `evidence_office.py`，須在其後）；**`completion-validation` 規格已合併**（`inspection-planning` 的 IP-R04、IP-R07、IP-R13、IP-R14 與 `has_result` 定義）；#538 的規格 PR 已合併（同改 `audit-log` 規格） | FEV-AC12（其餘狀態）、AC13、AC14～AC18、AC21、AC26（後端）、AC27、AC28、AC29（`PATCH`、刪除與讀取行為） | #? |
| T6 | 【人工關卡】現場拍照編修與內業照片頁的可點互動原型與試用腳本，先與顧問討論並以「好用、業界常見、不易犯錯」評選方案，負責人親手操作核可；腳本涵蓋拍照、編修、選項次與註記、失敗重送、修改、刪除、內業編修、手機與鍵盤操作；內業照片頁另做出工程標示的兩種版面（疊在照片上、延伸畫布另加標示區）給負責人比較並定案（標示欄位內容待 [#588](https://github.com/speko-tw/inspect-flow/issues/588)，原型先用示意文字） | `docs/specs/field-evidence/ui-field-prototype.html`、`docs/specs/field-evidence/ui-office-prototype.html`（新增）；試用腳本寫入本檔「UI 原型與試用腳本」段 | 本規格合併 | 無（取得核可後 FEV-AC22、AC23 的畫面細節才定案） | #? |
| T7 | 現場拍照與編修 UI：相機擷取、前端影像編修（縮放平移預覽、旋轉、裁切、亮度、重設）、壓縮、項次與註記選擇、上傳狀態清單、自動重試與手動重送、冪等鍵、修改與刪除入口、離開提示；接真實 API | `frontend/src/field/evidence/`（新增）、`frontend/src/field/TaskDetail.tsx`（加入照片區）、`frontend/src/field/api.ts`、`frontend/src/ui/ConfirmBox.tsx`（只沿用，不改）、`frontend/src/styles.css`（只加本畫面樣式）、前端測試 | T6 核可；T2、T3、T5（真 API，故在 T5 之後）；[field-ui](../field-ui/plan.md) T3、T4 | FEV-AC03、AC10、AC11、AC22、AC24（現場部分）、AC06（畫面） | #? |
| T8 | 內業照片頁：依查核項目分組、現場版與內業版比較、作廢與已刪除篩選、內業版編修與頁內確認、刪除；接真實 API | `frontend/src/admin/evidence/`（新增）、`frontend/src/App.tsx`（只加一行路由）、內業任務頁的照片頁籤入口（`frontend/src/admin/planning/PlanningPage.tsx`，依 `inspection-planning` #363 的檔案責任安排）、`frontend/src/styles.css`（只加本畫面樣式）、前端測試 | T6 核可；T3、T4、T5（真 API）；#363（內業任務頁）；T7 先合併 `styles.css` 後 rebase | FEV-AC23、AC24（內業部分） | #? |
| T9 | v0.3.1 走查補充：確認「已完成」標籤在現場任務詳情與內業計畫頁都走 `statusBadge` 的 `badge-success`，不一致處修正（現場清單的「近期已完成」區由 `field-ui` T1、T2 實作，本任務只驗收該區的標籤顏色）；重查說明文字依 `has_result` 顯示 | `frontend/src/ui/statusBadge.ts`（必要時）、現場詳情與內業計畫頁中直接寫狀態樣式的元件、`frontend/src/admin/projectItems/ProjectItemChangePage.tsx`、前端測試 | T5（`has_result`）；T7；T8 先合併（兩者都動內業任務頁，不同波）；`field-ui` T1、T2（近期已完成區） | FEV-AC25、AC26 | #? |
| T10 | 真後端走查與示範資料：SQLite 真後端、Vite、無頭瀏覽器從登入開始只靠點擊走完「現場拍照上傳 → 內業編修 → 內業改標準選要重查 → 補拍」，保存桌面與 360px 淺色模式截圖；為 #381 的 demo 補照片示範資料；重跑 AC01～AC31 彙整證據 | 走查腳本與截圖放置位置依 #381 實際責任區（`demo/`）；後端 seed；不改產品程式碼 | T1～T9 | FEV-AC01～AC31（彙整）；重點 AC22～AC31 | #? |

- 每個任務一個 PR 就能完成，並能單獨驗收；T0 與 T6 沒有產品程式碼。
- 每個任務至少對應一條 AC；每條 AC 至少被一個任務涵蓋（AC01～AC31 的覆蓋見上表，T10 為總驗收）。
- 跨規格依賴寫 issue 編號；T1～T5 的後端任務完成條件含真實後端契約測試，不以前端 mock 代替（[RG-M22](../../review-guidelines.md)）。
- 全部任務合併後，把本規格改為「已完成」並更新索引（最後一個任務的 PR 內一併修改；T10 沒有產品程式碼時另開收尾 task）。

## 並行分組

依「改動的檔案」分波；同一波內的任務檔案不重疊。碰到[共用檔案](../README.md#parallel)的任務已在表中注明。

- 第 1 波：T0（文件，只動 `intents/README.md`）、T1（後端基礎）、T6（原型，人工關卡，可與後端並行）。
- 第 2 波：T2（上傳 API）。
- 第 3 波：T3（讀取）與 T4（內業編修）：兩者各用獨立模組與各自新增的存取測試檔，只在 `main.py` 各加一行路由註冊，後合併者 rebase；`test_route_access.py` 只由 T2 改。
- 第 4 波：T5（修改、刪除、稽核、作廢連動與點位身分，會再改 `evidence.py`、`evidence_office.py`，不能與 T3、T4 同波；需 `completion-validation` 規格已合併）。
- 第 5 波：T7（現場 UI，需 T6 核可與 T5 的真 API）。
- 第 6 波：T8（內業 UI，需 T7 先合併 `styles.css`）。
- 第 7 波：T9（標籤與重查文字，與 T8 同改內業任務頁，不同波）。
- 第 8 波：T10（真後端走查）。

## 風險

- **錯誤碼對照表檢查**：`test_no_hand_written_error_code_table_exists` 會掃描已追蹤的文件，Markdown 表格列只要含 `ErrorCode` 成員就會被判為手寫對照表。本規格的錯誤碼段已改為條列、AC 表避免直接寫既有共用錯誤碼；`evidence.*` 進入 `ErrorCode` 的 T2 必須同步調整允許清單。
- **lockfile 與影像套件**：T1 新增影像處理套件會動 `uv.lock`，依共用檔案規則先合併，其他分支再 rebase 並重新產生，不手動合併衝突。
- **migration 鏈**：T1 是唯一新增 migration 的任務（一個 PR 最多一支）；若 T5 需要補欄位，改在 T1 一併設計，或待 T1 合併後新增並接到最新 head。
- **同步產生內業版拖慢上傳**：照片已由前端壓縮，標示規則未啟用時後端只複製位元組並驗證可解碼，成本低；啟用工程標示或編修時才重新編碼並繪製標示，成本較高，T2 要量測。試用若顯示過慢，依 FEV-Q10 評估非同步。T3 的圖片串流與即時縮圖（`max_edge`）會吃 CPU，需快取標頭與合理的 `max_edge` 上限，並在 T3 以測試確認。
- **孤兒檔案**：先寫檔、後寫資料庫；程序在兩步之間當掉會留下孤兒檔。MVP 以失敗時清理為主，T1 提供可列出「儲存有檔、資料庫無記錄」的檢查指令（只讀）供維運。
- **預覽與後端結果不一致**：內業編修預覽在前端、結果由後端產生。亮度公式與處理順序在規格固定，AC02 以尺寸與雜湊驗證，T8 另在走查中目視比對。
- **iOS Safari 相機與記憶體**：大張照片在畫布編修可能吃記憶體；壓縮前先縮到上限長邊，T7 在 iPhone 實機驗證（沿用 [FUI-AC11](../field-ui/spec.md#驗收條件) 的區網 HTTPS 流程）。
- **冪等與並行**：`(task_id, upload_key)` 唯一約束是並行安全的依據，請求指紋（含註記與項次）避免重送時新欄位被靜默忽略；T2 必須有並行請求測試，且兩種資料庫（SQLite、PostgreSQL）的唯一衝突處理與項目明細鎖定都要驗證。
- **作廢連動漏掉照片或誤作廢**：KD-55 的作廢發生在 `inspection-planning` 的同一交易，作廢對象是被修改的項目而非整個 Task；T5 必須有「中途失敗全部回滾」、「上傳與作廢並行」（AC28）與「已取消 Task 恢復時作廢」（AC27）的測試，並處理 `has_result`（納入有效照片），否則重查說明會寫錯（FEV-R20）。
- **權限模型變動**：#538 把權限改成兩層。本規格只引用專案角色動作代碼；兩層判斷落地後，T2～T5 的存取宣告改用新入口，AC13 的人員矩陣要補「未開通模組」案例，該案例由 #538 規格負責定義。
- **0.7.x 銜接**：完成驗證沿用 T3 的覆蓋 service 函式，不得另寫第二份計算；完成後的現場版與註記更正由 0.7.x 負責（FEV-Q3）。
- **工程標示的中文字型**：標示由伺服器端寫進影像像素，需要中文字型。字型必須隨後端一起打包提交（開源授權，授權文字與來源放在 `backend/app/assets/fonts/`），不得依賴主機或容器剛好安裝的字型，否則開發機、CI 與試用主機畫出的標示會不同；CJK 字型檔偏大（數 MB 到十幾 MB），要評估 repo 大小與是否只放子集；繪製須是確定性的（同一輸入與規則得到相同位元組），測試才能用雜湊比對與判斷是否需要重新產生；要有「缺字」測試（含繁體中文與常用符號）。影像處理套件的文字繪製能力與字型授權在 T1 評估套件時一併確認。
- **標示內容與版面未定**：標示欄位待 [#588](https://github.com/speko-tw/inspect-flow/issues/588)；T2 先做規則機制，預設不加標示，欄位定案後只改規則與測試。疊在照片上或延伸畫布另加標示區要在原型（T6）給負責人看；兩種版面對「內業版尺寸、編修後裁切、報表並排」的影響要在原型時一併說明。標示中的拍攝時間由手機提供、不一定可信，欄位定案時要決定是否採用。
- **身分快照依賴 #550**：照片的拍照者是上傳者的身分快照，格式與寫入函式屬 [#550](https://github.com/speko-tw/inspect-flow/issues/550)；#550 未合併前，T1 先以同欄位結構實作，合併後對齊，避免兩處各存一份。
- **跨規格依賴**：`inspection-planning` 的修改（IP-R04、IP-R07、IP-R13、IP-R14、`has_result`）放在 `completion-validation` 的規格 PR，避免兩個 PR 改同一份凍結規格；T5 必須等它合併。兩個 PR 都改 `docs/specs/README.md` 規格索引相鄰的兩列，後合併者要先 rebase。
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
| FEV-AC03 | 前端元件測試驗證編修狀態與輸出參數；無頭瀏覽器在真實 Vite 驗證縮放平移、旋轉、裁切、亮度、重設與確認後的上傳內容；人工檢查沒有對比、標註等控制項；檢查上傳前後應用程式沒有把原圖寫入 IndexedDB、localStorage 或 Cache API |
| FEV-AC04 | `backend/tests/api/test_evidence_read.py`：逐步上傳並讀覆蓋狀態，涵蓋 `min_count` 為 2、跨項次共用、總覽不計、一百張以上 |
| FEV-AC05 | `test_evidence_upload.py`：四種不合法對應皆 422 且無記錄與檔案 |
| FEV-AC06 | `test_evidence_upload.py`、`test_evidence_read.py`、`test_evidence_office.py`：註記經兩種視圖一致、編修內業版後不變、超長 422 |
| FEV-AC07 | `test_evidence_upload.py`：上限內外、非 JPEG、毀損、超過像素上限、調整設定值；逐一檢查無記錄與孤兒檔，413 在串流中拒收 |
| FEV-AC08 | `test_evidence_upload.py`：雜湊不符 422，相符時資料庫雜湊正確 |
| FEV-AC09 | `test_evidence_upload.py`：重複、不同內容、只改註記或項次、他人同鍵、並行請求、刪除後重放、任務狀態改變後重放；SQLite 與 PostgreSQL 各跑一次（`make check-postgres`） |
| FEV-AC10 | 前端測試以可控的失敗回應驗證自動重試次數、退避間隔與手動重送沿用同一鍵；真後端以故障注入代理驗證只有一筆照片；4xx 不重試 |
| FEV-AC11 | 檢查 production build 沒有 Service Worker 註冊；測試待上傳照片不寫入 IndexedDB、localStorage 與 Cache API；離線情境失敗訊息與照片保留 |
| FEV-AC12 | `test_evidence_upload.py` 與 `test_evidence_mutations.py`：各 Task 狀態、封存 Plan 與封存加完成組合的狀態矩陣，確認檢查順序（封存優先於 Task 狀態、`COMPLETED` 刪除回 `evidence.task_locked`）且不回 `evidence.photo_locked`；被拒絕時資料不變 |
| FEV-AC13 | `test_evidence_upload.py`、`test_evidence_read.py`、`test_evidence_office.py`、`test_evidence_mutations.py`：U1～U5、U7（未開通查核模組）與 Admin 矩陣；`test_route_access.py` 驗證存取層級宣告；回應不含儲存鍵、圖片需登入 |
| FEV-AC14 | `test_evidence_mutations.py`：非拍照者 403、拍照者與內業刪除成功，檢查軟刪除、檔案保留、稽核、覆蓋數與清單 |
| FEV-AC15 | `test_evidence_mutations.py`：已作廢、報告引用（測試替身註冊檢查）、已刪除三種鎖定與 `reason`；已完成 Task 的刪除屬 AC12 的 `evidence.task_locked` |
| FEV-AC16 | `test_inspection_planning_api.py` 與 `test_evidence_mutations.py`：同交易作廢被修改項目的照片（含只有照片、尚無結果的項目）、標待重查、其他項目不變、內業可查、中途失敗回滾；確認作廢對象是項目而非整個 Task |
| FEV-AC17 | `test_inspection_planning_api.py` 與 `test_evidence_mutations.py`：以真後端的 PATCH（點位帶 `id`）驗證文字更正與重排後原照片仍對應同一項次、覆蓋數不變；增減項次或實測欄位集合回 422；選「要」時被刪除的點位連同照片作廢 |
| FEV-AC18 | `test_evidence_mutations.py`：取消期間唯讀、恢復後可寫 |
| FEV-AC19 | `backend/tests/db/` 追溯查詢測試：內業版到現場版到 Evidence、項目明細與快照修訂、Task、Plan、Project；雜湊與編修參數已保存 |
| FEV-AC20 | `test_evidence_read.py`：跨頁排序、無重複遺漏、`limit` 預設與上限；`test_evidence_query_counts.py` 驗證查詢數不隨張數成長 |
| FEV-AC21 | `test_evidence_mutations.py`：三個事件的內容、「每次都寫」與「只記有變動」差異（含同參數重送、無變動 `PATCH`）、`project_id` 已填、交易回滾；T5 在 `audit-log` 事件目錄登記本規格區段並以既有的事件目錄測試確認 |
| FEV-AC22 | 前端元件測試加無頭瀏覽器在 360、390、768 px 驗證觸控目標、無水平捲動、無技術資訊、欄位錯誤聚焦、頁內確認、離開提示與鍵盤路徑；iPhone 實機走一次；保存截圖 |
| FEV-AC23 | 前端元件測試加無頭瀏覽器在桌面與 360px 驗證分組、標示、篩選、比較、編修確認、未儲存提示；保存截圖 |
| FEV-AC24 | 以真實後端的前端契約測試：前端送出的上傳、修改、刪除、編修被接受並能讀回；不使用 mock 回應 |
| FEV-AC25 | 前端測試斷言現場詳情、現場清單「近期已完成」區與內業計畫頁都使用 `statusBadge` 的 `COMPLETED` 與 `badge-success`；真後端走查把任務走到已完成並截圖；「近期已完成」區的列表與展開行為由 FUI-AC01 驗證 |
| FEV-AC26 | `ProjectItemChangePage.test.tsx` 斷言三種情境（無照片與結果、只有照片、已有結果與照片）的白話說明；後端測試斷言 `has_result` 含有效照片與結果；真後端走查截圖 |
| FEV-AC27 | `test_inspection_planning_api.py` 與 `test_evidence_mutations.py`：已取消 Task 修改標準後，取消期間照片唯讀、恢復的同一交易才作廢並標待重查、恢復失敗時回滾 |
| FEV-AC28 | `test_evidence_upload.py` 與 `test_evidence_mutations.py`：以可控的交錯順序模擬上傳與作廢並行與舊修訂上傳，驗證 409 `evidence.requirement_changed`、無孤兒檔、無指向舊需求的有效照片；SQLite 與 PostgreSQL 各跑一次 |
| FEV-AC29 | `test_evidence_upload.py`（`captured_at`）、`test_evidence_read.py`（`max_edge`、已刪除與作廢的讀取、排序）、`test_evidence_mutations.py`（`PATCH` 部分欄位）、`test_evidence_office.py`（回應視圖） |
| FEV-AC30 | `backend/tests/services/test_evidence_labels.py` 與 `test_evidence_upload.py`、`test_evidence_office.py`：以測試用規則驗證標示寫進內業版像素（比對標示區與照片本體）、現場版無標示且雜湊不變、中文無缺字（基準圖比對）、編修後標示仍在且未被裁切、規則未啟用時內業版與現場版位元組相同、儲存仍只有兩個檔案；無頭瀏覽器目視比對內業頁的內業版 |
| FEV-AC31 | `backend/tests/api/test_evidence_office.py`（維運指令）：改變規則後重新產生，編修參數沿用、現場版不變、被引用（測試替身）者跳過、稽核事件、重複執行結果相同、舊檔移除 |

## 考慮過但沒採用的做法

- **保存原圖並以版本系譜記錄每次編輯**（原 KD-04）：已被 [KD-32](../../intents/03-decisions-and-stack.md#kd-32) 取代，只保存現場版與內業版。
- **非同步產生內業版（背景工作）**：不採用。同步產生讓一筆照片永遠是完整兩版，也不用多出「產製中」「產製失敗」狀態；試用顯示過慢時再依 FEV-Q10 評估。
- **前端直接產生內業版**：不採用，[KD-61](../../intents/03-decisions-and-stack.md#kd-61) 已決定由後端依編修操作產生，讓報告用圖一致且可追溯。
- **離線佇列與重新連線同步**：不採用，MVP 為 Online-first（[KD-61](../../intents/03-decisions-and-stack.md#kd-61)、[KD-63](../../intents/03-decisions-and-stack.md#kd-63)）。
- **保存縮圖**：不採用，縮圖會變成第三個保存的圖片；改為讀取時即時縮放。
- **每次內業編修在原內業版上累積處理**：不採用，反覆壓縮會累積畫質損失；改為每次由現場版重新產生。
- **把覆蓋達標只放在前端判斷**：不採用，覆蓋計算在後端，0.7.x 完成驗證沿用同一份計算。
- **自建即時取景相機**：不採用，MVP 用裝置相機的網頁檔案選擇，iOS 最可靠；日後再評估。
- **只把工程資訊放在報表上、不寫進內業版影像**：不採用，負責人裁定標示要寫進內業版的影像像素（像工程標示牌），報表上照片（含標示）與查核項目內容並排。
- **在現場版加標示**：不採用，現場版保留原樣，標示規則改變時才能從現場版重新產生內業版。
