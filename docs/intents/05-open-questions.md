# 未定案議題（Open Questions）

**這份文件回答**：哪些議題來源文件明確留給團隊後續拍板、文件內部哪些說法互相矛盾或有缺漏，以及本資料夾 （尤其 [02-principles.md](02-principles.md)）為釐清這些落差暫定採用的實作基線。
**什麼時候讀**：規劃 Domain Model／API 之前；遇到「文件沒寫清楚」或「兩處說法對不上」時，先來這裡查有沒有已知的落差紀錄，不要把自己的假設當成既定事實。

「目前暫定」記錄來源傾向或本文件的暫定判讀，**均待團隊確認**。

## A. 業務資料與規則待決

<a id="oq-01"></a>

### OQ-01：專案（Project）需要哪些正式欄位？

**為什麼要先決定**：影響 [04-glossary.md](04-glossary.md) 的 `Project` 定義與資料模型設計的起點。

**選項**：
- 沿用目前的最小佔位欄位。
- 擴充 Building／Floor／Area／WBS／Contractor 等結構。

**目前暫定**：無。架構基準文件僅給出 `id`／`project_code`／`name`／`location`／`status`／ `created_at`／`updated_at` 這組最小佔位欄位，並提示未來可能需要上述結構，但明言這是佔位而非定案。

**誰決定、何時**：未指定。

**影響的原則**：無直接對應的 PR。

**依據**：架構基準 §12.2、§0、§38 Project


<a id="oq-02"></a>

### OQ-02：人員需要哪些組織與角色欄位？

**為什麼要先決定**：影響 [01-overview.md](01-overview.md) 的角色定義與 §17 權限矩陣的完整設計。

**選項**：
- 沿用目前的最小欄位。
- 補上組織層級欄位（部門、職稱、承包商歸屬）。

**目前暫定**：無。架構基準文件只給出 `employee_no`／`name`／`email`／`role`／`active` 等最小欄位，組織層級尚未定義。

**誰決定、何時**：未指定。

