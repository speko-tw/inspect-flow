# 範本系統（template-system）

**代碼**：`TPL`　**Phase**：P3　**狀態**：已完成<br>
**前置規格**：`database-foundation`（UUID 與稽核欄位）、`domain-model`（`User`、`Project`、`ProjectMember` 與專案權限）、`authentication`（登入者與權限檢查）、`api-conventions`（API 共用契約）<br>
**引用意圖**：[PR-04](../../intents/02-principles.md#pr-04)、[PR-09](../../intents/02-principles.md#pr-09)、[PR-10](../../intents/02-principles.md#pr-10)、[KD-03](../../intents/03-decisions-and-stack.md#kd-03)、[KD-36](../../intents/03-decisions-and-stack.md#kd-36)、[KD-37](../../intents/03-decisions-and-stack.md#kd-37)、[KD-47](../../intents/03-decisions-and-stack.md#kd-47)～[KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[OQ-04](../../intents/05-open-questions.md#oq-04)、[OQ-05](../../intents/05-open-questions.md#oq-05)、[OQ-06](../../intents/05-open-questions.md#oq-06)、[OQ-09](../../intents/05-open-questions.md#oq-09)、[OQ-20](../../intents/05-open-questions.md#oq-20)<br>
**凍結狀態**：本規格需求、資料模型、介面及驗收條件已定案。以下設計決定是本規格設計，不代表負責人另行裁定。

## 目的

提供獨立於專案、可由有權限人員重複套用的查核範本庫，使範本管理員能維護共用結構，專案人員仍能依專案需求建立自己的查核項目（依據：架構基準 §2.4、§12.3–12.7；[KD-47](../../intents/03-decisions-and-stack.md#kd-47)）。

## 範圍

**包含**：

- 範本庫及 `Inspection Template` 的新增、讀取、修改與刪除。
- 兩層分類「工程類別 → 系統」，及其下的查核項目與查核項次結構。
- 文字標準、數值標準、實測欄位定義及照片需求的範本定義。
- 單一查核項目及以 `system_id` 為範圍的整個系統範本讀取、儲存與套用。
- 固定全系統角色代碼及其使用者指派，以及本功能中的權限；此角色與 `domain-model` 既有專案 `Role` 分開。

**不包含**：

- 專案副本在 0.3.x 以外的完整資料模型與欄位，以及修改副本後是否作廢任務、重新查核或更正既有任務的流程：由 P4 `inspection-planning` 定義。0.3.x 最小專案副本資料表仍由本規格定義，以支援套用及記錄來源名稱與套用時間。
- `Inspection Plan`、`Inspection Task`、任務快照與任務狀態：移至 `inspection-planning`（P4）。
- 自主檢查／抽查的檢查層級與檢查者欄位：屬 P4 `inspection-planning`（0.4.x；依 [KD-51](../../intents/03-decisions-and-stack.md#kd-51)），不屬本規格範圍。
- 現場選擇符合／不符合／不適用、填寫實測值、嚴重度、註解與原因，以及自動判定、缺失流程：屬 0.7.x 現場規格；本規格只定義範本的實測欄位結構，不定義現場填值或結果行為（依 [KD-37](../../intents/03-decisions-and-stack.md#kd-37)、[KD-52](../../intents/03-decisions-and-stack.md#kd-52)、[KD-54](../../intents/03-decisions-and-stack.md#kd-54)）。
- Evidence 上傳與照片檔案儲存：移至 `field-evidence`（P6）；本規格只定義範本中的照片需求。
- 報告版面與 `Report Template`：移至 `report-delivery`（P8）。查核範本不等於報告範本，報告範本的版本規則不受本規格影響。
- 範本建議、審核與核准流程：移至 0.6.x（#314，依負責人最新指示）。
- interval 欄位及依間距自動切分任務：MVP 不需要；未來若提出選用功能，再依 [G-01](../../intents/05-open-questions.md#g-01) 裁定其歸屬與快照規則。

## 使用情境

- 範本管理員在範本庫建立工程類別與系統，並維護單一查核項目或整個系統的範本內容。
- 範本管理員可查看所有專案，並將任一專案的查核項目存成查核範本。
- 有權限編輯目標專案查核項目的人，選擇套用單一查核項目或整個系統；系統複製結構到該專案並記錄來源範本名稱與套用時間。
- 內業依專案需要從範本套用，或不使用範本而從零建立查核項目。

## 需求

用「必須／應／得」，每條附依據；來源只是建議的，不得寫成「必須」。本表列出本規格負責的行為；範本實體與全系統角色／指派模型由本規格定義，其他共用領域實體欄位定義歸 `domain-model`。

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| TPL-R01 | 系統**必須**提供獨立於專案的查核範本庫；專案**得**套用範本，也**得**從零建立自己的查核項目。 | 必須／得 | [KD-47](../../intents/03-decisions-and-stack.md#kd-47) |
| TPL-R02 | `Inspection Template` 修改時**必須**直接覆蓋，只保留最新內容；不得建立或使用 `Template Version`。 | 必須／不得 | [KD-03](../../intents/03-decisions-and-stack.md#kd-03)、[PR-04](../../intents/02-principles.md#pr-04) |
| TPL-R03 | 範本管理**必須**支援兩層分類「工程類別 → 系統」，其下為查核項目；工程類別、系統及同一系統下查核項目的名稱欄位（項目為 `Template Item.title`），去除前後空白並忽略大小寫後，在各自父層內**必須**唯一。衝突回 HTTP 409、`template.name_conflict`。不同父層可有同名項目；目前使用名稱，不設代號。 | 必須 | [KD-48](../../intents/03-decisions-and-stack.md#kd-48)；欄位、正規化、唯一性與錯誤碼為本規格設計（見[設計決定](#design-decisions)）。 |
| TPL-R04 | 查核範本**必須**只保存結構資料：分類、查核項目、查核項次、檢查標準、實測欄位定義與照片需求；**不得**保存現場結果、實測值或照片。API 的 `templates` 資源與一筆 `Template Item` 一對一，代表一個查核項目，建立時帶所屬 `system_id`；整個系統是以 `system_id` 為範圍的一組操作，不是獨立範本實體。 | 必須 | [KD-47](../../intents/03-decisions-and-stack.md#kd-47)、[KD-48](../../intents/03-decisions-and-stack.md#kd-48)；資源單位為本規格設計。 |
| TPL-R05 | `Template Item` **必須**有 `sequence`、`title`、`instruction`；其下**得**有多個查核項次，每個查核項次由內業預先設定。MVP 不要求 interval，也不依 interval 自動產生查核點。 | 必須／得 | 架構基準 §12.5；[KD-36](../../intents/03-decisions-and-stack.md#kd-36)、[KD-37](../../intents/03-decisions-and-stack.md#kd-37)、[G-01](../../intents/05-open-questions.md#g-01) |
| TPL-R06 | 每個查核項次**得**選擇文字標準或數值標準。文字標準按計畫書原文記錄，不解析條件；數值標準包含標準值、條件（`≤`、`≥`、`＝` 或範圍）、單位與容許誤差。範本只定義標準與實測欄位，不記錄實測值或自動判定結果。 | 得 | [KD-37](../../intents/03-decisions-and-stack.md#kd-37)、[KD-52](../../intents/03-decisions-and-stack.md#kd-52) |
| TPL-R11 | 每個查核項次**得**設定多個實測欄位；每欄由內業設定為文字或數字。數字欄位**必須**有單位。每個數值標準**必須**綁定該項次的一個數字實測欄位；有數值標準時**必須**有綁定欄位，一個數字欄位最多綁定一個數值標準。僅被綁定欄位的單位**必須**與該數值標準相同，並由系統自動帶入、不得另設；其他數字欄位由內業自設單位。範本只定義欄位，不保存現場填值；單位換算由現場自行處理。 | 得／必須／不得 | [KD-37](../../intents/03-decisions-and-stack.md#kd-37)、[KD-52](../../intents/03-decisions-and-stack.md#kd-52)、[KD-54](../../intents/03-decisions-and-stack.md#kd-54)（已由 [#332](https://github.com/speko-tw/inspect-flow/issues/332)／[PR #333](https://github.com/speko-tw/inspect-flow/pull/333) 記錄；原始依據為負責人[#76 留言](https://github.com/speko-tw/inspect-flow/issues/76#issuecomment-5965931420)）；綁定方式與限制為本規格設計（見 TPL-Q8） |
| TPL-R07 | MVP 的 `Evidence Requirement` **必須**支援照片需求，Evidence 類型固定為照片。每個查核項次**必須**至少有一筆必填照片需求，`min_count` 至少為 1 且不設最大數量；照片需求**不得**在程式中針對特定項目寫死。範本結構不設總覽照片欄位；`overview`、`is_overview` 等總覽標記不屬範本欄位，因此不能用總覽照滿足項次的最低照片需求。現場照片覆蓋行為（每個查核項次至少一張非總覽照片、一張照片可覆蓋多個項次、總覽照片由現場選拍且不計入最低數量、照片數無上限）由 P6 `field-evidence` 驗收，追蹤於 [#105](https://github.com/speko-tw/inspect-flow/issues/105)。 | 必須／得／不得 | [PR-09](../../intents/02-principles.md#pr-09)、[KD-38](../../intents/03-decisions-and-stack.md#kd-38)、[KD-48](../../intents/03-decisions-and-stack.md#kd-48)、[KD-50](../../intents/03-decisions-and-stack.md#kd-50)、[KD-53](../../intents/03-decisions-and-stack.md#kd-53)、[OQ-05](../../intents/05-open-questions.md#oq-05) |
| TPL-R08 | 套用範本時**必須**複製所選單一查核項目，或 `system_id` 範圍內全部查核項目的結構，建立專案自己的查核項目副本；每筆副本沿用範本項目結構，並帶 `project_id`、來源範本名稱與套用時間。項次、標準、實測欄位及照片需求各自存於對應的專案端子表，並以 `project_inspection_item_id` 外鍵連至副本，不以 JSON 欄位保存。單項套用的來源名稱為項目 `title`；系統套用的來源名稱為系統名稱，同次套用的各副本記錄相同來源名稱與時間。此後修改或刪除來源範本**不得**改動已套用的專案內容。P4 `inspection-planning` 得擴充副本欄位，並定義修改後的作廢／重查／更正流程。 | 必須／不得 | [KD-03](../../intents/03-decisions-and-stack.md#kd-03)、[KD-47](../../intents/03-decisions-and-stack.md#kd-47)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)；最小副本表與來源名稱選擇為本規格設計。 |
| TPL-R09 | 系統**必須**有固定的全系統角色代碼 `template_admin`（範本管理員），以程式內 enum／常數表示；MVP 角色清單不得由 Admin 自訂，不建立角色定義資料表或 seed。`SystemRoleAssignment` 指派表記錄 `user_id` 與角色代碼；Admin 指派或收回角色**必須**寫稽核紀錄，事件代碼與欄位依 [audit-log 的 `template-system` 事件目錄](../audit-log/spec.md#template-system-事件)。Admin 與範本管理員均可新增、修改、刪除分類、系統與查核範本，並將可跨專案查看的查核項目存成範本；範本管理員可查看所有專案，Admin 依既有權限亦可。一般專案成員（包括專案管理者）不得管理範本庫或跨專案查看查核項目。此角色與 `Role`、`ProjectMember`、`is_admin` 並存且互相獨立；套用範本由具目標專案查核項目編輯權限 `project_inspection_item.edit` 者執行，不要求範本管理員身分。 | 必須／得 | [KD-24](../../intents/03-decisions-and-stack.md#kd-24)、[KD-27](../../intents/03-decisions-and-stack.md#kd-27)、[KD-29](../../intents/03-decisions-and-stack.md#kd-29)、[KD-49](../../intents/03-decisions-and-stack.md#kd-49)、[KD-60](../../intents/03-decisions-and-stack.md#kd-60)；Admin 放行為負責人指示（[#387](https://github.com/speko-tw/inspect-flow/issues/387)）。 |
| TPL-R10 | 所有本規格 API **必須**遵守 `api-conventions`，使用 `/api/v1` 路徑、UUID 資源識別、JSON 請求／回應與共用錯誤格式，並由後端依 TPL-R09 執行授權。分類與系統均提供新增、改名及刪除；分類下仍有系統或系統下仍有範本時均**必須**拒絕刪除並回 HTTP 409，錯誤碼分別為 `template.category_not_empty`、`template.system_not_empty`。 | 必須 | [API-R01](../api-conventions/spec.md#需求)、[API-R02](../api-conventions/spec.md#需求)、[API-R03](../api-conventions/spec.md#需求)、[API-R05](../api-conventions/spec.md#需求)、[API-R06](../api-conventions/spec.md#需求)；路徑、錯誤碼與刪除行為為本規格設計。 |
| TPL-R12 | 範本管理 UI **必須**納入 MVP，提供管理範本分類、系統與範本內容的能力。 | 必須 | 本規格範圍設計；依據架構基準 §12.3–12.7 及 [KD-47](../../intents/03-decisions-and-stack.md#kd-47)。 |
| TPL-R13 | 數值標準的 `range` 條件**必須**擇一使用 `range_form`：`interval` 使用 `lower_bound`、`upper_bound`，且下限不得大於上限；`tolerance` 使用 `value`、`tolerance`，且容許誤差不得小於零。舊版請求省略 `range_form` 時預設為 `tolerance`，此時容許誤差為 `null`、空字串或省略時補 `0`；明填 `range_form: null` 不視為省略，明填 `range_form: tolerance` 時容許誤差仍必填。兩種形式不得混填。非 `range` 條件維持 `value` 與原有可選 `tolerance`，不得填形式或上下限；所有數字均須為有限值。兩種形式均沿用 TPL-R11 的欄位綁定與單位自動帶入。 | 必須／不得 | [KD-52](../../intents/03-decisions-and-stack.md#kd-52)；欄位、驗證與舊請求預設為本規格設計。 |
| TPL-R14 | 套用範本前，系統**必須**將待套用項目的 `title` 與同一專案既有項目名稱比較，去除前後空白並忽略大小寫；有任何同名時整次拒絕，不寫入單項或整個系統的任何新項目，回 HTTP 409 `project_inspection_item.duplicate_name`，`error.details` 列出衝突的範本項目名稱。 | 必須 | [KD-47](../../intents/03-decisions-and-stack.md#kd-47)；比對與錯誤契約為本規格設計。 |

## 資料

兩層分類、`Template Item`（每筆帶 `system_id`，與 API `templates` 資源一對一）、查核項次、檢查標準、實測欄位定義、`Evidence Requirement`、最小專案副本表 `ProjectInspectionItem` 與 `SystemRoleAssignment` 由本規格定義；其他共用實體欄位由 `domain-model` 定義。不新增角色定義資料表或 `Template Version`。系統是分類節點；以 `system_id` 操作該系統下全部項目時，這只是操作範圍，不是另一種範本實體。`ProjectInspectionItem` 複製範本項目的結構，另含 `project_id`、來源範本名稱與套用時間；項次、標準、實測欄位及照片需求各自存於對應的專案端子表，並以 `project_inspection_item_id` 外鍵連至副本，不以 JSON 欄位保存。P4 `inspection-planning` 得在此基礎擴充欄位，並定義後續作廢／重查／更正流程。

`Evidence Requirement` 依架構基準 §12.6 含 `type`、`required`、`min_count`、`max_count`；照片的實際規則由 KD-50 覆蓋：每項次最少一張、沒有張數上限，故照片不設有效的 `max_count` 上限。MVP 的 Evidence 類型只有照片，沒有 `TEXT` 類型；若未來需要文字或其他 Evidence 類型，另開規格處理（[OQ-20](../../intents/05-open-questions.md#oq-20)、[KD-53](../../intents/03-decisions-and-stack.md#kd-53)）。

## 介面

所有路徑依 [api-conventions](../api-conventions/spec.md)；以下資源路徑是規格提案，具體欄位與回應格式沿用共用契約。授權失敗沿用 API 共用錯誤格式。

| 方法 | 路徑 | 用途 | 權限 |
|---|---|---|---|
| GET | `/api/v1/template-categories` | 列出工程類別 | Admin、範本管理員或具任一專案查核項目編輯權限者 |
| POST | `/api/v1/template-categories` | 建立工程類別 | Admin 或範本管理員 |
| PATCH | `/api/v1/template-categories/{category_id}` | 改名工程類別 | Admin 或範本管理員 |
| DELETE | `/api/v1/template-categories/{category_id}` | 刪除工程類別；其下仍有系統時回 409 `template.category_not_empty` | Admin 或範本管理員 |
| GET | `/api/v1/template-categories/{category_id}/systems` | 列出類別下系統 | Admin、範本管理員或具任一專案查核項目編輯權限者 |
| POST | `/api/v1/template-categories/{category_id}/systems` | 建立系統 | Admin 或範本管理員 |
| PATCH | `/api/v1/template-systems/{system_id}` | 改名系統 | Admin 或範本管理員 |
| DELETE | `/api/v1/template-systems/{system_id}` | 刪除系統；其下仍有查核項目時回 409 `template.system_not_empty` | Admin 或範本管理員 |
| GET | `/api/v1/template-systems/{system_id}/templates` | 依 cursor 分頁讀取系統下的範本，每筆含完整項次、標準、實測欄位及照片需求 | Admin、範本管理員或具任一專案查核項目編輯權限者 |
| PUT | `/api/v1/template-systems/{system_id}/templates` | 在單一交易中覆蓋系統下的範本集合；保留 body 中有既有 `id` 的項目，刪除未列出的項目並建立沒有 `id` 的項目 | Admin 或範本管理員 |
| GET | `/api/v1/templates` | 查詢範本與查核項目 | Admin、範本管理員或具任一專案查核項目編輯權限者 |
| POST | `/api/v1/templates` | 建立一筆查核項目範本；body 必含 `system_id` | Admin 或範本管理員 |
| GET | `/api/v1/templates/{template_id}` | 讀取範本結構 | Admin、範本管理員或具任一專案查核項目編輯權限者 |
| PUT | `/api/v1/templates/{template_id}` | 覆蓋目前範本內容 | Admin 或範本管理員 |
| DELETE | `/api/v1/templates/{template_id}` | 刪除範本 | Admin 或範本管理員 |
| POST | `/api/v1/projects/{project_id}/inspection-items:apply-template` | body 擇一帶 `template_id`（單項）或 `system_id`（複製該系統下全部項目）；同專案同名項目回 409 與衝突名稱清單且整次不寫入；有效但沒有項目的系統回 `200` 與空清單 | 具該專案 `project_inspection_item.edit` 權限者 |
| POST | `/api/v1/projects/{project_id}/templates` | 將該專案的一筆查核項目存成範本；body 必含 `project_inspection_item_id` 與目標 `system_id` | Admin 或範本管理員 |
| GET | `/api/v1/projects/{project_id}/inspection-items` | 依 cursor 分頁列出專案查核項目，每筆含完整巢狀結構、來源範本名稱與套用時間 | 該專案成員、Admin 或範本管理員；跨專案瀏覽限 Admin 或範本管理員 |
| GET | `/api/v1/projects` | 沿用既有專案列表 API；Admin 或範本管理員可列出全部專案 | Admin 或範本管理員；其他非 Admin 回 403 |
| PUT | `/api/v1/system-role-assignments/template_admin/{user_id}` | 指派固定代碼 `template_admin` 給使用者；已指派時仍回 204 | Admin |
| DELETE | `/api/v1/system-role-assignments/template_admin/{user_id}` | 收回使用者的 `template_admin` 指派；尚未指派時回 404 | Admin |

`GET /api/v1/projects` 維持 AUT-R20 的 Admin 存取；新增範本管理員可列出全部專案，其他非 Admin（包括一般專案成員及無專案權限者）仍回 403，不提供過濾列表。回歸驗收確認 Admin 與範本管理員可取得全部專案，其他非 Admin 拒絕。名稱衝突回 `template.name_conflict`（409）；分類有系統時回 `template.category_not_empty`（409）；系統有查核項目時回 `template.system_not_empty`（409）。

`POST /api/v1/projects/{project_id}/templates` 的 body 必含 `project_inspection_item_id` 與目標 `system_id`；來源項目必須屬於路徑指定的專案。系統以專案副本的結構欄位建立獨立範本；目標系統中去除前後空白且不分大小寫後同名的項目回 `409 template.name_conflict`。成功建立時寫入 `template_item.created_from_project` 稽核事件。專案查核項目列表以 `created_at`、`id` 升冪分頁，回 `{items, next_cursor}`，無下一頁時 `next_cursor` 為 `null`。一般登入者依 `require_project_permission` 檢查專案成員權限；非成員或不存在的專案都回 `403 permission.denied`。Admin 與範本管理員可讀取全部專案，指定的專案不存在時回 `404 resource.not_found`。

範本結構寫入時，每個實測欄位以請求內的 `client_id`（UUID）供同項次的數值標準用 `measurement_field_client_id` 綁定；此識別只用於一次請求，資料表 `id` 由後端產生，回應以 `id` 與 `measurement_field_id` 表示持久識別。整份範本及整系統覆蓋請求內的 `client_id` 不得重複。項目與項次的 `sequence` 限 1～32767；數值標準凡有填入的數字欄位均必須是有限數字，所有數字單位去除前後空白後不得為空。這些輸入不合法時回 422 與共用驗證錯誤格式。Admin 讀取範本庫沿用 [AUT-Q2](../authentication/spec.md#aut-q2) 的所有專案權限放行裁定，不授予範本寫入權限。

數值標準 `condition=range` 時請求得省略 `range_form`，省略時預設為 `tolerance`，且 `tolerance` 為 `null`、空字串或省略時補 `0`；明填 `range_form: null` 則回 422，明填 `range_form: tolerance` 時容許誤差必填且不得為空。`interval` 僅填上下限，`value` 與 `tolerance` 為 `null`；`tolerance` 形式僅填標準值與非負容許誤差，上下限為 `null`。其他條件的 `range_form` 與上下限均為 `null`。既有 `range` 資料遷移為 `tolerance` 形式；舊容許誤差為空時補 `0`。範本與專案副本的讀取回應皆提供形式及上下限；套用和存成範本時保留這些欄位。

指派 `template_admin` 的 PUT 是冪等操作：使用者已被指派時回 204，不新增稽核紀錄；並行重複指派遇到相同唯一鍵衝突時，確認指派已存在後亦回 204，不重複寫稽核。收回尚未指派的角色回 404。

## 驗收條件

以下條件涵蓋本規格的凍結範圍。OQ-06 已裁定的現場結果語意屬 0.7.x，本規格只驗收實測欄位定義。

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| TPL-AC01 | 範本管理員與一般專案編輯者各一人 | 一般編輯者建立範本、範本管理員建立範本 | 一般編輯者被拒絕；範本管理員可建立範本 | TPL-R01、TPL-R09 |
| TPL-AC02 | 已有含前後空白或大小寫差異的工程類別、系統及查核項目名稱 | 建立正規化後同名的分類、系統或同系統項目，再於不同父層建立同名 | 去除前後空白並忽略大小寫後，同一父層名稱衝突回 409 `template.name_conflict`；不同父層同名可建立；資料沒有分類代號欄位 | TPL-R03 |
| TPL-AC03 | 範本含具 `sequence`、`title`、`instruction` 的查核項目、項次、文字及數值標準、照片需求 | 儲存後讀回範本 | 所有結構一致；沒有現場結果、照片檔或 interval 欄位 | TPL-R04、TPL-R05、TPL-R06、TPL-R07 |
| TPL-AC04 | 範本管理員儲存一份範本 | 更新同一範本，再讀取 | 回傳更新後唯一現行內容；沒有版本記錄或 `Template Version` | TPL-R02 |
| TPL-AC05 | 一個 `system_id` 下有多個查核項目，另有單一項目範本；另有一個沒有查核項目的有效系統 | 分別以 `system_id` 與 `template_id` 套用到專案 | 可套用單項與整個系統；每筆 `ProjectInspectionItem` 複製項目結構並保存 `project_id`、套用時間及來源範本名稱（單項用 `title`、系統用系統名稱）；來源變更不影響副本；套用沒有查核項目的有效系統回 `200` 與空清單 | TPL-R04、TPL-R08 |
| TPL-AC06 | 專案已套用範本，另有 Admin 或範本管理員 | 覆蓋或刪除來源範本，檢查專案副本；Admin 或範本管理員再讀取及存成範本 | 專案副本不變；Admin 或範本管理員能查看所有專案並把任一專案項目存成範本 | TPL-R08、TPL-R09 |
| TPL-AC07 | 項次含文字標準、數值標準及照片需求 | 儲存並讀回定義，檢查範本結構與允許欄位 | 文字標準不解析；數值標準不接受實測值或自動判定；每個項次至少有一筆必填的照片需求，`min_count >= 1`、無最大數量且只接受照片類型；範本不接受 `overview`、`is_overview` 等總覽標記，故總覽照不能滿足項次最低數量。現場拍照覆蓋、跨項次共用照片與總覽照選拍行為由 P6 `field-evidence` #105 驗收 | TPL-R05、TPL-R06、TPL-R07 |
| TPL-AC08 | 已登入 Admin、範本管理員、一般專案成員（含專案管理者）、無專案權限者 | 呼叫範本分類、系統、單項與整系統寫入端點、存成範本、跨專案查核項目列表及 `GET /api/v1/projects`；改名／刪除分類與系統；指派或收回全系統角色 | Admin 與範本管理員可執行全部範本庫寫入、存成範本及跨專案瀏覽；Admin 與範本管理員可列出全部專案，其他非 Admin 回 403；只有 Admin 可指派或收回固定角色且成功後留下稽核紀錄；專案成員（含專案管理者）可瀏覽與套用有權限的範本，但不能寫入範本或跨專案瀏覽；分類下有系統或系統下有查核項目時刪除分別回 409 與對應錯誤碼；API 符合共用慣例 | TPL-R09、TPL-R10 |
| TPL-AC09 | 項次有多個文字或數字實測欄位，且設有數值標準 | 儲存並讀回範本欄位定義，另嘗試省略綁定欄位、綁文字欄位或讓一個數字欄位綁兩個標準 | 每個數字欄位都有單位；每個數值標準必須綁定該項次的一個數字欄位，有數值標準時不得缺少綁定欄位；一個數字欄位最多綁一個數值標準；只有綁定欄位的單位與標準相同並由系統帶入、不可另設；其他數字欄位可自設單位；非法關聯被拒絕；範本不含現場實測值或單位換算 | TPL-R11 |
| TPL-AC10 | Admin 或範本管理員已登入且範本庫有工程類別、系統及範本 | 使用 MVP 範本管理 UI 新增、改名、預覽及刪除分類、系統與範本 | 管理 UI 可完成分類與範本管理；分類下有系統或系統下有查核項目時刪除被拒絕，並顯示對應的 409 錯誤 | TPL-R10、TPL-R12 |
| TPL-AC11 | 數值標準分別採區間與標準值加減誤差，且資料庫已有舊 `range` 資料 | 建立、更新、讀取、套用及存成範本；另測試省略形式且誤差為空的舊請求、上下限反序、負誤差、缺欄位與欄位混填 | 兩種合法形式完整保留；省略形式預設 `tolerance` 且空誤差補 `0`；明填形式時空誤差及其他非法輸入回 422；舊資料遷移為 `tolerance`，空誤差補 `0`；實測欄位綁定與單位規則不變 | TPL-R11、TPL-R13 |
| TPL-AC12 | 專案已有與待套用項目去空白且不分大小寫後同名的項目 | 套用單項或含衝突項目的整個系統 | 回 409 `project_inspection_item.duplicate_name`，`error.details` 列出衝突名稱，整次不新增任何項目 | TPL-R14 |

### 範本管理介面（#427）

以下介面行為由負責人直接指示（[#427 定案留言](https://github.com/speko-tw/inspect-flow/issues/427#issuecomment-5981195507)，原型核可 2026-10-04）。互動細節屬規格設計（非負責人裁定）；版面、文案及操作次序依核可原型與本次工作單。

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| TPL-R15 | 範本管理 UI **必須**以桌面左側階層導覽、右側詳情呈現工程類別、系統與查核項目；手機先顯示清單，選取後顯示詳情並提供返回。新增與重新命名須使用分開入口；同一父層名稱須在送出前檢查，欄位錯誤顯示於欄位旁。 | 必須 | 負責人直接指示（#427）；介面細節為規格設計。 |
| TPL-R16 | 查核項目編輯 UI **必須**以單頁分段卡片呈現基本資料、查核項次、各項次的「要記錄什麼 → 判定標準 → 照片」及即時預覽；不得以逐步精靈隱藏未作用中的區段。查核項次卡片**必須**可展開或收合，摘要顯示項次名稱；即時預覽在同頁可見。新增項目預設一張空白查核項次卡，不預設實測欄位。選擇數值標準且沒有數字欄位時，**必須**新增可見的數字欄位；僅有一個數字欄位時自動綁定，多個時由管理者選擇。 | 必須 | 負責人直接指示（#427）；介面細節為規格設計。 |
| TPL-R17 | 數字欄位單位**必須**由實測欄位編輯；欄位綁定數值標準後仍可在該欄位編輯單位，標準區顯示帶入的單位。綁定欄位不得直接刪除或改為文字型別，須先解除綁定並說明原因。寫入時綁定欄位的 `unit` **必須**為 `null`，其數值標準 `unit` **必須**取自該欄位，以符合 TPL-R11。 | 必須 | 負責人直接指示（#427）；欄位關聯與畫面互動為規格設計；單位來源依 TPL-R11。 |
| TPL-R18 | 前端在送出前**必須**驗證必填名稱、數字欄位單位、數值標準、照片數與區間界限；錯誤顯示在對應欄位並聚焦、捲動至第一個錯誤，並顯示待修正數量與可聚焦欄位的錯誤摘要。後端 422 未提供可用欄位路徑時，UI **必須**保留草稿並顯示一般錯誤，不得推測欄位位置。切換選取對象時若草稿有變更，**必須**先提供保留編輯或捨棄變更的頁內選項。 | 必須 | 負責人直接指示（#427）；前端驗證及狀態互動為規格設計。 |
| TPL-R19 | 範本 `measurement_fields` 的陣列位置**必須**作為使用者排列順序持久化；讀取、更新、套用至專案、存回範本及建立任務快照時**必須**保留此順序。既有資料的遷移順序依原有 `created_at`、`id` 排序。 | 必須 | 規格設計（非負責人裁定）；#427 審查中發現的缺陷修正。 |
| TPL-R20 | 在查核項次新增第一個實測欄位時，若項次標題非空白，欄位名稱**必須**預填該標題，並在管理者手動修改欄位名稱前隨標題同步；手動修改後停止同步。編輯既有項目時，名稱與標題相同的欄位視為仍同步，不同則視為已手動修改。同步狀態只存在前端草稿，不得送入 API。 | 必須 | 負責人試用回饋（#444，2026-10-05）；細節為規格設計（非負責人裁定）。 |
| TPL-R21 | 項次標題為空白時新增實測欄位**不得**預填名稱，必填驗證維持不變；同一項次後續新增的欄位**不得**預填名稱，且焦點**必須**移至新欄位名稱。包含選擇數值標準所自動新增的第一個數字欄位，亦依 TPL-R20 預填。 | 不得／必須 | 負責人試用回饋（#444，2026-10-05）；細節為規格設計（非負責人裁定）。 |
| TPL-R22 | 查核項次卡片**必須**維持手風琴互動。儲存驗證失敗時，UI **必須**將當下所有有錯誤的項次展開並聚焦第一個錯誤；使用者輸入期間，卡片展開狀態**不得**隨即時驗證結果改變。使用者點擊已展開項次可手動收合；點擊收合項次或新增項次時，該項次成為目前展開項次，仍有錯誤的項次保持展開，已無錯誤的項次收合。儲存成功或離開編輯器時清除錯誤展開狀態。 | 必須 | 負責人試用回饋（#444，2026-10-05）；細節為規格設計（非負責人裁定）。 |
| TPL-R23 | 內業專案工作台的每張專案卡片**必須**提供醒目的「套用範本」入口；套用頁**必須**顯示專案代號與名稱、不顯示 UUID，並以階層導覽選擇類別、系統及項目。單項或整個系統的預覽須顯示新增數量、每個項目的白話摘要、項次的文字／數值標準及照片需求，並說明副本不隨範本更新；整個系統多於一項時，送出前須頁內確認。套用成功後回到專案查核項目；同名 409 顯示「已套用過『X』，本次沒有新增任何項目」及「改選其他範本／返回專案」出口。手機版須採單欄清單→詳情導覽，詳情提供返回選擇且保留樹狀展開及選取狀態。存為範本須標示來源項目、提供系統層目的地預覽，且不得提供名稱欄；同名 409 須保留來源與所選系統，並可改選系統。Field 首頁不得提供範本入口。 | 必須 | 負責人直接指示（#429，原型核可 2026-10-05）；頁面配置、文案、互動細節及手機卡片樣式為規格設計（非負責人裁定）。 |
| TPL-AC13 | 桌面範本庫含空資料、至少一個類別、系統與項目；手機寬度為 360px | 新增／改名類別或系統、選取階層節點並在手機往返清單與詳情 | 空狀態引導新增；詳情及選取狀態正確；新增與改名入口分開；同父層重複名稱與空名稱顯示欄位錯誤；手機返回後選取與展開位置保留 | TPL-R15 |
| TPL-AC14 | 管理者新增查核項目或編輯既有項目 | 開啟編輯器並新增項次、欄位、標準與照片數 | 基本資料、所有查核項次卡片、實測欄位、判定標準、照片需求及即時預覽同頁可見；項次卡片可收合並以標題作摘要；新項目有一張空白項次卡且沒有實測欄位；數值標準按需新增數字欄位；唯一數字欄位自動綁定，多個數字欄位須明選 | TPL-R16 |
| TPL-AC15 | 項次有數值標準及綁定數字欄位 | 編輯單位、重綁，並儲存新增或修改的單項 | 綁定欄位單位輸入保持可編輯；標準顯示同一單位；改型別或刪除綁定欄位時顯示解除綁定原因；單項 CRUD 呼叫 `/templates` 對應端點，綁定欄位送 `unit: null` 且標準送欄位單位，不以整系統 PUT 儲存單項 | TPL-R11、TPL-R17 |
| TPL-AC16 | 查核項目包含空白必填欄位、反序上下限、負容許誤差或無效照片數，或後端回 422／403 | 儲存或在有未儲存草稿時切換節點 | 本地錯誤在欄位下顯示、第一個錯誤獲得焦點並捲動至可見位置、摘要可聚焦對應欄位；後端錯誤保留草稿且 422 僅顯示一般訊息；403 切換唯讀並保留草稿；切換節點先提供保留或捨棄選擇 | TPL-R18 |
| TPL-AC17 | 範本項次有多個以特定順序排列的實測欄位，並在 migration 前建立範本、專案副本及任務快照資料與數值標準 | 儲存、讀回、更新、套用至專案、存回範本並建立任務快照；對含資料資料庫執行 migration upgrade、downgrade、再 upgrade | 各階段欄位順序均與原排列相同；upgrade、downgrade、再 upgrade 後範本／專案副本／任務快照的測量欄位及數值標準筆數與內容均保留；既有資料依遷移前的 `created_at`、`id` 順序回填 | TPL-R19 |
| TPL-AC18 | 新增查核項次，標題為空白或已有標題；另有一個既有項次，其欄位名稱分別與標題相同或不同 | 新增第一個欄位、修改標題、手動修改名稱後再改標題，並開啟既有項目 | 第一個欄位依 TPL-R20 預填與同步；手動修改後不再跟隨；既有欄位依名稱相同與否判定同步；空白標題不預填；同步狀態不出現在 POST／PUT payload | TPL-R20、TPL-R21 |
| TPL-AC19 | 一個項次已有實測欄位，且可新增另一欄；另在沒有數字欄位時選擇數值標準 | 新增第二個欄位，或由數值標準自動新增第一個數字欄位 | 第二個欄位名稱為空且焦點位於名稱欄；自動新增的第一個數字欄位依標題預填；空白標題仍須通過原必填驗證 | TPL-R20、TPL-R21 |
| TPL-AC20 | 查核項次 1、3 有驗證錯誤，項次 2 無錯誤；目前展開項次可為項次 1，也可為 `null` | 儲存後分別在項次 1（目前展開）及項次 1（目前展開為 `null`）連續輸入 `AB`，另在項次 3 連續輸入 `XY`；修正項次 3 後展開項次 2；手動收合一張仍有錯誤的卡片 | 儲存失敗後項次 1、3 展開並聚焦第一個錯誤；輸入期間標題完整保留、卡片保持展開且焦點仍在輸入框；展開項次 2 後仍有錯誤的項次 1 保持展開，已修正的項次 3 收合；使用者可手動收合錯誤卡片 | TPL-R22 |
| TPL-AC21 | 專案有可套用項目，且使用者有 `project_inspection_item.edit` 權限；另有專案內同名項目 | 以 1280px 和 360px 檢視套用頁，分別預覽並套用單項、預覽含多項的整個系統、觸發同名 409，再使用兩個出口 | 頁首只顯示專案代號及名稱；預覽列出新增數量、白話項目摘要、項次文字／數值標準、照片需求及副本固定說明；多項系統出現頁內確認且確認後才送出；成功回到專案並看見新項目；手機使用清單→詳情單欄導覽，返回後保留樹狀展開／選取；409 顯示「已套用過『X』，本次沒有新增任何項目」，改選可重新選取，返回可回專案；403 後維持唯讀且不得送出 | TPL-R08、TPL-R09、TPL-R14、TPL-R23 |
| TPL-AC22 | 專案含可存為範本的查核項目，且目標系統含同名範本；內業專案清單含專案 | 從專案項目啟動存為範本，選擇衝突系統後改選其他系統；在 360px 開啟專案工作台 | 標題顯示來源項目且沒有名稱欄；導覽最多展開到系統層，目的地預覽正確；手機以清單→詳情單欄導覽並可返回選擇；409 後來源與系統選取保留，改選系統後衝突訊息清除且可成功存入；手機每個專案以獨立卡片呈現，主要「套用範本」按鈕可見且不需水平捲動；Field 首頁無範本入口 | TPL-R09、TPL-R23 |

<a id="design-decisions"></a>
## 設計決定

以下是本規格為可實作性作出的設計決定，不是負責人裁定；初期細節依常見做法先定，之後可依使用經驗迭代。

| 原待釐清項目 | 決定 | 理由 | 依據 |
|---|---|---|---|
| TPL-Q1 名稱與歸屬 | 名稱去除前後空白、比對不分大小寫；工程類別在根層唯一、系統在所屬工程類別內唯一、查核項目 `title` 在所屬系統內唯一，衝突回 `template.name_conflict`（409）。系統是分類節點；`templates` 資源各代表一個帶 `system_id` 的查核項目；以 `system_id` 執行的整系統操作只是指定項目集合。 | 同一父層避免視覺上相同名稱造成選錯；明確的資源單位與系統範圍讓 CRUD 和批次套用使用同一模型。 | KD-48；架構基準 §12.3–12.5；欄位、錯誤碼與資源單位為規格設計。 |
| TPL-Q2 全系統角色 | MVP 固定只有 `template_admin`（範本管理員），以程式內 enum／常數表示；不建角色定義表或 seed。`SystemRoleAssignment` 只記 `user_id` 與角色代碼。Admin 指派或收回均寫稽核紀錄；是否可自訂定為 MVP 不提供，未來需要時另開規格。 | 固定單一角色可避免為尚無其他需求的角色清單引入管理表、種子時序及不可取得的 role ID。 | KD-24、KD-27、KD-29、KD-49；固定清單與實作方式為規格設計（非負責人裁定）。 |
| TPL-Q3、TPL-Q6 專案副本責任 | 本規格定義並建立 0.3.x 最小 `ProjectInspectionItem`：複製一筆範本項目及其巢狀結構，另含 `project_id`、來源範本名稱、套用時間。單項套用的來源名稱取 `title`；整系統套用取系統名稱。P4 `inspection-planning` 得擴充副本欄位，並定義修改後的作廢、重查或更正流程。 | KD-55 將後續作廢／重查／更正流程交由 P4；目前實作套用仍須有穩定的最小目標資料表。 | KD-03、KD-47、KD-55（依 PR #335）；最小表與名稱來源為規格設計。 |
| TPL-Q4 Evidence `TEXT` | MVP 不建立 `TEXT` Evidence 類型，只支援照片；未來如需文字或其他類型，另開規格。 | OQ-20／KD-53 將 MVP 範圍限為照片，避免規格資料模型超出已定 MVP 邊界。 | OQ-20、KD-53；架構基準 §12.6。 |
| TPL-Q7 API 與管理 UI | 採本規格「介面」列出的 `/api/v1` 資源路徑；分類與系統支援新增、改名、刪除，分類有系統或系統有項目時回指定 409；角色指派以固定代碼操作。`GET /api/v1/projects` 維持 AUT-R20 的 Admin 放行，新增範本管理員可讀取全部專案，其他非 Admin 維持 403，依 TPL-AC08 回歸。範本管理 UI 納入 MVP（T5）。 | 明確固定資源路徑、拒絕條件與授權分支，讓 API、授權與 UI 任務依同一契約拆分。 | API-R01～API-R09；KD-49；架構基準 §12.3–12.7；授權分支為規格設計。 |
| TPL-Q8 數值標準綁定 | 每個數值標準必須綁定同一項次的一個數字實測欄位；有數值標準時必須存在綁定欄位；一個數字欄位最多綁定一個數值標準。被綁欄位沿用標準單位，其他數字欄位自行設定單位。 | 單一明確欄位避免標準對應值含糊；限制一對一關聯可以維持單位來源唯一。 | KD-37、KD-52、KD-54；原始單位裁定見 [#76 留言](https://github.com/speko-tw/inspect-flow/issues/76#issuecomment-5965931420)。 |


## 變更紀錄

- TPL-R20～TPL-R22、TPL-AC18～TPL-AC20：依負責人試用回饋補充實測欄位名稱預填與項次卡手風琴行為；細節為規格設計（非負責人裁定）— [#444](https://github.com/speko-tw/inspect-flow/issues/444)。
- TPL-R23、TPL-AC21～TPL-AC22：依 #429 核可原型補充專案套用與存為範本流程；介面細節為規格設計（非負責人裁定）。
- TPL-R22／TPL-AC20：依第 3 輪審查明確手風琴展開狀態轉移與輸入期間的穩定性 — [PR #453 第 3 輪審查](https://github.com/speko-tw/inspect-flow/pull/453#pullrequestreview-5411083162)。
- 對齊 #375 路線圖，將 Report Delivery 更新為 P8，並將範本建議、審核與核准流程更新為 0.6.x — [#375](https://github.com/speko-tw/inspect-flow/issues/375)

- 單位規則的意圖已由 [#332](https://github.com/speko-tw/inspect-flow/issues/332)／[PR #333](https://github.com/speko-tw/inspect-flow/pull/333) 記錄（KD-54 已合併；原始來源為負責人[#76 留言](https://github.com/speko-tw/inspect-flow/issues/76#issuecomment-5965931420)）。本規格依此將數值標準綁定一個數字欄位，並在 TPL-Q8 定案具體欄位關聯；單位換算仍由現場處理且不在本規格範圍。
- TPL-Q1～TPL-Q4、TPL-Q6～TPL-Q8 定案並凍結規格；模板管理、API、資料模型與套用責任依本規格明確分界 — #110（PR #335 後續）。
- 登記範本管理員角色指派／收回的稽核事件代碼與欄位，並引用 `audit-log` 事件目錄 — [#325](https://github.com/speko-tw/inspect-flow/issues/325)
- 澄清範本庫 Admin 讀取、整系統巢狀讀寫路徑、請求內實測欄位識別與驗證邊界 — [PR #345 第 1 輪審查](https://github.com/speko-tw/inspect-flow/pull/345#pullrequestreview-5401219325)。
- 範圍變更（負責人指示，#328）：有效但沒有查核項目的 system 套用回 HTTP 200 與空清單 — [#328 留言](https://github.com/speko-tw/inspect-flow/issues/328#issuecomment-5970915340)。
- 澄清專案查核項目列表的授權順序與不存在專案的回應，補足存成範本的結構複製與隔離驗收 — [PR #370 第 1 輪審查](https://github.com/speko-tw/inspect-flow/pull/370#pullrequestreview-5404213410)。
- TPL-R13～TPL-R14、TPL-AC11～TPL-AC12：依負責人裁定，範圍條件可擇一使用區間或標準值加誤差，同專案同名時整次拒絕套用並列出衝突項目 — [#313 留言](https://github.com/speko-tw/inspect-flow/issues/313#issuecomment-5974836112)、[#356](https://github.com/speko-tw/inspect-flow/issues/356)。
- #356 第 1 輪審查後，舊 `range` 列的空容許誤差轉為 `0`（視為精確值），避免新契約讀回後無法原樣儲存；舊版請求省略 `range_form` 時預設 `tolerance`，維持 T5 畫面的建立行為。這是相容性取捨；明填空形式仍回 422 — [PR #373 第 1 輪審查](https://github.com/speko-tw/inspect-flow/pull/373#pullrequestreview-5404511885)。
- #356 第 2 輪審查後，省略 `range_form` 的舊版 `range` 請求若容許誤差為空，也補 `0`；明填 `tolerance` 形式仍要求非空誤差，與資料遷移的取捨一致 — [PR #373 第 2 輪審查](https://github.com/speko-tw/inspect-flow/pull/373#pullrequestreview-5404582144)。
- 澄清 TPL-AC07：本規格驗收範本端的必填照片需求、最低數量、無上限、照片類型及沒有總覽照片需求欄位；現場照片覆蓋、跨項次共用與總覽照選拍行為移交 P6 `field-evidence` — [#105 留言](https://github.com/speko-tw/inspect-flow/issues/105#issuecomment-5977919739)。
- Admin 亦可管理範本庫並跨專案瀏覽、存成範本；一般專案成員（含專案管理者）仍不得寫入範本或跨專案瀏覽 — [#387](https://github.com/speko-tw/inspect-flow/issues/387)。
- 範本管理頁改採階層清單與詳情、單頁分段查核項目編輯、欄位錯誤定位及單項範本 CRUD；數值單位輸入維持在綁定欄位 — [#427 定案留言](https://github.com/speko-tw/inspect-flow/issues/427#issuecomment-5981195507)。
- TPL-R19、TPL-AC17：#427 第 1 輪審查確認實測欄位必須依使用者排列穩定讀回；既有欄位以原 `created_at`、`id` 順序回填。
- TPL-R19 的排序需求屬規格設計（非負責人裁定），為 #427 審查中發現的缺陷修正；TPL-AC17 增列含資料 upgrade、downgrade、再 upgrade 遷移測試 — [PR #441 第 2 輪審查](https://github.com/speko-tw/inspect-flow/pull/441#pullrequestreview-5407786064)。
