# 未定案議題（Open Questions）

架構基準文件明確留待團隊後續拍板的議題，以及文件內部彼此矛盾、需要團隊選邊站的地方。每一則都附上：
問題本身、為何重要（影響哪些意圖檔案）、目前的預設假設（若來源文件有傾向）、狀態。**目前的預設假設**
一律標註為來源的「傾向」，不是決策——不得把這裡的任何一條當成 [04-key-decisions.md](04-key-decisions.md)
的替代品。

## A. 業務資料與規則待決

### OQ-01　專案（Project）需要哪些正式欄位？

- **為何重要**：影響 [05-glossary.md](05-glossary.md) 的 `Project` 定義與資料模型設計的起點。
- **目前預設假設**：架構基準文件僅給出 `id`／`project_code`／`name`／`location`／`status`／
  `created_at`／`updated_at` 這組最小佔位欄位，並提示未來可能需要 Building／Floor／Area／WBS／
  Contractor 等結構，但明言這是佔位而非定案（依據：架構基準 §12.2、§0、§38 Project）。
- **狀態**：Open。

### OQ-02　人員需要哪些組織與角色欄位？

- **為何重要**：影響 [01-purpose.md](01-purpose.md) 的角色定義與 §17 權限矩陣的完整設計。
- **目前預設假設**：架構基準文件只給出 `employee_no`／`name`／`email`／`role`／`active` 等最小欄位，
  組織層級（例如部門、職稱、承包商歸屬）尚未定義（依據：架構基準 §12.1、§0、§38 User）。
- **狀態**：Open。

### OQ-03　位置（Location）／樓層／區域／WBS 的正式編碼方式？

- **為何重要**：影響 `Inspection Task` 的 `location_text` 等欄位是否需要拆成結構化編碼，以及未來與
  WBS 系統整合的可行性。
- **目前預設假設**：目前僅以自由文字 `location_text` 表示（依據：架構基準 §12.8），是否需要正式的
  棟別／樓層／區域／座標／WBS 編碼尚未決定（依據：架構基準 §0、§38 Location）。
- **狀態**：Open。

### OQ-04　查核對象（工項）如何分類？材料／設備／施工工項的正式分類方式？

- **為何重要**：影響範本（Template）之下的工項分類設計，以及查核規則如何組織。
- **目前預設假設**：架構基準文件未提出具體分類方案，僅提出這是需要團隊討論的問題
  （依據：架構基準 §0、§38 Work Item）。
- **狀態**：Open。

### OQ-05　不同工程類型各自需要哪些正式查核範本？每一查核點需要多少張照片？查核規則的間距
    （interval）欄位歸屬何處？

- **為何重要**：直接影響 `Template Item` / `Evidence Requirement` 的資料模型完整度，也牽動
  [04-key-decisions.md](04-key-decisions.md) KD-03（範本版本化＋任務快照）如何落地。
- **目前預設假設**：架構基準文件只給出「電纜橋架每 10 公尺查核一次，長寬高各一張照片」這類單一範
  例，未定義正式的每種工程材料／工項查核規則，也未定義每一查核點所需的正式照片張數
  （依據：架構基準 §0、§38 Template）。**其中「interval 欄位到底歸屬 Template 還是 Plan 輸入」屬於來
  源內部不一致，見下方 G-01。**
- **狀態**：Open。

### OQ-06　查核結果（Result）是否需要 PASS／FAIL／N/A？是否需要量測值、嚴重度、缺失（Defect）欄位？

- **為何重要**：直接影響 `Evidence` 資料模型、任務完成判定邏輯（PR-01 的伺服器端覆核）、報告版面設
  計（照片旁是否顯示 PASS／FAIL），以及「查核結果語意一旦定案後不能追溯性改寫既有資料」這一條不可延
  後意圖（見 [03-design-principles.md](03-design-principles.md) 不可延後意圖第 8 項）。
