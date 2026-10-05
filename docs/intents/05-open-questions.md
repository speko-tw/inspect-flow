# 未定案議題（Open Questions）

**這份文件回答**：哪些議題來源文件明確留給團隊後續拍板、文件內部哪些說法互相矛盾或有缺漏，以及本資料夾 （尤其 [02-principles.md](02-principles.md)）為釐清這些落差暫定採用的實作基線。
**什麼時候讀**：規劃 Domain Model／API 之前；遇到「文件沒寫清楚」或「兩處說法對不上」時，先來這裡查有沒有已知的落差紀錄，不要把自己的假設當成既定事實。

「目前暫定」記錄來源傾向或本文件的暫定判讀，**均待團隊確認**。

## A. 業務資料與規則待決

<a id="oq-01"></a>

### OQ-01：專案（Project）需要哪些正式欄位？（已裁定）

**裁定**：一個工程案建立一筆 `Project`；必填欄位為專案編號／代號、工程名稱、業主／委託單位、整體工程地點。`project_code` 必填但**可與其他 Project 重複**，資料庫不得加唯一約束，系統內部的 Project ID（UUID）才必須唯一；**新建或修改 Project 時若 `project_code` 與既有 Project 重複，系統必須跳出警告提示使用者，但不得阻擋建立或儲存**（依據：負責人補充，[#71 留言](https://github.com/speko-tw/inspect-flow/issues/71#issuecomment-5872016815)，2026-09-28；此補充取代 `database-foundation` DBF-R13「`project_code` 必須唯一」的規則，規格修改另見 [#246](https://github.com/speko-tw/inspect-flow/issues/246)，程式修改另見 [#247](https://github.com/speko-tw/inspect-flow/issues/247)）。預計開工／完工日選填；其他參與單位先不列必填；新建後直接可用、不需啟用步驟；文件編號、查驗日期、會簽等屬文件／報表層級，不放進 `Project`。專案內部**得**依需要選用工項分類與分區，兩者皆非必須建立，見 [OQ-04](#oq-04)、[OQ-03](#oq-03)。記錄於 [KD-39](03-decisions-and-stack.md#kd-39)；討論見 [#71](https://github.com/speko-tw/inspect-flow/issues/71)。

**為什麼要先決定**：影響 [04-glossary.md](04-glossary.md) 的 `Project` 定義與資料模型設計的起點。

**選項**：
- 沿用目前的最小佔位欄位。
- 擴充 Building／Floor／Area／WBS／Contractor 等結構。

**目前暫定**：無。架構基準文件僅給出 `id`／`project_code`／`name`／`location`／`status`／ `created_at`／`updated_at` 這組最小佔位欄位，並提示未來可能需要上述結構，但明言這是佔位而非定案。

**誰決定、何時**：負責人；已於 [#71](https://github.com/speko-tw/inspect-flow/issues/71#issuecomment-5870105643) 裁定（2026-09-28）；重複時的警告提示由負責人於 [#71 留言](https://github.com/speko-tw/inspect-flow/issues/71#issuecomment-5872016815) 補充（2026-09-28）。

**影響的原則**：無直接對應的 PR；既有 `backend/app/models/project.py` 的 `project_code` 唯一約束與 `database-foundation` DBF-R13「必須唯一」的規則、`domain-model` 規格需依本裁定另開 task 修改，規格修改見 [#246](https://github.com/speko-tw/inspect-flow/issues/246)、程式修改見 [#247](https://github.com/speko-tw/inspect-flow/issues/247)，不在本次文件變更範圍內。

**依據**：議題背景為架構基準 §12.2、§0、§38 Project；裁定為負責人決定（#71，2026-09-28），取代架構基準 §12.2 的最小佔位欄位假設；重複警告規則依負責人補充（[#71 留言](https://github.com/speko-tw/inspect-flow/issues/71#issuecomment-5872016815)，2026-09-28），取代 `database-foundation` DBF-R13。


<a id="oq-02"></a>

### OQ-02：人員需要哪些組織與角色欄位？（已裁定；欄位部分已被取代）

> **已被取代**：組織欄位（公司、部門、地點、工號、姓名、email 的必填規則）已由負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）取代：公司改為可選、工號與部門與地點跟著公司、新增帳號名稱、英文姓名改為選填，見 [KD-45](03-decisions-and-stack.md#kd-45)、[KD-46](03-decisions-and-stack.md#kd-46)。聯絡與補充欄位（[KD-17](03-decisions-and-stack.md#kd-17)）與角色欄位的裁定不變。以下保留原裁定供追溯。

**裁定**：組織欄位裁定為公司、部門、地點、工號、英文姓名、中文姓名、email、啟用狀態（除啟用狀態外皆必填），另加聯絡與補充欄位（分機1、分機2、手機、Line ID、WeChat、負責事務），記錄於 [KD-16](03-decisions-and-stack.md#kd-16)、[KD-17](03-decisions-and-stack.md#kd-17)；角色欄位改為「系統管理者開關＋掛在專案成員上的可自訂角色」，不再是 `User` 上的單一 `role` 欄位，記錄於 [KD-19](03-decisions-and-stack.md#kd-19)、[KD-24](03-decisions-and-stack.md#kd-24)、[KD-27](03-decisions-and-stack.md#kd-27)。**職稱、承包商歸屬**：不列入；客戶現有的人員資料表沒有這兩項，日後有需要再新增。討論見 [#63](https://github.com/speko-tw/inspect-flow/issues/63)。

**為什麼要先決定**：影響 [01-overview.md](01-overview.md) 的角色定義與 §17 權限矩陣的完整設計。

**選項**：
- 沿用目前的最小欄位。
- 補上組織層級欄位（部門、職稱、承包商歸屬）。

**目前暫定**：無。架構基準文件只給出 `employee_no`／`name`／`email`／`role`／`active` 等最小欄位，組織層級尚未定義。

**誰決定、何時**：負責人；已於 [#63](https://github.com/speko-tw/inspect-flow/issues/63) 裁定公司、部門、地點、工號、姓名、email、啟用狀態與聯絡補充欄位，以及角色改掛專案成員；職稱、承包商歸屬不列入（2026-09-26）。

**影響的原則**：與 [OQ-08](#oq-08) 權限矩陣屬同一治理缺口，已一併裁定。

**依據**：議題背景為架構基準 §12.1、§0、§38 User；裁定為負責人決定（#63，2026-09-26），取代架構基準 §12.1 的最小欄位假設。


<a id="oq-03"></a>

### OQ-03：位置（Location）／樓層／區域／WBS 的正式編碼方式？（已裁定）

**裁定**：`Project` 建立時填寫整體工程地點；專案內**得**依需要建立分區。`Inspection Task` 的任務地點由選用分區與選填補充文字組成：專案已建立分區時，任務**必須**從該專案分區清單選一個，並**得**填補充文字；專案未建立分區時，只填補充文字。分區名稱可由內業自訂，MVP 不規定編碼格式；同一專案內的分區名稱去除空白後不分大小寫唯一。後三項是依業界慣例採用的技術預設，並非負責人另行裁定，後續得調整。WBS 整合不納入 MVP，有對接需求時另開規格。分區仍為專案選用設定；查核工項按分區分開建立與執行，未建立分區時，工區**得**只是同一查核工項的選項或資訊，與 [OQ-04](#oq-04) 屬同一組決策，見 [KD-40](03-decisions-and-stack.md#kd-40)、[KD-58](03-decisions-and-stack.md#kd-58)。任務地點裁定見 [#73 負責人留言](https://github.com/speko-tw/inspect-flow/issues/73#issuecomment-5976192382)。

**為什麼要先決定**：影響 `Inspection Task` 的 `location_text` 欄位是否需要拆成結構化編碼，以及未來與 WBS 系統整合的可行性。

**選項**：
- **採用**：專案有分區時選一個分區並可填補充文字；沒有分區時只填補充文字。
- **未選**：任務地點只使用自由文字 `location_text`，或改採棟別／樓層／區域／座標四欄結構化編碼。
- **不納入 MVP**：整合 WBS；有對接需求時另開規格。

**目前暫定**：無待裁定事項；任務地點決策記錄於 [KD-58](03-decisions-and-stack.md#kd-58)。

**誰決定、何時**：負責人；分區與工區關係於 [#73](https://github.com/speko-tw/inspect-flow/issues/73#issuecomment-5870106674) 裁定（2026-09-28），任務地點欄位於 [#73](https://github.com/speko-tw/inspect-flow/issues/73#issuecomment-5976192382) 裁定（2026-10-04）。分區名稱規則為依業界慣例整理的技術預設。

**影響的原則**：無直接對應的 PR。

**依據**：議題背景為架構基準 §0、§12.8、§38 Location；裁定為負責人決定（#73，2026-09-28、2026-10-04），分區名稱的技術預設依業界慣例整理，見 [KD-58](03-decisions-and-stack.md#kd-58)。


<a id="oq-04"></a>

### OQ-04：查核對象（工項）如何分類？材料／設備／施工工項的正式分類方式？（已裁定）

**裁定**：每個專案的內業人員**必須**依該專案需求設定要查核的工項（查核項目本身是必要設定，不得省略），**不得**套用公司共用的固定工項分類。工項分類（例如空調風管、給排水、電力設備）與分區（例如一樓 A 區、二樓 B 區）這兩層組織方式是否使用，皆是**依專案需求選用**，不強制每個專案都要建立；若建分區，查核工項按分區分開建立與執行，未建分區則工區只是同一查核工項的選項或資訊。記錄於 [KD-40](03-decisions-and-stack.md#kd-40)；討論見 [#74](https://github.com/speko-tw/inspect-flow/issues/74)。

2026-10-02 補足 9/28 未定的部分（[#74 留言](https://github.com/speko-tw/inspect-flow/issues/74#issuecomment-5956038822)）：
- **範本庫**：範本庫獨立於專案，所有專案都**得**從中挑項目套用（複製）；範本庫為選用，專案也**得**從零建立。套用後各自獨立，修改範本不回頭改動已套用的專案。見 [KD-47](03-decisions-and-stack.md#kd-47)。
- **範本內容**：只存結構（分類、查核項目、查核項次、檢查標準、照片要求），不存現場結果與照片。見 [KD-48](03-decisions-and-stack.md#kd-48)。
- **分類層數**：先固定兩層「工程類別 → 系統」，其下為查核項目（試做，日後調整另開 issue）。見 [KD-48](03-decisions-and-stack.md#kd-48)。
- **名稱**：同一層之下不得重名，不同層可重名；目前只用名稱、不設代號。見 [KD-48](03-decisions-and-stack.md#kd-48)。
- 9/28 已定的「分類與分區皆選用、分區不是分類的子層」維持。分區的任務地點與名稱規則見 [OQ-03](#oq-03)（已裁定）、[KD-58](03-decisions-and-stack.md#kd-58)。

**為什麼要先決定**：影響範本（Template）之下的工項分類設計，以及查核規則如何組織。

**選項**：架構基準文件未提出具體分類方案。

**目前暫定**：無，僅提出這是需要團隊討論的問題。

**誰決定、何時**：負責人；已於 [#74](https://github.com/speko-tw/inspect-flow/issues/74#issuecomment-5869623884)、[補充留言](https://github.com/speko-tw/inspect-flow/issues/74#issuecomment-5870106117) 部分裁定（2026-09-28），並於 [#74 留言](https://github.com/speko-tw/inspect-flow/issues/74#issuecomment-5956038822) 補足其餘部分（2026-10-02）。

**影響的原則**：[KD-40](03-decisions-and-stack.md#kd-40)、[KD-47](03-decisions-and-stack.md#kd-47)、[KD-48](03-decisions-and-stack.md#kd-48)；與 [OQ-03](#oq-03) 的分區裁定屬同一組決策。

**依據**：議題背景為架構基準 §0、§38 Work Item；裁定為負責人決定（#74，2026-09-28）與負責人裁定（#74 留言，2026-10-02）。


<a id="oq-05"></a>

### OQ-05：不同工程類型各自需要哪些正式查核範本？每一查核點需要多少張照片？（已裁定）

**裁定**：查驗系統採共通查核流程；進料／施工／測試等名稱只對應不同輸出報表樣板，不代表要做三套查驗流程。一個查核項目組下**得**有多個查核項次，項次內容由內業事先設定。現場人員自行選擇每張照片要佐證哪些查核項次，一張照片**得**覆蓋多個項次；每個查核項次**必須**至少被一張非總覽照片覆蓋。**得**額外提供「總覽照片」選項，有拍就在該組報表排第一張，且不計入最低覆蓋要求。記錄於 [KD-38](03-decisions-and-stack.md#kd-38)；討論見 [#75](https://github.com/speko-tw/inspect-flow/issues/75)。

2026-10-02 補足 9/28 未定的部分（[#75 留言](https://github.com/speko-tw/inspect-flow/issues/75#issuecomment-5956039268)），記錄於 [KD-50](03-decisions-and-stack.md#kd-50)：
- **每個項次的照片**：可多張，最少 1 張，沒有上限。
- **總覽照片**：可多張，全部排在該組最前面；仍為選拍，不計入項次最低覆蓋。
- **照片現場註記**：每一張照片（總覽與佐證項次）都**得**加現場工程師的文字註記；有填寫就呈現在報告，留白不顯示，註記一律保留。這與 [OQ-12](#oq-12)（#81）「在照片上畫標註」不同。

「不同工程類型各自需要哪些正式查核範本」由範本庫回答：範本由範本管理員在範本庫維護，專案挑項目套用，見 [KD-47](03-decisions-and-stack.md#kd-47)、[KD-49](03-decisions-and-stack.md#kd-49)；不預先規定每種工程類型必須有哪些範本。

**為什麼要先決定**：直接影響 `Template Item` / `Evidence Requirement` 的資料模型完整度，也牽動 [KD-03](03-decisions-and-stack.md#kd-03)（範本不版本化、套用即複製）如何落地。查核規則的間距（interval）欄位歸屬，MVP 方向已由 [G-01](#g-01)（部分裁定）確定不需要，其餘歸屬爭議仍未定。

**選項**：架構基準文件只給出「電纜橋架每 10 公尺查核一次，長寬高各一張照片」這類單一範例，未定義正式的每種工程材料／工項查核規則，也未定義每一查核點所需的正式照片張數。

**目前暫定**：無。

**誰決定、何時**：負責人；已於 [#75](https://github.com/speko-tw/inspect-flow/issues/75#issuecomment-5871381243) 部分裁定（2026-09-28），並於 [#75 留言](https://github.com/speko-tw/inspect-flow/issues/75#issuecomment-5956039268) 補足其餘部分（2026-10-02）。

**影響的原則**：[KD-03](03-decisions-and-stack.md#kd-03)、[KD-38](03-decisions-and-stack.md#kd-38)、[KD-50](03-decisions-and-stack.md#kd-50)；interval 歸屬另見 [G-01](#g-01)（部分裁定）。

**依據**：議題背景為架構基準 §0、§38 Template；裁定為負責人決定（#75，2026-09-28）與負責人裁定（#75 留言，2026-10-02）。


<a id="oq-06"></a>

### OQ-06：查核結果（Result）是否需要 PASS／FAIL／N/A？是否需要量測值、嚴重度、缺失（Defect）欄位？（已裁定）

**裁定**：每個查核項次的結果有三種：符合、不符合、不適用（N/A），由現場人員逐項次自行選擇，不得只替整個查核項目組選一個結果，也不得預設符合；系統不自動判定。一個查核項次**得**有多個實測欄位（例如長、寬、高），欄位與標準值由內業事先設定，標準值通常取自計畫書（數值標準另見 [KD-52](03-decisions-and-stack.md#kd-52)）；不需量測的項次沒有實測欄位，不強制填值。2026-10-03 補完其餘部分（[#76 留言](https://github.com/speko-tw/inspect-flow/issues/76#issuecomment-5965076758)）：
- 選「不符合」時，**必須**選嚴重度（輕微、一般、嚴重），並**必須**填註解說明問題。
- 選「不適用」時，**必須**填原因；照片選填。
- 項次設有實測欄位時，**必須**全部填寫才能選符合或不符合；量不到時改選「不適用」並寫原因。
- 實測欄位的型別由內業設定：數字（**必須**設單位，只接受數字）或文字（自由填寫）。項次設有數值標準時，對應實測欄位的單位**必須**相同，由系統自動帶入、不得另設；現場自行換算，單位換算不在本次範圍（[#76 留言](https://github.com/speko-tw/inspect-flow/issues/76#issuecomment-5965931420)，2026-10-03）。

記錄於 [KD-37](03-decisions-and-stack.md#kd-37)、[KD-54](03-decisions-and-stack.md#kd-54)；討論見 [#76](https://github.com/speko-tw/inspect-flow/issues/76)。不符合後的簡易改善追蹤已由 [KD-65](03-decisions-and-stack.md#kd-65) 決定排入 0.7.x；KD-65 的範圍：只做簡易改善追蹤，不做限期提醒與自動通知，也不依標準值自動判定，嚴重度不阻擋任務完成；完整缺失（Defect）管理與更進階的改善流程不在 KD-65 範圍。報告中如何呈現三種結果與嚴重度移至 [OQ-07](#oq-07)。

**為什麼要先決定**：直接影響 `Evidence` 資料模型、任務完成判定邏輯（[PR-01](02-principles.md#pr-01) 的伺服器端覆核）、報告版面設計（照片旁是否顯示 PASS／FAIL），以及「查核結果語意一旦定案後不能追溯性改寫既有資料」這一條不可延後意圖（見 [02-principles.md](02-principles.md#costly-to-retrofit-intents) 第 8 項）。

**選項**：
- 定義 PASS/FAIL/N/A ＋ Measurement ＋ Severity ＋ Defect 欄位。
- 維持目前簡化、不擴充欄位。

**目前暫定**：已由上方裁定取代。0.7.x 的簡易改善追蹤範圍依 [KD-65](03-decisions-and-stack.md#kd-65)；報告如何呈現結果與嚴重度見 [OQ-07](#oq-07)；G-08 其餘部分已移轉至 OQ-07。

**誰決定、何時**：負責人；已於 [#76](https://github.com/speko-tw/inspect-flow/issues/76#issuecomment-5867495484)、[補充留言](https://github.com/speko-tw/inspect-flow/issues/76#issuecomment-5871381768) 部分裁定（2026-09-28）；其餘欄位（`N/A`、不符合時的嚴重度與註解、不適用的原因、欄位型別與必填）已於 [#76 留言](https://github.com/speko-tw/inspect-flow/issues/76#issuecomment-5965076758) 裁定（2026-10-03）；簡易改善追蹤由維護者依負責人授權決定（2026-10-04，#388），負責人可推翻；其他未定項目移至 OQ-07 或延後處理。

**影響的原則**：[PR-01](02-principles.md#pr-01)、[PR-04](02-principles.md#pr-04) 不可延後意圖第 8 項、[KD-37](03-decisions-and-stack.md#kd-37)、[KD-54](03-decisions-and-stack.md#kd-54)；另見 [G-08](#g-08)。

**依據**：議題背景為架構基準 §20.10、§38 Result；裁定為負責人決定（#76，2026-09-28）與負責人裁定（[#76 留言](https://github.com/speko-tw/inspect-flow/issues/76#issuecomment-5965076758)，2026-10-03）。


<a id="oq-07"></a>

### OQ-07：正式報表需要哪些欄位？誰簽名？是否需要版次？報表最終版面與簽核流程？（部分裁定）

**裁定**：查驗是一套共通流程，建立查驗時**不得**選定或處理輸出報表樣板；報表是獨立的功能模組，**得**匯入不同樣板格式，並一律使用內業版圖片（見 [G-02](#g-02)、[G-04](#g-04)）。記錄於 [KD-41](03-decisions-and-stack.md#kd-41)；討論見 [#77](https://github.com/speko-tw/inspect-flow/issues/77)。G-08 移轉至本條的未決部分是報告如何呈現符合、不符合、不適用及嚴重度。其他未定項目：具體匯入格式、樣板欄位對應、選樣板時機、簽署欄位、Revision 規則。

**關聯註記**：[#313](https://github.com/speko-tw/inspect-flow/issues/313) 追加裁定提到，系統長期要把廠商自主檢查（一級）與監造抽查（二級）串在同一系統，並說明簽認屬 #77、不在 #313 範圍。設計簽署欄位與簽認流程時需一併考慮；這只是關聯，**不是**裁定。

**為什麼要先決定**：影響 [KD-05](03-decisions-and-stack.md#kd-05)（DOCX/PDF 核心交付物）與 [04-glossary.md](04-glossary.md) `Report` / `Report Template` 的完整欄位設計。

**選項**：報表版面、照片排列、簽核欄位內容、業主／標案指定格式有多種可能形式，留待未來團隊與業主／標案規範決定。

**目前暫定**：§30 Phase 9（架構基準原 Phase 9、現行路線圖 Phase 8）要求保存文件編號、版次、報告範本版本、產製者與時間、DOCX／PDF 儲存鍵、資料快照及 SHA-256，見 [KD-05](03-decisions-and-stack.md#kd-05) 與 [PR-06](02-principles.md#pr-06)。§20.6 建議 `status` 欄位；完整簽核與核發流程仍待決。

**誰決定、何時**：業主／標案規範與團隊；查驗與報表樣板的流程界線已於 [#77](https://github.com/speko-tw/inspect-flow/issues/77#issuecomment-5871382248) 由負責人部分裁定（2026-09-28）；其餘時間未指定。

**影響的原則**：[KD-05](03-decisions-and-stack.md#kd-05)、[PR-06](02-principles.md#pr-06)、[KD-41](03-decisions-and-stack.md#kd-41)。

**依據**：議題背景為架構基準 §0、§15、§20.3–20.12、§20.19、§20.21、§38 Report；部分裁定為負責人決定（#77，2026-09-28）。


<a id="oq-20"></a>

### OQ-20：由誰、何時決定擴大 MVP 的 Evidence Type 範圍？（已裁定）

**裁定**：MVP 佐證**只收照片**；佐證類型未來可能擴充（例如文件、量測數值、簽名、影片）。**不設**固定的檢討時點：有需要時開 issue，由負責人裁定後寫入規格再實作。額外文件（出廠證明、試驗報告等）拍照並以照片註記說明；報告功能（0.8.x）提供「補充文件」區可附文件或連結；串接文件管理系統屬未來。記錄於 [KD-53](03-decisions-and-stack.md#kd-53)；討論見 [#88](https://github.com/speko-tw/inspect-flow/issues/88)（[裁定留言](https://github.com/speko-tw/inspect-flow/issues/88#issuecomment-5956040233)、[補充留言](https://github.com/speko-tw/inspect-flow/issues/88#issuecomment-5956189277)，2026-10-02）。原 `TEXT` 類型：規格已定不建立 `TEXT`，MVP 只支援照片（TPL-Q4，規格設計，非負責人裁定；見 [`template-system` 規格](../specs/template-system/spec.md)）；未來要文字或其他類型，另開規格。

**為什麼要先決定**：直接影響 [01-overview.md](01-overview.md)「MVP 的證據類型邊界」一節如何落地，以及 `EvidenceRequirement.type` 實際支援哪些值。

**選項**：
- 維持 MVP 僅 `PHOTO`／`TEXT`。
- 擴大支援 `NUMBER`／`BOOLEAN`／`SIGNATURE`／`DOCUMENT`。

**目前暫定**：（原暫定已被裁定取代）MVP 佐證只收照片，見上方裁定。

**誰決定、何時**：負責人；已於 [#88 留言](https://github.com/speko-tw/inspect-flow/issues/88#issuecomment-5956040233)（2026-10-02）裁定：不設固定檢討時點，有需要時開 issue，由負責人裁定後寫入規格再實作。

**影響的原則**：[KD-53](03-decisions-and-stack.md#kd-53)；與 [OQ-06](#oq-06)（Result 語意）同屬範圍決策的不同面向。

**依據**：議題背景為架構基準 §12.6、§38 Evidence/Result；裁定為負責人裁定（#88 留言，2026-10-02）。

## B. 系統流程與權限待決

<a id="oq-08"></a>

### OQ-08：角色權限矩陣（誰能做什麼、在什麼專案範圍內）的正式版本？（已裁定）

**裁定**：角色分為全公司角色與專案角色。全公司角色直接指派給人，管理跨專案及全公司共用資源；專案角色指派給某人在某專案，沿用 `ProjectMember`。每個權限標明全公司或專案範圍，角色只能勾選同範圍權限；Admin 擁有全部權限，不需另行指派。權限依查核作業、範本系統、報告系統三大系統分組，權限及預設角色表見下。記錄於 [KD-60](03-decisions-and-stack.md#kd-60)；舊權限基礎見 [KD-24](03-decisions-and-stack.md#kd-24)～[KD-29](03-decisions-and-stack.md#kd-29)，範本角色取代關係見 [KD-49](03-decisions-and-stack.md#kd-49)。

| 系統 | 權限 | 範圍 | 預設給誰 |
|---|---|---|---|
| 查核作業 | 管理計畫與任務（建立、派出、取消、恢復、封存） | 專案 | 內業 |
| | 修改專案查核項目、套用範本 | 專案 | 內業 |
| | 現場查核（看任務、開始；之後填結果、拍照） | 專案 | 現場工程師 |
| | 看專案進度與工作量 | 專案 | 內業、專案經理 |
| | 看全部專案進度 | 全公司 | 公司主管 |
| 範本系統 | 瀏覽範本庫（有套用權限即可） | 專案 | 內業 |
| | 管理範本庫 | 全公司 | 範本管理員 |
| 報告系統 | 產出報告草稿 | 專案 | 報告人員、內業 |
| | 核發報告、發出更正版 | 專案 | 專案經理 |
| | 看已核發報告 | 專案 | 專案成員 |
| | 管理報告範本 | 全公司 | 報告範本管理員 |
| | （將來）審核報告 | 專案 | 加簽核流程時再開 |
| 共通 | 查稽核紀錄 | 全公司 | 僅 Admin（#107 裁定） |

全公司預設角色為範本管理員、報告範本管理員、公司主管；專案預設角色為專案經理、內業、現場工程師、報告人員、檢視者（將來給業主、監造）。Admin 可修改。權限代碼命名、預設角色 seed 方式與既有 `template_admin` 資料轉移由規格依業界慣例決定，不屬負責人另行裁定。

**為什麼要先決定**：影響 [01-overview.md](01-overview.md) 角色定義的落地細節，以及 [PR-01](02-principles.md#pr-01)（伺服器端覆核）如何實作授權檢查。角色管理與全公司角色的完整改造依 [KD-67](03-decisions-and-stack.md#kd-67) 排入 0.5.x；v0.3.0 先讓 Admin 管理範本。

**選項**：沿用範例矩陣（ADMIN／COORDINATOR／INSPECTOR／VIEWER 各自可做的事）／團隊調整後的正式版本。

**目前暫定**：無。

**誰決定、何時**：負責人；已於 [#387](https://github.com/speko-tw/inspect-flow/issues/387) 裁定（2026-10-04）。

**影響的原則**：[PR-01](02-principles.md#pr-01)、[PR-18](02-principles.md#pr-18)。

**依據**：議題背景為架構基準 §17；裁定為負責人決定（[#387](https://github.com/speko-tw/inspect-flow/issues/387)，2026-10-04），更新既有 [KD-24](03-decisions-and-stack.md#kd-24)～[KD-29](03-decisions-and-stack.md#kd-29) 的角色範圍安排。


<a id="oq-09"></a>

### OQ-09：`Inspection Plan`／`Inspection Task`／`Evidence`／`Report` 各自的完整狀態機，刪除／更正／產生失敗如何表示？（部分裁定）

**裁定**：`Inspection Task` 標記完成後，若資料有錯字、文字或圖片需要修正，現場人員與內業人員皆得修改；這是已完成查核後的資料修正，**不要求**重新查核，也**不**因修正而改回待確認或要求再按一次完成，任務維持「已完成」。`Inspection Plan` 底下所有任務都完成時，系統**必須**自動將計畫設為「已完成」；人員**不得**手動將計畫改為已完成（負責人已明確撤回此選項）。「封存」與取消封存由內業手動操作；其他狀態轉換見下與 [KD-56](03-decisions-and-stack.md#kd-56)；此措辭由負責人確認（[#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5968037640)，2026-10-03）。記錄於 [KD-42](03-decisions-and-stack.md#kd-42)；討論見 [#78](https://github.com/speko-tw/inspect-flow/issues/78)。

**範本部分已裁定**（[#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5956039701)，2026-10-02）：範本庫的範本修改時直接覆蓋，只保留最新版，不做版本化，因此不再有 `Template Version` 的狀態機；「快照」由套用時複製到專案的那一份負責；專案記錄來源範本名稱與套用時間供追查，範本被覆蓋後不保證能回看當時內容。記錄於 [KD-03](03-decisions-and-stack.md#kd-03)（改寫）。

**專案副本與任務快照分工已裁定**（[#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5966290670)，2026-10-03）：
- 內業修改專案查核項目並存檔時，系統**必須**跳出選單詢問「這次修改要讓現場重新查核嗎？」，並清楚警告：選「要」時，被修改項目過去的查核（結果與照片）會作廢，需要補查。
- 選「要」：只作廢同一專案內用到被修改項次的任務裡被修改的那個查核項目，以新標準補查，同一任務其他項目的結果與照片保留（範圍後來改為項目層級，見下方補充裁定）；選「不要」：只更正內容（例如錯字），不重查；用到該項次的已建立任務（未開始、進行中、已完成）一併更正為修改後的內容，只更正文字，不動結果與照片，任務狀態不變，已發出的報告不受影響（補充裁定，見下）。
- 系統**必須**記錄是誰、何時、選了什麼。
- 作廢的照片、結果與當時標準**不刪除**，標示「標準變更作廢」存檔，內業人員**必須**找得到；報告不使用作廢資料。作廢項目的紀錄整份保留、只標示作廢，不改寫，符合 [PR-04](02-principles.md#pr-04)。
- 系統資料與報告分開：已發出的報告存在報告系統，不受影響；之後產生報告一律從系統資料即時撈取。
- 只影響被修改的查核項目（原裁定為用到被修改項次的任務，後來改為項目層級，見下方補充裁定）。

記錄於 [KD-55](03-decisions-and-stack.md#kd-55)。作廢資料不刪除與 [G-05](#g-05) 有關，已發出報告不受影響與從系統資料即時撈取和 [G-06](#g-06)／[G-07](#g-07) 有關，但這三題仍未裁定，本次裁定不代為回答。

**補充裁定**（[#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5966446983)，2026-10-03）：內業修改專案查核項目後選「不要」重新查核時，用到該項次的已建立任務（未開始、進行中、已完成）**一併更正**為修改後的內容；只更正文字，不動結果與照片，任務狀態不變；已發出的報告存在報告系統，不受影響。精神與 [KD-42](03-decisions-and-stack.md#kd-42) 一致；這是 [PR-04](02-principles.md#pr-04)「任務需求快照不改寫」的明確例外，僅限內業選擇「不要」重新查核的更正；系統記錄誰、何時、改了什麼。同樣記錄於 [KD-55](03-decisions-and-stack.md#kd-55)。

**計畫、任務、報告的狀態規則已裁定**（[#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)，[#94 留言](https://github.com/speko-tw/inspect-flow/issues/94#issuecomment-5967468330)，2026-10-03；情境對答與沒選的選項見[對答紀錄](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967478534)）：

| # | 主題 | 裁定 |
|---|---|---|
| 1 | 計畫狀態 | 計畫有任務派出後由系統自動改為「進行中」；任務全部完成時系統自動改為「已完成」，**不得**手動改為已完成（[KD-42](03-decisions-and-stack.md#kd-42)）；「封存」由內業手動操作。 |
| 2 | 任務取消 | 內業**得**取消任務，**必須**填原因；取消的任務保留、顯示「已取消」，不計入計畫完成判斷。 |
| 2 補 | 完成後重開 | 已完成任務**不開放**重新打開；要重查走 [KD-55](03-decisions-and-stack.md#kd-55)（改標準、作廢被修改的項目重查）；錯字與照片依 KD-42 修正。 |
| 3 | 完成計畫遇改標準 | 計畫已完成後若有任務因 KD-55 作廢被修改的項目、退回「進行中」，計畫自動退回「進行中」，補查完再自動改回「已完成」；已封存的計畫**必須**先取消封存才能改標準。 |
| 4 | 報告核發 | 產生報告後，有權限者直接核發，**不需**送審（審核流程之後再加）；已核發報告有錯時出新版取代，舊版保留並標示「已被新版取代」。「有權限者」依 [OQ-08](#oq-08)、[KD-24](03-decisions-and-stack.md#kd-24)～[KD-29](03-decisions-and-stack.md#kd-29)，不寫固定職稱。 |
| 5 | 有不符合的任務 | 資料齊全即可完成，計畫照常自動完成；任務清單與報告明顯標示「有缺失」。改善追蹤屬 0.7.x。 |

計畫與任務部分記錄於 [KD-56](03-decisions-and-stack.md#kd-56)，報告核發與新版取代記錄於 [KD-57](03-decisions-and-stack.md#kd-57)；結果三種與不符合的必填內容見 [KD-54](03-decisions-and-stack.md#kd-54)。報告狀態只部分裁定，見 [G-06](#g-06)；照片刪除與保留（[G-05](#g-05)）不在本次，留到 0.6.x `field-evidence`。

**查核計畫的任務組成、取消、恢復與派出已裁定**（[#103 留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5969654262)，2026-10-03；情境對答與沒選的選項見同一則留言）。整體原則：先簡單做，實際用過再調整。

| # | 主題 | 裁定 |
|---|---|---|
| 1 | 任務組成 | 一個任務**得**包含多個查核項目（像一張抽查紀錄表）；只查一項就建只含一項的任務。 |
| 2 | 取消範圍 | 未完成的任務（未開始、進行中）都**得**取消，已記錄的照片與結果保留，任務標示「已取消」；**已完成的任務不得取消**。取消須填原因（上一輪裁定，不變）。 |
| 2 補 | 恢復 | 取消的任務**得**恢復，回到取消前的狀態繼續查核。取消期間若專案查核項目的標準被修改，恢復時**改用目前的標準**，任務原有結果中被修改的項目標示待重查（同 [KD-55](03-decisions-and-stack.md#kd-55) 的項目層級作廢）（負責人裁定，[#103 留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970733042)，2026-10-03）。 |
| 3 | 全部取消 | 計畫底下的任務全部取消時，計畫自動變為「已取消」（新增計畫狀態）。底下有任務完成、其餘取消時為「已完成」（依上表第 1 題與「取消不計入完成判斷」整理，裁定沒有逐字說明）。 |
| 3 補 | 封存 | **任何狀態**的計畫（進行中、已完成、已取消）都**得**封存。 |
| 4 | 派出 | 任務建立後先為「草稿」，現場看不到；內業按「派出」後現場才看得到；第一個任務派出時計畫自動變為進行中。 |

記錄於 [KD-56](03-decisions-and-stack.md#kd-56)（更新原有決策，不另立新編號，讓計畫與任務的狀態規則只有一份說法）。「一個任務得含多個查核項目」只影響任務的組成，沒有對應的決策編號，記在[詞彙表](04-glossary.md)的「查核任務」，細節由 `inspection-planning` 規格處理。

**查核計畫補充題已裁定**（[#103 留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970063986)，2026-10-03；情境對答與沒選的選項見同一則留言）：

| # | 主題 | 裁定 |
|---|---|---|
| 1 | 多項目任務遇改標準 | 內業選「要重新查核」時，**只作廢被修改的那一項**（舊照片與結果標示「標準變更作廢」存檔、內業可查找）；同一任務其他項目的結果與照片保留；任務退回「進行中」，補查後再完成。取代 [KD-55](03-decisions-and-stack.md#kd-55) 原本「整個任務作廢」的做法。 |
| 2 | 草稿與計畫完成 | 計畫底下仍有草稿任務時，計畫**不算**完成；草稿須派出並查完，或刪除後，計畫才完成。 |
| 3 | 草稿不要了 | 未派出的草稿任務**得**直接刪除；派出後只能取消。 |
| 4 | 封存後的任務 | 計畫封存後，任務唯讀；須先取消封存才能查核、取消或恢復（依業界慣例提出，負責人同意）。 |

第 1 題記錄於 [KD-55](03-decisions-and-stack.md#kd-55)，第 2～4 題記錄於 [KD-56](03-decisions-and-stack.md#kd-56)。草稿任務還沒有結果與照片，不涉及作廢。

**原列為未定的項目與規格的處理**（依據：[`state-machines` 規格](../specs/state-machines/spec.md)，凍結範圍見該規格標頭）：以下多數是規格設計，**不是**負責人新的裁定；「資料上如何並存」一列規格尚未定案，最後一列是負責人裁定（STM-R18）。規格設計之後要改，依[規格變更等級](../specs/README.md#change)處理。

| 原未定項目 | 規格怎麼定 | 性質 | 規格編號 |
|---|---|---|---|
| 計畫在第一個任務派出前的狀態名稱、「就緒」是否保留 | 派出前與沒有任務的計畫都用 `DRAFT`，**不設** `READY` | 規格設計 | STM-R17 |
| 草稿任務算不算「全部取消」的判斷對象、沒有任務的計畫的狀態 | 計畫底下有草稿任務時，不得判為已完成或已取消 | 規格設計 | STM-R17 |
| 恢復任務是否須填原因、恢復的權限 | 恢復**不要求**原因，沿用取消的權限代碼 | 規格設計 | STM-R14 |
| 恢復後計畫若已「已完成」或「已取消」，是否自動退回進行中 | 計畫狀態依目前任務集合重新推導 | 規格設計 | STM-R14、STM-R17 |
| 取消封存後計畫回到哪個狀態、取消封存的操作與權限 | 取消封存後依目前任務集合重新推導（規格設計）；取消封存由內業操作（負責人裁定，見 [KD-56](03-decisions-and-stack.md#kd-56)），權限代碼依權限規格（見規格「Inspection Plan」轉換表） | 規格設計；操作者為負責人裁定 | STM-R17、STM-R16 |
| 「有缺失」是否為獨立的狀態值 | 是任務清單上的旗標，**不是**狀態；含「不符合」仍可完成 | 規格設計 | STM-R10 |
| 未開始的任務（還沒有結果）用到被修改項次時，新標準怎麼帶入 | 無結果的任務直接套用新標準，任務狀態維持原狀 | 規格設計 | 「狀態維持原狀」見 STM-R04；「直接套用新標準」出自規格「Inspection Task」段，沒有 STM-R 編號 |
| 補查時新標準與作廢的舊標準在資料上怎麼並存 | 規格沒有定案，仍待後續規格（`domain-model`、`inspection-planning`）依各自責任定義 | 待後續規格 | 規格「Inspection Task」段 |
| [KD-55](03-decisions-and-stack.md#kd-55) 作廢對已取消任務的影響 | 恢復時改用目前標準，被修改的項目標示待重查（見上方「恢復」列） | 負責人裁定，非規格設計 | STM-R18 |

**仍未定**：Evidence 與 Report 的其他狀態，以及這兩者其他原因的作廢與失敗路徑。Report 的產製中、產製失敗與完整狀態機見 [G-06](#g-06)；Evidence 的照片流程與刪除、保留政策已由 [KD-61](03-decisions-and-stack.md#kd-61)～[KD-64](03-decisions-and-stack.md#kd-64) 決定，狀態整理仍待規格。任務需求快照維持必須（建立任務時必須產生 `Task Requirement Snapshot`，見 [PR-04](02-principles.md#pr-04)）。

**為什麼要先決定**：影響任務完成判定（[PR-01](02-principles.md#pr-01)）、報告產製失敗重試（見 [G-06](#g-06)）、以及證據刪除與歷史不可變原則（[PR-04](02-principles.md#pr-04)、 [PR-05](02-principles.md#pr-05)）之間如何協調。

**選項**：架構基準文件給出各實體「主要狀態」的骨架，例外路徑（刪除、更正、產生失敗）未完整定義。

**目前暫定**：Plan 與 Task 的狀態已由 [KD-56](03-decisions-and-stack.md#kd-56) 與 [`state-machines` 規格](../specs/state-machines/spec.md)定案：Plan 為 DRAFT／IN_PROGRESS／COMPLETED／CANCELLED／ARCHIVED（不設 READY，STM-R17）；Task 為草稿、PENDING（派出後未開始）、IN_PROGRESS、COMPLETED、CANCELLED；REOPENED 依裁定（已完成任務不開放重新打開）**不採用**。英文列舉值屬規格設計，非負責人裁定。Evidence 與 Report 的狀態仍屬草稿提案。

**誰決定、何時**：負責人；已於 [#78](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5869624405) 部分裁定（2026-09-28），範本部分於 [#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5956039701) 裁定（2026-10-02），專案副本與任務快照分工於 [#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5966290670) 裁定（2026-10-03），選「不要」時一併更正於[補充裁定](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5966446983)（同日），計畫、任務、報告的狀態規則於 [#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)、[#94 留言](https://github.com/speko-tw/inspect-flow/issues/94#issuecomment-5967468330) 裁定（同日）；查核計畫的任務組成、取消、恢復與派出於 [#103 留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5969654262) 裁定（同日）；查核計畫補充題（選「要」只作廢被修改的項目、草稿與計畫完成、草稿刪除、封存後唯讀）於 [#103 留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970063986) 裁定（同日）；Plan 與 Task 的細節由規格設計收掉（見上方表格）；Evidence 與 Report 的狀態與例外路徑留待之後討論。

**影響的原則**：[PR-01](02-principles.md#pr-01)、[PR-04](02-principles.md#pr-04)、 [PR-05](02-principles.md#pr-05)、[KD-03](03-decisions-and-stack.md#kd-03)、[KD-42](03-decisions-and-stack.md#kd-42)、[KD-54](03-decisions-and-stack.md#kd-54)、[KD-55](03-decisions-and-stack.md#kd-55)、[KD-56](03-decisions-and-stack.md#kd-56)、[KD-57](03-decisions-and-stack.md#kd-57)；另見 [G-05](#g-05)、[G-06](#g-06)、[G-07](#g-07)。

**依據**：議題背景為架構基準 §18、§20.6、§20.17；部分裁定為負責人決定（#78，2026-09-28）、負責人裁定（#78 留言，2026-10-02，範本部分）與負責人裁定（[#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5966290670)，2026-10-03，專案副本與任務快照分工；[補充裁定](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5966446983)，同日，選「不要」時一併更正）與負責人裁定（[#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)、[#94 留言](https://github.com/speko-tw/inspect-flow/issues/94#issuecomment-5967468330)，2026-10-03，計畫、任務、報告的狀態規則）與負責人裁定（[#103 留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5969654262)，2026-10-03，查核計畫的任務組成、取消、恢復與派出）與負責人裁定（[#103 留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970063986)，2026-10-03，查核計畫補充題；封存後唯讀為依業界慣例提出、負責人同意）。


<a id="oq-10"></a>

### OQ-10：`Evidence Variant`（尤其是 `EDITED`）的「核可（Approved）」狀態由誰、依何種流程決定？（已裁定，與 G-04 同一問題）

**裁定**：現場人員拍照、編修並確認即完成現場端流程，**不需要**另一位人員對照片執行獨立的核可流程；正式報表**一律**使用內業版圖片。本題與 [G-04](#g-04) 是同一個問題，答案相同，記錄於 [KD-34](03-decisions-and-stack.md#kd-34)、[KD-35](03-decisions-and-stack.md#kd-35)；討論見 [#92](https://github.com/speko-tw/inspect-flow/issues/92)。

**為什麼要先決定**：直接影響 [PR-07](02-principles.md#pr-07)（可追溯性）與報告優先選用哪一個版本的實作方式；若編輯後就能直接上報告而毫無核可流程，可能與原「非破壞式編輯的證據完整性」精神產生落差——此精神已由 [G-02](#g-02) 裁定的照片版本模型取代。

**選項**：無明列選項，見 [G-04](#g-04)。

**目前暫定**：架構基準原文的報告用照片優先序（Approved Edited Variant → Latest Edited Variant → Original）已由本裁定取代：報告一律使用內業版，不再有多版次擇優的邏輯。

**誰決定、何時**：負責人；已於 [#92](https://github.com/speko-tw/inspect-flow/issues/92#issuecomment-5869324688) 裁定（2026-09-28）。

**影響的原則**：[PR-07](02-principles.md#pr-07)、[PR-05](02-principles.md#pr-05)、[KD-34](03-decisions-and-stack.md#kd-34)、[KD-35](03-decisions-and-stack.md#kd-35)；與 [G-04](#g-04) 為同一問題。

**依據**：議題背景為架構基準 §13A.9；裁定為負責人決定（#92，2026-09-28），取代原 Variant 核可與擇優機制的設計。


<a id="oq-11"></a>

### OQ-11：MVP 需要支援哪幾種報表版型？

**為什麼要先決定**：影響 [01-overview.md](01-overview.md) 的 MVP 範圍界定，以及 Report Service 的 View Model Builder 設計是否需要一開始就支援多版型抽換。

**選項**：查核總表、單一查核項目報告、每日查核報告、專案階段性彙整、缺失／NCR 報告、改善前後照片報告、業主指定格式、政府標案指定格式（共 8 種）。

**目前暫定**：至少應預留上述 8 種版型，但明言「初期 MVP 不需要全部做」，未指名哪一種是 MVP 必做。

**誰決定、何時**：未指定。

**影響的原則**：無直接對應的 PR。

**依據**：架構基準 §20.9


<a id="oq-12"></a>

### OQ-12：現場影像編輯是否含 Contrast（對比）？是否含標註（Annotation）？（已決定）

**為什麼要先決定**：影響 [01-overview.md](01-overview.md) 的 Phase 6（Photo Upload & Field Evidence Editor）範圍認定。

**裁定**：MVP 不做對比調整與照片上畫標註；文字註記依 [KD-50](03-decisions-and-stack.md#kd-50) 處理。記錄於 [KD-64](03-decisions-and-stack.md#kd-64)。

**目前暫定**：無。

**誰決定、何時**：維護者依負責人授權決定（2026-10-04，#388），負責人可推翻。

**影響的原則**：無直接對應的 PR。

**依據**：架構基準 §13A.1、§13A.12；維護者依負責人授權決定（2026-10-04，#388），負責人可推翻；見 [KD-64](03-decisions-and-stack.md#kd-64)。

## C. 技術與維運待決

<a id="oq-13"></a>

### OQ-13：登入機制採 Server-managed Session + HttpOnly Cookie，還是 Short-lived Token in HttpOnly Cookie？密碼雜湊演算法是否鎖定 Argon2id？（已裁定）

**裁定**：登入機制採 Server-managed Session + HttpOnly Cookie（Cookie 加上 Secure、SameSite）；密碼雜湊採 Argon2id；維持架構基準原本就要避免的做法，不把長效 JWT 放在 browser localStorage。理由：部署是單一伺服器，停用人員時可以立刻讓現有的登入失效（依 [KD-21](03-decisions-and-stack.md#kd-21)），不需要另外做 token 撤銷機制；將來串接外部身分來源（LDAP、AD、Entra ID）時，登入成功後一樣建立伺服器端的 Session，兩者不衝突。Argon2id 是 OWASP 目前推薦的第一選擇，架構基準也以 Argon2id 表達傾向；參數依實作時 OWASP 的建議值，寫在 `authentication` 規格裡。記錄於 [KD-30](03-decisions-and-stack.md#kd-30)、[KD-31](03-decisions-and-stack.md#kd-31)；討論見 [#82](https://github.com/speko-tw/inspect-flow/issues/82)。

**為什麼要先決定**：影響 Authentication 模組的實作選擇，以及是否需要額外的 Token 撤銷機制設計。

**選項**：Server-managed Session + HttpOnly Cookie／Short-lived Token in HttpOnly Cookie；密碼雜湊 Argon2id／其他演算法。

**目前暫定**：架構基準文件把兩者並列為「推薦」與「或經團隊評估採用」，並未鎖定其中一種；密碼雜湊僅以 「例如 Argon2id」表達傾向。唯一明確建議避免的是「將長效 JWT 直接放在 browser localStorage」。

**誰決定、何時**：負責人；已於 [#82](https://github.com/speko-tw/inspect-flow/issues/82) 裁定（2026-09-26）。

**影響的原則**：無直接對應的 PR。

**依據**：議題背景為架構基準 §17；裁定為負責人決定（#82，2026-09-26），在架構基準 §17 並列的兩個選項中選定一個。


<a id="oq-14"></a>

### OQ-14：Evidence 編輯的最終影像處理，MVP 是否採「Frontend Preview + Backend Render」？（已決定）

**為什麼要先決定**：影響現場版、內業版兩階段照片流程（見 [KD-32](03-decisions-and-stack.md#kd-32)、[KD-33](03-decisions-and-stack.md#kd-33)）與 [PR-07](02-principles.md#pr-07)（可追溯性、產製一致性）如何落地；也影響 Offline 模式未來銜接的方式。

**選項**：Strategy A（Frontend Render）／Strategy B（Backend Render）。

**裁定**：現場拍照後由前端壓縮產生現場版直接上傳，不保存拍攝原圖；內業版由後端依編輯操作從現場版產生，前端只做預覽。MVP 採 Online-first，不做離線佇列；失敗時照片留在畫面上，可自動重試後手動重送。記錄於 [KD-61](03-decisions-and-stack.md#kd-61)。

**目前暫定**：無。

**誰決定、何時**：維護者依負責人授權決定（2026-10-04，#388），負責人可推翻。

**影響的原則**：[KD-32](03-decisions-and-stack.md#kd-32)、[KD-33](03-decisions-and-stack.md#kd-33)、[PR-07](02-principles.md#pr-07)；另見 [G-03](#g-03)。

**依據**：架構基準 §13A.7–13A.8、§30 Phase 6、§35；維護者依負責人授權決定（2026-10-04，#388），負責人可推翻；見 [KD-61](03-decisions-and-stack.md#kd-61)。


<a id="oq-15"></a>

### OQ-15：正式環境採用哪一種 DOCX → PDF 轉換工具／服務？

**為什麼要先決定**：直接影響 [KD-05](03-decisions-and-stack.md#kd-05)（DOCX/PDF 核心交付物）能否在中文字型、表格、圖片、頁首頁尾、分頁上正確運作。

**選項**：DOCX → LibreOffice Headless／受控 Office Conversion Service → PDF／其他轉換工具。

**目前暫定**：#84（此 OQ 的前置決定 issue）歸 0.8.x 正式報告；規格先採建議方向「DOCX → LibreOffice Headless／受控 Office Conversion Service → PDF」，於 Pilot 實測後在 0.9.x 確認實際 Production 轉換器。實測項目含字型、表格、中文、圖片、頁首頁尾、頁碼、分頁與簽名欄。

**誰決定、何時**：團隊；Milestone 歸屬依維護者依負責人授權決定（2026-10-04，#388），負責人可推翻；轉換器於 Pilot 階段實測後確認。

**影響的原則**：[KD-05](03-decisions-and-stack.md#kd-05)。

**依據**：架構基準 §20.4；#84 版本歸屬與確認時點依維護者依負責人授權決定（2026-10-04，#388），負責人可推翻。


<a id="oq-16"></a>

### OQ-16：Python 靜態型別檢查工具採 mypy 還是 pyright？（已裁定）

**裁定**：採 pyright，先用 `basic` 模式，之後逐個模組改成 `strict`。理由：團隊多數使用 VS Code，其 Pylance 與 pyright 同一引擎，編輯器與 CI 的結果一致；不需 plugin 即可處理 Pydantic v2 與 SQLAlchemy 2.x 的 `Mapped` 型別。記錄於 [程式品質工具](03-decisions-and-stack.md#stack-code-quality)；討論見 [#5](https://github.com/speko-tw/inspect-flow/issues/5)。

**為什麼要先決定**：屬於工程規範選擇，影響 CI Lint 設定，但不影響架構決策本身。

**選項**：mypy／pyright。

**目前暫定**：無，明言「依團隊決定」，未給出傾向。

**誰決定、何時**：團隊；已於 [#5](https://github.com/speko-tw/inspect-flow/issues/5) 裁定。

**影響的原則**：無。

**依據**：架構基準 §29


<a id="oq-17"></a>

### OQ-17：照片上傳大小上限、失敗重試與冪等（idempotency）語意？（已決定）

**為什麼要先決定**：影響現場網路品質不佳時的上傳體驗，以及 Evidence 記錄是否可能因重試而重複產生。

**裁定**：單檔上限 30 MB（得由設定檔調整）；前端自動重試 3 次，採指數退避，之後顯示手動重送；每次上傳使用前端產生的 UUID 作冪等鍵，後端重複收到同一鍵時回原結果。離線佇列與重新連線同步不在 MVP 範圍。記錄於 [KD-63](03-decisions-and-stack.md#kd-63)。

**目前暫定**：無。

**誰決定、何時**：維護者依負責人授權決定（2026-10-04，#388），負責人可推翻。

**影響的原則**：無。

**依據**：架構基準 §22.9、§35；維護者依負責人授權決定（2026-10-04，#388），負責人可推翻；見 [KD-63](03-decisions-and-stack.md#kd-63)。


<a id="oq-18"></a>

### OQ-18：正式伺服器規格、Staging 環境是否建置、磁碟門檻告警比例、正式環境是否允許建立測試資料？

**為什麼要先決定**：影響 Pilot／Production 部署文件（`DEPLOYMENT.md`）的具體內容，但不影響本資料夾所述的架構原則。

**選項**：各子題各自的方案（伺服器規格層級／是否建置 Staging／磁碟告警比例／是否允許測試資料）。

**目前暫定**：伺服器規格明言「應由 Pilot 實測資料決定，不要在尚無實測資料前過度估算」；Staging 環境為「若資源允許」的選配項；磁碟門檻僅以「例如 80% warning／90% critical」示意；正式環境是否允許建立測試資料「應由團隊定義」。

**誰決定、何時**：團隊；伺服器規格待 Pilot 實測資料，其餘未指定。

**影響的原則**：無。

**依據**：架構基準 §22.3、§22A.6、§22A.8、§22A.18


<a id="oq-19"></a>

### OQ-19：報告是否需要在文件上標示「照片已調整」？

**為什麼要先決定**：影響報告版面設計與是否需要在 Report View Model 增加對應欄位。

**選項**：顯示／不顯示。

**目前暫定**：是否顯示由業主／標案規範決定，但系統內部至少要記錄 original／edited、operations、 `created_by`、`created_at`、hash，供日後稽核需要時完整提出。

**誰決定、何時**：業主／標案規範；時間未指定。

**影響的原則**：無。

**依據**：架構基準 §13A.10


<a id="oq-21"></a>

### OQ-21：Admin／Field 是否維持單一前端 React Codebase？（已裁定）

**裁定**：維持單一 React application，以 `/admin/*`、`/field/*` 路由與權限區分，並依路由拆分程式碼，讓 Field 不載入 Admin 的程式。Field PWA 需要獨立發布週期時再評估拆分。記錄於 [KD-12](03-decisions-and-stack.md#kd-12)；討論見 [#5](https://github.com/speko-tw/inspect-flow/issues/5)。

**為什麼要先決定**：影響前端專案結構、部署流程與未來 Admin／Field 分離的時機。原本以 KD-12 的形式收錄，因不符合「僅收錄明確拍板決策」的標準而改列於此。

**選項**：維持單一 React application（`/admin/*`、`/field/*` 以路由與權限區分）／未來差異變大時拆分為獨立專案。

**目前暫定**：架構基準文件以「建議先使用」的語氣提出單一 React application，而非以 ADR 或不含糊祈使語氣拍板；若未來兩者差異變得非常大，再拆分為獨立專案。

**誰決定、何時**：團隊；已於 [#5](https://github.com/speko-tw/inspect-flow/issues/5) 裁定。

**影響的原則**：無。

**依據**：架構基準 §5.1


<a id="oq-22"></a>

### OQ-22：開工門檻未裁定前，不受影響的實體能否先凍結？（已裁定）

**裁定**：允許部分凍結（選項 B1），第一批只凍結 `User`、`Project` 的共通結構；`Company` 歸 Phase 1，其欄位由 `domain-model` 定義。`Inspection Template`、`Template Version` 等，待 [G-01](#g-01) 裁定並說清楚立場 A 的 `Template` 指哪一層後再凍結，歸 Phase 3（見 [01-overview.md](01-overview.md)）。理由：這些範本實體列在 Phase 3 `template-system`，且該 Phase 受 G-01 阻擋，延後的實際成本很小。怎麼確認實體與門檻無關、規格內怎麼標示、已凍結的實體之後被裁定牽動時怎麼處理，見 [docs/specs/README.md 部分凍結](../specs/README.md#partial-freeze)；討論見 [#46](https://github.com/speko-tw/inspect-flow/issues/46)。

**為什麼要先決定**：[開工門檻](#gate)要求 Domain Model 與 API 契約凍結前先裁定 G-01～G-07 與 OQ-06，但 Phase 1 的 `User`、`Project` 看起來不受這些議題影響。若不允許部分凍結，`domain-model` 規格（見 [docs/specs/README.md](../specs/README.md#index)）要等整個門檻裁定完才能凍結，Phase 1 的資料表也跟著延後。

**選項**：
- 整份 Domain Model 一起凍結，門檻全部裁定前都維持草稿。
- 允許部分凍結：逐一確認某實體與門檻議題無關後先凍結該實體，其餘維持草稿。

**目前暫定**：無。來源只規定凍結前必須裁定，沒有提到部分凍結。

**誰決定、何時**：負責人；已於 [#46](https://github.com/speko-tw/inspect-flow/issues/46) 裁定（2026-09-26）。

**影響的原則**：[PR-03](02-principles.md#pr-03)、[PR-09](02-principles.md#pr-09)。

**依據**：議題背景為架構基準 §14、§25；裁定為負責人決定（#46，2026-09-26），架構基準無對應章節。


## D. 來源內部不一致（Source-Internal Contradictions）

以下議題大多不是「尚未討論」，而是架構基準文件在不同章節給出彼此對不上的說法（[G-10](#g-10) 是例外：它是來源**缺漏**——三處要求分開看都成立，只是沒有任何一處把它們寫在同一句話裡，見該則說明）。此處只並陳立場或標出缺漏，**不代為裁決**；團隊應在下一輪資料雛形討論時擇一並記錄理由。

<a id="g-01"></a>

### G-01：Interval（查核間距）欄位歸屬何處，沒有單一權責來源（部分裁定）

**裁定**：**已定**——MVP 查驗項目／查驗點**必須**由內業／後台人員依專案需求事先給定；MVP **不**以 `interval` 作為每個工項的必填規則，也**不**以「輸入間距後自動切分任務」作為完成查驗的必要流程。**未定**——若未來把 interval 作為選用功能提供（例如輔助內業快速產生查驗點），它該歸屬 `Template` 還是 `Inspection Plan` 輸入層（立場 A、B 的爭議），以及是否要、如何快照進 `Task Requirement Snapshot`，仍未裁決。記錄於 [KD-36](03-decisions-and-stack.md#kd-36)；討論見 [#89](https://github.com/speko-tw/inspect-flow/issues/89)。

**為什麼要先決定**：`Template Item` / `Evidence Requirement` / `Inspection Plan` / `Inspection Task` 的資料表清單中都沒有明確的 `interval` 欄位，因此目前無法判斷 interval 該被快照進 `Task Requirement Snapshot`，還是只存在於 Plan 輸入層。

**選項**：
- **立場 A**：`Interval`（例如「每 10 公尺」）是 `Template` 本身的一部分，與 `Requirements` 並列在 同一個範本定義下（依據：架構基準 §2.4 範例）。
- **立場 B**：`Interval` 是建立 `Inspection Plan` 時由管理者輸入的參數，與起點／終點一起決定 Task Generator 如何切分任務（依據：架構基準 §16.2 範例）。

**目前暫定**：無（來源內部不一致）；MVP 方向已定為不需要 interval，立場 A、B 的爭議只在未來新增選用的自動切分功能時才需要裁決。

**誰決定、何時**：負責人；已於 [#89](https://github.com/speko-tw/inspect-flow/issues/89#issuecomment-5867481635) 部分裁定（2026-09-28）；interval 作為選用功能時的歸屬與快照規則，裁定時間未指定。

**影響的原則**：[PR-09](02-principles.md#pr-09)、[KD-36](03-decisions-and-stack.md#kd-36)；[OQ-05](#oq-05) 的照片與項次覆蓋規則已另行部分裁定。

**依據**：議題背景為架構基準 §2.4、§12.3–12.9、§16.2；部分裁定為負責人決定（#89，2026-09-28）。


<a id="g-02"></a>

### G-02：原始證據（Original Evidence）被建模了兩次，且儲存鍵範例路徑不一致（已裁定）

**裁定**：每筆照片最終**只保存現場版與內業版兩張圖片**，**不另外保存原始拍攝圖**，也不保存編輯過程中的中間圖片。立場 A、B 的爭議因此不再適用——兩者都是「原圖」的建模方式，而系統根本不保存原圖。現場人員拍照、編修、確認後存一張「現場版」；內業系統取得現場版、加入現場及查核相關資訊後存一張「內業版」；內業人員可再編修內業版；報表一律使用內業版。本留言**取代**本議題較早「保留現場拍攝原圖＋一張最終後製圖」的業務釐清。記錄於 [KD-32](03-decisions-and-stack.md#kd-32)；討論見 [#90](https://github.com/speko-tw/inspect-flow/issues/90)。

**為什麼要先決定**：兩種模型並存會導致「原圖到底是 `evidence.storage_key`，還是 `evidence_variants` 裡 `variant_type = ORIGINAL` 的那一筆」定義不清，直接影響 [PR-05](02-principles.md#pr-05)／[PR-07](02-principles.md#pr-07) 的實作；兩處給的儲存鍵路徑格式也不一致。

**選項**：
- **立場 A**：`evidence` 資料表本身的 `storage_key` 欄位似乎就代表已提交的原始檔案（依 據：架構基準 §12.10、§13.1 範例路徑 `photos/<project_id>/<task_id>/<evidence_id>.<ext>`）。
- **立場 B**：`evidence_variants` 資料表把 `ORIGINAL` 列為 `variant_type` 的其中一種，暗示原圖應該是 一筆 Variant 記錄（依據：架構基準 §13A.4、§13A.2 範例路徑 `evidence/abc/original.jpg`）。

**目前暫定**：無（來源內部不一致）；裁定已使兩個立場都不再適用，原圖不存在於資料模型中。

**誰決定、何時**：負責人；已於 [#90](https://github.com/speko-tw/inspect-flow/issues/90#issuecomment-5869323681) 裁定（2026-09-28），取代較早的業務釐清。

**影響的原則**：[PR-05](02-principles.md#pr-05)、[PR-07](02-principles.md#pr-07)、[KD-32](03-decisions-and-stack.md#kd-32)。

**依據**：議題背景為架構基準 §12.10、§13.1、§13A.2、§13A.4；裁定為負責人決定（#90，2026-09-28）。


<a id="g-03"></a>

### G-03：現場編輯流程與「Backend Render」策略的先後順序沒有對齊（已決定）

**裁定**：每筆照片只保存現場版與內業版，不保存拍攝原圖或編輯中間圖片。現場拍照後由前端壓縮產生現場版直接上傳；內業版由後端依編輯操作從現場版產生，前端只做預覽。MVP 採 Online-first，不做離線佇列；上傳失敗時照片留在畫面上，可自動重試後手動重送。記錄於 [KD-61](03-decisions-and-stack.md#kd-61)；照片保存模型見 [KD-32](03-decisions-and-stack.md#kd-32)、[KD-33](03-decisions-and-stack.md#kd-33)。

**為什麼要先決定**：明確現場版上傳時點、後端產生內業版的分工與失敗時行為，讓前後端採用一致契約。

**選項**：
- **立場 A**：§13A.5 描述的現場流程是「拍照 → 預覽 → 編輯（Zoom/Crop/Rotate/Brightness/Reset）→ 確 認 → Upload」，暗示編輯發生在上傳之前。
- **立場 B**：§13A.7–13A.8 建議的「Frontend Preview + Backend Render」策略，要求後端先取得已上傳的 Original Evidence ID，才能依 Edit Operations 產生 Edited Variant；§30 Phase 6 的驗收流程也明寫 「Upload Original → Backend validation → Storage → Evidence DB record → Generate Edited Variant」，即先上傳原圖，編輯結果之後才送出。

**目前暫定**：無。

**誰決定、何時**：維護者依負責人授權決定（2026-10-04，#388），負責人可推翻。

**影響的原則**：[OQ-14](#oq-14)、[KD-32](03-decisions-and-stack.md#kd-32)、[KD-33](03-decisions-and-stack.md#kd-33)、[PR-07](02-principles.md#pr-07)。

**依據**：議題背景為架構基準 §13A.5、§13A.7–13A.8、§30 Phase 6、§35；維護者依負責人授權決定（2026-10-04，#388），負責人可推翻。


<a id="g-04"></a>

### G-04：「已核可（Approved）」的 Evidence Variant 被引用，卻沒有對應的治理機制（已裁定，與 OQ-10 同一問題）

**裁定**：現場人員拍照、編修並確認後，存一張現場版並傳至內業，**不需要**另一位人員對這張照片再執行獨立的核可流程。內業系統根據現場版加入現場與查核相關資訊，存一張內業版；內業人員可以編修內業版，後續圖片編修或報表圖片調整均使用此內業版本處理並存檔。**報表一律使用內業版圖片**；現場資料傳到內業後不會自動出報表，**必須**由內業人員在系統按下「出報表」，系統才產生報表。立場 A（Approved Edited Variant）與立場 B（沒有核可治理機制）的落差因此解消：系統不設計「核可」這個中間狀態，現場確認即完成，報表固定使用內業版。記錄於 [KD-34](03-decisions-and-stack.md#kd-34)、[KD-35](03-decisions-and-stack.md#kd-35)；討論見 [#92](https://github.com/speko-tw/inspect-flow/issues/92)。缺圖時是否允許出報表、每項圖片選用細節尚未裁定。

**為什麼要先決定**：若無治理機制，「Approved」在實作上可能等於「Latest」，使得報告可能引用一張未經任何審核的編輯照片；也與 [OQ-10](#oq-10) 直接相關。

**選項**：
- **立場 A**：§13A.9 報告用照片的優先序明確提到「1. Approved Edited Variant」。
- **立場 B**：全文沒有任何 Variant 核可紀錄、核可者、核可流程或狀態欄位的定義（不像 `Report` 有明確 的 `report_approvals`，依據：架構基準 §20.12）。

**目前暫定**：無（來源內部不一致）；裁定已解消此落差，見上方「裁定」段。

**誰決定、何時**：負責人；已於 [#92](https://github.com/speko-tw/inspect-flow/issues/92#issuecomment-5869324688) 裁定（2026-09-28）。

**影響的原則**：[OQ-10](#oq-10)、[PR-05](02-principles.md#pr-05)、[KD-34](03-decisions-and-stack.md#kd-34)、[KD-35](03-decisions-and-stack.md#kd-35)。

**依據**：議題背景為架構基準 §13A.9、§20.12；裁定為負責人決定（#92，2026-09-28）。


<a id="g-05"></a>

### G-05：Evidence 的刪除 API 與「原圖永不覆蓋／歷史必須可追溯」的原則需要一套共同政策（已決定）

**裁定**：任務完成前，拍照者或內業得刪除未完成任務的照片，採軟刪除並寫稽核；任務完成後不可刪除，只能依 [KD-42](03-decisions-and-stack.md#kd-42) 修正；已被核發報告引用的照片永不刪除；作廢資料依 [KD-55](03-decisions-and-stack.md#kd-55) 保留。MVP 不做自動清除，保存期限隨專案。記錄於 [KD-62](03-decisions-and-stack.md#kd-62)。

**為什麼要先決定**：照片刪除須兼顧任務狀態、已核發報告引用與歷史可追溯性。

**選項**：
- **立場 A**：§15 的 API 範圍明確列出 `DELETE /api/v1/evidence/{id}`。
- **立場 B**：§13A.2／§13A.11／§20.11 都要求原圖不可覆蓋、報告照片必須可回溯至原始 Evidence；一筆已 被某份已核發 `Report` 引用的 Evidence 若被硬刪除，會直接違反 [PR-06](02-principles.md#pr-06)／ [PR-07](02-principles.md#pr-07)。

**目前暫定**：無。

**誰決定、何時**：維護者依負責人授權決定（2026-10-04，#388），負責人可推翻。

**影響的原則**：[PR-05](02-principles.md#pr-05)、[PR-06](02-principles.md#pr-06)、 [PR-07](02-principles.md#pr-07)。

**依據**：架構基準 §13A.2、§13A.11、§15、§20.11；維護者依負責人授權決定（2026-10-04，#388），負責人可推翻；見 [KD-62](03-decisions-and-stack.md#kd-62)。


<a id="g-06"></a>

### G-06：`Report` 的狀態清單，在不同章節列出的內容不完全一致（部分裁定）

**裁定**：**已定**——報告產生後，有權限者直接核發，**不需**送審（審核流程之後再加）；已核發報告有錯時出新版取代，舊版保留並標示「已被新版取代」。記錄於 [KD-57](03-decisions-and-stack.md#kd-57)；討論見 [#94 留言](https://github.com/speko-tw/inspect-flow/issues/94#issuecomment-5967468330)，完整裁定表見 [#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5967467998)。**未定**——其他報告狀態（產製中、產製失敗等）、完整的唯一 `Report` 狀態機，仍待規格整合；審核流程加入前，立場 A 列舉中的 `UNDER_REVIEW`、`APPROVED` 是否保留，裁定沒有說明。

**關聯註記**：[#313](https://github.com/speko-tw/inspect-flow/issues/313) 提到簽認屬 [#77](https://github.com/speko-tw/inspect-flow/issues/77)（見 [OQ-07](#oq-07)）；簽認若加入報告流程，會牽動送審與核准類狀態是否保留。這只是關聯，**不是**裁定。

**為什麼要先決定**：需要團隊合併出一份唯一、完整的 `Report` 狀態機，否則交易安全（§20.17 的訴求）與版次治理（§20.6–20.8 的訴求）會各自實作出不相容的狀態欄位。

**選項**：
- **立場 A**：§20.6 給出的 `Report Status` 列舉為：DRAFT／GENERATED／UNDER_REVIEW／APPROVED／ ISSUED／SUPERSEDED／VOID；同一節的 `reports` 資料表範例也沒有列出 `issue_date` 或 `document_status` 欄位，即使 §20.8 的文字敘述提到這兩個概念。
- **立場 B**：§20.17（Transaction Boundary）為避免「DB 已寫成 GENERATED 但 PDF 實際產生失敗」，另外 要求 DRAFT → GENERATING → GENERATED 的中間狀態，以及失敗時的 GENERATION_FAILED 狀態，這兩個狀態並未出現在 §20.6 的列舉中。

**目前暫定**：核發與新版取代已定（見上）；其餘狀態無暫定。

**誰決定、何時**：負責人；核發與新版取代已於 [#94 留言](https://github.com/speko-tw/inspect-flow/issues/94#issuecomment-5967468330) 部分裁定（2026-10-03）；其餘未指定。

**影響的原則**：[PR-06](02-principles.md#pr-06)、[PR-15](02-principles.md#pr-15)、[KD-57](03-decisions-and-stack.md#kd-57)；另見 [OQ-09](#oq-09)。

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


<a id="g-08"></a>

### G-08：查核結果（Result）在報告章節被當作既有資料使用，但其欄位原本未定案（已移轉）

**裁定**：Result 欄位由 [OQ-06](#oq-06) 補完：結果三種（符合、不符合、不適用）、不符合的嚴重度與註解、不適用的原因、實測欄位型別與必填規則，見 [KD-37](03-decisions-and-stack.md#kd-37)、[KD-54](03-decisions-and-stack.md#kd-54)。不符合後的 0.7.x 簡易改善追蹤依 [KD-65](03-decisions-and-stack.md#kd-65) 決定。報告如何呈現三種結果與嚴重度移至 [OQ-07](#oq-07) 處理；本議題其餘部分已移轉並解除阻擋。

**為什麼要先決定**：報告架構的設計預設 Result 資料存在，但 Result 的資料模型原本沒有定案（現已由 [OQ-06](#oq-06) 補完，改善追蹤見 [KD-65](03-decisions-and-stack.md#kd-65)、0.7.x）；這與 [OQ-06](#oq-06) 是同一個缺口的兩面，應合併處理，且任何後續定案都要遵守 [PR-04](02-principles.md#pr-04) 的歷史不可變原則。

**選項**：
- **立場 A**：§20.2（Report 產製架構）把「Results」與「Approval / Signature Metadata」列為 Database 提供給 Report Service 的既有輸入；§20.10 的照片版面設計範例也直接使用「PASS / FAIL」措辭。
- **立場 B**：§38（Result）明確把「是否需要 PASS/FAIL/N/A？Measurement？Severity？Defect？」列為留待 團隊討論的未定案項目。

**目前暫定**：無；改善追蹤依 [KD-65](03-decisions-and-stack.md#kd-65)，報告呈現依 [OQ-07](#oq-07)。

**誰決定、何時**：Result 欄位由負責人於 [#76 留言](https://github.com/speko-tw/inspect-flow/issues/76#issuecomment-5965076758) 裁定（2026-10-03）；改善追蹤由維護者依負責人授權決定（2026-10-04，#388），負責人可推翻；報告呈現移轉至 [OQ-07](#oq-07)。

**影響的原則**：[OQ-06](#oq-06)、[PR-04](02-principles.md#pr-04)、[KD-54](03-decisions-and-stack.md#kd-54)。

**依據**：架構基準 §20.2、§20.10、§38；Result 欄位依負責人裁定（#76 留言，2026-10-03），改善追蹤依維護者授權決定（2026-10-04，#388），負責人可推翻；報告呈現見 [OQ-07](#oq-07)。


<a id="g-09"></a>

### G-09：部署範例的 migration 與服務啟動順序相反（已裁定）

**裁定**：採 §22.15 的順序，初次部署與升級部署相同：備份 → Alembic migration → migration 成功後才啟動或重啟 API → Health Check → Smoke Test。migration 失敗時停止部署，不啟動新版 API。不採用 §22.16 先 `docker compose up -d` 再跑 migration 的範例；`pilot-deployment` 規格依此順序撰寫部署步驟。理由：先啟動 API 會讓尚未遷移的服務接收請求，初次部署可能缺資料表，升級部署可能遇到舊 Schema；同一套順序也不必維護兩份部署腳本。此裁定把 [PR-13](02-principles.md#pr-13) 原本的暫定做法轉為正式；討論見 [#97](https://github.com/speko-tw/inspect-flow/issues/97)。

**為什麼要先決定**：若 API 在 migration 完成前接收請求，初次部署可能缺資料表，升級部署可能遇到舊 Schema。[PR-13](02-principles.md#pr-13) 的安全閘點需要團隊確認。

**選項**：§22.15 規定 Backup → Alembic Migration → Start/Restart API → Health Check → Smoke Test；§22.16 範例卻是 `docker compose build` → `docker compose up -d` → `docker compose run --rm api alembic upgrade head`。來源沒有說兩段分別適用初次或升級部署。

**目前暫定**：[PR-13](02-principles.md#pr-13) 採 §22.15 的順序；無論初次或升級部署，都等 migration 完成才讓新版 API 接流量。

**誰決定、何時**：負責人；已於 [#97](https://github.com/speko-tw/inspect-flow/issues/97) 裁定（2026-09-26）。

**影響的原則**：[PR-13](02-principles.md#pr-13)。

**依據**：議題背景為架構基準 §22.15–22.16；裁定為負責人決定（#97，2026-09-26），採 §22.15 的順序。

<a id="g-10"></a>

### G-10：來源缺漏：備份範圍（並非互相矛盾，而是來源未把三者寫在同一句）

**為什麼要先決定**：[PR-12](02-principles.md#pr-12) 為此補上一個整合決策：備份範圍涵蓋 Database、範本檔案、現場版與內業版照片（依 [KD-32](03-decisions-and-stack.md#kd-32)，不另存拍攝原圖）、已核發 DOCX／PDF，並定義一致性邊界；但這是本文件的整合結果，不是來源文件單一章節的明文規定，團隊應確認此整合範圍是否即為預期範圍。

**選項**（缺漏說明，非對立立場）：§23（Backup）明確要求「照片與 Database 必須視為同一套業務資料」， 只點名這兩者需要一致對應的備份策略；§22.12（Persistent Volumes）與 §20.5／§20.15 把 Database、 Photos、Reports 三者並列為「至少需要持久化」；§22A.10（Rollback）另要求 Storage Backup Strategy。三處沒有任何一處把「資料庫＋照片＋報表必須一致備份」逐字寫在同一句話裡——這是來源**缺漏**，不是兩條互相矛盾的規則。

**目前暫定**：[PR-12](02-principles.md#pr-12) 暫採整合範圍為準，待團隊確認。

**誰決定、何時**：團隊；時間未指定。

**影響的原則**：[PR-12](02-principles.md#pr-12)。

**依據**：架構基準 §20.5、§20.15、§22.12、§22A.10、§23


<a id="g-11"></a>

### G-11：報告的 Phase E 排序容易誤導 MVP 範圍（已決定）

**為什麼要先決定**：§20.21 把 Version / Issue Control 排在報告實作 Phase E；§30 Phase 9（架構基準原 Phase 9、現行路線圖 Phase 8），卻要求 MVP 保存部分版本與快照資料。需要明確區分最低治理資料和完整簽核流程。

**選項**：§20.21 Phase E 含 Document No、Revision、Status、Snapshot、Approval、Issue；§30 Phase 9（架構基準原 Phase 9、現行路線圖 Phase 8）明定報告範本版本、文件編號、版次、產製者與時間、DOCX／PDF 儲存鍵、資料快照及 SHA-256。後者沒有要求完整 Approval／Issue 流程，§15 與 §20.12 容許先簡化。

**裁定**：視為已由 [KD-57](03-decisions-and-stack.md#kd-57) 回答：MVP 保留最低治理資料，核發不需送審，完整簽核流程之後再加。報告其餘待定欄位與呈現需求依 [OQ-07](#oq-07)。

**目前暫定**：無。

**誰決定、何時**：維護者依負責人授權決定（2026-10-04，#388），負責人可推翻；核發不需送審與最低治理資料見 [KD-57](03-decisions-and-stack.md#kd-57)。

**影響的原則**：[KD-05](03-decisions-and-stack.md#kd-05)、[PR-06](02-principles.md#pr-06)。

**依據**：架構基準 §15、§20.12、§20.21、§30 Phase 9（架構基準原 Phase 9、現行路線圖 Phase 8）；維護者依負責人授權決定（2026-10-04，#388），負責人可推翻；核發裁定依 [KD-57](03-decisions-and-stack.md#kd-57)。

<a id="gate"></a>
## E. 開工門檻（Domain Model／API 契約凍結前必須裁定）

以下列出 Domain Model 與 API 契約凍結前的裁定狀態；未解除的項目仍須先有單一答案，才能讓不同實作者做出相容實作。

**已裁定、解除擋門檻**（2026-09-28～2026-10-04，見各條目「裁定」段）：

- ~~G-02（Original 的唯一來源）~~：已裁定——不保存原圖，只保存現場版與內業版兩張圖片，見 [G-02](#g-02)（已裁定）。
- ~~G-04（報告選圖／核可）~~：已裁定——現場確認即完成，不需另一位核可者，報表一律用內業版，見 [G-04](#g-04)（已裁定）。
- ~~OQ-06（Result 語意）~~：已裁定（2026-10-03）——查核項次結果分符合、不符合、不適用，並定出各結果的必填內容與實測欄位型別，見 [OQ-06](#oq-06)（已裁定）、[KD-54](03-decisions-and-stack.md#kd-54)。不再擋 `template-system`，也不再因 OQ-06 擋 `completion-validation`（是否另有其他門檻，以[規格索引](../specs/README.md#index)為準）；不符合後的簡易改善追蹤依 [KD-65](03-decisions-and-stack.md#kd-65) 排入 0.7.x（範圍見該決策）。
- ~~OQ-08（權限模型）~~：全公司角色、專案角色、Admin 全權與三大系統權限表已裁定，見 [OQ-08](#oq-08)、[KD-60](03-decisions-and-stack.md#kd-60)；v0.3.0 與 0.5.x 排程見 [KD-67](03-decisions-and-stack.md#kd-67)。
- ~~G-03／OQ-14（照片流程）~~：現場版上傳、後端產生內業版、Online-first 與失敗重送已決定，見 [G-03](#g-03)、[OQ-14](#oq-14)、[KD-61](03-decisions-and-stack.md#kd-61)。
- ~~G-05（Evidence 刪除）~~：任務完成前軟刪除、已核發報告引用照片不可刪、保存期限隨專案，見 [G-05](#g-05)、[KD-62](03-decisions-and-stack.md#kd-62)。
- ~~OQ-17（照片上傳）~~：30 MB 上限、3 次指數退避重試與 UUID 冪等鍵已決定，見 [OQ-17](#oq-17)、[KD-63](03-decisions-and-stack.md#kd-63)。
- ~~OQ-12（影像編輯）~~：MVP 不做對比調整與照片上畫標註，見 [OQ-12](#oq-12)、[KD-64](03-decisions-and-stack.md#kd-64)。
- ~~G-08（Result）~~：Result 欄位已定；改善追蹤依 [KD-65](03-decisions-and-stack.md#kd-65)，報告呈現移至 [OQ-07](#oq-07)。
- ~~G-11（報告治理）~~：最低治理資料與不送審已由 [KD-57](03-decisions-and-stack.md#kd-57) 回答。

**部分裁定，未定部分不擋 MVP 凍結**：

- **[G-01](#g-01)**（Interval 查核間距歸屬，部分裁定）：MVP 方向已定——查驗項目由內業事先給定，不需要 `interval` 欄位，`template-system`／`domain-model` 的 MVP 凍結範圍不需要為 interval 保留欄位。未定的部分（interval 若作為未來選用功能，歸屬 `Template` 還是 `Inspection Plan`、快照規則如何）只在該功能被提出時才需要裁決，**不**繼續擋目前的 MVP 凍結。

**仍在擋門檻**：

- **[G-06](#g-06)（部分裁定）／[G-07](#g-07)**（報告狀態與版次快照邊界）：核發不需送審、新版取代舊版已定（[KD-57](03-decisions-and-stack.md#kd-57)）；仍需合併出一份唯一、完整的 `Report` 狀態機 （含 `GENERATING`／`GENERATION_FAILED`），並定義 Snapshot 的確切時間點與 `DRAFT` 階段是否就地覆寫。

[README.md](README.md) 亦連結至本節；規劃 Domain Model／API Specification 前，請先逐項確認以上各則是否已有團隊裁定的答案。本節的「凍結」對應規格文件的「已凍結」狀態，以及「部分凍結」規格標頭列出的凍結範圍（見 [docs/specs/README.md](../specs/README.md)）；門檻未裁定前，確認與門檻無關的實體得先凍結，其餘維持草稿（依 [OQ-22](#oq-22) 的裁定；做法見 [docs/specs/README.md 部分凍結](../specs/README.md#partial-freeze)）。

此處「API 契約」指資源層端點契約（各功能規格與 `domain-model` 定義的資源、欄位與端點），不含只定義跨端點共用慣例（路徑前綴、內容型別、錯誤 envelope、分頁、時間格式、ID 表示法等）的 `api-conventions`（依據：負責人決定，PR #30，2026-09-26）。
