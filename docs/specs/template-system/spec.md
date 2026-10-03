# 範本系統（template-system）

**代碼**：`TPL`　**Phase**：P3　**狀態**：已凍結<br>
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
- 單一查核項目或整個系統的範本儲存與套用。
- 範本管理員這個全系統角色及其指派模型，以及本功能中的權限；此角色與 `domain-model` 既有專案 `Role` 分開。

**不包含**：

- 專案副本的完整資料模型與欄位，以及修改副本後是否作廢任務、重新查核或更正既有任務的流程：由 P4 `inspection-planning` 定義。套用範本時複製範本結構並記錄來源名稱與套用時間仍屬本規格。
- `Inspection Plan`、`Inspection Task`、任務快照與任務狀態：移至 `inspection-planning`（P4）。
- 自主檢查／抽查的檢查層級與檢查者欄位：屬 P4 `inspection-planning`（0.4.x；依 [KD-51](../../intents/03-decisions-and-stack.md#kd-51)），不屬本規格範圍。
- 現場選擇符合／不符合／不適用、填寫實測值、嚴重度、註解與原因，以及自動判定、缺失流程：屬 0.7.x 現場規格；本規格只定義範本的實測欄位結構，不定義現場填值或結果行為（依 [KD-37](../../intents/03-decisions-and-stack.md#kd-37)、[KD-52](../../intents/03-decisions-and-stack.md#kd-52)、[KD-54](../../intents/03-decisions-and-stack.md#kd-54)）。
- Evidence 上傳與照片檔案儲存：移至 `field-evidence`（P6）；本規格只定義範本中的照片需求。
- 報告版面與 `Report Template`：移至 `report-delivery`（P9）。查核範本不等於報告範本，報告範本的版本規則不受本規格影響。
- 範本建議、審核與核准流程：移至後續版本（#314，0.8.x）。
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
| TPL-R03 | 範本管理**必須**支援兩層分類「工程類別 → 系統」，其下為查核項目；工程類別、系統、同一系統下的查核項目名稱，去除前後空白並忽略大小寫後，在各自父層內**必須**唯一。不同父層可有同名項目；目前使用名稱，不設代號。 | 必須 | [KD-48](../../intents/03-decisions-and-stack.md#kd-48)；正規化與唯一性為本規格設計（見[設計決定](#design-decisions)）。 |
| TPL-R04 | 查核範本**必須**只保存結構資料：分類、查核項目、查核項次、檢查標準、實測欄位定義與照片需求；**不得**保存現場結果、實測值或照片。`Inspection Template` 的單位是單一查核項目，或一個系統連同其下所有查核項目。 | 必須 | [KD-47](../../intents/03-decisions-and-stack.md#kd-47)、[KD-48](../../intents/03-decisions-and-stack.md#kd-48) |
| TPL-R05 | `Template Item` **必須**有 `sequence`、`title`、`instruction`；其下**得**有多個查核項次，每個查核項次由內業預先設定。MVP 不要求 interval，也不依 interval 自動產生查核點。 | 必須／得 | 架構基準 §12.5；[KD-36](../../intents/03-decisions-and-stack.md#kd-36)、[KD-37](../../intents/03-decisions-and-stack.md#kd-37)、[G-01](../../intents/05-open-questions.md#g-01) |
| TPL-R06 | 每個查核項次**得**選擇文字標準或數值標準。文字標準按計畫書原文記錄，不解析條件；數值標準包含標準值、條件（`≤`、`≥`、`＝` 或範圍）、單位與容許誤差。範本只定義標準與實測欄位，不記錄實測值或自動判定結果。 | 得 | [KD-37](../../intents/03-decisions-and-stack.md#kd-37)、[KD-52](../../intents/03-decisions-and-stack.md#kd-52) |
| TPL-R11 | 每個查核項次**得**設定多個實測欄位；每欄由內業設定為文字或數字。數字欄位**必須**有單位。每個數值標準**必須**綁定該項次的一個數字實測欄位；有數值標準時**必須**有綁定欄位，一個數字欄位最多綁定一個數值標準。僅被綁定欄位的單位**必須**與該數值標準相同，並由系統自動帶入、不得另設；其他數字欄位由內業自設單位。範本只定義欄位，不保存現場填值；單位換算由現場自行處理。 | 得／必須／不得 | [KD-37](../../intents/03-decisions-and-stack.md#kd-37)、[KD-52](../../intents/03-decisions-and-stack.md#kd-52)、[KD-54](../../intents/03-decisions-and-stack.md#kd-54)（已由 [#332](https://github.com/speko-tw/inspect-flow/issues/332)／[PR #333](https://github.com/speko-tw/inspect-flow/pull/333) 記錄；原始依據為負責人[#76 留言](https://github.com/speko-tw/inspect-flow/issues/76#issuecomment-5965931420)） |
| TPL-R07 | MVP 的 `Evidence Requirement` **必須**支援照片需求；MVP 佐證僅收照片。每個查核項次**必須**至少被一張非總覽照片覆蓋，照片可多張且不設上限；一張照片**得**覆蓋多個查核項次。範本**不得**設定總覽照片必拍規則；總覽照片是現場人員選擇是否拍攝的額外選項，可有多張、排在查核項目組最前面，且不計入最低覆蓋。照片需求**不得**在程式中針對特定項目寫死。 | 必須／得／不得 | [PR-09](../../intents/02-principles.md#pr-09)、[KD-38](../../intents/03-decisions-and-stack.md#kd-38)、[KD-48](../../intents/03-decisions-and-stack.md#kd-48)、[KD-50](../../intents/03-decisions-and-stack.md#kd-50)、[KD-53](../../intents/03-decisions-and-stack.md#kd-53)、[OQ-05](../../intents/05-open-questions.md#oq-05) |
| TPL-R08 | 套用範本時**必須**複製所選單一查核項目或某系統節點下的全部查核項目結構，建立專案自己的查核項目；此後修改或刪除來源範本**不得**改動已套用的專案內容。套用紀錄**必須**保存來源範本名稱與套用時間。專案副本欄位及作廢／重查／更正流程由 P4 `inspection-planning` 定義。 | 必須／不得 | [KD-03](../../intents/03-decisions-and-stack.md#kd-03)、[KD-47](../../intents/03-decisions-and-stack.md#kd-47)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)；欄位與流程責任為 P4 規劃分工。 |
| TPL-R09 | 系統**必須**有獨立的全系統角色模型 `SystemRole` 與使用者指派模型 `SystemRoleAssignment`；Admin 指派或收回角色**必須**寫稽核紀錄。首個角色為範本管理員，可新增、修改、刪除查核範本，查看所有專案並將任一專案查核項目存成範本。全系統角色與 `Role`、`ProjectMember`、`is_admin` 並存且互相獨立；套用範本由具目標專案查核項目編輯權限者執行，不要求範本管理員身分。 | 必須／得 | [KD-24](../../intents/03-decisions-and-stack.md#kd-24)、[KD-27](../../intents/03-decisions-and-stack.md#kd-27)、[KD-29](../../intents/03-decisions-and-stack.md#kd-29)、[KD-49](../../intents/03-decisions-and-stack.md#kd-49)；模型選擇為本規格設計。 |
| TPL-R10 | 所有本規格 API **必須**遵守 `api-conventions`，使用 `/api/v1` 路徑、UUID 資源識別、JSON 請求／回應與共用錯誤格式，並由後端依 TPL-R09 執行授權。分類與系統均提供新增、改名及刪除；若刪除時其下仍有範本，**必須**拒絕並回傳 HTTP 409。 | 必須 | [API-R01](../api-conventions/spec.md#需求)、[API-R02](../api-conventions/spec.md#需求)、[API-R03](../api-conventions/spec.md#需求)、[API-R05](../api-conventions/spec.md#需求)、[API-R06](../api-conventions/spec.md#需求)；路徑與刪除行為為本規格設計。 |
| TPL-R12 | 範本管理 UI **必須**納入 MVP，提供管理範本分類、系統與範本內容的能力。 | 必須 | 本規格範圍設計；依據架構基準 §12.3–12.7 及 [KD-47](../../intents/03-decisions-and-stack.md#kd-47)。 |

## 資料

`Inspection Template`、兩層分類、`Template Item`、查核項次、檢查標準、實測欄位定義、`Evidence Requirement`、`SystemRole` 與 `SystemRoleAssignment` 由本規格定義；其他共用實體欄位由 `domain-model` 定義。不新增 `Template Version`。系統是分類節點；「整個系統範本」是該系統節點下現存的查核項目集合。單一項目範本也必須屬於某個系統節點。專案副本的欄位及後續作廢／重查／更正流程由 P4 `inspection-planning` 定義。

`Evidence Requirement` 依架構基準 §12.6 含 `type`、`required`、`min_count`、`max_count`；照片的實際規則由 KD-50 覆蓋：每項次最少一張、沒有張數上限，故照片不設有效的 `max_count` 上限。MVP 的 Evidence 類型只有照片，沒有 `TEXT` 類型；若未來需要文字或其他 Evidence 類型，另開規格處理（[OQ-20](../../intents/05-open-questions.md#oq-20)、[KD-53](../../intents/03-decisions-and-stack.md#kd-53)）。

## 介面

所有路徑依 [api-conventions](../api-conventions/spec.md)；以下資源路徑是規格提案，具體欄位與回應格式沿用共用契約。授權失敗沿用 API 共用錯誤格式。

| 方法 | 路徑 | 用途 | 權限 |
|---|---|---|---|
| GET | `/api/v1/template-categories` | 列出工程類別 | 範本管理員或具任一專案查核項目編輯權限者 |
| POST | `/api/v1/template-categories` | 建立工程類別 | 範本管理員 |
| PATCH | `/api/v1/template-categories/{category_id}` | 改名工程類別 | 範本管理員 |
| DELETE | `/api/v1/template-categories/{category_id}` | 刪除工程類別；其下仍有範本時回 409 | 範本管理員 |
| GET | `/api/v1/template-categories/{category_id}/systems` | 列出類別下系統 | 範本管理員或具任一專案查核項目編輯權限者 |
| POST | `/api/v1/template-categories/{category_id}/systems` | 建立系統 | 範本管理員 |
| PATCH | `/api/v1/template-systems/{system_id}` | 改名系統 | 範本管理員 |
| DELETE | `/api/v1/template-systems/{system_id}` | 刪除系統；其下仍有範本時回 409 | 範本管理員 |
| GET | `/api/v1/templates` | 查詢範本與查核項目 | 範本管理員或具任一專案查核項目編輯權限者 |
| POST | `/api/v1/templates` | 建立單一查核項目或整個系統範本 | 範本管理員 |
| GET | `/api/v1/templates/{template_id}` | 讀取範本結構 | 範本管理員或具任一專案查核項目編輯權限者 |
| PUT | `/api/v1/templates/{template_id}` | 覆蓋目前範本內容 | 範本管理員 |
| DELETE | `/api/v1/templates/{template_id}` | 刪除範本 | 範本管理員 |
| POST | `/api/v1/projects/{project_id}/inspection-items:apply-template` | 將選定範本複製到專案 | 具該專案查核項目編輯權限者 |
| POST | `/api/v1/projects/{project_id}/templates` | 將該專案查核項目存為範本 | 範本管理員 |
| GET | `/api/v1/projects` | 沿用既有專案列表 API，供範本管理員瀏覽所有專案 | Admin 或範本管理員；其他既有權限依其規格 |
| POST | `/api/v1/system-roles/{system_role_id}/assignments` | 指派全系統角色（body 帶目標 user ID） | Admin |
| DELETE | `/api/v1/system-roles/{system_role_id}/assignments/{user_id}` | 收回全系統角色指派 | Admin |

`GET /api/v1/projects` 的範本管理員授權分支只擴大該角色可見範圍；Admin 仍沿用既有全專案權限，其他使用者仍只取得既有授權可見的專案，無專案權限者仍被拒絕。回歸驗收涵蓋 Admin、範本管理員、一般專案成員及無關使用者，確認既有回應欄位、分頁與一般專案授權不變。分類刪除的錯誤碼為 `template.category_not_empty`；系統刪除的錯誤碼為 `template.system_not_empty`，兩者均回 HTTP 409。

## 驗收條件

以下條件涵蓋本規格的凍結範圍。OQ-06 已裁定的現場結果語意屬 0.7.x，本規格只驗收實測欄位定義。

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| TPL-AC01 | 範本管理員與一般專案編輯者各一人 | 一般編輯者建立範本、範本管理員建立範本 | 一般編輯者被拒絕；範本管理員可建立範本 | TPL-R01、TPL-R09 |
| TPL-AC02 | 已有含前後空白或大小寫差異的工程類別、系統及查核項目名稱 | 建立正規化後同名的分類、系統或同系統項目，再於不同父層建立同名 | 去除前後空白並忽略大小寫後，同一父層名稱衝突被拒絕；不同父層同名可建立；資料沒有分類代號欄位 | TPL-R03 |
| TPL-AC03 | 範本含具 `sequence`、`title`、`instruction` 的查核項目、項次、文字及數值標準、照片需求 | 儲存後讀回範本 | 所有結構一致；沒有現場結果、照片檔或 interval 欄位 | TPL-R04、TPL-R05、TPL-R06、TPL-R07 |
| TPL-AC04 | 範本管理員儲存一份範本 | 更新同一範本，再讀取 | 回傳更新後唯一現行內容；沒有版本記錄或 `Template Version` | TPL-R02 |
| TPL-AC05 | 系統範本包含多個查核項目，另有單一項目範本 | 分別套用兩者到專案 | 可套用單項與整個系統；建立的專案內容是獨立副本，且保存來源範本名稱與套用時間 | TPL-R04、TPL-R08 |
| TPL-AC06 | 專案已套用範本，另有範本管理員 | 覆蓋或刪除來源範本，檢查專案副本；範本管理員再讀取及存成範本 | 專案副本不變；範本管理員能查看所有專案並把任一專案項目存成範本 | TPL-R08、TPL-R09 |
| TPL-AC07 | 項次含文字標準、數值標準及照片需求 | 讀取定義並對照系統行為 | 文字標準不解析；數值標準具四類定義欄位但不接受實測值或自動判定；每項次至少被一張非總覽照片覆蓋，一張照片可覆蓋多個項次且照片數無上限；總覽照由現場選擇且不計入最低覆蓋 | TPL-R05、TPL-R06、TPL-R07 |
| TPL-AC08 | 已登入 Admin、範本管理員、一般專案成員、無專案權限者 | 呼叫各端點；比較 `GET /api/v1/projects` 的授權分支；改名／刪除分類與系統；指派或收回全系統角色 | 專案成員可瀏覽及套用但不能寫入範本；只有 Admin 可指派或收回角色且成功後留下稽核紀錄；範本管理員可列出所有專案，其他角色維持既有可見範圍；無專案權限者仍被拒絕；刪除含範本的分類或系統回 409 與對應錯誤碼；API 符合共用慣例 | TPL-R09、TPL-R10 |
| TPL-AC09 | 項次有多個文字或數字實測欄位，且設有數值標準 | 儲存並讀回範本欄位定義，另嘗試省略綁定欄位、綁文字欄位或讓一個數字欄位綁兩個標準 | 每個數字欄位都有單位；每個數值標準必須綁定該項次的一個數字欄位，有數值標準時不得缺少綁定欄位；一個數字欄位最多綁一個數值標準；只有綁定欄位的單位與標準相同並由系統帶入、不可另設；其他數字欄位可自設單位；非法關聯被拒絕；範本不含現場實測值或單位換算 | TPL-R11 |
| TPL-AC10 | 範本管理員已登入且範本庫有工程類別、系統及範本 | 使用 MVP 範本管理 UI 新增、改名、預覽及刪除分類、系統與範本 | 管理 UI 可完成分類與範本管理；含範本的分類或系統刪除被拒絕並顯示 409 錯誤 | TPL-R10、TPL-R12 |

<a id="design-decisions"></a>
## 設計決定

以下是本規格為可實作性作出的設計決定，不是負責人裁定；初期細節依常見做法先定，之後可依使用經驗迭代。

| 原待釐清項目 | 決定 | 理由 | 依據 |
|---|---|---|---|
| TPL-Q1 名稱與歸屬 | 名稱去除前後空白、比對不分大小寫；工程類別在根層唯一、系統在所屬工程類別內唯一、查核項目在所屬系統內唯一。系統是分類節點；整個系統範本是該節點下的查核項目集合；單一項目也必須掛在某個系統下。 | 同一父層避免視覺上相同名稱造成選錯；父層範圍允許不同分類沿用慣用名稱。系統節點與其項目集合分開，能一致支援單項及整組套用。 | KD-48；架構基準 §12.3–12.5。 |
| TPL-Q2 全系統角色 | 使用 `SystemRole` 與 `SystemRoleAssignment`，分別保存角色定義與 `User` 指派；與 `Role`、`ProjectMember`、`is_admin` 並存且不互相混用。Admin 指派或收回均寫稽核紀錄。 | 系統角色沒有專案範圍，獨立模型可清楚表達其授權邊界與指派生命週期。 | KD-24、KD-27、KD-29、KD-49。 |
| TPL-Q3、TPL-Q6 專案副本責任 | 本規格只要求套用時複製所選結構並記錄來源範本名稱、套用時間；專案副本欄位，以及修改後的作廢、重查或更正流程，移至 P4 `inspection-planning`。TPL-AC05 僅驗套用複製、隔離與來源紀錄。 | KD-55 已把重新查核／更正流程交由 P4 規格設計；模板不應預先決定專案副本欄位。 | KD-03、KD-47、KD-55（依 PR #335）；架構基準 §12.3–12.7。 |
| TPL-Q4 Evidence `TEXT` | MVP 不建立 `TEXT` Evidence 類型，只支援照片；未來如需文字或其他類型，另開規格。 | OQ-20／KD-53 將 MVP 範圍限為照片，避免規格資料模型超出已定 MVP 邊界。 | OQ-20、KD-53；架構基準 §12.6。 |
| TPL-Q7 API 與管理 UI | 採本規格「介面」列出的 `/api/v1` 資源路徑；分類與系統支援新增、改名、刪除，含範本時拒絕刪除並回 409；使用 system role assignments 路徑指派／收回。`GET /api/v1/projects` 維持既有各角色可見範圍，只新增範本管理員查看全部專案的分支，並依 TPL-AC08 回歸。範本管理 UI 納入 MVP（T5）。 | 明確固定資源路徑和拒絕條件，能讓 API、授權與 UI 任務依同一契約拆分。 | API-R01～API-R09；KD-49；架構基準 §12.3–12.7。 |
| TPL-Q8 數值標準綁定 | 每個數值標準必須綁定同一項次的一個數字實測欄位；有數值標準時必須存在綁定欄位；一個數字欄位最多綁定一個數值標準。被綁欄位沿用標準單位，其他數字欄位自行設定單位。 | 單一明確欄位避免標準對應值含糊；限制一對一關聯可以維持單位來源唯一。 | KD-37、KD-52、KD-54；原始單位裁定見 [#76 留言](https://github.com/speko-tw/inspect-flow/issues/76#issuecomment-5965931420)。 |


## 變更紀錄

- 單位規則的意圖已由 [#332](https://github.com/speko-tw/inspect-flow/issues/332)／[PR #333](https://github.com/speko-tw/inspect-flow/pull/333) 記錄（KD-54 已合併；原始來源為負責人[#76 留言](https://github.com/speko-tw/inspect-flow/issues/76#issuecomment-5965931420)）。本規格依此將數值標準綁定一個數字欄位，並在 TPL-Q8 定案具體欄位關聯；單位換算仍由現場處理且不在本規格範圍。
- TPL-Q1～TPL-Q4、TPL-Q6～TPL-Q8 定案並凍結規格；模板管理、API、資料模型與套用責任依本規格明確分界 — #110（PR #335 後續）。