- **目前預設假設**：架構基準文件明確列為未定案（「是否需要：PASS/FAIL/N/A？Measurement？Severity？
  Defect？」），且報告章節已經在使用 PASS／FAIL 這類措辭（依據：架構基準 §20.10），形成「用了但沒定
  義」的落差，另見下方 G-08。
- **狀態**：Open。

### OQ-07　正式報表需要哪些欄位？誰簽名？是否需要版次？報表最終版面與簽核流程？

- **為何重要**：影響 [04-key-decisions.md](04-key-decisions.md) KD-05（DOCX/PDF 核心交付物）與
  [05-glossary.md](05-glossary.md) `Report` / `Report Template` 的完整欄位設計。
- **目前預設假設**：架構基準文件已定案「必須有 `document_no`／`revision`／`status`」（見 KD-05、
  KD-06 的報告快照原則），但實際版面、照片排列、簽核欄位內容、業主／標案指定格式，明確留待未來團隊
  與業主／標案規範決定（依據：架構基準 §0、§20.3–20.12、§20.19、§38 Report）。
- **狀態**：Open。

## B. 系統流程與權限待決

### OQ-08　角色權限矩陣（誰能做什麼、在什麼專案範圍內）的正式版本？

- **為何重要**：影響 [01-purpose.md](01-purpose.md) 角色定義的落地細節，以及 PR-01（伺服器端覆核）如
  何實作授權檢查。
- **目前預設假設**：架構基準文件給出一份範例矩陣（ADMIN／COORDINATOR／INSPECTOR／VIEWER 各自可做的
  事），但明言「權限表後續再由團隊正式定案」（依據：架構基準 §17）。
- **狀態**：Open。

### OQ-09　`Inspection Plan`／`Inspection Task`／`Template Version`／`Evidence`／`Report` 各自的完整
    狀態機、刪除／更正／產生失敗如何表示？

- **為何重要**：影響任務完成判定（PR-01）、報告產製失敗重試（見下方 G-06）、以及證據刪除與歷史不可
  變原則（PR-04、PR-05）之間如何協調。
- **目前預設假設**：架構基準文件給出各實體「主要狀態」的骨架（例如 Task：
  PENDING/IN_PROGRESS/COMPLETED，選配 CANCELLED/REOPENED；Plan：
  DRAFT/READY/IN_PROGRESS/COMPLETED/ARCHIVED），但刪除、更正、產生失敗後的例外路徑未完整定義
  （依據：架構基準 §18、§20.6、§20.17）。
- **狀態**：Open。

### OQ-10　`Evidence Variant`（尤其是 `EDITED`）的「核可（Approved）」狀態由誰、依何種流程決定？

- **為何重要**：直接影響 PR-07（可追溯性）與報告優先選用哪一個 Variant 的實作方式；若編輯後就能直接
  上報告而毫無核可流程，可能與 KD-04（非破壞式編輯的證據完整性）的精神產生落差。
- **目前預設假設**：架構基準文件提出報告用照片的優先序為「1. Approved Edited Variant　2. Latest
  Edited Variant　3. Original」，但**沒有**定義任何 Variant 核可紀錄、核可者或核可規則
  （依據：架構基準 §13A.9）。另見下方 G-04。
- **狀態**：Open。

### OQ-11　MVP 需要支援哪幾種報表版型？

- **為何重要**：影響 [02-scope.md](02-scope.md) 的 MVP 範圍界定，以及 Report Service 的 View Model
  Builder 設計是否需要一開始就支援多版型抽換。
- **目前預設假設**：架構基準文件列出至少應預留 8 種版型（查核總表、單一查核項目報告、每日查核報
  告、專案階段性彙整、缺失／NCR 報告、改善前後照片報告、業主指定格式、政府標案指定格式），但明言
  「初期 MVP 不需要全部做」，未指名哪一種是 MVP 必做（依據：架構基準 §20.9）。
- **狀態**：Open。

