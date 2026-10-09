# 範本系統（template-system）：實作計畫

**規格**：[spec.md](spec.md)

本計畫依已凍結的 `template-system` 規格拆分任務。專案查核項目副本的最小資料表由本規格的 T1、套用寫入由 T4 負責；專案查核項目編輯權限代碼為 `project_inspection_item.edit`。

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1 | 定義並實作工程類別、系統、每筆帶 `system_id` 的查核項目範本、項次、文字與數值標準、實測欄位、照片需求、最小 `ProjectInspectionItem` 副本資料表，以及以固定角色代碼指派的 `SystemRoleAssignment`；名稱去除前後空白並忽略大小寫後在同一父層唯一；數值標準依 TPL-R11 綁定。角色清單以程式 enum／常數表示，不建角色定義表或 seed；指派／收回寫稽核。只存結構，不建 `Template Version`、interval、結果、實測值或照片資料 | `backend/app/models/`、`backend/alembic/versions/`、`backend/tests/db/` | `database-foundation` #110、`domain-model`、`audit-log` | TPL-AC02、TPL-AC03、TPL-AC04、TPL-AC07、TPL-AC08、TPL-AC09；DBF-AC12、DBF-AC13 | #325 |
| T2 | 全系統範本管理員授權與指派：本規格新增的全系統角色機制沿用 `authentication` 授權入口，支援範本權限檢查、Admin 指派／收回範本管理員並寫稽核紀錄、查看所有專案與將專案項目存為範本；Admin 與範本管理員可管理範本庫及存成範本，專案編輯者可唯讀瀏覽範本並套用；不得把全系統角色併入 `is_admin` 或專案 `Role` | `backend/app/` 授權服務與相關測試（依 T1 實際路徑調整） | T1；`authentication`、`audit-log` | TPL-AC01、TPL-AC06、TPL-AC08 | #326；專案項目存成範本 API #365 |
| T3 | 範本庫服務與 API：工程類別、系統新增／改名／刪除，以及單項範本 CRUD 與覆蓋更新；整個系統僅以 `system_id` 查詢或操作其項目集合；刪除有子系統／範本分別回 `template.category_not_empty`／`template.system_not_empty`（409）；依 api-conventions 實作錯誤、UUID 與分頁，讀取授權依 T2，所有範本寫入允許 Admin 或範本管理員；另以 `system_id` 提供分頁巢狀讀取與整系統覆蓋；Admin 依 AUT-Q2 可讀，請求內的實測欄位識別只用於綁定，持久 UUID 由後端產生 | `backend/app/api/`、`backend/app/auth/access.py`、`backend/app/services/`、`backend/app/main.py`、`backend/tests/api/`、`backend/tests/contract/`、`docs/specs/template-system/`、`docs/specs/authentication/spec.md` | T1、T2 | TPL-AC01、TPL-AC02、TPL-AC03、TPL-AC04、TPL-AC07、TPL-AC08、TPL-AC09、TPL-AC10 | #327、#389 |
| T4 | 專案套用範本：依 `project_inspection_item.edit` 複製單項或指定 `system_id` 下全部項目結構至 `ProjectInspectionItem`，並保存 `project_id`、來源範本名稱與套用時間；系統套用來源名稱用系統名稱。提供專案成員、Admin、範本管理員讀取完整副本的 cursor 分頁 API。驗證來源覆蓋或刪除不影響副本。P4 得擴充副本欄位並定義作廢／重查／更正流程 | `backend/app/` 專案服務/API 與測試 | T1、T2、T3 | TPL-AC05、TPL-AC06、TPL-AC08 | #328；專案副本列表 API #365 |
| T5 | MVP 範本管理 UI：管理兩層分類、編輯範本結構、標準與實測欄位定義、管理照片需求、預覽單項與整個系統範本；入口掛載於既有 AdminPage，瀏覽連結位於 FieldPage，樣式沿用全域樣式表；Admin 與範本管理員皆可編輯 | `frontend/src/admin/templates/api.ts`、`frontend/src/admin/templates/api.test.ts`、`frontend/src/admin/templates/TemplatesPage.tsx`、`frontend/src/admin/templates/TemplatesPage.test.tsx`、`frontend/src/admin/AdminPage.tsx`、`frontend/src/admin/AdminPage.test.tsx`、`frontend/src/field/FieldPage.tsx`、`frontend/src/field/FieldPage.test.tsx`、`frontend/src/styles.css` | T2、T3 | TPL-AC02、TPL-AC03、TPL-AC04、TPL-AC07、TPL-AC09、TPL-AC10 | #329、#357、#389 |
| T6 | 專案套用與存為範本 UI：由具 `project_inspection_item.edit` 權限者以 `template_id` 套用單項，或以 `system_id` 套用整個系統；Admin 與範本管理員可跨專案瀏覽並把專案項目存至指定系統；顯示副本記錄的來源名稱與時間 | `frontend/src/features/projects/`、`frontend/src/routes/`、`frontend/src/field/ProjectTemplatesPage.test.tsx`、`frontend/tests/` | T2、T3、T4 | TPL-AC05、TPL-AC06、TPL-AC08 | #330、#389 |
| T7 | E2E／整合驗收與文件收尾：驗證權限、複製隔離、照片需求結構及不版本化；依規格確認範圍並更新索引，確保 TPL-AC01～TPL-AC12 都有證據 | `backend/tests/api/`、`backend/tests/contract/`、`frontend/` 範本相關測試、`docs/specs/template-system/spec.md`、`docs/specs/template-system/plan.md`、`docs/specs/README.md` | T1～T6、T8（#356）、#357、#365 | TPL-AC01～TPL-AC12 | #331 |
| T8 | 範圍條件兩種形式與套用同名拒絕：更新數值標準欄位、驗證、遷移、複製與重複名稱檢查 | `backend/`、`docs/specs/template-system/`、必要的 `docs/specs/database-foundation/` | T1、T3、T4 | TPL-AC11、TPL-AC12 | #356 |
| T9 | 依核可原型重設範本管理 UI：階層導覽與詳情、手機單欄往返、分開新增與改名、單頁項次卡片與即時預覽、欄位錯誤及草稿保留；項目寫入使用既有單項端點，並驗證綁定欄位的 `unit: null` 契約，不變更 API 端點。#427 第 1 輪修正另持久化實測欄位順序，覆蓋範本、專案副本與任務快照 | 原 T9 檔案；另含 `backend/app/models/template_system.py`、`backend/app/models/inspection_planning.py`、`backend/app/services/template_library.py`、`backend/app/services/inspection_details.py`、`backend/app/services/project_templates.py`、`backend/app/services/inspection_planning_snapshots.py`、`backend/alembic/versions/`、`backend/tests/api/test_project_template_application.py`、`backend/tests/services/test_inspection_planning.py` | T3、T5、T8 | TPL-AC13～TPL-AC17 | #427 |
| T10 | 依核可原型重設專案套用與存為範本流程：內業專案卡片入口、單項／整系統預覽與確認、同名出口、存為範本目的地選擇與衝突保留；Field 首頁移除範本入口；補上 1280px／360px 前端流程驗收並保留 API 權限行為 | `frontend/src/field/ProjectTemplatesPage.tsx`、`ProjectTemplatesPage.test.tsx`、`projectTemplatesApi.ts`、`projectTemplatesApi.test.ts`、`frontend/src/admin/templates/TemplateLibraryNav.tsx`、`frontend/src/admin/projects/ProjectsPage.tsx`、`ProjectsAdmin.test.tsx`、`ProjectItemLinks.tsx`、`AdminPage.tsx`、`AdminPage.test.tsx`、`frontend/src/App.tsx`、`frontend/src/field/FieldPage.tsx`、`FieldPage.test.tsx`、`frontend/src/styles.css`、`docs/specs/template-system/`、`docs/specs/field-ui/spec.md`、`docs/specs/template-system/ui-apply-prototype.html` | T2、T3、T4、T6、#441 | TPL-AC21、TPL-AC22、FUI-AC13 | #429 |

