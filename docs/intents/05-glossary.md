# 名詞表（Glossary）

領域名詞、對應的英文系統實體名、定義，以及它與其他名詞的關聯。凡是原文以中文表達的概念，第一次出現
時保留其來源用語；系統實體名稱一律使用英文（例如 `Inspection Task`、`Evidence`），符合原始碼與資料庫
中的實際命名。

## 「work order」對照說明

GitHub Issue 上使用的非正式用語 **work order**，在架構基準文件中沒有獨立的實體對應；它實際指的是
**`Inspection Task`（查核任務）**——後台建立、指派給現場工程師執行的最小可執行工作單位
（依據：架構基準 §12.8）。撰寫規格或程式碼時請一律使用 `Inspection Task`，不要另外引入 "work order"
作為系統實體名稱，以免與 `Inspection Task` 產生兩套平行詞彙。

## 名詞總表

| 中文名稱 | 英文名稱（系統實體名） | 定義 | 關聯 |
|---|---|---|---|
| 專案 | `Project` | 一項工程查核工作所屬的專案，帶有業務編號 `project_code`（依據：架構基準 §12.2）。 | 是 `Inspection Plan` 的上層對象；`Report` 也歸屬於某個 `Project`。 |
| 查核範本 | `Inspection Template` | 一套查核規則的邏輯名稱（例如「Cable Tray Inspection」），本身不含實際欄位內容（依據：架構基準 §12.3）。 | 底下有多個 `Template Version`；`Template Version` 底下才有 `Template Item`。 |
| 範本版本 | `Template Version` | 某個 `Inspection Template` 在特定時間點的一個固定版本（v1、v2、v3……），版本化以支援歷史追溯（依據：架構基準 §2.5、§12.4）。 | `Inspection Task` 建立時參照某一個 `Template Version`；版本一旦發行不應再被改寫語意。 |
| 範本項目 | `Template Item` | `Template Version` 底下的一個查核項目（有 `sequence`、`title`、`instruction`）（依據：架構基準 §12.5）。 | 底下掛著一或多個 `Evidence Requirement`。 |
| 證據需求 | `Evidence Requirement` | 某個 `Template Item` 要求提供的一項證據定義，例如「PHOTO / LENGTH / required」，含 `type`、`required`、`min_count`、`max_count`（依據：架構基準 §12.6）。 | 是「查核規則即資料」原則（見 PR-09）的具體落實；`Inspection Task` 建立時被複製為 `Task Requirement Snapshot`。 |
| 查核計畫 | `Inspection Plan` | 某個 `Project` 在某一天／某一批的工作，指派給某位 `Inspector`（依據：架構基準 §12.7）。 | 一個 `Inspection Plan` 展開後產生多筆 `Inspection Task`。 |
| 查核任務 | `Inspection Task` | 依 `Inspection Plan` 產生的可執行工作單位，可能對應一個區段／位置（例如「0–10 m」），有自己的狀態機（依據：架構基準 §12.8、§18）。**Issue 上俗稱的「work order」即指此實體**，見上方對照說明。 | 隸屬於某個 `Inspection Plan`；建立時鎖定某個 `Template Version`，並產生自己的 `Task Requirement Snapshot`；完成後可作為 `Report` 的資料來源之一。 |
| 任務需求快照 | `Task Requirement Snapshot`（資料表：`task_requirements`） | `Inspection Task` 建立當下，把當時生效的 `Evidence Requirement` 複製、固定下來的紀錄，含 `source_requirement_id` 回指原始需求（依據：架構基準 §2.5、§12.9）。 | 是 PR-04（歷史不可變）原則的核心資料結構；`Inspection Task` 的完成度檢查與報告，都應讀這張快照，而非目前版本的 `Evidence Requirement`。 |
| 證據 | `Evidence` | 現場工程師針對某個 `Task Requirement Snapshot` 提交的一筆記錄，可能是照片（`storage_key`）或文字（`text_value`）等（依據：架構基準 §12.10）。 | 屬於某個 `Inspection Task` 與某個 `Task Requirement Snapshot`；可以有多個 `Evidence Variant`。 |
| 證據變體 — 原圖 | `Evidence Variant`（`variant_type = ORIGINAL`） | 使用者提交當下的原始檔案，其位元組不得就地覆蓋或修改（依據：架構基準 §13A.2、§13A.4）；刪除、保留期限與軟刪除政策待 G-05 定案。 | 是所有其他 Variant（`EDITED`／`THUMBNAIL`／`REPORT`）回溯的終點；與 `Evidence` 的關係在來源文件中不完全一致，見 [06-open-questions.md](06-open-questions.md) 的「來源內部不一致」G-02；刪除與保留政策見 G-05。 |
| 證據變體 — 編輯版 | `Evidence Variant`（`variant_type = EDITED`） | 現場工程師以縮放／裁切／旋轉／亮度等非破壞式操作，從 `ORIGINAL` 衍生出的版本，保存 `edit_operations_json`（依據：架構基準 §13A.4）。 | 必須可回溯至其 `ORIGINAL`；正式報告得優先使用「已核可」的 `EDITED` 版本（見 §13A.9，惟「已核可」狀態的治理機制屬未定案項目）。 |
| 證據變體 — 縮圖 | `Evidence Variant`（`variant_type = THUMBNAIL`） | 供 Dashboard 快速顯示用的小尺寸版本，避免每次列表都下載原始高解析照片（依據：架構基準 §13.4、§13A.11）。 | 由 `ORIGINAL` 或 `EDITED` 衍生。 |
| 證據變體 — 報告用 | `Evidence Variant`（`variant_type = REPORT`） | 針對 DOCX／PDF 最佳化過的版本（適當解析度、壓縮、色彩模式、頁面尺寸），避免把 10–20 MB 原圖直接塞進文件（依據：架構基準 §13A.11、§20.10）。 | 由 `Report Service` 使用，最終仍須可回溯至 `ORIGINAL`（見 PR-07 端到端可追溯性）。 |
| 儲存鍵 | `storage_key` | 後端以 Evidence／檔案的 UUID 產生、指向實際檔案儲存位置的物件定位符（依據：架構基準 §13.1–13.2）；具體路徑格式尚未定案，見 [06-open-questions.md](06-open-questions.md) G-02。 | 只是「檔案在哪」的內部定位符，**不是**授權憑證，也不是原始檔名或業務編號；不同章節給的儲存鍵範例路徑並不一致，見 G-02。 |
| 原始檔名 | `original_filename` | 使用者裝置上傳照片時的原始檔名（例如 `IMG_1234.jpg`），僅作為附帶 metadata 保存，不作為識別依據（依據：架構基準 §13.2）。 | 與 `storage_key` 是兩個不同欄位，不可混用。 |
| 業務編號 | 例如 `project_code`、`employee_no`、`document_no` | 給人看、可讀的業務識別碼，與系統內部的 `UUID` 是兩件不同的事（依據：架構基準 §11）。 | 一個實體（如 `Project`）同時擁有內部 `UUID` 與對外業務編號；兩者用途不可互相取代。 |
| SHA-256 | `sha256` / `content_sha256` | 檔案或文件內容的雜湊值，用於完整性檢查、重複檔案偵測、備份驗證與歷史追蹤，**不用於**授權判斷（依據：架構基準 §13.3、§20.14）。 | 出現在 `Evidence`、`Evidence Variant`、`Report` 等多處實體上。 |
| 查核報告 / 報表 | `Report` | 一份正式、持久化的產出實體，帶有 `document_no`、`revision`、`status`、DOCX／PDF 儲存鍵與資料快照（依據：架構基準 §20.6）。 | 由某個 `Inspection Plan`（及其底下的 `Inspection Task` / `Evidence`）產製；使用某個 `Report Template Version` 渲染。 |
| 報告範本 | `Report Template` | 業主／標案特定的正式文件版面邏輯名稱（例如「Owner A Inspection Report」）（依據：架構基準 §20.5）。 | 底下有多個 `Report Template Version`；與 `Inspection Template` 是兩套不同的版本體系，不可混淆。 |
| 報告範本版本 | `Report Template Version` | `Report Template` 在特定時間點的固定版面／樣板檔案版本（依據：架構基準 §20.5）。 | 每一份 `Report` 都必須記錄自己使用的是哪一個 `Report Template Version`，確保舊文件不因樣板更新而被重新解釋。 |
| 報告資料快照 | `Data Snapshot`（`data_snapshot_json`） | 產生 `Report` 當下，把所用到的核心查核資料固定下來的紀錄；即使之後現場資料變動，已核發的版次也不受影響（依據：架構基準 §20.7）。 | 是 PR-06（報告即快照實體）的核心資料結構。 |
| Report View Model | `Report View Model` | Report Service 從資料庫組裝出的「渲染用資料模型」，介於原始資料與最終 DOCX／HTML 輸出之間（依據：架構基準 §20.2、§20.21）。 | 由資料庫資料組裝而成；分別餵給 DOCX Template Engine 與 HTML Preview；與 `Data Snapshot` 的確切邊界（是否為同一份資料）屬未定案細節，見 [06-open-questions.md](06-open-questions.md)。 |
| 文件編號 | `document_no` | 正式文件的對外編號（例如 `IF-P001-MEP-INS-00023`），命名規則抽象為「Document Number Policy」，具體規則待定（依據：架構基準 §20.8）。 | 與 `revision` 搭配識別同一份文件的不同版次；具體編碼規則見 [06-open-questions.md](06-open-questions.md)。 |
| 版次 | `revision` | 同一份 `document_no` 底下的版次序號（REV.0、REV.1……），新版次因資料變動而產生，不覆蓋舊版次（依據：架構基準 §20.7–20.8）。 | 與 PR-06「報告即不可覆蓋快照」原則直接對應。 |
| 現場端 UI | `Field UI` | 現場工程師使用的介面，聚焦「今日任務 → 拍照 → 說明 → 完成」，刻意隱藏後台概念（依據：架構基準 §6.1）。 | 與 `Admin UI` 共用同一個 React 專案，以路由區分（見 KD-12）。 |
| 後台 UI | `Admin UI` | 管理者／協調者使用的介面，負責人員、專案、範本、計畫、進度與報告等複雜功能（依據：架構基準 §6.2）。 | 與 `Field UI` 共用同一個 React 專案。 |
| 稽核紀錄 | `audit_logs`（概念，非必然的既有資料表） | 記錄「誰、何時、對哪個 entity、做了什麼、修改前後內容」的完整事件記錄，MVP 不強制要求完整事件溯源，但重要資料至少要有 `created_at`／`created_by` 等欄位（依據：架構基準 §19）。 | 與 PR-08（最低限度稽核）對應；是 §35 列出「延後但不排除」的完整能力之一。 |