### OQ-12　現場影像編輯是否含 Contrast（對比）？是否含標註（Annotation）？

- **為何重要**：影響 [02-scope.md](02-scope.md) 的 Phase 6（Photo Upload & Field Evidence Editor）範
  圍認定。
- **目前預設假設**：架構基準文件對 Contrast 的定位前後不完全一致——§13A.1 把 Contrast 列為「可
  選」，語氣上不排除納入第一版；但 §13A.12「第一版 MVP 的建議範圍」明確只列出 Preview／Zoom-Pan／
  Crop／Rotate／Brightness／Reset／Save Edited Variant，把 Contrast 與 Annotation 都放進「第二階段再
  評估」。本文件採較晚、較具體的 §13A.12 為預設假設：**Contrast／Annotation 不在 MVP 範圍**，但這是
  來源文件本身用語不完全一致之處，不是團隊已明確拍板的結論。
- **狀態**：Open（來源用語前後不完全一致；補充發現，不在協作方提供的檢查清單原始 11 條之列）。

## C. 技術與維運待決

### OQ-13　登入機制採 Server-managed Session + HttpOnly Cookie，還是 Short-lived Token in HttpOnly
    Cookie？密碼雜湊演算法是否鎖定 Argon2id？

- **為何重要**：影響 Authentication 模組的實作選擇，以及是否需要額外的 Token 撤銷機制設計。
- **目前預設假設**：架構基準文件把兩者並列為「推薦」與「或經團隊評估採用」，並未鎖定其中一種；密碼
  雜湊僅以「例如 Argon2id」表達傾向。唯一明確禁止的是「將長效 JWT 直接放在 browser localStorage」
  （依據：架構基準 §17）。
- **狀態**：Open。

### OQ-14　Evidence 編輯的最終影像處理，MVP 是否採「Frontend Preview + Backend Render」？

- **為何重要**：影響 KD-04（非破壞式編輯）與 PR-07（可追溯性、產製一致性）如何落地；也影響 Offline
  模式未來銜接的方式。
- **目前預設假設**：架構基準文件把 Frontend Render 與 Backend Render 並列為 Strategy A / Strategy
  B 兩個選項，並比較其優缺點後表示「MVP 可先採 Frontend Preview + Backend Render」，用語是「可先
  採」而非硬性規定（依據：架構基準 §13A.7）。
- **狀態**：Open。

### OQ-15　正式環境採用哪一種 DOCX → PDF 轉換工具／服務？

- **為何重要**：直接影響 KD-05（DOCX/PDF 核心交付物）能否在中文字型、表格、圖片、頁首頁尾、分頁上正
  確運作。
- **目前預設假設**：架構基準文件建議優先方向為「DOCX → LibreOffice Headless／受控 Office Conversion
  Service → PDF」，但明言「實際 Production 採何種轉換器，應在 Pilot 階段以字型／表格／中文／圖片／
  頁首頁尾／頁碼／分頁／簽名欄進行實測後決定」（依據：架構基準 §20.4）。
- **狀態**：Open。

### OQ-16　Python 靜態型別檢查工具採 mypy 還是 pyright？

- **為何重要**：屬於工程規範選擇，影響 CI Lint 設定，但不影響架構決策本身。
- **目前預設假設**：架構基準文件明言「依團隊決定」，未給出傾向（依據：架構基準 §29）。
- **狀態**：Open。

### OQ-17　照片上傳大小上限、失敗重試與冪等（idempotency）語意？

- **為何重要**：影響現場網路品質不佳時的上傳體驗，以及 Evidence 記錄是否可能因重試而重複產生。
- **目前預設假設**：架構基準文件僅以環境變數範例 `MAX_UPLOAD_SIZE_MB=30` 帶過（依據：架構基準
  §22.9），未定義重試或冪等策略；離線佇列與重新連線同步屬於 §35 明確延後的能力。
- **狀態**：Open。