- 每個任務一個 PR 就能完成，並能單獨驗收；任務 issue 開立前應把表內概略檔案責任換成實際檔案清單。
- 每條本規格 AC 至少由一個任務涵蓋；TPL-AC01、AC08 涵蓋權限及管理員指派稽核，AC02～AC04 涵蓋結構與不版本化，AC05～AC06 涵蓋複製與權限，AC07 涵蓋標準及照片需求，AC09 涵蓋實測欄位結構與單位。
- 不在本計畫建立報告範本、自主檢查／抽查欄位、現場證據上傳、實測值、自動判定、interval 自動切分或範本審核流程。
- 任務 issue 已開立，依表格 T1～T7 對應 #325～#331。
- T8 依負責人追加裁定由 #356 落地；範圍兩種形式與同名拒絕分別對應 TPL-AC11、TPL-AC12。
- T9 依負責人 [#427 定案留言](https://github.com/speko-tw/inspect-flow/issues/427#issuecomment-5981195507) 與核可原型調整既有 T5 介面；單項 API 沿用 T3，不修改後端產品程式碼。
- #365（PR #370）補上專案查核項目列表與存成範本 API；#357（PR #376）補上畫面，納入 T7 收尾驗收。
- #389（負責人依 #387 指示）：Admin 與範本管理員可管理範本庫、存成範本及跨專案瀏覽；一般專案成員維持 403。此變更採用 `backend/app/auth/access.py` 的共用授權判斷，並由 TPL-AC08 API／契約測試及前端 Admin 控制項測試驗證。
- TPL-AC07 在本規格只驗收範本端每項次恰好一筆必填照片需求（多送一筆回 422）、`min_count >= 1`、無上限、固定照片類型，以及拒絕 `overview`／`is_overview` 總覽標記（範本沒有此欄位，因此總覽照不計入項次最低數量）；現場覆蓋與總覽照行為移交 P6 `field-evidence` #105。
- #429 原型核可後，TPL-AC21～TPL-AC22 覆蓋套用、存為範本及內業專案工作台；互動與文案依原型，技術細節標為規格設計。
- #482（v0.3.0 走查缺陷修正）：套用頁依登入本體的 `has_template_access`（#484）顯示「存為範本」，並新增 TPL-AC23～TPL-AC24；#486 將 TPL-AC24 的格式化函式共用至範本編輯器與現場詳情。驗證由 `inspectionStandard.test.ts`、`TemplatesPage.test.tsx`、`ProjectTemplatesPage.test.tsx`、`ProjectItemChangePage.test.tsx`、`TaskDetail.test.tsx` 負責。

## 並行分組

依實際改動檔案及依賴拆波；以下僅為預排，開 issue 前需依 `domain-model` 最終責任表覆核，避免共用 migration、model registry、router 或授權檔案重疊。

- 第 1 波：T1（範本與全系統角色資料模型、migration；共用 migration 鏈，單獨執行）。
- 第 2 波：T2（授權與稽核；依賴 T1）。
- 第 3 波：T3（範本服務與 API；依賴 T1、T2，避免 API 權限驗收早於授權）。
- 第 4 波：T4（依賴 T1 資料模型、T2 授權與 T3 API 完成）。
- 第 5 波：T5（前端範本管理；依賴 T2、T3）與 T6（專案套用；依賴 T2、T3、T4）；若路由及共用 client 不重疊可並行，否則依序。
- 第 6 波：T7（整合驗收、規格收尾與索引同步）。

## 風險

- **專案列表授權影響**：範本管理員跨專案瀏覽需調整既有 `/api/v1/projects` 授權；T2 應與 `domain-model`／projects 契約對齊並驗證其他呼叫者。
- **全系統角色模型**：本規格定義新增的全系統角色與指派模型；不得依賴目前尚未定義的角色實體。指派／收回稽核依 TPL-R09、KD-29 納入 T1/T2，並在拆 task 時核對 `audit-log` 事件契約。
- **專案副本與任務快照界線**：專案副本欄位及修改後作廢／重查／更正流程由 P4 `inspection-planning` 定義；T4、T6 只依本規格處理套用複製與來源名稱／時間，不依賴 OQ-09。
- **照片欄位與證據類型**：MVP 只收照片且照片無張數上限；MVP 不建立 `TEXT` Evidence 類型。
- **分類名稱唯一性**：名稱先去除前後空白，再以不分大小寫的方式於相同父層比較；T1 依此規則建立與驗證唯一性約束。
- **資料複製完整性**：套用整個系統須涵蓋分類、項目、項次、檢查標準及照片需求；使用交易確保複製完整或全數回滾，依架構基準 §12.3–12.7 與 KD-47。

## 驗證（Proof）

| AC | 驗證方式 |
|---|---|
| TPL-AC01 | 後端 API 整合測試：專案編輯者不得建立、修改或刪除範本；範本管理員可建立範本；讀取與套用權限依 TPL-AC08 驗證。 |
| TPL-AC02 | 資料庫/API 測試：同一父層同名被唯一性規則拒絕，不同父層同名成功，且 model/schema 無代號欄位。 |
| TPL-AC03 | model/API 測試：建立各類結構後讀回相等；資料表與序列化回應不含現場結果、照片檔或 interval。 |
| TPL-AC04 | API 測試：更新同一 `Inspection Template` 後只有一份最新內容，migration/schema 中不存在 `Template Version`。 |
| TPL-AC05 | 服務/API 測試：以 `template_id` 套用單項、以 `system_id` 套用整個系統；確認每筆 `ProjectInspectionItem` 複製完整、含 `project_id`、來源名稱與時間，且來源變更不影響專案資料。 |
| TPL-AC06 | 權限與整合測試：範本管理員可跨專案讀取並存成範本；專案副本在來源刪改後保持不變。 |
| TPL-AC07 | API 測試 `test_photo_requirements_are_required_unbounded_and_photo_only`、`test_template_writes_reject_two_photo_requirements_per_point`、`test_structure_validation_requires_exactly_one_photo_requirement`、`test_save_as_template_rejects_a_source_with_two_photo_requirements`、`test_project_item_patch_rejects_invalid_point_structure`，以及資料庫測試 `test_duplicate_photo_requirement_rows_are_blocked_by_the_database`與遷移測試 `test_evidence_unique_migration_keeps_largest_min_count_per_point`：每項次恰好一筆必填照片需求（範本 POST、PUT、整系統 PUT 與專案項目 PATCH 送兩筆都回 422；另存為範本的結構驗證與資料庫唯一索引同樣擋下）、`min_count >= 1`、無最大數量且只接受照片；送入 `overview`／`is_overview` 總覽標記回 422，範本沒有總覽需求欄位，因此總覽照不計入此最低需求。現場照片覆蓋、跨項次共用及總覽照選拍由 P6 `field-evidence` #105 驗收。 |
| TPL-AC08 | API 整合／契約測試：逐端點驗證讀寫權限；Admin 與範本管理員可執行所有範本庫寫入、存成範本及跨專案瀏覽，一般專案成員（含專案管理者）仍為 403；只有 Admin 可指派或收回固定 `template_admin` 角色，成功後查核稽核紀錄；Admin 與範本管理員的 `GET /api/v1/projects` 均回傳全部專案，其他非 Admin 為 403；分類或系統刪除衝突回指定 409；路徑、UUID、內容型別與錯誤 envelope 依 `api-conventions`。 |
| TPL-AC09 | model/API 測試：同一項次可設多個文字或數字實測欄位；數字欄位有單位；每個數值標準綁定一個數字欄位，僅該欄位單位自動帶入且不可另設；範本 schema 不含現場填值或換算行為。 |
| TPL-AC10 | 前端測試：範本管理 UI 可管理工程類別、系統與單項查核項目範本；分類或系統刪除衝突顯示對應 409。 |
| TPL-AC11 | API／migration 測試：兩種形式建立、更新與讀回；省略形式預設 `tolerance`，且空誤差補 `0` 並持久化；明填形式時空誤差及其他非法欄位組合回 422；舊資料轉為 `tolerance` 且空誤差補 `0`；套用後再存成範本保留形式。 |
| TPL-AC12 | API 測試：單項與整系統套用遇同專案同名回 409 與衝突名稱；整次無新增項目。 |
| TPL-AC17 | API 整合測試驗證欄位順序在範本建立／讀取、套用、存回範本及任務快照中一致；migration 對舊資料依 `created_at`、`id` 回填。 |
| TPL-AC17（#427 第 2 輪） | 含資料的 migration 測試：範本、專案副本、任務快照的測量欄位與數值標準在 upgrade、downgrade、再 upgrade 後筆數與內容保留，且欄位順序回填正確。 |
| TPL-AC24（#486） | 共用格式化單元測試及範本編輯器、專案查核項目修改、套用預覽、現場任務詳情前端測試：區間、公差、單側、文字回退與未設定顯示一致；編輯器草稿的單側區間顯示未設定；桌面與 360px 登入後點擊截圖。 |

## 考慮過但沒採用的做法

- **把全系統角色模型交由其他規格**：KD-49 已裁定全系統角色機制與專案角色、`is_admin` 並存且互相獨立；`domain-model` 目前沒有此實體，本規格負責定義範本管理員及其角色／指派模型，避免依賴不存在的模型。
- **把專案副本與任務需求快照合併**：KD-55 已把作廢／重查／更正流程交給 P4；本規格仍定義 0.3.x 最小 `ProjectInspectionItem`，避免範本覆蓋語意改寫任務既有需求。
- **替查核範本保留版本表**：與 KD-03、PR-04 的現行裁定相反；專案套用副本承接快照，任務快照仍在建立任務時產生。
