# 範本系統（template-system）：實作計畫

**規格**：[spec.md](spec.md)

本計畫是依目前意圖裁定整理的草稿。`template-system` 目前維持草稿，待規格列出的設計細節確認；本文不得作為已凍結 API 或資料模型的依據。開 task issue 前需確認 `domain-model` #70 的結果已納入來源快照，並依實際改動列出檔案。

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1 | 定義並實作範本分類、範本、查核項目／項次、文字與數值標準、實測欄位定義、照片需求，以及全系統角色與指派資料模型、migration；只存結構，不建 `Template Version`、interval、結果或照片資料。角色指派／收回須寫稽核紀錄。依 TPL-Q1 補齊名稱與歸屬決定 | `backend/app/models/`、`backend/alembic/versions/`、`backend/tests/db/` | `database-foundation`、`domain-model` #70、`audit-log` | TPL-AC02、TPL-AC03、TPL-AC04、TPL-AC07、TPL-AC08、TPL-AC09 | 建立任務時填 |
| T2 | 全系統範本管理員授權：本規格新增的全系統角色機制沿用 `authentication` 授權入口，支援管理範本、查看所有專案與將專案項目存為範本；專案編輯者可唯讀瀏覽範本並套用；不得把全系統角色併入 `is_admin` 或專案 `Role` | `backend/app/` 授權服務與相關測試（依 T1 實際路徑調整） | T1；`authentication` | TPL-AC01、TPL-AC06、TPL-AC08 | 建立任務時填 |
| T3 | 範本庫服務與 API：分類、範本 CRUD、覆蓋更新、單項或整個系統範本讀寫；依 api-conventions 實作錯誤、UUID 與分頁，讀取授權依 T2 | `backend/app/api/`、`backend/app/services/`、`backend/tests/api/` | T1、T2 | TPL-AC01、TPL-AC04、TPL-AC08、TPL-AC09 | 建立任務時填 |
| T4 | 專案套用範本：依專案編輯權限複製單項或完整系統結構，保存來源範本名稱與套用時間；驗證覆蓋或刪除來源不影響專案副本 | `backend/app/` 專案服務/API 與測試（依 domain-model、inspection-planning 分工調整） | T1、T2、T3、`domain-model` #70、P4 OQ-09 決議 | TPL-AC05、TPL-AC08 | 建立任務時填 |
| T5 | 範本管理 UI：管理兩層分類、編輯範本結構、標準與實測欄位定義、管理照片需求、預覽單項與整個系統範本 | `frontend/src/features/templates/`、`frontend/src/routes/`、`frontend/tests/` | T2、T3 | TPL-AC02、TPL-AC03、TPL-AC04、TPL-AC07、TPL-AC09 | 建立任務時填 |
| T6 | 專案套用與存為範本 UI：由具專案查核項目編輯權限者套用；範本管理員可跨專案瀏覽並存成範本；顯示套用來源名稱與時間 | `frontend/src/features/projects/`、`frontend/src/routes/`、`frontend/tests/` | T2、T3、T4、P4 專案副本與任務快照分工決議 | TPL-AC05、TPL-AC06、TPL-AC08 | 建立任務時填 |
| T7 | E2E／整合驗收與文件收尾：驗證權限、複製隔離、照片覆蓋規則及不版本化；依規格確認範圍並更新索引，確保各 AC 都有證據 | `backend/tests/`、`frontend/tests/`、`docs/specs/template-system/spec.md`、`docs/specs/README.md` | T1～T6 | TPL-AC01～TPL-AC09 | 建立任務時填 |

- 每個任務一個 PR 就能完成，並能單獨驗收；任務 issue 開立前應把表內概略檔案責任換成實際檔案清單。
- 每條本規格 AC 至少由一個任務涵蓋；TPL-AC01、AC08 涵蓋權限，AC02～AC04 涵蓋結構與不版本化，AC05～AC06 涵蓋複製與權限，AC07 涵蓋標準及照片需求，AC09 涵蓋實測欄位結構與單位。
- 不在本計畫建立報告範本、自主檢查／抽查欄位、現場證據上傳、實測值、自動判定、interval 自動切分或範本審核流程。
- 任務編號在開立 issue 時填入；本規格／計畫 PR 不建立實作 task issue。

## 並行分組

依實際改動檔案及依賴拆波；以下僅為預排，開 issue 前需依 `domain-model` 最終責任表覆核，避免共用 migration、model registry、router 或授權檔案重疊。

