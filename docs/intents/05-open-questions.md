# 未定案議題（Open Questions）

**這份文件回答**：哪些議題還沒有定案，以及本資料夾（尤其 [02-principles.md](02-principles.md)）為釐清這些落差暫定採用的實作基線。
**什麼時候讀**：規劃 Domain Model／API 之前；遇到「文件沒寫清楚」或「兩處說法對不上」時，先來這裡查有沒有已知的落差紀錄，不要把自己的假設當成既定事實。

本文件只列仍待決的議題；議題一經裁定，就併入對應的決策（[03-decisions-and-stack.md](03-decisions-and-stack.md)）或原則，並從這裡移除，編號不重用。「目前暫定」記錄來源傾向或本文件的暫定判讀，**均待團隊確認**。

## A. 報告與交付待決

<a id="oq-07"></a>

### OQ-07：正式報表需要哪些欄位？誰簽名？是否需要版次？報表最終版面與簽核流程？（部分裁定）

**裁定**：查驗是一套共通流程，建立查驗時**不得**選定或處理輸出報表樣板；報表是獨立的功能模組，**得**匯入不同樣板格式，並一律使用內業版圖片（見 [KD-41](03-decisions-and-stack.md#kd-41)、[KD-34](03-decisions-and-stack.md#kd-34)、[KD-35](03-decisions-and-stack.md#kd-35)）。討論見 [#77](https://github.com/speko-tw/inspect-flow/issues/77)。

**未定**：具體匯入格式、樣板欄位對應、選樣板時機、簽署欄位、Revision 規則；報告如何呈現符合、不符合、不適用及嚴重度；缺圖時是否允許出報表、每項圖片選用細節。

**關聯註記**：報表種類由任務的檢查層級決定（自主檢查表、抽查（驗）紀錄表），表單類別（施工、材料設備、設備運轉測試）預設依查核項目帶入，已決定（[KD-51](03-decisions-and-stack.md#kd-51)）；同一種報表的版型與選樣板時機仍未定。簽認屬 #77，不在 KD-51 範圍；設計簽署欄位與簽認流程時需一併考慮自主檢查表與抽查（驗）紀錄表（這句只是關聯，**不是**裁定）。

**為什麼要先決定**：影響 [KD-05](03-decisions-and-stack.md#kd-05)（DOCX/PDF 核心交付物）與 [04-glossary.md](04-glossary.md) `Report` / `Report Template` 的完整欄位設計。

**選項**：報表版面、照片排列、簽核欄位內容、業主／標案指定格式有多種可能形式，留待未來團隊與業主／標案規範決定。

**目前暫定**：§30 Phase 9（路線圖的 Phase 8）要求保存文件編號、版次、報告範本版本、產製者與時間、DOCX／PDF 儲存鍵、資料快照及 SHA-256，見 [KD-05](03-decisions-and-stack.md#kd-05) 與 [PR-06](02-principles.md#pr-06)。§20.6 建議 `status` 欄位；核發不需送審已決定（[KD-57](03-decisions-and-stack.md#kd-57)），完整簽核流程仍待決。

**誰決定、何時**：業主／標案規範與團隊；其餘時間未指定。

**影響的原則**：[KD-05](03-decisions-and-stack.md#kd-05)、[PR-06](02-principles.md#pr-06)、[KD-41](03-decisions-and-stack.md#kd-41)。

**依據**：議題背景為架構基準 §0、§15、§20.3–20.12、§20.19、§20.21、§38 Report；部分裁定為負責人決定（#77，2026-09-28）。


<a id="oq-11"></a>

### OQ-11：MVP 需要支援哪幾種報表版型？

**為什麼要先決定**：影響 [01-overview.md](01-overview.md) 的 MVP 範圍界定，以及 Report Service 的 View Model Builder 設計是否需要一開始就支援多版型抽換。

**選項**：查核總表、單一查核項目報告、每日查核報告、專案階段性彙整、缺失／NCR 報告、改善前後照片報告、業主指定格式、政府標案指定格式（共 8 種）。

**關聯註記**：報表種類依 [KD-51](03-decisions-and-stack.md#kd-51)；先做自主檢查表，抽查（驗）紀錄表之後補。上述 8 種版型的取捨仍待決定。

**目前暫定**：至少應預留上述 8 種版型，但明言「初期 MVP 不需要全部做」，未指名哪一種是 MVP 必做。

**誰決定、何時**：未指定。

**影響的原則**：無直接對應的 PR。

**依據**：架構基準 §20.9


<a id="oq-19"></a>

### OQ-19：報告是否需要在文件上標示「照片已調整」？

**為什麼要先決定**：影響報告版面設計與是否需要在 Report View Model 增加對應欄位。

**選項**：顯示／不顯示。

**目前暫定**：是否顯示由業主／標案規範決定，但系統內部至少要記錄現場版與內業版各自的建立者、時間與雜湊（[PR-08](02-principles.md#pr-08)），以及內業版的編修操作，供日後稽核需要時完整提出。

**誰決定、何時**：業主／標案規範；時間未指定。

**影響的原則**：[PR-05](02-principles.md#pr-05)、[PR-08](02-principles.md#pr-08)。

**依據**：架構基準 §13A.10

## B. 技術與維運待決

<a id="oq-15"></a>

### OQ-15：正式環境採用哪一種 DOCX → PDF 轉換工具／服務？

**為什麼要先決定**：直接影響 [KD-05](03-decisions-and-stack.md#kd-05)（DOCX/PDF 核心交付物）能否在中文字型、表格、圖片、頁首頁尾、分頁上正確運作。

**選項**：DOCX → LibreOffice Headless／受控 Office Conversion Service → PDF／其他轉換工具。

**目前暫定**：#84（此 OQ 的前置決定 issue）歸 0.8.x 正式報告；規格先採建議方向「DOCX → LibreOffice Headless／受控 Office Conversion Service → PDF」，於 Pilot 實測後在 0.9.x 確認實際 Production 轉換器。實測項目含字型、表格、中文、圖片、頁首頁尾、頁碼、分頁與簽名欄。

**誰決定、何時**：團隊；Milestone 歸屬依維護者依負責人授權決定（2026-10-04，#388），負責人可推翻；轉換器於 Pilot 階段實測後確認。

**影響的原則**：[KD-05](03-decisions-and-stack.md#kd-05)。

**依據**：架構基準 §20.4；#84 版本歸屬與確認時點依維護者依負責人授權決定（2026-10-04，#388），負責人可推翻。


<a id="oq-18"></a>

### OQ-18：正式伺服器規格、Staging 環境是否建置、磁碟門檻告警比例、正式環境是否允許建立測試資料？

**為什麼要先決定**：影響正式部署與維運（[#109](https://github.com/speko-tw/inspect-flow/issues/109)）的具體內容；已落地的試用安裝見 [docs/deployment/pilot-install.md](../deployment/pilot-install.md)。這些待決事項不影響本資料夾所述的架構原則。

**選項**：各子題各自的方案（伺服器規格層級／是否建置 Staging／磁碟告警比例／是否允許測試資料）。

**目前暫定**：伺服器規格明言「應由 Pilot 實測資料決定，不要在尚無實測資料前過度估算」；Staging 環境為「若資源允許」的選配項；磁碟門檻僅以「例如 80% warning／90% critical」示意；正式環境是否允許建立測試資料「應由團隊定義」。

**誰決定、何時**：團隊；伺服器規格待 Pilot 實測資料，其餘未指定。

**影響的原則**：無。

**依據**：架構基準 §22.3、§22A.6、§22A.8、§22A.18

## C. 來源內部不一致與缺漏

以下議題不是「尚未討論」，而是架構基準在不同章節給出彼此對不上的說法（[G-10](#g-10) 是例外：它是來源**缺漏**——三處要求分開看都成立，只是沒有任何一處把它們寫在同一句話裡，見該則說明）。此處只並陳立場或標出缺漏，**不代為裁決**；由負責人裁定後併入對應 KD，並從本節移除。

<a id="g-06"></a>

### G-06：`Report` 的狀態清單，在不同章節列出的內容不完全一致（部分裁定）

**裁定**：**已定**——報告產生後，有權限者直接核發，**不需**送審（審核流程之後再加）；已核發報告有錯時出新版取代，舊版保留並標示「已被新版取代」。記錄於 [KD-57](03-decisions-and-stack.md#kd-57)。**未定**——其他報告狀態（產製中、產製失敗等）、完整的唯一 `Report` 狀態機，仍待規格整合；審核流程加入前，立場 A 列舉中的 `UNDER_REVIEW`、`APPROVED` 是否保留，裁定沒有說明；Evidence 的狀態整理另待 `field-evidence` 規格。

**關聯註記**：[#313](https://github.com/speko-tw/inspect-flow/issues/313) 提到簽認屬 [#77](https://github.com/speko-tw/inspect-flow/issues/77)（見 [OQ-07](#oq-07)）；簽認若加入報告流程，會牽動送審與核准類狀態是否保留。這只是關聯，**不是**裁定。

**為什麼要先決定**：需要團隊合併出一份唯一、完整的 `Report` 狀態機，否則交易安全（§20.17 的訴求）與版次治理（§20.6–20.8 的訴求）會各自實作出不相容的狀態欄位。

**選項**：
- **立場 A**：§20.6 給出的 `Report Status` 列舉為：DRAFT／GENERATED／UNDER_REVIEW／APPROVED／ ISSUED／SUPERSEDED／VOID；同一節的 `reports` 資料表範例也沒有列出 `issue_date` 或 `document_status` 欄位，即使 §20.8 的文字敘述提到這兩個概念。
- **立場 B**：§20.17（Transaction Boundary）為避免「DB 已寫成 GENERATED 但 PDF 實際產生失敗」，另外 要求 DRAFT → GENERATING → GENERATED 的中間狀態，以及失敗時的 GENERATION_FAILED 狀態，這兩個狀態並未出現在 §20.6 的列舉中。

**目前暫定**：核發與新版取代已定（見上）；其餘狀態無暫定。

**誰決定、何時**：負責人；核發與新版取代已於 [#94 留言](https://github.com/speko-tw/inspect-flow/issues/94#issuecomment-5967468330) 裁定（2026-10-03）；其餘未指定。

**影響的原則**：[PR-06](02-principles.md#pr-06)、[PR-15](02-principles.md#pr-15)、[KD-57](03-decisions-and-stack.md#kd-57)。

**依據**：議題背景為架構基準 §20.6–20.8、§20.17；部分裁定為負責人裁定（[#94 留言](https://github.com/speko-tw/inspect-flow/issues/94#issuecomment-5967468330)，2026-10-03）


<a id="g-07"></a>

### G-07：報告快照的確切時間點與版次邊界仍不夠精確

**關聯註記**：[#313](https://github.com/speko-tw/inspect-flow/issues/313) 提到簽認屬 [#77](https://github.com/speko-tw/inspect-flow/issues/77)（見 [OQ-07](#oq-07)）；簽認發生的時點與報告版次、快照的關係，設計簽認時需一併考慮。這只是關聯，**不是**裁定。

**為什麼要先決定**：直接影響 `KD-05`／[PR-06](02-principles.md#pr-06)（報告即不可覆蓋快照）在 DRAFT 階段的具體實作邊界。

**選項**：
- **立場 A**：§20.7 明確說「Snapshot」發生在 Report 產生當下，已核發的版次（如 REV.0）不因後續現場 資料異動而改變，異動後應產生新版次（REV.1）。
- **立場 B**：§20.13、§20.16–20.18 描述的是「DRAFT → GENERATING → GENERATED」的產製流程與 Preview 機制，但沒有說明：Preview／草稿階段的重新產生是否會就地覆寫同一個 `Report` 實體、DOCX 與 PDF 是否一定共用同一份凍結快照、以及「新版次」何時真正取得新的 `Report` id。

**目前暫定**：無。

**誰決定、何時**：未指定。

**影響的原則**：[KD-05](03-decisions-and-stack.md#kd-05)、[PR-06](02-principles.md#pr-06)。

**依據**：架構基準 §20.7、§20.13、§20.16–20.18


<a id="g-10"></a>

### G-10：來源缺漏：備份範圍（並非互相矛盾，而是來源未把三者寫在同一句）

**為什麼要先決定**：[PR-12](02-principles.md#pr-12) 為此補上一個整合決策：備份範圍涵蓋 Database、範本檔案、現場版與內業版照片（依 [KD-32](03-decisions-and-stack.md#kd-32)，不另存拍攝原圖）、已核發 DOCX／PDF，並定義一致性邊界；但這是本文件的整合結果，不是來源文件單一章節的明文規定，團隊應確認此整合範圍是否即為預期範圍。

**選項**（缺漏說明，非對立立場）：§23（Backup）明確要求「照片與 Database 必須視為同一套業務資料」， 只點名這兩者需要一致對應的備份策略；§22.12（Persistent Volumes）與 §20.5／§20.15 把 Database、 Photos、Reports 三者並列為「至少需要持久化」；§22A.10（Rollback）另要求 Storage Backup Strategy。三處沒有任何一處把「資料庫＋照片＋報表必須一致備份」逐字寫在同一句話裡——這是來源**缺漏**，不是兩條互相矛盾的規則。

**目前暫定**：[PR-12](02-principles.md#pr-12) 暫採整合範圍為準，待團隊確認。

**誰決定、何時**：團隊；時間未指定。

**影響的原則**：[PR-12](02-principles.md#pr-12)。

**依據**：架構基準 §20.5、§20.15、§22.12、§22A.10、§23

<a id="gate"></a>
## D. 開工門檻（Domain Model／API 契約凍結前必須裁定）

未解除的項目仍須先有單一答案，才能讓不同實作者做出相容實作。其餘原門檻項目（原圖來源、報告選圖與核可、Result 語意、權限模型、照片流程、Evidence 刪除、照片上傳、影像編輯、Result 欄位、報告治理）都已裁定，記錄在 [KD-32](03-decisions-and-stack.md#kd-32)、[KD-34](03-decisions-and-stack.md#kd-34)、[KD-35](03-decisions-and-stack.md#kd-35)、[KD-54](03-decisions-and-stack.md#kd-54)、[KD-57](03-decisions-and-stack.md#kd-57)、[KD-61](03-decisions-and-stack.md#kd-61)～[KD-65](03-decisions-and-stack.md#kd-65)、[KD-69](03-decisions-and-stack.md#kd-69)，不再擋門檻。

**定方向、歸屬另裁，不擋 MVP 凍結**：

- interval（查核間距）的歸屬：MVP 方向已定——不設 interval，`template-system`、`domain-model` 的 MVP 凍結範圍不需要為 interval 保留欄位（[KD-36](03-decisions-and-stack.md#kd-36)）；未來若提出選用功能，其歸屬與快照規則屆時另行裁定，在那之前不擋門檻。

**仍在擋門檻**：

- **[G-06](#g-06)（部分裁定）／[G-07](#g-07)**（報告狀態與版次快照邊界）：核發不需送審、新版取代舊版已定（[KD-57](03-decisions-and-stack.md#kd-57)）；仍需合併出一份唯一、完整的 `Report` 狀態機（含 `GENERATING`／`GENERATION_FAILED`），並定義 Snapshot 的確切時間點與 `DRAFT` 階段是否就地覆寫。

[README.md](README.md) 亦連結至本節；規劃 Domain Model／API Specification 前，請先確認上列項目是否已有團隊裁定的答案。本節的「凍結」對應規格文件的「已凍結」狀態，以及「部分凍結」規格標頭列出的凍結範圍（見 [docs/specs/README.md](../specs/README.md)）；門檻未裁定前，確認與門檻無關的實體得先凍結，其餘維持草稿（做法見 [docs/specs/README.md 部分凍結](../specs/README.md#partial-freeze)）。

此處「API 契約」指資源層端點契約（各功能規格與 `domain-model` 定義的資源、欄位與端點），不含只定義跨端點共用慣例（路徑前綴、內容型別、錯誤 envelope、分頁、時間格式、ID 表示法等）的 `api-conventions`（依據：負責人決定，PR #30，2026-09-26）。
