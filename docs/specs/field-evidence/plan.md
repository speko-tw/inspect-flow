# 現場照片佐證（field-evidence）：實作計畫

**規格**：[spec.md](spec.md)

計畫記錄「為什麼這樣拆」。實作中發現更好的拆法就直接更新本檔（屬於「計畫調整」）；進度看 issue，不在這裡打勾。

規格由「撰寫規格」的 PR 合併後才算已凍結；本計畫隨同一個 PR 提交，供負責人審查拆法。原六項待負責人裁定（spec 的 FEV-Q1、Q6、Q12～Q15）已於 2026-10-10 裁定並寫入規格。工程標示已依 [#588 最終修正裁定](https://github.com/speko-tw/inspect-flow/issues/588#issuecomment-6231300749)定案五欄；T2 預設啟用，版面依規格設計，原型給負責人看後可調。T5 依賴 `inspection-planning` 的 IP-R04、IP-R07、IP-R13、IP-R14 與 `has_result` 定義已合併（隨 `completion-validation` 規格一起合併）。task issue 在規格合併後依本表逐一開立，「Issue」欄先填 `#?`。

目前現場照片入口在 `/tasks/:taskId`，UI 路徑依規格 ADM-R50；本計畫與規格中的 `/api/v1/...` 端點不變。

## 任務

先做後端資料與契約，再做兩個畫面。畫面屬重大新畫面，依[原型關卡](../README.md#ui-prototype-gate)，T6 的原型與試用腳本經負責人親手操作核可後，T7、T8 才開工。

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T0 | 實作前只讀核對既有意圖基準：`docs/intents/README.md` 第 3 條已由 #765 對齊兩版模型，不再重做意圖同步；確認 `completion-validation` 規格已合併，使 `inspection-planning` 的 IP-R04、IP-R07、IP-R13、IP-R14 與 `has_result` 定義生效。`field-ui`（FUI-R05、FUI-R08）、`domain-model`、`state-machines` 與 `docs/intents/04-glossary.md` 已隨本規格的 PR 依負責人直接指示同步，不再另開任務 | `docs/intents/README.md`（只讀核對） | #765 已整合；`completion-validation` 規格合併 | 無（既有前置核對；不新增 AC） | 不另開 task |
| T1 | 資料表與儲存基礎：`evidence`、`evidence_variants`、`evidence_point_links` 與 migration；`Storage` 抽象介面與本機實作；設定（儲存位置、單檔上限、解碼像素上限）與 `.env.example`；登記 `evidence.read`、`evidence.manage`（屬查核模組，`external_allowed` 依 DOM-R35）；存取分類：`evidence.manage` 是內業碼；`evidence.read` 沿用 #576 已落地的 `.read` 唯讀碼分類，不新增已不需要的過渡例外；預建角色初始內容：專案工程師含 `evidence.read`、`evidence.manage`，現場工程師不含 `evidence.read`，專案查閱人員含 `evidence.read`；`evidence` 加上傳者身分快照與 `label_source` 五欄來源 metadata；加入影像處理套件 | `backend/app/models/evidence.py`、`backend/app/models/__init__.py`、新增 Alembic migration、`backend/app/storage/`（新增）、`backend/app/permission_codes.py`（沿用登記入口）、`backend/app/permission_codes.json`（目前共用權限目錄）、`backend/app/services/default_permissions.py`（預建角色初始內容）、`backend/app/cli/check_evidence_storage.py`（唯讀孤兒檔案盤點）、`backend/app/services/access_summary.py`（只加分類）、`backend/tests/api/test_access_summary.py`、`backend/tests/api/test_roles_api.py`（完整權限目錄預期）、`backend/tests/cli/test_init_system.py`（預建角色初始內容預期）、`backend/pyproject.toml`、`backend/uv.lock`、`.env.example`、`backend/tests/db/`、`backend/tests/storage/`（新增）、`backend/tests/contract/test_permission_codes.py` | 本規格合併；[#576](https://github.com/speko-tw/inspect-flow/issues/576)（authentication 任務 P：模組權限存取層級與兩層檢查，存取分類依其規則）；本任務先於 `completion-validation` T1（0.6.x 先發布，照片 migration 先落地；0.7.x 的結果 migration 接在其後，兩者共用權限目錄依序整合）；身分快照的格式與寫入函式依 [#550](https://github.com/speko-tw/inspect-flow/issues/550)（未合併時先以同欄位結構實作並於 #550 對齊）；本任務的 lockfile 規則見風險（不等 T0，實體以本規格為準） | FEV-AC01（儲存與資料表）、FEV-AC07（設定可調）、FEV-AC19、AC32（來源欄位） | #790 |
| T2 | 上傳 API 與圖層資料：只接受現場旋轉／亮度摘要及 layer 開關／四角，拒絕現場精細參數；冪等指紋含正規化 layer；同交易固定五欄來源、圖層資料與兩版，FIELD 乾淨、OFFICE 依圖層合成。新增 label_layer 欄位的 migration 屬本任務，不修改 T1／PR #800。保留 multipart、雜湊、大小、JPEG、快照鎖定、權限、失敗清理、字型／缺字、錯誤碼與上限登記。上傳容納不足依中→小尺寸嘗試；仍不足也保存兩版及原圖層設定，OFFICE 不合成並保存 `label_rule.render_state`／`effective_size`／`base_size`。未知鍵／型別／列舉與幾何錯誤分流；上傳不得因幾何容納回 422。亮度倍率固定 `1 + v/200`。| `backend/app/api/v1/evidence.py`（新增）、`backend/app/services/evidence.py`（新增）、`backend/app/services/evidence_images.py`（新增）、`backend/app/services/evidence_labels.py`（新增，標示規則與繪製）、`backend/app/assets/fonts/`（新增，隨後端打包的中文字型與授權說明）、`backend/tests/services/test_evidence_labels.py`（新增）、`backend/app/api/errors.py`（只加錯誤碼）、`backend/app/api/limits.py`（只加註記上限）、`backend/app/main.py`（只加一行路由註冊）、`backend/tests/api/test_evidence_upload.py`（新增）、`backend/tests/contract/test_route_access.py`（本規格的存取層級宣告只由 T2 登記一次）、`backend/tests/contract/test_multipart_conventions.py`（補真實端點驗證，API-AC06）、`backend/tests/contract/test_error_envelope.py`（`evidence.*` 錯誤碼加入 `ErrorCode` 後，把本規格與計畫加入 `ALLOWED_CODE_MENTIONS`，沿用 `template-system` 的先例，否則「不得另有手寫錯誤碼表」的檢查會因 Markdown 表格列出現錯誤碼而失敗）、`backend/app/models/evidence.py`（只加 `label_layer`）、新增一支 Alembic migration（接 T1 最新 head）、`backend/tests/db/test_evidence_layer.py`（新增） 首次與改善上傳、更正取代的新 FIELD 初版共用 spec 的通用容納規則；初版實際尺寸初始化基準。0.7.x 流程仍以來源契約單元驗證，實際 CMV 流程接上後重驗。 | T1；[field-ui](../field-ui/plan.md) T1（Field 安全詳情與 DRAFT 隱藏契約） | FEV-AC01、AC05～AC09、AC12（上傳部分）、AC13（上傳部分）、AC06（寫入）、AC28（上傳側）、AC29（`captured_at`）、AC30（工程標示）、AC32（來源／時區／缺值）、AC33（窄圖與缺字）、AC34（來源分支單元）、AC35（現場設定與非法鍵） | #791 |
| T3 | 讀取 API：現場覆蓋狀態與現場清單、內業清單與詳情、圖片串流與即時縮圖；已刪除與已作廢照片的讀取行為；覆蓋計算寫成可被 0.7.x 沿用的 service 函式；現場清單與內業清單、詳情回傳 `layer` 完整設定、`labels` 與 `layer_render`，供編修／縮圖預覽；內業詳情另回 `has_layer_overrides` 與分頁 `layer_history`（操作者、UTC 時間、具名 layer／labels 完整前後值）。歷程依照片／Task／專案篩選，專案內具 evidence.read 的非 Admin 也可讀，不呼叫 ALG-R22 全域稽核 API；跨照片／專案 cursor 不得洩漏。T3 實作讀取，T4／T5 接入寫入後再完成整合驗收。| `backend/app/api/v1/evidence_read.py`（新增）、`backend/app/services/evidence_queries.py`（新增）、`backend/app/main.py`（只加一行路由註冊）、`backend/tests/api/test_evidence_read.py`（新增）、`backend/tests/api/test_evidence_query_counts.py`（新增）、`backend/tests/contract/test_evidence_read_access.py`（新增，不改 `test_route_access.py`） | T2 | FEV-AC04、AC06（讀取）、AC13、AC19、AC20、AC29（讀取與 `max_edge`）、AC35（圖層讀取）、AC36（歷程讀取與權限） | #792 |
| T4 | 內業完整編修 API：90°旋轉、±15°拉直、裁切、−100～+100亮度及圖層合成可重現；設定含開關／角落／偏移／大小／三樣式及三欄覆寫，姓名／時間鎖定。FIELD／label_source 不變，圖層資料與 OFFICE 新檔切換同交易；維運沿用每張設定及覆寫，鎖定照片跳過。T5 稽核接上前不得把圖層修改列為完整對外寫入驗收。依固定雙線性插值、度轉弧度與像素四捨五入契約，同版本後端同輸入產生逐位元相同 OFFICE；下載／報告直接讀此檔，不在讀取時重合成。更正取代沿用舊圖層與文字覆寫；回傳有內業覆寫及極小未合成提示資料。與 T3 的照片詳情歷程讀取整合，T5 寫事件後驗證完整改前→改後；不以 Admin 全域查詢代替。| `backend/app/api/v1/evidence_office.py`（新增）、`backend/app/services/evidence_office.py`（新增）、`backend/app/cli/regenerate_office_versions.py`（新增，維運指令；實際位置依既有指令慣例）、`backend/app/main.py`（只加一行路由註冊）、`backend/tests/api/test_evidence_office.py`（新增）、`backend/tests/contract/test_evidence_office_access.py`（新增，不改 `test_route_access.py`） 省略或未改 layer 依實際尺寸基準重產，僅影像編修的暫時退讓不改基準；預設影像重設恢復初版雜湊。維運重產亦走通用容納規則，合法圖層放不下只退讓／省略，不中止；僅內業明示新 layer 幾何不足才拒絕。 | T2 | FEV-AC02、AC06（編修後註記不變）、AC13（編修權限）、AC29（編修回應）、AC30（依設定合成或關閉）、AC31（重新產生）、AC32（來源穩定）、AC33（字級／缺字重產）、AC34（更正／改善來源整合）、AC36（資料／重產／拒絕與回滾）、AC37（後端重現） | #793 |
| T5 | 修改註記與對應、軟刪除、四個稽核事件（`photo_deleted`、`office_version_edited` 每次都寫，`photo_updated` 只記有變動，新增 `evidence.layer_updated` 只記實際圖層變動，完整設定與五欄改前／改後、操作者與伺服器時間，皆填 `project_id`）、刪除守門（完成後、作廢、核發報告引用的檢查註冊點）、KD-55 作廢連動（被修改的項目；只有照片也作廢）與 `has_result`（納入有效照片）、已取消 Task 恢復時作廢、點位穩定身分與相關規則（IP-R13：PATCH 保留點位與實測欄位 `id`；選「不要」時不接受增減項次或實測欄位，也不接受變更既有欄位類型；選「要」時被刪除的點位隨項目作廢。PATCH 身分與結構鎖已由 #595 完成，作廢連動仍屬本任務。IP-R14：PATCH 擋下零項次已由 #595 完成；建立 Task 擋下零項次仍屬本任務）、取消與封存唯讀、上傳與作廢並行的鎖定；圖層資料、OFFICE 與稽核失敗同交易回滾。layer_updated 的 before／after 一律記錄具名 `layer`（含 overrides）與 `labels` 五欄，檢驗時間為 UTC 原值；實際變動才寫。T5 另在 audit-log 登記其餘三個照片事件；與 T3／T4 整合非 Admin 的詳情歷程讀回。| `backend/app/api/v1/evidence.py`、`backend/app/services/evidence.py`、`backend/app/services/evidence_office.py`（只補稽核呼叫）、`backend/app/api/v1/inspection_planning.py`（PATCH 點位保留 `id`、`:restore` 路徑）、`backend/app/api/errors.py`（`structure_locked`、`points_required`）、`frontend/src/admin/projectItems/api.ts`、`ProjectItemChangePage.tsx` 與對應測試、`backend/tests/db/test_project_item_edit_concurrency.py`（PostgreSQL 項次互換）、`backend/app/services/inspection_planning.py`（作廢連動、恢復時作廢與 `has_result`，只動本規格相關函式）、`backend/app/services/inspection_planning_snapshots.py`（快照點位對應與作廢）、`backend/app/services/audit.py`（登記事件）、`docs/specs/audit-log/spec.md`（只新增本規格專屬事件區段，沿用既有規格的登記做法）、`backend/tests/api/test_evidence_mutations.py`（新增）、`backend/tests/api/test_inspection_planning_api.py`（補作廢、恢復與 `has_result`）、`backend/tests/api/test_planning_query_counts.py`（確認查詢數不隨照片成長） | T3、T4（同改 `evidence.py` 與 `evidence_office.py`，須在其後）；**`completion-validation` 規格已合併**（`inspection-planning` 的 IP-R04、IP-R07、IP-R13、IP-R14 與 `has_result` 定義）；#538 的規格 PR 已合併（同改 `audit-log` 規格） | FEV-AC12（其餘狀態）、AC13、AC14～AC18、AC21、AC26（後端）、AC27、AC28、AC29（`PATCH`、刪除與讀取行為）、AC36（圖層稽核與回滾） | #794 |
| T6 | 【人工關卡，已由負責人核可】現場簡化編修與內業完整三分頁原型；現場只旋轉／亮度／比較、圖層開關／四角，內業裁切／拉直／完整圖層設定與三欄更正／稽核。展示深色照片三樣式、兩行省略與完整資料、乾淨 FIELD／合成 OFFICE；依 #795 及追加裁定更新連續試用腳本。| `docs/specs/field-evidence/ui-field-prototype.html`、`docs/specs/field-evidence/ui-office-prototype.html`（新增）；試用腳本寫入本檔「UI 原型與試用腳本」段；本輪負責人 #795 範圍變更另同步本 `spec.md`、本 `plan.md` 與 `docs/specs/audit-log/spec.md` 的照片圖層事件登記，以及 `docs/intents/03-decisions-and-stack.md` 的 KD-64／影像處理分工、`docs/intents/04-glossary.md` 的內業版定義（本輪負責人直接指示） | 本規格合併 | 無（已核可，FEV-AC22、AC23 的畫面細節定案，細項依實際使用再調整） | #795 |
| T7 | 現場簡化拍照 UI：只90°旋轉、−100～+100亮度與長按比較，圖層只開關／四角（預設左下），五欄唯讀。無裁切／比例／拉直／拖曳微調／大小／樣式／文字修改；壓縮乾淨 FIELD，傳 layer 子集，清單前端合成圖層預覽，不取 OFFICE 檔或改權限。項次／註記、重試／手動重送、修改／刪除、離開提示與真 API 整合照原。現場編修畫面即時預覽圖層，清單亦用讀回 layer／labels 前端預覽。預覽容納不足不得阻擋上傳；亮度倍率依規格 0.5～1.5，原型示意倍率不作準據。| `frontend/src/field/evidence/`（新增）、`frontend/src/field/TaskDetail.tsx`（加入照片區）、`frontend/src/field/api.ts`、`frontend/src/ui/ConfirmBox.tsx`（只沿用，不改）、`frontend/src/styles.css`（只加本畫面樣式）、前端測試 前端依 1+v/200 將亮度直接烘進 FIELD，field_edit 僅摘要，後端不重複套用。 | T6 核可；T2、T3、T5（真 API，故在 T5 之後）；[field-ui](../field-ui/plan.md) T3、T4 | FEV-AC03、AC10、AC11、AC22、AC24（現場部分）、AC06（畫面）、AC35（現場範圍與請求） | #796 |
| T8 | 內業照片頁保留分組、比較、篩選、刪除；編修器完整三分頁：直接裁切框與八把手、雙指縮放／拖移、比例鎖、±15°拉直、重設／復原／比較，調整只亮度。圖層有完整顯示設定與前三欄文字更正，姓名／時間鎖定；頁內確認後顯示修改前後及操作者／時間，接真 API。從專案內照片詳情 API 讀取分頁歷程，非 Admin 的 evidence.read 也可看操作者／UTC 時間／完整前後值；不使用 Admin 全域稽核 API。顯示「照片太小，標示未合成」與「有內業覆寫」，OFFICE 檢視／下載使用保存檔。| `frontend/src/admin/evidence/`（新增）、`frontend/src/App.tsx`（只加一行路由）、內業任務頁的照片頁籤入口（`frontend/src/admin/planning/PlanningPage.tsx`，依 `inspection-planning` #363 的檔案責任安排）、`frontend/src/styles.css`（只加本畫面樣式）、前端測試 只修改或重設影像時省略 layer，顯示保存的實際合成尺寸；圖層設定有變動才送完整新 layer，避免誤進主動幾何驗證。 | T6 核可；T3、T4、T5（真 API）；#363（內業任務頁）；T7 先合併 `styles.css` 後 rebase | FEV-AC23、AC24（內業部分）、AC36（完整圖層）、AC37（編修器） | #797 |
| T9 | v0.3.1 走查補充：確認「已完成」標籤在現場任務詳情與內業計畫頁都走 `statusBadge` 的 `badge-success`，不一致處修正（現場清單的「近期已完成」區由 `field-ui` T1、T2 實作，本任務只驗收該區的標籤顏色）；重查說明文字依 `has_result` 顯示 | `frontend/src/ui/statusBadge.ts`（必要時）、現場詳情與內業計畫頁中直接寫狀態樣式的元件、`frontend/src/admin/projectItems/ProjectItemChangePage.tsx`、前端測試 | T5（`has_result`）；T7；T8 先合併（兩者都動內業任務頁，不同波）；`field-ui` T1、T2（近期已完成區） | FEV-AC25、AC26 | #798 |
| T10 | 真後端走查與示範資料：保留原照片主線，增加現場簡化／內業完整圖層、鎖定欄位、三樣式省略、前後值稽核、關閉圖層下載及拉直重現；SQLite、Vite、無頭瀏覽器登入後操作，桌面／360淺色截圖，補 #381 demo；彙整 AC01～AC37。整合上傳極小 fallback／省略但成功、未知鍵與合法幾何錯誤分流、非 Admin 圖層歷程與跨專案拒絕、更正沿用覆寫及後端逐位元重現；原型畫面不代替真 API 驗收。| 走查腳本與截圖放置位置依 #381 實際責任區（`demo/`）；後端 seed；不改產品程式碼 | T1～T9 | FEV-AC01～AC37（彙整）；重點 AC22～AC37、AC35～AC37 | #799 |

- 每個任務一個 PR 就能完成，並能單獨驗收；T0 與 T6 沒有產品程式碼。
- 每個任務至少對應一條 AC；每條 AC 至少被一個任務涵蓋（AC01～AC37 的覆蓋見上表，T10 為總驗收）。
- 跨規格依賴寫 issue 編號；T1～T5 的後端任務完成條件含真實後端契約測試，不以前端 mock 代替（[RG-M22](../../review-guidelines.md)）。
- 全部任務合併後，把本規格改為「已完成」並更新索引（最後一個任務的 PR 內一併修改；T10 沒有產品程式碼時另開收尾 task）。

## 並行分組

依「改動的檔案」分波；同一波內的任務檔案不重疊。碰到[共用檔案](../README.md#parallel)的任務已在表中注明。

- 第 1 波：T0（只讀核對既有 `intents/README.md`，不另開實作任務）、T1（0.6.x 後端基礎，先於 `completion-validation` T1 合併）、T6（原型，人工關卡，可與後端並行）。
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
- **migration 鏈**：T1／PR #800 保持原樣；T2 新增圖層 JSON 欄位的 migration，接 T1 最新 head，每 PR 最多一支、不留多 head。後續新增欄位依共用規則串行。
- **同步產生內業版拖慢上傳**：照片已由前端壓縮；預設啟用工程標示，T2 要量測重新編碼、中文字型與長文字換行的成本，不能只量測不加標示的位元組複製。試用若顯示過慢，依 FEV-Q10 評估非同步。T3 的圖片串流與即時縮圖（`max_edge`）會吃 CPU，需快取標頭與合理的 `max_edge` 上限，並在 T3 以測試確認。
- **孤兒檔案**：先寫檔、後寫資料庫；程序在兩步之間當掉會留下孤兒檔。MVP 以失敗時清理為主，T1 提供可列出「儲存有檔、資料庫無記錄」的檢查指令（只讀）供維運。
- **前端預覽與後端合成不一致**：前端與後端允許視覺差異，前端／原型的像素、雜湊或目視一致不作為重現驗收依據。T4 按 spec 固定角度（度轉弧度）、雙線性插值、裁切四捨五入及亮度 `1 + v/200`；AC37 在同一影像函式庫版本、相同來源／參數／尺寸基準／字型規則與固定 JPEG 選項下，以後端重產檔逐位元及 SHA-256 相同驗收。T8 走查操作、預覽切換及儲存檔讀取，與重現測試分開。
- **iOS Safari 相機與記憶體**：大張照片在畫布編修可能吃記憶體；壓縮前先縮到上限長邊，T7 在 iPhone 實機驗證（沿用 [FUI-AC11](../field-ui/spec.md#驗收條件) 的區網 HTTPS 流程）。
- **冪等與並行**：`(task_id, upload_key)` 唯一約束是並行安全的依據，請求指紋（含註記、項次與正規化 layer）避免重送時新欄位被靜默忽略；T2 必須有並行請求測試，且兩種資料庫（SQLite、PostgreSQL）的唯一衝突處理與項目明細鎖定都要驗證。
- **作廢連動漏掉照片或誤作廢**：KD-55 的作廢發生在 `inspection-planning` 的同一交易，作廢對象是被修改的項目而非整個 Task；T5 必須有「中途失敗全部回滾」、「上傳與作廢並行」（AC28）與「已取消 Task 恢復時作廢」（AC27）的測試，並處理 `has_result`（納入有效照片），否則重查說明會寫錯（FEV-R20）。
- **權限模型變動**：#538 把權限改成兩層。本規格只引用專案角色動作代碼；兩層判斷落地後，T2～T5 的存取宣告改用新入口，AC13 的人員矩陣要補「未開通模組」案例，該案例由 #538 規格負責定義。
- **0.7.x 銜接**：完成驗證沿用 T3 的覆蓋 service 函式，不得另寫第二份計算；完成後的現場版與註記更正由 0.7.x 負責（FEV-Q3）。
- **工程標示的中文字型**：標示由伺服器端寫進影像像素，需要中文字型。字型必須隨後端一起打包提交（開源授權，授權文字與來源放在 `backend/app/assets/fonts/`），不得依賴主機或容器剛好安裝的字型，否則開發機、CI 與試用主機畫出的標示會不同；CJK 字型檔偏大（數 MB 到十幾 MB），要評估 repo 大小與是否只放子集；繪製須是確定性的（同一輸入與規則得到相同位元組），測試才能用雜湊比對與判斷是否需要重新產生；要有「缺字」測試（含繁體中文與常用符號），確認以 `?` 繪製、記錄缺字碼位警示且不阻斷交易。影像處理套件的文字繪製能力與字型授權在 T1 評估套件時一併確認。
- **標示來源與版面**：五欄依 [#588 修正裁定](https://github.com/speko-tw/inspect-flow/issues/588#issuecomment-6231300749)；T2 在上傳交易保存 `label_source`，測試來源、缺值、時區與跨日。T4 重產不得回查目前名稱或改用重產時間。T6 以定案欄位展示照片內圖層、兩行省略及直橫照片，原型給負責人看後可調；手機拍攝時間仍存 metadata，但不印入標示。CMV-R11 更正取代切換到更正者／更正時間，CMV-R13 改善照片沿 `result_id` 找到有效不符合結果，依其項目識別與快照修訂取標題、依同一結果所屬 Task 取位置；不得以照片未直接填項目識別為由改印任務名稱。0.6.x T2／T4 先以單元輸入驗證來源契約，0.7.x CMV 真流程整合時重驗；不在 0.6.x 提早實作完成後更正或改善登記。
- **身分快照依賴 #550**：照片的拍照者是上傳者的身分快照，格式與寫入函式屬 [#550](https://github.com/speko-tw/inspect-flow/issues/550)；#550 未合併前，T1 先以同欄位結構實作，合併後對齊，避免兩處各存一份。
- **跨規格依賴**：`inspection-planning` 的修改（IP-R04、IP-R07、IP-R13、IP-R14、`has_result`）放在 `completion-validation` 的規格 PR，避免兩個 PR 改同一份凍結規格；T5 必須等它合併。兩個 PR 都改 `docs/specs/README.md` 規格索引相鄰的兩列，後合併者要先 rebase。
- **未裁定議題**：[OQ-19](../../intents/05-open-questions.md#oq-19) 與缺圖時能否出報表、圖片選用細節（[OQ-07](../../intents/05-open-questions.md#oq-07)）屬 0.8.x，本計畫不實作任何報告端行為。

## UI 原型與試用腳本

原型：[現場簡化編修](ui-field-prototype.html)、[內業照片與完整編修](ui-office-prototype.html)。兩份為離線單檔假資料原型；不是 API、相機、儲存或權限的產品驗收。

**T6 關卡：已由負責人核可（2026-10-31，[核可紀錄](https://github.com/speko-tw/inspect-flow/issues/795#issuecomment-6541229921)）；細項依實際使用再調整。** 本輪依 [#795 圖層裁定](https://github.com/speko-tw/inspect-flow/issues/795#issuecomment-6540663667)與[現場簡化追加](https://github.com/speko-tw/inspect-flow/issues/795#issuecomment-6540746073)重做；前輪核可不代表新圖層／編修器已核可；本輪已核可，T7、T8 可開工（仍依各自依賴）。

原型亮度倍率僅示意，產品實作以 spec 的 `1 + v/200`（0.5～1.5）為準；本輪依工作單不改 HTML。極小照片成功保存、詳情歷程權限及逐位元重現由後續 T2～T5／T10 真 API 驗收，不以假資料原型代替。

每輪從不帶網址片段的現場原型開始，選淺／深色。張先生為現場、林小姐為內業；用 40px 工具列切換，後續步驟沿用前面的照片、圖層、文字覆寫、編修、刪除與作廢狀態。網址片段只傳遞已上傳假資料及參數，不含照片位元組或草稿；重新載入舊網址不是多人同步。

1. 檢視任務與缺圖張數，從鋼筋間距項次按「拍照」，選橫向示意圖。確認左上取消、右上確認，按鈕至少 44px。
2. 現場只試「旋轉 90°」、亮度滑桿 −100／+100 及 20，按住比較按鈕或長按照片後放開；確認畫面切換編修前／後。沒有裁切、比例、拉直、拖曳微調、大小／樣式或文字編輯入口。旋轉四次回原方向。
3. 圖層預設開啟、左下；切到右上再回左下，關閉再開啟，觀察即時預覽。展開完整文字，五欄都唯讀，檢驗時間明示「上傳後以伺服器時間填入」。現場不能改三欄文字。
4. 右上確認後，先取消所有項次送出，檢查欄旁錯誤與聚焦；再複選兩項次、填「梁柱接頭補拍」，選前三次失敗、自動重試後成功的情境上傳。
5. 狀態清單保留照片，約 1／2／4 秒退避後成功，只新增一張。兩項次變齊全，現場縮圖有圖層；這是 FIELD 加資料的預覽，不代表 FIELD 已燒入標示。
6. 修改剛上傳照片的註記為「梁柱接頭補拍：已確認」，維持兩項次，儲存後不新增照片。
7. 拍一張直向總覽，填「工作平台總覽」、正常上傳；覆蓋數不增加。先取消刪除一次，再確認刪除；其他照片不受影響。
8. 再拍「網路不穩試拍」，兩項次都選，持續失敗三次後手動重送；只新增一張。修改對應時取消第二項，只有第二項的覆蓋數下降。
9. 再拍「放棄試拍」，失敗後點放棄，先取消保留，再確認放棄；它不進已上傳清單。
10. 再進現場編修調亮度，按左上取消，先取消放棄提示、確認編修仍在，再取消並確認放棄。已上傳資料保留。
11. 切到內業，確認林小姐姓名選單及照片分組，前面註記／圖層／刪除狀態沿用。篩選已刪除找到總覽，只能比較，不能編修／再次刪除；回全部。
12. 開啟補拍照片比較：FIELD 乾淨、OFFICE 帶疊在照片內的圖層；尺寸不延伸，五欄長文字最多兩行加省略號。開放大檢視及下載原尺寸，完整值仍能在編修欄位讀到。
13. 進內業編修，確認底部分頁裁切／調整／圖層、左上取消／右上確認。裁切直接拖八個框角與邊；框內拖移，試原始／自由／1:1／4:3／16:9 與比例鎖，對比鎖定與解鎖時拉框的結果。
14. 以雙指縮放及拖移預覽；再用鍵盤的預覽放大／縮小／移動按鈕操作。裁切框焦點方向鍵移動、把手方向鍵調邊界，Shift 加速。試 90° 旋轉、−15°／+15° 拉直，再停在 5°；按復原一步，確認回前一狀態。重設影像只重設影像參數，不清掉圖層資料。
15. 調整分頁只有亮度，試 −100／+100，再調至 15。按住比較編修前，放開返回；不新增版本、不呼叫後端。取消離開提示先取消後再確認，檢查未套用變更不影響已存內業版。
16. 重新編修補拍照片，圖層分頁試四角、拖曳微調與鍵盤方向／按鈕微調，小／中／大及開關。偏移與大小受照片邊界限制；不延伸畫布。完整文字仍保留，影像中超長值兩行加省略號。
17. 在內業只修改工程名稱為「修正工程名稱」、檢驗項目為「修正檢驗項目」、檢驗位置為「修正檢驗位置」。姓名／時間鎖定。按確認後先取消套用，再確認套用；查看「已修改圖層資訊」紀錄，誰為林小姐、示意時間及三欄／設定完整前後值皆可查，FIELD 與原來源快照不變。
18. 開啟原有深色直圖，進圖層分頁，依序試半透明深底白字、透明底白字加描邊、白底黑字；確認三種樣式可讀、長文字省略但完整資料沒丟。最後套用白底黑字，新增一次實際圖層異動示意；沒有新增第三張永久圖片。
19. 回補拍照片，把圖層關閉後套用，內業版與下載都沒有標示（若影像參數有改，照片本體仍保留那些編修）；五欄資料沒有被刪除。再開啟並套用，可恢復相同圖層資訊與覆寫。
20. 刪除「網路不穩試拍」，先取消後確認；篩選已刪除同時看到它與總覽。回全部後，模擬鋼筋標準變更選「要」重查，確認只有鋼筋有效照片作廢，混凝土深色直圖不變。
21. 切回現場看補拍提示；舊鋼筋照片不計覆蓋，重新拍一張、開圖層並選左下、複選兩項次上傳。兩項次重新齊全；現場仍不能調精細工具。
22. 再切內業查有效／作廢／已刪除，新補拍與舊圖層稽核狀態皆沿用。以 360 淺／深、1280 淺／深各跑一輪，另用 Tab／Enter／Space／方向鍵完整跑同流程。每種拖曳在鍵盤路徑重做；無水平溢出、錯誤、外部網路請求。無頭結果不代替實際手機雙指與負責人再次核可。

**請負責人回饋**：現場四種簡單操作是否足夠、是否容易確認？內業裁切把手／比例鎖／拉直與復原的精度是否合適？三種圖層樣式、小中大短邊比例與兩行省略在深色照片是否可讀？圖層微調及三欄更正的確認／前後值紀錄是否清楚？這些版面與精確比例是規格設計，依試用再調，不重開已裁定的角色權限與五欄來源。


## 驗證（Proof）

所有 API、權限與端對端 AC 以真實後端驗證；mock 限單元或元件呈現測試。UI 驗收保存桌面與 360px 淺色模式截圖。

| AC | 驗證方式 |
|---|---|
| FEV-AC01 | `backend/tests/api/test_evidence_upload.py`：上傳後查資料庫只有一筆 `evidence`、兩筆 `evidence_variants`，儲存只多兩個檔案、儲存鍵為 UUID、schema 沒有 BLOB 欄位、回應不含儲存鍵；`backend/tests/db/` 檢查資料表約束；`backend/tests/storage/` 檢查儲存抽象介面；另驗圖層關閉且影像參數預設時兩版位元組相同，仍有兩版記錄與獨立檔。|
| FEV-AC02 | `backend/tests/api/test_evidence_office.py`：連續編修與重設，驗證檔案數、現場版雜湊不變、輸出尺寸、重設後雜湊、舊檔移除、非法參數 422 與內業版不變；依固定 Q(t)=floor(t+0.5) 核對裁切整數界線及精確輸出尺寸，不使用 ±1px 容差。| 另用初版退讓 small 的照片，省略 layer 做旋轉／裁切後重設；斷言尺寸基準不被暫時退讓清掉，重設與初版雜湊相同、不回圖層幾何錯誤。
| FEV-AC03 | 前端元件與真後端走查：現場只有旋轉／亮度／比較／圖層開關四角，驗證亮度端點、乾淨 FIELD 與壓縮，不提供精細工具、不持久化原圖。|
| FEV-AC04 | `backend/tests/api/test_evidence_read.py`：逐步上傳並讀覆蓋狀態，涵蓋 `min_count` 為 2、跨項次共用、總覽不計、一百張以上 |
| FEV-AC05 | `test_evidence_upload.py`：四種不合法對應皆 422 且無記錄與檔案 |
| FEV-AC06 | `test_evidence_upload.py`、`test_evidence_read.py`、`test_evidence_office.py`：註記經兩種視圖一致、編修內業版後不變、超長 422 |
| FEV-AC07 | `test_evidence_upload.py`：上限內外、非 JPEG、毀損、超過像素上限、調整設定值；逐一檢查無記錄與孤兒檔，413 在串流中拒收 |
| FEV-AC08 | `test_evidence_upload.py`：雜湊不符 422，相符時資料庫雜湊正確 |
| FEV-AC09 | `test_evidence_upload.py`：重複、不同內容、只改註記或項次、他人同鍵、並行請求、刪除後重放、任務狀態改變後重放；SQLite 與 PostgreSQL 各跑一次（`make check-postgres`） 另以同一冪等鍵只改 layer 開關／角落回 409，原圖層與兩版不變。|
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
| FEV-AC21 | `test_evidence_mutations.py`：四個事件的內容、「每次都寫」與「只記有變動」差異（含同參數重送、無變動 `PATCH`）、`project_id` 已填、交易回滾；T5 在 `audit-log` 事件目錄登記本規格區段並以既有的事件目錄測試確認；涵蓋四個照片事件；layer_updated 實際變更才寫，具名 layer（含覆寫）及 labels 一律完整記錄，labels.uploaded_at 為 UTC 原值。|
| FEV-AC22 | 前端元件測試加無頭瀏覽器在 360、390、768 px 驗證觸控目標、無水平捲動、無技術資訊、欄位錯誤聚焦、頁內確認、離開提示與鍵盤路徑；iPhone 實機走一次；保存截圖 |
| FEV-AC23 | 前端元件測試加無頭瀏覽器在桌面與 360px 驗證分組、標示、篩選、比較、編修確認、未儲存提示；保存截圖 |
| FEV-AC24 | 以真實後端的前端契約測試：前端送出的上傳、修改、刪除、編修被接受並能讀回；不使用 mock 回應 |
| FEV-AC25 | 前端測試斷言現場詳情、現場清單「近期已完成」區與內業計畫頁都使用 `statusBadge` 的 `COMPLETED` 與 `badge-success`；真後端走查把任務走到已完成並截圖；「近期已完成」區的列表與展開行為由 FUI-AC01 驗證 |
| FEV-AC26 | `ProjectItemChangePage.test.tsx` 斷言三種情境（無照片與結果、只有照片、已有結果與照片）的白話說明；後端測試斷言 `has_result` 含有效照片與結果；真後端走查截圖 |
| FEV-AC27 | `test_inspection_planning_api.py` 與 `test_evidence_mutations.py`：已取消 Task 修改標準後，取消期間照片唯讀、恢復的同一交易才作廢並標待重查、恢復失敗時回滾 |
| FEV-AC28 | `test_evidence_upload.py` 與 `test_evidence_mutations.py`：以可控的交錯順序模擬上傳與作廢並行與舊修訂上傳，驗證 409 `evidence.requirement_changed`、無孤兒檔、無指向舊需求的有效照片；SQLite 與 PostgreSQL 各跑一次 |
| FEV-AC29 | `test_evidence_upload.py`（`captured_at`）、`test_evidence_read.py`（`max_edge`、已刪除與作廢的讀取、排序）、`test_evidence_mutations.py`（`PATCH` 部分欄位）、`test_evidence_office.py`（回應視圖） |
| FEV-AC30 | T2 上傳與 T4 重產：開啟／關閉、三種樣式、同尺寸照片內合成、FIELD 雜湊不變、預設影像且關閉時位元組相同、始終兩檔；T6／T10 畫面比較。預設影像參數且關閉／極小省略時直接複製 FIELD；原尺寸讀取、下載與報告使用同一保存 OFFICE 位元組，不重合成。|
| FEV-AC31 | `backend/tests/api/test_evidence_office.py`（維運指令）：改變規則後重新產生，編修參數與每張圖層設定／覆寫沿用、不重開已關閉圖層、現場版不變、被引用（測試替身）者跳過、稽核事件、重複執行結果相同、舊檔移除 | 維運沿用穩定尺寸基準，規則變更導致放不下時依同一通用規則退至 small 或暫不合成，保存提示且不中止；重複執行結果一致。
| FEV-AC32 | 來源／缺值／時區／跨日及改名不影響來源保持；逐格兩行省略、資料及畫面完整文字，內業三欄覆寫與鎖定兩欄；T2／T4測試，T6／T10走查。|
| FEV-AC33 | T2／T4以320×480及1200px照片驗證14px下限、照片內定位、無延伸；U+0378 替代?及碼位警示、不阻斷交易；幾何容納錯誤另驗，不與缺字混淆。T2 另用極小合法 JPEG 測預設放不下→小可放、仍放不下→成功保存兩版及設定／提示；T4 只有主動新 layer 合法但幾何放不下才回 invalid_layer，未知鍵／型別／列舉為共用欄位驗證錯誤。| 以同一容納測試矩陣覆蓋所有自動路徑與省略／相同 layer 的編修；主動有變動的新 layer 才測幾何拒絕，包含 R18 摘要及 R23 預覽不擋上傳。
| FEV-AC34 | T2／T4 單元與整合測試驗證更正者／更正時間切換、更正照片的同任務工程／項目／地點來源、改善照片的 `result_id` → 有效不符合結果 → 項目識別／快照修訂 → 快照標題與同一結果所屬 Task 位置，以及失敗回滾；涵蓋照片未直接填項目識別但可由結果追溯的合法情境，斷言不印任務名稱；缺少有效不符合結果不得當正常改善上傳驗收；0.7.x CMV-R11／R13 實作接上真流程後再次驗收，不以單元測試冒充該流程已實作。更正取代另斷言保留原顯示設定與三欄覆寫，新來源不被覆寫改寫，詳情回 has_layer_overrides 並顯示提示。| 更正取代與改善上傳的合法圖層容納不足共用退讓，不因幾何拒絕，來源／覆寫契約不變。
| FEV-AC35 | T2 真請求拒絕現場精細設定；T7 真契約傳 layer 子集，FIELD 乾淨、清單合成預覽及四角開關；T6 原型只驗畫面。T3 核對現場清單、內業清單及詳情皆回 layer／labels／layer_render；T7 編修畫面即時預覽與清單預覽；同鍵不同 layer 回 409。|
| FEV-AC36 | T4／T5 真後端驗設定、三欄覆寫、鎖定兩欄、完整前後值、同交易重產／稽核與失敗回滾；T8契約及UI，T6可點示意。T3／T4／T5 真整合：具專案 evidence.read 的非 Admin 能從照片詳情分頁讀操作者、UTC 時間、具名 layer／labels 完整前後值；無權限及跨照片／專案 cursor 拒絕且不洩漏，不使用 Admin 全域 API。|
| FEV-AC37 | T4以同一FIELD與旋轉／拉直／裁切／亮度參數重產比對；T8／T6以八把手、雙指與鍵盤替代、比例鎖、復原一步、長按比較走查。後端同版本影像函式庫、同 FIELD／參數／來源／圖層／尺寸基準／字型規則／時區／JPEG 選項重產，檔案逐位元及 SHA-256 相同；前端視覺差異不作為重現驗收標準。|


## 考慮過但沒採用的做法

- **保存原圖並以版本系譜記錄每次編輯**：不採用，[KD-32](../../intents/03-decisions-and-stack.md#kd-32) 決定只保存現場版與內業版。
- **非同步產生內業版（背景工作）**：不採用。同步產生讓一筆照片永遠是完整兩版，也不用多出「產製中」「產製失敗」狀態；試用顯示過慢時再依 FEV-Q10 評估。
- **前端直接產生內業版**：不採用，[KD-61](../../intents/03-decisions-and-stack.md#kd-61) 已決定由後端依編修操作產生，讓報告用圖一致且可追溯。
- **離線佇列與重新連線同步**：不採用，MVP 為 Online-first（[KD-61](../../intents/03-decisions-and-stack.md#kd-61)、[KD-63](../../intents/03-decisions-and-stack.md#kd-63)）。
- **保存縮圖**：不採用，縮圖會變成第三個保存的圖片；改為讀取時即時縮放。
- **每次內業編修在原內業版上累積處理**：不採用，反覆壓縮會累積畫質損失；改為每次由現場版重新產生。
- **把覆蓋達標只放在前端判斷**：不採用，覆蓋計算在後端，0.7.x 完成驗證沿用同一份計算。
- **自建即時取景相機**：不採用，MVP 用裝置相機的網頁檔案選擇，iOS 最可靠；日後再評估。
- **只把工程資訊放在報表上、不寫進內業版影像**：不採用，負責人裁定標示要寫進內業版的影像像素（像工程標示牌），報表上照片（含標示）與查核項目內容並排。
- **在現場版加標示**：不採用，現場版保留原樣，標示規則改變時才能從現場版重新產生內業版。

## T1 基礎設計補充

- 依 #790 工作單調整先後順序：0.6.x 照片基礎先發布，0.7.x `completion-validation` T1 尚無實作 issue；其 migration 與權限目錄整合接在本任務之後。
- Schema 以 `(task_id, project_id)` 外鍵與 `(task_inspection_item_id, snapshot_revision)` 外鍵保存追溯關聯。T2 在項目鎖定後覆核項目屬於同一 Task、項次屬於目前快照，以及剛好兩版；這些跨列業務規則不以資料表 CHECK 冒充。`evidence_point_links.source_point_id` 不外鍵到可刪除的來源點位，避免標準變更破壞歷史。
- `uploader_snapshot` JSON 先保存 `name_zh`、`company_name`、`department`、`is_external_collaborator`；`label_source` JSON 保存 `project_name`、`item_title`、`location`、`uploader_name`、UTC ISO 8601 `uploaded_at`。#550 目前沒有已落地的共用快照格式／寫入函式；後續須對齊，不把此暫行結構宣稱為 #550 的最終契約。
- `Storage` 接受二進位串流，產生新 UUID 鍵；失敗清理、唯讀開啟、可重試刪除、列鍵皆可替換。JPEG／大小／像素驗證屬 T2；T1 只提供可調設定，預設 30 MiB 與 5000 萬像素（依 spec D15，可由設定調整）。儲存根路徑須為絕對路徑，預設 `backend/data/evidence`。
- 孤兒盤點：在 backend 執行 `uv run --locked python -m app.cli.check_evidence_storage`；使用相同資料庫與儲存環境設定。只讀列出未被任何版本引用的 UUID（含軟刪與作廢照片的版本仍算引用），不清除檔案；盤點時暫停照片寫入，避免尚未提交的新檔誤報。
- 影像套件選 Pillow（本次 lockfile 固定 13.0.0）。[ImageDraw／ImageFont](https://pillow.readthedocs.io/en/stable/reference/ImageDraw.html) 可用 FreeType 載入指定 OpenType 字型並繪製 Unicode；Pillow 為 [MIT-CMU](https://pillow.readthedocs.io/en/stable/about.html#license)。FEV-R22 指定的 Noto Sans CJK TC Regular 上游 [SIL OFL 1.1](https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE) 允許隨軟體散布，但須保留授權與著作權聲明。T2 負責把固定字型與授權打包到 `backend/app/assets/fonts/`，不得使用系統 fallback；本任務不提早加入標示產圖。完整 TC Regular 約 16 MiB，先保留完整字庫以免姓名／地名因子集缺字；T2 實際打包時確認檔案版本、大小與缺字測試。
