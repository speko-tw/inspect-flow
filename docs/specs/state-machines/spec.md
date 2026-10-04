# 狀態機（State Machines）

**代碼**：`STM`　**Phase**：P4、P6、P7、P9　**狀態**：部分凍結
**前置規格**：[domain-model](../domain-model/spec.md)、[api-conventions](../api-conventions/spec.md)
**引用意圖**：[PR-01](../../intents/02-principles.md#pr-01)、[PR-04](../../intents/02-principles.md#pr-04)、[PR-05](../../intents/02-principles.md#pr-05)、[PR-06](../../intents/02-principles.md#pr-06)、[PR-15](../../intents/02-principles.md#pr-15)、[PR-16](../../intents/02-principles.md#pr-16)、[KD-03](../../intents/03-decisions-and-stack.md#kd-03)、[KD-24](../../intents/03-decisions-and-stack.md#kd-24)、[KD-25](../../intents/03-decisions-and-stack.md#kd-25)、[KD-26](../../intents/03-decisions-and-stack.md#kd-26)、[KD-27](../../intents/03-decisions-and-stack.md#kd-27)、[KD-29](../../intents/03-decisions-and-stack.md#kd-29)、[KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-53](../../intents/03-decisions-and-stack.md#kd-53)、[KD-54](../../intents/03-decisions-and-stack.md#kd-54)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[KD-57](../../intents/03-decisions-and-stack.md#kd-57)
**被擋議題**：[G-05](../../intents/05-open-questions.md#g-05)、[G-06](../../intents/05-open-questions.md#g-06)、[G-07](../../intents/05-open-questions.md#g-07)
**凍結範圍**：Plan／Task 的 STM-R01～R06、STM-R09～R11、STM-R13～R18 中適用於 Plan／Task 的內容，以及 STM-AC01～AC05、STM-AC08～AC15；Evidence／Report 的需求與 AC 維持草稿。

## 目的

定義 `Inspection Plan`、`Inspection Task`、`Evidence` 與 `Report` 的狀態和轉換邊界，讓後端能一致地驗證業務動作並保留可追溯紀錄（依據：架構基準 §18、§20.6–20.8、§20.17；[PR-16](../../intents/02-principles.md#pr-16)）。Plan／Task 已裁定的狀態行為依部分凍結規則凍結；Evidence 與 Report 仍受各自待決議題阻擋，維持草稿。

## 範圍

**包含**：

- `Inspection Plan` 與 `Inspection Task` 的已裁定狀態轉換及明確標示的規格設計；Evidence 與 Report 的草稿狀態提案。
- 狀態轉換由後端 Service 層控制的介面邊界。
- 四種實體狀態機之間已確定的關係；Evidence 與 Report 的狀態機仍受各自待決議題阻擋。

**不包含**：

- 實體欄位、關聯與完整資料模型（由 [domain-model](../domain-model/spec.md) 負責）。
- API 的共通格式（由 [api-conventions](../api-conventions/spec.md) 負責）。
- 計畫與任務的建立、組成、指派、派出操作及任務產生規則（由 `inspection-planning` 規格負責）；本規格定義派出後的狀態效果及計畫狀態彙總。`inspection-planning` 亦負責計畫登記及相關操作契約。
- 證據上傳、刪除 API、保留期限及實體刪除政策（受 [G-05](../../intents/05-open-questions.md#g-05) 阻擋，獨立照片刪除與保留政策排入 0.6.x；相關功能由 `field-evidence` 規格負責）。
- 報告欄位、版次治理與輸出內容（由 `report-delivery` 規格負責；其中狀態和快照邊界受 [G-06](../../intents/05-open-questions.md#g-06)、[G-07](../../intents/05-open-questions.md#g-07) 阻擋）。

## 使用情境

- 系統於第一個任務派出時將計畫轉為進行中；草稿任務阻擋計畫完成。計畫狀態依任務完成、取消及 KD-55 項目補查自動更新；KD-55 只令已完成任務回到進行中，未完成任務維持原狀態；任何狀態的計畫均得封存，封存後任務唯讀。
- 同專案具現場查核權限的成員可開始、完成任務並提交查核資料；完成後若只需修正資料，任務仍維持完成。
- 具專案查核項目管理權限代碼的使用者修改查核項目時選擇是否重查；選擇重查時只作廢該項目的舊結果與照片，同 Task 其他項目保留，只有原已完成的 Task 回到進行中補查，未完成 Task 維持原狀態。Report 使用作廢資料的規則依 KD-55 記錄於草稿段，快照邊界仍待 G-06／G-07。
- 具報告產製／核發權限代碼的使用者產製及核發報告；產製失敗時可辨認失敗並依裁定流程重試，已核發版次不被後續異動覆蓋。
- 使用者透過明確的業務動作要求狀態轉換，後端拒絕不合法的轉換。

## 需求

本表「建議」代表依業界常見做法提出、非負責人裁定；理由列於狀態表或待決題。未經裁定的建議不能當成業務規則實作。

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| STM-R01 | `Inspection Plan` 與 `Inspection Task` 的狀態轉換必須由後端 Service 層驗證；用戶端不得直接寫入任意狀態值。Evidence 與 Report 的同項需求仍屬草稿。 | 必須 | [PR-01](../../intents/02-principles.md#pr-01)、[PR-16](../../intents/02-principles.md#pr-16)；架構基準 §18 |
| STM-R02 | 第一個 Task 派出時，系統必須自動將 Plan 標記為進行中；派出操作及現場可見性由 `inspection-planning` 規格負責。草稿 Task 阻擋 Plan 完成與已取消；Plan 有草稿時不得視為已取消或已完成。須完成所有已派出 Task 或刪除未派出草稿後，Plan 才可完成。人員不得手動將 Plan 設為完成。沒有草稿且有已完成 Task、其餘 Task 取消時，Plan 為已完成；沒有已完成 Task 且所有 Task 均取消時，Plan 自動成為已取消。KD-55 使已完成 Task 回到進行中時，已完成 Plan 自動退回進行中。 | 必須 | [KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)；[#103 留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5969654262)、[#103 補充留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970063986)；架構基準 §18 |
| STM-R03 | 已完成的 `Inspection Task` 可由具任務資料更正權限代碼的使用者（現場與內業皆得）修正資料；此類修正不得令任務離開完成狀態或要求重新完成。系統須記錄修正者、時間與內容。 | 必須 | [KD-42](../../intents/03-decisions-and-stack.md#kd-42)；[PR-08](../../intents/02-principles.md#pr-08) |
| STM-R04 | 修改專案查核項目並存檔時，系統必須詢問是否重新查核並清楚警告作廢影響，且記錄操作者、時間與選擇。選「要」時，只作廢該項目的舊結果與照片並保留供查找；同一 Task 其他項目資料保留。只有原為 `COMPLETED` 的 Task 回到 `IN_PROGRESS` 補查該項目；原為 `PENDING` 或 `IN_PROGRESS` 的 Task 維持原狀態。原 Plan 已完成時自動退回進行中，補查完成後再依完成判定更新。封存 Plan 須先取消封存才能修改查核標準。 | 必須 | [KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[PR-04](../../intents/02-principles.md#pr-04)；[#103 補充留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970063986) |
| STM-R05 | 上述修改選「不要」重新查核時，使用該項次的既有任務只更正文字，不改結果、照片或狀態；系統須記錄誰、何時、改了什麼。 | 必須 | [KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[PR-04](../../intents/02-principles.md#pr-04) |
| STM-R06 | 建立任務時必須固定當時需求為 `Task Requirement Snapshot`；`Inspection Template` 不設版本狀態機。KD-55 所述的文字更正是明確例外。 | 必須 | [PR-04](../../intents/02-principles.md#pr-04)、[KD-03](../../intents/03-decisions-and-stack.md#kd-03)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55) |
| STM-R07 | 正式 `Report` 必須作為持久化、版本化實體保存產製時的資料快照；具備相應權限代碼的使用者可在產製完成後直接核發，不須送審；錯誤的已核發報告以新版取代，保留舊版並標示已被取代。 | 必須／應 | 負責人裁定：[報告裁定留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)、[KD-57](../../intents/03-decisions-and-stack.md#kd-57)；[PR-06](../../intents/02-principles.md#pr-06)；持久化與快照為必須，版本取代為裁定規則 |
| STM-R08 | `Report` 產製失敗時不得誤標為產製完成；產製中／失敗狀態及錯誤資訊保留方式應依 PR-15 設計，具體狀態集合須待 G-06 裁定後凍結。 | 「不得誤標為產製完成」必須；其餘應 | [PR-15](../../intents/02-principles.md#pr-15)；架構基準 §20.17；[G-06](../../intents/05-open-questions.md#g-06) |
| STM-R09 | `Inspection Plan` 與 `Inspection Task` 各狀態的進入條件、允許動作及操作者範圍，須依本規格明確列出；未裁定的轉換標示為草稿，不得由技術提案推定。Evidence 與 Report 的同項整理亦屬草稿。 | 必須 | [OQ-09](../../intents/05-open-questions.md#oq-09)；本規格之可追溯需求 |
| STM-R10 | Task 完成時，伺服器必須覆核完成條件；有待重查項目的 Task 不得完成。查核結果欄位驗證與寫入屬 0.7.x。本規格不另設單位欄位或單位系統；項次設有數值標準時，對應實測欄位的單位須與數值標準相同，由系統自動帶入、不得另設，現場自行換算且單位換算不在本次範圍。實測欄位定義（型別、單位）屬 0.3.x，現場填值屬 0.7.x。不得依標準值自動判定結果。含「不符合」結果時，只要必要資料完整仍可完成，並於任務清單標示「有缺失」旗標（非狀態）；改善追蹤屬 0.7.x。 | 完成時伺服器覆核、數值標準對應單位相同且由系統帶入不得另設：必須；其他依裁定與 0.7.x 範圍 | 負責人裁定：[同一留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)、[KD-54](../../intents/03-decisions-and-stack.md#kd-54)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)；[PR-01](../../intents/02-principles.md#pr-01)、[KD-37](../../intents/03-decisions-and-stack.md#kd-37) |
| STM-R11 | 同專案且具現場查核權限的成員皆得開始與完成任務，指派僅供參考；系統必須記錄實際操作者，報告與稽核以實際查核人為準。 | 必須 | 負責人裁定：[SM-Q12 裁定](https://github.com/speko-tw/inspect-flow/issues/100#issuecomment-5968301878)；權限代碼依 [OQ-08](../../intents/05-open-questions.md#oq-08)、[KD-24](../../intents/03-decisions-and-stack.md#kd-24)～[KD-29](../../intents/03-decisions-and-stack.md#kd-29) |
| STM-R13 | 未完成的 Task（`PENDING` 或 `IN_PROGRESS`）得由內業取消，必須填原因；取消後保留照片與結果、顯示取消紀錄且不計入 Plan 完成判定。`COMPLETED` Task 不得取消。 | 必須 | [KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[#103 留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5969654262) |
| STM-R14 | 已取消 Task 得由沿用取消權限代碼的內業恢復至取消前狀態；不要求恢復原因。恢復後 Plan 狀態依目前 Task 集合重新推導。 | 得；權限與原因屬規格設計 | [KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[#103 留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5969654262) |
| STM-R15 | 未派出的草稿 Task 得直接刪除；已派出的 Task 不得刪除，只能依 STM-R13 取消。 | 得 | [KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[#103 補充留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970063986) |
| STM-R16 | 任一狀態的 Plan 得由內業封存；封存後其 Task 必須唯讀，不得查核、取消或恢復。須先取消封存才能修改標準或執行 Task 動作。 | 得封存；唯讀與限制動作：必須 | [KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[#103 留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5969654262)、[#103 補充留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970063986) |
| STM-R17 | Plan 派出前與空 Plan 使用 `DRAFT`，不設 `READY`；Plan 狀態由目前 Task 集合重新推導，新增草稿、刪除草稿、恢復 Task 或取消封存後重新判定。草稿存在時不得判為已完成或已取消。 | 規格設計（非負責人裁定） | [OQ-09](../../intents/05-open-questions.md#oq-09) 已裁定邊界；本規格設計選擇 |
| STM-R18 | Task 取消期間，若專案查核項目標準被修改，恢復該 Task 時改用目前標準；原本已有結果的被修改項目標示待重查。 | 必須 | [#103 補充留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970733042)；KD-56 補寫見 [PR #351](https://github.com/speko-tw/inspect-flow/pull/351) |

## 資料

- `Inspection Plan`、`Inspection Task`、`Evidence`、`Report` 的屬性與關聯由 [domain-model](../domain-model/spec.md) 定義；本規格只定義其狀態行為。
- 建立 `Inspection Task` 時保存 `Task Requirement Snapshot`；不得為 `Inspection Template` 新增版本實體或狀態（[PR-04](../../intents/02-principles.md#pr-04)、[KD-03](../../intents/03-decisions-and-stack.md#kd-03)）。
- `Evidence` 的照片內容依 [PR-05](../../intents/02-principles.md#pr-05) 保存為現場版與內業版；證據刪除與保留政策尚受 G-05 阻擋。
- `Report` 作為持久化版本實體保存資料快照；具體快照時間點和草稿版次邊界待 G-07 裁定（[PR-06](../../intents/02-principles.md#pr-06)）。

**門檻比對**（依[部分凍結](../README.md#partial-freeze)規則 1，比對開工門檻內 G-01～G-07、OQ-06 的「為什麼要先決定」及選項原文；結論只判斷是否阻擋本次 Plan／Task 狀態行為凍結）：

| 議題 | 字面是否指到 Plan／Task | 結論 | 理由 |
|---|---|---|---|
| G-01 | 是，點名 `Inspection Plan`、`Inspection Task` 與 `Task Requirement Snapshot` | 不阻擋本次 MVP 凍結 | MVP 已裁定不需要 interval；未決歸屬與快照只適用未來選用的自動切分功能。本次凍結範圍不含該功能，開工門檻明定未定部分不擋 MVP 凍結。 |
| G-02 | 選項範例路徑含 `task_id` | 不相關 | 只以 Task ID 作證據儲存路徑的一段，不影響 Task 欄位、狀態或規則，適用只用 ID 引用例外；原圖模型已裁定。 |
| G-03 | 否 | 不阻擋本次凍結 | 未決內容是 Evidence 編輯／上傳時序、離線暫存、前後端分工與重試，不改變本次 Plan／Task 狀態行為。 |
| G-04 | 否 | 不相關 | 議題討論 Evidence Variant 核可機制，且已裁定不另設核可流程；不影響 Plan／Task 狀態行為。 |
| G-05 | 否 | 不阻擋本次凍結 | 未決內容是 Evidence 獨立刪除 API、保留期限及已被 Report 引用證據的處理；Evidence 範圍維持草稿。 |
| G-06 | 否 | 不阻擋本次凍結 | 未決內容是 Report 完整狀態機；Report 範圍維持草稿。 |
| G-07 | 否 | 不阻擋本次凍結 | 未決內容是 Report 快照時點與草稿版次邊界；Report 範圍維持草稿。 |
| OQ-06 | 是，提到任務完成判定 | 不阻擋本次凍結 | Result 語意與完成必要資料已由 KD-54 裁定；尚未定的 Defect／改善追蹤在 0.7.x，報告呈現不屬 Plan／Task 凍結範圍。 |

### 凍結範圍與阻擋議題

Plan／Task 狀態行為依標頭所列需求與 AC 凍結。STM-AC07、Evidence／Report 的 STM-R07、STM-R08、STM-AC06，以及 Evidence／Report 表格、需求與議題段落均維持草稿；G-05、G-06、G-07 仍阻擋各自範圍。G-01 未決 interval 歸屬與快照規則只屬未來選用功能，不阻擋 MVP 狀態行為凍結。`inspection-planning` 負責 Plan／Task 建立、組成、派出操作與現場可見性及操作契約；本規格負責派出後的狀態效果、狀態轉換及 Plan 狀態彙總。資料模型仍由 `domain-model` 負責；該規格尚未凍結 Plan／Task 實體，因此相關模型實作須等其凍結，本次只凍結狀態行為。

## 狀態與轉換

Plan／Task 表格列出來源已裁定的業務行為；狀態值與重新推導方式等由本規格選定的技術細節明確標為規格設計。Evidence／Report 表格仍屬草稿提案。

### Inspection Plan

Plan 派出前與空 Plan 為 `DRAFT`（規格設計）；第一個 Task 派出時 Plan 自動進入 `IN_PROGRESS`。草稿 Task 存在時 Plan 不得完成或取消；無草稿且所有已派出 Task 完成時自動完成；沒有已完成 Task 且所有 Task 均取消時自動取消；有完成 Task、其餘 Task 取消時為完成。任何狀態的 Plan 均可封存，封存後 Task 唯讀。KD-55 只作廢被修改項目的結果與照片，不影響同 Task 其他項目；僅原已完成的 Task 回到 `IN_PROGRESS` 補查，原未開始或進行中的 Task 維持狀態，已完成 Plan 隨之退回進行中。派出操作本身與現場可見性由 `inspection-planning` 負責；Plan／Task 狀態效果與彙總由本規格負責。依據：[KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[#103 留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5969654262)、[#103 補充留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970063986)。

| 目前狀態 | 動作與後續狀態 | 觸發者 | 裁定／提案及說明 |
|---|---|---|---|
| `DRAFT` | 第一個 Task 派出 → `IN_PROGRESS` | 系統 | 派出操作及現場可見性由 `inspection-planning` 負責；派出前使用 `DRAFT`、不設 `READY`（規格設計）。 |
| `IN_PROGRESS` | 全部 Task 完成，且無草稿 → `COMPLETED` | 系統 | 已裁定；取消 Task 不計入完成判定，但草稿會阻擋完成。人員不得手動設為完成。 |
| `IN_PROGRESS` | 沒有已完成 Task、無草稿，且所有 Task 均取消 → `CANCELLED` | 系統 | 已裁定新增 Plan 已取消狀態；`CANCELLED` 為規格設計狀態值。 |
| `IN_PROGRESS` | 有已完成 Task、其餘已派出 Task 取消，且無草稿 → `COMPLETED` | 系統 | 已裁定的完成／取消關係整理；依 KD-56「取消不計入完成判斷」，草稿仍阻擋完成。 |
| 任一 Plan 狀態 | 封存 → `ARCHIVED` | 內業（權限依權限規格） | 已裁定任何狀態均得封存；封存後 Task 唯讀，不得查核、取消或恢復。 |
| `COMPLETED` | KD-55 作廢已完成 Task 的項目 → `IN_PROGRESS` | 系統 | 僅作廢被修改項目的結果與照片；同 Task 其他項目保留。該項目補查完成後，依完成判定自動完成。 |
| `ARCHIVED` | 取消封存 → 依目前 Task 集合重新推導 | 內業（權限依權限規格） | 先取消封存才能查核、取消、恢復 Task 或修改標準；取消封存後依目前 Task 集合重新推導狀態（規格設計）。 |

Plan 已裁定的自動進行、完成、取消與封存規則如表；派出前與空 Plan 使用 `DRAFT`、草稿阻擋完成及取消、取消封存後依目前 Task 集合重新推導為規格設計選擇。

### Inspection Task

Task 建立後為草稿，派出後現場才看得到，進入未開始查核階段；派出操作與可見性由 `inspection-planning` 定義。未開始及進行中的 Task 得由內業取消，須填原因並保留已記錄資料；取消 Task 得恢復至取消前狀態，沿用取消權限代碼且不要求原因（規格設計）。已完成 Task 不得取消或重新打開；KD-42 資料更正維持完成。KD-55 選擇重查時，只標記被修改項目的舊結果與照片為「標準變更作廢」，保留可查；同 Task 其他項目資料保留。原已完成 Task 回到 `IN_PROGRESS`，原 `PENDING`／`IN_PROGRESS` Task 狀態不變。有待重查項目的 Task 不得完成。無結果 Task 直接套用新標準；KD-55 影響已取消 Task 時，恢復後使用目前標準、受修改項目的既有結果標示待重查。新舊標準如何在資料上並存由 `domain-model`／`inspection-planning` 定義。同專案具現場查核權限的成員皆可開始與完成，不限受指派者；系統記錄實際操作人，稽核與後續報告使用實際查核人（SM-Q12）。依據：[KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[#100 留言](https://github.com/speko-tw/inspect-flow/issues/100#issuecomment-5968301878)、[#103 留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5969654262)、[#103 補充留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970063986)。

| 目前狀態 | 動作與後續狀態 | 觸發者 | 裁定／提案及說明 |
|---|---|---|---|
| 草稿 | 派出 → `PENDING`（未開始查核） | 內業操作；由 `inspection-planning` 定義 | 已裁定：草稿 Task 派出後現場才看得到；Task 初始及派出後英文狀態值屬規格設計。 |
| `PENDING`（已派出、未開始；英文值屬規格設計） | 開始查核 → `IN_PROGRESS` | 同專案具現場查核權限的成員 | 已裁定：不限受指派者；開始時記錄實際操作者。 |
| `IN_PROGRESS` | 完成查核 → `COMPLETED` | 同專案具現場查核權限的成員 | 已裁定：完成時伺服器覆核並記錄實際操作者。必要資料完整即可完成，即使有「不符合」；任務清單與報告標示「有缺失」，改善追蹤屬 0.7.x。 |
| `COMPLETED` | 更正內容 → `COMPLETED` | 具備任務資料更正權限代碼的使用者（現場與內業皆得） | 已裁定：更正不重新查核、不退回待確認；留下修正紀錄（KD-42）。 |
| 使用被修改項次的 Task | 選擇「要」重新查核 → 僅該項目的舊結果與照片標記作廢；完成 Task 回到 `IN_PROGRESS`，未完成 Task 維持原狀態 | 具專案查核項目管理權限代碼的使用者 | 已裁定：只作廢被改項目，其他項目資料保留；作廢資料標示「標準變更作廢」並供內業查找。Task 取消期間標準被修改時，恢復用目前標準且受影響項目待重查（[#103 補充留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970733042)；KD-56 補寫見 [PR #351](https://github.com/speko-tw/inspect-flow/pull/351)）。無結果 Task 套用新標準屬規格設計。 |
| 任一使用被修改項次的任務 | 選擇「不要」重新查核 → 狀態不變 | 具備專案查核項目管理權限代碼的使用者 | 已裁定：只更正文字，不動結果、照片；記錄更正（KD-55）。 |
| `PENDING`／`IN_PROGRESS` | 取消並填寫原因 → `CANCELLED` | 內業（具體權限代碼依權限規格） | 已裁定未完成 Task 得取消；保留照片與結果，不計入 Plan 完成判定。 |
| `CANCELLED` | 恢復 → 取消前狀態 | 內業（沿用取消權限代碼） | 已裁定得恢復；不要求原因。Plan 狀態依目前 Task 集合重新推導（規格設計）。 |
| 草稿 | 刪除 → 不再存在 | 內業 | 已裁定未派出的草稿得直接刪除；KD-55 作廢不適用於尚無結果與照片的草稿。 |

**規格設計（非負責人裁定）**：KD-55 的作廢標記如何在資料上表示，不把整個 Task 標成作廢，也不連帶作廢同一 Task 的其他項目；無結果 Task 套用新標準；取消沿用現有權限代碼、不要求原因；Plan 依目前 Task 集合重新推導。項目記錄如何與新標準並存及資料欄位由 `domain-model`／`inspection-planning` 依各自責任定義。已取消 Task 恢復後使用目前標準、受影響項目待重查是負責人裁定，見 STM-R18。

### Evidence

MVP 的 Evidence 只收照片；照片保存現場版與內業版，不保存原圖或編輯中間圖（[KD-53](../../intents/03-decisions-and-stack.md#kd-53)、[PR-05](../../intents/02-principles.md#pr-05)）。來源尚未裁定 Evidence 的狀態集合、刪除及保留期限（[G-05](../../intents/05-open-questions.md#g-05)）。

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
| 任一已保存照片 | 所屬項目依 KD-55 作廢 → 標記該項照片作廢並排除於後續報告資料 | 系統 | 該項舊照片保留並標示「標準變更作廢」，內業可查找；同 Task 其他項目照片不受影響。獨立 Evidence 刪除與保留政策仍待 G-05。 |
| 任一已保存照片 | 刪除、撤回、保留期限到期 | 觸發者與政策待決 | 不提出可執行的刪除轉換；見 G-05、SM-Q07。 |

「上傳中」「上傳失敗待處理」「已保存」「現場版已保存」「內業版產製中／失敗」是描述階段的技術提案，不是來源已裁定的 Evidence 狀態值。Evidence 照片更正須依 PR-05 保持每張照片僅有現場版及內業版；MVP 不含非照片 Evidence（KD-53）。KD-55 作廢以項目為單位標記其結果與照片，保留並供內業查找，不另設整個 Task 的作廢狀態；獨立照片刪除 API、刪除方式與保留政策待 SM-Q07／G-05。上傳／內業版產製失敗依 SM-Q13 規格設計處理。

### Report

依 KD-55，Report 不使用被作廢查核項目的舊結果與照片；同一 Task 其他未作廢項目的結果與照片仍可用，已發出的 Report 不受影響。此資料排除規則如何套用至快照及草稿重產仍待 G-06／G-07 確認。

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
| STM-AC02 | Plan 派出前或進行中；Task 含草稿、已派出、已完成或已取消狀態 | 第一個 Task 派出，或 Task 狀態／草稿集合改變 | 第一個 Task 派出時 Plan 自動進入進行中；草稿阻擋完成與取消；全部 Task 完成且無草稿時自動完成；全數取消且無完成 Task 時自動取消；人員不能手動設為完成 | STM-R02 |
| STM-AC03 | Task 已完成 | 具任務資料更正權限代碼的使用者（現場與內業皆得）修正該任務資料 | Task 仍為完成，不設重開流程，且查得到修正者、時間與內容 | STM-R03 |
| STM-AC04 | 專案查核項目被修改，且 Task 使用該項次 | 具專案查核項目管理權限代碼的使用者選擇重新查核 | 系統警告過去該項結果與照片將作廢；只標記該項資料為作廢並保留供查找，同 Task 其他項目資料不變；只有已完成 Task 回到進行中，未完成 Task 維持狀態；有待重查項目的 Task 不得完成；已完成 Plan 退回進行中並於補查完成後自動完成 | STM-R04、STM-R10 |
| STM-AC05 | 專案查核項目被修改，且已建立任務使用該項次 | 具專案查核項目管理權限代碼的使用者選擇不要重新查核 | 僅更正文字，結果、照片與狀態不變；更正可追溯 | STM-R05、STM-R06 |
| STM-AC06 | Report 已產製完成、正在產製或產製失敗 | 有權限者核發、產製成功／失敗，或以新版更正錯誤已核發內容 | 產製完成後可直接核發、不送審；錯誤已核發內容以新版取代，舊版保留並標示已取代；產製中／失敗狀態細節依 G-06、快照及版次邊界依 G-07 裁定 | STM-R07、STM-R08 |
| STM-AC07 | Evidence／Report 狀態或轉換尚未有來源裁定 | 規格審查或實作規劃時遇到該轉換 | 先列入對應待決題；不得把 Evidence／Report 草案提案當成核准的業務規則 | STM-R09 |
| STM-AC08 | Task 提交完成請求；Result 欄位驗證與寫入及改善追蹤屬 0.7.x | 後端覆核完成條件 | 伺服器覆核必要資料完整且沒有待重查項目；含「不符合」仍可完成，任務清單標示「有缺失」旗標（非狀態）。本規格不定義 Result 欄位驗證與寫入；項次設有數值標準時，對應實測欄位的單位須與數值標準相同，由系統自動帶入、不得另設（KD-54）；不得依標準值自動判定結果（KD-37） | STM-R10 |
| STM-AC09 | 任務已指派或未指派；操作者為同專案且具現場查核權限的成員 | 成員開始或完成查核 | 成員均可開始／完成；系統記錄實際操作者，稽核及後續報告歸屬使用實際查核人 | STM-R11 |
| STM-AC10 | Plan／Task 有已裁定取消、恢復及封存動作 | 內業取消／恢復 Task，或封存 Plan | 未完成 Task 可取消、已完成 Task 不可取消；取消須填原因並保留資料，恢復回到取消前狀態；任何狀態 Plan 得封存，封存後 Task 不得查核、取消或恢復，須先取消封存才能操作 | STM-R13、STM-R14、STM-R16 |
| STM-AC11 | `PENDING`／`IN_PROGRESS` Task | 內業取消 | Task 變為 `CANCELLED`，記錄原因、保留並顯示取消紀錄，且不計入 Plan 完成判定；`COMPLETED` Task 取消請求遭拒 | STM-R13 |
| STM-AC12 | Task 為 `CANCELLED`，其 Plan 未封存 | 內業恢復 Task | Task 回到取消前狀態；沿用取消權限代碼、不要求恢復原因；Plan 狀態依目前 Task 集合重新推導 | STM-R14 |
| STM-AC13 | Plan 處於任何狀態 | 內業封存 Plan，或在封存後請求 Task 動作 | Plan 進入 `ARCHIVED`；Task 查核、取消及恢復請求遭拒；取消封存後狀態依目前 Task 集合重新推導 | STM-R16、STM-R17 |
| STM-AC14 | Task 為未派出的草稿 | 內業刪除；或嘗試刪除已派出 Task | 草稿刪除成功且 Plan 狀態重新推導；已派出 Task 刪除遭拒，須使用取消動作 | STM-R15、STM-R17 |
| STM-AC15 | Task 取消期間專案查核項目標準被修改，且 Task 已取消 | 恢復 Task | 恢復後使用目前標準，原本已有結果的受修改項目標示待重查；Task 在完成待重查前不得完成 | STM-R18、STM-R10 |

STM-AC08 的結果欄位驗證與寫入屬 0.7.x，不屬本規格本輪實作範圍；只保留完成時伺服器覆核的介面責任。Plan／Task 凍結範圍如標頭所列；STM-AC07 及 Evidence／Report 仍維持草稿並受各自議題阻擋。

## 議題紀錄

以下保留待決與已裁定議題的編號、錨點及處理結果。未裁定業務規則不作為已核准規則；技術設計提案已標示為「規格設計（非負責人裁定）」。

<a id="sm-q01"></a>
<a id="sm-q02"></a>
<a id="sm-q11"></a>
### SM-Q01／SM-Q02／SM-Q11（合併）：計畫狀態與啟動方式（已裁定）

- **裁定**：第一個 Task 派出時系統自動將 Plan 設為進行中；草稿 Task 阻擋完成及取消，全部完成且無草稿時自動完成；Task 全部取消且沒有完成 Task 時 Plan 自動取消，有已完成 Task、其餘已派出 Task 取消時 Plan 為已完成。草稿存在時 Plan 不得判為已取消。任何狀態的 Plan 得封存；封存後 Task 唯讀。KD-55 只作廢被修改項目的資料；已完成 Task 回到進行中，未完成 Task 維持原狀態；已完成 Plan 隨之退回進行中，補查後自動完成。Task 取消、恢復及其資料保留依 KD-56。
- **依據**：負責人裁定 [#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)；計畫自動完成另依 [KD-42](../../intents/03-decisions-and-stack.md#kd-42)。封存、取消封存的具體權限由適用權限規格定義，不在本題另行推定。
- 原 SM-Q02 與 SM-Q11 併入本題；保留編號及錨點供舊引用定位（RG-M08）。

<a id="sm-q03"></a>
### SM-Q03：KD-55 項目作廢的狀態效果（已裁定；資料表示為規格設計）

- **裁定**：不作廢整個 Task，不另建替代 Task；只標記被修改項目的舊結果與照片為「標準變更作廢」，保留供查找。同 Task 其他項目及其資料維持有效。只有原已完成 Task 回到 `IN_PROGRESS`；未完成 Task 維持狀態。有待重查項目的 Task 不得完成。依據 [KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[#103 補充留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970063986)。
- **規格設計（非負責人裁定）**：項目層級作廢如何在資料上表示，由 `domain-model`／`inspection-planning` 依各自責任定義。
- **裁定**：Task 取消期間，若專案查核項目標準被修改，恢復該 Task 時使用目前標準；原本已有結果的被修改項目標示待重查。依據 [#103 補充留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970733042)；KD-56 補寫見 [PR #351](https://github.com/speko-tw/inspect-flow/pull/351)。
- **規格設計（非負責人裁定）**：無結果 Task 套用新標準；新舊標準的資料表示由 `domain-model`／`inspection-planning` 定義。
- G-05 的獨立 Evidence 刪除問題不受本題決定。

<a id="sm-q04"></a>
### SM-Q04：誰可取消／恢復任務、允許哪些狀態？（已裁定）

- **已裁定**：內業得取消未完成 Task（未開始或進行中），必須填原因；照片與結果保留，Task 顯示已取消且不計入 Plan 完成判定。已完成 Task 不得取消。取消 Task 得恢復至取消前狀態。
- **依據**：負責人裁定 [KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[#103 留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5969654262)。恢復沿用取消權限代碼且不要求原因；Plan 狀態依目前 Task 集合重新推導（規格設計）。

<a id="sm-q05"></a>
### SM-Q05：已完成任務是否開放重開？（已裁定）

- **裁定**：已完成 Task 不重開。資料更正依 KD-42 維持完成；需要重新查核時依 KD-55 只作廢被修改項目的舊結果與照片，保留同 Task 其他項目，只有原已完成 Task 回到進行中補查，未完成 Task 維持原狀態。
- **依據**：負責人裁定 [#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)；[KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)。原 SM-Q05 選項題保留編號與錨點（RG-M08）。

<a id="sm-q06"></a>
### SM-Q06：任務完成失敗如何表示與重試？（規格設計，非負責人裁定）

- **規格設計**：採原選項 A，以單一資料庫交易寫入完成結果與狀態；任一步驟失敗時回復交易並維持原狀，不建立「完成失敗」狀態，顯示可修正錯誤後由使用者重試。這避免部分寫入造成狀態與結果不一致，符合後端覆核邊界（[PR-01](../../intents/02-principles.md#pr-01)、[PR-16](../../intents/02-principles.md#pr-16)）。
- 任務完成失敗採單一資料庫交易；含「不符合」仍可完成的裁定與必要資料條件見 STM-R10、SM-Q15。

<a id="sm-q07"></a>
### SM-Q07：Evidence 照片是否可獨立刪除，如何保留？

- **情境**：使用者要求獨立移除照片，或照片已被報告引用。KD-55 項目作廢時僅該項照片標記作廢並由報告排除；此規則不決定獨立照片刪除與保留政策。
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
- **作廢照片**：依 KD-55 標記所屬查核項目的舊照片為作廢；不另設整個 Task 的作廢狀態。G-05 的獨立刪除 API／保留不由此設計決定。

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
### SM-Q16：KD-55 作廢項目後，已完成的 Plan 是否退回？（已裁定）

- **情境**：Plan 已自動完成，之後內業修改專案查核項目並選擇重新查核，使用該項次的已完成 Task 依 KD-55 作廢該項目資料。
- **裁定**：已完成 Task 回到進行中、未完成 Task 維持原狀態並補查被修改項目；已完成 Plan 自動退回進行中，待補查完成後再自動完成。KD-55 不作廢整個 Task。
- **依據**：負責人裁定 [#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)；[KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)。原 SM-Q16 選項題保留編號與錨點（RG-M08）。

<a id="sm-q02-legacy"></a>
**原 SM-Q02 編號保留**：已併入 SM-Q01；此舊錨點僅供既有引用定位（RG-M08）。

<a id="sm-q11-legacy"></a>
**原 SM-Q11 編號保留**：已併入 SM-Q01；此舊錨點僅供既有引用定位（RG-M08）。

## 待決議題來源對照

- **OQ-09 部分裁定**：KD-42 已確定完成後更正仍維持完成、Plan 自動完成；KD-56 裁定派出、取消、恢復、封存、草稿完成條件及 Plan／Task 狀態連動。KD-03 已確定 `Inspection Template` 不版本化；KD-55 已確定項目層級作廢與文字更正例外。SM-Q12 已裁定：同專案具現場查核權限的成員都可開始／完成；指派僅供參考，記錄實際查核人。Plan／Task 欄位與關聯由 domain-model 規格負責；該規格尚未凍結相關實體，所以資料模型實作仍依賴其凍結，不影響本規格狀態行為凍結。Evidence／Report 狀態分別受 G-05、G-06、G-07 阻擋。
- **G-05**：獨立 Evidence 刪除 API、軟／硬刪除、被報告引用的處理及保留期限未定，排入 0.6.x。
- **G-06**：Report 其他產製狀態清單在 §20.6 和 §20.17 不一致，仍待裁定；直接核發及錯誤版次取代已依負責人裁定記錄。
- **G-07**：Report Snapshot 時點、Preview／草稿重產是否覆寫及新版本何時取得新 ID 未定。

## 變更紀錄

- 依 #100／#103 裁定及補充裁定對齊 Plan／Task 狀態規則，並依部分凍結規則凍結標頭列出的狀態行為範圍；Evidence／Report 分別受 G-05／G-06／G-07 阻擋。本 PR 不修改 intents — #348。依據：[KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-54](../../intents/03-decisions-and-stack.md#kd-54)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[KD-57](../../intents/03-decisions-and-stack.md#kd-57) 已由主線合併。
