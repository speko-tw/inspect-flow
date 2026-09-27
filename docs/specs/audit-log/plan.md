# 稽核紀錄（audit-log）：實作計畫

**規格**：[spec.md](spec.md)

計畫記錄「為什麼這樣拆」。實作中發現更好的拆法就直接更新本檔（屬於「計畫調整」）；進度看 issue，不在這裡打勾。

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1 | `AuditLog` 資料表與「只能新增」的保護：model 用 `Base` 加 `id`、`created_at`、`created_by`，不繼承 `TimestampedBase`（它帶 `updated_at`）；`before`、`after` 用 `sa.JSON`；`entity_id` 用 `Uuid`、不設外鍵；在 SQLAlchemy 的 `before_cursor_execute` 事件統一攔截：送往資料庫的 SQL 若是對 `audit_logs` 的 `UPDATE` 或 `DELETE` 就拋錯，ORM、Core、`text()` 都走這一層，一處就涵蓋（掛在 `Engine` 類別上，測試自建的 engine 也適用）；新增一支 migration | `backend/app/models/audit_log.py`（新增）、`backend/app/models/__init__.py`（加一行 import）、`backend/alembic/versions/`（新增一支）、`backend/tests/db/test_audit_log.py`（新增） | — | ALG-AC01、ALG-AC02、ALG-AC03 | #? |
| T2 | 寫入入口與事件目錄：單一入口從 `get_current_operator` 取操作者、從 `app.db.clock` 取時間；事件目錄登記第一批五種事件與宣告欄位；拒絕未登記代碼、未宣告欄位、前後相同的修改；把 UUID 轉字串、集合排序 | `backend/app/services/audit.py`（新增）、`backend/tests/services/test_audit.py`（新增）、`backend/tests/db/test_audit_events.py`（新增，ALG-AC07 要在 PostgreSQL 上跑） | T1 | ALG-AC04、ALG-AC05、ALG-AC06、ALG-AC07、ALG-AC09、ALG-AC10 | #? |
| T3 | 初始化指令不寫稽核紀錄的測試 | `backend/tests/cli/test_init_system_audit.py`（新增） | T1；[#134](https://github.com/speko-tw/inspect-flow/issues/134)（初始化指令，會建立 `backend/tests/cli/`） | ALG-AC08 | #? |

- 每個任務一個 PR 就能完成，並能單獨驗收；ALG-AC01～ALG-AC10 每條都被一個任務涵蓋。
- 規格凍結後才依本表開 task issue；本 PR 只寫文件。
- T3 開工時若 T2 還沒合併，也可以併進 T2（只要 #134 已合併），在 T2 的 PR 更新本表。
- **下游**：`domain-model` 的 T7（[#135](https://github.com/speko-tw/inspect-flow/issues/135)）依賴 T2，在它的入口呼叫寫入入口並驗收寫入時機（DOM-R22）。`role.created`、`project_member.roles_changed` 目前沒有任何計畫提供寫入入口，見 spec 的[寫入時機](spec.md#寫入時機)。

## 並行分組

- 第 1 波：T1。
- 第 2 波：T2（依賴 T1）；T3（依賴 T1、#134）。兩者檔案不重疊，可並行。

碰到[共用檔案](../README.md#parallel)的地方：

- Alembic migration 鏈：只有 T1 新增一支。migration 只用 SQLAlchemy 內建型別（`sa.Uuid`、`sa.DateTime(timezone=True)`、`sa.String`、`sa.JSON`），不 import `app`（#139）；合併前若 head 已變，rebase 後改接 `down_revision`。
- `backend/app/models/__init__.py`：T1 加一行 import；和同時期的 `domain-model` T3（`Role`、`ProjectMember`）會碰同一個檔案，後合併的一方 rebase。
- 事件目錄（`backend/app/services/audit.py`）：之後其他規格登記事件時各自只加自己的條目，不改別人的。

## 風險

- **攔截靠比對 SQL 文字**：`before_cursor_execute` 拿到的是最後的 SQL 字串，要能辨認帶引號的表名（`"audit_logs"`）、`DELETE FROM`、大小寫與前置空白，也不能誤擋 `INSERT` 或 `SELECT`。ALG-AC03 在 SQLite 與 PostgreSQL 各跑八種寫法，並確認新增與讀取照常。後端以外直接連資料庫（例如 `sqlite3` 指令）仍改得動，要防這條需要資料庫層保護，本規格不要求（PR-03）。
- **名稱混淆**：既有的 `backend/app/models/_audit.py` 是 `created_by`／`updated_by` 的 `AuditMixin`，和稽核紀錄無關。新檔案用 `audit_log.py`、`services/audit.py`，T1 在 docstring 註明兩者的差別；`AuditLog` 不套用 `AuditMixin`（它帶 `updated_by`）。
- **JSON 在兩種資料庫的行為不同**：SQLite 存成文字，PostgreSQL 是 `JSON` 型別。只用 `sa.JSON`，不用 PostgreSQL 的 `JSONB`；不在 SQL 裡查 JSON 內容。ALG-AC07 放在 `backend/tests/db/`，CI 會在 PostgreSQL 上讀回比對。
- **請求中沒有登入者**：`get_current_operator` 會拋錯，整個交易回滾（AUT-R09），不會寫出操作者錯誤的紀錄。ALG-AC04 守這一點。
- **資料量**：沒有保存期限（待 [ALG-Q1](spec.md#alg-q1)），紀錄會一直增加。第一批事件只有權限變更，量很小；[PR-12](../../intents/02-principles.md#pr-12) 的資料庫備份自然涵蓋這張表。

## 驗證（Proof）

| AC | 驗證方式 |
|---|---|
| ALG-AC01 | `backend/tests/db/test_audit_log.py`：inspector 檢查欄位、可空值、外鍵；逐欄空值與外鍵不存在的新增被拒絕 |
| ALG-AC02 | 同上：外鍵只有 `created_by`；`entity_id` 指向不存在 UUID 仍可新增 |
| ALG-AC03 | 同上：ORM flush、ORM 批次、Core、`text()` 的修改與刪除共八種都拋錯，重讀資料不變；新增與讀取不受影響 |
| ALG-AC04 | `backend/tests/services/test_audit.py`：以 `set_clock` 固定時間；請求範圍外、綁定 U、無登入者三種情況；檢查入口函式的參數沒有操作者與時間 |
| ALG-AC05 | 同上：用 `unit_of_work` 包住 `Company` 修改與寫紀錄，兩種失敗後重讀 |
| ALG-AC06 | 同上：三種錯誤寫入都拋錯、筆數不變；掃描目錄的宣告欄位名稱 |
| ALG-AC07 | `backend/tests/db/test_audit_events.py`：五種事件寫入後讀回比對（CI 也在 PostgreSQL 跑） |
| ALG-AC08 | `backend/tests/cli/test_init_system_audit.py`：執行初始化指令後 `audit_logs` 為 0 筆 |
| ALG-AC09 | `backend/tests/services/test_audit.py`：測試內登記事件、寫入讀回，比對 `alembic heads` 與 inspector 欄位；fixture 還原目錄 |
| ALG-AC10 | 同上：所有代碼符合格式，「資料」段等於 `entity_type` |

## 考慮過但沒採用的做法

| 做法 | 沒採用的理由 |
|---|---|
| 資料庫 trigger 或權限（`REVOKE UPDATE`）擋修改 | 要寫資料庫專用 SQL（PR-03 應避免），SQLite 也沒有權限控管 |
| 雜湊鏈等防竄改設計 | intents 與 #126 都沒有要求；之後要加可以新增欄位，不影響現有紀錄 |
| 每張表一份歷史表，或事件溯源 | 第一階段非目標（Complex Event Sourcing，架構基準 §34）；完整 Audit Trail 屬延後能力（§35） |
| 只存一個 `changes` 差異欄位 | 04-glossary 寫的是「修改前後內容」；分開 `before`、`after` 讀起來直接 |
| `entity_id` 設外鍵 | 被記錄的資料刪除時會被擋下或連帶刪掉紀錄（ALG-R03） |
| 刪除角色時替每位成員各寫一筆 | 一次刪除可能寫出大量紀錄；`role.deleted` 的 `project_member_ids` 已能還原 |
| 事件代碼存成資料表 | 事件由程式寫入，放程式裡的目錄就能在測試中檢查；存資料表還要多一支 migration 與管理入口 |