### OQ-18　正式伺服器規格、Staging 環境是否建置、磁碟門檻告警比例、正式環境是否允許建立測試資料？

- **為何重要**：影響 Pilot／Production 部署文件（DEPLOYMENT.md）的具體內容，但不影響本資料夾所述的
  架構原則。
- **目前預設假設**：伺服器規格明言「應由 Pilot 實測資料決定，不要在尚無實測資料前過度估算」
  （依據：架構基準 §22.3）；Staging 環境為「若資源允許」的選配項；磁碟門檻僅以「例如 80%
  warning／90% critical」示意；正式環境是否允許建立測試資料「應由團隊定義」
  （依據：架構基準 §22A.6、§22A.18、§22A.8）。
- **狀態**：Open。

### OQ-19　報告是否需要在文件上標示「照片已調整」？

- **為何重要**：影響報告版面設計與是否需要在 Report View Model 增加對應欄位。
- **目前預設假設**：架構基準文件明言「是否顯示由業主／標案規範決定」，但系統內部至少要記錄
  original／edited、operations、created_by、created_at、hash，供日後稽核需要時完整提出
  （依據：架構基準 §13A.10）。
- **狀態**：Open。

## D. 來源內部不一致（Source-Internal Contradictions）

以下議題不是「尚未討論」，而是架構基準文件在不同章節給出彼此對不上的說法。此處只並陳兩種立場，**不
代為裁決**；團隊應在下一輪資料雛形討論時擇一並記錄理由。

### G-01　Interval（查核間距）欄位歸屬何處，沒有單一權責來源

- **立場 A**：`Interval`（例如「每 10 公尺」）是 `Template` 本身的一部分，與 `Requirements` 並列在同
  一個範本定義下（依據：架構基準 §2.4 範例）。
- **立場 B**：`Interval` 是建立 `Inspection Plan` 時由管理者輸入的參數，與起點／終點一起決定
  Task Generator 如何切分任務（依據：架構基準 §16.2 範例）。
- **為何重要**：`Template Item` / `Evidence Requirement` / `Inspection Plan` / `Inspection Task` 的
  資料表清單中都沒有明確的 `interval` 欄位（依據：架構基準 §12.3–12.9），因此目前無法判斷 interval
  該被快照進 `Task Requirement Snapshot`，還是只存在於 Plan 輸入層。
- **狀態**：Open（來源內部不一致）。

### G-02　原始證據（Original Evidence）被建模了兩次，且儲存鍵範例路徑不一致

- **立場 A**：`evidence` 資料表本身的 `storage_key` 欄位似乎就代表已提交的原始檔案
  （依據：架構基準 §12.10、§13.1 範例路徑 `photos/<project_id>/<task_id>/<evidence_id>.<ext>`）。
- **立場 B**：`evidence_variants` 資料表把 `ORIGINAL` 列為 `variant_type` 的其中一種，暗示原圖應該是
  一筆 Variant 記錄（依據：架構基準 §13A.4、§13A.2 範例路徑 `evidence/abc/original.jpg`）。
- **為何重要**：兩種模型並存會導致「原圖到底是 `evidence.storage_key`，還是
  `evidence_variants` 裡 `variant_type = ORIGINAL` 的那一筆」定義不清，直接影響 PR-05／PR-07 的實
  作；兩處給的儲存鍵路徑格式也不一致。
- **狀態**：Open（來源內部不一致）。

### G-03　現場編輯流程與「Backend Render」策略的先後順序沒有對齊

- **立場 A**：§13A.5 描述的現場流程是「拍照 → 預覽 → 編輯（Zoom/Crop/Rotate/Brightness/Reset）→ 確
  認 → Upload」，暗示編輯發生在上傳之前。
- **立場 B**：§13A.7–13A.8 建議的「Frontend Preview + Backend Render」策略，要求後端先取得已上傳的
  Original Evidence ID，才能依 Edit Operations 產生 Edited Variant；§30 Phase 6 的驗收流程也明寫
  「Upload Original → Backend validation → Storage → Evidence DB record → Generate Edited
  Variant」，即先上傳原圖，編輯結果之後才送出。