**影響的原則**：與 [OQ-08](#oq-08) 權限矩陣屬同一治理缺口。

**依據**：架構基準 §12.1、§0、§38 User


<a id="oq-03"></a>

### OQ-03：位置（Location）／樓層／區域／WBS 的正式編碼方式？

**為什麼要先決定**：影響 `Inspection Task` 的 `location_text` 欄位是否需要拆成結構化編碼，以及未來與 WBS 系統整合的可行性。

**選項**：
- 維持自由文字 `location_text`。
- 改為正式的棟別／樓層／區域／座標／WBS 編碼。

**目前暫定**：維持自由文字 `location_text`（依據：架構基準 §12.8）；是否需要正式編碼尚未決定。

**誰決定、何時**：未指定。

**影響的原則**：無直接對應的 PR。

**依據**：架構基準 §0、§12.8、§38 Location


<a id="oq-04"></a>

### OQ-04：查核對象（工項）如何分類？材料／設備／施工工項的正式分類方式？

**為什麼要先決定**：影響範本（Template）之下的工項分類設計，以及查核規則如何組織。

**選項**：架構基準文件未提出具體分類方案。

**目前暫定**：無，僅提出這是需要團隊討論的問題。

**誰決定、何時**：團隊；時間未指定。

**影響的原則**：與 [OQ-20](#oq-20) 同屬「範圍決策治理」缺口。

**依據**：架構基準 §0、§38 Work Item


<a id="oq-05"></a>

### OQ-05：不同工程類型各自需要哪些正式查核範本？每一查核點需要多少張照片？

**為什麼要先決定**：直接影響 `Template Item` / `Evidence Requirement` 的資料模型完整度，也牽動 [KD-03](03-decisions-and-stack.md#kd-03)（範本版本化＋任務快照）如何落地。查核規則的間距 （interval）欄位歸屬何處另屬來源內部不一致，見 [G-01](#g-01)。

**選項**：架構基準文件只給出「電纜橋架每 10 公尺查核一次，長寬高各一張照片」這類單一範例，未定義正式的每種工程材料／工項查核規則，也未定義每一查核點所需的正式照片張數。

**目前暫定**：無。

**誰決定、何時**：未指定。

**影響的原則**：[KD-03](03-decisions-and-stack.md#kd-03)；interval 歸屬另見 [G-01](#g-01)。

**依據**：架構基準 §0、§38 Template


<a id="oq-06"></a>

### OQ-06：查核結果（Result）是否需要 PASS／FAIL／N/A？是否需要量測值、嚴重度、缺失（Defect）欄位？

**為什麼要先決定**：直接影響 `Evidence` 資料模型、任務完成判定邏輯（[PR-01](02-principles.md#pr-01) 的伺服器端覆核）、報告版面設計（照片旁是否顯示 PASS／FAIL），以及「查核結果語意一旦定案後不能追溯性改寫既有資料」這一條不可延後意圖（見 [02-principles.md](02-principles.md#costly-to-retrofit-intents) 第 8 項）。

**選項**：
- 定義 PASS/FAIL/N/A ＋ Measurement ＋ Severity ＋ Defect 欄位。
- 維持目前簡化、不擴充欄位。

**目前暫定**：無。架構基準文件明確列為未定案，但報告章節已經在使用 PASS／FAIL 這類措辭（依據：架構基準 §20.10），形成「用了但沒定義」的落差，另見 [G-08](#g-08)。

**誰決定、何時**：未指定。

**影響的原則**：[PR-01](02-principles.md#pr-01)、[PR-04](02-principles.md#pr-04) 不可延後意圖第 8 項；另見 [G-08](#g-08)。

**依據**：架構基準 §20.10、§38 Result


<a id="oq-07"></a>

### OQ-07：正式報表需要哪些欄位？誰簽名？是否需要版次？報表最終版面與簽核流程？

**為什麼要先決定**：影響 [KD-05](03-decisions-and-stack.md#kd-05)（DOCX/PDF 核心交付物）與 [04-glossary.md](04-glossary.md) `Report` / `Report Template` 的完整欄位設計。

**選項**：報表版面、照片排列、簽核欄位內容、業主／標案指定格式有多種可能形式，留待未來團隊與業主／標案規範決定。

**目前暫定**：§30 Phase 9 要求保存文件編號、版次、範本版本、產製者與時間、DOCX／PDF 儲存鍵、資料快照及 SHA-256，見 [KD-05](03-decisions-and-stack.md#kd-05) 與 [PR-06](02-principles.md#pr-06)。§20.6 建議 `status` 欄位；完整簽核與核發流程仍待決。

**誰決定、何時**：業主／標案規範與團隊；時間未指定。

**影響的原則**：[KD-05](03-decisions-and-stack.md#kd-05)、[PR-06](02-principles.md#pr-06)。

**依據**：架構基準 §0、§15、§20.3–20.12、§20.19、§20.21、§38 Report


<a id="oq-20"></a>

### OQ-20：由誰、何時決定擴大 MVP 的 Evidence Type 範圍？

**為什麼要先決定**：直接影響 [01-overview.md](01-overview.md)「MVP 的證據類型邊界」一節如何落地，以及 `EvidenceRequirement.type` 實際支援哪些值。

**選項**：
- 維持 MVP 僅 `PHOTO`／`TEXT`。
- 擴大支援 `NUMBER`／`BOOLEAN`／`SIGNATURE`／`DOCUMENT`。

**目前暫定**：MVP **可**只實作 `PHOTO`／`TEXT`，其餘四種列為資料模型預留欄位，但未指名由誰、在什麼時間點決定是否啟用。

**誰決定、何時**：未指定——這本身就是本題要問的治理缺口。

**影響的原則**：與 [OQ-04](#oq-04)（工項分類）、[OQ-06](#oq-06)（Result 語意）同屬「範圍決策治理」缺口的不同面向。

**依據**：架構基準 §12.6、§38 Evidence/Result

## B. 系統流程與權限待決

<a id="oq-08"></a>

### OQ-08：角色權限矩陣（誰能做什麼、在什麼專案範圍內）的正式版本？

**為什麼要先決定**：影響 [01-overview.md](01-overview.md) 角色定義的落地細節，以及 [PR-01](02-principles.md#pr-01)（伺服器端覆核）如何實作授權檢查。

**選項**：沿用範例矩陣（ADMIN／COORDINATOR／INSPECTOR／VIEWER 各自可做的事）／團隊調整後的正式版本。

**目前暫定**：架構基準文件給出一份範例矩陣，但明言「權限表後續再由團隊正式定案」。

**誰決定、何時**：團隊；時間未指定。

**影響的原則**：[PR-01](02-principles.md#pr-01)。

**依據**：架構基準 §17


<a id="oq-09"></a>

### OQ-09：`Inspection Plan`／`Inspection Task`／`Template Version`／`Evidence`／`Report` 各自的完整狀態機，刪除／更正／產生失敗如何表示？

**為什麼要先決定**：影響任務完成判定（[PR-01](02-principles.md#pr-01)）、報告產製失敗重試（見 [G-06](#g-06)）、以及證據刪除與歷史不可變原則（[PR-04](02-principles.md#pr-04)、 [PR-05](02-principles.md#pr-05)）之間如何協調。

**選項**：架構基準文件給出各實體「主要狀態」的骨架，例外路徑（刪除、更正、產生失敗）未完整定義。

**目前暫定**：Task：PENDING/IN_PROGRESS/COMPLETED，選配 CANCELLED/REOPENED；Plan： DRAFT/READY/IN_PROGRESS/COMPLETED/ARCHIVED。

**誰決定、何時**：未指定。

**影響的原則**：[PR-01](02-principles.md#pr-01)、[PR-04](02-principles.md#pr-04)、 [PR-05](02-principles.md#pr-05)；另見 [G-06](#g-06)。

**依據**：架構基準 §18、§20.6、§20.17


<a id="oq-10"></a>

### OQ-10：`Evidence Variant`（尤其是 `EDITED`）的「核可（Approved）」狀態由誰、依何種流程決定？

**為什麼要先決定**：直接影響 [PR-07](02-principles.md#pr-07)（可追溯性）與報告優先選用哪一個 Variant 的實作方式；若編輯後就能直接上報告而毫無核可流程，可能與 `KD-04`（非破壞式編輯的證據完整性）的精神產生落差。

**選項**：無明列選項，見 [G-04](#g-04)。

**目前暫定**：報告用照片的優先序為「1. Approved Edited Variant　2. Latest Edited Variant　3. Original」，但沒有定義任何 Variant 核可紀錄、核可者或核可規則。

**誰決定、何時**：未指定。

**影響的原則**：[PR-07](02-principles.md#pr-07)、[KD-04](03-decisions-and-stack.md#kd-04)；另見 [G-04](#g-04)。

**依據**：架構基準 §13A.9


<a id="oq-11"></a>

### OQ-11：MVP 需要支援哪幾種報表版型？

**為什麼要先決定**：影響 [01-overview.md](01-overview.md) 的 MVP 範圍界定，以及 Report Service 的 View Model Builder 設計是否需要一開始就支援多版型抽換。

**選項**：查核總表、單一查核項目報告、每日查核報告、專案階段性彙整、缺失／NCR 報告、改善前後照片報告、業主指定格式、政府標案指定格式（共 8 種）。

**目前暫定**：至少應預留上述 8 種版型，但明言「初期 MVP 不需要全部做」，未指名哪一種是 MVP 必做。

**誰決定、何時**：未指定。

**影響的原則**：無直接對應的 PR。

**依據**：架構基準 §20.9


<a id="oq-12"></a>

### OQ-12：現場影像編輯是否含 Contrast（對比）？是否含標註（Annotation）？

**為什麼要先決定**：影響 [01-overview.md](01-overview.md) 的 Phase 6（Photo Upload & Field Evidence Editor）範圍認定。

**選項**：納入 MVP／延後至第二階段再評估。

**目前暫定**：架構基準文件對 Contrast 的定位前後不完全一致——§13A.1 把 Contrast 列為「可選」，語氣上不排除納入第一版；但 §13A.12「第一版 MVP 的建議範圍」明確只列出 Preview／Zoom-Pan／Crop／Rotate／ Brightness／Reset／Save Edited Variant，把 Contrast 與 Annotation 都放進「第二階段再評估」。本文件採較晚、較具體的 §13A.12 為預設假設：**Contrast／Annotation 不在 MVP 範圍**，但這是來源文件本身用語不完全一致的地方，不是團隊已拍板的結論。

**誰決定、何時**：未指定。

**影響的原則**：無直接對應的 PR。

**依據**：架構基準 §13A.1、§13A.12

## C. 技術與維運待決

<a id="oq-13"></a>

### OQ-13：登入機制採 Server-managed Session + HttpOnly Cookie，還是 Short-lived Token in HttpOnly Cookie？密碼雜湊演算法是否鎖定 Argon2id？

**為什麼要先決定**：影響 Authentication 模組的實作選擇，以及是否需要額外的 Token 撤銷機制設計。

**選項**：Server-managed Session + HttpOnly Cookie／Short-lived Token in HttpOnly Cookie；密碼雜湊 Argon2id／其他演算法。

**目前暫定**：架構基準文件把兩者並列為「推薦」與「或經團隊評估採用」，並未鎖定其中一種；密碼雜湊僅以 「例如 Argon2id」表達傾向。唯一明確建議避免的是「將長效 JWT 直接放在 browser localStorage」。

**誰決定、何時**：團隊；時間未指定。

**影響的原則**：無直接對應的 PR。

**依據**：架構基準 §17


<a id="oq-14"></a>

### OQ-14：Evidence 編輯的最終影像處理，MVP 是否採「Frontend Preview + Backend Render」？

**為什麼要先決定**：影響 `KD-04`（非破壞式編輯）與 [PR-07](02-principles.md#pr-07)（可追溯性、產製一致性）如何落地；也影響 Offline 模式未來銜接的方式。

**選項**：Strategy A（Frontend Render）／Strategy B（Backend Render）。

**目前暫定**：架構基準文件把兩者並列為選項，並比較優缺點後表示「MVP 可先採 Frontend Preview + Backend Render」，用語是「可先採」而非硬性規定。

**誰決定、何時**：未指定。

**影響的原則**：[KD-04](03-decisions-and-stack.md#kd-04)、[PR-07](02-principles.md#pr-07)；另見 [G-03](#g-03)。

**依據**：架構基準 §13A.7–13A.8


<a id="oq-15"></a>

### OQ-15：正式環境採用哪一種 DOCX → PDF 轉換工具／服務？

**為什麼要先決定**：直接影響 [KD-05](03-decisions-and-stack.md#kd-05)（DOCX/PDF 核心交付物）能否在中文字型、表格、圖片、頁首頁尾、分頁上正確運作。

**選項**：DOCX → LibreOffice Headless／受控 Office Conversion Service → PDF／其他轉換工具。

**目前暫定**：建議優先方向為「DOCX → LibreOffice Headless／受控 Office Conversion Service → PDF」，但明言「實際 Production 採何種轉換器，應在 Pilot 階段以字型／表格／中文／圖片／頁首頁尾／頁碼／分頁／簽名欄進行實測後決定」。

**誰決定、何時**：團隊；Pilot 階段實測後。

**影響的原則**：[KD-05](03-decisions-and-stack.md#kd-05)。

**依據**：架構基準 §20.4


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

### OQ-17：照片上傳大小上限、失敗重試與冪等（idempotency）語意？

**為什麼要先決定**：影響現場網路品質不佳時的上傳體驗，以及 Evidence 記錄是否可能因重試而重複產生。

**選項**：無明列選項，待補重試與冪等策略。

**目前暫定**：僅以環境變數範例 `MAX_UPLOAD_SIZE_MB=30` 帶過，未定義重試或冪等策略；離線佇列與重新連線同步屬於 §35 明確延後的能力。

**誰決定、何時**：未指定。

**影響的原則**：無。

**依據**：架構基準 §22.9、§35


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

**裁定**：允許部分凍結（選項 B1），第一批只凍結 `User`、`Project`。`Inspection Template`、`Template Version` 等 [G-01](#g-01) 裁定、並說清楚立場 A 的 `Template` 指哪一層之後再凍結。理由：這兩個實體本來就同時列在 P3 `template-system`，而 P3 也被 G-01 擋住，延後的實際成本很小；Phase 1 因此分成兩段（見 [01-overview.md](01-overview.md)）。怎麼確認實體與門檻無關、規格內怎麼標示、已凍結的實體之後被裁定牽動時怎麼處理，見 [docs/specs/README.md 部分凍結](../specs/README.md#partial-freeze)；討論見 [#46](https://github.com/speko-tw/inspect-flow/issues/46)。

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

### G-01：Interval（查核間距）欄位歸屬何處，沒有單一權責來源

**為什麼要先決定**：`Template Item` / `Evidence Requirement` / `Inspection Plan` / `Inspection Task` 的資料表清單中都沒有明確的 `interval` 欄位，因此目前無法判斷 interval 該被快照進 `Task Requirement Snapshot`，還是只存在於 Plan 輸入層。

**選項**：
- **立場 A**：`Interval`（例如「每 10 公尺」）是 `Template` 本身的一部分，與 `Requirements` 並列在 同一個範本定義下（依據：架構基準 §2.4 範例）。
- **立場 B**：`Interval` 是建立 `Inspection Plan` 時由管理者輸入的參數，與起點／終點一起決定 Task Generator 如何切分任務（依據：架構基準 §16.2 範例）。

**目前暫定**：無（來源內部不一致，尚未裁決）。

**誰決定、何時**：未指定。

**影響的原則**：[PR-09](02-principles.md#pr-09)；[OQ-05](#oq-05) 因此無法確定 Template Item / Evidence Requirement 的資料模型完整度。

**依據**：架構基準 §2.4、§12.3–12.9、§16.2


<a id="g-02"></a>

### G-02：原始證據（Original Evidence）被建模了兩次，且儲存鍵範例路徑不一致

**為什麼要先決定**：兩種模型並存會導致「原圖到底是 `evidence.storage_key`，還是 `evidence_variants` 裡 `variant_type = ORIGINAL` 的那一筆」定義不清，直接影響 [PR-05](02-principles.md#pr-05)／[PR-07](02-principles.md#pr-07) 的實作；兩處給的儲存鍵路徑格式也不一致。

**選項**：
- **立場 A**：`evidence` 資料表本身的 `storage_key` 欄位似乎就代表已提交的原始檔案（依 據：架構基準 §12.10、§13.1 範例路徑 `photos/<project_id>/<task_id>/<evidence_id>.<ext>`）。
- **立場 B**：`evidence_variants` 資料表把 `ORIGINAL` 列為 `variant_type` 的其中一種，暗示原圖應該是 一筆 Variant 記錄（依據：架構基準 §13A.4、§13A.2 範例路徑 `evidence/abc/original.jpg`）。

**目前暫定**：無。

**誰決定、何時**：未指定。

**影響的原則**：[PR-05](02-principles.md#pr-05)、[PR-07](02-principles.md#pr-07)。

**依據**：架構基準 §12.10、§13.1、§13A.2、§13A.4


<a id="g-03"></a>

### G-03：現場編輯流程與「Backend Render」策略的先後順序沒有對齊

**為什麼要先決定**：兩種敘述若同時成立，需要團隊明確定義「使用者何時看到編輯結果」「原圖何時真正上傳」「重試與失敗時的行為」，否則實作團隊會依各自理解做出不同的前後端契約。

**選項**：
- **立場 A**：§13A.5 描述的現場流程是「拍照 → 預覽 → 編輯（Zoom/Crop/Rotate/Brightness/Reset）→ 確 認 → Upload」，暗示編輯發生在上傳之前。
- **立場 B**：§13A.7–13A.8 建議的「Frontend Preview + Backend Render」策略，要求後端先取得已上傳的 Original Evidence ID，才能依 Edit Operations 產生 Edited Variant；§30 Phase 6 的驗收流程也明寫 「Upload Original → Backend validation → Storage → Evidence DB record → Generate Edited Variant」，即先上傳原圖，編輯結果之後才送出。

**目前暫定**：無。

**誰決定、何時**：未指定。

**影響的原則**：[OQ-14](#oq-14)。

**依據**：架構基準 §13A.5、§13A.7–13A.8、§30 Phase 6


<a id="g-04"></a>

### G-04：「已核可（Approved）」的 Evidence Variant 被引用，卻沒有對應的治理機制

**為什麼要先決定**：若無治理機制，「Approved」在實作上可能等於「Latest」，使得報告可能引用一張未經任何審核的編輯照片；也與 [OQ-10](#oq-10) 直接相關。

**選項**：
- **立場 A**：§13A.9 報告用照片的優先序明確提到「1. Approved Edited Variant」。
- **立場 B**：全文沒有任何 Variant 核可紀錄、核可者、核可流程或狀態欄位的定義（不像 `Report` 有明確 的 `report_approvals`，依據：架構基準 §20.12）。

**目前暫定**：無。

**誰決定、何時**：未指定。

**影響的原則**：[OQ-10](#oq-10)。

**依據**：架構基準 §13A.9、§20.12


<a id="g-05"></a>

### G-05：Evidence 的刪除 API 與「原圖永不覆蓋／歷史必須可追溯」的原則需要一套共同政策

**為什麼要先決定**：需要團隊定義「刪除」在此系統中是否等於軟刪除（soft delete）、是否禁止刪除已被報告引用的證據、刪除後的存取與保留期限如何處理。

**選項**：
- **立場 A**：§15 的 API 範圍明確列出 `DELETE /api/v1/evidence/{id}`。
- **立場 B**：§13A.2／§13A.11／§20.11 都要求原圖不可覆蓋、報告照片必須可回溯至原始 Evidence；一筆已 被某份已核發 `Report` 引用的 Evidence 若被硬刪除，會直接違反 [PR-06](02-principles.md#pr-06)／ [PR-07](02-principles.md#pr-07)。

**目前暫定**：無。

**誰決定、何時**：未指定。

**影響的原則**：[PR-05](02-principles.md#pr-05)、[PR-06](02-principles.md#pr-06)、 [PR-07](02-principles.md#pr-07)。

**依據**：架構基準 §13A.2、§13A.11、§15、§20.11


<a id="g-06"></a>

### G-06：`Report` 的狀態清單，在不同章節列出的內容不完全一致

**為什麼要先決定**：需要團隊合併出一份唯一、完整的 `Report` 狀態機，否則交易安全（§20.17 的訴求）與版次治理（§20.6–20.8 的訴求）會各自實作出不相容的狀態欄位。

**選項**：
- **立場 A**：§20.6 給出的 `Report Status` 列舉為：DRAFT／GENERATED／UNDER_REVIEW／APPROVED／ ISSUED／SUPERSEDED／VOID；同一節的 `reports` 資料表範例也沒有列出 `issue_date` 或 `document_status` 欄位，即使 §20.8 的文字敘述提到這兩個概念。
- **立場 B**：§20.17（Transaction Boundary）為避免「DB 已寫成 GENERATED 但 PDF 實際產生失敗」，另外 要求 DRAFT → GENERATING → GENERATED 的中間狀態，以及失敗時的 GENERATION_FAILED 狀態，這兩個狀態並未出現在 §20.6 的列舉中。

**目前暫定**：無。

**誰決定、何時**：未指定。

**影響的原則**：[PR-06](02-principles.md#pr-06)、[PR-15](02-principles.md#pr-15)；另見 [OQ-09](#oq-09)。

**依據**：架構基準 §20.6–20.8、§20.17


<a id="g-07"></a>

### G-07：報告快照的確切時間點與版次邊界仍不夠精確

**為什麼要先決定**：直接影響 `KD-05`／[PR-06](02-principles.md#pr-06)（報告即不可覆蓋快照）在 DRAFT 階段的具體實作邊界。

**選項**：
- **立場 A**：§20.7 明確說「Snapshot」發生在 Report 產生當下，已核發的版次（如 REV.0）不因後續現場 資料異動而改變，異動後應產生新版次（REV.1）。
- **立場 B**：§20.13、§20.16–20.18 描述的是「DRAFT → GENERATING → GENERATED」的產製流程與 Preview 機制，但沒有說明：Preview／草稿階段的重新產生是否會就地覆寫同一個 `Report` 實體、DOCX 與 PDF 是否一定共用同一份凍結快照、以及「新版次」何時真正取得新的 `Report` id。

**目前暫定**：無。

**誰決定、何時**：未指定。

**影響的原則**：[KD-05](03-decisions-and-stack.md#kd-05)、[PR-06](02-principles.md#pr-06)。

**依據**：架構基準 §20.7、§20.13、§20.16–20.18


<a id="g-08"></a>

### G-08：查核結果（Result）在報告章節被當作既有資料使用，但其欄位本身仍是未定案項目

**為什麼要先決定**：報告架構的設計已經預設 Result 資料存在，但 Result 的資料模型本身還沒有定案；這與 [OQ-06](#oq-06) 是同一個缺口的兩面，應合併處理，且任何後續定案都要遵守 [PR-04](02-principles.md#pr-04) 的歷史不可變原則。

**選項**：
- **立場 A**：§20.2（Report 產製架構）把「Results」與「Approval / Signature Metadata」列為 Database 提供給 Report Service 的既有輸入；§20.10 的照片版面設計範例也直接使用「PASS / FAIL」措辭。
- **立場 B**：§38（Result）明確把「是否需要 PASS/FAIL/N/A？Measurement？Severity？Defect？」列為留待 團隊討論的未定案項目。

**目前暫定**：無。

**誰決定、何時**：未指定。

**影響的原則**：[OQ-06](#oq-06)、[PR-04](02-principles.md#pr-04)。

**依據**：架構基準 §20.2、§20.10、§38


<a id="g-09"></a>

### G-09：部署範例的 migration 與服務啟動順序相反

**為什麼要先決定**：若 API 在 migration 完成前接收請求，初次部署可能缺資料表，升級部署可能遇到舊 Schema。[PR-13](02-principles.md#pr-13) 的安全閘點需要團隊確認。

**選項**：§22.15 規定 Backup → Alembic Migration → Start/Restart API → Health Check → Smoke Test；§22.16 範例卻是 `docker compose build` → `docker compose up -d` → `docker compose run --rm api alembic upgrade head`。來源沒有說兩段分別適用初次或升級部署。

**目前暫定**：[PR-13](02-principles.md#pr-13) 採 §22.15 的順序；無論初次或升級部署，都等 migration 完成才讓新版 API 接流量。

**誰決定、何時**：團隊；時間未指定。

**影響的原則**：[PR-13](02-principles.md#pr-13)。

**依據**：架構基準 §22.15–22.16

<a id="g-10"></a>

### G-10：來源缺漏：備份範圍（並非互相矛盾，而是來源未把三者寫在同一句）

**為什麼要先決定**：[PR-12](02-principles.md#pr-12) 為此補上一個整合決策：備份範圍涵蓋 Database、範本檔案、原圖與衍生照片、已核發 DOCX／PDF，並定義一致性邊界；但這是本文件的整合結果，不是來源文件單一章節的明文規定，團隊應確認此整合範圍是否即為預期範圍。

**選項**（缺漏說明，非對立立場）：§23（Backup）明確要求「照片與 Database 必須視為同一套業務資料」， 只點名這兩者需要一致對應的備份策略；§22.12（Persistent Volumes）與 §20.5／§20.15 把 Database、 Photos、Reports 三者並列為「至少需要持久化」；§22A.10（Rollback）另要求 Storage Backup Strategy。三處沒有任何一處把「資料庫＋照片＋報表必須一致備份」逐字寫在同一句話裡——這是來源**缺漏**，不是兩條互相矛盾的規則。

**目前暫定**：[PR-12](02-principles.md#pr-12) 暫採整合範圍為準，待團隊確認。

**誰決定、何時**：團隊；時間未指定。

**影響的原則**：[PR-12](02-principles.md#pr-12)。

**依據**：架構基準 §20.5、§20.15、§22.12、§22A.10、§23


<a id="g-11"></a>

### G-11：報告的 Phase E 排序容易誤導 MVP 範圍

**為什麼要先決定**：§20.21 把 Version / Issue Control 排在報告實作 Phase E；§30 Phase 9 卻要求 MVP 保存部分版本與快照資料。需要明確區分最低治理資料和完整簽核流程。

**選項**：§20.21 Phase E 含 Document No、Revision、Status、Snapshot、Approval、Issue；§30 Phase 9 明定範本版本、文件編號、版次、產製者與時間、DOCX／PDF 儲存鍵、資料快照及 SHA-256。後者沒有要求完整 Approval／Issue 流程，§15 與 §20.12 容許先簡化。

**目前暫定**：[KD-05](03-decisions-and-stack.md#kd-05) 與 [PR-06](02-principles.md#pr-06) 採 §30 Phase 9 的最低治理資料；完整簽核與核發流程見 [OQ-07](#oq-07)。

**誰決定、何時**：團隊；時間未指定。

**影響的原則**：[KD-05](03-decisions-and-stack.md#kd-05)、[PR-06](02-principles.md#pr-06)。

**依據**：架構基準 §15、§20.12、§20.21、§30 Phase 9

<a id="gate"></a>
## E. 開工門檻（Domain Model／API 契約凍結前必須裁定）

以下議題**必須**在 Domain Model 與 API 契約凍結之前，先由團隊裁定出單一答案；它們目前都已在本檔中留有紀錄，但尚沒有能讓兩組實作者各自做出相容實作的單一結論。

- **[G-01](#g-01)**（Interval 查核間距歸屬）：interval 該存在 `Template`／`Requirement`，還是只存在 於 `Inspection Plan` 輸入層，決定 `Task Requirement Snapshot` 是否需要快照這個欄位。
- **[G-02](#g-02)**（Original 的唯一來源）：原圖到底是 `evidence.storage_key` 本身，還是 `evidence_variants` 裡 `variant_type = ORIGINAL` 的那一筆，決定 PR-05／PR-07 的資料模型如何落地。
- **[G-03](#g-03)**（原圖上傳與編輯時序）：使用者何時看到編輯結果、原圖何時真正上傳、重試與失敗時的 行為。
- **[G-04](#g-04)**（報告選圖／核可）：「Approved Edited Variant」的核可者、核可流程與狀態欄位如何定 義，否則「Approved」在實作上可能等於「Latest」。
- **[G-05](#g-05)**（刪除與保留）：`Evidence` 的 `DELETE` API 與「原圖不可覆蓋、報告照片必須可追溯」 如何共存，是否為軟刪除、是否禁止刪除已被報告引用的證據。
- **[G-06](#g-06)／[G-07](#g-07)**（報告狀態與版次快照邊界）：合併出一份唯一、完整的 `Report` 狀態機 （含 `GENERATING`／`GENERATION_FAILED`），並定義 Snapshot 的確切時間點與 `DRAFT` 階段是否就地覆寫。
- **[OQ-06](#oq-06)**（Result 對完成判定的影響）：查核結果是否需要 PASS/FAIL/N/A、量測值、嚴重度、缺 失欄位，直接影響任務完成判定邏輯與報告版面設計。

[README.md](README.md) 亦連結至本節；規劃 Domain Model／API Specification 前，請先逐項確認以上各則是否已有團隊裁定的答案。本節的「凍結」對應規格文件的「已凍結」狀態（見 [docs/specs/README.md](../specs/README.md)）；門檻未裁定前，確認與門檻無關的實體得先凍結，其餘維持草稿（依 [OQ-22](#oq-22) 的裁定；做法見 [docs/specs/README.md 部分凍結](../specs/README.md#partial-freeze)）。

此處「API 契約」指資源層端點契約（各功能規格與 `domain-model` 定義的資源、欄位與端點），不含只定義跨端點共用慣例（路徑前綴、內容型別、錯誤 envelope、分頁、時間格式、ID 表示法等）的 `api-conventions`（依據：負責人決定，PR #30，2026-09-26）。
