# 範本系統（template-system）

**代碼**：`TPL`　**Phase**：P3　**狀態**：草稿<br>
**前置規格**：`database-foundation`（UUID 與稽核欄位）、`domain-model`（`User`、`Project`、`ProjectMember` 與專案權限）、`authentication`（登入者與權限檢查）、`api-conventions`（API 共用契約）<br>
**引用意圖**：[PR-04](../../intents/02-principles.md#pr-04)、[PR-09](../../intents/02-principles.md#pr-09)、[PR-10](../../intents/02-principles.md#pr-10)、[KD-03](../../intents/03-decisions-and-stack.md#kd-03)、[KD-36](../../intents/03-decisions-and-stack.md#kd-36)、[KD-37](../../intents/03-decisions-and-stack.md#kd-37)、[KD-47](../../intents/03-decisions-and-stack.md#kd-47)～[KD-53](../../intents/03-decisions-and-stack.md#kd-53)、[OQ-04](../../intents/05-open-questions.md#oq-04)、[OQ-05](../../intents/05-open-questions.md#oq-05)、[OQ-06](../../intents/05-open-questions.md#oq-06)、[OQ-09](../../intents/05-open-questions.md#oq-09)、[OQ-20](../../intents/05-open-questions.md#oq-20)<br>
**被擋議題**：[OQ-06](../../intents/05-open-questions.md#oq-06) 尚未裁定的 `N/A`、嚴重度與缺失語意，依[開工門檻](../../intents/05-open-questions.md#gate)維持本規格草稿；不影響本文明確標示為已裁定的範本結構。

## 目的

提供獨立於專案、可由有權限人員重複套用的查核範本庫，使範本管理員能維護共用結構，專案人員仍能依專案需求建立自己的查核項目（依據：架構基準 §2.4、§12.3–12.7；[KD-47](../../intents/03-decisions-and-stack.md#kd-47)）。

## 範圍

**包含**：

- 範本庫及 `Inspection Template` 的新增、讀取、修改與刪除。
- 兩層分類「工程類別 → 系統」，及其下的查核項目與查核項次結構。
- 文字標準、數值標準及照片需求的範本定義。
- 單一查核項目或整個系統的範本儲存與套用。
- 範本管理員這個全系統角色及其指派模型，以及本功能中的權限；此角色與 `domain-model` 既有專案 `Role` 分開。

**不包含**：

- 專案副本的完整資料模型與欄位：由 `domain-model` 定義；目前與 `Task Requirement Snapshot` 的分工仍待 [OQ-09](../../intents/05-open-questions.md#oq-09) 於 0.4.x 確認。
- `Inspection Plan`、`Inspection Task`、任務快照與任務狀態：移至 `inspection-planning`（P4）。
- 自主檢查／抽查的檢查層級與檢查者欄位：移至 `inspection-planning`（P4；依 [KD-51](../../intents/03-decisions-and-stack.md#kd-51)）。
- 現場結果、實測值輸入、自動判定、`N/A`、嚴重度與缺失流程：移至後續規格；其中未定語意見 [OQ-06](../../intents/05-open-questions.md#oq-06)，實測值與自動判定依 [KD-37](../../intents/03-decisions-and-stack.md#kd-37)、[KD-52](../../intents/03-decisions-and-stack.md#kd-52) 屬 0.7.x。
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
| TPL-R03 | 範本管理**必須**支援兩層分類「工程類別 → 系統」，其下為查核項目；分類同一層的名稱**不得**重複，不同層的名稱**得**重複。目前使用名稱，不設代號。 | 必須／得 | [KD-48](../../intents/03-decisions-and-stack.md#kd-48)；名稱空白與大小寫比對細節由本規格決定，見 [TPL-Q1](#tpl-q1)。 |
| TPL-R04 | 查核範本**必須**只保存結構資料：分類、查核項目、查核項次、檢查標準與照片需求；**不得**保存現場結果或照片。`Inspection Template` 的單位是單一查核項目，或一個系統連同其下所有查核項目。 | 必須 | [KD-47](../../intents/03-decisions-and-stack.md#kd-47)、[KD-48](../../intents/03-decisions-and-stack.md#kd-48) |
| TPL-R05 | `Template Item` **必須**有 `sequence`、`title`、`instruction`；其下**得**有多個查核項次，每個查核項次由內業預先設定。MVP 不要求 interval，也不依 interval 自動產生查核點。 | 必須／得 | 架構基準 §12.5；[KD-36](../../intents/03-decisions-and-stack.md#kd-36)、[KD-37](../../intents/03-decisions-and-stack.md#kd-37)、[G-01](../../intents/05-open-questions.md#g-01) |
| TPL-R06 | 每個查核項次**得**選擇文字標準或數值標準。文字標準按計畫書原文記錄，不解析條件；數值標準包含標準值、條件（`≤`、`≥`、`＝` 或範圍）、單位與容許誤差。範本只定義標準，不記錄實測值或自動判定結果。 | 得 | [KD-37](../../intents/03-decisions-and-stack.md#kd-37)、[KD-52](../../intents/03-decisions-and-stack.md#kd-52) |
| TPL-R07 | MVP 的 `Evidence Requirement` **必須**支援照片需求；MVP 佐證僅收照片。每個查核項次**必須**至少被一張非總覽照片覆蓋，照片可多張且不設上限；一張照片**得**覆蓋多個查核項次。範本**不得**設定總覽照片必拍規則；總覽照片是現場人員選擇是否拍攝的額外選項，可有多張、排在查核項目組最前面，且不計入最低覆蓋。照片需求**不得**在程式中針對特定項目寫死。 | 必須／得／不得 | [PR-09](../../intents/02-principles.md#pr-09)、[KD-38](../../intents/03-decisions-and-stack.md#kd-38)、[KD-48](../../intents/03-decisions-and-stack.md#kd-48)、[KD-50](../../intents/03-decisions-and-stack.md#kd-50)、[KD-53](../../intents/03-decisions-and-stack.md#kd-53)、[OQ-05](../../intents/05-open-questions.md#oq-05) |
| TPL-R08 | 套用範本時**必須**複製所選單一查核項目或整個系統的範本結構，建立專案自己的查核項目；此後修改或刪除來源範本**不得**改動已套用的專案內容。專案**必須**記錄來源查核範本名稱與套用時間。 | 必須／不得 | [KD-03](../../intents/03-decisions-and-stack.md#kd-03)、[KD-47](../../intents/03-decisions-and-stack.md#kd-47)；專案副本和任務快照分工依 [OQ-09](../../intents/05-open-questions.md#oq-09) 留待 P4。 |
| TPL-R09 | 系統**必須**有全系統角色機制；Admin 直接指派角色，指派及收回**必須**寫稽核紀錄。首個角色為範本管理員，可新增、修改、刪除查核範本，查看所有專案並將任一專案查核項目存成範本。此角色與 `is_admin`、專案角色並存且互相獨立；套用範本由具目標專案查核項目編輯權限者執行，不要求範本管理員身分。 | 必須／得 | [KD-24](../../intents/03-decisions-and-stack.md#kd-24)、[KD-27](../../intents/03-decisions-and-stack.md#kd-27)、[KD-29](../../intents/03-decisions-and-stack.md#kd-29)、[KD-49](../../intents/03-decisions-and-stack.md#kd-49)；全系統角色及指派模型由本規格定義，`domain-model` 目前未定義此實體。 |
| TPL-R10 | 所有本規格 API **必須**遵守 `api-conventions`，路徑以 `/api/v1/` 開頭，使用 UUID 資源識別，並由後端依 TPL-R09 執行授權。 | 必須 | [KD-07](../../intents/03-decisions-and-stack.md#kd-07)、[KD-49](../../intents/03-decisions-and-stack.md#kd-49)、[API-R01](../api-conventions/spec.md#需求)、[API-R06](../api-conventions/spec.md#需求) |
| TPL-R11 | **移至 `inspection-planning`（P4）**：自主檢查／抽查的檢查層級與檢查者欄位（依據：[KD-51](../../intents/03-decisions-and-stack.md#kd-51)）。本規格不負責其需求或驗收。 | 移至 | [KD-51](../../intents/03-decisions-and-stack.md#kd-51) |

## 資料

`Inspection Template`、兩層分類、`Template Item`、查核項次、檢查標準、`Evidence Requirement` 及全系統角色／指派模型由本規格定義；其他共用實體欄位由 `domain-model` 定義。不新增 `Template Version`。套用後的專案副本由 `domain-model` 定義；其與 P4 `Task Requirement Snapshot` 的細節依 OQ-09 保留未定。

`Evidence Requirement` 依架構基準 §12.6 含 `type`、`required`、`min_count`、`max_count`；照片的實際規則由 KD-50 覆蓋：每項次最少一張、沒有張數上限，故照片不設有效的 `max_count` 上限。MVP 不建立非照片 Evidence 類型；原 `TEXT` 是否保留為 Evidence 類型尚待規格確認（[KD-53](../../intents/03-decisions-and-stack.md#kd-53)）。

## 介面

所有路徑依 [api-conventions](../api-conventions/spec.md)；以下資源路徑是規格提案，具體欄位與回應格式沿用共用契約。授權失敗沿用 API 共用錯誤格式。

| 方法 | 路徑 | 用途 | 權限 |
|---|---|---|---|
| GET | `/api/v1/template-categories` | 列出工程類別 | 範本管理員或具任一專案查核項目編輯權限者 |
| POST | `/api/v1/template-categories` | 建立工程類別 | 範本管理員 |
| GET | `/api/v1/template-categories/{category_id}/systems` | 列出類別下系統 | 範本管理員或具任一專案查核項目編輯權限者 |
| POST | `/api/v1/template-categories/{category_id}/systems` | 建立系統 | 範本管理員 |
| GET | `/api/v1/templates` | 查詢範本與查核項目 | 範本管理員或具任一專案查核項目編輯權限者 |
| POST | `/api/v1/templates` | 建立單一查核項目或整個系統範本 | 範本管理員 |
| GET | `/api/v1/templates/{template_id}` | 讀取範本結構 | 範本管理員或具任一專案查核項目編輯權限者 |
| PUT | `/api/v1/templates/{template_id}` | 覆蓋目前範本內容 | 範本管理員 |
| DELETE | `/api/v1/templates/{template_id}` | 刪除範本 | 範本管理員 |
| POST | `/api/v1/projects/{project_id}/inspection-items:apply-template` | 將選定範本複製到專案 | 具該專案查核項目編輯權限者 |
| POST | `/api/v1/projects/{project_id}/templates` | 將該專案查核項目存為範本 | 範本管理員 |
| GET | `/api/v1/projects` | 沿用既有專案列表 API，供範本管理員瀏覽所有專案 | Admin 或範本管理員；其他既有權限依其規格 |

上述 REST 資源切分、套用路徑與是否將「存成範本」作為範本建立的子操作，是規格提案，實作拆任務前可依共用 API 慣例澄清，不改變權限與複製語意。

## 驗收條件

本規格仍為草稿；以下條件覆蓋已裁定的範本範圍，涉及 OQ-06 未定結果語意的部分不納入驗收。

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| TPL-AC01 | 範本管理員與一般專案編輯者各一人 | 一般編輯者建立範本、範本管理員建立範本 | 一般編輯者被拒絕；範本管理員可建立範本 | TPL-R01、TPL-R09 |
| TPL-AC02 | 同一工程類別已有名為「機電」的系統 | 建立同層同名系統、不同工程類別下的同名系統 | 同層同名被拒絕；不同層同名可建立；範本資料沒有分類代號欄位 | TPL-R03 |
| TPL-AC03 | 範本含具 `sequence`、`title`、`instruction` 的查核項目、項次、文字及數值標準、照片需求 | 儲存後讀回範本 | 所有結構一致；沒有現場結果、照片檔或 interval 欄位 | TPL-R04、TPL-R05、TPL-R06、TPL-R07 |
| TPL-AC04 | 範本管理員儲存一份範本 | 更新同一範本，再讀取 | 回傳更新後唯一現行內容；沒有版本記錄或 `Template Version` | TPL-R02 |
| TPL-AC05 | 系統範本包含多個查核項目，另有單一項目範本 | 分別套用兩者到專案 | 可套用單項與整個系統；建立的專案內容是獨立副本，且保存來源範本名稱與套用時間 | TPL-R04、TPL-R08 |
| TPL-AC06 | 專案已套用範本，另有範本管理員 | 覆蓋或刪除來源範本，檢查專案副本；範本管理員再讀取及存成範本 | 專案副本不變；範本管理員能查看所有專案並把任一專案項目存成範本 | TPL-R08、TPL-R09 |
| TPL-AC07 | 項次含文字標準、數值標準及照片需求 | 讀取定義並對照系統行為 | 文字標準不解析；數值標準具四類定義欄位但不接受實測值或自動判定；每項次至少被一張非總覽照片覆蓋，一張照片可覆蓋多個項次且照片數無上限；總覽照由現場選擇且不計入最低覆蓋 | TPL-R05、TPL-R06、TPL-R07 |
| TPL-AC08 | 已登入的範本管理員、非管理員、具任一專案查核項目編輯權限者、無該權限者 | 瀏覽分類／系統／範本、呼叫範本寫入、跨專案讀取／存範本與套用 API | 專案編輯者可瀏覽及套用但不能寫入範本；管理員可寫入範本並查看所有專案、存成範本；其他端點依 TPL-R09 權限拒絕；API 路徑及 ID 符合共用慣例 | TPL-R09、TPL-R10 |
| TPL-AC09 | **移至 `inspection-planning`（P4）**（依據：[KD-51](../../intents/03-decisions-and-stack.md#kd-51)）；本規格不負責此驗收。 | 移至 | TPL-R11 |

## 待釐清

- <a id="tpl-q1"></a>**TPL-Q1：名稱規則及範本歸屬**。KD-48 未指定空白與大小寫是否視為相同，也未說明系統節點與系統範本的關係、單一項目範本的系統歸屬，以及系統下查核項目名稱是否唯一；實作前須決定正規化、唯一性與歸屬規則。不得將提案寫成已裁定意圖。
- <a id="tpl-q2"></a>**TPL-Q2：全系統角色的模型與稽核**。本規格定義範本管理員及全系統角色與指派資料模型；`domain-model` 目前沒有此實體。本規格須釐清它與現有 `Role`、`ProjectMember`、`is_admin` 的關係。依 KD-49，三者並存且不互相混用；Admin 指派或收回時依 KD-29 留稽核紀錄。
- <a id="tpl-q3"></a>**TPL-Q3：專案副本與任務需求快照的分工**。由 `inspection-planning` 依 OQ-09 於 P4 確認；查核範本不版本化的裁定不因此改變。
- <a id="tpl-q4"></a>**TPL-Q4：`TEXT` 是否仍為獨立 Evidence 類型**。OQ-20 已裁定 MVP 只收照片，但 KD-53 明確保留原 `TEXT` 類型是否續存待規格確認；此規格先不將它列為 MVP 可用類型。
- <a id="tpl-q5"></a>**TPL-Q5：OQ-06 未決語意**。`N/A`、嚴重度、缺失欄位及不符合後續流程仍未定，繼續阻擋本規格凍結；本規格不自行裁定。這些結果語意可能影響範本欄位，例如查核項次是否能設定為允許 `N/A`、相關欄位是否必填，以及缺失資料如何關聯；須待裁定後再決定，本文不預設欄位或行為。
- <a id="tpl-q6"></a>**TPL-Q6：專案查核項目模型責任**。專案副本欄位與建立流程由 `domain-model`／P4 `inspection-planning` 協作定義，並以 OQ-09 決定與 `Task Requirement Snapshot` 的責任界線；不得在本規格假設快照欄位。
- <a id="tpl-q7"></a>**TPL-Q7：API 路徑與分類維護**。表列路徑是提案；實作前需確認 API convention 與資源命名。範本管理員的全專案瀏覽沿用既有專案列表 API；分類與系統目前只列新增及讀取端點，是否需改名、刪除端點及其影響須在實作前決定。這些待定細節不改變已裁定的可存／可套用單項或整個系統能力。

## 變更紀錄

- 無。