- **為何重要**：兩種敘述若同時成立，需要團隊明確定義「使用者何時看到編輯結果」「原圖何時真正上
  傳」「重試與失敗時的行為」，否則實作團隊會依各自理解做出不同的前後端契約。
- **狀態**：Open（來源內部不一致）。

### G-04　「已核可（Approved）」的 Evidence Variant 被引用，卻沒有對應的治理機制

- **立場 A**：§13A.9 報告用照片的優先序明確提到「1. Approved Edited Variant」。
- **立場 B**：全文沒有任何 Variant 核可紀錄、核可者、核可流程或狀態欄位的定義（不像 `Report` 有明確
  的 `report_approvals`，依據：架構基準 §20.12）。
- **為何重要**：若無治理機制，「Approved」在實作上可能等於「Latest」，使得報告可能引用一張未經任何
  審核的編輯照片；也與 OQ-10 直接相關。
- **狀態**：Open（來源內部不一致）。

### G-05　Evidence 的刪除 API 與「原圖永不覆蓋／歷史必須可追溯」的原則需要一套共同政策

- **立場 A**：§15 的 API 範圍明確列出 `DELETE /api/v1/evidence/{id}`。
- **立場 B**：§13A.2／§13A.11／§20.11 都要求原圖不可覆蓋、報告照片必須可回溯至原始 Evidence；一筆已
  被某份已核發 `Report` 引用的 Evidence 若被硬刪除，會直接違反 PR-06／PR-07。
- **為何重要**：需要團隊定義「刪除」在此系統中是否等於軟刪除（soft delete）、是否禁止刪除已被報告引
  用的證據、刪除後的存取與保留期限如何處理。
- **狀態**：Open（來源內部不一致）。

### G-06　`Report` 的狀態清單，在不同章節列出的內容不完全一致

- **立場 A**：§20.6 給出的 `Report Status` 列舉為：DRAFT／GENERATED／UNDER_REVIEW／APPROVED／
  ISSUED／SUPERSEDED／VOID；同一節的 `reports` 資料表範例也沒有列出 `issue_date` 或
  `document_status` 欄位，即使 §20.8 的文字敘述提到這兩個概念。
- **立場 B**：§20.17（Transaction Boundary）為避免「DB 已寫成 GENERATED 但 PDF 實際產生失敗」，另外
  要求 DRAFT → GENERATING → GENERATED 的中間狀態，以及失敗時的 GENERATION_FAILED 狀態，這兩個狀態並
  未出現在 §20.6 的列舉中。
- **為何重要**：需要團隊合併出一份唯一、完整的 `Report` 狀態機，否則交易安全（§20.17 的訴求）與版次
  治理（§20.6–20.8 的訴求）會各自實作出不相容的狀態欄位。
- **狀態**：Open（來源內部不一致）。

### G-07　報告快照的確切時間點與版次邊界仍不夠精確

- **立場 A**：§20.7 明確說「Snapshot」發生在 Report 產生當下，已核發的版次（如 REV.0）不因後續現場
  資料異動而改變，異動後應產生新版次（REV.1）。
- **立場 B**：§20.13、§20.16–20.18 描述的是「DRAFT → GENERATING → GENERATED」的產製流程與 Preview
  機制，但沒有說明：Preview／草稿階段的重新產生是否會就地覆寫同一個 `Report` 實體、DOCX 與 PDF 是否
  一定共用同一份凍結快照、以及「新版次」何時真正取得新的 `Report` id。
- **為何重要**：直接影響 KD-05／PR-06（報告即不可覆蓋快照）在 DRAFT 階段的具體實作邊界。
- **狀態**：Open（來源內部不一致）。

### G-08　查核結果（Result）在報告章節被當作既有資料使用，但其欄位本身仍是未定案項目

