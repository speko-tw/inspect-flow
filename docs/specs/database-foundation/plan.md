# 資料庫基礎（database-foundation）：實作計畫

**規格**：[spec.md](spec.md)

計畫記錄「為什麼這樣拆」。實作中發現更好的拆法就直接更新本檔（屬於「計畫調整」）；進度看 issue，不在這裡打勾。

本計畫只涵蓋 spec 標頭「凍結範圍」內的第一段（DBF-R01～DBF-R14、DBF-AC01～DBF-AC11）。第二段（`Inspection Template`、`Template Version`）在 G-01 裁定、擴大凍結範圍後，再於同一份計畫補任務。

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1 | 資料庫連線與共用基底：新增 SQLAlchemy 2.x 與 Alembic 依賴（一次加齊，避免兩個 PR 都改 lockfile）；讀取資料庫連線環境變數，未設定時用本機 SQLite 預設路徑；SQLite 連線初始化設定 `foreign_keys = ON` 與 WAL，只在 SQLite 方言上執行，每一處 `PRAGMA` 以 `# db-dependency: sqlite` 註解標註資料庫相依性；`created_at`、`updated_at` 的時間來源要能在測試中替換（供 DBF-AC11 使用）；宣告式 model 基底與共用欄位（UUID 主鍵，版本依 KD-07 評估 UUIDv7 後選定並記在程式註解；`created_at`、`updated_at` 以含時區型別存 UTC 並自動填寫）；Service 層使用的交易單位（成功提交、例外回滾）。測試用暫存 SQLite 與測試專用 metadata | `backend/pyproject.toml`、`backend/uv.lock`、`backend/app/db/`（新增：設定、engine、基底、交易單位）、`.env.example`（新增變數說明）、`backend/tests/db/`（新增）、`backend/.gitignore`（忽略預設 SQLite 資料目錄 `data/`） | — | DBF-AC04、DBF-AC05、DBF-AC06、DBF-AC07 | #56 |
| T2 | Alembic 初始化：`alembic.ini`、`env.py` 綁定 T1 的 metadata 並讀同一個連線環境變數；第一支 migration 為空的 baseline（不含任何資料表）；測試：空 SQLite 執行 `alembic upgrade head` 成功且只有一個 head；靜態掃描 `backend/app` 與 Alembic 目錄，不得有資料庫驅動 import 與 `create_all` 呼叫 | `backend/alembic.ini`（新增）、`backend/alembic/`（新增，含 `env.py` 與 baseline migration）、`backend/tests/db/test_migrations.py`、`backend/tests/db/test_db_access_rules.py`（新增）、`backend/pyproject.toml`（僅在 pyright／ruff 需要納入 `alembic` 目錄時調整設定，不改依賴） | T1 | DBF-AC01、DBF-AC02、DBF-AC03 | #57 |
| T3 | CI PostgreSQL 相容性測試：CI 提供 PostgreSQL，對它執行 `alembic upgrade head`，失敗時 check 失敗；加入 PostgreSQL 驅動依賴。執行機制與範圍依 [DBF-Q1](spec.md#dbf-q1) 的裁定 | `.github/workflows/ci.yml`、`Makefile`、`backend/pyproject.toml`、`backend/uv.lock`、`backend/tests/db/`（視裁定新增 PostgreSQL 測試）；若裁定需要另開 CI job，另需 `skeleton` 規格的範圍變更 | T2；[DBF-Q1](spec.md#dbf-q1) 裁定 | DBF-AC08 | #58 |
| T4 | `User`、`Project` 資料表：兩個 model 繼承 T1 的基底，含 `employee_no`、`project_code`（唯一約束）與 `created_by`、`updated_by`（外鍵指向 `User` 的 UUID，空值與填寫規則依 [DBF-Q2](spec.md#dbf-q2)）；業務欄位依 `domain-model` 已凍結的定義；新增一支 migration | `backend/app/models/`（新增 `user.py`、`project.py`）、`backend/alembic/versions/`（新增一支 migration）、`backend/tests/db/test_user_project.py`（新增） | T2；`domain-model` 部分凍結 `User`、`Project`（尚無 issue）；[DBF-Q2](spec.md#dbf-q2) 裁定 | DBF-AC09、DBF-AC10、DBF-AC11 | #59 |

- 每個任務一個 PR 就能完成，並能單獨驗收。
- 每個任務至少對應一條 AC；DBF-AC01～DBF-AC11 每條都被一個任務涵蓋。
- T3、T4 開 task issue 時，若依賴的裁定或 `domain-model` 尚未完成，issue 標 `blocked` 並寫明原因。
- 依 plan 開 task issue 時才建立上表的 issue 編號；本 PR 只寫文件，不開 task issue。
- 第一段所有任務合併、且 DBF-AC01～DBF-AC11 都有對應驗證後，規格仍是「部分凍結」（第二段未凍結），不改為「已完成」；第二段也完成後才改。

## 並行分組

依「改動的檔案」與「依賴」分波；同一波內的任務檔案不重疊，也互不依賴。

- 第 1 波：T1。
- 第 2 波：T2（依賴 T1 的 metadata 與連線設定）。
- 第 3 波：T3、T4（都只依賴 T2，另各自等裁定；T3 改 CI、`Makefile`、依賴檔，T4 改 model 與 migration，檔案不重疊）。

碰到[共用檔案](../README.md#parallel)的地方：

- `backend/uv.lock`、`backend/pyproject.toml`：T1 一次加入 SQLAlchemy 與 Alembic；T3 加 PostgreSQL 驅動。兩者不同波。若 T3 開工時有其他 PR 也在改 lockfile，依共用檔案規則先合併的一方優先，另一方 rebase 後重新產生 lockfile。
- Alembic migration 鏈：T2 建立 baseline，T4 新增一支；每個 PR 最多一支。T4 合併前若 `main` 已有其他 migration，先 rebase 並把 `down_revision` 改接到最新 head。
- 設定檔：`.env.example` 只有 T1 改；`backend/app/main.py` 本計畫預計不改（交易單位由之後的功能規格在 Service 層取用）。

## 風險

- **T3 被 DBF-Q1 卡住**：PostgreSQL 相容性越晚接上，越可能累積只在 SQLite 上能跑的 migration。降低方式：T1、T2 只用 SQLAlchemy 的通用型別，不寫 raw SQL（PRAGMA 除外，且只在 SQLite 連線上執行）；T4 若比 T3 早完成，PR 說明要記下「尚未在 PostgreSQL 驗證」，等 T3 合併後由 T3 的 CI 補驗。
- **T4 同時等 `domain-model` 與 DBF-Q2**：`domain-model` 要寫業務欄位，會碰到 OQ-01、OQ-02 的佔位欄位問題，時程不確定。T1～T3 不依賴 T4，可以先做完。
- **UUID 在 SQLite 與 PostgreSQL 的儲存型別不同**：SQLite 沒有原生 UUID 型別。T1 用 SQLAlchemy 的跨資料庫 UUID 型別，並在 T3 的 PostgreSQL 驗證中確認 migration 產出的欄位型別。
- **含時區時間在 SQLite 上會失去時區資訊**：SQLite 沒有原生時區型別，讀回時可能變成不帶時區的值。T1 的 DBF-AC06 測試專門守這一點，寫入非 UTC 時間後讀回比對。
- **WAL 只對檔案資料庫有效**：記憶體資料庫的 `journal_mode` 不會是 `wal`。DBF-AC05 的測試一律用暫存檔案資料庫。

## 驗證（Proof）

| AC | 驗證方式 |
|---|---|
| DBF-AC01 | `backend/tests/db/test_db_access_rules.py`：以 `ast` 掃描 `backend/app`、`backend/alembic` 的 import，斷言沒有 `sqlite3` 與 PostgreSQL 驅動模組；`make check` |
| DBF-AC02 | `backend/tests/db/test_migrations.py`：在暫存目錄的空 SQLite 上以 Alembic API 執行 upgrade head，斷言 head 恰一個且 `alembic_version` 相符；`make check` |
| DBF-AC03 | `backend/tests/db/test_db_access_rules.py`：掃描同一批目錄，斷言沒有 `create_all` 呼叫；`make check` |
| DBF-AC04 | `backend/tests/db/`：以 `monkeypatch` 設定連線環境變數為暫存路徑，斷言檔案被建立；清掉變數時斷言使用預設路徑；讀 `.env.example` 斷言列出該變數；`make check` |
| DBF-AC05 | `backend/tests/db/`：對暫存檔案資料庫取得連線，查兩個 PRAGMA；以非 SQLite 方言（例如 PostgreSQL 方言的 engine，用假的 DBAPI 連線記錄執行過的語句，不需真的連線）觸發同一段連線初始化，斷言沒有執行任何 `PRAGMA`；掃描 `backend/app` 原始碼，斷言每一行含 `PRAGMA` 的語句在同一行或上一行有 `# db-dependency: sqlite` 標註；`make check` |
| DBF-AC06 | `backend/tests/db/`：測試專用資料表寫入 `+08:00` 時間後讀回，斷言帶時區且 UTC 時刻相同，再以 `app.api.time_format.format_utc` 輸出斷言以 `Z` 結尾；`make check` |
| DBF-AC07 | `backend/tests/db/`：交易單位內寫兩筆後拋例外，斷言兩筆都不存在；不拋例外時斷言兩筆都存在；`make check` |
| DBF-AC08 | CI 的 PostgreSQL 步驟；PR 內附一次故意失敗的 CI 執行紀錄（例如在草稿 commit 放一支 PostgreSQL 不接受的 migration），證明失敗會讓 check 失敗 |
| DBF-AC09 | `backend/tests/db/test_user_project.py`：upgrade head 後以 inspector 檢查主鍵欄位與型別，新增資料後以 `uuid.UUID(...)` 解析主鍵；`make check`，PostgreSQL 由 T3 的 CI 補驗 |
| DBF-AC10 | `backend/tests/db/test_user_project.py`：重複業務編號寫入時斷言拋出 `IntegrityError` 且筆數不變；`make check` |
| DBF-AC11 | `backend/tests/db/test_user_project.py`：斷言四個欄位存在、新增時時間有值、以可控時間（注入時鐘或凍結時間的測試工具）讓修改時間比新增時間晚一秒，斷言修改後 `updated_at` 嚴格晚於修改前且等於注入的時間、`created_at` 不變；`make check` |

## 考慮過但沒採用的做法

- **T1、T2 合成一個任務**：可以少一個 PR，但 T1 改 lockfile、T2 建 migration 鏈，都是共用檔案，合在一起會讓 PR 同時佔住兩類共用檔案、審查範圍也變大；拆開後 T1 合併完，T2 就能獨立審 migration 設定。
- **T4 先用來源 §12.1–12.2 的佔位欄位建表**：可以不等 `domain-model`，但負責人已決定業務欄位由 `domain-model` 定義（#51）；先建佔位欄位等於替 `domain-model` 做決定，之後還可能要用 migration 改掉。
- **CI 另開一個 PostgreSQL job**：最直接，但牴觸 SKL-R04「不另寫第二套檢查步驟」，列入 [DBF-Q1](spec.md#dbf-q1) 的選項，由負責人決定。
