# 現場照片佐證（field-evidence）

**代碼**：`FEV`　**Phase**：P6　**狀態**：草稿
**前置規格**：`field-ui`、`inspection-planning`、`state-machines`、`template-system`、`authentication`、`audit-log`、`domain-model`、`api-conventions`
**引用意圖**：[PR-01](../../intents/02-principles.md#pr-01)、[PR-02](../../intents/02-principles.md#pr-02)、[PR-05](../../intents/02-principles.md#pr-05)、[PR-07](../../intents/02-principles.md#pr-07)、[PR-08](../../intents/02-principles.md#pr-08)、[PR-10](../../intents/02-principles.md#pr-10)、[PR-17](../../intents/02-principles.md#pr-17)、[PR-19](../../intents/02-principles.md#pr-19)、[KD-32](../../intents/03-decisions-and-stack.md#kd-32)、[KD-33](../../intents/03-decisions-and-stack.md#kd-33)、[KD-34](../../intents/03-decisions-and-stack.md#kd-34)、[KD-35](../../intents/03-decisions-and-stack.md#kd-35)、[KD-38](../../intents/03-decisions-and-stack.md#kd-38)、[KD-42](../../intents/03-decisions-and-stack.md#kd-42)、[KD-50](../../intents/03-decisions-and-stack.md#kd-50)、[KD-53](../../intents/03-decisions-and-stack.md#kd-53)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[KD-60](../../intents/03-decisions-and-stack.md#kd-60)、[KD-61](../../intents/03-decisions-and-stack.md#kd-61)、[KD-62](../../intents/03-decisions-and-stack.md#kd-62)、[KD-63](../../intents/03-decisions-and-stack.md#kd-63)、[KD-64](../../intents/03-decisions-and-stack.md#kd-64)、[KD-51](../../intents/03-decisions-and-stack.md#kd-51)、[KD-69](../../intents/03-decisions-and-stack.md#kd-69)、[G-02](../../intents/05-open-questions.md#g-02)、[G-03](../../intents/05-open-questions.md#g-03)、[G-05](../../intents/05-open-questions.md#g-05)、[OQ-12](../../intents/05-open-questions.md#oq-12)、[OQ-14](../../intents/05-open-questions.md#oq-14)、[OQ-17](../../intents/05-open-questions.md#oq-17)、[OQ-20](../../intents/05-open-questions.md#oq-20)
**被擋議題**：無。原六項待負責人裁定（[FEV-Q1](#fev-q1)、[FEV-Q6](#fev-q6)、[FEV-Q12](#fev-q12)～[FEV-Q15](#fev-q15)）已於 2026-10-10 裁定，見[裁定紀錄](#裁定紀錄)；仍未定的只有工程標示的欄位內容（[#588](https://github.com/speko-tw/inspect-flow/issues/588)）與已被核發報告引用的照片鎖定細節（0.8.x，隨 [G-06](../../intents/05-open-questions.md#g-06)、[G-07](../../intents/05-open-questions.md#g-07)），都不擋本規格。[G-03](../../intents/05-open-questions.md#g-03)、[G-05](../../intents/05-open-questions.md#g-05)、[OQ-14](../../intents/05-open-questions.md#oq-14)、[OQ-17](../../intents/05-open-questions.md#oq-17) 已由維護者依負責人授權決定（#388，負責人可推翻），見 [KD-61](../../intents/03-decisions-and-stack.md#kd-61)～[KD-63](../../intents/03-decisions-and-stack.md#kd-63)；[G-02](../../intents/05-open-questions.md#g-02)、[OQ-12](../../intents/05-open-questions.md#oq-12) 亦已裁定。[G-04](../../intents/05-open-questions.md#g-04) 的未定餘項（缺圖能否出報表、圖片選用細節）與 [OQ-19](../../intents/05-open-questions.md#oq-19)（報告是否標示「照片已調整」）屬 0.8.x `report-delivery`，只寫成依賴，不擋本規格；逐項比對見[開工門檻比對](#開工門檻比對)。

## 目的

讓現場查核人員用手機拍下佐證照片，做有限度的編修後確認並上傳「現場版」；系統由現場版產生「內業版」，內業人員之後可再編修內業版。每個查核項次都能看出照片是否足夠、每張照片都能追溯到所屬的任務、需求快照、計畫與專案，供 0.7.x 完成驗證與 0.8.x 正式報告使用（依據：架構基準 §13A、§30 Phase 6、§35；[PR-05](../../intents/02-principles.md#pr-05)、[PR-07](../../intents/02-principles.md#pr-07)、[KD-32](../../intents/03-decisions-and-stack.md#kd-32)）。

## 範圍

**包含**：

- 現場拍照、前端有限度編修（裁切、旋轉、亮度、縮放／平移預覽、重設）、前端壓縮，確認後上傳現場版。
- 後端驗證與保存現場版，同一請求產生初版內業版；內業人員再編修內業版，直接更新內業版本身。
- `Evidence`（MVP 只收照片，一筆就是一張照片）、現場版與內業版的檔案記錄、照片與查核項目／查核項次的對應、照片註記。
- 內業版的工程標示：產生內業版時，把工程標示寫進影像像素（FEV-R22）；標示欄位內容待 [#588](https://github.com/speko-tw/inspect-flow/issues/588)。
- 每個查核項次的照片覆蓋計算（供現場提示與 0.7.x 完成驗證共用），總覽照片選拍。
- 上傳契約：單檔大小上限、完整性雜湊、冪等鍵、前端自動重試與手動重送；Online-first。
- 照片刪除政策（軟刪除、稽核、完成後與報告引用的限制）、KD-55 標準變更作廢的照片處理。
- 照片讀取與圖片串流 API、儲存抽象層與設定。
- 現場拍照與編修畫面、內業照片檢視與編修畫面。
- 納入 v0.3.1 走查補充的兩項驗收：「已完成」標籤顏色一致、重查說明文字（見 FEV-R19、FEV-R20）。

**不包含**（注明移到哪份規格，或屬於哪一條非目標）：

- 查核結果、實測值填寫、任務完成操作與完成時伺服器強制檢查「每個項次至少一張非總覽照片」：移至 `completion-validation`（0.7.x）；本規格只提供覆蓋計算，供該規格沿用。
- 任務完成後的現場版與照片註記更正（[KD-42](../../intents/03-decisions-and-stack.md#kd-42)）與修正紀錄：移至 `completion-validation`（0.7.x），見 [FEV-Q3](#fev-q3)。
- 報告選圖、缺圖處理、出報表、「補充文件」區、報告是否標示「照片已調整」（[OQ-19](../../intents/05-open-questions.md#oq-19)）：移至 `report-delivery`（0.8.x）。
- 離線佇列、重新連線同步、背景上傳、快取型 Service Worker：MVP 不做（[KD-61](../../intents/03-decisions-and-stack.md#kd-61)、[KD-63](../../intents/03-decisions-and-stack.md#kd-63)、[FUI-R09](../field-ui/spec.md#需求)）。
- 對比調整、照片上畫標註、物件移除／新增、生成式修圖、內容替換：不做（[KD-64](../../intents/03-decisions-and-stack.md#kd-64)、[PR-05](../../intents/02-principles.md#pr-05)）。
- 非照片佐證（文字、數值、簽名、影片、文件原檔）：[KD-53](../../intents/03-decisions-and-stack.md#kd-53)。
- 工程標示的欄位內容：待 [#588](https://github.com/speko-tw/inspect-flow/issues/588) 決定。報表上照片（含標示）在一側、查核項目與填寫內容在另一側的版面：移至 `report-delivery`（0.8.x）。
- 範本端的照片需求定義：[`template-system`](../template-system/spec.md) TPL-R07；內業 Plan／Task 管理頁本身：`inspection-planning` 與 `admin-dashboard`。本規格只要求內業任務頁能進入照片頁。
- 人員模組權限、委派與專案角色管理畫面：依 [#538](https://github.com/speko-tw/inspect-flow/issues/538) 的權限模型（[KD-69](../../intents/03-decisions-and-stack.md#kd-69)）；本規格只登記自己用到的專案範圍動作代碼，並要求兩層都通過（FEV-R12）。
- 照片自動清除與保存期限：MVP 不做，保存期限隨專案（[KD-62](../../intents/03-decisions-and-stack.md#kd-62)）。資料庫與照片的配對備份、還原與容量規劃：移至 `pilot-deployment`（[PR-12](../../intents/02-principles.md#pr-12)）。

## 使用情境

- 現場查核人員開始查核後，在任務詳情看到每個查核項次「已有幾張／還缺幾張」，點項次拍照，編修並確認後上傳；網路不穩時畫面保留這張照片，自動重試三次，之後可手動重送。
- 同一張照片同時佐證兩個項次時，現場人員在確認時一次勾選；每個項次都有至少一張照片後，現場看得出已經齊全。
- 現場人員為查核項目選拍總覽照片，並可替任何一張照片加文字註記。
- 內業人員從任務頁進入照片頁，依查核項目看每張照片的現場版與內業版（內業版的底部或旁邊帶工程標示），必要時裁切、旋轉或調整內業版亮度，套用後直接更新內業版。
- 內業修改專案查核項目並選「要」重新查核後，被修改項目的舊照片標示「標準變更作廢」並保留，內業找得到，現場補拍新照片。
- 任務完成前，拍照者或內業可刪除不要的照片；完成後不可刪除。

## 需求

凡下列細節未由來源直接指定者，明確標為**規格設計（非負責人裁定）**，細節整理見[規格設計清單](#規格設計清單)；這些設計不改變已凍結的領域與狀態契約。[KD-61](../../intents/03-decisions-and-stack.md#kd-61)～[KD-64](../../intents/03-decisions-and-stack.md#kd-64) 是維護者依負責人授權決定，負責人可推翻。

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| FEV-R01 | 每筆 `Evidence` 照片**必須**最終只保存兩張圖片：現場版與內業版；**不得**保存原始拍攝檔案或編輯過程的中間圖片，也**不得**因每次內業編修新增版本。資料庫**不得**有存放圖片位元組的欄位；實際檔案經 `Storage` 抽象介面存取，儲存鍵由後端依 UUID 產生，不使用原始檔名，且**不得**出現在任何 API 回應。MVP 的 Evidence 只收照片，沒有 `TEXT` 類型。縮圖只在讀取時即時產生，**不得**落地保存。 | 必須／不得 | [PR-05](../../intents/02-principles.md#pr-05)、[PR-02](../../intents/02-principles.md#pr-02)、[KD-32](../../intents/03-decisions-and-stack.md#kd-32)、[KD-53](../../intents/03-decisions-and-stack.md#kd-53)；縮圖即時產生為規格設計 |
| FEV-R02 | 現場拍照後，前端**必須**提供有限度編修：裁切、旋轉、亮度、縮放／平移預覽與重設；使用者確認後由前端壓縮為 JPEG 現場版並直接上傳。應用程式**不得**上傳拍攝原圖，也**不得**把拍攝原圖或待上傳照片寫入瀏覽器的持久儲存（IndexedDB、localStorage、Cache API）；裝置相機與作業系統相簿本身的行為不在應用程式控制範圍。編修**不得**提供對比調整、畫面標註、物件移除或新增、生成式修圖或內容替換。現場人員確認即完成現場端流程，不需另一位人員核可。 | 必須／不得 | [PR-05](../../intents/02-principles.md#pr-05)、[KD-33](../../intents/03-decisions-and-stack.md#kd-33)、[KD-34](../../intents/03-decisions-and-stack.md#kd-34)、[KD-61](../../intents/03-decisions-and-stack.md#kd-61)、[KD-64](../../intents/03-decisions-and-stack.md#kd-64)、[OQ-12](../../intents/05-open-questions.md#oq-12)、[版本路線圖 0.6.x 範圍](../../intents/06-versioning-and-milestone-governance.md#vg-05)（裁切、旋轉、亮度、縮放／平移預覽）；編修操作細節、壓縮參數與擷取方式為規格設計 |
| FEV-R03 | 後端**必須**在保存現場版的同一請求內產生初版內業版，兩者同一個資料庫交易寫入，任一失敗則整筆不保存。內業版**必須**由現場版產生：先套用編修參數（預設等同重設），再把工程標示寫進影像像素（FEV-R22）；現場版**不得**加標示，也**不得**被改動。內業人員**得**再編修內業版：前端只做預覽，後端依「相對於現場版」的編修參數從現場版重新產生內業版（含工程標示）並直接更新內業版本身。已被核發報告引用的照片**不得**編修或重新產生內業版（見 FEV-R10）。 | 必須／得／不得 | [KD-61](../../intents/03-decisions-and-stack.md#kd-61)、[KD-33](../../intents/03-decisions-and-stack.md#kd-33)、[PR-05](../../intents/02-principles.md#pr-05)、[OQ-14](../../intents/05-open-questions.md#oq-14)、[負責人補充（FEV-Q1，2026-10-10）](https://github.com/speko-tw/inspect-flow/issues/105#issuecomment-6093900115)；同步產生、參數表示與重新產生方式為規格設計 |
| FEV-R04 | 每張非總覽照片**必須**對應同一查核項目下一個以上的查核項次（一張照片得覆蓋多個項次）；總覽照片屬於查核項目，不對應項次。項次的照片覆蓋數是對應到該項次、未刪除且未作廢的非總覽照片數；覆蓋數達到該項次需求快照的照片需求 `min_count`（至少 1）即達標。總覽照片**得**選拍、可有多張、**不計入**覆蓋數；照片張數**不設**上限。系統**必須**提供覆蓋計算（以目前的 Task Requirement Snapshot 為準），並讓 0.7.x 完成驗證沿用同一計算。項次以穩定識別（`source_point_id`）對應：專案查核項目 PATCH 的點位與實測欄位帶 `id` 以保留身分（有 `id` 的更新、沒有的新增、缺席的刪除），文字更正與重排後，照片仍指到同一個項次；選「要」時被刪除的點位隨項目一併作廢，選「不要」時 API 不接受增減項次（[IP-R13](../inspection-planning/spec.md#需求)，由 `completion-validation` 的 [PR #546](https://github.com/speko-tw/inspect-flow/pull/546) 負責修改；負責人裁定 [FEV-Q12](#fev-q12)）。 | 必須／得／不得 | [KD-38](../../intents/03-decisions-and-stack.md#kd-38)、[KD-50](../../intents/03-decisions-and-stack.md#kd-50)、[TPL-R07](../template-system/spec.md#需求)、[#105 留言](https://github.com/speko-tw/inspect-flow/issues/105#issuecomment-5977919739)、[負責人直接指示（2026-10-10）](https://github.com/speko-tw/inspect-flow/issues/105#issuecomment-6093842135)；限同一查核項目、`min_count` 達標語意為規格設計，見 [FEV-Q2](#fev-q2)、[FEV-Q4](#fev-q4) |
| FEV-R05 | 每張照片（總覽與佐證項次）**得**有文字註記；有填寫就保存，留白則不顯示。註記屬於 `Evidence` 本身，現場版與內業版共用同一份，內業編修內業版不影響註記。註記上限 500 字元。 | 得／必須 | [KD-50](../../intents/03-decisions-and-stack.md#kd-50)；「現場版與內業版之間如何沿用」依 KD-50 狀態段交由規格確認，採共用同一份為規格設計；字元上限為規格設計 |
| FEV-R06 | 上傳端點**必須**使用 `multipart/form-data`；單檔上限預設 30 MB（30 × 1024 × 1024 位元組），得由設定檔調整，超過時串流中即拒收、不保存任何檔案。後端**必須**驗證內容確為可解碼的 JPEG 並受解碼像素上限約束，**必須**以請求帶的 SHA-256 核對收到的內容，不符則拒收；**必須**自行計算並保存現場版與內業版的 SHA-256。任何失敗**不得**留下 `Evidence` 記錄或孤兒檔案。 | 必須／得／不得 | [KD-63](../../intents/03-decisions-and-stack.md#kd-63)、[OQ-17](../../intents/05-open-questions.md#oq-17)、[API-R04](../api-conventions/spec.md#需求)；JPEG 限制、像素上限、請求雜湊核對與錯誤碼為規格設計 |
| FEV-R07 | 每次上傳**必須**帶前端產生的 UUID 冪等鍵。同一任務內同一鍵再次送達且請求指紋相同，後端**必須**回傳原結果、不建立第二筆照片；請求指紋包含現場版的 SHA-256、`item_id`、`is_overview`、`point_ids` 集合、`caption`、`captured_at` 與 `field_edit`。同一鍵但指紋不同（包含只改了註記或項次），**必須**拒絕，不得靜默忽略新欄位；並行的相同請求只能產生一筆照片。重放先驗證登入與權限，再比對冪等鍵，才檢查 Plan 封存與任務狀態。 | 必須 | [KD-63](../../intents/03-decisions-and-stack.md#kd-63)、[OQ-17](../../intents/05-open-questions.md#oq-17)；指紋範圍、比對範圍、重放順序與錯誤碼為規格設計 |
| FEV-R08 | 前端上傳失敗時，照片**必須**留在畫面上；遇可重試的失敗（網路中斷、逾時、5xx、408、429）**必須**自動重試 3 次並採指數退避，之後顯示手動重送；重試與重送一律沿用同一個冪等鍵與同一份現場版。其他 4xx 不重試，依錯誤說明處理。MVP **不得**做離線佇列、不得把待上傳照片寫入持久儲存、不得註冊快取型 Service Worker。 | 必須／不得 | [KD-61](../../intents/03-decisions-and-stack.md#kd-61)、[KD-63](../../intents/03-decisions-and-stack.md#kd-63)、[FUI-R09](../field-ui/spec.md#需求)；退避時程與可重試分類為規格設計 |
| FEV-R09 | 照片寫入動作**必須**依任務狀態限制：上傳、修改註記與對應、刪除只在 `IN_PROGRESS` 且所屬 Plan 未封存時允許；內業版編修在 `IN_PROGRESS` 與 `COMPLETED` 允許；`DRAFT` 對現場不可見；`CANCELLED` 與封存 Plan 下一律唯讀；讀取不受狀態限制（`DRAFT` 除外）。後端**必須**覆核，不得只靠前端隱藏控制項。多個條件同時不成立時，依[檢查順序](#檢查順序)回應，每個情境只會有一個錯誤碼。 | 必須 | [STM-R01](../state-machines/spec.md#需求)、[STM-R13](../state-machines/spec.md#需求)、[STM-R16](../state-machines/spec.md#需求)、[FUI-R03](../field-ui/spec.md#需求)、[KD-33](../../intents/03-decisions-and-stack.md#kd-33)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)；各狀態的允許範圍與檢查順序為規格設計，見 [FEV-Q3](#fev-q3)、[FEV-Q5](#fev-q5) |
| FEV-R10 | 任務完成前，拍照者或具照片管理權限的內業**得**刪除未完成任務的照片；刪除為軟刪除並寫稽核事件，檔案與記錄保留。任務完成後、照片已標「標準變更作廢」，或照片已被核發報告引用時，**不得**刪除。被刪除的照片不計入覆蓋數與一般清單。MVP 不做自動清除，保存期限隨專案。「已被核發報告引用」由 `report-delivery` 提供的檢查註冊進來；該規格上線前視為未被引用。被報告引用的照片先一律鎖定（刪除、內業版編修與重新產生），0.8.x 隨 [G-06](../../intents/05-open-questions.md#g-06)、[G-07](../../intents/05-open-questions.md#g-07) 再定是否放寬（[FEV-Q13](#fev-q13)；與 `completion-validation` 的 CMV-R11 一致）。 | 得／必須／不得 | [KD-62](../../intents/03-decisions-and-stack.md#kd-62)、[G-05](../../intents/05-open-questions.md#g-05)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)；引用檢查的接合方式為規格設計 |
| FEV-R11 | 專案查核項目修改且選「要」重新查核時，作廢對象**必須**是被修改的項目（Task 項目明細層）：該項目的照片（含總覽）在同一交易內標示「標準變更作廢」並保留，並將該項目標記待重查；同一任務其他項目不受影響。「已有結果」是指項目有未作廢的結果**或**有效照片（未刪除、未作廢）：因此只有照片、尚無結果的項目選「要」時，照片同樣作廢並標待重查；已有結果時照片隨結果作廢（結果的作廢隨 0.7.x，與 [IP-R04](../inspection-planning/spec.md#需求) 一致）。Task 層的 `has_result` 只用於判斷是否標待重查與說明文字，不決定作廢範圍。作廢照片不計入覆蓋數、不得用於報告、不得刪除或再編修，現場清單不顯示，內業**必須**找得到。選「不要」時照片與其對應不變。已取消的 Task 在修改當下不作廢，維持原樣並唯讀；恢復的同一交易才作廢並標待重查（[IP-R07](../inspection-planning/spec.md#需求)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)）。以上對 IP-R04、IP-AC04、IP-AC09 的修改，依負責人直接指示在 `completion-validation` 的 PR（[#546](https://github.com/speko-tw/inspect-flow/pull/546)）落地。 | 必須 | [KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[KD-56](../../intents/03-decisions-and-stack.md#kd-56)、[KD-62](../../intents/03-decisions-and-stack.md#kd-62)、[STM-R04](../state-machines/spec.md#需求)、[STM-R05](../state-machines/spec.md#需求)、[IP-R04](../inspection-planning/spec.md#需求)、[負責人直接指示（2026-10-10）](https://github.com/speko-tw/inspect-flow/issues/105#issuecomment-6093842135)；裁定 [FEV-Q6](#fev-q6)、[FEV-Q15](#fev-q15)；同一交易與現場隱藏為規格設計 |
| FEV-R12 | 後端**必須**對每個照片端點覆核權限，預設拒絕，採兩層模型（[KD-69](../../intents/03-decisions-and-stack.md#kd-69)、[AUT-R19](../authentication/spec.md#權限檢查)）：（1）人員模組：具查核模組「可使用」`inspection.use`；（2）專案：是專案成員且專案角色含該動作碼。兩層都通過才放行，Admin 依既有規則放行。動作碼：上傳與現場讀取要求 `inspection_task.inspect`（現場查核含拍照）；修改註記與對應、刪除要求「拍照者且具 `inspection_task.inspect`」或 `evidence.manage`；內業讀取兩個版本要求 `evidence.read`；內業版編修要求 `evidence.manage`。本規格登記 `evidence.read`、`evidence.manage` 兩個專案範圍代碼（屬查核模組；依 [DOM-R35](../domain-model/spec.md#需求)，`evidence.read` 為讀取碼、`external_allowed = true`，`evidence.manage` 為管理類、`external_allowed = false`）；人員模組權限的授予與委派不在本規格重複定義，見 [07-permission-model](../../intents/07-permission-model.md)。 | 必須 | [PR-01](../../intents/02-principles.md#pr-01)、[OQ-08](../../intents/05-open-questions.md#oq-08)、[KD-60](../../intents/03-decisions-and-stack.md#kd-60)、[KD-62](../../intents/03-decisions-and-stack.md#kd-62)、[KD-69](../../intents/03-decisions-and-stack.md#kd-69)、[DOM-R35](../domain-model/spec.md#需求)；`evidence.read`、`evidence.manage` 代碼為規格設計 |
| FEV-R13 | 每張照片**必須**能追溯：內業版 → 現場版 → `Evidence` → Task 項目明細與 Snapshot 修訂 → Task → Plan → Project，並記錄拍照者（上傳者的身分快照：姓名、單位、是否外部協作人員，寫入當下保存，日後人員資料變更不影響）、上傳時間（伺服器時間）、拍攝時間（手機提供、用戶端回報，得為空，**不一定可信**，見 [FEV-Q16](#fev-q16)）。照片只經需要登入的 API 串流，**不得**提供公開網址；現場使用者只能讀現場版，內業版需要 `evidence.read`。已刪除與已作廢的照片：具 `evidence.read` 者可讀單張詳情與圖片（含標示），現場端點一律回 404。現場端點回傳 `item_id`、`point_ids` 是對 [FUI-R08](../field-ui/spec.md#需求) 與 inspection-planning Field 詳情「不回傳其他關聯 ID」的延伸，僅限本規格的照片端點，畫面不顯示，須在計畫 T0 於 `field-ui` 宣告。 | 必須／不得 | [PR-07](../../intents/02-principles.md#pr-07)、[PR-02](../../intents/02-principles.md#pr-02)、[PR-08](../../intents/02-principles.md#pr-08)、[KD-51](../../intents/03-decisions-and-stack.md#kd-51)、[07-permission-model](../../intents/07-permission-model.md) 第 6 點（紀錄身分快照，格式與寫入函式依 [#550](https://github.com/speko-tw/inspect-flow/issues/550)）；API 形式為規格設計 |
| FEV-R14 | 照片刪除、註記與對應修改、內業版編修**必須**各寫稽核事件，與資料變更同一交易寫入，事件代碼與欄位登記到 `audit-log` 事件目錄。`evidence.photo_deleted`、`evidence.office_version_edited` 標為「每次都寫」（ALG-R16；同參數重送仍是一次操作）；`evidence.photo_updated` 只記有變動的欄位，無變動不寫（ALG-R09）。三者都**必須**填 `AuditLog.project_id`（ALG-R24）。 | 必須 | [KD-62](../../intents/03-decisions-and-stack.md#kd-62)、[PR-08](../../intents/02-principles.md#pr-08)、[ALG-R07](../audit-log/spec.md)、ALG-R09、ALG-R16、ALG-R24（同在 [audit-log](../audit-log/spec.md)）；事件代碼、欄位與標註為規格設計 |
| FEV-R15 | 現場拍照與編修畫面**必須**可在 360px、390px、768px 寬度以觸控完成，主要觸控目標至少 44×44 CSS px，內容不需水平捲動；**不得**顯示資料庫 ID、儲存鍵、雜湊、metadata 等技術資訊；並遵守 PR-19：新增與修改分開入口、對應項次這類有依賴的輸入先列出可選項再讓使用者選、必填標示且錯誤顯示在欄位旁並聚焦、刪除與放棄上傳等破壞性操作先說明對象與後果再於頁內確認、離開有未儲存編修或待上傳照片的畫面前提示、全部功能有鍵盤操作路徑。 | 必須／不得 | [PR-10](../../intents/02-principles.md#pr-10)、[PR-19](../../intents/02-principles.md#pr-19)、[FUI-R08](../field-ui/spec.md#需求)；畫面細節為規格設計，實作前須經原型關卡 |
| FEV-R16 | 內業照片頁**必須**依查核項目呈現照片（總覽在前），顯示現場版與內業版、註記、拍照者、時間與「標準變更作廢」「已刪除」標示，可依作廢與刪除狀態篩選；具 `evidence.manage` 者可編修內業版（旋轉、裁切、亮度、重設）並於頁內確認後套用，套用前說明「直接更新內業版、現場版不變、不保留舊內業版」；不得提供對比調整或標註。畫面同樣遵守 FEV-R15 的 PR-19 要求與 360px、觸控、鍵盤。 | 必須／不得 | [KD-33](../../intents/03-decisions-and-stack.md#kd-33)、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[KD-64](../../intents/03-decisions-and-stack.md#kd-64)、[PR-19](../../intents/02-principles.md#pr-19)；畫面細節為規格設計，實作前須經原型關卡 |
| FEV-R17 | 照片檔案**必須**經 `Storage` 抽象介面（`save`／`open`／`delete`）存取，第一版實作為本機持久化目錄；儲存位置、單檔大小上限、解碼像素上限由設定檔提供並記入 `.env.example`；服務層不得直接拼接檔案路徑。內業編修寫入新儲存鍵後才更新記錄並刪除舊檔，失敗時舊內業版保持不變。 | 必須／不得 | [PR-02](../../intents/02-principles.md#pr-02)、[PR-03](../../intents/02-principles.md#pr-03)、[KD-63](../../intents/03-decisions-and-stack.md#kd-63)、[照片儲存卡片](../../intents/03-decisions-and-stack.md#stack-photo-storage)；設定名稱與新舊檔切換順序為規格設計 |
| FEV-R18 | 系統**應**記錄編修參數供日後稽核：內業版保存後端實際套用的參數；現場版保存前端回報的編修摘要（旋轉、裁切、亮度，得為空，僅供稽核、後端無法驗證）；內業版另保存實際套用的工程標示規則摘要（欄位與規則版本，無標示時為空）。本規格只記錄，不決定報告是否標示「照片已調整」。 | 應 | [OQ-19](../../intents/05-open-questions.md#oq-19) 目前暫定（內部至少記錄 operations、`created_by`、`created_at`、hash）；欄位為規格設計 |
| FEV-R19 | 任務「已完成」狀態標籤**必須**在現場任務詳情、現場任務清單的「近期已完成」區與內業計畫頁一致使用綠色成功樣式（`badge-success`）。「近期已完成」區（預設 14 天、可展開）的清單契約由 [FUI-R05](../field-ui/spec.md#需求) 定義（負責人裁定 [FEV-Q14](#fev-q14)，由本規格的 PR 同步修改 `field-ui`）。 | 必須 | v0.3.1 走查補充（[#105 留言](https://github.com/speko-tw/inspect-flow/issues/105#issuecomment-6074723784)）、[負責人直接指示（2026-10-10）](https://github.com/speko-tw/inspect-flow/issues/105#issuecomment-6093842135)；v0.3.1 現場還不能填結果，測不到已完成狀態，故列入本規格驗收 |
| FEV-R20 | 內業在專案查核項目選「要」重新查核時，若受影響任務已有結果或有效照片，說明文字**必須**以白話寫出舊結果與照片如何保留（保留可查、標示「標準變更作廢」、需補查）；尚無結果與照片時維持「任務尚未填寫結果，直接改用新標準」。「已有結果」把有效照片納入（[FEV-Q6](#fev-q6)，已裁定）。 | 必須 | v0.3.1 走查補充（[#105 留言](https://github.com/speko-tw/inspect-flow/issues/105#issuecomment-6074723784)）、[KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[IP-R04](../inspection-planning/spec.md#需求)、[負責人直接指示（2026-10-10）](https://github.com/speko-tw/inspect-flow/issues/105#issuecomment-6093842135) |
| FEV-R21 | 上傳與 KD-55 作廢並行時不得留下有效照片指到舊需求：上傳交易**必須**鎖定 Task 項目明細，並重新驗證 `item_id` 的目前快照修訂與 `point_ids`；作廢交易**必須**鎖定同一筆明細。需求已在上傳過程中改變時，上傳回 409 `evidence.requirement_changed`，不留記錄與檔案，現場重新整理後再拍。 | 必須 | [KD-55](../../intents/03-decisions-and-stack.md#kd-55)、[PR-04](../../intents/02-principles.md#pr-04)；鎖定與重驗方式為規格設計 |
| FEV-R22 | 內業版**必須**包含工程標示：產生或重新產生內業版時，後端在後處理把標示寫進影像像素，位置在照片底部或旁邊（像工程照片上的標示牌，不是報表上另外排版的文字）；現場版**不得**加標示。標示的欄位內容待 [#588](https://github.com/speko-tw/inspect-flow/issues/588) 決定（負責人舉例：工程項目、日期、拍攝者）；定案前預設不加標示，內業版與未編修的現場版相同。啟用後，標示由設定檔裡**唯一一份**標示規則決定，內業版一律依規則產生。規則改變時，系統**必須**能從現場版重新產生內業版（內業編修參數沿用），已被核發報告引用的照片除外；觸發方式為維運指令。標示中的「拍攝者」取上傳者的身分快照；「拍攝時間」由手機提供、不一定可信，是否採用與來源待 #588。伺服器端**必須**用隨後端打包的中文字型繪製標示，不得依賴主機剛好安裝的字型。標示**不得**取代資料關聯：專案、地點、項次、查核結果與填寫內容仍以資料關聯保存；報表（0.8.x）上照片（含標示）在一側、查核項目與內容在另一側。 | 必須／不得 | 負責人裁定（[#105 FEV-Q1，2026-10-10](https://github.com/speko-tw/inspect-flow/issues/105#issuecomment-6093900115)）；標示疊在照片上或延伸畫布另加標示區屬規格設計，原型時給負責人看；預設不加標示、規則存放、重新產生的觸發方式與字型為規格設計 |

## 資料

`Evidence` 的欄位與關聯由本規格定義；`domain-model` 裡的 `Evidence`、`Evidence Variant` 草稿條目待後續同步（見[待釐清](#待釐清)）。共通 UUID 主鍵與建立／修改紀錄沿用 `database-foundation`。以下欄位表示、約束與索引為**規格設計（非負責人裁定）**，精確型別由 T1 設計並以 migration 驗收，型別只用 SQLAlchemy 內建型別。

| 實體 | 重點欄位與規則 |
|---|---|
| `Evidence`（資料表 `evidence`） | `project_id`、`task_id`、`task_inspection_item_id`（所屬查核項目，總覽與佐證照片都有）、`is_overview`、`caption`（可空，500 字元內）、`snapshot_revision`（拍攝時的需求快照修訂）、`upload_key`（冪等鍵 UUID，與 `task_id` 組成唯一約束）、`captured_at`（用戶端回報，可空）、上傳者與上傳時間（沿用建立者與建立時間）、上傳者身分快照（姓名、單位、是否外部協作人員，寫入當下保存；格式與寫入函式依 [#550](https://github.com/speko-tw/inspect-flow/issues/550)）、`deleted_at`／`deleted_by`、`voided_at`／`void_reason`（目前只有 `STANDARD_CHANGED`）。沒有任何存放圖片位元組的欄位。 |
| `Evidence Variant`（資料表 `evidence_variants`） | 每張照片剛好兩列，`variant_type` 為 `FIELD` 或 `OFFICE`，`(evidence_id, variant_type)` 唯一。欄位：`storage_key`（後端依 UUID 產生）、`content_type`（`image/jpeg`）、`byte_size`、`sha256`、`width`、`height`、`edit_params`（可空；`FIELD` 為前端回報的編修摘要，`OFFICE` 為後端實際套用、相對於現場版的參數）、`OFFICE` 另記最近一次編修者與時間，以及實際套用的工程標示規則摘要（可空；無標示時為空）。 |
| 照片與項次對應（資料表 `evidence_point_links`） | `evidence_id` 與項次穩定識別 `source_point_id`；非總覽照片至少一列，總覽照片沒有列。對應的項次必須屬於 `task_inspection_item_id` 的目前快照。專案查核項目 PATCH 的點位與實測欄位帶 `id` 以保留身分（[IP-R13](../inspection-planning/spec.md#需求)），文字更正與重排後對應不變；選「要」時被刪除的點位隨項目一併作廢。現行實作的 PATCH 會刪除全部舊點位再以新 UUID 重建（`PointBody` 沒有 `id`），須先依 IP-R13 改為保留 `id`，見計畫 T5。 |

規則：

- 「總覽」與「至少一個項次」二擇一由 Service 層覆核並以測試驗證。
- 覆蓋數只計 `deleted_at` 與 `voided_at` 皆為空的非總覽照片；達標以目前快照中該項次的照片需求 `min_count` 為準。
- 排序：同一查核項目內總覽照片在前，其餘依上傳時間、UUID；清單採 cursor 分頁（[API-R08](../api-conventions/spec.md#需求)）。
- `Storage` 介面與本機實作放在後端獨立模組；儲存鍵以 UUID 組成，不含原始檔名、專案名或使用者輸入。檔案保存位置與資料庫須能配對備份，備份與還原屬 `pilot-deployment`。
- 上傳不保存原始檔名；前端產生的現場版沒有原檔名，EXIF 不保存（見[規格設計清單](#規格設計清單)）。

### 開工門檻比對

依[部分凍結](../README.md#partial-freeze)規則逐項比對[開工門檻](../../intents/05-open-questions.md#gate)內與本規格有關的議題。本規格自己定義 `Evidence`、`Evidence Variant` 與照片對應，不依賴尚未裁定的欄位。

| 議題 | 與本規格的關係 | 結論 |
|---|---|---|
| G-02 | 原圖建模方式；已裁定不存原圖 | 已裁定，依 [KD-32](../../intents/03-decisions-and-stack.md#kd-32)，資料模型只有兩版 |
| G-03、OQ-14 | 現場編輯時序、前後端產圖分工、失敗重試 | 已決定，依 [KD-61](../../intents/03-decisions-and-stack.md#kd-61)；同步產生內業版與錯誤碼為規格設計 |
| G-04 | 核可與報表選圖 | 不設核可已裁定（[KD-34](../../intents/03-decisions-and-stack.md#kd-34)）；缺圖能否出報表、圖片選用細節屬 `report-delivery`，不影響 `Evidence` 欄位 |
| G-05 | 刪除與保留 | 已決定，依 [KD-62](../../intents/03-decisions-and-stack.md#kd-62) |
| OQ-12 | 對比與標註 | 已決定不做，依 [KD-64](../../intents/03-decisions-and-stack.md#kd-64) |
| OQ-17 | 大小、重試、冪等 | 已決定，依 [KD-63](../../intents/03-decisions-and-stack.md#kd-63) |
| OQ-19 | 報告是否標示「照片已調整」 | 未裁定，屬 0.8.x；本規格只記錄編修參數（FEV-R18），不因此阻擋 |
| OQ-20 | 佐證類型 | 已裁定 MVP 只收照片（[KD-53](../../intents/03-decisions-and-stack.md#kd-53)） |
| G-06、G-07 | Report 狀態與快照 | 與 `Evidence` 欄位無關；只影響報告如何引用照片，屬 `report-delivery` |

## 介面

路徑、欄位與錯誤碼為**規格設計（非負責人裁定）**，遵守 [api-conventions](../api-conventions/spec.md)：`/api/v1` 前綴、UUID、檔案上傳用 multipart、其餘用 JSON、cursor 分頁、時間為 UTC ISO 8601、共用錯誤格式。

| 方法 | 路徑 | 用途 | 權限 |
|---|---|---|---|
| POST | `/api/v1/inspection-tasks/{task_id}/photos` | 上傳現場版並同時產生初版內業版；新建回 201，冪等重放回 200 | `inspection_task.inspect`；Task `IN_PROGRESS` |
| GET | `/api/v1/field/inspection-tasks/{task_id}/evidence` | 現場覆蓋狀態：每個查核項目的總覽張數、每個項次的 `min_count`、覆蓋數、是否達標，以及 `all_points_satisfied` | `inspection_task.inspect`；`DRAFT`、不存在或無權限回 404 |
| GET | `/api/v1/field/inspection-tasks/{task_id}/photos` | 現場照片清單（只含有效照片，不含作廢與已刪除）；cursor 分頁，`limit` 預設 50、上限 100；可選 `item_id` | 同上 |
| GET | `/api/v1/inspection-tasks/{task_id}/photos` | 內業照片清單，含作廢與已刪除；可選 `item_id`、`voided`、`deleted` 篩選；cursor 分頁 | `evidence.read` |
| GET | `/api/v1/inspection-tasks/{task_id}/photos/{photo_id}` | 內業單張詳情，含兩版的尺寸、大小、雜湊、編修參數與作廢資訊 | `evidence.read` |
| GET | `/api/v1/inspection-tasks/{task_id}/photos/{photo_id}/image` | 串流圖片；`variant=field\|office`（預設 `field`），可選 `max_edge`（長邊像素，範圍 64～4096，超出回 422（欄位驗證錯誤），大於原圖長邊時不放大；即時縮放、不落地） | `variant=field` 要 `inspection_task.inspect` 或 `evidence.read`；`variant=office` 要 `evidence.read` |
| PATCH | `/api/v1/inspection-tasks/{task_id}/photos/{photo_id}` | 修改註記與對應項次；總覽屬性與所屬項目不可改，要改就刪除重拍 | 拍照者且具 `inspection_task.inspect`，或 `evidence.manage`；Task `IN_PROGRESS` |
| DELETE | `/api/v1/inspection-tasks/{task_id}/photos/{photo_id}` | 軟刪除 | 同上；Task `IN_PROGRESS`、未作廢、未被核發報告引用 |
| PUT | `/api/v1/inspection-tasks/{task_id}/photos/{photo_id}/office-version` | 內業編修：以相對於現場版的參數重新產生並更新內業版；預設參數等同重設 | `evidence.manage`；Task `IN_PROGRESS` 或 `COMPLETED`、未作廢、未刪除 |

**上傳請求**：標頭 `Idempotency-Key`（UUID，必填）。表單欄位：`file`（JPEG 現場版，必填）、`sha256`（`file` 的十六進位 SHA-256，必填）、`item_id`（Task 項目明細識別，必填）、`is_overview`（布林，預設 `false`）、`point_ids`（項次識別，可重複；非總覽至少一個，總覽不得帶）、`caption`（選填）、`captured_at`（選填，UTC ISO 8601，格式錯誤或晚於伺服器時間超過 5 分鐘回 422 `request.validation_failed`）、`field_edit`（選填，JSON 字串，前端回報的編修摘要）。現場使用者取得 `item_id`、`point_ids` 的來源是覆蓋狀態端點；畫面不顯示這些識別。

**回應**：現場視圖含 `id`、`item_id`、`is_overview`、`point_ids`、`caption`、`captured_at`、`uploaded_at`、`uploaded_by: {name_zh, is_me}`、圖片寬高與大小；內業視圖另含兩版的雜湊與編修參數、`voided_at`、`void_reason`、`deleted_at`。任何視圖都不含儲存鍵。`PATCH` 本文為 `{"caption": string|null, "point_ids": UUID[]}`，省略的欄位不變；總覽照片帶非空 `point_ids` 回 422 `evidence.invalid_target`。`PATCH` 與 `PUT .../office-version` 的回應是更新後的照片，視圖依呼叫者權限：具 `evidence.read` 者回內業視圖，否則回現場視圖。清單排序：先依 Task 項目明細的建立順序（`created_at`、`id`），同一項目內總覽在前，其餘依上傳時間、UUID；cursor 包含這組排序鍵。

**內業編修請求**：`{"rotation": 0|90|180|270, "crop": {"x","y","width","height"}|null, "brightness": -50..50}`。`rotation` 為順時針；`crop` 為相對於旋轉後現場版的 0～1 小數；`brightness` 為亮度百分比，亮度係數為 `1 + brightness/100`，與前端預覽採同一公式。處理順序固定為旋轉、裁切、亮度，最後寫入工程標示（FEV-R22）；標示不會被裁切。裁切後任一邊不得小於 64 像素，超出範圍回 422。內業版的照片本體長邊不超過現場版長邊、不放大；工程標示若採延伸畫布，標示區另計。

**錯誤**（遵守 [API-R07](../api-conventions/spec.md#需求)；以條列呈現，不另設錯誤碼對照表，錯誤碼的唯一清單是程式內的 `ErrorCode`）：

- 413 `evidence.file_too_large`：超過單檔上限
- 422 `evidence.invalid_image`：不是可解碼的 JPEG、超過解碼像素上限，`error.details.reason` 區分
- 422 `evidence.sha256_mismatch`：請求雜湊與收到的內容不符（常見於傳輸中斷）
- 422 `evidence.invalid_target`：項目不屬於該 Task、項次不屬於該項目、非總覽未帶項次、總覽帶了項次
- 422 `evidence.invalid_edit`：編修參數超出範圍
- 422 `request.validation_failed`：缺少冪等鍵、冪等鍵不是 UUID、註記超過 500 字元等一般欄位錯誤
- 409 `evidence.idempotency_conflict`：同一冪等鍵但請求指紋不同（包含只改了註記或項次），或鍵已被其他使用者使用
- 409 `evidence.requirement_changed`：上傳過程中需求快照已變更（KD-55 重查），項次不再屬於目前快照
- 409 `evidence.photo_deleted`：以已被刪除照片的冪等鍵重放
- 409 `evidence.task_locked`：Task 狀態不允許此動作（見狀態矩陣）
- 409 `inspection_plan.archived`：所屬 Plan 已封存
- 409 `evidence.photo_locked`：照片本身不允許刪除或編修：已作廢、已被核發報告引用或已刪除，`error.details.reason` 為 `voided`、`referenced_by_report`、`deleted`；Task 已完成、已取消或封存 Plan 不用此碼（見檢查順序）
- 403 `permission.denied`：缺少所需專案權限或不是拍照者
- 404 `resource.not_found`：Task 或照片不存在、`DRAFT` 對現場隱藏、照片不屬於該 Task

<a id="檢查順序"></a>
**檢查順序**（規格設計）：同一請求有多個條件不成立時，後端依下列順序回應第一個不成立者，每個情境只有一個錯誤碼：

1. 未登入 401；缺少專案權限 403（`/field/` 端點與 `DRAFT` 依 [FUI-R06](../field-ui/spec.md#需求) 回 404）。
2. Task 或照片不存在、`DRAFT` 對現場隱藏 404。
3. 上傳的冪等重放（同鍵同指紋回原結果，不同指紋 409）。
4. Plan 已封存 409 `inspection_plan.archived`。
5. Task 狀態不允許 409 `evidence.task_locked`（含 `COMPLETED` 的現場寫入與刪除）。
6. 需求已變更 409 `evidence.requirement_changed`（只有上傳）。
7. 照片層級限制 409 `evidence.photo_locked`（已作廢、已被核發報告引用、已刪除）。
8. 欄位與內容驗證 413／422。

**狀態矩陣**（FEV-R09）：

| 動作 | `PENDING` | `IN_PROGRESS` | `COMPLETED` | `CANCELLED`／封存 Plan |
|---|---|---|---|---|
| 上傳、修改註記與對應、刪除 | 拒絕 | 允許 | 拒絕 | 拒絕 |
| 內業版編修 | 拒絕 | 允許 | 允許 | 拒絕 |
| 讀取 | 允許 | 允許 | 允許 | 允許 |

`DRAFT` Task 對現場隱藏、回 404；內業讀取依 `evidence.read`，`DRAFT` 不會有照片。

**權限代碼**（依 [DOM-R35](../domain-model/spec.md#需求) 由本規格登記，規格設計）：

| 權限代碼 | 範圍 | 用途 | 建議預設對象（OQ-08） |
|---|---|---|---|
| `inspection_task.inspect` | 專案 | 既有；本規格用於現場拍照、上傳、現場讀取 | 現場工程師 |
| `evidence.read` | 專案 | 內業讀取照片兩版、作廢與已刪除紀錄 | 內業、專案經理、檢視者 |
| `evidence.manage` | 專案 | 編修內業版、修改或刪除他人上傳的照片 | 內業 |

三個代碼都屬查核模組：專案內動作要先通過 `inspection.use`，再看專案角色（FEV-R12）。`evidence.read` 是讀取碼，`evidence.manage` 是內業碼（依 [AUT-R08](../authentication/spec.md#需求) 的存取分類，不需新增例外）。預建角色的內容細目為規格設計：新安裝時依上表「建議預設對象」；既有角色依 [DOM-R68](../domain-model/spec.md#需求) 不被覆寫，由 Admin 於角色編輯勾選。

**稽核事件**（登記到 `audit-log` 事件目錄，規格設計）：`evidence.photo_deleted`（照片、Task、項目、刪除者、時間）、`evidence.photo_updated`（註記與對應的前後值）、`evidence.office_version_edited`（編修前後參數、編修者、時間）。作廢不另寫新事件，沿用 `project_inspection_item.updated`。

**畫面**（重大新畫面，實作前須先過[原型關卡](../README.md#ui-prototype-gate)；以下為規格設計）：

- 現場：在 `/field/tasks/{task_id}` 詳情內，每個查核項次顯示「已有 n／需要 m 張」與「拍照」，查核項目另有「拍總覽照（選拍）」。拍照用裝置相機（網頁檔案選擇的相機擷取），進入全螢幕編修畫面：縮放與平移預覽、旋轉（每次 90°）、裁切框與常用比例、亮度、重設；「確認」後選擇這張照片佐證的項次（預選從哪個項次進入，只列同一查核項目的項次）、是否為總覽、註記；上傳狀態清單顯示上傳中、已上傳、失敗並提供重送與放棄。已上傳照片有獨立的「修改說明與項次」與「刪除」入口。
- 前端壓縮：長邊不超過 2560 px、JPEG 品質 0.85，常數集中、可於試用後調整。
- 工程標示的版面（疊在照片上，或延伸畫布另加標示區，暫定底部延伸、不蓋住照片內容）是規格設計，內容待 [#588](https://github.com/speko-tw/inspect-flow/issues/588)；原型時做出兩種版面給負責人看，核可後定案（FEV-R22）。
- 內業：任務頁的照片頁籤，依查核項目分組；每張可開啟詳情比較現場版與內業版（桌面並排、手機切換；內業版帶工程標示），編修面板含旋轉、裁切、亮度、重設與預覽。

## 驗收條件

以下 AC 的 API、權限與端對端驗收**必須**以真實後端驗證；mock 只可用於單元與元件呈現測試，不得單獨作為契約或端對端證據（[PR-19](../../intents/02-principles.md#pr-19)、[RG-M22](../../review-guidelines.md)）。UI 的 360px 驗收以 SQLite 真後端、Vite 與無頭瀏覽器從登入開始只靠點擊走查，並保存桌面與 360px 淺色模式截圖。

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| FEV-AC01 | `IN_PROGRESS` Task，現場使用者具 `inspection_task.inspect` | 上傳一張現場版 JPEG 並指定項次 | 回 201；資料庫只多一筆 `evidence` 與剛好兩筆 `evidence_variants`（`FIELD`、`OFFICE`）；儲存只多兩個檔案；回應不含儲存鍵，資料庫 schema 沒有存放圖片位元組的欄位（無 BLOB 欄位）；儲存鍵只存在於 `evidence_variants.storage_key`，由 UUID 組成、不含原始檔名；沒有第三筆原始檔或中間檔；標示規則未啟用時內業版與現場版內容相同 | FEV-R01、R03、R06、R17 |
| FEV-AC02 | 已上傳的照片 | 內業以 `evidence.manage` 編修內業版（旋轉、裁切、亮度）兩次，再以預設參數重設 | 每次都由現場版重新產生並更新同一筆內業版記錄；檔案數維持兩個；現場版雜湊不變；輸出尺寸符合旋轉與裁切推算（誤差 1 px 內；啟用標示時另加標示區尺寸）；重設後內業版與初版內業版雜湊相同；舊內業版檔案已移除；超出範圍的參數回 422 `evidence.invalid_edit`，內業版不變 | FEV-R03、R17 |
| FEV-AC03 | 現場編修畫面 | 使用縮放、平移、旋轉、裁切、亮度，再按重設，最後確認 | 預覽隨操作更新；重設回到剛拍的狀態；確認後上傳的現場版反映裁切、旋轉與亮度，長邊與品質符合壓縮常數；畫面沒有對比、標註、物件增刪或生成式修圖控制項；拍攝原圖不會被上傳，應用程式也沒有把它寫入 IndexedDB、localStorage 或 Cache API | FEV-R02、R08 |
| FEV-AC04 | 一個查核項目有項次 A（`min_count` 1）、B（`min_count` 2），另有總覽照可選 | 逐步上傳：只對 A 一張；一張同時對應 A、B；再對 B 一張；最後上傳多張總覽與超過需求的多張 | 覆蓋狀態依序正確（A 達標、B 還缺 1 張、B 達標）；一張照片覆蓋多個項次可行；總覽不計入覆蓋數；張數超過 `min_count` 與一百張以上都不被拒；`all_points_satisfied` 在全部項次達標時為 `true` | FEV-R04 |
| FEV-AC05 | 上傳時 `item_id` 或 `point_ids` 不合法 | 送出：非總覽未帶項次；總覽帶項次；項次屬於另一個項目；項目屬於另一個 Task | 皆回 422 `evidence.invalid_target`，不留下記錄或檔案 | FEV-R04、R06 |
| FEV-AC06 | 照片附註記，另一張留白 | 上傳後經現場、內業兩種視圖讀取，內業再編修內業版 | 兩個視圖讀到同一份註記；留白為空；編修內業版後註記不變；註記超過 500 字元回 422；註記以文字保存，不影響圖片 | FEV-R05 |
| FEV-AC07 | 上傳檔分別為 30 MB 以內、剛好超過上限、非 JPEG（PNG 或偽裝副檔名）、毀損 JPEG、超過像素上限；另將上限設定調整為較小值 | 各上傳一次 | 上限內成功；超過上限回 413 `evidence.file_too_large` 且不保存任何檔案；其餘回 422 `evidence.invalid_image`；調整設定後上限隨之改變；每次失敗都沒有 `Evidence` 記錄與孤兒檔 | FEV-R06、R17 |
| FEV-AC08 | 請求帶的 `sha256` 與檔案內容不符（模擬傳輸中斷） | 上傳 | 回 422 `evidence.sha256_mismatch`，不保存；內容相符時資料庫保存的現場版與內業版雜湊正確 | FEV-R06 |
| FEV-AC09 | 同一冪等鍵 | 依序：重複上傳同一份請求；用同一鍵上傳不同內容；用同一鍵但只改註記或項次；另一個使用者用同一鍵；同鍵的兩個並行請求；原照片刪除後再重放 | 重複上傳回 200 與原結果，只有一筆照片；不同內容與只改註記或項次（指紋不同）都回 409 `evidence.idempotency_conflict`，原照片不變；他人使用同鍵回 409；並行請求只產生一筆；已刪除者重放回 409 `evidence.photo_deleted`；重放時 Task 已不是 `IN_PROGRESS` 仍回原結果 | FEV-R07 |
| FEV-AC10 | 前端上傳時後端依序回應網路中斷（或 5xx）三次後恢復；另一情境為持續失敗 | 現場人員上傳 | 前端自動重試三次、間隔依指數退避；第四次成功時只有一筆照片；持續失敗時顯示手動重送且照片仍在畫面上；手動重送沿用同一冪等鍵與同一份內容，成功後仍只有一筆；4xx（413、422、403、409）不自動重試並顯示對應說明 | FEV-R07、R08 |
| FEV-AC11 | Online-first 的現場頁面 | 檢查前端建置產物與離線上傳情境 | 沒有註冊快取型 Service Worker、沒有離線佇列、待上傳照片沒有寫入 IndexedDB、localStorage 或 Cache API；離線時上傳失敗並顯示可理解的訊息，照片仍留在畫面 | FEV-R08 |
| FEV-AC12 | Task 分別為 `DRAFT`、`PENDING`、`IN_PROGRESS`、`COMPLETED`、`CANCELLED`，及 Plan 封存（含封存且 Task 已完成的組合） | 現場上傳、修改、刪除；內業編修內業版；讀取 | 依[檢查順序](#檢查順序)：`DRAFT` 對現場回 404；封存 Plan 回 409 與共用的封存錯誤碼（優先於 Task 狀態，見錯誤清單）；`PENDING`、`COMPLETED`、`CANCELLED` 的現場寫入（含 `COMPLETED` 的刪除）回 409 `evidence.task_locked`；內業版編修在 `IN_PROGRESS`、`COMPLETED` 成功，其餘拒絕；各狀態的讀取皆可；這些情境都不回 `evidence.photo_locked`；被拒絕時資料不變 | FEV-R09 |
| FEV-AC13 | 專案成員 U1 具 `inspection_task.inspect`、U2 只有 `inspection_task.read`、U3 為非成員、內業 U4 具 `evidence.read` 與 `evidence.manage`、檢視者 U5 只有 `evidence.read`、Admin、U7（專案角色含 `inspection_task.inspect`，但沒有查核模組「可使用」）| 各自呼叫上傳、現場讀取、內業讀取、內業版圖片、編修、刪除他人照片 | U1 可上傳與現場讀取，只能取得現場版圖片；U2、U3 在一般端點回 403 與共用的權限不足錯誤碼，在 `/field/` 端點與 `DRAFT` 情境依 [FUI-R06](../field-ui/spec.md#需求) 回 404；U4 可讀兩版、編修、刪除他人照片；U5 可讀兩版但不能編修或刪除；Admin 全部放行；U7 一律回 403（兩層都要通過）；任何回應都不含儲存鍵；圖片只能經登入後的 API 取得，沒有公開網址 | FEV-R12、R13 |
| FEV-AC14 | 照片由 U1 上傳；同專案另一位具 `inspection_task.inspect` 的 U6；`IN_PROGRESS` Task | U6 修改或刪除 U1 的照片；U1 修改註記與刪除；內業 U4 刪除 | U6 回 403；U1 成功修改註記與對應；U1 與 U4 的刪除成功且為軟刪除：資料庫與檔案保留、寫入 `evidence.photo_deleted` 稽核事件、不計入覆蓋數與現場清單、內業以 `deleted=true` 仍可查到 | FEV-R10、R12、R14 |
| FEV-AC15 | `IN_PROGRESS` Task 內的照片分別為：已標作廢、已被（測試替身註冊的）核發報告引用、已刪除 | 嘗試刪除與現場修改；對已作廢與已刪除者嘗試內業版編修 | 皆回 409 `evidence.photo_locked`，`error.details.reason` 依序為 `voided`、`referenced_by_report`、`deleted`；資料與檔案不變；「任務已完成」不屬此碼，回 `evidence.task_locked`（見 FEV-AC12）；引用檢查未註冊時視為未被引用 | FEV-R10、R11 |
| FEV-AC16 | 專案查核項目 X 被已派出 Task 使用，X 的項次已有照片、任務尚無結果，另一項目 Y 也有照片 | 內業修改 X 並選「要」重新查核 | 同一交易內 X 的全部照片（含總覽）標示 `STANDARD_CHANGED` 作廢並保留檔案；X 標待重查；不計入覆蓋數；現場清單看不到；內業可用 `voided=true` 找到並看到作廢標示、能檢視兩版但不能編修或刪除；Y 的照片不變；請求中途失敗時作廢與項目修改一併回滾；作廢對象是被修改的項目，不是整個 Task | FEV-R11 |
| FEV-AC17 | 專案查核項目 X 的已有照片；PATCH 的點位帶 `id` | 內業修改 X 的文字、調整項次順序並選「不要」重新查核；另送增減項次或實測欄位集合的請求 | 照片、對應與覆蓋數不變，原照片仍對應同一項次；增減項次或改實測欄位集合的請求回 422 並提示改選「要」，資料不變（[IP-R13](../inspection-planning/spec.md#需求)，後端以真實 PATCH 驗證）；選「要」時被刪除的點位連同項目一併作廢，其照片作廢 | FEV-R04、R11 |
| FEV-AC18 | 任務被取消後恢復 | 取消前後檢視照片 | 取消期間照片保留、內業可讀、一律唯讀；恢復至取消前狀態後現場又可寫入 | FEV-R09 |
| FEV-AC19 | 任一張內業版照片 | 以資料庫查詢追溯 | 可由內業版找到現場版，再到 `Evidence`、Task 項目明細與快照修訂、Task、Plan、Project；記錄有上傳者（含寫入當下的身分快照，之後修改人員資料不影響）、上傳時間、現場版與內業版雜湊；`FIELD` 的編修摘要與 `OFFICE` 的實際參數都已保存 | FEV-R13、R18 |
| FEV-AC20 | 照片清單超過一頁 | 以 `limit` 與 cursor 取完現場與內業清單 | 排序為總覽在前、其餘依上傳時間與 UUID；無重複遺漏；`limit` 預設 50、上限 100；cursor 不透明 | FEV-R04、R13 |
| FEV-AC21 | 照片刪除、註記與對應修改、內業版編修（含同參數重送、無變動的 `PATCH`） | 檢查稽核紀錄 | 刪除與內業版編修每次都寫一筆事件（ALG-R16，同參數重送也寫）；註記與對應修改只記有變動的欄位，無變動不寫（ALG-R09）；事件含操作者、時間與前後值，且填入 `AuditLog.project_id`（ALG-R24）；與資料變更同一交易，失敗時一併回滾；事件已登記在 `audit-log` 目錄 | FEV-R14 |
| FEV-AC22 | 手機寬度 360px、390px 與平板 768px 的現場任務詳情與編修畫面 | 以觸控完成「拍照 → 編修 → 確認 → 選項次與註記 → 上傳 → 重送失敗 → 修改說明 → 刪除」 | 主要觸控目標至少 44×44 CSS px、無水平捲動；畫面沒有資料庫 ID、儲存鍵、雜湊或 metadata；新增與修改入口分開；項次未選時錯誤顯示在欄位旁並聚焦；刪除與放棄上傳先說明對象與後果並於頁內確認，確認鈕為全前端一致的危險樣式；離開有未確認編修或待上傳照片的畫面前有提示；全程可用鍵盤完成 | FEV-R15 |
| FEV-AC23 | 內業任務頁的照片頁籤，桌面與 360px | 檢視作廢、已刪除與有效照片，編修內業版並套用，嘗試未儲存離開 | 照片依項目分組、總覽在前；作廢與已刪除有標示與篩選；現場版與內業版可比較；套用前說明後果並於頁內確認；成功後顯示新內業版；未套用的編修離開前有提示；錯誤顯示在欄位旁；沒有對比與標註控制項 | FEV-R16 |
| FEV-AC24 | 前端與真實後端 | 以真實 API 完成上傳、讀回、修改、刪除與內業編修 | 前端送出的欄位被後端接受並能讀回；契約測試不依賴 mock 的回應 | FEV-R06、R16 |
| FEV-AC25 | 任務由 `PENDING` 開始並完成（可用後端完成端點） | 在現場任務詳情、現場任務清單的「近期已完成」區與內業計畫頁檢視狀態標籤 | 「已完成」在三處都使用 `badge-success` 綠色成功樣式，文字與樣式一致；「近期已完成」區的列表與展開行為依 FUI-R05、FUI-AC01 驗收 | FEV-R19 |
| FEV-AC26 | 專案查核項目 X 被已派出 Task 使用；情境一：任務尚無照片與結果；情境二：任務只有照片；情境三：任務已有結果與照片 | 內業在修改頁選「要」重新查核 | 情境一說明為「任務尚未填寫結果，直接改用新標準」；情境二、三用白話說明舊結果與照片會保留可查、標示「標準變更作廢」並需補查，且 `has_result` 在有有效照片或結果時為真 | FEV-R20 |
| FEV-AC27 | 已取消的 Task 有照片，取消期間內業修改專案查核項目 X 並選「要」 | 修改當下檢視照片與 Task；之後恢復 Task | 修改當下取消中 Task 的照片維持原樣並唯讀、Task 維持取消；恢復的同一交易才作廢 X 的照片並標待重查，其他項目不變（對齊 IP-AC04(4)）；Task 在恢復前不離開取消狀態；恢復請求失敗時照片作廢一併回滾 | FEV-R09、R11 |
| FEV-AC28 | 同一項目：一個上傳請求與一個 KD-55 選「要」的修改並行；另有修訂已變更後才送達的上傳 | 兩者並行，並另送一個舊修訂的上傳 | 不論先後，只有兩種結果：上傳先完成則該照片隨後被作廢（FEV-R11）；修改先完成則上傳回 409 `evidence.requirement_changed` 且不留記錄與檔案；不會出現指向舊修訂卻仍有效的照片 | FEV-R21 |
| FEV-AC29 | 上傳帶不合法的 `captured_at`；圖片請求的 `max_edge` 不同值；已刪除與已作廢的照片；`PATCH` 只送部分欄位；內業編修 | 各呼叫一次並讀取清單 | `captured_at` 格式錯誤或晚於伺服器時間超過 5 分鐘回 422；`max_edge` 超出 64～4096 回 422、大於原圖長邊時不放大且不落地；已刪除與已作廢照片對具 `evidence.read` 者回 200 並含標示、對現場端點回 404；`PATCH` 省略的欄位不變；`PATCH` 與編修回應依呼叫者權限回內業或現場視圖；清單跨項目與項目內排序固定 | FEV-R04、R06、R13 |
| FEV-AC30 | 設定一份測試用的標示規則（含中文欄位內容）；`IN_PROGRESS` Task | 上傳照片；以旋轉與裁切編修內業版；讀取兩個版本；規則未啟用時另上傳一張 | 內業版影像的底部或旁邊有工程標示，且在影像像素內（下載圖片即可看到），中文字沒有缺字方塊；現場版沒有標示、雜湊與上傳內容一致；編修後標示仍在、沒有被裁切；標示的拍攝者是上傳者的身分快照；規則未啟用時內業版與現場版內容相同；儲存仍只有兩個檔案 | FEV-R03、R22 |
| FEV-AC31 | 已有多張照片（含一張被測試替身註冊為已被核發報告引用、一張已作廢）；標示規則已改變 | 執行維運指令重新產生內業版；重複執行 | 未被引用的照片由現場版依新規則重新產生內業版，編修參數沿用，現場版與檔案數不變；被引用的照片跳過且資料與檔案不變；每張重新產生的照片寫稽核事件；重複執行結果相同；舊內業版檔案已移除 | FEV-R03、R10、R22 |

## 規格設計清單

下列細節沒有直接的負責人裁定，是本規格依業界常見做法先定，之後可依試用迭代。

| 編號 | 設計 | 理由 |
|---|---|---|
| D1 | 編修操作：旋轉每次 90°；亮度 -50 到 +50；裁切為自由框加常用比例預設；縮放與平移只用來預覽與定位裁切框，不單獨保存。處理順序為旋轉、裁切、亮度 | 90° 步進與固定順序讓前後端結果可預期，避免任意角度旋轉帶來的空白邊 |
| D2 | 前端壓縮為 JPEG，長邊不超過 2560 px、品質 0.85；後端只收 JPEG；不保存 EXIF 與原始檔名 | 手機照片通常數 MB，壓縮後遠低於 30 MB 上限；瀏覽器的畫布輸出本來就不帶 EXIF |
| D3 | 擷取方式用裝置相機的網頁檔案選擇（相機擷取），不自建即時取景 | iOS Safari 最可靠、實作最小；日後可換成即時取景 |
| D4 | 後端在同一請求內產生初版內業版：現場版套預設參數後，把工程標示寫進影像像素（FEV-R22）；標示欄位內容未定案前預設不加標示，內業版為現場版位元組複本（仍是獨立檔案與記錄）。專案、地點、項次、拍攝者、時間、註記仍以資料關聯保存，供報表（0.8.x）在文件上與照片並排呈現。標示疊在照片上或延伸畫布另加標示區屬規格設計，暫定底部延伸畫布、不蓋住照片內容，原型時給負責人看 | 同步產生讓一筆照片永遠是完整的兩版，不需要「產製中」「產製失敗」狀態；標示寫進像素是負責人裁定（FEV-Q1），內容未定前先不加，避免猜錯欄位 |
| D5 | 內業編修由現場版重新產生，參數相對於現場版，每次覆蓋內業版；處理順序為旋轉、裁切、亮度、標示；預設參數且無標示時直接複製現場版位元組，其餘（含只有標示）重新編碼為品質 90 的 JPEG；新檔寫入後才切換記錄並刪舊檔 | 避免反覆壓縮累積畫質損失；失敗時舊內業版保持不變 |
| D6 | 資料表為 `evidence`、`evidence_variants`、`evidence_point_links`；項次以穩定識別（`source_point_id`）對應，專案查核項目 PATCH 保留點位 `id`；`snapshot_revision` 記拍攝時修訂 | 兩版各一列符合 PR-05「兩筆檔案記錄」的檢查；穩定識別使文字更正不影響對應 |
| D7 | 一張照片的對應項次限同一查核項目；`min_count` 為達標數；覆蓋以目前快照計算 | 查核項目是報告分組與總覽照的單位；`min_count` 沿用範本已凍結的欄位 |
| D8 | 註記屬 `Evidence`、兩版共用、500 字元；完成後鎖定，更正移至 0.7.x | KD-50 沒說兩版如何沿用；共用最單純且「註記一律保留」自然成立 |
| D9 | 冪等鍵放 `Idempotency-Key` 標頭，範圍為同一任務；`sha256` 必填；請求指紋（雜湊、項目、總覽旗標、項次集合、註記、拍攝時間、編修摘要）不同或他人使用同鍵回 409；重放先驗權限再比鍵再檢查狀態 | 同鍵不同請求可能是客戶端錯誤，拒絕比默默忽略新欄位安全；重放不該因任務之後的狀態變化而失敗 |
| D10 | 退避為約 1 秒、2 秒、4 秒並加上隨機抖動；可重試：網路中斷、逾時、5xx、408、429；其餘 4xx 不重試；有失敗或待上傳照片時，離開頁面前提示 | 讓暫時性失敗自癒，永久錯誤不浪費重試 |
| D11 | 現場寫入限 `IN_PROGRESS`；內業版編修含 `COMPLETED`；取消與封存唯讀；新增 `evidence.read`、`evidence.manage`；拍照者或內業可改刪 | 內業整理常發生在現場完成之後；KD-62 指明「拍照者或內業」 |
| D12 | 縮圖用 `max_edge` 在讀取時即時產生、不落地 | 不新增第三個保存的圖片，符合 PR-05 |
| D13 | 三個稽核事件代碼；作廢沿用 `project_inspection_item.updated` | 與 inspection-planning 已登記事件一致，不重複記錄 |
| D14 | 記錄編修參數：內業版為實際參數，現場版為前端回報摘要 | 為 OQ-19 預留稽核資料，不決定報告呈現 |
| D15 | 30 MB 以 30 × 1024 × 1024 位元組計；解碼像素上限預設 50 百萬像素，可由設定檔調整 | 擋下解碼炸彈；兩項都由設定檔提供 |
| D16 | 「已有結果」的判斷納入照片（`has_result` 在有結果或有效照片時為真） | KD-55 要求作廢舊結果與照片；照片在 0.6.x 先於結果存在，不納入會讓重查漏掉照片；負責人裁定（FEV-Q6） |
| D17 | 畫面配置、文案與互動細節 | 實作前依原型關卡由負責人核可後定案 |
| D18 | 檢查順序固定為權限、可見性、冪等重放、Plan 封存、Task 狀態、需求變更、照片層級、欄位驗證；`evidence.photo_locked` 只用於照片本身的狀態 | 避免同一情境出現兩種錯誤碼，前端只需對應一種說明 |
| D19 | 上傳與作廢以鎖定 Task 項目明細並重驗快照修訂處理並行 | 避免上傳與重查交錯後留下指向舊需求的有效照片 |
| D20 | 工程標示以後端打包的開源授權中文字型繪製（字型檔隨後端提交並註明授權）；字級、邊距、換行與截斷規則集中為常數；同一輸入與規則輸出相同位元組 | 不依賴主機字型才能在不同環境得到相同影像；位元組一致才能用雜湊驗收與判斷是否需要重新產生 |
| D21 | 標示規則改變後的重新產生由維運指令觸發，每張寫既有的 `evidence.office_version_edited` 事件並註明原因為標示規則變更、操作者為執行指令者；被核發報告引用的照片跳過 | 規則變更不常發生，指令比畫面入口單純；沿用既有事件不新增代碼 |

## 待釐清

本規格不自行拍板的問題。需要團隊裁定的，另開 `needs-decision` 議題。

### 裁定紀錄

下列六題已由負責人於 2026-10-10 裁定（沿用維護者提出的建議；範圍變更依[負責人直接指示](https://github.com/speko-tw/inspect-flow/issues/105#issuecomment-6093842135)在同一 PR 落地，工程標示依[負責人補充](https://github.com/speko-tw/inspect-flow/issues/105#issuecomment-6093900115)）。裁定內容已寫入對應需求與驗收條件。

<a id="fev-q1"></a>
<a id="fev-q6"></a>
<a id="fev-q12"></a>
<a id="fev-q13"></a>
<a id="fev-q14"></a>
<a id="fev-q15"></a>

| 編號 | 題目 | 裁定 | 落在 |
|---|---|---|---|
| FEV-Q1 | 內業版影像要不要加資訊？ | 要：產生內業版時，把工程標示寫進影像像素（照片底部或旁邊，像標示牌）；現場版不加標示；規則改變時從現場版重新產生內業版；查核資訊仍以資料關聯保存，報表上照片（含標示）與查核項目內容並排（0.8.x）。**仍待定**：標示欄位內容（[#588](https://github.com/speko-tw/inspect-flow/issues/588)）；疊在照片上或延伸畫布屬規格設計，原型時給負責人看 | FEV-R03、R22、D4、AC30、AC31；`docs/intents/04-glossary.md` 內業版條目 |
| FEV-Q6 | 只有照片、尚無結果的項目選「要」，是否作廢照片並標待重查？ | 作廢並標待重查；`has_result` 納入有效照片，恢復時的旗標條件改為「有結果或有效照片」 | FEV-R11、R20、AC16、AC26；IP-R04 等由 #546 修改 |
| FEV-Q12 | 照片如何在專案查核項目修改後仍指到同一個項次？ | PATCH 的點位與實測欄位帶 `id` 保留身分：有 `id` 更新、無 `id` 新增、缺席刪除 | FEV-R04、AC17；IP-R13 由 #546 修改 |
| FEV-Q13 | 已被核發報告引用的照片還能編修內業版嗎？ | 先鎖定（刪除、編修、重新產生都不行），0.8.x 隨 G-06、G-07 再定；與 CMV-R11 一致 | FEV-R03、R10、AC15 |
| FEV-Q14 | 現場任務清單要不要顯示近期已完成的任務？ | 要：增設「近期已完成」區，預設 14 天，可展開 | FEV-R19、AC25；`field-ui` FUI-R05、FUI-AC01 |
| FEV-Q15 | 已取消的任務遇到「要重新查核」，照片何時作廢？ | 恢復時才作廢（KD-56） | FEV-R11、AC27 |

### 其他待釐清

<a id="fev-q16"></a>
- **FEV-Q16**：拍攝時間由手機提供，不一定可信（裝置時間可能被改、時區可能錯）。本規格只保存用戶端回報值並擋下晚於伺服器時間超過 5 分鐘的值（FEV-R13、FEV-AC29）。工程標示是否印拍攝日期、改用上傳日期或兩者並列，待 [#588](https://github.com/speko-tw/inspect-flow/issues/588) 決定。
<a id="fev-q17"></a>
- **FEV-Q17**：已被核發報告引用的照片是否在 0.8.x 放寬編修，隨 [G-06](../../intents/05-open-questions.md#g-06)、[G-07](../../intents/05-open-questions.md#g-07) 再定；0.8.x 前沒有核發報告，不影響本規格實作。
<a id="fev-q2"></a>
- **FEV-Q2**：一張照片能否同時對應不同查核項目的項次？KD-38 只說可覆蓋多個項次；本規格限同一查核項目（D7），因為總覽與報告分組都以查核項目為單位。
<a id="fev-q3"></a>
- **FEV-Q3**：任務完成後的更正。內業編修內業版在 `COMPLETED` 仍允許（KD-33 的「之後」），但 [IP-R08](../inspection-planning/spec.md#需求) 把 KD-42 的完成後照片更正歸 0.7.x。本規格採「內業版編修允許，現場版與註記完成後更正移 0.7.x」，`state-machines` 的 Evidence 表與 SM-Q13 已對齊這個寫法。現場版與註記完成後的更正範圍已由負責人裁定（`completion-validation` 的 CMV-Q1、CMV-Q2：可改註記與換現場版，完成後不能補拍、不能刪除）；仍需負責人確認的只剩「內業版編修在 `COMPLETED` 仍允許」。
<a id="fev-q4"></a>
- **FEV-Q4**：`min_count` 大於 1 時，覆蓋數須達 `min_count` 才算達標（D7）。KD-38／KD-50 只說最少一張；範本 TPL-R07 已凍結 `min_count` 可大於 1。
<a id="fev-q5"></a>
- **FEV-Q5**：已取消任務的照片是否允許刪除或編修？本規格採唯讀，恢復後才可再寫（STM-R16 的精神）。KD-62 只說「未完成任務」。
<a id="fev-q7"></a>
- **FEV-Q7**：[OQ-19](../../intents/05-open-questions.md#oq-19)（#87，報告是否標示「照片已調整」）未裁定，屬 0.8.x；本規格只記錄編修參數（FEV-R18）。
<a id="fev-q8"></a>
- **FEV-Q8**：照片不設張數上限，儲存容量、配對備份與還原屬 `pilot-deployment`（[PR-12](../../intents/02-principles.md#pr-12)、[G-10](../../intents/05-open-questions.md#g-10)）。
<a id="fev-q9"></a>
- **FEV-Q9**：[G-04](../../intents/05-open-questions.md#g-04) 餘項（缺圖能否出報表、每項圖片選用細節）與「已被核發報告引用」的判斷來源屬 `report-delivery`；本規格只定義刪除守門的接合點（FEV-R10）。
<a id="fev-q10"></a>
- **FEV-Q10**：同步產生內業版以單一請求完成。若試用顯示照片處理拖慢上傳，再評估非同步產製（寫入工程標示後處理變重，同樣列入評估），屆時需補「產製中／失敗」狀態並同步 `state-machines`。
<a id="fev-q11"></a>
- **FEV-Q11**：`domain-model` 的 `Evidence`、`Evidence Variant` 草稿條目，與 `audit-log`、`inspection-planning`、`field-ui` 的同步，同步方式：`domain-model`、`field-ui` 已在本規格的 PR 同步（負責人直接指示，[#105](https://github.com/speko-tw/inspect-flow/issues/105#issuecomment-6093842135)）；`inspection-planning` 由 `completion-validation` 的 [PR #546](https://github.com/speko-tw/inspect-flow/pull/546) 同步；`audit-log` 事件目錄依計畫 T5。

## 變更紀錄

- 建立規格草稿：現場版與內業版、覆蓋規則、上傳契約、刪除與作廢、權限與 UI 驗收；並納入 v0.3.1 走查補充 — [#105](https://github.com/speko-tw/inspect-flow/issues/105)
- 第 1 輪審查後修訂（規格澄清與待裁定標註，行為與範圍的定案仍待負責人）：統一錯誤檢查順序並拿掉 `evidence.photo_locked` 的「已完成」；AC01 改為回應不含儲存鍵且 schema 無 BLOB；冪等納入請求指紋；新增上傳與作廢並行的鎖定與重驗（FEV-R21）；現場端 `item_id`、`point_ids` 宣告為延伸；FEV-R19 縮為現場詳情與內業計畫頁；補已取消 Task 情境；稽核標註 ALG-R16／R24；補 API 缺口；列出六項待負責人裁定（FEV-Q1、Q6、Q12～Q15）— [#105](https://github.com/speko-tw/inspect-flow/issues/105)
- 依負責人裁定定案六項待裁定（FEV-Q1、Q6、Q12～Q15），並對齊權限模型與 KD-51：新增 FEV-R22 內業版工程標示（寫進影像像素，欄位內容待 #588）、改寫 FEV-R03、D4、D5、D20、D21、AC30、AC31；FEV-R04、R11、R20 與 AC16、AC17、AC26、AC27 改為定案內容（點位帶 `id`、有效照片算已有結果、已取消 Task 恢復時才作廢）；FEV-R10 補報告引用先鎖定；FEV-R12 改為兩層權限（`inspection.use` 加專案動作碼）；FEV-R13 拍照者取上傳者身分快照，新增 FEV-Q16（拍攝時間不可信）；FEV-R19 納入「近期已完成」區，同步修改 `field-ui` FUI-R05、FUI-AC01。範圍變更（負責人指示，#105）— [負責人直接指示](https://github.com/speko-tw/inspect-flow/issues/105#issuecomment-6093842135)、[FEV-Q1 補充](https://github.com/speko-tw/inspect-flow/issues/105#issuecomment-6093900115)