- **立場 A**：§20.2（Report 產製架構）把「Results」與「Approval / Signature Metadata」列為 Database
  提供給 Report Service 的既有輸入；§20.10 的照片版面設計範例也直接使用「PASS / FAIL」措辭。
- **立場 B**：§38（Result）明確把「是否需要 PASS/FAIL/N/A？Measurement？Severity？Defect？」列為留待
  團隊討論的未定案項目。
- **為何重要**：報告架構的設計已經預設 Result 資料存在，但 Result 的資料模型本身還沒有定案；這與
  OQ-06 是同一個缺口的兩面，應合併處理，且任何後續定案都要遵守 PR-04 的歷史不可變原則。
- **狀態**：Open（來源內部不一致）。

### G-09　正式部署流程中，「先 Migration 再啟動服務」與「先啟動服務再 Migration」的範例互相矛盾

- **立場 A**：§22.15（Startup / Migration 流程）明訂順序為 Backup → Alembic Migration →
  Start/Restart API → Health Check → Smoke Test，並給出範例
  `docker compose run --rm api alembic upgrade head` 在前、`docker compose up -d` 在後。
- **立場 B**：§22A.16（「一鍵部署的真正定義」）給出的範例卻是
  `docker compose build` → `docker compose up -d` → `docker compose run --rm api alembic upgrade
  head`，migration 反而排在服務啟動之後。
- **為何重要**：兩種順序若混用，可能讓新版服務在 Schema 尚未升級前就先接受請求；
  [03-design-principles.md](03-design-principles.md) PR-13 已採 §22.15 的順序為準，但團隊應明確在
  `DEPLOYMENT.md` 中只保留一種順序，避免依範例各自實作。
- **狀態**：Open（來源內部不一致；本文件 PR-13 暫以 §22.15 為準）。

### G-10　備份範圍在不同章節的敘述廣度不一致

- **立場 A**：§23（Backup）明確要求「照片與 Database 必須視為同一套業務資料」，只點名這兩者需要一致
  對應的備份策略。
- **立場 B**：§22.12（Persistent Volumes）與 §20.5／§20.15 都把 Database、Photos、Reports 三者並列為
  「至少需要持久化」的對象，暗示 Reports（DOCX/PDF 與範本檔案）也應該和資料庫、照片一樣被一致備份，
  但 §23 本身沒有把 Reports 明講進同一句要求裡。
- **為何重要**：[03-design-principles.md](03-design-principles.md) PR-12 採兩處要求的聯集（即備份範
  圍涵蓋 Database、Photos、Reports 三者）作為預設，但這是本文件的整合結果，不是來源文件單一章節的明
  文規定，團隊應確認此聯集是否即為預期範圍。
- **狀態**：Open（來源內部不一致；本文件 PR-12 暫採聯集為準）。

### G-11　Report Phase 排序的措辭可能誤導 MVP 範圍認定

- **立場 A**：§20.21（Report 第一階段實作順序）把「Version / Issue Control」（Document No、Revision、
  Status、Snapshot、Approval、Issue）列為 Report Phase E，排在 Phase A–D（View Model／HTML
  Preview／DOCX Template／PDF）之後，讀起來像是「可以晚一點再做」。
- **立場 B**：§30 Phase 9（Formal Report Delivery）的 MVP 驗收條件明確要求 Report 必須同時保存
  Report Template Version、Document Number、Revision、Generated Time/By、DOCX/PDF Storage Key、
  Data Snapshot、SHA-256，即 Phase E 的內容其實是 MVP「完成」的必要條件，不是可延後的加值功能。
- **為何重要**：若團隊只照 §20.21 的排序表面理解，可能誤把版次／核發治理當成 MVP 之後才做的事，與
  §30 Phase 9 的實際驗收要求牴觸。
- **狀態**：Open（來源內部不一致；本文件的 KD-05／PR-06 採 §30 Phase 9 的驗收要求為準）。