- 第 1 波：T1（範本與全系統角色資料模型、migration；共用 migration 鏈，單獨執行）。
- 第 2 波：T2（授權與稽核；依賴 T1）。
- 第 3 波：T3（範本服務與 API；依賴 T1、T2，避免 API 權限驗收早於授權）。
- 第 4 波：T4（依賴 T1 資料模型、T2 授權與 T3 API 完成）。
- 第 5 波：T5（前端範本管理；依賴 T2、T3）；T6（專案套用；依賴 T2、T3、T4）可在路由及共用 client 不重疊時並行；T5、T6（若路由及共用 client 不重疊可並行；否則依序）。
- 第 6 波：T7（整合驗收、規格收尾與索引同步）。

## 風險

- **專案列表授權影響**：範本管理員跨專案瀏覽需調整既有 `/api/v1/projects` 授權；T2 應與 `domain-model`／projects 契約對齊並驗證其他呼叫者。
- **全系統角色模型**：本規格定義新增的全系統角色與指派模型；不得依賴目前尚未定義的角色實體。指派／收回稽核依 TPL-R09、KD-29 納入 T1/T2，並在拆 task 時核對 `audit-log` 事件契約。
- **專案副本與任務快照界線未定**：OQ-09 留給 P4 `inspection-planning`；套用實作不得把 `Task Requirement Snapshot` 等同範本版本，也不得自行假定兩份副本合併。
- **照片欄位與證據類型**：MVP 只收照片且照片無張數上限；`TEXT` 是否保留為獨立 Evidence 類型待規格確認，不可提前新增其他類型。
- **分類名稱唯一性細節**：KD-48 未規定空白與大小寫正規化；T1 開工前須在規格澄清中定義可驗證規則，不得擴大為未裁定的業務分類政策。
- **資料複製完整性**：套用整個系統須涵蓋分類、項目、項次、檢查標準及照片需求；使用交易確保複製完整或全數回滾，依架構基準 §12.3–12.7 與 KD-47。

## 驗證（Proof）

| AC | 驗證方式 |
|---|---|
| TPL-AC01 | 後端 API 整合測試：專案編輯者不得建立、修改或刪除範本；範本管理員可建立範本；讀取與套用權限依 TPL-AC08 驗證。 |
| TPL-AC02 | 資料庫/API 測試：同一父層同名被唯一性規則拒絕，不同父層同名成功，且 model/schema 無代號欄位。 |
| TPL-AC03 | model/API 測試：建立各類結構後讀回相等；資料表與序列化回應不含現場結果、照片檔或 interval。 |
| TPL-AC04 | API 測試：更新同一 `Inspection Template` 後只有一份最新內容，migration/schema 中不存在 `Template Version`。 |
| TPL-AC05 | 服務/API 測試：單項與整個系統均可套用；確認複製完整、來源名稱與時間記錄，且來源變更不影響專案資料。 |
| TPL-AC06 | 權限與整合測試：範本管理員可跨專案讀取並存成範本；專案副本在來源刪改後保持不變。 |
| TPL-AC07 | model/UI/API 測試：文字與數值標準欄位完整、沒有量測值或自動判定；每項次至少被一張非總覽照片覆蓋，一張照片可覆蓋多項次且無張數上限；總覽照由現場選拍且不計入最低覆蓋。 |
| TPL-AC08 | API 契約測試：範本管理員與專案編輯者的讀寫權限矩陣逐端點驗證；路徑、UUID、內容型別、錯誤 envelope 依 `api-conventions`。 |
| TPL-AC09 | model/API 測試：同一項次可設多個文字或數字實測欄位；數字欄位有單位；數值標準存在時欄位單位自動帶入且不可另設；範本 schema 不含現場填值或換算行為。 |

## 考慮過但沒採用的做法

- **把全系統角色模型交由其他規格**：KD-49 已裁定全系統角色機制與專案角色、`is_admin` 並存且互相獨立；`domain-model` 目前沒有此實體，本規格負責定義範本管理員及其角色／指派模型，避免依賴不存在的模型。
- **把專案副本與任務需求快照合併**：OQ-09 明列分工未定；由 P4 決議後實作，避免範本覆蓋語意改寫任務既有需求。
- **替查核範本保留版本表**：與 KD-03、PR-04 的現行裁定相反；專案套用副本承接快照，任務快照仍在建立任務時產生。
