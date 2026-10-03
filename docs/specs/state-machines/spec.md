# 狀態機（State Machines）

**代碼**：`STM`　**Phase**：P4、P6、P7、P9　**狀態**：草稿
**前置規格**：[domain-model](../domain-model/spec.md)、[api-conventions](../api-conventions/spec.md)
**引用意圖**：[PR-01](../../intents/02-principles.md#pr-01)、[PR-04](../../intents/02-principles.md#pr-04)、[PR-05](../../intents/02-principles.md#pr-05)、[PR-06](../../intents/02-principles.md#pr-06)、[PR-15](../../intents/02-principles.md#pr-15)、[PR-16](../../intents/02-principles.md#pr-16)、[KD-03](../../intents/03-decisions-and-stack.md#kd-03)、[KD-24](../../intents/03-decisions-and-stack.md#kd-24)、[KD-25](../../intents/03-decisions-and-stack.md#kd-25)、[KD-26](../../intents/03-decisions-and-stack.md#kd-26)、[KD-27](../../intents/03-decisions-and-stack.md#kd-27)、[KD-29](../../intents/03-decisions-and-stack.md#kd-29)、[KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-53](../../intents/03-decisions-and-stack.md#kd-53)、[KD-54](../../intents/03-decisions-and-stack.md#kd-54)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)
**被擋議題**：[OQ-09](../../intents/05-open-questions.md#oq-09)、[G-05](../../intents/05-open-questions.md#g-05)、[G-06](../../intents/05-open-questions.md#g-06)、[G-07](../../intents/05-open-questions.md#g-07)

## 目的

定義 `Inspection Plan`、`Inspection Task`、`Evidence` 與 `Report` 的狀態和轉換邊界，讓後端能一致地驗證業務動作並保留可追溯紀錄（依據：架構基準 §18、§20.6–20.8、§20.17；[PR-16](../../intents/02-principles.md#pr-16)）。本文件整體仍為草稿；已裁定的業務規則可作為後續規格凍結依據，但不得據此將需求、AC 或實作任務視為已凍結。

## 範圍

**包含**：

- `Inspection Plan` 與 `Inspection Task` 的狀態轉換規則草案（含已裁定事項及尚待補齊的邊界）；Evidence 與 Report 的草稿狀態提案。
- 狀態轉換由後端 Service 層控制的介面邊界。
- 四種實體狀態機之間已確定的關係；Evidence 與 Report 的狀態機仍受各自待決議題阻擋。

**不包含**：

- 實體欄位、關聯與完整資料模型（由 [domain-model](../domain-model/spec.md) 負責）。
- API 的共通格式（由 [api-conventions](../api-conventions/spec.md) 負責）。
- 建立計畫與任務的完整流程、指派及產生規則（由 `inspection-planning` 規格負責）。
- 證據上傳、刪除 API、保留期限及實體刪除政策（受 [G-05](../../intents/05-open-questions.md#g-05) 阻擋，獨立照片刪除與保留政策排入 0.6.x；相關功能由 `field-evidence` 規格負責）。
- 報告欄位、版次治理與輸出內容（由 `report-delivery` 規格負責；其中狀態和快照邊界受 [G-06](../../intents/05-open-questions.md#g-06)、[G-07](../../intents/05-open-questions.md#g-07) 阻擋）。

## 使用情境

- 系統於任務派發時將計畫轉為進行中，並依有效任務自動更新完成狀態；具備計畫封存權限代碼的使用者可封存已完成計畫。
- 同專案具現場查核權限的成員可開始、完成任務並提交查核資料；完成後若只需修正資料，任務仍維持完成。
- 具專案查核項目管理權限代碼的使用者修改查核項目時選擇是否重查；系統保留作廢任務供查閱。Report 使用作廢資料的規則依 KD-55 記錄於草稿段，待 G-06／G-07 確認快照邊界。
- 具報告產製／核發權限代碼的使用者產製及核發報告；產製失敗時可辨認失敗並依裁定流程重試，已核發版次不被後續異動覆蓋。
- 使用者透過明確的業務動作要求狀態轉換，後端拒絕不合法的轉換。

## 需求

本表「建議」代表依業界常見做法提出、非負責人裁定；理由列於狀態表或待決題。未經裁定的建議不能當成業務規則實作。

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| STM-R01 | `Inspection Plan` 與 `Inspection Task` 的狀態轉換必須由後端 Service 層驗證；用戶端不得直接寫入任意狀態值。Evidence 與 Report 的同項需求仍屬草稿。 | 必須 | [PR-01](../../intents/02-principles.md#pr-01)、[PR-16](../../intents/02-principles.md#pr-16)；架構基準 §18 |
| STM-R02 | 有任務派出時，系統必須自動將 `Inspection Plan` 標記為進行中；「任務派出」的定義由 `inspection-planning` 規格處理，KD-56 尚未裁定。底下任務全部完成時，系統必須自動標記為完成，人員不得手動將計畫改為完成。具計畫封存／取消封存權限代碼的使用者得手動封存及取消封存。已完成計畫因 KD-55 作廢任務須自動退回進行中。任務取消的允許來源狀態與全數任務取消時的計畫狀態屬 STM-R12 草稿。 | 必須 | 負責人裁定：[#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)、[KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)；架構基準 §18、§20.6、§20.17 |
| STM-R03 | 已完成的 `Inspection Task` 可由具任務資料更正權限代碼的使用者（現場與內業皆得）修正資料；此類修正不得令任務離開完成狀態或要求重新完成。系統須記錄修正者、時間與內容。 | 必須 | [KD-42](../../intents/03-decisions-and-stack.md#kd-42)；[PR-08](../../intents/02-principles.md#pr-08) |
| STM-R04 | 修改專案查核項目並存檔時，系統必須詢問是否重新查核；警告與選擇對話框由功能規格定義。選「要」時須警告過去查核將作廢，並記錄操作者、時間與選擇。選「要」後，僅作廢同專案內使用該項次的任務，保留舊任務與當時標準，標示「標準變更作廢」供查找；若原計畫已完成，系統須自動退回進行中，待重查任務完成後再自動完成。封存計畫須先取消封存才能修改查核標準。 | 必須 | 負責人裁定：[同一留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)；[KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[PR-04](../../intents/02-principles.md#pr-04) |
| STM-R05 | 上述修改選「不要」重新查核時，使用該項次的既有任務只更正文字，不改結果、照片或狀態；系統須記錄誰、何時、改了什麼。 | 必須 | [KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[PR-04](../../intents/02-principles.md#pr-04) |
| STM-R06 | 建立任務時必須固定當時需求為 `Task Requirement Snapshot`；`Inspection Template` 不設版本狀態機。KD-55 所述的文字更正是明確例外。 | 必須 | [PR-04](../../intents/02-principles.md#pr-04)、[KD-03](../../intents/03-decisions-and-stack.md#kd-03)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55) |
| STM-R07 | 正式 `Report` 必須作為持久化、版本化實體保存產製時的資料快照；具備相應權限代碼的使用者可在產製完成後直接核發，不須送審；錯誤的已核發報告以新版取代，保留舊版並標示已被取代。 | 必須／應 | 負責人裁定：[報告裁定留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)、[KD-57](../../intents/03-decisions-and-stack.md#kd-57)；[PR-06](../../intents/02-principles.md#pr-06)；持久化與快照為必須，版本取代為裁定規則 |
| STM-R08 | `Report` 產製失敗時不得誤標為產製完成；產製中／失敗狀態及錯誤資訊保留方式應依 PR-15 設計，具體狀態集合須待 G-06 裁定後凍結。 | 「不得誤標為產製完成」必須；其餘應 | [PR-15](../../intents/02-principles.md#pr-15)；架構基準 §20.17；[G-06](../../intents/05-open-questions.md#g-06) |
| STM-R09 | `Inspection Plan` 與 `Inspection Task` 各狀態的進入條件、允許動作及操作者範圍，須依本規格明確列出；未裁定的轉換標示為草稿，不得由技術提案推定。Evidence 與 Report 的同項整理亦屬草稿。 | 必須 | [OQ-09](../../intents/05-open-questions.md#oq-09)；本規格之可追溯需求 |
| STM-R10 | Task 完成時，伺服器必須覆核完成條件；查核結果欄位驗證與寫入屬 0.7.x。本規格不另設單位欄位或單位系統；項次設有數值標準時，對應實測欄位的單位須與數值標準相同，由系統自動帶入、不得另設，現場自行換算且單位換算不在本次範圍。實測欄位定義（型別、單位）屬 0.3.x，現場填值屬 0.7.x。不得依標準值自動判定結果。含「不符合」結果時，只要必要資料完整仍可完成，並於任務清單標示「有缺失」；改善追蹤屬 0.7.x。 | 完成時伺服器覆核、數值標準對應單位相同且由系統帶入不得另設：必須；其他依裁定與 0.7.x 範圍 | 負責人裁定：[同一留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)、[KD-54](../../intents/03-decisions-and-stack.md#kd-54)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)；[PR-01](../../intents/02-principles.md#pr-01)、[KD-37](../../intents/03-decisions-and-stack.md#kd-37) |
| STM-R11 | 同專案且具現場查核權限的成員皆得開始與完成任務，指派僅供參考；系統必須記錄實際操作者，報告與稽核以實際查核人為準。 | 必須 | 負責人裁定：[SM-Q12 裁定](https://github.com/speko-tw/inspect-flow/issues/100#issuecomment-5968301878)；權限代碼依 [OQ-08](../../intents/05-open-questions.md#oq-08)、[KD-24](../../intents/03-decisions-and-stack.md#kd-24)～[KD-29](../../intents/03-decisions-and-stack.md#kd-29) |
| STM-R12 | Task 取消允許的來源狀態、已完成 Task 能否取消、取消後能否恢復，以及 Plan 底下所有 Task 均取消時的 Plan 狀態，須在凍結取消轉換前明確裁定。 | 草稿 | [KD-56](../../intents/03-decisions-and-stack.md#kd-56) 未定邊界；[OQ-09](../../intents/05-open-questions.md#oq-09) |
| STM-R13 | Task 若依已裁定的適用條件取消，必須記錄原因、保留並顯示取消紀錄，且不計入 Plan 完成判定。此需求不裁定允許取消的來源狀態。 | 必須 | [KD-56](../../intents/03-decisions-and-stack.md#kd-56) |

## 資料

- `Inspection Plan`、`Inspection Task`、`Evidence`、`Report` 的屬性與關聯由 [domain-model](../domain-model/spec.md) 定義；本規格只定義其狀態行為。
- 建立 `Inspection Task` 時保存 `Task Requirement Snapshot`；不得為 `Inspection Template` 新增版本實體或狀態（[PR-04](../../intents/02-principles.md#pr-04)、[KD-03](../../intents/03-decisions-and-stack.md#kd-03)）。
- `Evidence` 的照片內容依 [PR-05](../../intents/02-principles.md#pr-05) 保存為現場版與內業版；證據刪除與保留政策尚受 G-05 阻擋。
- `Report` 作為持久化版本實體保存資料快照；具體快照時間點和草稿版次邊界待 G-07 裁定（[PR-06](../../intents/02-principles.md#pr-06)）。

### 凍結門檻

本規格整體維持草稿。依 [部分凍結規則](../README.md#partial-freeze)，OQ-09 直接點名 `Inspection Plan` 與 `Inspection Task` 的完整狀態機；任務取消的來源狀態、已完成任務能否取消、取消後能否恢復及全數任務取消時 Plan 終態仍未裁定。KD-56 也未定義「任務派出」，該定義由 `inspection-planning` 規格處理。因此，即使 SM-Q12 等個別題目已裁定，也不能據此凍結 Plan／Task 的部分需求或 AC。G-05 阻擋 Evidence 的刪除與保留規則；G-06、G-07 阻擋 Report 的完整狀態、快照與版次規則。

## 狀態與轉換

以下各實體狀態與轉換均屬規格草案。來源確認的規則標為「已裁定」；英文狀態名或轉換細節若為本規格的技術提案，皆明示為「依業界做法提出、非負責人裁定」。原因：以清楚、可驗證的狀態表達建立、執行、完成及終止／失敗流程，同時保留後續依情境對答調整的空間。

### Inspection Plan

本計畫有任務派出時自動進入 `IN_PROGRESS`；底下任務全部完成後自動進入 `COMPLETED`。具備計畫封存權限代碼的使用者得手動封存。已完成計畫遇 KD-55 作廢任務時自動回到 `IN_PROGRESS`，重查完成後再自動完成；已封存計畫須先取消封存才能修改查核標準。取消任務的適用狀態及全數任務取消時的 Plan 狀態仍待規格補充。依據：負責人裁定 [#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)、[KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)。其餘建立前狀態與封存權限細節仍依 OQ-09 及權限規格處理。

| 目前狀態 | 動作與後續狀態 | 觸發者 | 裁定／提案及說明 |
|---|---|---|---|
| 已建立的 Plan | 派發任務 → `IN_PROGRESS` | 系統 | 已裁定：任務派發時由系統轉為進行中。 |
| `IN_PROGRESS` | 全部應計入完成判定的任務完成 → `COMPLETED` | 系統 | 已裁定：取消任務不計入完成判定；不提供手動完成狀態動作。 |
| `COMPLETED` | 封存 → `ARCHIVED` | 具備計畫封存權限代碼的使用者 | 已裁定得手動封存；權限代碼依適用權限設定。 |
| `COMPLETED` | KD-55 作廢相關 Task → `IN_PROGRESS` | 系統 | 已裁定：已完成計畫自動退回進行中；重查 Task 完成後依任務完成判定再自動完成。 |
| `ARCHIVED` | 取消封存 → `COMPLETED` | 具備計畫取消封存權限代碼的使用者 | 已封存計畫須先取消封存才可修改查核標準；權限與其他取消封存條件由相關功能規格定義。 |

Plan 自動進行、完成及 KD-55 作廢後退回的規則已裁定。取消、暫停等其他 Plan 狀態及轉換依 SM-Q01／SM-Q02／SM-Q11 保留編號說明；其選項題已裁定，不再作為實作門檻。

### Inspection Task

Task 採 `PENDING`、`IN_PROGRESS`、`COMPLETED`，另含裁定的 `CANCELLED` 與 KD-55 作廢標記。已完成 Task 不重開；資料更正依 KD-42 維持完成，重新查核依 KD-55 作廢並建立新 Task。同專案具現場查核權限的成員皆可開始與完成，指派僅供參考；系統記錄開始、完成等實際操作者，稽核及後續報告歸屬使用實際查核人（SM-Q12 裁定）。依據：負責人裁定 [#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)。

| 目前狀態 | 動作與後續狀態 | 觸發者 | 裁定／提案及說明 |
|---|---|---|---|
| `PENDING` | 開始查核 → `IN_PROGRESS` | 同專案具現場查核權限的成員 | 已裁定：指派僅供參考；開始時記錄實際操作者。
| `IN_PROGRESS` | 完成查核 → `COMPLETED` | 同專案具現場查核權限的成員 | 已裁定：指派僅供參考；完成時由伺服器覆核並記錄實際操作者。必要資料完整即可完成，即使有「不符合」，任務清單標示「有缺失」；改善追蹤屬 0.7.x。不得依標準值自動判定結果（KD-37、KD-54；負責人裁定[#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)）。 |
| `COMPLETED` | 更正內容 → `COMPLETED` | 具備任務資料更正權限代碼的使用者（現場與內業皆得） | 已裁定：更正不重新查核、不退回待確認；留下修正紀錄（KD-42）。 |
| 任一使用被修改項次的任務 | 選擇「要」重新查核 → 作廢舊任務 | 具備專案查核項目管理權限代碼的使用者 | 已裁定；須先詢問並警告舊查核作廢。警告及確認對話框由功能規格定義。舊任務保留並標示「標準變更作廢」；後續重查依 SM-Q03 規格設計保留舊任務並建立新任務（KD-55）。 |
| 任一使用被修改項次的任務 | 選擇「不要」重新查核 → 狀態不變 | 具備專案查核項目管理權限代碼的使用者 | 已裁定：只更正文字，不動結果、照片；記錄更正（KD-55）。 |
| 狀態待裁定 | 取消並填寫原因 → `CANCELLED` | 具任務取消權限代碼的使用者 | 取消原因、保留與不計入 Plan 完成判定已依 KD-56 裁定；允許取消的來源狀態、可否恢復等邊界屬 STM-R12 草稿。 |

本規格的技術設計採作廢標記保留舊任務並建立新任務。理由是 KD-55 要求舊任務保留，須能區分作廢紀錄與可供後續查核的任務。

### Evidence

MVP 的 Evidence 只收照片；照片保存現場版與內業版，不保存原圖或編輯中間圖（[KD-53](../../intents/03-decisions-and-stack.md#kd-53)、[PR-05](../../intents/02-principles.md#pr-05)）。來源尚未裁定 Evidence 的狀態集合、刪除及保留期限（[OQ-09](../../intents/05-open-questions.md#oq-09)、[G-05](../../intents/05-open-questions.md#g-05)）。

| 階段／狀態 | 動作與後續階段 | 觸發者 | 裁定／提案及說明 |
|---|---|---|---|
| 尚未保存 | 開始上傳 → 上傳中 | 具備照片上傳權限代碼的使用者（提案） | 上傳中階段是技術提案；權限和上傳前檢查依 SM-Q13 規格設計。 |
| 尚未保存 | 上傳照片並確認 → 現場版已保存 | 具備照片上傳權限代碼的使用者（提案） | 現場版由上傳者有限度編修並確認後保存（PR-05）；階段名稱與上傳失敗補償方式依 SM-Q13 規格設計。 |
| 上傳中 | 上傳失敗 → 上傳失敗待處理／重試 | 系統記錄 | 依 SM-Q13 規格設計記錄錯誤及清理或標記未完成產物，以供原操作者安全重試。 |
| 上傳失敗待處理 | 原操作者重試上傳 → 上傳中 | 原上傳者（提案） | 具備照片上傳權限代碼的原操作者得重試；錯誤資訊與清理方式依 SM-Q13 規格設計。 |
| 現場版已保存 | 開始加入現場與查核資訊 → 內業版產製中 | 內業系統 | 系統取得現場版並準備內業版（PR-05）；中間階段名稱是技術提案，非已裁定狀態。 |
| 內業版產製中 | 產製完成 → 內業版已保存 | 內業系統 | 系統加入資訊後保存內業版（PR-05）；產製失敗狀態與重試方式是技術提案，待 SM-Q13。 |
| 內業版產製中 | 產製失敗 → 內業版產製失敗 | 內業系統 | 依 SM-Q13 規格設計記錄錯誤及清理或標記未完成產物，以供原操作者安全重試。 |
| 內業版產製失敗 | 原操作者重試產製 → 內業版產製中 | 原產製者（提案） | 具備相應權限代碼的原操作者得重試；錯誤資訊與清理方式依 SM-Q13 規格設計。 |
| 現場版已保存 | 更正現場照片 → 更新唯一現場版 | 具照片更正權限代碼的使用者（現場與內業皆得，KD-42） | 得有限度編修並確認；仍只保存一張現場版，不保存原圖或中間版本（PR-05）。 |
| 內業版已保存 | 更正內業照片 → 更新同一張內業版 | 具照片更正權限代碼的使用者（現場與內業皆得，KD-42） | 得編修並直接更新內業版，不另增版本或中間檔（PR-05）；更正是否需原因及額外紀錄依 SM-Q13 規格設計。 |
| 任一已保存照片 | 任務依 KD-55 作廢 → 依任務作廢結果判斷可用性，並排除於報告 | 系統 | 舊任務照片、結果與標準保留且內業可找回；照片是否可用由任務作廢狀態推導，不另設 Evidence 狀態。獨立 Evidence 刪除與保留政策仍待 G-05。 |
| 任一已保存照片 | 刪除、撤回、保留期限到期 | 觸發者與政策待決 | 不提出可執行的刪除轉換；見 G-05、SM-Q07。 |

「上傳中」「上傳失敗待處理」「已保存」「現場版已保存」「內業版產製中／失敗」是描述階段的技術提案，不是來源已裁定的 Evidence 狀態值。Evidence 照片更正須依 PR-05 保持每張照片僅有現場版及內業版；MVP 不含非照片 Evidence（KD-53）。照片可用性由所屬 Task 的作廢狀態推導，不另設 Evidence 作廢狀態；獨立照片刪除 API、刪除方式與保留政策待 SM-Q07／G-05。上傳／內業版產製失敗依 SM-Q13 規格設計處理。

### Report

KD-55 裁定的「Report 不使用作廢任務資料」保留為 Report 草稿規則；如何套用至快照、重產及已發行版本須待 G-06／G-07。

負責人已裁定：產製完成的 Report 由具備相應權限代碼的使用者直接核發，不送審；錯誤已核發報告以新版取代，保留舊版並標示已被取代（[#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)、[KD-57](../../intents/03-decisions-and-stack.md#kd-57)）。G-06 其他產製狀態仍待裁定（[#94 留言](https://github.com/speko-tw/inspect-flow/issues/94#issuecomment-5967468330)）；G-07 對快照時點、Preview／草稿重產與版次界線仍有缺漏。以下並列來源，但不把待決的產製狀態合併為已裁定流程。

| 來源 | 狀態／流程 | 來源所述 |
|---|---|---|
| 架構基準 §20.6（G-06 立場 A） | `DRAFT`、`GENERATED`、`UNDER_REVIEW`、`APPROVED`、`ISSUED`、`SUPERSEDED`、`VOID` | `Report Status` 列舉；`UNDER_REVIEW`／`APPROVED` 本期不使用，審核流程之後再加時另定（KD-57）；表格未列 `issue_date` 或 `document_status` 欄位。 |
| 架構基準 §20.17（G-06 立場 B） | `DRAFT → GENERATING → GENERATED`；失敗為 `GENERATION_FAILED` | 以中間及失敗狀態表達產製交易邊界。 |
| 架構基準 §20.7／§20.13／§20.16–20.18（G-07） | 產製時取得快照、Preview 與草稿可重產的邊界未明 | 已核發版次不因現場資料異動而改變；後續應產生新版次。 |

下表保留未裁定的產製狀態候選及本次已裁定的核發路徑。已裁定的流程是 `GENERATED` 直接核發為 `ISSUED`，不經送審或核准；錯誤的已核發版本由新版取代，舊版保留並標示。其他產製狀態及 `VOID` 的適用範圍仍待 G-06／G-07。各業務動作由後端 Service 驗證（PR-16），用戶端不能直接寫入狀態。

| 目前狀態 | 動作與後續狀態 | 觸發者 | 裁定／提案及說明 |
|---|---|---|---|
| `DRAFT` | 開始產製 → `GENERATING` | 具備報告產製權限代碼的使用者（提案） | 技術提案；角色、Preview 與快照時點待 SM-Q09、SM-Q14。 |
| `GENERATING` | 產製成功 → `GENERATED` | 系統 | 技術流程提案；不得在產製完成前誤標為 `GENERATED`（PR-15）。 |
| `GENERATING` | 任一步驟失敗 → `GENERATION_FAILED` | 系統 | PR-15 要求不得誤標為完成；依 SM-Q10 規格設計記錄本次錯誤並清理或標記未完成產物，以支援安全重試。 |
| `GENERATION_FAILED` | 重試 → `GENERATING` | 具備報告產製權限代碼的使用者（提案） | 依 SM-Q10 規格設計沿用同一草稿，另記產製嘗試與錯誤資訊；正式狀態集合仍待 G-06／SM-Q14。 |
| `GENERATED` | 直接核發 → `ISSUED` | 具備報告核發權限代碼的使用者 | 已裁定：不經送審或核准，依[#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)、[KD-57](../../intents/03-decisions-and-stack.md#kd-57)。 |
| `GENERATED` | 送審 → `UNDER_REVIEW` → `APPROVED` | 不適用 | 本期不使用；審核流程之後再加時另定（KD-57）。G-06 其餘正式產製狀態仍待裁定。 |
| `DRAFT`／`GENERATED` | 作廢 → `VOID` | 具備報告作廢權限代碼的使用者（提案） | 狀態取自 §20.6；適用條件、權限、原因及可否恢復待 G-06、SM-Q14。`UNDER_REVIEW`／`APPROVED` 本期不使用，審核流程之後再加時另定（KD-57）。 |
| `ISSUED` | 錯誤 → 出新版取代，舊版標示已被新版取代 | 具備報告核發權限代碼的使用者 | 依 KD-57 已裁定出新版取代並保留舊版；版次與快照細節仍待 G-07。不得以作廢或覆寫已核發版次取代此流程（PR-06）。 |
| `SUPERSEDED`／`VOID` | 無後續轉換（終止狀態提案） | 不適用 | 是否允許恢復或撤銷終止狀態待 G-06、SM-Q14。 |

**狀態提案（待 G-06／G-07 裁定）**：產製中與失敗狀態、錯誤資訊保存與重試仍須依 PR-15 設計；正式狀態集合與 Report ID／版次邊界未定。直接核發及錯誤版本取代規則已依負責人裁定更新；SM-Q09／SM-Q10 的快照與重試技術設計另有說明。本期不使用送審／核准狀態，審核流程之後再加時另定（KD-57）；SM-Q14 保留 G-06 尚未裁定的狀態集合問題。

## 介面

| 方法 | 路徑 | 用途 | 權限 |
|---|---|---|---|
| 業務動作 API | 由功能規格定義 | 請求開始、完成、取消、作廢、重試或核發等業務動作；不得以通用欄位更新任意狀態 | 依各功能規格及權限規格 |
| 後端 Service | 內部介面 | 驗證狀態轉換、轉換前條件及關聯資料一致性 | 由各功能規格定義 |

具體 endpoint 與權限待各功能規格定義；本表不表示所有列出的動作都已獲准實作。Plan／Task 取消及 Report 直接核發依本規格已記錄的負責人裁定。依據：[PR-01](../../intents/02-principles.md#pr-01)、[PR-16](../../intents/02-principles.md#pr-16)。

## 驗收條件

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| STM-AC01 | Plan 或 Task 有本規格已定義的業務動作 | 用戶端嘗試任意寫入狀態，或請求不合法轉換 | 後端拒絕；合法業務動作由 Service 層驗證後更新狀態 | STM-R01 |
| STM-AC02 | Plan 尚未派發／進行中；至少有一個已派出的 Task | 系統派發任務或全部應計入完成判定的 Task 完成 | 派發時 Plan 自動進入進行中；全部應計入完成判定的 Task 完成時 Plan 自動完成；人員不能手動將 Plan 設為完成 | STM-R02 |
| STM-AC03 | Task 已完成 | 具任務資料更正權限代碼的使用者（現場與內業皆得）修正該任務資料 | Task 仍為完成，不設重開流程，且查得到修正者、時間與內容 | STM-R03 |
| STM-AC04 | 專案查核項目被修改，且任務使用該項次 | 具專案查核項目管理權限代碼的使用者選擇重新查核 | 系統先警告過去查核將作廢；僅相關任務被作廢並保持作廢標示，可供有權限的使用者查找；若 Plan 原已完成，系統退回進行中並於重查完成後自動完成 | STM-R04 |
| STM-AC05 | 專案查核項目被修改，且已建立任務使用該項次 | 具專案查核項目管理權限代碼的使用者選擇不要重新查核 | 僅更正文字，結果、照片與狀態不變；更正可追溯 | STM-R05、STM-R06 |
| STM-AC06 | Report 已產製完成、正在產製或產製失敗 | 有權限者核發、產製成功／失敗，或以新版更正錯誤已核發內容 | 產製完成後可直接核發、不送審；錯誤已核發內容以新版取代，舊版保留並標示已取代；產製中／失敗狀態細節依 G-06、快照及版次邊界依 G-07 裁定 | STM-R07、STM-R08 |
| STM-AC07 | Plan 或 Task 的轉換尚未有來源裁定 | 規格審查或實作規劃時遇到該轉換 | 先列入對應待決題；不得把草案提案當成核准的業務規則。Evidence 與 Report 的同項審查仍屬草稿 | STM-R09 |
| STM-AC08 | Task 提交完成請求；Result 欄位驗證與寫入及改善追蹤屬 0.7.x | 後端覆核完成條件 | 伺服器覆核必要資料完整；含「不符合」仍可完成，任務清單標示「有缺失」。本規格不定義 Result 欄位驗證與寫入；項次設有數值標準時，對應實測欄位的單位須與數值標準相同，由系統自動帶入、不得另設（KD-54）；不得依標準值自動判定結果（KD-37） | STM-R10 |
| STM-AC09 | 任務已指派或未指派；操作者為同專案且具現場查核權限的成員 | 成員開始或完成查核 | 成員均可開始／完成；系統記錄實際操作者，稽核及後續報告歸屬使用實際查核人 | STM-R11 |
| STM-AC10 | 有取消需求，或一個 Plan 底下所有 Task 均已取消 | 規格凍結或實作取消轉換前 | 先裁定可取消的 Task 狀態、取消後能否恢復及 Plan 終態；在此之前取消轉換仍屬草稿 | STM-R12 |
| STM-AC11 | Task 已依另行裁定的允許狀態取消 | 取消動作完成 | 系統記錄原因，保留並顯示取消紀錄，且不計入 Plan 完成判定；此 AC 不測試來源狀態或可恢復性 | STM-R13 |

STM-AC08 的結果欄位驗證與寫入屬 0.7.x，不屬本規格本輪實作範圍；只保留完成時伺服器覆核的介面責任。本表 AC 均為草稿驗收基準；涉及未決議題的實作須待裁定後更新本規格，再據以凍結與拆任務。

## 議題紀錄

以下保留待決與已裁定議題的編號、錨點及處理結果。未裁定業務規則不作為已核准規則；技術設計提案已標示為「規格設計（非負責人裁定）」。

<a id="sm-q01"></a>
<a id="sm-q02"></a>
<a id="sm-q11"></a>
### SM-Q01／SM-Q02／SM-Q11（合併）：計畫狀態與啟動方式（已裁定）

- **裁定**：任務派發時系統自動將 Plan 設為進行中；全部未取消任務完成時自動完成。具備計畫封存權限代碼的使用者得手動封存。取消 Task 必須填原因，且不計入完成判定。已完成 Plan 因 KD-55 作廢 Task 時自動退回進行中，重查完成後再自動完成；封存 Plan 須先取消封存才能修改查核標準。
- **依據**：負責人裁定 [#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)；計畫自動完成另依 [KD-42](../../intents/03-decisions-and-stack.md#kd-42)。封存、取消封存的具體權限由適用權限規格定義，不在本題另行推定。
- 原 SM-Q02 與 SM-Q11 併入本題；保留編號及錨點供舊引用定位（RG-M08）。

<a id="sm-q03"></a>
### SM-Q03：KD-55 作廢後如何重新查核？（規格設計，非負責人裁定）

- **規格設計**：選原 B，保留已作廢舊 Task 並建立新 Task，以關聯追溯。這可保留舊任務快照和查核紀錄，也讓新任務依更新後標準重新查核；依據 [KD-55](../../intents/03-decisions-and-stack.md#kd-55)，理由是歷史資料不可改寫（[PR-04](../../intents/02-principles.md#pr-04)）。
- **狀態表示**：舊 Task 標示作廢並保留；新 Task 進入 `PENDING`，其顯示名稱為「尚未查核」。技術名稱與關聯欄位由 domain model 決定。
- 原 SM-Q03 選項題已由本規格提出方案；若負責人對這項技術方案有不同意見可再指定修改。G-05 的獨立 Evidence 刪除問題不受本題決定。

<a id="sm-q04"></a>
### SM-Q04：誰可取消任務、允許哪些來源狀態？（部分裁定）

- **已裁定**：具任務取消權限代碼的使用者得取消 Task；取消時必須填寫原因，Task 保留、顯示為已取消且不計入 Plan 完成判定。
- **依據**：負責人裁定 [#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)。允許取消的來源狀態等邊界仍待補充，不推定額外核准流程。

<a id="sm-q05"></a>
### SM-Q05：已完成任務是否開放重開？（已裁定）

- **裁定**：已完成 Task 不重開。資料更正依 KD-42 維持完成；需要重新查核時依 KD-55 作廢原 Task 並建立新 Task。
- **依據**：負責人裁定 [#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)；[KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)。原 SM-Q05 選項題保留編號與錨點（RG-M08）。

<a id="sm-q06"></a>
### SM-Q06：任務完成失敗如何表示與重試？（規格設計，非負責人裁定）

- **規格設計**：採原選項 A，以單一資料庫交易寫入完成結果與狀態；任一步驟失敗時回復交易並維持原狀，不建立「完成失敗」狀態，顯示可修正錯誤後由使用者重試。這避免部分寫入造成狀態與結果不一致，符合後端覆核邊界（[PR-01](../../intents/02-principles.md#pr-01)、[PR-16](../../intents/02-principles.md#pr-16)）。
- 任務完成失敗採單一資料庫交易；含「不符合」仍可完成的裁定與必要資料條件見 STM-R10、SM-Q15。

<a id="sm-q07"></a>
### SM-Q07：Evidence 照片是否可獨立刪除，如何保留？

- **情境**：使用者要求獨立移除照片，或照片已被報告引用。Task 作廢時照片可用性已依 SM-Q13 規格設計，由 Task 作廢狀態推導，不屬本題。
- **選項**：刪除流程可選 A. 不提供獨立刪除；B. 具相應權限代碼的使用者提出刪除，另一具權限者核准後軟刪除；C. 具相應權限代碼的使用者可直接軟刪除，已被報告引用時改為封存。另須決定保留期限。
- **影響**：決定照片能否取回、報告引用處理及儲存成本；獨立照片刪除 API、刪除語意與保留政策仍由 G-05 裁定，排入 0.6.x，不屬本規格本輪開工範圍。依據：[KD-53](../../intents/03-decisions-and-stack.md#kd-53)、[G-05](../../intents/05-open-questions.md#g-05)。

<a id="sm-q08"></a>
### SM-Q08：報告狀態清單如何整併？（業務部分併入 SM-Q14）

原 SM-Q08 的「採用／合併 §20.6 與 §20.17 狀態清單」屬 G-06 業務待決，併入 [SM-Q14](#sm-q14)；本題保留錨點與編號供舊引用定位（RG-M08）。來源差異與決策影響見 [G-06](../../intents/05-open-questions.md#g-06)。

<a id="sm-q09"></a>
### SM-Q09：報告快照、草稿重產與 Preview 如何處理？（規格設計，非負責人裁定）

- **規格設計**：產製開始時固定本次產製快照；同一草稿重產時建立新的產製嘗試與快照，不覆寫已核發版次；DOCX/PDF 使用同一份本次快照。理由是讓同一次交付的輸出一致並保留每次失敗／重試界線（[PR-06](../../intents/02-principles.md#pr-06)、[PR-15](../../intents/02-principles.md#pr-15)）。
- **保留待決邊界**：此技術方案不裁定新 `Report` ID／正式版次何時建立，也不選定 §20.6 與 §20.17 的正式狀態集合；仍受 G-06／G-07 裁定。原 SM-Q09 選項題轉為規格設計，錨點保留。

<a id="sm-q10"></a>
### SM-Q10：報告產製失敗如何重試？（規格設計，非負責人裁定）

- **規格設計**：沿用同一草稿，由具備報告產製權限代碼的使用者發起重試；每次重試獨立記錄嘗試與錯誤資訊，重試成功前狀態不得為產製完成。理由是保留可追蹤失敗並避免另開 Report 造成版次混淆（[PR-15](../../intents/02-principles.md#pr-15)）。
- 檔案與資料庫跨資源失敗應清理未完成產物或保留可識別的待清理記錄；實際補償操作由功能規格依儲存能力定義。此為技術方案，G-06／G-07 仍待正式裁定。原 SM-Q10 選項題轉為規格設計，錨點保留。

<a id="sm-q12"></a>
### SM-Q12：誰能開始與完成 Inspection Task？（已裁定）

- **裁定**：選 B。同專案且具現場查核權限的成員皆得開始與完成任務；指派只是建議。系統必須記錄實際操作者（開始、完成等），報告與稽核以實際查核人為準。
- **依據**：負責人裁定 [#100 留言](https://github.com/speko-tw/inspect-flow/issues/100#issuecomment-5968301878)；權限依 [OQ-08](../../intents/05-open-questions.md#oq-08)、[KD-24](../../intents/03-decisions-and-stack.md#kd-24)～[KD-29](../../intents/03-decisions-and-stack.md#kd-29)，不寫固定職稱。原 SM-Q12 選項題保留錨點與編號（RG-M08）。

<a id="sm-q13"></a>
### SM-Q13：照片上傳、照片更正與內業版產製失敗怎麼處理？（規格設計，非負責人裁定）

- **適用範圍**：MVP 的 Evidence 只收照片（[KD-53](../../intents/03-decisions-and-stack.md#kd-53)）；非照片 Evidence 不在本題或本規格範圍。
- **規格設計**：原操作者可重試上傳／產製；系統記錄錯誤並清理或標記未完成產物以供安全重試。照片更正依 KD-42，具照片更正權限代碼的使用者（現場與內業皆得）可修正；保存規則仍依 PR-05，只保留現場版及內業版，不保留原圖或中間圖。理由是維持裁定權限與既定照片資料邊界（[KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[PR-05](../../intents/02-principles.md#pr-05)）。
- **作廢照片**：可用性從其所屬 Task 作廢推導；不另設 Evidence 作廢狀態，且 G-05 只處理獨立刪除 API／保留，不由此設計決定。

<a id="sm-q14"></a>
### SM-Q14（含原 SM-Q08 業務問題）：Report 產製狀態採何來源？（部分已裁定）

- **已裁定**：Report 產製完成後由具備核發權限的使用者直接核發，不送審；錯誤的已核發 Report 以新版本取代，舊版保留並標示已取代。依負責人裁定 [#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)、[KD-57](../../intents/03-decisions-and-stack.md#kd-57)。不使用固定職稱或角色矩陣；權限依 OQ-08／KD-24～KD-29。
- **仍待裁定**：G-06 §20.6 與 §20.17 的其他產製狀態如何整併，以及 `VOID` 等狀態的適用範圍；G-07 的快照、Preview、草稿重產及正式版次界線亦未定。[#94 留言](https://github.com/speko-tw/inspect-flow/issues/94#issuecomment-5967468330)確認其他報告產製狀態仍待決。
- 原 SM-Q08 業務部分併入本題並保留編號與錨點定位（RG-M08）。

<a id="sm-q15"></a>
### SM-Q15：含「不符合」結果時，Task 何時可完成？（已裁定）

- **情境**：Task 的一個或多個查核項次已選「不符合」，並已填嚴重度、註解及所有適用實測欄位；後端正覆核完成請求。
- **裁定**：必要資料完整即可完成 Task，即使結果含「不符合」；清單與報告標示「有缺失」，改善追蹤屬 0.7.x。
- **依據**：負責人裁定 [#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)；[KD-54](../../intents/03-decisions-and-stack.md#kd-54)、[KD-37](../../intents/03-decisions-and-stack.md#kd-37)。原 SM-Q15 選項題保留編號與錨點（RG-M08）。

<a id="sm-q16"></a>
### SM-Q16：KD-55 作廢任務後，已完成的 Plan 是否退回？（已裁定）

- **情境**：Plan 已自動完成，之後內業修改專案查核項目並選擇重新查核，使用該項次的已完成 Task 依 KD-55 作廢。
- **裁定**：已完成 Plan 因 KD-55 作廢 Task 時自動退回進行中，待重查 Task 完成後再自動完成；作廢 Task 不計入完成判定。
- **依據**：負責人裁定 [#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)；[KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)。原 SM-Q16 選項題保留編號與錨點（RG-M08）。

<a id="sm-q02-legacy"></a>
**原 SM-Q02 編號保留**：已併入 SM-Q01；此舊錨點僅供既有引用定位（RG-M08）。

<a id="sm-q11-legacy"></a>
**原 SM-Q11 編號保留**：已併入 SM-Q01；此舊錨點僅供既有引用定位（RG-M08）。

## 待決議題來源對照

- **OQ-09 部分裁定**：KD-42 已確定完成後更正仍維持完成、Plan 自動完成；本次負責人裁定補上任務派發、取消、封存、KD-55 作廢後退回與不符合任務完成規則。KD-03 已確定 `Inspection Template` 不版本化；KD-55 已確定標準變更時的作廢與文字更正例外。SM-Q12 已裁定：同專案具現場查核權限的成員都可開始／完成；指派僅供參考，記錄實際查核人。
- **G-05**：獨立 Evidence 刪除 API、軟／硬刪除、被報告引用的處理及保留期限未定，排入 0.6.x。
- **G-06**：Report 其他產製狀態清單在 §20.6 和 §20.17 不一致，仍待裁定；直接核發及錯誤版次取代已依負責人裁定記錄。
- **G-07**：Report Snapshot 時點、Preview／草稿重產是否覆寫及新版本何時取得新 ID 未定。

## 變更紀錄

- 依 #100 裁定更新 Task 實際查核人，並直接引用已合併的 KD-56／KD-57；本規格仍為草稿，待 OQ-09、G-05、G-06、G-07 阻擋事項處理後再凍結 — #100；[#78 裁定](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)、[#94 說明](https://github.com/speko-tw/inspect-flow/issues/94#issuecomment-5967468330)。依據：[KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[KD-57](../../intents/03-decisions-and-stack.md#kd-57) 已由 #339 合併；本 PR 不修改 intents。
