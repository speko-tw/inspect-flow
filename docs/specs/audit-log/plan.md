# 稽核紀錄（audit-log）：實作計畫

**規格**：[spec.md](spec.md)

計畫記錄「為什麼這樣拆」。實作中發現更好的拆法就直接更新本檔（屬於「計畫調整」）；進度看 issue，不在這裡打勾。

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1 | `AuditLog` 資料表與「只能新增」的保護：model 用 `Base` 加 `id`、`created_at`、`created_by`，不繼承 `TimestampedBase`（它帶 `updated_at`）；`before`、`after` 用 `sa.JSON`；`entity_id` 用 `Uuid`、不設外鍵；在 SQLAlchemy 的 `before_cursor_execute` 事件統一攔截：送往資料庫的 SQL 若是對 `audit_logs` 的 `UPDATE` 或 `DELETE` 就拋錯，ORM、Core、`text()` 都走這一層，一處就涵蓋（掛在 `Engine` 類別上，測試自建的 engine 也適用）；新增一支 migration | `backend/app/models/audit_log.py`（新增）、`backend/app/models/__init__.py`（加一行 import）、`backend/alembic/versions/`（新增一支）、`backend/tests/db/test_audit_log.py`（新增） | — | ALG-AC01、ALG-AC02、ALG-AC03 | #215 |
| T2 | 寫入入口與事件目錄：單一入口從 `get_current_operator` 取操作者、從 `app.db.clock` 取時間；事件目錄登記第一批六種事件與 `authentication` 的兩種事件（`user.password_set`、`user.locked`）及宣告欄位；支援「系統事件」（操作者固定為內建 `admin`）與「每次都寫」兩個標記；拒絕未登記代碼、未宣告欄位、前後相同的修改；把 UUID 轉字串、集合排序 | `backend/app/services/audit.py`（新增）、`backend/tests/services/test_audit.py`（新增）、`backend/tests/db/test_audit_events.py`（新增，ALG-AC07 要在 PostgreSQL 上跑） | T1 | ALG-AC04、ALG-AC05、ALG-AC06、ALG-AC07、ALG-AC09、ALG-AC10、ALG-AC12 | #216 |
| T3 | 初始化指令不寫稽核紀錄的測試 | `backend/tests/cli/test_init_system_audit.py`（新增） | T1；[#134](https://github.com/speko-tw/inspect-flow/issues/134)（初始化指令，會建立 `backend/tests/cli/`） | ALG-AC08 | #217 |
| T4 | 寫入時機的驗收測試：只寫測試，透過 `domain-model` T7 的入口做 ALG-AC11 的操作序列，檢查紀錄 | `backend/tests/services/test_audit_write_timing.py`（新增） | T2；[#135](https://github.com/speko-tw/inspect-flow/issues/135)（DOM T7） | ALG-AC11 | #218 |

- 每個任務一個 PR 就能完成，並能單獨驗收；ALG-AC01～ALG-AC12 每條都被一個任務涵蓋。本次變更（[#259](https://github.com/speko-tw/inspect-flow/issues/259)）新增的 ALG-AC13～ALG-AC16 由下方[本次變更後續實作](#本次變更後續實作)涵蓋；ALG-AC17、ALG-AC18 與 `project_id` 擴充由 [Admin 唯讀查詢後續實作](#admin-唯讀查詢後續實作)涵蓋；T1～T4 的內容保持當時的樣子。
- 規格凍結後才依本表開 task issue；本 PR 只寫文件。
- T3 開工時若 T2 還沒合併，也可以併進 T2（只要 #134 已合併），在 T2 的 PR 更新本表。
- **和 `domain-model` T7（[#135](https://github.com/speko-tw/inspect-flow/issues/135)）的分工**：T7 依賴本計畫 T2，在 `Role`、角色指派、移出專案、`is_admin` 的入口呼叫寫入入口；DOM-R22 寫明由本規格驗收，所以驗收測試放在本計畫 T4，排在 #135 之後。T4 若發現 T7 漏寫或寫錯，開 `Bug` 修 `domain-model` 的 Service 檔，T4 本身不改 Service 檔（一個任務不跨兩份規格）。
- **和 `authentication` 的分工**：`user.password_set`、`user.locked` 由本計畫 T2 登記進目錄；實際寫入與寫入時機的驗收在 `authentication` 計畫的 T8、T11（AUT-AC49～AUT-AC51），它們都依賴 T2；本次變更後首次設定與 `admin` 重設指令的驗收在 AUT-AC62、AUT-AC56，見下方後續實作。

## 本次變更後續實作

依據：負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）。範圍變更；已完成的 T1～T4 不改寫，變動由下列任務在既有程式上處理。每個任務一個 PR，先開 issue 再動工。

| 任務 | 稽核相關的內容 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|
| C | 事件目錄登記 `user.username_changed`、`user.company_changed`（ALG-R19），並把 `user.password_set` 標為「得為系統事件」，寫入入口支援由呼叫端宣告系統事件（ALG-R18）；首次設定路由以系統事件寫 `user.password_set`，`admin` 重設指令沿用同一事件（ALG-R21）；改寫 T3 的測試（初始化與重跑都不寫稽核，ALG-AC08） | T2、`authentication` 計畫的 C | ALG-AC08、ALG-AC13、ALG-AC16 | [#261](https://github.com/speko-tw/inspect-flow/issues/261) |
| E | 使用者 Service（帳號名稱修改、公司連結變更）在同一個交易寫 `user.username_changed`、`user.company_changed`；換公司或解除連結時清空的欄位一併記下（ALG-R20） | C、`domain-model` 計畫的 E | ALG-AC14、ALG-AC15 | [#263](https://github.com/speko-tw/inspect-flow/issues/263) |
| H | 端到端：首次設定的系統事件、新增使用者、改帳號名稱、換公司，最後讀稽核紀錄核對筆數與操作者 | C、E | 上列各 AC 的端到端串接 | [#266](https://github.com/speko-tw/inspect-flow/issues/266) |

**對既有任務的影響**：

| 既有任務 | 影響 | 由誰接手 |
|---|---|---|
| T2（寫入入口與事件目錄） | 入口新增「呼叫端宣告系統事件」的路徑，只限目錄標為「得為系統事件」的事件；`user.locked` 的固定系統事件做法不變 | C |
| T3（初始化指令不寫稽核） | 測試改為對新的初始化指令（不詢問輸入、不設密碼）與重跑各驗一次 | C |
| T4（寫入時機驗收） | ALG-AC11 的操作序列不變；帳號名稱與公司連結另由 ALG-AC14、ALG-AC15 驗收，不併進 T4 | E |

- 這些任務的檔案清單，開 issue 時依當時的程式碼盤點，不在這裡預先寫死。
- 事件目錄 `backend/app/services/audit.py` 是共用檔案：C 只加 `user.*` 的兩個新條目與標記，E 不改目錄，只呼叫；兩者不同時進行。

## Admin 唯讀查詢後續實作

依據：[ALG-Q2 負責人裁定](https://github.com/speko-tw/inspect-flow/issues/107#issuecomment-5977843511)。本次 #411 只同步規格與計畫，不實作 API 或畫面；待 #411 合併後，由下列任務依 [admin-dashboard 計畫 T5b](../admin-dashboard/plan.md#任務) 落地，避免兩份計畫定出不同契約。

| 任務 | 稽核相關的內容 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|
| T5b | 新增 `AuditLog.project_id` 可空值欄位與索引的 migration（既有資料不回填）；寫入入口及各專案事件呼叫端依 ALG-R24 填值，無專案事件留空；實作 Admin 唯讀稽核查詢 API 與管理後台頁面，依專案、操作者、時間及事件類型篩選，採穩定 cursor 分頁，合法但不存在的 `project_id` 回 200 空頁。原列檔案範圍依 [admin-dashboard T5b](../admin-dashboard/plan.md#任務)，另需 `backend/app/models/audit_log.py`、`backend/alembic/versions/`、稽核寫入入口及對應測試；#412 開工時依規格流程同步其 issue／plan 檔案清單 | #411 合併；`authentication` Admin 存取檢查 | ALG-AC01（新增欄位）、ALG-AC17、ALG-AC18；ADM-AC06、ADM-AC07、ADM-AC13 | [#412](https://github.com/speko-tw/inspect-flow/issues/412) |

## 兩層權限模型後續實作

依據：負責人裁定（[#538](https://github.com/speko-tw/inspect-flow/issues/538)，2026-10-09 與 2026-10-10，意圖見 [KD-69](../../intents/03-decisions-and-stack.md#kd-69)）。本次是意圖變更跟進；規格合併後才開任務，每個任務一個 PR，先開 issue 再動工。

| 任務 | 內容 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|
| T6 | 事件目錄登記模組權限事件、專案事件、`user.external_flag_changed`，補 `user.active_changed` 的欄位與「得為系統事件」；授權拒絕與違規指派在獨立交易寫入（ALG-R25～ALG-R28）；授權事件含 `source`；本任務只驗事件目錄與獨立交易寫入入口，端到端驗收由 `domain-model` 任務 L、N、O 承接 | 本計畫 T2 | ALG-AC19～ALG-AC24、ALG-AC26、ALG-AC27 | 待開 |
| T7 | 操作者身分快照：`AuditLog.actor_snapshot` 不可空值欄位的 migration（既有紀錄回填一次）與寫入入口組成快照（ALG-R29）；`domain-model` DOM-R74 的驗收 | T6；`domain-model` 任務 L（`User.is_external_collaborator`，快照需要此欄位） | ALG-AC25、DOM-AC71 | 待開 |

## 本公司角色後續實作

依據：[#559](https://github.com/speko-tw/inspect-flow/issues/559) 的負責人裁定。`project.updated` 與 `project.created` 沿用，不新增事件，只補欄位。

| 任務 | 內容 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|
| T8 | 事件目錄補 `project.created` 的 `company_role`，以及 `project.updated` 的 `company_role`、`company_role_change_reason` 欄位；端到端驗收由 `domain-model` 任務 R 承接 | T6 | ALG-AC28 | [#559](https://github.com/speko-tw/inspect-flow/issues/559) |

## 並行分組

- 第 1 波：T1。
- 第 2 波：T2（依賴 T1）；T3（依賴 T1、#134）。兩者檔案不重疊，可並行。
- 第 3 波：T4（依賴 T2 與 #135；#135 本身依賴 T2）。

碰到[共用檔案](../README.md#parallel)的地方：

- Alembic migration 鏈：只有 T1 新增一支。migration 只用 SQLAlchemy 內建型別（`sa.Uuid`、`sa.DateTime(timezone=True)`、`sa.String`、`sa.JSON`），不 import `app`（#139）；合併前若 head 已變，rebase 後改接 `down_revision`。
- `backend/app/models/__init__.py`：T1 加一行 import；和同時期的 `domain-model` T3（`Role`、`ProjectMember`）會碰同一個檔案，後合併的一方 rebase。
- 事件目錄（`backend/app/services/audit.py`）：之後其他規格登記事件時各自只加自己的條目，不改別人的。

## 風險

- **攔截靠比對 SQL 文字**：`before_cursor_execute` 拿到的是最後的 SQL 字串，要能辨認帶引號的表名（`"audit_logs"`）、`DELETE FROM`、大小寫與前置空白，也不能誤擋 `INSERT` 或 `SELECT`。ALG-AC03 在 SQLite 與 PostgreSQL 都跑 ORM、Core 與 `text()` 的各種寫法（引號、schema 前綴、大小寫、前置空白），並確認新增與讀取照常。後端以外直接連資料庫（例如 `sqlite3` 指令）仍改得動，要防這條需要資料庫層保護，本規格不要求（PR-03）。
- **名稱混淆**：既有的 `backend/app/models/_audit.py` 是 `created_by`／`updated_by` 的 `AuditMixin`，和稽核紀錄無關。新檔案用 `audit_log.py`、`services/audit.py`，T1 在 docstring 註明兩者的差別；`AuditLog` 不套用 `AuditMixin`（它帶 `updated_by`）。
- **JSON 在兩種資料庫的行為不同**：SQLite 存成文字，PostgreSQL 是 `JSON` 型別。只用 `sa.JSON`，不用 PostgreSQL 的 `JSONB`；不在 SQL 裡查 JSON 內容。ALG-AC07 放在 `backend/tests/db/`，CI 會在 PostgreSQL 上讀回比對。
- **請求中沒有登入者**：`get_current_operator` 會拋錯，整個交易回滾（AUT-R09），不會寫出操作者錯誤的紀錄。ALG-AC04 守這一點。
- **資料量**：沒有保存期限（待 [ALG-Q1](spec.md#alg-q1)），紀錄會一直增加。第一批事件只有權限變更，量很小；[PR-12](../../intents/02-principles.md#pr-12) 的資料庫備份自然涵蓋這張表。

## 驗證（Proof）

| AC | 驗證方式 |
|---|---|
| ALG-AC01 | `backend/tests/db/test_audit_log.py`：inspector 檢查欄位、可空值、外鍵；逐欄空值與外鍵不存在的新增被拒絕 |
| ALG-AC02 | 同上：外鍵只有 `created_by`；`entity_id` 指向不存在 UUID 仍可新增 |
| ALG-AC03 | 同上：ORM 四種、Core 兩種與 `text()` 五種寫法 × `UPDATE`／`DELETE`，共 16 次都拋錯，重讀資料不變；`text()` 的 `INSERT`、`SELECT` 與 ORM 新增成功（CI 也在 PostgreSQL 跑） |
| ALG-AC04 | `backend/tests/services/test_audit.py`：以 `set_clock` 固定時間；請求範圍外、綁定 U、無登入者三種情況；檢查入口函式的參數沒有操作者與時間 |
| ALG-AC05 | 同上：用 `unit_of_work` 包住 `Company` 修改與寫紀錄，兩種失敗後重讀 |
| ALG-AC06 | 同上：三種錯誤寫入都拋錯、筆數不變；掃描目錄的宣告欄位名稱 |
| ALG-AC07 | `backend/tests/db/test_audit_events.py`：六種事件寫入後讀回比對（CI 也在 PostgreSQL 跑） |
| ALG-AC08 | `backend/tests/cli/test_init_system_audit.py`：執行初始化指令與重跑後 `audit_logs` 為 0 筆（本次變更後改測新的初始化指令，C） |
| ALG-AC09 | `backend/tests/services/test_audit.py`：測試內登記事件、寫入讀回，比對 `alembic heads` 與 inspector 欄位；fixture 還原目錄 |
| ALG-AC10 | 同上：所有代碼符合格式，「資料」段等於 `entity_type` |
| ALG-AC11 | `backend/tests/services/test_audit_write_timing.py`：依序操作後比對紀錄的筆數、代碼順序與內容；被拒絕與範圍外的操作沒有紀錄 |
| ALG-AC12 | `backend/tests/services/test_audit.py`（T2）：以沒有登入者與已綁定 U 的請求範圍各寫入，斷言兩種範圍的 `user.locked` 操作者都是內建 `admin`、其他事件在沒有登入者時被拒絕、`user.password_set` 前後相同仍寫入 |
| ALG-AC13 | `backend/tests/services/test_audit.py`（C）：以 `set_clock` 固定時間；三種請求範圍 × 是否宣告系統事件；斷言宣告只對目錄標記的事件有效 |
| ALG-AC14 | `backend/tests/services/test_audit_user_events.py`（E，新增）：改名（含大小寫）、相同值、重名被拒絕三種，斷言筆數、`created_by` 與小寫的 `before`、`after`；掃描目錄的宣告欄位 |
| ALG-AC15 | 同上：換公司、單獨改部門、清空後解除連結、連結公司、工號重複被拒絕，斷言筆數與四欄內容 |
| ALG-AC16 | `backend/tests/cli/test_reset_admin_password_audit.py`（C，新增）：執行重設指令兩次（一次成功、一次輸入不同），斷言一筆 `user.password_set` 與目錄沒有新增事件代碼 |
| ALG-AC17 | #412（T5b）：以未登入、非 Admin、Admin 呼叫查詢 API 並操作頁面；核對 401／403 與成功查詢前後 `audit_logs` 不變 |
| ALG-AC18 | #412（T5b）：以 migration 前歷史事件、新的有專案與無專案事件（含刪除／修改時 `before`／`after` 無 `project_id`）驗證欄位填值、空值及索引；組合 `project_id`、`actor_id`、`event_type`、時間範圍並跨 cursor 翻頁，核對 AND、精確比對、降冪排序、無重複遺漏、無專案事件及歷史事件在專案篩選時被排除、不帶專案時仍可查、不存在專案 200 空頁、反向時間範圍與無效輸入 422；與 ADM-AC07、ADM-AC13 共用驗證 |

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
