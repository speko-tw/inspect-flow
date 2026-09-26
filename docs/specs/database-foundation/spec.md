# 資料庫基礎（database-foundation）

**代碼**：`DBF`　**Phase**：P1　**狀態**：部分凍結
**前置規格**：`skeleton`（後端骨架、`make check`、CI）、`api-conventions`（UUID 字串 ID、UTC 時間格式）；`User`、`Project` 的業務欄位由 `domain-model` 定義
**引用意圖**：[PR-03](../../intents/02-principles.md#pr-03)、[PR-08](../../intents/02-principles.md#pr-08)、[PR-14](../../intents/02-principles.md#pr-14)、[KD-06](../../intents/03-decisions-and-stack.md#kd-06)、[KD-07](../../intents/03-decisions-and-stack.md#kd-07)、[KD-08](../../intents/03-decisions-and-stack.md#kd-08)、[KD-10](../../intents/03-decisions-and-stack.md#kd-10)、[KD-14](../../intents/03-decisions-and-stack.md#kd-14)、[OQ-22](../../intents/05-open-questions.md#oq-22)；技術棧卡片：[ORM 與資料存取](../../intents/03-decisions-and-stack.md#stack-orm)、[Database Migration](../../intents/03-decisions-and-stack.md#stack-migration)、[資料庫](../../intents/03-decisions-and-stack.md#stack-database)、[測試工具](../../intents/03-decisions-and-stack.md#stack-tests)、[CI](../../intents/03-decisions-and-stack.md#stack-ci)
**被擋議題**：第一段無；第二段（`Inspection Template`、`Template Version`）受 [G-01](../../intents/05-open-questions.md#g-01) 擋（依 [OQ-22](../../intents/05-open-questions.md#oq-22)）
**凍結範圍**：第一段——資料庫基礎設施（DBF-R01～DBF-R10、DBF-AC01～DBF-AC08），以及 `User`、`Project` 的共通結構（DBF-R11～DBF-R14、DBF-AC09～DBF-AC11）。第二段 DBF-R20 以後為草稿

## 目的

後端所有資料存取都經 SQLAlchemy，schema 只由 Alembic migration 建立與演進；同一條 migration 鏈在 SQLite 與 PostgreSQL 上都能套用，日後換資料庫時 API 契約不變（依據：架構基準 §4.4–4.5、§9、§30 Phase 1、§32）。MVP 實際執行的資料庫只有 SQLite；PostgreSQL 只用在 CI 的相容性檢查，確保日後依 [KD-08](../../intents/03-decisions-and-stack.md#kd-08) 的觸發條件轉換時路徑可行，不代表本規格要切換資料庫。`User`、`Project` 有穩定的 UUID 身分、與 UUID 分開的業務編號，以及建立與修改紀錄，後續規格可以放心引用（依據：架構基準 §11、§19）。

## 範圍

**包含**：

- 第一段（凍結）：
  - SQLAlchemy 2.x 的連線設定、宣告式 model 基底，以及 Service 層使用的交易單位。
  - Alembic 初始化：migration 鏈、`alembic upgrade head` 能從空資料庫建出完整 schema。
  - SQLite 作為 MVP 資料庫，連線初始化的 PRAGMA 設定。
  - 由 `skeleton` 移交的 CI PostgreSQL 相容性測試（範圍見 DBF-R10，依 [DBF-Q1](#dbf-q1) 裁定）。
  - `User`、`Project` 的共通結構：UUID 主鍵、與 UUID 分開的業務編號、建立與修改紀錄欄位。
- 第二段（草稿，G-01 裁定後擴大凍結範圍）：`Inspection Template`、`Template Version` 的資料表，見[第二段草稿](#phase-1-part-2)。

**不包含**（注明移到哪份規格，或屬於哪一條非目標）：

- `User`、`Project` 的業務欄位（例如 `name`、`location`、`status`、`email`、`role`、`active`）：由 `domain-model` 定義（依 spec 範本「資料」段：完整定義寫在 `domain-model`；負責人決定，#51，2026-09-26）。`Project` 正式欄位待 [OQ-01](../../intents/05-open-questions.md#oq-01)；`User` 組織欄位已裁定，見 [OQ-02](../../intents/05-open-questions.md#oq-02)（已裁定）。
- 密碼雜湊、登入狀態等認證欄位：移至 `authentication`，受 [OQ-13](../../intents/05-open-questions.md#oq-13) 擋；角色權限機制已裁定，見 [OQ-08](../../intents/05-open-questions.md#oq-08)（已裁定）。
- `User`、`Project` 的 API 端點（建立、查詢、修改）：本規格不定義資源端點；由之後的功能規格負責（例如 `authentication`、`admin-dashboard`）。
- 資料庫備份與還原：屬 [PR-12](../../intents/02-principles.md#pr-12)，落地於 `pilot-deployment`。
- 部署時 migration 與 API 啟動的先後順序、SQLite 檔案的持久化掛載、多台後端不得共用 SQLite 檔：屬 [PR-13](../../intents/02-principles.md#pr-13)、[KD-08](../../intents/03-decisions-and-stack.md#kd-08)、[KD-09](../../intents/03-decisions-and-stack.md#kd-09)，落地於 `pilot-deployment`。
- 正式環境切換到 PostgreSQL：屬延後能力（依據：架構基準 §10、§33）；本規格只驗證相容性。

## 使用情境

- 工程師新增一張資料表時，繼承共用的 model 基底取得 UUID 主鍵與建立／修改紀錄欄位，並用 Alembic 產生一支 migration，不直接建表。
- 工程師在本機用預設設定執行 `alembic upgrade head`，得到一個 SQLite 資料庫；在 CI 上，同一條 migration 鏈也對 PostgreSQL 跑過一次。
- Service 層在一個交易單位裡完成多筆寫入；中途拋出例外時，整批寫入都不生效。
- 後續規格（例如 `inspection-planning`）用 UUID 外鍵引用 `Project`、`User`，不依賴業務編號或自增整數。

## 需求

用「必須／應／得」，每條附依據；來源只是建議的，不得寫成「必須」。

### 第一段：基礎設施（凍結）

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| DBF-R01 | 後端的資料庫存取**必須**經 SQLAlchemy 2.x；程式碼**不得**直接 import 資料庫驅動程式（例如 `sqlite3`、PostgreSQL 驅動）執行 SQL | 必須 | [PR-03](../../intents/02-principles.md#pr-03)、[KD-06](../../intents/03-decisions-and-stack.md#kd-06)、[ORM 與資料存取](../../intents/03-decisions-and-stack.md#stack-orm) |
| DBF-R02 | Schema **必須**只由 Alembic migration 建立與演進；對空資料庫執行 `alembic upgrade head` **必須**建出目前完整的 schema；migration 鏈**必須**只有一個 head | 必須 | [PR-03](../../intents/02-principles.md#pr-03)、[KD-06](../../intents/03-decisions-and-stack.md#kd-06)；單一 head 依 [共用檔案規則](../README.md#parallel) |
| DBF-R03 | 正式程式碼路徑（`backend/app`、Alembic 目錄）**不得**呼叫 `Base.metadata.create_all()` 或等效的建表捷徑；測試**得**在測試專用的 metadata 上使用 | 必須 | [PR-03](../../intents/02-principles.md#pr-03) |
| DBF-R04 | MVP 的資料庫**必須**是 SQLite | 必須 | [KD-08](../../intents/03-decisions-and-stack.md#kd-08)、[資料庫](../../intents/03-decisions-and-stack.md#stack-database) |
| DBF-R05 | 資料庫連線目標**應**由環境變數設定，不改程式碼就能切換 SQLite 檔案路徑或 PostgreSQL；變數名稱與說明**必須**寫進 `.env.example`，實際值**不得**提交 | 應（切換）；必須（`.env.example`） | [PR-03](../../intents/02-principles.md#pr-03)「為什麼」（平滑轉換到 PostgreSQL）；[PR-14](../../intents/02-principles.md#pr-14) |
| DBF-R06 | 連線到 SQLite 時，連線初始化**應**設定並確認 `foreign_keys = ON` 與 WAL；這段 SQLite 專用語句**必須**標註資料庫相依性，且只在 SQLite 連線上執行 | 應（PRAGMA）；必須（標註） | [KD-08](../../intents/03-decisions-and-stack.md#kd-08)（PRAGMA 為建議確認）；[PR-03](../../intents/02-principles.md#pr-03)（raw SQL 需標註相依性） |
| DBF-R07 | 程式碼**應**避免 SQLite 專用的 raw SQL；**不得**依賴 SQLite AUTOINCREMENT 作為跨系統身分 | 應（避免 raw SQL）；不得（AUTOINCREMENT） | [PR-03](../../intents/02-principles.md#pr-03)「規則」「怎麼做」；[KD-07](../../intents/03-decisions-and-stack.md#kd-07)（考慮過但沒選：AUTOINCREMENT） |
| DBF-R08 | 時間欄位**應**以含時區的型別儲存 UTC 時間，SQLite 與 PostgreSQL 讀回的都是同一個 UTC 時刻；API 輸出沿用 `api-conventions` 的時間格式（API-R09） | 應 | [PR-03](../../intents/02-principles.md#pr-03)「怎麼做」（timestamp 跨資料庫一致）；[KD-14](../../intents/03-decisions-and-stack.md#kd-14) |
| DBF-R09 | 後端**應**提供一個交易單位給 Service 層使用：一次請求內的寫入在成功時一起提交，拋出例外時一起回滾；API 層不直接組 SQL | 應 | [KD-10](../../intents/03-decisions-and-stack.md#kd-10)；[01-overview Backend 分層](../../intents/01-overview.md#backend-分層與存取邊界)（依據：架構基準 §2.2、§7） |
| DBF-R10 | CI **必須**在每個 PR 對 PostgreSQL 執行 `alembic upgrade head` 與資料庫相關的測試（`backend/tests/db/`），任一失敗時 check 為失敗；整套後端測試不對 PostgreSQL 跑。這一段**必須**經由 `make check` 執行，不另開 CI job（依 SKL-R04）：`make check` 只在設定了 PostgreSQL 連線時執行這一段，未設定時略過、其餘檢查照常；CI 以 service container 提供 PostgreSQL 並設定連線。PostgreSQL 採實作時官方支援中的最新穩定主版本，版本號固定寫在 CI 設定裡，升級時另外調整 | 必須 | [CI](../../intents/03-decisions-and-stack.md#stack-ci)（PostgreSQL 相容性測試為 CI 閘門，已決定）；[PR-03](../../intents/02-principles.md#pr-03)「怎麼檢查」；由 `skeleton` 移交；範圍、頻率、機制與版本依 [DBF-Q1](#dbf-q1) 裁定（[#53](https://github.com/speko-tw/inspect-flow/issues/53)） |

### 第一段：`User`、`Project` 共通結構（凍結）

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| DBF-R11 | `User`、`Project` **必須**以 UUID 作為主鍵；**不得**以自增整數作為主鍵或對外識別。UUID 版本**得**優先評估 UUIDv7，由實作任務選定 | 必須；得（UUIDv7） | [KD-07](../../intents/03-decisions-and-stack.md#kd-07)、[PR-03](../../intents/02-principles.md#pr-03)；API 表示法見 API-R06 |
| DBF-R12 | `Project` **必須**有與 UUID 分開保存的業務編號 `project_code`；`User` **必須**有與 UUID 分開保存的業務編號 `employee_no`。兩者不得互相取代 | 必須 | [KD-07](../../intents/03-decisions-and-stack.md#kd-07)；[04-glossary](../../intents/04-glossary.md)「專案」「業務編號」（依據：架構基準 §11、§12.1–12.2） |
| DBF-R13 | `project_code` 在所有 `Project` 之間**必須**唯一；`employee_no` 在所有 `User` 之間**必須**唯一；由資料庫約束保證 | 必須 | 負責人決定（#51，2026-09-26）；intents 沒有明文 |
| DBF-R14 | `User`、`Project` **必須**保留建立與最後修改的時間與操作者；欄位**應**命名為 `created_at`、`updated_at`、`created_by`、`updated_by`。`created_at`、`updated_at` 由後端自動填寫。`created_by`、`updated_by` **不得**為空值，**必須**是指向 `User` 主鍵的外鍵，由資料庫約束保證；外鍵**必須**允許指向同一筆 `User` 自己（內建 `admin` 的 `created_by` 指向自己）。建立初始帳號的初始化指令，以及 `is_admin`、`is_system` 欄位，由 `domain-model` 定義 | 必須（保留、不得為空、外鍵）；應（欄位名） | [PR-08](../../intents/02-principles.md#pr-08)；[DBF-Q2](#dbf-q2) 裁定（負責人，[#54](https://github.com/speko-tw/inspect-flow/issues/54)，2026-09-26；決策見 [#63](https://github.com/speko-tw/inspect-flow/issues/63)）；架構基準無對應章節 |

<a id="phase-1-part-2"></a>
### 第二段：`Inspection Template`、`Template Version`（草稿）

本段在 [G-01](../../intents/05-open-questions.md#g-01) 裁定、並說清楚立場 A 的 `Template` 指哪一層之前維持草稿，不拆任務（依 [OQ-22](../../intents/05-open-questions.md#oq-22)）。驗收條件等凍結時再補。

| 編號 | 需求（草稿） | 強度 | 依據 |
|---|---|---|---|
| DBF-R20 | `Inspection Template`、`Template Version` 的資料表沿用 DBF-R11、DBF-R14 的共通結構；`interval` 欄位的歸屬等 G-01 裁定，裁定前不放進任何一張表 | 必須（共通結構）；待 G-01（interval） | [KD-07](../../intents/03-decisions-and-stack.md#kd-07)、[PR-08](../../intents/02-principles.md#pr-08)、[PR-09](../../intents/02-principles.md#pr-09) |
| DBF-R21 | `Inspection Template` **必須**版本化；`Template Version` 發行後**不應**再改寫語意 | 必須（版本化）；不應（改寫） | [KD-03](../../intents/03-decisions-and-stack.md#kd-03)、[PR-04](../../intents/02-principles.md#pr-04)；[04-glossary](../../intents/04-glossary.md)「範本版本」 |

## 資料

本規格只定義 `User`、`Project` 的共通結構（主鍵、業務編號、建立與修改紀錄），業務欄位與完整定義寫在 `domain-model`。建立這兩張資料表的 migration 要等 `domain-model` 部分凍結 `User`、`Project` 後才開工（見 [plan.md](plan.md)）。

| 實體 | 本規格負責 | 其餘欄位 |
|---|---|---|
| `User` | UUID 主鍵、`employee_no`（唯一）、`created_at`、`updated_at`、`created_by`、`updated_by` | `domain-model`（含 `is_admin`、`is_system` 與初始化指令）；認證欄位歸 `authentication` |
| `Project` | UUID 主鍵、`project_code`（唯一）、`created_at`、`updated_at`、`created_by`、`updated_by` | `domain-model` |
| `Inspection Template`、`Template Version` | 草稿，見 DBF-R20、DBF-R21 | `domain-model`、`template-system` |

**門檻比對**（依[部分凍結](../README.md#partial-freeze)規則 1）：逐條比對[開工門檻](../../intents/05-open-questions.md#gate)的 G-01～G-07、OQ-06 的「為什麼要先決定」與選項原文。

| 實體 | 比對過的議題 | 字面命中 | 結論 | 理由 |
|---|---|---|---|---|
| `User` | G-01～G-07、OQ-06 | G-03「**使用者**何時看到編輯結果」；G-04「Variant 核可紀錄、**核可者**」 | 無關，凍結共通結構 | G-03 的「使用者」是泛稱，談的是編輯與上傳的時序，不涉及任何 `User` 欄位。G-04 的「核可者」若日後要記錄，是在 Variant 或核可紀錄那一側加指向 `User` 的 UUID 外鍵；`User` 自己的主鍵、業務編號、紀錄欄位都不會因此改變。其餘議題沒有點名 `User` |
| `Project` | G-01～G-07、OQ-06 | G-02 立場 A 的範例路徑 `photos/<project_id>/<task_id>/<evidence_id>.<ext>` | 無關，凍結共通結構 | 這條路徑只用到 `Project` 的 UUID，而 UUID 主鍵已由 [KD-07](../../intents/03-decisions-and-stack.md#kd-07) 固定；G-02 不論選哪個立場，都只影響 `Evidence`／`Evidence Variant` 與儲存鍵格式，不會改到 `Project` 的資料表。其餘議題沒有點名 `Project`（G-01 點名的是 `Inspection Plan`，不是 `Project`） |
| `Inspection Template` | G-01～G-07、OQ-06 | G-01 立場 A「`Interval` 是 `Template` 本身的一部分」 | 有關，維持草稿 | 立場 A 的 `Template` 可能指頂層實體，也可能泛指範本層級，字面無法分辨；若指頂層，這張表就要多一個 `interval` 欄位（見 [#46](https://github.com/speko-tw/inspect-flow/issues/46)） |
| `Template Version` | G-01～G-07、OQ-06 | G-01 立場 A（同上，程度較低） | 有關，維持草稿 | 同上；`interval` 也可能落在版本層（見 [#46](https://github.com/speko-tw/inspect-flow/issues/46)） |

`User`、`Project` 的命中都只是「其他實體引用它的 UUID」，判為無關是本規格的判讀；規則 1 是否要補上這類例外，見 [DBF-Q3](#dbf-q3)。

**門檻外、但影響業務欄位的議題**（不在本規格範圍，列出供 `domain-model` 參考）：[OQ-01](../../intents/05-open-questions.md#oq-01)（`Project` 正式欄位）、[OQ-02](../../intents/05-open-questions.md#oq-02)（`User` 組織欄位，已裁定，見 [KD-16](../../intents/03-decisions-and-stack.md#kd-16)～[KD-22](../../intents/03-decisions-and-stack.md#kd-22)）、[OQ-08](../../intents/05-open-questions.md#oq-08)（角色與權限機制，已裁定，見 [KD-24](../../intents/03-decisions-and-stack.md#kd-24)～[KD-29](../../intents/03-decisions-and-stack.md#kd-29)）、[OQ-13](../../intents/05-open-questions.md#oq-13)（密碼雜湊與登入機制）。

## 介面

本規格不新增 API 端點。對開發者的介面如下；具體模組名稱與變數名稱由計畫決定，不屬於本規格的契約。

| 介面 | 內容 | 對應需求 |
|---|---|---|
| 指令 | 在 `backend/` 執行 `alembic upgrade head` 建出目前 schema | DBF-R02 |
| 設定 | 一個資料庫連線目標的環境變數，寫在 `.env.example`；未設定時使用本機 SQLite 預設路徑 | DBF-R04、DBF-R05 |
| 程式介面 | 共用 model 基底（UUID 主鍵與建立／修改紀錄欄位）；Service 層取得交易單位的方式 | DBF-R09、DBF-R11、DBF-R14 |

## 驗收條件

每條至少對應一個需求；除 DBF-AC08 以 CI 執行紀錄與本機未設定 PostgreSQL 連線的 `make check` 驗證外，皆以 `make check` 內的自動化測試驗證。

### 第一段：基礎設施

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| DBF-AC01 | repo 內 `backend/app` 與 Alembic 目錄的 Python 原始碼 | 測試掃描所有 import | 沒有 `sqlite3` 或任何 PostgreSQL 驅動模組的 import；SQLAlchemy 是唯一的資料庫存取入口 | DBF-R01 |
| DBF-AC02 | 一個空的 SQLite 資料庫檔 | 執行 `alembic upgrade head`，再查 `alembic heads` | 結束碼為 0；`alembic heads` 恰好一個 head；資料庫的 `alembic_version` 等於該 head | DBF-R02、DBF-R04 |
| DBF-AC03 | repo 內 `backend/app` 與 Alembic 目錄的原始碼 | 測試搜尋 `create_all` | 沒有任何呼叫 | DBF-R03 |
| DBF-AC04 | 資料庫連線環境變數設成一個暫存目錄下的 SQLite 路徑 | 後端建立連線並執行一次查詢 | 暫存路徑出現資料庫檔；未設定該變數時連到預設路徑；`.env.example` 列出該變數名稱 | DBF-R05 |
| DBF-AC05 | 後端的連線初始化邏輯，分別套用在 SQLite 檔案資料庫與非 SQLite 方言的連線上 | SQLite：從後端取得的連線查 `PRAGMA foreign_keys` 與 `PRAGMA journal_mode`；非 SQLite：以非 SQLite 方言觸發同一段初始化；另掃描 `backend/app` 原始碼中所有 `PRAGMA` 語句 | SQLite 分別回傳 `1` 與 `wal`；非 SQLite 連線上沒有執行任何 `PRAGMA`；每一處 `PRAGMA` 都帶有計畫規定格式的資料庫相依性標註 | DBF-R06、DBF-R07 |
| DBF-AC06 | 一張測試專用、含時間欄位的資料表 | 寫入一個 `+08:00` 時區的時間後讀回 | 讀回的值帶時區、換算成 UTC 後與寫入的時刻相同；用 `api-conventions` 的時間格式輸出以 `Z` 結尾 | DBF-R08 |
| DBF-AC07 | 一張測試專用的資料表，以及在同一個交易單位內寫入兩筆、第二筆後拋出例外的操作 | 執行該操作，再執行一次不拋例外的同樣操作 | 拋例外時兩筆都不存在；不拋例外時兩筆都存在 | DBF-R09 |
| DBF-AC08 | 一個 PR 的 CI 執行，CI 以 service container 提供 PostgreSQL 並設定連線；另有一個沒有設定 PostgreSQL 連線的本機環境 | CI 執行 `make check`；本機執行 `make check` | CI 對 PostgreSQL 執行 `alembic upgrade head` 與 `backend/tests/db/` 的測試，全部成功時 check 通過；故意放入一支在 PostgreSQL 上會失敗的 migration 時，check 失敗；故意讓 `backend/tests/db/` 的一個測試在 PostgreSQL 上失敗時，check 也失敗；CI 設定裡的 PostgreSQL 版本是固定的主版本號，不是 `latest` 這類浮動標籤，且是實作當時 PostgreSQL 官方支援中的最新穩定主版本；本機略過 PostgreSQL 這一段，其餘檢查照常執行 | DBF-R10 |

### 第一段：`User`、`Project` 共通結構

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| DBF-AC09 | 對空資料庫執行 `alembic upgrade head` 之後 | 用 SQLAlchemy inspector 檢查 `User`、`Project` 的資料表，並各新增一筆資料 | 主鍵是單一欄位、型別對應 UUID、不是自增整數；新增的資料取得可被 `uuid.UUID(...)` 解析的主鍵 | DBF-R07、DBF-R11 |
| DBF-AC10 | 已有一筆 `project_code = "P001"` 的 `Project`、一筆 `employee_no = "E001"` 的 `User` | 再新增一筆相同 `project_code` 的 `Project`、一筆相同 `employee_no` 的 `User` | 兩次都因唯一約束失敗，資料庫各仍只有一筆；業務編號與主鍵是不同欄位 | DBF-R12、DBF-R13 |
| DBF-AC11 | 新增一筆 `created_by`、`updated_by` 都指向自己的 `User`，再新增一筆 `created_by`、`updated_by` 指向該 `User` 的 `Project` | 檢查欄位後修改該筆資料；另對兩張表各嘗試寫入 `created_by` 為空值、`updated_by` 為空值、`created_by` 指向不存在的 UUID 的資料 | 兩張表都有 `created_at`、`updated_at`、`created_by`、`updated_by`，其中 `created_by`、`updated_by` 為不可空值、外鍵指向 `User` 主鍵；兩筆新增都成功，`created_at`、`updated_at` 自動有值，`created_by`、`updated_by` 有值且指向存在的 `User`；以可控時間讓修改發生在新增的至少一秒之後，修改後 `updated_at` 嚴格晚於修改前、等於修改當下的時間，`created_at` 不變；每一次錯誤寫入都被資料庫拒絕，資料筆數不變 | DBF-R14 |

## 待釐清

撰寫中發現、本規格不自行拍板的問題。若負責人判定需要團隊裁定，另開 issue 移到 `05-open-questions.md`，並在此留連結。

<a id="dbf-q1"></a>
- **DBF-Q1：CI PostgreSQL 相容性測試的範圍與機制**（已裁定，[#53](https://github.com/speko-tw/inspect-flow/issues/53)）。DBF-R10 原本只凍結最低範圍（對 PostgreSQL 跑 `alembic upgrade head`）；以下幾點 intents 沒有結論：
  - 範圍：只跑 migration，或再加上資料庫相關的整合測試，或整套後端測試都對 PostgreSQL 跑一次（[測試工具](../../intents/03-decisions-and-stack.md#stack-tests)只寫「PostgreSQL 相容性」）。
  - 頻率：[CI](../../intents/03-decisions-and-stack.md#stack-ci) 卡片寫「每次 PR」，[PR-03](../../intents/02-principles.md#pr-03) 寫「CI 定期跑」，兩處說法不同。
  - 機制：SKL-R04 要求 CI 只跑 `make check`、不另寫第二套檢查步驟。可以讓 `make check` 永遠需要 PostgreSQL（本機要有 Docker），或設定了 PostgreSQL 連線時才跑、CI 提供 service container（本機與 CI 結果可能不同），或另開 CI job（牴觸 SKL-R04，要改 `skeleton` 規格）。
  - PostgreSQL 版本：來源沒寫。
  - **裁定**（負責人，[#53](https://github.com/speko-tw/inspect-flow/issues/53)，2026-09-26）：範圍是 migration 加上資料庫相關的測試（`backend/tests/db/`），不跑整套後端測試；每個 PR 都跑；`make check` 有設定 PostgreSQL 連線時才跑，CI 提供 PostgreSQL service container，本機沒設定時略過、不強制安裝 Docker，仍只經由 `make check` 執行，符合 SKL-R04；版本採實作時 PostgreSQL 官方支援中的最新穩定主版本，版本號固定寫在 CI 設定裡，升級時另外調整。已知代價：本機沒設定 PostgreSQL 時會略過這一段，可能本機通過、CI 失敗，最晚在 PR 階段擋下。
  - **落地**：寫進 DBF-R10、DBF-AC08；實作由 T3（[#58](https://github.com/speko-tw/inspect-flow/issues/58)）負責。
<a id="dbf-q2"></a>
- **DBF-Q2：認證完成前，`created_by`、`updated_by` 怎麼填**（已裁定，[#54](https://github.com/speko-tw/inspect-flow/issues/54)）。`authentication`（P2）完成前沒有「目前使用者」，而 `User` 的第一筆資料也沒有建立者可以指。選項：欄位先允許空值，等 `authentication` 完成後再收緊；建立一個系統帳號，當作沒有登入者時的操作者；或把這兩欄延到 `authentication` 的 migration 才加。後兩者會牽動 [OQ-13](../../intents/05-open-questions.md#oq-13)、[OQ-08](../../intents/05-open-questions.md#oq-08)。
  - **裁定**（負責人，[#54](https://github.com/speko-tw/inspect-flow/issues/54)，2026-09-26）：不採上述三個選項。`created_by`、`updated_by` 不允許空白，必須指向某個 `User`。初始化指令建立兩個 Admin 帳號：內建 `admin`（`is_system`，`created_by` 指向自己）與負責人的個人帳號（`created_by` 指向 `admin`）；之後每個帳號都由某個 Admin 建立，所以 `created_by` 永遠有值。認證機制仍待 `authentication` 與 [OQ-13](../../intents/05-open-questions.md#oq-13)，在那之前帳號先建好但還不能登入。完整決策見 [#63](https://github.com/speko-tw/inspect-flow/issues/63)。
  - **落地**：資料庫約束寫進 DBF-R14、DBF-AC11；初始化指令與 `is_admin`、`is_system` 欄位歸 `domain-model`（負責人決定，[#65](https://github.com/speko-tw/inspect-flow/issues/65)，2026-09-26），本規格只引用。
<a id="dbf-q3"></a>
- **DBF-Q3：部分凍結規則 1 要不要補「只引用 ID 不算有關」的例外**。本規格把 `User`、`Project` 的字面命中判為無關（見[資料](#資料)段），但規則 1 原文是「字面可能指到它，就算有關」。寫 `domain-model` 時會再碰到同樣的判斷，要不要改規則由負責人決定。
- **migration 是否必須能 downgrade**：intents 沒有依據（[PR-13](../../intents/02-principles.md#pr-13) 的回滾以備份為主），本規格不要求；需要時另行提出。

## 變更紀錄

凍結後的「範圍變更」以上才記；一行寫改了什麼與 issue 連結。

- DBF-R14、DBF-AC11：依 DBF-Q2 裁定，`created_by`、`updated_by` 改為不得為空值、外鍵指向 `User`，並補上對應的驗收條件 — [#65](https://github.com/speko-tw/inspect-flow/issues/65)
- DBF-R10、DBF-AC08：依 DBF-Q1 裁定，PostgreSQL 相容性測試的範圍從只跑 migration 擴大為加上 `backend/tests/db/` 的測試，並定下每個 PR 執行、經由 `make check` 在設定 PostgreSQL 連線時執行、版本固定寫在 CI 設定 — [#53](https://github.com/speko-tw/inspect-flow/issues/53)
