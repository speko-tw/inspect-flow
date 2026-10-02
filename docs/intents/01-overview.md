# 系統總覽（Overview）

**這份文件回答**：InspectFlow 要解決什麼問題、服務誰、第一階段做到哪裡、整體架構長什麼樣子？
**什麼時候讀**：第一次接觸系統，或規劃功能與確認範圍時。

## 目的

InspectFlow 要避免照片、查核項目與說明分散，造成證據難核對、進度難掌握、報告難產出的問題。來源沒有調查現行流程，本段描述的是系統要解決的風險。系統串起規劃、現場查核、後端完成驗證、儀表板與正式報告（依據：架構基準 §1）。

`InspectFlow` 這個名稱由 `Inspection`（查核）與 `Flow`（流程）組合而成，代表本系統管理的是完整的工程查核流程，而非單純的拍照工具（依據：架構基準 §0.1）。

### 系統定位與使用對象

InspectFlow 是**工程查核系統**，涵蓋公共與私人工程的施工查驗、材料設備（進料）查驗等（依據：負責人裁定（[#313](https://github.com/speko-tw/inspect-flow/issues/313) 追加裁定第 15～18 題，2026-10-02），見 [KD-51](03-decisions-and-stack.md#kd-51)）。品管分兩級，長期都用本系統，並在同一系統串起來：

| 層級 | 誰檢查 | 本系統的位置 |
|---|---|---|
| 一級：自主檢查 | 廠商 | 長期目標；資料結構預留「自主檢查／抽查」的區分與「由誰檢查」，MVP 不以此為核心。 |
| 二級：抽查 | 甲方的監造／PCM | 目前的主要使用情境；MVP 以抽查紀錄表為核心。 |

檢查時機與停留點，MVP 不做，之後再加；缺失改善追蹤（[#76](https://github.com/speko-tw/inspect-flow/issues/76)，0.7.x）與簽認（[#77](https://github.com/speko-tw/inspect-flow/issues/77)，0.9.x）另有版本處理。

`Dashboard` 用來監控；DOCX／PDF 才是正式交付與歸檔產物（依據：架構基準 §20.1、§20.22）。Pilot 還要驗證現場操作、排程、網路、容量、備份與報告產製時間（依據：架構基準 §31）。

現場流程**應**在手機與平板上容易操作；Pilot 要實測現場裝置與網路（依據：架構基準 §5.3、§13A.13、§31）。

### 核心價值

架構基準文件列出的核心價值（依據：架構基準 §1）：

1. 降低現場工程師的操作負擔。
2. 統一查核與照片蒐集格式。
3. 讓照片與查核項目建立明確關聯。
4. 讓後台可以即時掌握完成度。
5. 保存可追溯的歷史查核資料。
6. 為未來 PostgreSQL、NAS／MinIO／S3、離線模式與更完整的工程生命週期系統保留演進空間。

## 服務對象

系統內部角色與後台／現場的職責分工（依據：架構基準 §6.1–6.2）如下：

| 角色 | 職責 |
|---|---|
| 系統管理者（Admin，人員身上的開關，不是角色） | 管理系統設定、人員、公司、角色定義；可直接查看、修改所有專案（依據：負責人決定（#63，2026-09-26）；取代架構基準 §17 的範例矩陣，見 [KD-24](03-decisions-and-stack.md#kd-24)）。 |
| 專案角色（可自訂，掛在專案成員上） | 依指派的角色決定在該專案能做什麼，例如建立查核計畫、指派工程師、批次產生任務、監看完成度、審閱照片並產生報告，或唯讀存取；一個人在同一專案可同時擁有多個角色，權限加總（依據：負責人決定（#63，2026-09-26）；取代架構基準 §17 的範例矩陣，見 [KD-26](03-decisions-and-stack.md#kd-26)、[KD-27](03-decisions-and-stack.md#kd-27)）。 |
| 範本管理員（全系統角色，不屬於任何專案） | 由 Admin 直接指派；新增、修改、刪除範本庫的範本，可查看所有專案並把任何專案的查核項目存成範本；範本建議加入與審核流程留待之後版本（依據：負責人裁定（[#313](https://github.com/speko-tw/inspect-flow/issues/313)，2026-10-02），見 [KD-49](03-decisions-and-stack.md#kd-49)）。 |
| 現場工程師（Inspector / Field Engineer） | 查看今日指派任務，依要求拍照、填寫必要說明，並將任務標記完成；屬於現場查核這類專案角色的典型職責（依據：架構基準 §6.1）。 |

系統採「系統管理者開關＋可自訂的專案角色」模式，取代原本架構基準 §17 例示的四個固定角色 `ADMIN`、`COORDINATOR`、`INSPECTOR`、`VIEWER`；另新增「全系統角色」機制（第一個是範本管理員，見上表與 [KD-49](03-decisions-and-stack.md#kd-49)），三者並存、不互相混用。專案角色清單全系統共用，由 Admin 之後在系統內新增與維護，初始化不預建範本角色（依據：負責人決定（#63，2026-09-26）、負責人裁定（#261，2026-09-29）；取代架構基準 §17，見 [KD-24](03-decisions-and-stack.md#kd-24)、[KD-26](03-decisions-and-stack.md#kd-26)）。權限機制的細節（權限＝資料 × 動作、角色掛在專案成員上、安全機制）已裁定，見 [05-open-questions.md](05-open-questions.md) [OQ-08](05-open-questions.md#oq-08)（已裁定）。

### 人員、公司與權限的實體關係

```mermaid
flowchart LR
  Company["Company（公司）"] -.->|可選，最多一家| User["User（人員）"]
  User -->|一人可掛多筆| ProjectMember["ProjectMember（專案成員）"]
  Project["Project（專案）"] -->|一專案多筆成員| ProjectMember
  Role["Role（角色，全系統共用清單）"] -.->|一筆成員可掛多個角色，權限加總| ProjectMember
  User -.->|is_admin 開關，不經 Role| Admin["系統管理者權限"]
```

- `User` 不一定屬於 `Company`，最多連結一家：`Company` 與 `User` 是一對多、且為可選；本系統帳號的公司可隨時修改，外部帳號以外部來源為準、不能在系統內修改。沒有公司的人也能加入專案、被指派角色，專案角色跟著人、不跟著公司。見 [KD-23](03-decisions-and-stack.md#kd-23)、[KD-46](03-decisions-and-stack.md#kd-46)（依據：負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29））。
- `ProjectMember` 是 `User`、`Project`、`Role` 三者的關聯實體：同一人在同一 `Project` 下可掛多個 `Role`，權限加總，見 [KD-27](03-decisions-and-stack.md#kd-27)。
- `Role` 全系統共用一份清單，可自訂、可刪除，修改時立即影響所有持有者，見 [KD-26](03-decisions-and-stack.md#kd-26)。
- 系統管理者（`is_admin`）是 `User` 身上的開關，不透過 `Role` 授予，見 [KD-24](03-decisions-and-stack.md#kd-24)。內建 `admin` 代表系統本身，不屬於任何公司、永遠是系統管理者，見 [KD-44](03-decisions-and-stack.md#kd-44)。

除了系統內部角色之外，正式報告（DOCX／PDF）另有一群**文件收受方**：業主、監造單位、品管、政府標案審查方，以及文件歸檔／管理系統，他們不一定是系統的登入使用者，而是報告的閱讀與簽核對象 （依據：架構基準 §20.1、§20.12–20.13）。設計現場與後台流程時，需要區分「誰是系統使用者」與「誰只是最終文件的收受者」。

## 查核生命週期

系統圍繞以下生命週期建構（依據：架構基準 §0.1、§20.1）：

```mermaid
flowchart LR
  A["Inspection Plan（查核計畫）"] --> B["Inspection Task（查核任務）"]
  B --> C["Field Inspection（現場查核）"]
  C --> D["Evidence（證據）"]
  D --> E["Completion（完成確認）"]
  E --> F["Dashboard（儀表板）"]
  F --> G["Report（正式報告）"]
```

依據：架構基準 §0.1、§1

- 生命週期的起點是 `Inspection Plan`，終點是正式 `Report`，不是 `Dashboard`。
- `Dashboard` 只是監控介面；`Report`（DOCX／PDF）才是對業主、監造與政府機關具有正式意義的產出。
- 圖中混合流程步驟與資料實體；主要名詞見 [04-glossary.md](04-glossary.md)。

## 第一階段（MVP）範圍

第一階段的目標是完成一個完整閉環，不是打造大平台（依據：架構基準 §1）。下列 Phase 1～11 依 Milestone 路線圖與負責人裁定對齊；架構基準 §30 提供 MVP 功能範圍與原開發階段的參考：

- **Phase 1 — Core Foundation（核心基礎）**：Repository 骨架、健康檢查、CI、後端／前端基礎、API 慣例、SQLAlchemy + Alembic + SQLite、`User`、`Company`、`Project` 與共用基礎。
- **Phase 2 — Identity & Access（身分與存取）**：登入 / 登出 / 目前使用者、角色、權限與存取檢查。
- **Phase 3 — Template System**：範本庫（獨立於專案、套用即複製、範本不版本化，見 [KD-03](03-decisions-and-stack.md#kd-03)、[KD-47](03-decisions-and-stack.md#kd-47)）、`Template`、`TemplateItem`、`EvidenceRequirement`；範本只存結構、分類固定兩層（[KD-48](03-decisions-and-stack.md#kd-48)）、檢查標準分文字與數值兩種（[KD-52](03-decisions-and-stack.md#kd-52)）。
- **Phase 4 — Inspection Planning**：`InspectionPlan`、`InspectionTask`、任務需求快照；查驗項目與查驗點由內業事先給定，MVP 不以間距（interval）自動切分任務為必要流程（依 [G-01](05-open-questions.md#g-01) 裁定）。
- **Phase 5 — Field UI**：今日任務、任務詳情、證據檢查清單、狀態。
- **Phase 6 — Evidence（證據）**：拍照、現場編修並確認產生現場版、上傳、內業加工產生內業版（內業之後編修直接更新內業版本身，不另存新版本）、儲存、Evidence 紀錄（依 [G-02](05-open-questions.md#g-02)、[KD-32](03-decisions-and-stack.md#kd-32) 裁定）。
- **Phase 7 — Completion Validation（完成驗證）**：必要證據 vs. 已上傳證據的伺服器端驗證。
- **Phase 8 — Admin Dashboard**：今日工作量、完成數／完成率、工程師與專案進度。
- **Phase 9 — Formal Report Delivery**：Report View Model、DOCX 範本、DOCX／PDF 與版次資料。MVP **必須**保存範本版本、文件編號、版次、產製者與時間、兩種檔案鍵、資料快照與 SHA-256；已核發檔案**不得**覆蓋（依據：架構基準 §20.22、§30 Phase 9）。完整簽核流程**得**先用空白簽名欄簡化；正式流程見 [OQ-07](05-open-questions.md#oq-07)（依據：架構基準 §15、§20.12）。
- **Phase 10 — Pilot Deployment**：單一 Linux 伺服器、Docker Compose、HTTPS、持久化儲存。
- **Phase 11 — Pilot Hardening & Release Readiness（試營運強化與發布整備）**：依試營運回饋修正問題，強化效能、資安與維運，驗證相容性、備份／還原及報告正確性，完成發布整備。

各 Phase 對應哪份規格、目前狀態與被擋議題，見 [docs/specs/README.md 規格索引](../specs/README.md#index)。

Phase N 對應 Milestone 0.N.x，見 [06-versioning-and-milestone-governance.md](06-versioning-and-milestone-governance.md#vg-05)。

一個版本要視為「可部署」，**必須**滿足 §22A.20 的完整 Deployment Definition of Done，包括 DOCX／PDF 可產出、重啟後資料不消失等條件（依據：架構基準 §22A.20）。

### MVP 的證據類型邊界

MVP 的佐證**只收照片**；額外文件拍照並以照片註記說明，報告功能（0.9.x）再提供「補充文件」區；文件、量測數值、簽名、影片等類型未來可能擴充，由負責人在有需要時裁定（依據：負責人裁定（[#88 留言](https://github.com/speko-tw/inspect-flow/issues/88#issuecomment-5956040233)，2026-10-02），見 [OQ-20](05-open-questions.md#oq-20)（已裁定）、[KD-53](03-decisions-and-stack.md#kd-53)；取代架構基準 §12.6 的 `PHOTO`／`TEXT` 暫定）。原 `TEXT` 類型是否保留為獨立佐證類型，裁定沒有說明，待規格確認。

### 目前的運作前提（屬第一階段基準，非永久限制）

第一階段採 Online-first、單一後端 host、SQLite、本機持久化儲存與 Linux／Docker Compose（依據：架構基準 §3、§9、§22.1–22.7）。SQLite 的 WAL 設定是建議，見 [KD-08](03-decisions-and-stack.md#kd-08)；Admin／Field 共用同一個 React 專案，見 [KD-12](03-decisions-and-stack.md#kd-12)。

## 明確排除的非目標（第一階段）

架構基準文件明確指出第一階段**不是**：

- 一套龐大的工程 ERP，也不是一次到位的完整工程生命週期管理平台（依據：架構基準 §1）。

為避免過度工程化，第一階段明確不做以下項目（依據：架構基準 §34）：

```text
Microservices                    Data Warehouse
Kubernetes                       Elasticsearch
Kafka                            Advanced BI
Redis Cluster                    多區域 HA
GraphQL                          自動 AI 圖像判定
Complex Event Sourcing           複雜 Workflow BPM
Distributed Transaction          完整 Offline Sync Engine
```

清單只限第一階段；未來是否採用，仍要看實際需求（依據：架構基準 §34）。

## 延後但不排除的能力

架構刻意保留以下能力的擴充空間；它們是被排序延後的能力，不是被否決的能力 （依據：架構基準 §35、§1、§10、§22.7、§33）：

```text
離線模式 / 完整 Offline Sync              NCR / 缺失（Defect）追蹤
QR Code 掃描                             Re-inspection（複查）
GPS                                      Approval Workflow（簽核流程）
EXIF                                     Push Notification
數位簽章 / Electronic Approval            Audit Trail（完整事件記錄）
Voice Note（語音備註）                    WBS 整合
文件上傳                                  Drawing Linkage（圖說關聯）
影片                                      Material / Equipment Linkage
PostgreSQL（取代 SQLite）                 MinIO / S3 / NAS（取代本機儲存）
Corporate SSO                            檢查時機／停留點
                                         串接文件管理系統
```

資料庫與儲存體遷移**應**維持 API 契約，見 [KD-08](03-decisions-and-stack.md#kd-08)、[KD-02](03-decisions-and-stack.md#kd-02)（依據：架構基準 §10、§32–33）。

## 架構占位（placeholder）與業務決策的界線

專案、人員、地點、工項欄位，以及查核規則、Result、報表版面與簽核流程仍待決議。來源範例不是定案規格；完整清單見 [05-open-questions.md](05-open-questions.md)（依據：架構基準 §0、§12、§38–39）。

## 架構總圖

以下 7 張圖搭配上方的查核生命週期圖，構成本資料夾的完整架構視圖。來源尚未拍板的部分一律用虛線標 「待定」，並指向對應的待決議條目；圖本身不代為裁決。

### 第一版總體架構

```mermaid
flowchart TB
  AdminUI["Admin Dashboard（後台）"] -->|HTTPS/REST| API["Backend API"]
  FieldUI["Field Web/PWA（現場）"] -->|HTTPS/REST| API
  API --> DB[("SQLite")]
  API --> Storage["Photo Storage（本機資料夾）"]
```

依據：架構基準 §3

- 前端（Admin、Field）一律經 HTTPS/REST 呼叫 Backend API，不直接碰資料庫或檔案儲存（見 [PR-01](02-principles.md#pr-01)）。
- 第一版資料庫是 SQLite、照片存本機資料夾；兩者的演進路徑見下方「儲存與資料庫演進路徑」。
- Admin 與 Field 共用同一個前端專案，以路由區分並依路由拆分程式碼（見 [KD-12](03-decisions-and-stack.md#kd-12)）。

### Backend 分層與存取邊界

```mermaid
flowchart TB
  Client["Field/Admin 前端"] --> APILayer["API Layer"]
  APILayer --> ServiceLayer["Service Layer（Business Logic）"]
  ServiceLayer --> Persistence["Persistence Layer（SQLAlchemy）"]
  ServiceLayer --> StorageSvc["Storage Service"]
  Persistence --> DB[("SQLite")]
  StorageSvc --> LocalFS["Local Storage"]
  Client -.->|禁止直接存取| DB
  Client -.->|禁止直接存取| LocalFS
```

依據：架構基準 §2.2、§7

- 前端只能打 API Layer；資料庫與檔案儲存一律經 Service → Persistence／Storage，不得繞過（見 [PR-01](02-principles.md#pr-01)、[PR-02](02-principles.md#pr-02)）。
- Service Layer 是唯一放業務邏輯的地方；API Layer 不做「是否完成」這類判斷。
- 後端內部服務（例如 Report Service）走同一條 Service → Persistence／Storage 路徑，不必自我呼叫 API（見 [PR-01](02-principles.md#pr-01)）。

### 檔案與資料庫分離

```mermaid
flowchart LR
  Evidence["Evidence 上傳"] --> DBMeta["Database（metadata：storage_key、SHA-256……）"]
  Evidence --> FileStore["File/Object Storage（實體檔案）"]
  DBMeta -.->|storage_key 指向| FileStore
```

依據：架構基準 §2.3、§13.1–13.3

- 照片實體檔案永遠不進關聯式資料庫；資料庫只存 metadata 與 `storage_key`（見 [PR-02](02-principles.md#pr-02)）。
- `storage_key` 由後端以 Evidence 的 UUID 產生，不用使用者原始檔名。
- 具體儲存鍵路徑格式尚未統一，見 [04-glossary.md](04-glossary.md) `storage_key` 條目與 [G-02](05-open-questions.md#g-02)。

### 報表產製管線

```mermaid
flowchart LR
  DB[("Database")] --> ReportSvc["Report Service"]
  ReportSvc --> RVM["Report View Model"]
  RVM --> Engine["Report Template Engine"]
  Engine --> DOCX["DOCX"]
  Engine --> HTML["HTML Preview"]
  DOCX --> PDF["PDF"]
```

依據：架構基準 §20.2

- 報表資料由後端重新組裝，前端不拼正式文件（見 [PR-06](02-principles.md#pr-06)）。
- DOCX 與 PDF 共用同一份 Report View Model，確保兩種格式內容一致。
- 正式環境採用哪一種 DOCX → PDF 轉換工具待定（見 [OQ-15](05-open-questions.md#oq-15)）。

### 主要實體關係

```mermaid
flowchart TB
  Project["Project（專案）"] --> Plan["Inspection Plan（查核計畫）"]
  Plan --> Task["Inspection Task（查核任務）"]
  Task --> Snapshot["Task Requirement Snapshot（需求快照）"]
  Snapshot --> Evidence["Evidence（證據）"]
  Template["Inspection Template（範本庫的範本）"] --> Item["Template Item（範本項目）"]
  Item --> Requirement["Evidence Requirement（證據需求）"]
  Template -.->|套用即複製，記錄來源名稱與時間| Project
  Requirement -.->|建立任務時複製為| Snapshot
```

依據：架構基準 §12；範本不版本化、套用即複製依負責人裁定（[#78 留言](https://github.com/speko-tw/inspect-flow/issues/78#issuecomment-5956039701)，2026-10-02），見 [KD-03](03-decisions-and-stack.md#kd-03)、[KD-47](03-decisions-and-stack.md#kd-47)

- 範本庫獨立於專案；範本修改時直接覆蓋，沒有 `Template Version`。專案套用範本時複製成自己的查核項目，並記錄來源範本名稱與套用時間，之後範本改動不影響已套用的專案。
- `Inspection Task` 建立時把當時的 `Evidence Requirement` 複製成自己的 `Task Requirement Snapshot`（見 [PR-04](02-principles.md#pr-04)）；專案複本與任務快照的分工待 0.4.x 規格確認（見 [OQ-09](05-open-questions.md#oq-09)）。
- 完成度檢查與報告都應讀 `Task` 自己的 Snapshot，不直接查目前的 `Template Item` / `Evidence Requirement`。
- `Evidence` 隸屬於某個 `Task` 與其 `Task Requirement Snapshot`，可再往上追溯到 `Plan` 與 `Project`（見 [PR-07](02-principles.md#pr-07)）。

### 儲存與資料庫演進路徑

```mermaid
flowchart LR
  subgraph MVP[第一階段]
    API1["Backend API"] --> SQLiteDB[("SQLite")]
    API1 --> LocalFS["本機檔案儲存"]
  end
  subgraph FUT[未來規模擴大後]
    API2["Backend API"] --> PG[("PostgreSQL")]
    API2 --> ObjStore["MinIO/S3/NAS"]
  end
  SQLiteDB -.->|觸發條件| PG
  LocalFS -.->|觸發條件| ObjStore
```

依據：架構基準 §10、§33

- 兩條演進路徑都設計成不需改變 API contract（見 [PR-02](02-principles.md#pr-02)、 [PR-03](02-principles.md#pr-03)）。
- SQLite → PostgreSQL 的觸發條件見 [03-decisions-and-stack.md](03-decisions-and-stack.md)（[KD-08](03-decisions-and-stack.md#kd-08)）； 本機儲存 → 物件儲存的觸發條件見（[KD-02](03-decisions-and-stack.md#kd-02)）。
- MVP 階段兩者都只由單一 Backend Host 存取，不透過 network filesystem 共用。

### 部署拓撲

```mermaid
flowchart TB
  Client["Client 瀏覽器"] -->|HTTPS| Proxy["Reverse Proxy（Caddy/Nginx）"]
  Proxy --> Web["Frontend（Web）"]
  Proxy --> API["Backend API"]
  API --> DB[("SQLite")]
  API --> Storage["本機 Storage"]
```

依據：架構基準 §22.5–22.7

- 第一階段標準部署單位是 Docker Compose；SQLite 與 Storage 用 persistent volume／bind mount 掛載到 Backend，不是獨立 container（見 [KD-09](03-decisions-and-stack.md#kd-09)）。
- 升級到 PostgreSQL 後，Compose 會多一個 db service；API 對外呼叫路徑不變。
- 部署基準見 [03-decisions-and-stack.md](03-decisions-and-stack.md) （[KD-09](03-decisions-and-stack.md#kd-09)）；環境細節與待決事項見 [OQ-18](05-open-questions.md#oq-18)。

## 相關文件

- 每一張圖背後的規則與理由，見 [02-principles.md](02-principles.md)；決策與技術棧見 [03-decisions-and-stack.md](03-decisions-and-stack.md)。
- 名詞定義見 [04-glossary.md](04-glossary.md)。
- 遇到看似未定案或前後矛盾的地方，先查 [05-open-questions.md](05-open-questions.md)，不要把自己的假設 當成定案。
