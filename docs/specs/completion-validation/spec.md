# 完成驗證（completion-validation）

**代碼**：`CMV`　**Phase**：P7　**狀態**：已凍結
**前置規格**：`field-evidence`、`field-ui`、`inspection-planning`、`state-machines`、`template-system`、`authentication`、`audit-log`、`domain-model`、`api-conventions`
**引用意圖**：[PR-01](../../intents/02-principles.md#pr-01)、[PR-04](../../intents/02-principles.md#pr-04)、[PR-07](../../intents/02-principles.md#pr-07)、[PR-08](../../intents/02-principles.md#pr-08)、[PR-10](../../intents/02-principles.md#pr-10)、[PR-16](../../intents/02-principles.md#pr-16)、[PR-17](../../intents/02-principles.md#pr-17)、[PR-18](../../intents/02-principles.md#pr-18)、[PR-19](../../intents/02-principles.md#pr-19)、[KD-37](../../intents/03-decisions-and-stack.md#kd-37)、[KD-38](../../intents/03-decisions-and-stack.md#kd-38)、[KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-50](../../intents/03-decisions-and-stack.md#kd-50)、[KD-52](../../intents/03-decisions-and-stack.md#kd-52)、[KD-54](../../intents/03-decisions-and-stack.md#kd-54)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[KD-62](../../intents/03-decisions-and-stack.md#kd-62)、[KD-65](../../intents/03-decisions-and-stack.md#kd-65)、[KD-66](../../intents/03-decisions-and-stack.md#kd-66)、[KD-51](../../intents/03-decisions-and-stack.md#kd-51)、[KD-69](../../intents/03-decisions-and-stack.md#kd-69)、[OQ-06](../../intents/05-open-questions.md#oq-06)
**被擋議題**：無。原待負責人裁定的項目已於 2026-10-10 全部裁定（見[裁定紀錄](#裁定紀錄)與[裁定紀錄留言](https://github.com/speko-tw/inspect-flow/issues/106#issuecomment-6094452837)），範圍變更依[負責人直接指示](https://github.com/speko-tw/inspect-flow/issues/106#issuecomment-6093842438)在本 PR 同步 `inspection-planning`。仍待定、但不擋本規格的：改善狀態的畫面用語（原型時確認）、更正者不是原檢查人時的重簽（[#77](https://github.com/speko-tw/inspect-flow/issues/77)，0.8.x）、報告呈現（[OQ-07](../../intents/05-open-questions.md#oq-07)，0.8.x）；依賴 [#550](https://github.com/speko-tw/inspect-flow/issues/550)（身分快照格式、外部協作人員的任務範圍限制）與 [#576](https://github.com/speko-tw/inspect-flow/issues/576)（authentication 任務 P：模組權限存取層級與兩層檢查，存取分類見 D14）。[OQ-06](../../intents/05-open-questions.md#oq-06) 已裁定；改善追蹤範圍依 [KD-65](../../intents/03-decisions-and-stack.md#kd-65)（維護者依負責人授權決定，負責人可推翻）。逐項比對見[開工門檻比對](#開工門檻比對)。

## 目的

讓現場查核人員逐項次填寫「符合／不符合／不適用」與實測值，由伺服器核實每個項次都判定完畢、必要資料齊全、照片足夠，才讓任務完成；完成後只能更正註解、實測值、照片註記與現場版並留下紀錄；有不符合的項次，內業可登記改善與複查結果，清單與報告顯示改善狀態（依據：架構基準 §16.4–16.6、§18、§20.10、§30 Phase 7；[PR-01](../../intents/02-principles.md#pr-01)、[KD-54](../../intents/03-decisions-and-stack.md#kd-54)、[KD-65](../../intents/03-decisions-and-stack.md#kd-65)）。

## 範圍

**包含**：

- 現場對每個查核項次選結果（符合、不符合、不適用），依結果填嚴重度、註解、不適用原因與實測值；寫入與讀取 API。
- 伺服器端完成驗證：依任務需求快照檢查判定、必要欄位與照片覆蓋；`POST /inspection-tasks/{id}:complete` 條件不滿足即拒絕並指出缺哪裡；完成預檢（唯讀）。
- 完成端點接收代登資訊（`proxy_entry`、`actual_inspector`），並以提交者的身分快照作為檢查人員（[KD-51](../../intents/03-decisions-and-stack.md#kd-51)）。
- 「有缺失」旗標與簡易改善追蹤：內業對不符合項次登記複查結果（已改善或尚未改善，附說明與照片），清單與詳情顯示改善狀態。
- 完成後的更正（[KD-42](../../intents/03-decisions-and-stack.md#kd-42)）：結果的註解與不適用原因、文字與數字實測值、照片註記與現場版照片，並留下更正紀錄（含更正者身分快照）；結果與嚴重度不可改，完成後不能補拍或刪除照片。
- 專案查核項目修改選「要」重新查核時，被修改項目的有效結果標示「標準變更作廢」（與 `field-evidence` 的照片作廢同一交易）。
- 現場作答畫面（一次一個項次）、完成確認與缺項提示、完成後更正；內業結果檢視與改善登記畫面。
- 管理儀表板完成數與完成率改採伺服器驗證結果的契約（實作在 `admin-dashboard` 計畫 T8）。

**不包含**（注明移到哪份規格，或屬於哪一條非目標）：

- 任務狀態與計畫狀態的轉換規則、取消與恢復、封存：依 `state-machines` 與 `inspection-planning`，本規格只引用，不重複定義。
- 照片拍攝、編修、上傳、覆蓋計算、刪除與作廢政策：`field-evidence`；本規格沿用其覆蓋計算與 `has_result` 定義，不另寫第二份。
- 報告如何呈現三種結果、嚴重度與改善狀態、缺圖能否出報表：`report-delivery`（0.8.x，[OQ-07](../../intents/05-open-questions.md#oq-07)、G-04 餘項）。
- 限期提醒、逾期、自動通知、依標準值自動判定、嚴重度阻擋完成、完整缺失（Defect／NCR）管理與更進階的改善流程：不做（[KD-65](../../intents/03-decisions-and-stack.md#kd-65)、[KD-37](../../intents/03-decisions-and-stack.md#kd-37)）。
- 一人簽認與監造抽查流程：[KD-51](../../intents/03-decisions-and-stack.md#kd-51)，簽認與更正者不是原檢查人時的重簽屬 0.8.x（[#77](https://github.com/speko-tw/inspect-flow/issues/77)）；任務的檢查層級在建立任務時固定（[#559](https://github.com/speko-tw/inspect-flow/issues/559) 的規格另做），本規格只讀不改。
- 人員模組權限與兩層權限判斷：依 [#538](https://github.com/speko-tw/inspect-flow/issues/538) 的權限模型（[KD-69](../../intents/03-decisions-and-stack.md#kd-69)）；本規格只登記自己用到的專案範圍動作代碼，並要求兩層都通過（CMV-R16）。
- 離線填寫與重新連線同步：MVP 不做（[KD-61](../../intents/03-decisions-and-stack.md#kd-61)、[FUI-R09](../field-ui/spec.md#需求)）。

## 使用情境

- 現場人員開始查核後，逐一打開每個查核項次：看標準、填實測值、選結果、需要時補嚴重度與註解、拍照；每個項次存好就看得到進度。
- 現場人員按「完成查核」，畫面先說明完成後不能重開、有幾項不符合；伺服器核實後才完成；若缺資料，畫面指出缺哪個項次的哪個欄位。
- 任務有不符合項次時照常完成，清單與詳情標示「有缺失」。
- 完成後發現資料有誤，現場或內業在完成後更正註解、原因、文字或數字實測值、照片註記或換一張現場版照片（更正數字與換照片要填更正原因），留下更正紀錄，任務仍是已完成。
- 內業在任務結果頁看到所有不符合項次，登記「已改善」或「尚未改善」的複查結果（說明必填、已改善要附照片）；全部改善後仍標示「有缺失」，清單另外顯示「已改善 n／n」。
- 內業修改專案查核項目並選「要」重新查核後，該項目的舊結果與照片標示「標準變更作廢」並保留，現場補查後再完成。

## 需求

凡下列細節未由來源直接指定者，明確標為**規格設計（非負責人裁定）**，細節整理見[規格設計清單](#規格設計清單)；這些設計不改變已凍結的領域與狀態契約。[KD-65](../../intents/03-decisions-and-stack.md#kd-65)、[KD-66](../../intents/03-decisions-and-stack.md#kd-66) 是維護者依負責人授權決定，負責人可推翻。

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| CMV-R01 | 每個查核項次**必須**各自選一個結果：符合、不符合、不適用；**不得**只替整個查核項目組選一個，**不得**預設任何結果，系統**不得**依標準值自動判定。數值落在標準值之內或之外都不影響可選的結果，也不產生警告判定。 | 必須／不得 | [KD-37](../../intents/03-decisions-and-stack.md#kd-37)、[KD-54](../../intents/03-decisions-and-stack.md#kd-54)、[OQ-06](../../intents/05-open-questions.md#oq-06) |
| CMV-R02 | 各結果的必填內容：選「不符合」**必須**選嚴重度（輕微、一般、嚴重）並填註解；選「不適用」**必須**填原因，照片選填；選「符合」沒有額外必填。不屬於該結果的欄位（例如符合時帶嚴重度）**必須**拒絕。註解與原因去除前後空白後不得為空。 | 必須 | [KD-54](../../intents/03-decisions-and-stack.md#kd-54)、[OQ-06](../../intents/05-open-questions.md#oq-06)；空白判定、不屬欄位拒絕與長度上限為規格設計（D4） |
| CMV-R03 | 項次設有實測欄位時，選「符合」或「不符合」**必須**填滿該項次全部實測欄位；量不到時改選「不適用」並寫原因，此時實測欄位選填。數字欄位**只接受**有限的十進位數字，單位由需求快照帶入、請求**不得**另帶單位；文字欄位自由填寫。伺服器**不得**比對實測值與數值標準，也不因超出標準範圍而拒收或改變結果。單位換算由現場自行處理。 | 必須／不得 | [KD-54](../../intents/03-decisions-and-stack.md#kd-54)、[KD-52](../../intents/03-decisions-and-stack.md#kd-52)、[KD-37](../../intents/03-decisions-and-stack.md#kd-37)、[TPL-R11](../template-system/spec.md#需求)；數字格式、字串保存與長度上限為規格設計（D4） |
| CMV-R04 | 寫入結果**必須**由後端覆核：只在 Task 為 `IN_PROGRESS` 且所屬 Plan 未封存時允許；同專案具現場查核權限的成員皆得填寫，不限受指派者，系統**必須**記錄實際操作者並保存其身分快照（CMV-R22）。每次儲存**必須**當場套用 CMV-R01～R03 全部規則，不保存半成品；項次一次存一筆，同一項次的並行修改**必須**以版本號偵測衝突，不得靜默覆蓋他人資料；寫入時**必須**確認該項次仍在目前快照內，並以固定鎖序（Plan、Task）與專案查核項目修改（KD-55）序列化，遇標準已變更時回報衝突而不寫入。錯誤**必須**指出是哪一個欄位。 | 必須 | [PR-01](../../intents/02-principles.md#pr-01)、[PR-16](../../intents/02-principles.md#pr-16)、[STM-R11](../state-machines/spec.md#需求)、[PR-19](../../intents/02-principles.md#pr-19)；版本號衝突偵測、鎖序、標準已變更的回報與欄位錯誤格式為規格設計（D3、D5、D8、D18） |
| CMV-R05 | 每筆結果**必須**依任務需求快照的項次穩定識別（`source_point_id`）對應，並記錄作答時的快照修訂；同一任務同一項次**最多一筆有效**（未作廢）結果；作廢的結果保留不刪。每筆結果**必須**能追溯到查核項目明細、Task、Plan、Project，並記錄填寫者與時間（沿用建立與修改紀錄）。完成度檢查與報告一律讀任務自己的快照，**不得**讀目前範本或專案副本。對應鍵由專案查核項目 PATCH 保留：點位與實測欄位帶 `id`，文字更正與重排後識別不變（[IP-R13](../inspection-planning/spec.md#需求)；負責人裁定 [CMV-Q7](#cmv-q7)；現行實作會重建點位並換發識別，須先依 IP-R13 改為保留，實作在 `field-evidence` 計畫 T5）。選「不要」時不得增減項次與實測欄位集合，選「要」時被刪除的點位連同該項目的結果一併作廢，因此結果不會留在已不存在的點位上（[CMV-Q8](#cmv-q8)）。 | 必須 | [PR-04](../../intents/02-principles.md#pr-04)、[PR-07](../../intents/02-principles.md#pr-07)、[PR-08](../../intents/02-principles.md#pr-08)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[負責人裁定（2026-10-10，第 1、12 題）](https://github.com/speko-tw/inspect-flow/issues/106#issuecomment-6094452837)、[負責人直接指示（2026-10-10，#106）](https://github.com/speko-tw/inspect-flow/issues/106#issuecomment-6093842438)；資料表與欄位為規格設計（D2） |
| CMV-R06 | 系統**必須**提供讀取結果的 API：現場讀取「作答表」（每個查核項目、每個項次與其目前有效結果，未作答為空）；內業讀取含改善狀態的同一結構，另可查已作廢結果與更正紀錄。現場回應**不得**含資料庫關聯識別以外的技術資訊；`DRAFT` Task 對現場隱藏。 | 必須／不得 | [PR-10](../../intents/02-principles.md#pr-10)、[FUI-R06](../field-ui/spec.md#需求)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)；回應形狀為規格設計（D6） |
| CMV-R07 | `POST /inspection-tasks/{id}:complete` **必須**由伺服器依該 Task 目前的需求快照核實：所有查核項目的**每個項次**都有一筆有效結果；每筆結果仍符合 CMV-R01～R03（對目前快照重新驗證）；沒有待重查的項目。任一不滿足即整筆拒絕。建立任務會擋下沒有項次的查核項目（[IP-R14](../inspection-planning/spec.md#需求)）；本規格上線前已建立、含零項次項目的任務，完成驗證視該項目無需作答（規格設計）。 | 必須 | [KD-54](../../intents/03-decisions-and-stack.md#kd-54)、[KD-38](../../intents/03-decisions-and-stack.md#kd-38)、[PR-04](../../intents/02-principles.md#pr-04)、[STM-R10](../state-machines/spec.md#需求)；對目前快照重新驗證為規格設計 |
| CMV-R08 | 完成驗證**必須**核實照片覆蓋：結果為符合或不符合的項次，有效非總覽照片數**必須**達該項次需求快照的 `min_count`（至少 1）；結果為不適用的項次照片選填，不要求覆蓋；總覽照片、已刪除與已作廢的照片不計入。覆蓋數**必須**沿用 `field-evidence` 的覆蓋計算，不得另寫第二份。 | 必須／不得 | [KD-38](../../intents/03-decisions-and-stack.md#kd-38)、[KD-50](../../intents/03-decisions-and-stack.md#kd-50)、[KD-54](../../intents/03-decisions-and-stack.md#kd-54)（不適用照片選填）、`field-evidence` FEV-R04；不適用豁免的套用位置為規格設計（D7） |
| CMV-R09 | 完成**必須**只由伺服器判定：完成端點不接受也不讀取前端回報的任何結果、覆蓋數或「已齊全」旗標，只收 CMV-R22 的兩個選填代登欄位；系統**必須**另提供唯讀的完成預檢，與完成端點共用同一個驗證函式；驗證失敗**必須**整筆不寫入（任務維持原狀、計畫不變），並一次回傳**全部**缺項，每項指出項目、項次與欄位；成功時在同一交易寫入完成者與時間（含代登欄位）並重算 Plan 狀態；完成與作答的並行**必須**序列化。 | 必須 | [PR-01](../../intents/02-principles.md#pr-01)、[PR-16](../../intents/02-principles.md#pr-16)、[SM-Q06](../state-machines/spec.md#sm-q06)、[STM-R10](../state-machines/spec.md#需求)；預檢端點、缺項格式與序列化方式為規格設計（D6、D8） |
| CMV-R10 | 任務含「不符合」結果時，只要資料齊全就**必須**可以完成，嚴重度不阻擋完成；完成後任務清單與詳情**必須**明顯標示「有缺失」。「有缺失」是旗標、不是狀態值，**必須**由目前有效（未作廢）的不符合結果即時推導，不另存欄位。全部不符合都登記「已改善」後仍標示「有缺失」（結果是歷史事實），另外顯示「已改善 n／n」（CMV-R14；負責人裁定 [CMV-Q11](#cmv-q11)）。 | 必須 | [KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[KD-54](../../intents/03-decisions-and-stack.md#kd-54)、[KD-65](../../intents/03-decisions-and-stack.md#kd-65)、[STM-R10](../state-machines/spec.md#需求)、[負責人裁定（2026-10-10，第 15 題）](https://github.com/speko-tw/inspect-flow/issues/106#issuecomment-6094452837)、[負責人直接指示（2026-10-10，#106）](https://github.com/speko-tw/inspect-flow/issues/106#issuecomment-6093842438)；即時推導為規格設計（D9） |
| CMV-R11 | 任務完成後，具更正權限的使用者（現場與內業皆得）**得**更正資料；更正**不得**使任務離開已完成狀態、不要求重新完成。可更正的範圍**必須**是：結果的註解、不適用原因、文字與數字實測值，以及照片的註記與現場版；**不得**更正結果與嚴重度（要改判斷只能走 KD-55 重新查核），也**不得**補拍或刪除照片。更正**必須**記錄更正者的身分快照、時間與改了什麼（前後值）；更正數字實測值與取代現場版**必須**填更正原因，其餘更正的原因選填。更正者不是原檢查人（任務完成者）時，紀錄**必須**能分辨出來；原檢查人重簽屬 [#77](https://github.com/speko-tw/inspect-flow/issues/77)（0.8.x）。取代現場版**必須**遵守 `field-evidence` 的已核發報告引用保護（被報告引用的照片先鎖定，0.8.x 隨 [G-06](../../intents/05-open-questions.md#g-06)、[G-07](../../intents/05-open-questions.md#g-07) 再定）。 | 得／必須／不得 | [KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-62](../../intents/03-decisions-and-stack.md#kd-62)、[KD-51](../../intents/03-decisions-and-stack.md#kd-51)、[STM-R03](../state-machines/spec.md#需求)、[IP-R08](../inspection-planning/spec.md#需求)、[負責人裁定（2026-10-10，第 7、8 題，含更正原因必填的條件）](https://github.com/speko-tw/inspect-flow/issues/106#issuecomment-6094452837)；原檢查人的比對方式與紀錄方式為規格設計（D10、D11、D21、D24） |
| CMV-R12 | 系統**不得**提供重新開啟已完成任務的端點，也**不得**取消已完成任務；需要重新查核只能走 KD-55（內業修改專案查核項目並選「要」）。本規格不新增任何會令 `COMPLETED` Task 離開完成狀態的端點。 | 不得 | [KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[STM-R13](../state-machines/spec.md#需求)、[IP-R08](../inspection-planning/spec.md#需求) |
| CMV-R13 | 內業**得**對已完成任務中、目前有效的「不符合」結果登記複查，附說明與照片；清單與詳情**必須**顯示改善狀態。本規格**不得**做限期提醒、逾期、自動通知，**不得**依標準值自動判定改善結果；改善登記不改變原結果、嚴重度與任務完成。複查結果分 `IMPROVED`、`NOT_IMPROVED` 兩種，說明一律**必須**填；登記 `IMPROVED` **必須**附至少一張照片，`NOT_IMPROVED` 照片選填；登記只增不改，最新一筆決定改善狀態（`OPEN`、`NOT_IMPROVED`、`IMPROVED`）；**只**在任務已完成時可登記，進行中的任務不可登記。`NOT_IMPROVED` 的畫面用語暫稱「尚未改善」（原型時確認）。 | 得／必須／不得 | [KD-65](../../intents/03-decisions-and-stack.md#kd-65)、[KD-37](../../intents/03-decisions-and-stack.md#kd-37)、[KD-62](../../intents/03-decisions-and-stack.md#kd-62)、[負責人裁定（2026-10-10，第 9、10、13 題）](https://github.com/speko-tw/inspect-flow/issues/106#issuecomment-6094452837)；照片張數規則以外的只增不改與三種狀態、畫面用語為規格設計（D12、D13） |
| CMV-R14 | 任務清單與詳情**必須**顯示改善狀態，內業結果頁逐項次顯示改善狀態；作廢結果不計入。呈現所需的 Task 回應新增欄位 `has_defects`、`defect_count`、`improved_count` 是對 `inspection-planning` 契約的範圍變更，依負責人直接指示在本 PR 落地（[IP-R15](../inspection-planning/spec.md#需求)；[CMV-Q10](#cmv-q10)）。全部不符合都已改善後 `has_defects` 仍為真，畫面另外顯示「已改善 n／n」（[CMV-Q11](#cmv-q11)）。報告端如何呈現屬 `report-delivery`，本規格只保證資料可讀（以結果與快照為準）。 | 必須 | [KD-65](../../intents/03-decisions-and-stack.md#kd-65)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)；欄位名稱為規格設計（D9） |
| CMV-R15 | 專案查核項目修改並選「要」重新查核時，被修改項目**目前有效的結果**依 KD-55 與 IP-R04 **必須**在同一交易標示「標準變更作廢」並保留（連同其改善登記與改善照片）；同 Task 其他項目的結果不變；選「不要」時結果與改善登記不變。項目補查完成（每個項次都有新的有效結果）時，待重查旗標**必須**由伺服器清除。「已有結果」把結果與有效照片都算進去（只有照片的項目也作廢並標待重查）；已取消任務遇「要」時，取消期間維持原紀錄，恢復的同一交易才作廢（與 `field-evidence` 的 FEV-R11 一致；負責人裁定 [CMV-Q6](#cmv-q6)）。`has_result` 納入結果屬 `inspection-planning` 的範圍變更，依負責人直接指示落地（[IP-R04](../inspection-planning/spec.md#需求)；[CMV-Q10](#cmv-q10)）。 | 必須 | [KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[STM-R04](../state-machines/spec.md#需求)、[STM-R18](../state-machines/spec.md#需求)、[IP-R04](../inspection-planning/spec.md#需求)、[IP-R07](../inspection-planning/spec.md#需求)、[負責人裁定（2026-10-10，第 2、3、14 題）](https://github.com/speko-tw/inspect-flow/issues/106#issuecomment-6094452837)、[負責人直接指示（2026-10-10，#106）](https://github.com/speko-tw/inspect-flow/issues/106#issuecomment-6093842438)；待重查旗標清除時機為規格設計（D15） |
| CMV-R16 | 後端**必須**對每個端點覆核權限，預設拒絕，採兩層模型（[KD-69](../../intents/03-decisions-and-stack.md#kd-69)、[AUT-R19](../authentication/spec.md#權限檢查)）：（1）人員模組：具查核模組「可使用」`inspection.use`；（2）專案：是專案成員且專案角色含該動作碼。兩層都通過才放行，Admin 依既有規則放行。動作碼：填寫結果、完成、現場讀取要求 `inspection_task.inspect`；內業讀取結果、作廢結果與更正紀錄要求 `inspection_result.read`；登記改善要求 `inspection_result.follow_up`；完成後更正要求 `inspection_task.correct`。本規格登記 `inspection_result.read`、`inspection_result.follow_up`、`inspection_task.correct` 三個專案範圍代碼（屬查核模組；依 [DOM-R35](../domain-model/spec.md#需求)，`inspection_result.read` 為讀取碼、`external_allowed = true`，另兩個為寫入類、`external_allowed = false`，有寫入權的外部角色待 [#550](https://github.com/speko-tw/inspect-flow/issues/550) 的範圍限制完成後再評估）；人員模組權限的授予與委派不在本規格重複定義，見 [07-permission-model](../../intents/07-permission-model.md)。三個預建專案角色的初始內容以計畫 T1 明列的代碼為準：專案工程師含本規格與 `field-evidence` 的新代碼；現場工程師含 `inspection_task.inspect`、`inspection_task.correct`，不含兩個 `read`（`inspection_result.read`、`evidence.read`）；專案查閱人員含兩個 `read`；DOM-R68 的「讀取類代碼」只指建立當時已登記的代碼。`inspection_result.read`（`evidence.read` 同理）是讀取碼，依 DOM-R35 `external_allowed = true`，這是所有 read 代碼的統一規則，不是本規格另訂。外部協作人員持唯讀角色時可以讀全案，符合 07 外部協作人員第 5 點。#550 開放任何外部寫入角色之前，內業讀取端點與圖片串流**必須**只回該人員被指派任務的內容，驗收由 #550 負責。 | 必須 | [PR-01](../../intents/02-principles.md#pr-01)、[OQ-08](../../intents/05-open-questions.md#oq-08)、[KD-69](../../intents/03-decisions-and-stack.md#kd-69)、[STM-R11](../state-machines/spec.md#需求)、[DOM-R35](../domain-model/spec.md#需求)；三個新代碼為規格設計（D14） |
| CMV-R17 | 完成後更正與改善登記**必須**各寫一筆稽核事件，與資料變更同一交易，並填 `project_id`；事件代碼與欄位登記到 `audit-log` 事件目錄。更正內容與現值相同時不寫事件。 | 必須 | [KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[PR-08](../../intents/02-principles.md#pr-08)、[ALG-R07](../audit-log/spec.md)、[ALG-R09](../audit-log/spec.md)；事件代碼與欄位為規格設計（D19） |
| CMV-R18 | 現場作答畫面**必須**在 360px、390px、768px 寬度以觸控完成，主要觸控目標至少 44×44 CSS px，內容不需水平捲動，**不得**顯示資料庫 ID、儲存鍵、雜湊、metadata 等技術資訊，並遵守 PR-19：填寫與完成後更正是分開的入口、結果無預設、有依賴的欄位先出現再填、必填標示、錯誤顯示在欄位旁並聚焦、後端未提供欄位位置時保留草稿並顯示一般錯誤、完成前於頁內確認並說明後果、離開有未儲存項次的畫面前提示、全部功能有鍵盤操作路徑；完成後畫面唯讀，只提供更正入口。一次呈現一個項次（標準、實測欄位、結果、依結果出現的嚴重度與註解或原因、照片入口）的流程**應**如介面段「畫面」所述，細節待原型關卡核可。 | 必須／不得／應 | [PR-10](../../intents/02-principles.md#pr-10)、[PR-18](../../intents/02-principles.md#pr-18)、[PR-19](../../intents/02-principles.md#pr-19)、[FUI-R08](../field-ui/spec.md#需求)；一次一個項次的流程與畫面細節為規格設計，實作前須經原型關卡 |
| CMV-R19 | 內業結果頁**必須**依查核項目呈現每個項次的標準、結果、嚴重度、註解、實測值、照片數與改善狀態，作廢結果有標示並可查；**應**可依結果與改善狀態篩選，對不符合項次提供登記複查的入口（說明、結果、照片），並顯示更正紀錄。登記複查與更正是分開的入口。畫面同樣遵守 CMV-R18 的 PR-19 要求與 360px、觸控、鍵盤。 | 必須／應 | [KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[KD-65](../../intents/03-decisions-and-stack.md#kd-65)、[PR-19](../../intents/02-principles.md#pr-19)；篩選與畫面細節為規格設計，實作前須經原型關卡 |
| CMV-R20 | 本規格上線後，任務變成 `COMPLETED` 的唯一路徑**必須**是通過 CMV-R07～R09 驗證的完成端點；管理儀表板的完成數與完成率沿用同一指標，改採此伺服器驗證的完成，不拆成兩個指標。 | 必須 | [KD-66](../../intents/03-decisions-and-stack.md#kd-66)、[PR-16](../../intents/02-principles.md#pr-16)；儀表板切換由 `admin-dashboard` 計畫 T8 實作 |
| CMV-R21 | 本規格上線前已完成的任務**必須**維持已完成，不追溯補結果、不退回進行中；它們沒有逐項結果，畫面如實說明；管理儀表板的完成數與完成率照舊計入這些任務，不拆指標（[KD-66](../../intents/03-decisions-and-stack.md#kd-66)；負責人裁定 [CMV-Q13](#cmv-q13)）。本規格上線時進行中的任務，完成時須補齊結果與照片。這類舊任務遇 KD-55「要」退回進行中後，整個任務所有項次都須補齊結果與照片，不為舊任務另設標記（負責人裁定 [CMV-Q5](#cmv-q5)）。 | 必須 | [PR-04](../../intents/02-principles.md#pr-04)（歷史不改寫）、[不可延後的意圖](../../intents/02-principles.md#costly-to-retrofit-intents)第 8 項（既有任務不得追溯改寫）、[負責人裁定（2026-10-10，第 11、16 題）](https://github.com/speko-tw/inspect-flow/issues/106#issuecomment-6094452837)、[負責人直接指示（2026-10-10，#106）](https://github.com/speko-tw/inspect-flow/issues/106#issuecomment-6093842438)；舊資料的呈現為規格設計（D17） |
| CMV-R22 | 結果、更正紀錄與改善登記**必須**保存寫入者的身分快照（姓名、單位、是否外部協作人員；寫入當下保存，日後人員資料變更不影響），格式與寫入函式依 [#550](https://github.com/speko-tw/inspect-flow/issues/550)。檢查人員取完成端點提交者的身分快照，不設必填的「由誰檢查」欄位。代登時**必須**勾選代登（`proxy_entry`）並以文字填寫實際檢查人（`actual_inspector`，不必是系統帳號，去除空白後不得為空，上限 100 字元）；未代登時**不得**帶 `actual_inspector`。兩個欄位由完成端點接收、隨完成寫入任務（不得只放在一般備註），報表（0.8.x）印在檢查人員欄旁。任務開始者與完成者的身分快照、外部協作人員只處理指派給自己任務的範圍限制屬 #550（0.7.x），本規格列為依賴。 | 必須／不得 | [KD-51](../../intents/03-decisions-and-stack.md#kd-51)、[07-permission-model](../../intents/07-permission-model.md) 第 6 點（[#538 第 25 點](https://github.com/speko-tw/inspect-flow/issues/538)）、[#551](https://github.com/speko-tw/inspect-flow/issues/551)；欄位名稱、長度上限與驗證回應為規格設計（D23） |

## 資料

`Inspection Task`、Task 項目關聯與 `Task Requirement Snapshot` 沿用 `domain-model` 與 `inspection-planning`；`Evidence` 與覆蓋計算沿用 `field-evidence`。`domain-model` 中 `Result` 仍是草稿條目，本規格自己定義下列實體，不依賴尚未裁定的欄位；`domain-model` 待後續同步（見[待釐清](#待釐清)）。共通 UUID 主鍵與建立／修改紀錄沿用 `database-foundation`。以下欄位表示、約束與索引為**規格設計（非負責人裁定）**，精確型別由 T1、T5、T6 設計並以 migration 驗收，型別只用 SQLAlchemy 內建型別。

| 實體 | 重點欄位與規則 |
|---|---|
| `Inspection Result`（資料表 `inspection_results`） | `project_id`、`task_id`、`task_inspection_item_id`、`source_point_id`（項次穩定識別）、`snapshot_revision`（作答時的快照修訂）、`outcome`（`PASS`、`FAIL`、`NA`）、`severity`（`MINOR`、`MODERATE`、`SEVERE`，只有 `FAIL` 有值）、`comment`、`na_reason`、`revision`（從 1 起，每次修改加 1）、`voided_at`／`void_reason`（目前只有 `STANDARD_CHANGED`）、建立與修改者與時間，以及寫入者身分快照（CMV-R22）。同一 `task_id` 與 `source_point_id` 在 `voided_at` 為空時唯一。 |
| 實測值（資料表 `result_measurements`） | `result_id`、`source_field_id`（快照實測欄位穩定識別）、`value`（字串，保存使用者輸入的文字）、`unit`（作答時由快照複製，文字欄位為空）；`(result_id, source_field_id)` 唯一。 |
| 改善登記（資料表 `result_follow_ups`） | `result_id`、`outcome`（`IMPROVED`、`NOT_IMPROVED`）、`note`（必填）、建立者（含身分快照）與時間；只增不改不刪。改善狀態由最新一筆推導，不另存。 |
| 改善照片 | 沿用 `field-evidence` 的 `Evidence` 與兩版模型，新增可空的 `result_id`、`follow_up_id`；沒有項次對應、不是總覽，因此不計入任何項次的覆蓋數。T6 以 migration 加欄位。 |
| 更正紀錄（資料表 `task_corrections`） | `task_id`、`target_type`（`RESULT`、`PHOTO_CAPTION`、`PHOTO_FIELD_VERSION`）、目標識別（項次或照片）、`before`／`after`（JSON 文字，只含被更正的欄位；照片現場版只記雜湊與大小，不含儲存鍵）、`reason`（更正數字實測值與取代現場版時必填，其餘選填）、更正者（含身分快照）與時間；「更正者是否為原檢查人」讀取時以更正者與任務完成者比對得出，不另存。 |
| 任務完成資訊（`inspection_tasks` 新增欄位） | `proxy_entry`（布林，預設 `false`）、`actual_inspector`（文字，可空，100 字元內；`proxy_entry` 為真時必填）。任務開始者與完成者的身分快照欄位屬 [#550](https://github.com/speko-tw/inspect-flow/issues/550)。 |

規則：

- `outcome`、`severity` 的合法組合由 Service 層覆核並以測試驗證，資料庫以 `CHECK` 約束輔助。
- `item_status`（`task_inspection_items`）由結果推導：項目內每個項次都有有效結果為 `COMPLETED`，否則 `PENDING`；`needs_reinspection` 在該項目補查完成時由伺服器清除（D16）。
- 任務的「有缺失」與改善計數（`defect_count`、`improved_count`）由有效結果與最新改善登記即時聚合，不另存；列表以資料庫聚合或批次載入，查詢數不隨筆數成長。
- 數字實測值只接受 `-?數字(.數字)?` 的有限十進位格式（不接受指數、千分位、NaN、Infinity）；長度與各文字欄位上限見 D4。請求欄位上限依 SEC-004 慣例登記於 `backend/app/api/limits.py`。
- 結果與改善照片不得存放圖片位元組；照片檔案與儲存鍵規則完全沿用 `field-evidence`。

### 開工門檻比對

依[部分凍結](../README.md#partial-freeze)規則逐項比對[開工門檻](../../intents/05-open-questions.md#gate)內與本規格有關的議題。本規格自己定義 `Inspection Result` 與改善登記，不依賴尚未裁定的欄位。

| 議題 | 與本規格的關係 | 結論 |
|---|---|---|
| G-01 | interval 查核間距的歸屬與快照 | 部分裁定，MVP 不設 interval（KD-36）；結果與完成驗證不含 interval，不擋 |
| G-08 | Result 欄位與缺失管理 | 已移轉：欄位依 OQ-06 裁定，改善追蹤依 KD-65，報告呈現移至 OQ-07；不擋 |
| OQ-08 | 權限模型 | 已裁定；本規格登記的三個專案動作權限代碼為規格設計，兩層判斷依 #538，不擋 |
| OQ-06 | 三種結果、嚴重度、註解、不適用原因、實測欄位型別與必填 | 已裁定，本規格的核心依據（[KD-54](../../intents/03-decisions-and-stack.md#kd-54)） |
| OQ-07 | 報告如何呈現三種結果與嚴重度 | 未裁定，屬 0.8.x；本規格只提供可讀的結果與改善資料，不擋 |
| OQ-09 | 完成後更正、重開、作廢路徑 | 已部分裁定（[KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)）；更正的可改範圍與記錄方式為規格設計，見 [CMV-Q1](#cmv-q1) |
| G-03、G-05、OQ-17 | 照片流程、刪除、上傳契約 | 已決定，由 `field-evidence` 承接；本規格沿用其管線 |
| G-04 餘項 | 缺圖能否出報表、圖片選用細節 | 屬 `report-delivery`；與本規格的「完成時照片覆蓋」無關 |
| G-06、G-07 | Report 狀態與快照 | 與 `Inspection Result` 欄位無關；只影響報告如何引用結果，屬 `report-delivery` |
| OQ-19 | 報告是否標示「照片已調整」 | 未裁定，屬 0.8.x；本規格的現場版更正只記雜湊與大小 |

## 介面

路徑、欄位與錯誤碼為**規格設計（非負責人裁定）**，遵守 [api-conventions](../api-conventions/spec.md)：`/api/v1` 前綴、UUID、JSON、共用錯誤格式、時間為 UTC ISO 8601。`point_id` 是項次的穩定識別（`source_point_id`），`field_id` 是實測欄位的穩定識別，兩者都由作答表端點提供；畫面使用它們對應欄位，**不顯示**。

| 方法 | 路徑 | 用途 | 權限 |
|---|---|---|---|
| GET | `/api/v1/field/inspection-tasks/{task_id}/results` | 現場作答表：每個查核項目與項次的目前有效結果，未作答為 `null`；含 `has_defects` | `inspection_task.inspect`；`DRAFT`、不存在或無權限回 404 |
| GET | `/api/v1/field/inspection-tasks/{task_id}/completion-check` | 完成預檢（唯讀）：`ready`、全部缺項 `problems`、各結果計數 `summary` | 同上 |
| PUT | `/api/v1/inspection-tasks/{task_id}/results/{point_id}` | 填寫或修改一個項次的結果；整筆取代；Task `IN_PROGRESS` | `inspection_task.inspect` |
| POST | `/api/v1/inspection-tasks/{task_id}:complete` | 完成任務；沿用既有端點，body 只收選填的 `proxy_entry`、`actual_inspector`（CMV-R22）；驗證失敗回 422 | `inspection_task.inspect`；Task `IN_PROGRESS` |
| PATCH | `/api/v1/inspection-tasks/{task_id}/results/{point_id}` | 完成後更正註解、不適用原因、實測值；需帶 `expected_revision`；Task `COMPLETED` | `inspection_task.correct` |
| PUT | `/api/v1/inspection-tasks/{task_id}/photos/{photo_id}/caption` | 完成後更正照片註記；Task `COMPLETED` | `inspection_task.correct` |
| PUT | `/api/v1/inspection-tasks/{task_id}/photos/{photo_id}/field-version` | 完成後以更正上傳取代現場版（multipart，驗證同 `field-evidence` 上傳）；Task `COMPLETED` | `inspection_task.correct` |
| GET | `/api/v1/inspection-tasks/{task_id}/results` | 內業結果：與作答表同結構，另含改善狀態與計數 | `inspection_result.read` |
| GET | `/api/v1/inspection-tasks/{task_id}/voided-results` | 已作廢結果清單；cursor 分頁 | `inspection_result.read` |
| GET | `/api/v1/inspection-tasks/{task_id}/corrections` | 更正紀錄清單；cursor 分頁 | `inspection_result.read` |
| GET | `/api/v1/inspection-tasks/{task_id}/results/{point_id}/follow-ups` | 某項次的改善登記歷史；cursor 分頁 | `inspection_result.read` |
| POST | `/api/v1/inspection-tasks/{task_id}/results/{point_id}/follow-up-photos` | 上傳一張改善照片（multipart，驗證與冪等同 `field-evidence` 上傳）；回照片識別，尚未掛到登記 | `inspection_result.follow_up`；Task `COMPLETED` |
| POST | `/api/v1/inspection-tasks/{task_id}/results/{point_id}/follow-ups` | 登記複查：`outcome`、`note`、`photo_ids`；同一交易掛上照片 | `inspection_result.follow_up`；Task `COMPLETED` |

沿用 `inspection-planning` 的 Task 讀取端點，回應**新增** `has_defects`、`defect_count`（T3）與 `improved_count`（T6）；Plan 詳情與 Task 清單內的 Task 摘要同樣帶這三個欄位，讀取權限不變，仍為 `inspection_task.read`。這是對 `inspection-planning` 契約的範圍變更，依[負責人直接指示（2026-10-10）](https://github.com/speko-tw/inspect-flow/issues/106#issuecomment-6093842438)在本 PR 落地，規則見該規格的 IP-R15。

**作答請求**（`PUT .../results/{point_id}`）：`outcome`（`PASS`、`FAIL`、`NA`，必填）、`severity`、`comment`、`na_reason`、`measurements`（`[{"field_id", "value"}]`，`value` 一律是字串）、`expected_revision`（建立新結果時省略；修改既有結果時必填，須等於目前 `revision`）。不收單位、不收項次以外的識別。建立回 201，修改回 200，回應為該項次完整結果。

**欄位允許矩陣**（作答與完成驗證共用同一份規則）：

| 欄位 | 符合 | 不符合 | 不適用 |
|---|---|---|---|
| `severity` | 不得 | 必填 | 不得 |
| `comment` | 選填 | 必填 | 選填 |
| `na_reason` | 不得 | 不得 | 必填 |
| 實測值（項次設有實測欄位時） | 全部必填 | 全部必填 | 選填，可只填部分 |

空值規則：必填欄位省略、為 `null` 或去除前後空白後為空，一律歸 `required`；「不得」欄位帶 `null` 或省略視為未提供，帶任何字串（含空字串）歸 `not_allowed`；選填欄位去除前後空白後為空則存為空；不適用的實測值為空字串視為未填、不保存。數字欄位去除前後空白後須符合數字格式，否則 `invalid_number`；超過長度上限歸 `too_long`；`field_id` 不屬於該項次歸 `unknown_field`；同一 `field_id` 重複歸 `duplicate`。

**完成後更正請求**（皆要求 Task 為 `COMPLETED`、Plan 未封存、呼叫者具 `inspection_task.correct`）：

- `PATCH .../results/{point_id}`：`expected_revision`（必填）、`comment`、`na_reason`、`measurements`（只列要改的 `field_id`）、`reason`（更正含數字實測值時必填，否則選填，上限 200 字元）；只改有帶的欄位，其餘不變；帶 `outcome` 或 `severity` 一律拒絕；更正後的內容仍須符合欄位允許矩陣（例如不符合的註解不能改成空白）；更正成功版本加 1。
- `PUT .../photos/{photo_id}/caption`：`caption`、`expected_caption`（目前註記，無註記為 `null`）、`reason`（選填）。
- `PUT .../photos/{photo_id}/field-version`：multipart，欄位同 `field-evidence` 的上傳（`file`、`sha256`、標頭冪等鍵、選填 `field_edit`），另帶 `expected_sha256`（目前現場版的雜湊）與必填 `reason`（上限 200 字元）；被已核發報告引用的照片拒絕取代（呼叫 `field-evidence` 登記的引用檢查）。
- 內容與現值完全相同時回「更正無變動」，不寫更正紀錄、不寫稽核事件、不加版本（與 [ALG-R09](../audit-log/spec.md) 的「前後相同不寫紀錄」一致）；`expected_*` 與目前值不符回「版本衝突」，回應帶目前內容，資料不變。

**結果物件**：`point_id`、`outcome`、`severity`、`comment`、`na_reason`、`measurements`、`revision`、`recorded_by: {name_zh, is_me}`、`updated_at`；內業視圖另含 `follow_up: {status, count, latest}`、`voided_at`、`void_reason`，並以改善狀態（`OPEN`、`NOT_IMPROVED`、`IMPROVED`）表示。任何視圖都不含儲存鍵。

**更正紀錄物件**：`target_type`、目標識別、`before`、`after`、`reason`、`corrected_by`（身分快照：姓名、單位、是否外部協作人員）、`is_original_inspector`（更正者是否為任務完成者）、`corrected_at`；不含儲存鍵。

**完成預檢與完成失敗的缺項**：`problems` 為陣列，每項 `{item_id, point_id, kind, field, reason, required, covered}`，只填適用的欄位。`kind`：`result_missing`（項次沒有有效結果，只有照片也算）、`result_invalid`（有結果但不符合目前快照的規則，`field` 指到欄位、`reason` 說明）、`photos_insufficient`（`required`、`covered` 為需要與已有張數）、`needs_reinspection`（項目待重查，`point_id` 為空）。`summary` 含項次總數、已作答數與符合、不符合、不適用各自的數量，供完成前的確認說明使用。完成失敗回 422「完成缺項」，`error.details.problems` 與預檢的 `problems` 同格式。照片「已有 n／需要 m」的畫面提示來自 `field-evidence` 的覆蓋端點，完成預檢才是權威。

**欄位錯誤**：作答、更正、完成與改善登記的業務規則失敗回 422，`error.details.fields` 為陣列 `{field, reason}`；`field` 是 `outcome`、`severity`、`comment`、`na_reason`、`measurements.<field_id>`、`note`、`photo_ids`、`reason`、`proxy_entry`、`actual_inspector`；`reason` 是 `required`、`not_allowed`、`invalid_number`、`too_long`、`unknown_field`、`duplicate`、`not_found`。型別或結構錯誤（例如缺少 `outcome`、`value` 不是字串）走共用的「結構驗證失敗」。`error.details` 為物件，是新增的共用慣例，與 `field-evidence` 同一條，列在計畫 T0，T2 依賴它。

**錯誤**（遵守 [API-R07](../api-conventions/spec.md#需求)；以條列呈現，錯誤碼的唯一來源是程式的錯誤碼列舉，本段只是便於閱讀的說明；AC 與計畫以名稱稱呼）：

- 「作答規則違反」：422 `inspection_result.invalid`，作答或更正違反欄位允許矩陣與 CMV-R01～R03，`error.details.fields` 指到欄位。
- 「更正不允許」：422 `inspection_result.correction_not_allowed`，更正請求帶了結果或嚴重度，或該項次沒有可更正的有效結果。
- 「更正無變動」：422 `inspection_result.correction_unchanged`，更正內容與現值相同。
- 「改善登記不合法」：422 `inspection_result.follow_up_invalid`，違反改善登記規則，`error.details.fields` 指到欄位。
- 「改善目標不合法」：422 `inspection_result.follow_up_target_invalid`，目標項次沒有有效的不符合結果。
- 「完成缺項」：422 `inspection_task.items_incomplete`，完成驗證失敗；既有錯誤碼，新增 `error.details.problems`。
- 「結構驗證失敗」：422 `request.validation_failed`，型別、結構、缺少必填欄位、請求長度超過上限。
- 「版本衝突」：409 `inspection_result.revision_conflict`，`expected_*` 與目前值不符，或該項次已有結果卻沒帶版本；回應帶目前內容。
- 「標準已變更」：409 `inspection_result.standard_changed`，作答的項次已不在目前快照（專案查核項目已被修改）。
- 「狀態鎖定」：409 `inspection_result.task_locked`，Task 狀態不允許此動作（見狀態矩陣）。
- 「計畫已封存」：409 `inspection_plan.archived`，既有錯誤碼。
- 「非法轉換」：409 `inspection_task.invalid_transition`，完成端點遇到非 `IN_PROGRESS` 的 Task；既有錯誤碼。
- 「權限不足」：403 `permission.denied`，缺少所需專案權限。
- 「找不到」：404 `resource.not_found`，Task、項次、照片不存在，`DRAFT` 對現場隱藏，或項次不屬於該 Task。

改善照片與現場版取代沿用 `field-evidence` 的上傳錯誤（含照片鎖定）。

**狀態矩陣**：

| 動作 | `PENDING` | `IN_PROGRESS` | `COMPLETED` | `CANCELLED`／封存 Plan |
|---|---|---|---|---|
| 填寫或修改結果 | 拒絕 | 允許 | 拒絕 | 拒絕 |
| 完成 | 拒絕 | 允許（須通過驗證） | 拒絕 | 拒絕 |
| 完成後更正（結果、註記、現場版） | 拒絕 | 拒絕 | 允許 | 拒絕 |
| 登記改善與上傳改善照片 | 拒絕 | 拒絕 | 允許 | 拒絕 |
| 讀取 | 允許 | 允許 | 允許 | 允許 |

`DRAFT` Task 對僅具 `inspection_task.inspect` 的使用者一律回 404（沿用 [IP-R09](../inspection-planning/spec.md#需求) 的隱藏規則），其他人回 409 `inspection_result.task_locked`。

**權限代碼**（依 [DOM-R35](../domain-model/spec.md#需求) 由本規格登記，規格設計）：

| 權限代碼 | 範圍 | 用途 | 建議預設對象（OQ-08） |
|---|---|---|---|
| `inspection_task.inspect` | 專案 | 既有；本規格用於填寫結果、完成、現場讀取 | 現場工程師 |
| `inspection_result.read` | 專案 | 內業讀取結果、作廢結果、更正紀錄與改善歷史 | 專案工程師、專案查閱人員 |
| `inspection_result.follow_up` | 專案 | 登記複查結果與改善照片 | 專案工程師 |
| `inspection_task.correct` | 專案 | 完成後更正結果文字、實測值與照片 | 現場工程師、專案工程師 |

三個代碼都屬查核模組：專案內動作要先通過 `inspection.use`，再看專案角色（CMV-R16）。存取分類見 D14。預建角色的初始內容見 CMV-R16 與計畫 T1（規格設計）；既有資料庫的預建角色依 [DOM-R68](../domain-model/spec.md#需求) 不被覆寫，由 Admin 於角色編輯勾選。

**稽核事件**（登記到 `audit-log` 事件目錄，規格設計）：`inspection_task.corrected`（`project_id`、Task、更正目標、前後值、更正者、時間）、`inspection_result.follow_up_registered`（`project_id`、Task、項次、複查結果、說明、照片數）。兩者都不是「每次都寫」的事件：更正無變動時直接拒絕，不呼叫稽核入口。作廢沿用 `project_inspection_item.updated`，不另寫新事件。

**畫面**（重大新畫面，實作前須先過[原型關卡](../README.md#ui-prototype-gate)；以下為規格設計）：

- 現場：在 `/field/tasks/{task_id}` 詳情內，`IN_PROGRESS` 任務顯示整體進度「已填 n／共 m 項次」與各項次狀態（未填、符合、不符合、不適用，另標照片是否足夠）；點項次進入一次一個項次的填寫畫面：標準（文字或數值，數字欄位旁顯示單位與「請換算成此單位」提示）、實測欄位、三選一結果（初始都不選）、選「不符合」才出現嚴重度與註解、選「不適用」才出現原因、照片入口與「已有 n／需要 m 張」；「儲存並到下一項」與「儲存並回清單」。「完成查核」在頁內說明後果（完成後不能重開、只能更正註解、實測值、照片註記與現場版，並留下紀錄、有 n 項不符合會標示「有缺失」）；頁內另有「代登」勾選，勾選後才出現必填的「實際檢查人」文字欄；伺服器拒絕時列出缺項並可一鍵跳到第一個缺項。已完成任務唯讀，並提供「更正」入口與更正前的說明。
- 內業：任務頁的「結果」頁籤，依查核項目分組列出項次與結果、改善狀態、作廢標示，可依結果與改善狀態篩選；對不符合項次開啟「登記複查」（結果、說明、照片）；另有更正紀錄清單。
- 「有缺失」標示的樣式由 `statusBadge` 單一對照表定義，同一個詞在任務清單、詳情與計畫頁同一個顏色，且不與「已完成」的綠色混淆；顏色在原型關卡定案。

## 驗收條件

以下 AC 的 API、權限與端對端驗收**必須**以真實後端驗證；mock 只可用於單元與元件呈現測試，不得單獨作為契約或端對端證據（[PR-19](../../intents/02-principles.md#pr-19)、[RG-M22](../../review-guidelines.md)）。UI 的 360px 驗收以 SQLite 真後端、Vite 與無頭瀏覽器從登入開始只靠點擊走查，並保存桌面與 360px 淺色模式截圖。表中的錯誤以名稱稱呼，名稱與錯誤碼的對照見介面段的「錯誤」清單；AC 表不重述錯誤碼。

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| CMV-AC01 | `IN_PROGRESS` Task，一個查核項目有三個項次；現場使用者具 `inspection_task.inspect` | 只為第一個項次 `PUT` 結果；另送不含 `outcome` 與 `outcome` 為其他值的請求 | 只有該項次有結果，另兩個項次在作答表中為 `null`，沒有任何預設結果，也沒有整組結果；缺少或不合法的 `outcome` 回 422 結構驗證失敗，資料不變 | CMV-R01、R04 |
| CMV-AC02 | 項次不含實測欄位 | 依序送出：符合（無額外欄位）；符合但帶嚴重度；不符合缺嚴重度；不符合缺註解、註解只有空白、註解超過上限；不符合附完整嚴重度與註解（輕微、一般、嚴重各一次）；不適用缺原因或原因只有空白；不適用附原因且不帶照片；各結果帶不屬於它的欄位（含空字串） | 符合、完整的不符合與不適用成功；其餘回 422 作答規則違反，`error.details.fields` 依欄位允許矩陣指出 `severity`、`comment`、`na_reason` 的 `required`、`not_allowed` 或 `too_long`（空白與空字串歸 `required`，不屬於該結果的欄位帶任何字串歸 `not_allowed`）；不適用不要求照片；失敗時資料不變 | CMV-R02 |
| CMV-AC03 | 項次有一個數字欄位（單位公尺）與一個文字欄位，並綁定數值標準 3.3 ± 0.3 | 送出：符合且兩欄俱全；符合缺一欄或值只有空白；不符合缺一欄；不適用不填；數字欄填 `abc`、`1e3`、`NaN`、`1,000`；文字欄超過上限；`field_id` 不屬於該項次、重複的 `field_id`；請求帶單位；數值超出標準範圍仍選符合；數值在範圍內卻選不符合 | 俱全時成功，值以送入的字串保存（例如 `3.30`）；缺欄回 `measurements.<field_id>` 的 `required`；不適用成功；非法數字回 `invalid_number`；超長回 `too_long`；不屬於該項次的欄位回 `unknown_field`；重複回 `duplicate`；帶單位回 422 結構驗證失敗；超出或在範圍內都照選的結果保存，沒有自動判定與警告 | CMV-R03、R01 |
| CMV-AC04 | Task 分別為 `DRAFT`、`PENDING`、`IN_PROGRESS`、`COMPLETED`、`CANCELLED`，另有封存 Plan | 現場填寫結果；讀取作答表 | 依狀態矩陣：`IN_PROGRESS` 成功；`PENDING`、`COMPLETED`、`CANCELLED` 回 409 狀態鎖定；封存 Plan 回 409 計畫已封存；`DRAFT` 對僅具 `inspect` 者回 404；各狀態讀取皆可（`DRAFT` 現場除外）；被拒絕時資料不變 | CMV-R04 |
| CMV-AC05 | 專案成員 U1 具 `inspection_task.inspect`、U2 只有 `inspection_task.read`、U3 非成員、內業 U4 具 `inspection_result.read`、U7（專案角色含 `inspection_task.inspect`，但沒有查核模組「可使用」）、Admin | 各自呼叫現場作答表、填寫、完成、內業結果 | U1 可讀寫與完成；U2、U3 在一般端點回 403 權限不足，在 `/field/` 端點依 [FUI-R06](../field-ui/spec.md#需求) 回 404；U4 可讀內業結果但不能填寫或完成；Admin 全部放行；U7 一律回 403（兩層都要通過）；三個新權限代碼已登記並已歸入存取分類（`inspection_result.read` 是讀取碼，不算內業也不算現場；`inspection_result.follow_up` 屬內業；`inspection_task.correct` 現場與內業角色都會持有，依 D14 列為分類例外，不使現場角色被判為有內業入口），分類測試與前端內業區段判斷都涵蓋新代碼；未登記的代碼無法指派給角色 | CMV-R16、R04 |
| CMV-AC06 | 同專案另一位具 `inspection_task.inspect` 的 U6（非建議指派人）；同一項次已有結果 | U6 填寫一個項次；同一項次再以相同內容重送；以舊版本號修改；未帶版本號修改既有結果；兩個請求同時為尚無結果的同一項次建立結果 | 結果的建立與修改者是 U6，不是建議指派人；以正確版本號修改成功且版本加 1；舊版本號或未帶版本號回 409 版本衝突並帶目前結果，資料不變；並行建立只成功一筆，另一筆回 409 版本衝突 | CMV-R04、R05 |
| CMV-AC07 | Task 有兩個項目、多個項次，部分已作答，部分作廢；內業有 `inspection_result.read` | 現場讀作答表；內業讀結果、作廢結果清單 | 作答表列出每個項目與項次，未作答為 `null`，沒有儲存鍵、雜湊或 metadata；內業結果含改善狀態與計數；作廢結果只在作廢清單出現，含 `void_reason`；清單以 cursor 分頁且無重複遺漏 | CMV-R06 |
| CMV-AC08 | `IN_PROGRESS` Task：部分項次未作答；一個項次只有照片沒有結果；另一項次的結果對目前快照已不符合規則（防禦性檢查：API 在選「不要」時不允許改動項次與實測欄位集合，這個情境以資料庫直接造資料測試）；另一項目待重查 | 呼叫完成 | 回 422 完成缺項，`error.details.problems` 一次列出全部缺項（`result_missing`、只有照片的項次仍是 `result_missing`、`result_invalid` 含 `field` 與 `reason`、`needs_reinspection`）；Task 仍為 `IN_PROGRESS`，`completed_by` 與 `completed_at` 為空，Plan 狀態不變 | CMV-R07、R09 |
| CMV-AC09 | 項次 A（`min_count` 1）、B（`min_count` 2），結果皆為符合；項次 C 為不適用；另有總覽照、已刪除照、已作廢照 | 在不同照片數下呼叫完成：A 無照片；A 有一張；B 只有一張；B 有兩張；C 無照片；只有總覽或已刪除或已作廢的照片 | 缺照片回 422 完成缺項並帶 `photos_insufficient`（含 `required` 與 `covered`）；A、B 達標後成功；C 不要求照片；總覽、已刪除、已作廢不計入；覆蓋數與 `field-evidence` 的覆蓋計算結果一致（以同一函式驗證，不另算） | CMV-R08 |
| CMV-AC10 | 資料庫的結果不齊全；前端送出的完成請求帶 `{"complete": true, "all_points_satisfied": true}` 之類的自報內容 | 呼叫完成；呼叫完成預檢；補齊後再次預檢與完成 | 完成仍回 422 完成缺項，自報內容無效；預檢回 `ready: false` 與和完成失敗相同的 `problems`，且不改變任何資料；補齊後預檢 `ready: true`，完成成功；預檢與完成使用同一個驗證函式（以測試斷言兩者結果一致） | CMV-R09 |
| CMV-AC11 | Task 的項次含符合、不適用，以及嚴重度為輕微、一般、嚴重的不符合，資料齊全；該 Plan 只剩這個 Task 未完成 | 呼叫完成 | 成功（嚴重度不阻擋）；Task 為 `COMPLETED`，`completed_by` 是實際操作者；Plan 自動完成；Task 讀取、清單與 Plan 詳情的 `has_defects` 為 `true`，`defect_count` 為 3、`improved_count` 為 0 | CMV-R10、R07、R09 |
| CMV-AC12 | 兩個已完成任務：一個全為符合與不適用；一個的不符合結果已被 KD-55 作廢 | 讀取 Task 與清單 | 前者 `has_defects` 為 `false`、`defect_count` 為 0；後者作廢的不符合不計入；`has_defects` 由結果即時推導，資料表沒有對應的儲存欄位 | CMV-R10 |
| CMV-AC13 | `COMPLETED` Task，一個符合結果有註解、一個不適用有原因、一個符合有文字與數字實測值；具 `inspection_task.correct` 的現場使用者 U1 與內業 U4 | 各更正註解、原因、文字實測值、數字實測值（一次一個；註解、原因、文字實測值帶或不帶更正原因，數字實測值另試不帶原因）；送出與現值相同的內容；以舊版本號更正；對符合結果更正不適用原因 | 更正回 200 且版本加 1；Task 與 Plan 仍是原狀態，沒有重新完成；更正數字實測值未帶更正原因回 422 作答規則違反（`reason` 為 `required`）；`GET corrections` 查得到更正者（身分快照，之後修改人員資料不影響）、時間、目標、前後值與原因，並標示更正者是否為原檢查人（非任務完成者的更正者為否）；數字更正仍須符合數字格式；結果、嚴重度與其他欄位不變；內容與現值相同回 422 更正無變動，不寫更正紀錄、不寫稽核、版本不變；舊版本號回 409 版本衝突；不屬該結果的欄位回 422 作答規則違反 | CMV-R11 |
| CMV-AC14 | `COMPLETED` Task，一張有註記的照片；另一張被（測試替身註冊的）已核發報告引用 | 更正照片註記；以更正上傳取代現場版（含未帶更正原因、不合法 JPEG、雜湊不符、`expected_sha256` 過期）；對被報告引用的照片取代現場版 | 註記更正成功並留紀錄；未帶更正原因回 422 作答規則違反；取代現場版成功時儲存仍只有該照片的兩個檔案（現場版被取代、內業版依 FEV-R03、R22 重新產生初始內業版）、雜湊已更新、紀錄只含雜湊與大小；不合法 JPEG 或雜湊不符回 `field-evidence` 的上傳錯誤且不留檔案、不改記錄；`expected_sha256` 過期回 409 版本衝突；被已核發報告引用的照片不得取代現場版（回 `field-evidence` 的照片鎖定錯誤），資料與檔案不變 | CMV-R11 |
| CMV-AC15 | `COMPLETED` Task | 嘗試：更正時帶 `outcome` 或 `severity`；對尚無結果的項次更正；新增或刪除照片；取消任務；檢查路由清單；在 `IN_PROGRESS` Task 使用更正端點 | 帶結果或嚴重度回 422 更正不允許，資料不變；新增或刪除照片依 `field-evidence` 回 409 鎖定；取消回 409（[STM-AC11](../state-machines/spec.md#驗收條件)）；路由清單中除專案查核項目修改選「要」（KD-55，由標準變更觸發而非人工重開）外，沒有任何可令 `COMPLETED` 離開完成狀態的端點；`IN_PROGRESS` 使用更正端點回 409 狀態鎖定 | CMV-R11、R12 |
| CMV-AC16 | `COMPLETED` Task；U1 具 `inspection_task.correct`、U2 只有 `inspection_task.read`、U3 非成員、內業 U4、Admin；`CANCELLED` Task 與封存 Plan | 各自更正與讀取更正紀錄 | U1、U4 可更正，U2、U3 回 403 權限不足；`inspection_result.read` 者可讀更正紀錄；`CANCELLED` 與封存 Plan 更正被拒（409）；Admin 放行 | CMV-R11、R16 |
| CMV-AC17 | `COMPLETED` Task 有三個不符合結果；內業具 `inspection_result.follow_up` | 對其一依序登記：`NOT_IMPROVED`（附說明）；`IMPROVED`（附說明與一張已上傳的改善照片）；再登記一筆 `NOT_IMPROVED` | 三次都成功並各留一筆歷史（只增不改不刪）；改善狀態依序為 `NOT_IMPROVED`、`IMPROVED`、`NOT_IMPROVED`（最新一筆決定）；原結果、嚴重度與任務完成狀態不變；`has_defects` 仍為 `true`；`improved_count` 隨最新狀態變動 | CMV-R13 |
| CMV-AC18 | 同上；另有符合結果、不適用結果、已作廢的不符合結果 | 嘗試：已改善但不附照片；說明空白；未知或他人任務的照片識別；對符合、不適用或作廢結果登記；檢查所有回應與資料表 | 前四者回 422 改善登記不合法，`error.details.fields` 指到 `note` 或 `photo_ids`；後者回 422 改善目標不合法；資料不變；任何 API 回應與資料表都沒有期限、逾期、通知或自動判定欄位；改善照片不計入任何項次的覆蓋數 | CMV-R13 |
| CMV-AC19 | 一個已完成任務有 3 個不符合、其中 1 個已改善；另一個 Plan 內有多個任務 | 讀取 Task、Task 清單、Plan 詳情與內業結果 | 各處的 `has_defects`、`defect_count`、`improved_count` 一致（真、3、1）；3 個都已改善後 `has_defects` 仍為真、`improved_count` 為 3，畫面顯示「已改善 3／3」；內業結果逐項次顯示 `OPEN`、`NOT_IMPROVED`、`IMPROVED`；作廢的不符合不計入；清單查詢數不隨任務數成長 | CMV-R14 |
| CMV-AC20 | `COMPLETED` Task；U1 只有 `inspection_task.inspect`、內業 U4 具 `inspection_result.follow_up`、Admin；`IN_PROGRESS`、`CANCELLED` Task 與封存 Plan | 各自登記複查與上傳改善照片 | U4 與 Admin 成功；U1 回 403 權限不足；`IN_PROGRESS`、`CANCELLED`、封存 Plan 回 409 | CMV-R13、R16 |
| CMV-AC21 | 專案查核項目 X 被已派出 Task 使用，X 的項次已有結果（含一個已有改善登記的不符合）與照片；項目 Y 也有結果；Task 為 `COMPLETED`、Plan 已完成 | 內業修改 X 並選「要」重新查核；之後現場補查 X；請求中途失敗的一次嘗試 | 同一交易內 X 的有效結果標示作廢（`STANDARD_CHANGED`）並保留（連同改善登記與改善照片，不刪除）；作廢結果不出現在作答表與 `has_defects` 計算，內業可由作廢清單查到；Y 的結果不變；Task 回到 `IN_PROGRESS`、Plan 退回進行中；X 重新作答前完成回 422 完成缺項；X 每個項次都有新的有效結果時待重查旗標由伺服器清除，Task 可再完成；中途失敗時結果作廢、照片作廢與項目修改一併回滾 | CMV-R15、R07 |
| CMV-AC22 | 專案查核項目 X 的任務：一個已有結果；另一個尚無結果與照片；一個已取消且取消期間標準被修改；點位與實測欄位的穩定身分已落地（IP-R13，實作在 `field-evidence` 計畫 T5） | 內業修改 X 並選「不要」；另一次選「要」；恢復已取消任務 | 選「不要」時結果與改善登記不變，仍對得上同一項次與實測欄位；選「要」時有結果的任務依 KD-55 作廢結果；尚無結果也無有效照片者直接使用新快照、不標待重查；已取消任務遇「要」時，取消期間結果與照片維持原樣，恢復的同一交易才作廢並標待重查；只有照片、尚無結果的項目也作廢並標待重查；`has_result` 含結果與有效照片；選「要」時被刪除的點位連同其結果作廢；選「不要」時 API 不接受增減項次與實測欄位集合 | CMV-R15、R05 |
| CMV-AC23 | 任一筆結果 | 以資料庫查詢追溯 | 可由結果找到查核項目明細與快照修訂、Task、Plan、Project；記錄填寫者與時間；同一任務同一項次在未作廢時只有一筆（重複寫入被約束擋下）；完成度檢查讀任務快照，修改範本或專案副本後驗證結果不變 | CMV-R05 |
| CMV-AC24 | 升級前已存在的資料：一個 `COMPLETED` Task（沒有結果）、一個 `IN_PROGRESS` Task（沒有結果） | 執行 migration 後讀取；現場與內業開啟該已完成任務的畫面；對進行中任務呼叫完成 | `COMPLETED` Task 與其 Plan 狀態不變、沒有補結果；內業結果與作答表回空結構，現場與內業畫面都顯示「此任務於逐項結果上線前完成」的說明而不是空表；進行中任務完成須補齊結果與照片，否則回 422 完成缺項 | CMV-R21、R18、R19 |
| CMV-AC25 | 後端全部路由；管理儀表板的完成數與完成率 | 檢查可改變 Task 狀態的端點；嘗試用通用更新把 Task 設為 `COMPLETED`；對照儀表板指標 | 只有 `:complete` 能使 Task 成為 `COMPLETED`，通用更新端點拒絕直接寫狀態；儀表板完成數與完成率的來源就是這個狀態，不另設第二個指標（切換由 `admin-dashboard` T8 驗收） | CMV-R20、R09 |
| CMV-AC26 | 完成後更正與登記改善 | 檢查稽核紀錄；讓其中一次的寫入中途失敗 | 各寫一筆 `inspection_task.corrected`、`inspection_result.follow_up_registered`，內容含 `project_id`、操作者、時間與前後值（或複查結果與說明）；與資料變更同一交易，失敗時一併回滾；事件已登記在 `audit-log` 目錄且欄位不含儲存鍵；更正無變動時不寫事件 | CMV-R17 |
| CMV-AC27 | 360px、390px 與 768px 的現場任務詳情與項次填寫畫面；任務有文字與數字實測欄位的項次 | 以觸控一次填一個項次：選符合並填實測值；選不符合並補嚴重度與註解；選不適用並填原因；故意漏填；儲存並到下一項；離開未儲存的項次；確認填寫入口與完成後的更正入口是分開的 | 觸控目標至少 44×44 CSS px、無水平捲動；結果初始都不選；嚴重度與註解只在選不符合後出現、原因只在選不適用後出現；必填有標示，錯誤顯示在欄位旁並聚焦第一個錯誤；數字欄位旁顯示單位與換算提示；伺服器未提供欄位位置的錯誤保留草稿並顯示一般錯誤；離開前有提示；全程可用鍵盤；畫面沒有資料庫 ID、儲存鍵、雜湊或 metadata；進度與各項次狀態與作答表一致；填寫與更正是不同入口 | CMV-R18、R01、R02、R03 |
| CMV-AC28 | 現場有缺項的 `IN_PROGRESS` 任務，另一個資料齊全且有不符合項次 | 按「完成查核」 | 頁內先說明後果（不能重開、只能更正註解、實測值、照片註記與現場版，並留下紀錄、有 n 項不符合會標示「有缺失」），n 取自伺服器預檢；缺項時伺服器 422 的 `problems` 列在畫面並可跳到第一個缺項，指到項次與欄位，輸入不遺失；勾選「代登」才出現必填的「實際檢查人」欄，缺填錯誤顯示在欄位旁；資料齊全時完成成功，畫面改為唯讀並顯示「有缺失」；不依前端自己的判斷放行 | CMV-R18、R09 |
| CMV-AC29 | 已完成任務的現場詳情，具 `inspection_task.correct` | 進入更正；改註解、實測值、照片註記、換現場版；嘗試改結果 | 畫面唯讀，只有「更正」入口，且更正前說明「會留下紀錄、不會重新查核」；可改的欄位限於 CMV-R11 範圍，結果與嚴重度不可改；更正成功後顯示最新內容；版本衝突時保留自己的輸入並顯示最新內容；不具權限者看不到更正入口 | CMV-R18、R11 |
| CMV-AC30 | 內業任務頁的結果頁籤，桌面與 360px | 依項目查看結果、篩選不符合與待改善、檢視作廢結果與更正紀錄、對不符合項次登記複查（含上傳改善照片）、確認登記複查與更正是分開的入口、未儲存離開 | 結果依項目分組並顯示改善狀態；篩選與作廢標示可用；登記複查時「已改善」未附照片的錯誤顯示在欄位旁；成功後改善狀態與清單計數更新；離開未儲存的登記有提示；沒有限期、通知或自動判定控制項；登記複查與更正是不同入口 | CMV-R19、R13、R14 |
| CMV-AC31 | 前端與真實後端 | 以真實 API 完成填寫、讀回、完成預檢、完成、更正與登記複查 | 前端送出的欄位被後端接受並能讀回；缺項與欄位錯誤的 `error.details` 被前端正確對應；契約測試不依賴 mock 的回應 | CMV-R18、R19 |
| CMV-AC32 | `IN_PROGRESS` Task，一個請求正在完成、另一個請求同時修改一個項次的結果 | 並行送出 | 兩者序列化：完成看到的是一致的資料；完成成功後，結果寫入回 409 狀態鎖定；不會有完成後才寫入的結果，也不會完成在驗證通過之後被改壞的資料之上 | CMV-R09 |
| CMV-AC33 | 一個有缺失的已完成任務 | 在任務清單、現場詳情、內業結果頁與 Plan 頁檢視 | 「有缺失」標示在各處文字與樣式一致（`statusBadge`），不與「已完成」混淆；改善狀態文字一致 | CMV-R10、R14、R18、R19 |
| CMV-AC34 | 專案查核項目 X 被 `IN_PROGRESS` Task 使用，現場正在填 X 的項次 | 內業的修改（選「要」）與現場的結果寫入並行送出；兩種先後順序各一次 | 兩者以固定鎖序（Plan、Task）序列化：先寫入者成功，後到者在修改之後才寫入時回 409 標準已變更且不寫入；修改在寫入之後時，該結果依 KD-55 作廢；不會有結果掛在已換發識別的舊項次上；SQLite 與 PostgreSQL 都驗證 | CMV-R04、R15 |
| CMV-AC35 | 升級前已完成、沒有逐項結果的 `COMPLETED` Task A；已有儀表板完成數 | 內業對 A 使用的專案查核項目選「要」重新查核；現場補查；對照儀表板 | A 回到 `IN_PROGRESS`，被修改項目標待重查；完成驗證要求整個任務所有項次都有結果與照片（不只被修改項目），缺項一次列出；全部補齊後可完成；升級前已完成的任務在儀表板照舊計入完成數，畫面說明「逐項結果上線前完成」 | CMV-R21、R07 |
| CMV-AC36 | 現場人員 U1 完成任務；內業 U4 事後更正；任務另有代登情境 | 完成：不代登；勾選代登但未填實際檢查人；未代登卻帶實際檢查人；勾選代登並填實際檢查人（含超長）；U1 與 U4 更正後修改 U1 的姓名與單位 | 檢查人員取 U1 的身分快照；代登缺填或未代登卻帶實際檢查人回 422 並指到欄位，資料不變；代登成功後 `proxy_entry`、`actual_inspector` 隨完成寫入，不寫進一般備註；結果、更正紀錄與改善登記都保存寫入者的身分快照，之後修改人員資料不影響已寫入的紀錄；完成端點不接受其他自報內容 | CMV-R22、R09、R11 |

## 規格設計清單

下列細節沒有直接的負責人裁定，是本規格依業界常見做法先定，之後可依試用迭代。

| 編號 | 設計 | 理由 |
|---|---|---|
| D1 | 資料值：結果 `PASS`、`FAIL`、`NA`，嚴重度 `MINOR`、`MODERATE`、`SEVERE`，改善 `IMPROVED`、`NOT_IMPROVED`；介面一律用中文（符合、不符合、不適用、輕微、一般、嚴重、已改善；`NOT_IMPROVED` 的畫面用語暫稱「尚未改善」，原型時確認） | 對應來源文件的 PASS／FAIL／N/A 措辭，介面維持負責人的用語 |
| D2 | 結果以項次穩定識別對應，同一任務同一項次最多一筆有效結果；作廢保留；另存作答時的快照修訂 | 穩定識別使 KD-55 選「不要」只更正文字時結果仍對得上；保留作廢列才能追查當時依據 |
| D3 | 每次儲存即驗證，不保存半成品；畫面上尚未存的草稿只留在前端，離開前提示 | 讓資料庫裡的結果永遠合法，完成驗證只需檢查有無、不必猜是不是半填；符合 MVP 不做離線與草稿持久化 |
| D4 | 上限：註解 1000、不適用原因 500、文字實測值 500、數字字串 32、改善說明 1000、更正原因 200 字元；數字只接受有限十進位；值以字串保存 | 避免浮點誤差並保留使用者輸入的位數；上限比現場實際需要寬，請求上限另依 SEC-004 登記 |
| D5 | 版本號 `revision` 作樂觀並行控制：建立省略、修改必帶，不符回 409 並附目前結果 | 多人可同時查同一任務（STM-R11），避免靜默覆蓋；畫面保留自己的草稿並顯示對方的內容 |
| D6 | 作答表與預檢端點、回應形狀；作答表不內嵌照片覆蓋（沿用 `field-evidence` 的覆蓋端點）；預檢回 `ready`、`problems`、`summary` | 現場的心智模型是「還缺什麼」（PR-10）；預檢讓畫面不必自己重算規則；`summary` 供完成前的確認說明 |
| D7 | 不適用項次的照片豁免在本規格的完成驗證裡套用，不改 `field-evidence` 的 `all_points_satisfied`（它不排除不適用項次） | KD-54 規定不適用時照片選填；覆蓋計算維持單一來源，豁免只是本規格對結果的取捨 |
| D8 | 完成失敗一次列出全部缺項，欄位格式 `{item_id, point_id, kind, field, reason, required, covered}`；沿用既有錯誤「完成缺項」（既有錯誤碼）；完成與預檢共用同一函式；完成端點與結果寫入都依固定鎖序（Plan、Task）取鎖，並與專案查核項目修改序列化 | 不讓現場一輪一輪補一個錯；沿用既有錯誤碼不破壞既有契約；鎖避免完成後才有人寫入，固定鎖序避免與 KD-55 修改互相死結 |
| D9 | `has_defects`、`defect_count`、`improved_count` 由有效結果與最新改善登記即時聚合，不另存；`has_defects` 在全部改善後仍為真（結果是歷史事實），改善進度另外顯示 | 避免旗標與結果不同步；KD-56 規定有不符合就標示，KD-65 規定另顯示改善狀態，見 [CMV-Q11](#cmv-q11) |
| D10 | 更正可改：結果的註解、不適用原因、文字與數字實測值，照片註記與現場版；不可改：結果、嚴重度、項次對應，也不可補拍或刪除照片；更正原因在更正數字實測值與取代現場版時必填、其餘選填；紀錄存 `task_corrections`（含更正者身分快照）並寫稽核事件 | KD-42 要求可更正文字與圖片、不重新查核；結果與嚴重度屬查核判斷，改它等於推翻查核，只能走 KD-55；數字與換照片是較大的改動，必須留下理由；更正者要在畫面上查得到，故另存而非只寫稽核；負責人裁定（CMV-Q1、CMV-Q2） |
| D11 | 現場版取代只更新那一張照片唯一的現場版檔案，內業版依 FEV-R03、R22 重新產生初始內業版（保留兩版模型），不新增版本；驗證與冪等沿用 `field-evidence` 上傳 | 符合 PR-05 只存兩版；內業編修參數相對於舊現場版，沿用會失效，重新產生最單純，內業可再編修 |
| D12 | 改善登記只增不改不刪，歷史保留；三種狀態（`OPEN`、`NOT_IMPROVED`、`IMPROVED`）由最新一筆推導；說明必填；已改善必附至少一張照片；只在任務已完成時登記 | 簡易版（KD-65）不需要流程狀態機；只增不改可追溯；錯誤登記以新的一筆更正 |
| D13 | 改善照片分兩步：先上傳到項次、再於登記時一併掛上；沿用 `Evidence` 兩版模型與儲存抽象，新增可空的 `result_id`、`follow_up_id`；不計入覆蓋數；未掛上的照片由唯讀檢查指令列出 | 重用已驗證的上傳管線與 PR-05 模型；登記與照片同交易掛上，才能保證「已改善必附照片」 |
| D14 | 新增 `inspection_result.read`、`inspection_result.follow_up`、`inspection_task.correct`；現場填寫與完成沿用 `inspection_task.inspect`。存取分類：**正式行為**（[#576](https://github.com/speko-tw/inspect-flow/issues/576) authentication 任務 P 合併後）依 [AUT-R08](../authentication/spec.md#需求) 的規則（現場碼只有 `inspection_task.inspect`；唯讀碼是專案範圍、動作為 `read` 的代碼；其餘為內業碼）：`inspection_result.read`（與 `field-evidence` 的 `evidence.read`）是唯讀碼，`inspection_result.follow_up` 是內業碼。**過渡期**（#576 合併前）分類表只把 `inspection_task.inspect` 與單獨的 `inspection_task.read` 排除在內業之外，其餘都算內業，因此 T1 先把兩個 `read` 加進分類表、比照 `inspection_task.read` 歸既非內業也非現場，否則只有唯讀角色的人會被判為有內業入口；#576 合併後改依唯讀碼規則，這個暫時例外可移除。`inspection_task.correct` 現場與內業角色都會持有，兩個階段的規則都會把它歸為內業碼而讓現場角色被判為有內業入口，因此列為分類例外（不算內業，也不算現場），並加進前端的現場端代碼清單；AUT-R08 的分類說明要同步補一行，列在計畫 T0 | 內業讀取、登記與更正是不同責任；現場填寫與開始、完成同屬現場查核（STM-R11）；分類測試要求每個新代碼都要有歸屬 |
| D15 | KD-55 選「要」時，同一交易作廢被修改項目的有效結果與其改善登記；項目補查完成（每個項次都有新的有效結果）時伺服器清除待重查旗標與更新 `item_status`。已取消任務恢復時才作廢、只有照片的項目也作廢並標待重查，依 `field-evidence` 的 FEV-R11（負責人裁定 FEV-Q6、FEV-Q15） | 與 `field-evidence` 的照片作廢同一交易才不會只作廢一半；旗標由結果推導，不靠人工清除；未裁定的部分不先採用 |
| D16 | `has_result` 把結果納入，由 `inspection-planning` 的現行實作只在項目 `item_status` 為已完成時才標待重查，改為依 `has_result`；同時納入有效照片（[CMV-Q6](#cmv-q6) 已裁定）。此為對 `inspection-planning` 契約的範圍變更，依負責人直接指示落地（IP-R04、IP-R15；[CMV-Q10](#cmv-q10)） | 結果與照片先後存在，只看其一會漏掉另一種舊紀錄；契約變更必須先裁定 |
| D17 | 升級前的已完成任務維持原狀、沒有逐項結果；畫面說明；不追溯補資料 | PR-04 與不可延後意圖第 8 項；沒有現場資料可以補 |
| D18 | 欄位錯誤統一格式 `error.details.fields[{field, reason}]`；前端依 `field` 對應欄位並聚焦，沒有 `field` 時顯示一般錯誤並保留草稿 | 滿足 PR-19 的「可定位錯誤顯示在欄位旁」與「不臆測位置」 |
| D19 | 兩個稽核事件代碼，皆填 `project_id`（ALG-R24）；結果每次儲存不寫稽核事件（建立與修改者、時間已在資料列上）；更正無變動時不寫事件 | 高頻寫入會淹沒稽核；只有更正與改善登記是事後的、需要追溯的操作；符合 ALG-R09 的無變動不寫 |
| D20 | 畫面配置、文案、顏色與互動細節 | 實作前依原型關卡由負責人核可後定案 |
| D21 | 更正請求本文與並行：結果更正帶 `expected_revision`，註記帶 `expected_caption`，現場版取代帶 `expected_sha256`；不符回「版本衝突」；內容相同回「更正無變動」；更正數字實測值與取代現場版時更正原因必填，其餘選填 | 與作答共用同一種並行策略，更正才不會悄悄覆蓋別人剛改的內容；無變動不寫紀錄符合 ALG-R09 |
| D22 | 欄位允許矩陣與空值規則（必填缺漏或空白歸 `required`，不屬於該結果的欄位歸 `not_allowed`，不適用的空實測值視為未填） | 讓每種結果的資料形狀只有一種合法寫法，完成驗證與畫面錯誤定位才不會各說各話 |
| D23 | 完成端點的選填欄位 `proxy_entry`（布林）與 `actual_inspector`（文字，100 字元內）：代登必填實際檢查人、未代登不得帶；先於完成缺項驗證，錯誤指到欄位；存在 `inspection_tasks` | KD-51 規定代登要勾選並以文字填實際檢查人；欄位名稱與上限為規格設計 |
| D24 | 「原檢查人」以任務完成者（提交者）為準，更正者與完成者不同即在更正紀錄標示；代登時填寫的實際檢查人文字不參與比對 | 實際檢查人不必是系統帳號，無法比對；重簽屬 #77 |

## 待釐清

本規格不自行拍板的問題。以下各題先列選項與建議，需要團隊裁定的，另開 `needs-decision` 議題；裁定前，未標明來源的細節都只是規格設計。

### 裁定紀錄

下列項目已由負責人於 2026-10-10 裁定（依[裁定紀錄留言](https://github.com/speko-tw/inspect-flow/issues/106#issuecomment-6094452837)；範圍變更依[負責人直接指示](https://github.com/speko-tw/inspect-flow/issues/106#issuecomment-6093842438)在同一 PR 落地）。裁定內容已寫入對應需求與驗收條件。

<a id="cmv-q1"></a>
<a id="cmv-q2"></a>
<a id="cmv-q3"></a>
<a id="cmv-q4"></a>
<a id="cmv-q5"></a>
<a id="cmv-q6"></a>
<a id="cmv-q7"></a>
<a id="cmv-q8"></a>
<a id="cmv-q9"></a>
<a id="cmv-q10"></a>
<a id="cmv-q11"></a>
<a id="cmv-q12"></a>
<a id="cmv-q13"></a>

| 編號 | 題目 | 裁定 | 落在 |
|---|---|---|---|
| CMV-Q1 | 完成後的更正範圍 | 可改註解、不適用原因、文字與數字實測值、照片註記、現場版；不可改結果與嚴重度。數字實測值與取代現場版必填更正原因；更正紀錄存更正者的身分快照；更正者不是原檢查人時要分得出來（重簽屬 #77） | CMV-R11、AC13、AC14、D10、D24 |
| CMV-Q2 | 完成後能否補拍 | 不能補拍、不能刪除 | CMV-R11、AC15 |
| CMV-Q3 | 登記「已改善」是否必附照片 | 至少一張照片，說明一律必填 | CMV-R13、AC18 |
| CMV-Q4 | 複查結果是否保留「尚未改善」 | 保留，以最新一筆決定狀態；狀態只寫列舉值 `NOT_IMPROVED`，畫面用語暫稱「尚未改善」，原型時確認 | CMV-R13、AC17 |
| CMV-Q5 | 上線前完成的任務遇「要」的補查範圍 | 整個任務所有項次都要補齊 | CMV-R21、AC35 |
| CMV-Q6 | `has_result` 與已取消任務的作廢時點 | `has_result` 納入有效照片與結果，只有照片也作廢並標待重查；已取消任務恢復時才作廢（KD-56） | CMV-R15、AC22；IP-R04、IP-R07 |
| CMV-Q7 | 點位與實測欄位的穩定身分 | 帶 `id` 保留身分：有 `id` 保留、無 `id` 新增、缺席刪除，實測欄位一併處理 | CMV-R05；IP-R13、IP-AC14 |
| CMV-Q8 | 不在目前快照的結果如何處理 | 選「不要」時 API 不接受增減項次與改實測欄位集合（422，提示改選「要」）；選「要」時被刪的點位隨項目一併作廢 | CMV-R05、AC22；IP-R13 |
| CMV-Q9 | 改善登記是否只限已完成任務 | 只限已完成的任務 | CMV-R13、AC20 |
| CMV-Q10 | `inspection-planning` 凍結契約的新增 | 依負責人直接指示在同一 PR 落地 | IP-R15 與本規格的變更紀錄 |
| CMV-Q11 | 全部改善後是否還標「有缺失」 | 仍標，另外顯示「已改善 n／n」 | CMV-R10、R14、AC19 |
| CMV-Q12 | 查核項目沒有任何項次 | 建立任務時擋下；已被使用的項目也不能 PATCH 成零項次 | CMV-R07；IP-R14、IP-AC15 |
| CMV-Q13 | 上線前完成的任務在儀表板是否照舊計入 | 照舊計入 | CMV-R21、AC35 |

### 其他待釐清

<a id="cmv-q17"></a>
- **CMV-Q17：** 改善狀態的畫面用語（`NOT_IMPROVED` 暫稱「尚未改善」）於原型關卡給負責人確認（CMV-Q4）。
<a id="cmv-q18"></a>
- **CMV-Q18：** 更正者不是原檢查人時的重簽屬 [#77](https://github.com/speko-tw/inspect-flow/issues/77)（0.8.x）；本規格只保證更正紀錄分得出更正者與原檢查人（D24）。
<a id="cmv-q19"></a>
- **CMV-Q19：** 身分快照的格式與寫入函式、任務開始者與完成者的快照、外部協作人員只處理指派給自己任務的範圍限制，屬 [#550](https://github.com/speko-tw/inspect-flow/issues/550)；本規格的結果、更正與改善登記沿用其格式，#550 未合併前先以同欄位結構實作。
<a id="cmv-q14"></a>
- **CMV-Q14：與 `field-evidence` 需要對齊的地方。** 本規格不改 `field-evidence` 的檔案；需要對齊的例外已由該規格承接：FEV-R03（完成後取代現場版依 CMV-R11）、FEV-R04 與照片資料規則（改善照片不對應項次、不是總覽）、FEV-R09（改善照片可在 `COMPLETED` 上傳，依 CMV-R13）。其餘共用點由兩份規格各自實作：（1）覆蓋計算需提供每個項次的達標資訊，不適用豁免由本規格套用；（2）`Evidence` 的種類放寬為「總覽、項次佐證、改善複查」三選一，並新增 `result_id`、`follow_up_id`，照片清單預設排除改善照片；（3）FEV-Q3 的完成後現場版與註記更正由本規格承接；（4）完成後更正的現場版取代與改善照片上傳共用 FEV 的上傳驗證函式與已核發報告引用檢查註冊點（被報告引用的照片先鎖定）；（5）`error.details` 物件慣例。`has_result`、已取消任務恢復時才作廢已依裁定在兩份規格一致（FEV-R11、IP-R04）。
<a id="cmv-q15"></a>
- **CMV-Q15：** [OQ-07](../../intents/05-open-questions.md#oq-07)（報告如何呈現三種結果、嚴重度與改善狀態）屬 0.8.x；本規格只保證資料可由結果與快照讀取。
<a id="cmv-q16"></a>
- **CMV-Q16：** `domain-model` 的 `Result` 草稿條目，與 `state-machines`（STM-R10、STM-AC08、完成與更正段落）、`inspection-planning`（`:complete` 的介面列、IP-R08、`has_result` 與項目影響列表）、`audit-log`（事件目錄）、`admin-dashboard` 計畫 T8、`api-conventions`（`error.details`）的同步，待 [#538](https://github.com/speko-tw/inspect-flow/issues/538) 與 `field-evidence` 的規格 PR 合併後處理，列在計畫 T0。

## 變更紀錄

- 建立規格草稿：逐項次結果、伺服器完成驗證、有缺失、完成後更正、簡易改善追蹤與作答畫面 — [#106](https://github.com/speko-tw/inspect-flow/issues/106)；範圍依 [#104 完成裁定](https://github.com/speko-tw/inspect-flow/issues/106#issuecomment-5977723626)與 [#388 範圍補充](https://github.com/speko-tw/inspect-flow/issues/106#issuecomment-5978079288)
- 依 PR #546 第 1 輪審查修訂：錯誤改以條列、補欄位允許矩陣與更正請求本文、未裁定內容改標待確認與範圍變更、新增穩定身分與並行鎖序的前置與驗收 — [#106](https://github.com/speko-tw/inspect-flow/issues/106)
- 依負責人裁定與直接指示定案待裁定項目（CMV-Q1～Q13）並對齊權限模型與 KD-51：更正範圍與必填原因（CMV-R11）、改善登記規則（CMV-R13）、全部改善後仍標有缺失並顯示「已改善 n／n」（CMV-R10、R14）、`has_result` 納入有效照片與已取消任務恢復時作廢（CMV-R15）、舊任務遇「要」整個任務補齊與儀表板照舊計入（CMV-R21、AC35）；新增 CMV-R22（身分快照與代登欄位）、CMV-AC35、AC36、D23、D24；CMV-R16 改為兩層權限，D14 依 AUT-R08 重寫存取分類；改善狀態只寫列舉值，`NOT_IMPROVED` 的畫面用語暫稱「尚未改善」（原型時確認）。同步修改 `inspection-planning`（IP-R04、IP-R07、IP-R13～R15）。範圍變更（負責人指示，#106）— [負責人直接指示](https://github.com/speko-tw/inspect-flow/issues/106#issuecomment-6093842438)
- 第 2 輪審查後修訂（規格澄清，行為與裁定不變）：裁定依據連結改指[裁定紀錄留言](https://github.com/speko-tw/inspect-flow/issues/106#issuecomment-6094452837)；改善狀態只寫列舉值，`NOT_IMPROVED` 的畫面用語暫稱「尚未改善」；CMV-AC08 改為防禦性檢查；D11、AC14 改為重新產生初始內業版；「只能更正錯字與照片」改為實際範圍；D14 寫明 #576 合併前的暫行分類；CMV-R16 寫明預建角色初始內容與讀取碼的外部可用規則；CMV-Q14 改指向 `field-evidence` 的例外句；刪除不存在的 KD-60 引用；狀態改為已凍結 — [#106](https://github.com/speko-tw/inspect-flow/issues/106)
