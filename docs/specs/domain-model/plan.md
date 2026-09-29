# 領域模型（domain-model）：實作計畫

**規格**：[spec.md](spec.md)

計畫記錄「為什麼這樣拆」。實作中發現更好的拆法就直接更新本檔（屬於「計畫調整」）；進度看 issue，不在這裡打勾。

本計畫涵蓋 spec 標頭「凍結範圍」內的部分（DOM-R01～DOM-R36、DOM-R40～DOM-R54、DOM-AC01～DOM-AC46，已被取代的條目除外）。T1～T8 是本次變更（[#259](https://github.com/speko-tw/inspect-flow/issues/259)）之前完成的任務，內容保持當時的樣子；本次變更對 `User`、`Company`、初始化的改寫，由[本次變更後續實作](#本次變更後續實作)的 B～H 接手。DOM-R22（稽核紀錄）的資料模型與驗收由 `audit-log` 規格定義（[#203](https://github.com/speko-tw/inspect-flow/issues/203)），本計畫不建稽核紀錄的資料表。會寫入權限與角色變更的入口集中在 T7，T7 等 `audit-log` T2（[#216](https://github.com/speko-tw/inspect-flow/issues/216)）建好稽核紀錄的寫入入口後才開工；其餘任務只建資料表、只做讀取，或依 DOM-R22 不寫稽核紀錄（T6 初始化）。`Project` 業務欄位（DOM-R40～DOM-R44）由 T8 負責，依 [OQ-01](../../intents/05-open-questions.md#oq-01) 裁定（[#246](https://github.com/speko-tw/inspect-flow/issues/246)）從草稿轉為正式後才開工。其他實體在擴大凍結範圍後，再於同一份計畫補任務。

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1 | （本次變更後部分改寫，見[本次變更後續實作](#本次變更後續實作)；下列是當時完成的內容，不改寫歷史） `Company` 資料表：model 繼承 `database-foundation` 的共用基底（UUID 主鍵、建立與修改紀錄），`created_by`、`updated_by` 為不可空值、指向 `User` 的外鍵；`code` 唯一、`tax_id` 可空值且有值時唯一、`kind` 以 CHECK 約束限定 `internal`、`customer`、`parent_id` 自參照外鍵並以 CHECK 約束禁止指向自己；`code`、`name`、`tax_id` 依 DOM-R29 設長度上限，並在 model 寫入前檢查長度與格式（DOM-R31）；新增一支 migration | `backend/app/models/company.py`（新增）、`backend/app/models/__init__.py`（加一行 import，讓 `Company` 登記到 `Base.metadata`；檔案由 #59 建立）、`backend/alembic/versions/`（新增一支）、`backend/tests/db/test_company.py`（新增）、`backend/tests/db/test_narrow_business_number_lengths.py`（修改，檔案由 #140 建立：round-trip 測試的 downgrade 改用明確的 revision，本任務的 migration 成為 head 後，相對的 `"-1"` 就不再退到 #140 的 migration） | #59（`User` 資料表）；[DOM-Q7](spec.md#dom-q7) 裁定 | DOM-AC11、DOM-AC12、DOM-AC20 | #129 |
| T2 | （本次變更後部分改寫，見[本次變更後續實作](#本次變更後續實作)；下列是當時完成的內容，不改寫歷史） `User` 業務欄位：在 #59 建好的 `User` 資料表加上基本欄位（`company_id` 為不可空值、指向 `Company` 的外鍵）、聯絡與補充欄位、`is_admin`、`is_system`、外部身分預留欄位；`email` 不分大小寫的唯一約束（依 DOM-R02，採 `lower(email)` 的唯一索引，`email` 原樣存放、不另設正規化欄位；理由見[風險](#風險)）；`auth_source` 的 CHECK 約束、`external` 時外部欄位必填的 CHECK 約束、`external_source` 與 `external_id` 組合的唯一約束；`company_id` 與 `Company.created_by` 互相引用，外鍵設為可延後到提交時才檢查（見[風險](#風險)）；新增的字串欄位依 DOM-R28 設長度上限；DOM-R28 列出的所有欄位，含 #59 建立的 `employee_no`，都在 model 寫入前檢查長度，`email` 另檢查格式（DOM-R31），並有對應測試；`employee_no` 的欄位型別由 #140 的 migration 收緊（或依 #140 併入本任務的 migration）；新增一支 migration | `backend/app/models/user.py`（修改，檔案由 #59 建立）、`backend/alembic/versions/`（新增一支）、`backend/tests/db/test_user_fields.py`（新增）、`backend/tests/db/conftest.py`（修改：加共用的「同一交易建立帳號與公司」helper，T3、T4 沿用）、`backend/tests/db/test_user_project.py`、`backend/tests/db/test_auth_tables.py`、`backend/tests/db/test_company.py`、`backend/tests/db/test_narrow_business_number_lengths.py`（修改：`User` 新增必填欄位後，改用共用 helper 建立帳號；#140 的往返測試改為只往返到 `22bfdd8a72a4`，因為 head 的 `company_id` 沒有預設值，既有資料列無法跨越本任務的 migration 重建） | T1；[#140](https://github.com/speko-tw/inspect-flow/issues/140)（`employee_no` 收緊到 16；若本任務先動工，依 #140 併入本任務的 migration）；[DOM-Q2](spec.md#dom-q2)、[DOM-Q7](spec.md#dom-q7) 裁定 | DOM-AC01、DOM-AC02、DOM-AC03、DOM-AC07、DOM-AC19 | #130 |
| T3 | `Role`、`ProjectMember` 資料表：`Role` 與 `ProjectMember` 繼承共用基底；`Role` 的權限代碼存在子表（`role_id`、權限代碼，組合唯一，刪除 `Role` 時一併刪除）；`ProjectMember` 的 `project_id`、`user_id` 為不可空值外鍵、組合唯一；角色指派存在關聯表（`project_member_id`、`role_id`，組合唯一；刪除 `Role` 或 `ProjectMember` 時都由資料庫外鍵的 `ON DELETE CASCADE` 刪除指派，ORM 關聯設 `passive_deletes`，不由 ORM 自行刪除；成員可以沒有指派，DOM-R36）；權限代碼登記表 `PermissionCode`（比照 `ErrorCode` 的列舉，初始沒有成員，DOM-R35），model 寫入前拒絕未登記的代碼；`Role.name` 不分大小寫的唯一約束（依 DOM-R34，比照 T2 的 `email` 採 `lower(name)` 的唯一索引，`name` 原樣存放）；`Role.name` 與權限代碼依 DOM-R30 設長度上限，並在 model 寫入前檢查長度與權限代碼格式（DOM-R31）；新增一支 migration | `backend/app/permission_codes.py`（新增：登記表）、`backend/app/models/role.py`、`backend/app/models/project_member.py`（新增）、`backend/app/models/__init__.py`（加 import）、`backend/alembic/versions/`（新增一支）、`backend/tests/db/test_role_member.py`（新增）、`backend/tests/conftest.py`（新增：測試用登記表 fixture，T5、T7 沿用） | #59（`User`、`Project` 資料表） | DOM-AC18、DOM-AC21、DOM-AC24、DOM-AC25、DOM-AC27 | #131 |
| T4 | （本次變更後部分改寫，見[本次變更後續實作](#本次變更後續實作)；下列是當時完成的內容，不改寫歷史） 目前操作者與 `User`、`Company` 的 Service 層規則（不含權限變更）：取得目前操作者的單一入口（認證前回傳 `is_system` 的 `User`）；`Company` 新增與修改（填 `created_by`、`updated_by`，可改 `is_active`）、列出一個公司啟用中的人員與人數；`User` 新增入口（拒絕停用中的公司）與人工修改入口（外部帳號拒絕修改基本欄位、本系統帳號改公司時新公司須啟用中）。本任務不提供 `is_admin`、`is_active` 的修改，也不做授權檢查 | `backend/app/services/__init__.py`、`backend/app/services/operator.py`、`backend/app/services/companies.py`、`backend/app/services/users.py`（新增）、`backend/tests/services/__init__.py`、`backend/tests/services/conftest.py`、`backend/tests/services/test_users.py`、`backend/tests/services/test_companies.py`（新增）、`backend/tests/services/test_operator.py`（新增） | T2 | DOM-AC04、DOM-AC10、DOM-AC13、DOM-AC22、DOM-AC23 | #132 |
| T5 | （本次變更後補：「有修改能力」的判斷隨 DOM-R24 取消，該部分與 DOM-AC26 不再需要，有效權限與影響範圍的計算不變。）權限的唯讀計算：有效權限（從 `Role` 目前內容取聯集，非成員與沒有角色的成員為空集合）、角色影響範圍，以及角色是否「有修改能力」（任一代碼的動作不是 `read`，DOM-R24）。只讀取，不修改任何資料；測試資料直接以 ORM 建立與修改 | `backend/app/services/permissions.py`（新增）、`backend/tests/services/test_permissions.py`（新增） | T3、T4（`backend/app/services/` 套件由 T4 建立） | DOM-AC15、DOM-AC17、DOM-AC26 | #133 |
| T6 | （本次變更後部分改寫，見[本次變更後續實作](#本次變更後續實作)；下列是當時完成的內容，不改寫歷史） 初始化指令：互動式詢問本公司的 `code`、`name` 與兩個帳號的必填基本欄位，也接受測試用的非互動輸入（例如從標準輸入讀取），但原始碼不含任何預設值；在同一個交易裡建立本公司、內建 `admin`（UUID 在寫入前由應用端產生，`created_by`、`updated_by` 指向自己）、個人帳號與三個範本角色（不含任何權限代碼，DOM-R11）；不寫稽核紀錄（DOM-R22）；已有 `is_system` 帳號時不寫入並回報已初始化；在 `Makefile` 加一個執行入口 | `backend/app/cli/__init__.py`、`backend/app/cli/init_system.py`（新增）、`Makefile`（加一個 target）、`backend/tests/cli/__init__.py`（新增）、`backend/tests/cli/test_init_system.py`（新增） | T2、T3 | DOM-AC08、DOM-AC09 | #134 |
| T7 | （本次變更後補：`is_admin` 的指派與收回開放給具 Admin 權限的人、保護內建 `admin`，見 DOM-R51；帳號名稱修改與公司連結變更也走寫入入口並寫稽核，由 E 接手。）權限與角色的寫入入口：`User` 的 `is_admin`、`is_active` 修改（內建帳號保護、最後一個 Admin 保護）；`Role` 新增、改名、修改權限內容（更新修改紀錄）、刪除（連同指派）；替 `ProjectMember` 指派與移除 `Role`；把人移出專案（刪除 `ProjectMember`，DOM-R36）。`Role`、角色指派、移出專案與 `is_admin` 的每一次成功變更，都依 DOM-R22 寫稽核紀錄；`is_active` 的修改不在 DOM-R22 的事件範圍內，不寫 | `backend/app/services/users.py`（加入口，檔案由 T4 建立）、`backend/app/services/roles.py`、`backend/app/services/project_members.py`（新增）、`backend/tests/services/test_users.py`（加案例）、`backend/tests/services/test_roles.py`、`backend/tests/services/test_project_members.py`（新增） | T3、T4；`audit-log` T2（寫入入口，[#216](https://github.com/speko-tw/inspect-flow/issues/216)；DOM-R22 由 `audit-log` 驗收） | DOM-AC05、DOM-AC06、DOM-AC14、DOM-AC16 | #135 |
| T8 | `Project` 業務欄位（依 [OQ-01](../../intents/05-open-questions.md#oq-01) 裁定，[KD-39](../../intents/03-decisions-and-stack.md#kd-39)，DOM-R40～DOM-R44 從草稿轉正式）：`project.py` 加上必填欄位 `name`、`client_name`、`site_location`（不可空值），選填欄位 `planned_start_date`、`planned_completion_date`；三個新字串欄位依 DOM-R44 設長度上限，並在 model 寫入前檢查長度（DOM-R31 的兩層模式，比照既有 `project_code` 的 `BoundedString` 寫法）；新增依 `project_code` 查出既有 `Project` 的 Service 層唯讀介面（DOM-R42，供建立或修改時的重複警告，本任務不做警告畫面）。與 `database-foundation` T5（拿掉 `project_code` 唯一約束，同一個 issue）合併為同一個 PR，兩者的變更合併成同一支 migration | `backend/app/models/project.py`（修改，檔案由 #59 建立；本任務與 `database-foundation` T5 一起改）、`backend/alembic/versions/`（新增一支，與 T5 共用）、`backend/app/services/projects.py`（新增：依 `project_code` 查詢的唯讀介面）、`backend/tests/db/test_user_project.py`（修改：新增業務欄位與長度的斷言）、`backend/tests/services/test_projects.py`（新增）；既有 Project 建立資料需補齊必填欄位：`backend/tests/auth/test_access.py`、`backend/tests/db/test_narrow_business_number_lengths.py`、`backend/tests/db/test_project_code_length.py`、`backend/tests/db/test_role_member.py`、`backend/tests/services/test_permissions.py`、`backend/tests/services/test_project_members.py`、`backend/tests/services/test_roles.py`；`backend/tests/services/test_audit.py` 改為檢查單一 head，避免新增 migration 後的固定 revision 假設 | #59（`Project` 共通結構）；`database-foundation` T5（同一個 PR，[#247](https://github.com/speko-tw/inspect-flow/issues/247)） | DOM-AC28、DOM-AC29、DOM-AC30、DOM-AC31、DOM-AC32 | #247 |

- 每個任務一個 PR 就能完成，並能單獨驗收。
- 每個任務至少對應一條 AC；DOM-AC01～DOM-AC32 每條都被一個任務涵蓋。本次變更後，已被取代的 AC 由新條目接手，DOM-AC33～DOM-AC46 由[本次變更後續實作](#本次變更後續實作)涵蓋。
- 依 plan 開 task issue 時才建立上表的 issue 編號；本 PR 只寫文件，不開 task issue。開 issue 時，若依賴的裁定尚未完成，issue 標 `blocked` 並寫明原因。
- **與 `database-foundation` T4（#59）的分工**：本計畫假設 #59 只建 `User`、`Project` 的共通結構（UUID 主鍵、業務編號、建立與修改紀錄），`User` 業務欄位由本計畫 T2 以另一支 migration 加上。這樣 #59 不必跨兩份規格，也不必等 `Project` 的 [OQ-01](../../intents/05-open-questions.md#oq-01)。`database-foundation` 計畫 T4 目前寫「業務欄位依 `domain-model` 已凍結的定義」，要不要改成這個分工由負責人決定；若改，屬 `database-foundation` 的計畫調整，在 #59 的 PR 內更新。若負責人決定 #59 一起建 `User` 業務欄位，T2 併入 #59，T1 改為 #59 的前置任務（`company_id` 要指向 `Company`），而 `Company.created_by` 指向 `User` 的外鍵要由 T1 之後的 migration 補上。
- 本規格其餘實體仍是草稿，凍結範圍的任務全部合併後，規格仍是「部分凍結」，不改為「已完成」。

## 本次變更後續實作

依據：負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）。本次是範圍變更（帳號名稱、公司改為可選、`Company` 只留名稱與啟用狀態、初始化改為只建系統資料、內建 `admin` 不屬於公司），對應的實作由下列任務接手；每個任務一個 PR，先開 issue 再動工。T1～T8 已完成的部分不重做，B 在既有資料表上以新的 migration 修改。

| 任務 | 內容 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|
| B | 模型與 migration：`User` 加 `username`（小寫存放、格式與保留字檢查、唯一）、`company_id` 改可空值、`department`、`location`、`employee_no` 在沒有公司時必須為空值、`employee_no` 同公司內唯一、`name_en` 選填、內建 `admin` 欄位限制；`Company` 移除 `code`、`tax_id`、`kind`、`parent_id`，`name` 存放前去前後空白且不分大小寫唯一；既有資料回填帳號名稱、清空內建 `admin` 的公司與姓名 | 本計畫 T1～T8；`database-foundation` DBF-R12、DBF-R13 的改寫 | DOM-AC33、DOM-AC34、DOM-AC36、DOM-AC37、DOM-AC39、DOM-AC40、DOM-AC45 | [#260](https://github.com/speko-tw/inspect-flow/issues/260) |
| C | 初始化與首次設定 API：初始化指令改為只建內建 `admin` 與三個範本角色（`make init`）；重跑規則；首次設定流程新增第一個使用者時，操作者為內建 `admin`（登入碼與網頁流程由 `authentication` 定義） | B | DOM-AC43、DOM-AC44、DOM-AC46 | [#261](https://github.com/speko-tw/inspect-flow/issues/261) |
| D | 帳號名稱或 email 登入（`authentication` AUT-R05、AUT-R06；本規格只提供 `username` 欄位與唯一性） | B | （`authentication` 驗收） | [#262](https://github.com/speko-tw/inspect-flow/issues/262) |
| E | 使用者與公司 API：帳號名稱的修改權限與稽核、換公司或解除連結時清空並寫稽核、`is_admin` 指派與收回、沒有公司的人加入專案、公司列表／新增／改名／停用 | B | DOM-AC35、DOM-AC38、DOM-AC41、DOM-AC42 | [#263](https://github.com/speko-tw/inspect-flow/issues/263) |
| F | 前端登入與首次設定頁 | C、D | （`authentication` 驗收） | [#264](https://github.com/speko-tw/inspect-flow/issues/264) |
| G | 前端管理頁（簡便版：使用者與公司的列表、新增、修改、停用、連結或解除公司） | E | （前端驗收） | [#265](https://github.com/speko-tw/inspect-flow/issues/265) |
| H | 端到端驗收：從 `make init` 到首次設定、登入、新增使用者與公司的完整流程 | C～G | 上列各 AC 的端到端串接 | [#266](https://github.com/speko-tw/inspect-flow/issues/266) |

- 簡便版的管理功能屬 0.2.x（E 的 API、G 的頁面）；搜尋、分頁、批次等進階功能仍屬 `admin-dashboard`（[#107](https://github.com/speko-tw/inspect-flow/issues/107)）。
- B 與 E 都改 `backend/app/services/users.py`、`backend/app/services/companies.py` 與 migration 鏈，不同波；C 改初始化指令與 `Makefile`，與 E 檔案不重疊，B 完成後可並行。
- 這些任務的檔案清單，開 issue 時依當時的程式碼盤點，不在這裡預先寫死。

## 並行分組

依「改動的檔案」與「依賴」分波；同一波內的任務檔案不重疊，也互不依賴。

- 第 1 波：T1（依賴 #59）。
- 第 2 波：T2（依賴 T1 的 `Company`）、T3（依賴 #59）。T2 改 `user.py`，T3 改 `role.py`、`project_member.py`、`models/__init__.py`，檔案不重疊，但都新增 migration。T3 排在 T1 之後，是因為兩者都要改 `backend/app/models/__init__.py`。
- 第 3 波：T4（依賴 T2）、T6（依賴 T2、T3）；T4 改 `backend/app/services/`，T6 改 `backend/app/cli/`、`Makefile`，檔案不重疊。
- 第 4 波：T5（依賴 T3、T4）。
- 第 5 波：T7（依賴 T3、T4 與 `audit-log` T2 [#216](https://github.com/speko-tw/inspect-flow/issues/216)；改 T4 建立的 `users.py`，因此排在 T4 之後）。
- 第 6 波：T8（依賴 #59；與 `database-foundation` T5 合併為同一個 PR，不依賴本計畫其他任務，可與前面幾波併行，這裡排在最後只是文件順序）。

碰到[共用檔案](../README.md#parallel)的地方：

- Alembic migration 鏈：T1、T2、T3 各新增一支，每個 PR 最多一支。T2、T3 同一波並行，後合併的一方先 rebase，並把 `down_revision` 改接到最新 head，不留多個 head。驗證特定 migration 的 upgrade／downgrade 往返時，downgrade **應**指定該 migration 的上一個 revision，不用相對的 `"-1"`：之後有新 migration 疊上去，`"-1"` 只會退掉最新的那一支，測試仍會通過，卻不再驗證原本的 migration。T8 與 `database-foundation` T5 合併為同一個 PR，兩者的變更（拿掉 `project_code` 唯一約束、加 `Project` 業務欄位）合併成同一支 migration，接在當時的最新 head 之後。
- `backend/app/models/__init__.py`：`backend/alembic/env.py` 只 import `app.models`，新 model 要在這個檔案 import 才會進入 `Base.metadata`。T1、T3 都要改，所以不同波；T1、T3 的測試都要斷言 upgrade head 後新資料表存在，確認註冊沒有漏掉。
- `backend/pyproject.toml`：T6 實作時發現 `[tool.uv] package = false` 會讓 `uv sync` 略過安裝 `[project.scripts]` 入口（`uv sync` 印出「Skipping installation of entry points」），因此改為計畫調整：T6 不改 `pyproject.toml`，`Makefile` 的 `init` target 改用 `uv run --locked python -m app.cli.init_system` 直接執行模組，不新增指令入口、不動依賴與 lockfile；若之後要新增依賴，仍改為先開獨立任務。
- `Makefile`：只有 T6 加一個 target。
- `backend/app/main.py`：本計畫不改；Service 層由之後的功能規格在 API 層取用。

## 風險

- **`User.company_id` 與 `Company.created_by` 互相引用**（本次變更後不再成立：`company_id` 改為可空值，內建 `admin` 不屬於任何公司，初始化也不建公司，`Company.created_by` 之後永遠指向已存在的人員；B 的 migration 可一併移除「可延後檢查」的外鍵設定，是否移除由 B 決定；下列是當時的風險紀錄）：兩者都不可空值，初始化時不論先寫哪張表，當下都會違反外鍵。降低方式：T2 把 `User.company_id` 設為 `DEFERRABLE INITIALLY DEFERRED`（SQLite 與 PostgreSQL 都支援），`Company.created_by` 維持立即檢查，不改 T1 的資料表與共用的建立及修改紀錄欄位。因此同一個交易的寫入順序是：先寫帳號（`company_id` 指向由應用端預先產生 UUID、尚未寫入的公司），再寫公司（`created_by` 指向該帳號），外鍵在提交時才檢查。T6 照這個順序寫入；T2 的測試要包含這個情境，以及提交時公司仍不存在會被拒絕的反向情境，並由 `database-foundation` T3 的 CI 在 PostgreSQL 上補驗。
- **`email` 不分大小寫的唯一約束**：採 `lower(email)` 的唯一索引，SQLite 與 PostgreSQL 都支援運算式索引，而且唯一性由資料庫保證，任何寫入路徑都擋得下。不採正規化欄位，因為以 Core `update()` 只改 `email` 時，正規化欄位可能沒有同步更新，唯一性就出現漏洞。已知差異：SQLite 的 `lower()` 只轉換 ASCII 字母，PostgreSQL 依資料庫語系也會轉換非 ASCII 字母，所以只差非 ASCII 大小寫的兩個 email，在 SQLite 會被當成不同；DOM-AC02 只用 ASCII，兩種資料庫結果一致。T3 的 `Role.name`（DOM-R34）用同樣做法，差異相同；DOM-AC24 也只用 ASCII。負責人已接受這個差異，正式環境的 PostgreSQL 不受影響，不改用正規化欄位（[PR #205 裁定](https://github.com/speko-tw/inspect-flow/pull/205#issuecomment-5851795833)，2026-09-27）。
- **對既有資料表加不可空值欄位**：SQLite 的 `ALTER TABLE ADD COLUMN` 不能直接加沒有預設值的不可空值欄位，也不能事後加外鍵與 CHECK 約束。T2 的 migration 用 Alembic 的 batch 模式重建資料表；因為這時 `User` 資料表還沒有正式資料，重建不需要資料轉換。
- **內建 `admin` 的自我參照**：`created_by` 要在同一筆 INSERT 裡指向自己，主鍵必須在寫入前由應用端產生（同 `database-foundation` 計畫的風險段）。T6 照這個方式建立 `admin`；C 改寫初始化後仍是這個做法。
- **既有資料回填帳號名稱（B）**：DOM-R54 的回填規則沒有涵蓋 `email` 前段不合格式、既有公司名稱重複的情況，見 [DOM-Q9](spec.md#dom-q9) 的第 3 點。降低方式：B 在計畫階段先提出處理做法並附驗證，再動工；目前專案還在開發前期，正式資料很少；負責人已確認由 B 的計畫提出做法（DOM-Q9）。
- **清空欄位與稽核要同一次修改完成（B、E）**：換公司或解除連結時，清空 `department`、`location`、`employee_no` 與稽核紀錄必須在同一個交易內，否則會出現「公司已換、舊部門還在」的中間狀態。降低方式：E 只提供單一入口做這件事，並用 DOM-AC38 驗收；資料庫另以 CHECK 保證沒有公司就不能有這三個欄位（B）。
- **裁定未完成就開工**：T1～T3 的唯一約束與預設值依 DOM-Q2～DOM-Q7（欄位長度與格式已由 DOM-Q1 裁定，見 DOM-R28～DOM-R31）。任一裁定未完成時，對應任務標 `blocked`；不要先用猜的長度或預設值建表，事後改約束要多一支 migration。
- **登記表初始為空，測試用不到正式代碼**：DOM-R35 拒絕未登記的代碼，但登記表要等功能規格才有成員。T3 讓 model 的檢查經由單一查詢函式讀取登記表，測試以 fixture 暫時換成含 `report.read` 等代碼的測試用列舉（做法同 API-AC10 的測試專用列舉）；T5、T7 的測試沿用同一個 fixture。
- **Service 層規則被繞過**：DOM-R04、DOM-R06、DOM-R07 的保護只在 Service 層，直接用 ORM 寫入可以繞過。T4 的模組說明寫明修改 `User` 必須經 Service 層；之後的 API 規格只能呼叫 Service 層，這一點由 [PR-01](../../intents/02-principles.md#pr-01) 與 Backend 分層約束。
- **T8 跨兩份規格、合併為同一個 PR**：`database-foundation` T5 拿掉唯一約束、T8 加業務欄位，兩者改同一張 `projects` 資料表，若分成兩個 PR 會產生兩支互相依賴的 migration、也難以各自單獨驗收 DBF-AC10（允許重複）與 DOM-AC28～DOM-AC32（新欄位）。降低方式：兩個 task issue 都指向 [#247](https://github.com/speko-tw/inspect-flow/issues/247)、在同一個分支與 PR 一起實作，PR 說明同時列出兩份規格的規格影響與驗收條件。
- **`name`、`client_name`、`site_location` 的長度是本規格推導的暫定值**：intents 沒有明文，DOM-R44 依 `Company.name`（DOM-R29，128）與既有欄位慣例訂出 128、128、256。降低方式：欄位型別集中在 `_PROJECT_XXX_MAX_LENGTH` 這類單一常數（比照既有 `project_code` 的 `_PROJECT_CODE_MAX_LENGTH` 寫法），之後負責人若裁定不同長度，只改常數並新增一支 migration。

## 驗證（Proof）

| AC | 驗證方式 |
|---|---|
| DOM-AC01 | **已被取代**（由 DOM-AC33 取代，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。原驗證的必填欄位與預設值改由 DOM-AC33 驗收。 |
| DOM-AC02 | `backend/tests/db/test_user_fields.py`：已停用帳號的 email 原樣與只差大小寫各寫入一次，斷言都是 `IntegrityError`，且不分大小寫相同的 `User` 仍只有一筆、`User` 總筆數與寫入前相同；另寫入一筆大小寫混合的 email，重新查詢後斷言字串逐字相同；`make check` |
| DOM-AC03 | `backend/tests/db/test_user_fields.py`：依 AC 列出的六種寫入，斷言前兩種成功、後四種 `IntegrityError`；`make check` |
| DOM-AC04 | `backend/tests/services/test_users.py`：呼叫人工修改入口，斷言外部帳號的基本欄位被拒絕且值不變、聯絡欄位成功；`make check` |
| DOM-AC05 | `backend/tests/services/test_users.py`（T7）：對 `is_system` 帳號停用與取消 Admin，斷言被拒絕且資料不變；`make check`；本次變更後的前置資料與操作者（內建 `admin` 加另一位 Admin，本人與他人各試一次）依 DOM-AC05 更新 |
| DOM-AC06 | `backend/tests/services/test_users.py`（T7）：只有一位 Admin 時取消與停用都被拒絕；新增第二位後取消成功；`make check` |
| DOM-AC07 | `backend/tests/db/test_user_fields.py`：刪除被 `created_by` 引用的 `User`，斷言 `IntegrityError` 且資料不變；`make check` |
| DOM-AC08 | **已被取代**（由 DOM-AC43 取代，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。原驗證（互動輸入公司與兩個帳號）隨初始化改寫作廢。 |
| DOM-AC09 | **已被取代**（由 DOM-AC44 取代，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。原驗證的重跑規則改由 DOM-AC44 驗收。 |
| DOM-AC10 | `backend/tests/services/test_companies.py`：初始化後以 Service 層新增與修改 `Company`，斷言 `created_by`、`updated_by` 等於 `admin` 的 UUID；`make check` |
| DOM-AC11 | **已被取代**（由 DOM-AC36 取代，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。原驗證的 `code`、`tax_id`、`kind`、`parent_id` 隨欄位移除。 |
| DOM-AC12 | **已被取代**（由 DOM-AC36 取代，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。`parent_id` 已移除。 |
| DOM-AC13 | **已被取代**（由 DOM-AC38 取代，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。公司類型已移除，換公司與解除連結改由 DOM-AC38 驗收。 |
| DOM-AC14 | `backend/tests/services/test_roles.py`（T7）：inspector 檢查 `Role` 資料表、重複代碼斷言 `IntegrityError`，再以可控時間斷言改名與新增代碼後的修改紀錄；`make check` |
| DOM-AC15 | `backend/tests/services/test_permissions.py`（T5）：依 AC 建立資料，斷言兩個專案與沒有角色的成員 V 的有效權限集合，修改 R1 後再斷言一次，並以 inspector 確認 `ProjectMember` 相關資料表沒有權限代碼欄位；`make check` |
| DOM-AC16 | `backend/tests/services/test_roles.py`（T7）：刪除 R1 後斷言成員仍在、R1 的指派為零、R2 的指派仍在；`make check` |
| DOM-AC17 | `backend/tests/services/test_permissions.py`（T5）：斷言兩個角色的影響範圍數字；`make check` |
| DOM-AC18 | `backend/tests/db/test_role_member.py`：inspector 檢查資料表；依 AC 的寫入斷言 `IntegrityError` 或成功；`make check` |
| DOM-AC19 | `backend/tests/db/test_user_fields.py`（T2）：inspector 斷言各字串欄位的長度；以 ORM 寫入恰為上限的值斷言成功，逐欄超過上限與 `email` 格式不符斷言被拒絕且筆數不變；再以 ORM 修改既有資料為無效值，斷言被拒絕且資料不變；`make check`，PostgreSQL 由 `database-foundation` T3 的 CI 補驗 |
| DOM-AC20 | **已被取代**（由 DOM-AC37 取代，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。`code`、`tax_id` 已移除，`name` 的長度改由 DOM-AC37 驗收。 |
| DOM-AC21 | `backend/tests/db/test_role_member.py`（T3）：同 DOM-AC19 的做法，涵蓋 `Role.name` 的長度與權限代碼的長度及格式；`make check`，PostgreSQL 由 CI 補驗 |
| DOM-AC22 | `backend/tests/services/test_users.py`：以 Service 層對停用中的公司分別嘗試新增 `User`、把本系統帳號的 `company_id` 改過去，斷言都被拒絕且資料不變；改其他欄位、改到啟用中的公司斷言成功；`make check`；本次變更後，換公司同時清空 `department`（DOM-R47）的斷言一併補上 |
| DOM-AC23 | `backend/tests/services/test_companies.py`：列出一個公司啟用中的人員與人數，斷言名單與人數；透過 Service 層停用該公司後，斷言旗下 `User` 的 `is_active`、`company_id` 都不變；`make check` |
| DOM-AC24 | `backend/tests/db/test_role_member.py`（T3）：以 ORM 依 AC 新增與改名，斷言前兩次新增與改名都是 `IntegrityError`、筆數與資料不變，第三次讀回的 `name` 逐字相同；`make check`，PostgreSQL 由 CI 補驗 |
| DOM-AC25 | `backend/tests/db/test_role_member.py`（T3）：以測試用登記表 fixture 登記 `report.read`，依 AC 新增與修改，斷言未登記的代碼被拒絕、筆數與資料不變；`make check` |
| DOM-AC26 | **已被取代**（已取消，沒有取代條目，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。「有修改能力」的判斷隨 DOM-R24 取消。 |
| DOM-AC27 | `backend/tests/db/test_role_member.py`（T3）：依 AC 建立資料，以 Core 的 `delete()` 直接對資料表刪除 M1（不經 ORM 關聯），斷言 M3 存在、M1 的指派為零、R1、R2 與 M2 的指派仍在，證明指派由資料庫外鍵連帶刪除；`make check`，PostgreSQL 由 CI 補驗 |
| DOM-AC28 | `backend/tests/db/test_user_project.py`（T8）：inspector 檢查新欄位不可空值；新增只含必填業務欄位的 `Project`，再逐一省略必填欄位斷言 `IntegrityError` 且筆數不變；`make check` |
| DOM-AC29 | `backend/tests/db/test_user_project.py`（T8）：分別新增不含與含兩個日期欄位的 `Project`，斷言前者為空值、後者等於輸入值；`make check` |
| DOM-AC30 | `backend/tests/services/test_projects.py`（T8）：新增兩筆相同 `project_code` 的 `Project`，斷言都成功、UUID 不同；呼叫查詢介面，斷言回傳這兩筆；`make check` |
| DOM-AC31 | `backend/tests/db/test_user_project.py`（T8）：inspector 列出 `Project` 資料表欄位，斷言只有共通結構加 DOM-R40、DOM-R41 的欄位；新增後立即查詢成功；`make check` |
| DOM-AC32 | `backend/tests/db/test_user_project.py`（T8）：同 DOM-AC19／DOM-AC20 的做法，涵蓋 `project_code`、`name`、`client_name`、`site_location` 的長度；`make check`，PostgreSQL 由 `database-foundation` T3 的 CI 補驗 |
| DOM-AC33 | `backend/tests/db/test_user_fields.py`（B）：upgrade head 後，以 inspector 檢查欄位與可空性（`email`、`name_zh` 可空，並確認 CHECK 存在）；內建帳號無 email 與姓名可建立；只含必填欄位的一般 `User` 斷言預設值；逐一省略 `username`、`email`、`name_zh` 斷言一般帳號 `IntegrityError`；`make check` |
| DOM-AC34 | `backend/tests/db/test_user_fields.py`（B）：邊界長度、各種不合格式與保留字、大小寫重複（含已停用帳號）逐項斷言，讀回小寫；`make check` |
| DOM-AC35 | `backend/tests/services/test_users.py`（E）：Admin 與非 Admin 各改一次、外部帳號人工修改被拒絕；`make check` |
| DOM-AC36 | `backend/tests/db/test_company.py`（B）：inspector 檢查欄位已移除；名稱重複、大小寫不同、前後空白、與已停用公司同名逐項斷言；`make check`，PostgreSQL 由 CI 補驗 |
| DOM-AC37 | `backend/tests/db/test_company.py`（B）：128 與 129 個字元的新增與改名；`make check`，PostgreSQL 由 CI 補驗 |
| DOM-AC38 | `backend/tests/services/test_users.py`（E）與 `backend/tests/db/test_user_fields.py`（B）：沒有公司寫入三個欄位被拒絕；換公司、解除連結清空並確認產生稽核紀錄；`make check` |
| DOM-AC39 | `backend/tests/db/test_user_fields.py`（B）：同公司重複工號被拒絕、跨公司相同與沒有公司的人不受限；`make check`，PostgreSQL 由 CI 補驗 |
| DOM-AC40 | `backend/tests/db/test_user_fields.py`（B）：依 AC 列出的五種寫入逐項斷言被拒絕；`make check` |
| DOM-AC41 | `backend/tests/services/test_users.py`（E）：Admin 指派與收回他人成功並有稽核紀錄，收回內建 `admin` 被拒絕；`make check` |
| DOM-AC42 | `backend/tests/services/test_permissions.py`（B 或 E）：沒有公司的人加入專案、換公司與停用公司後有效權限不變；`make check` |
| DOM-AC43 | `backend/tests/cli/test_init_system.py`（C）：不提供輸入執行指令，逐欄斷言內建 `admin` 與三個範本角色、沒有公司與稽核紀錄；讓中途失敗，斷言整批不生效；`make check`，PostgreSQL 由 CI 補驗 |
| DOM-AC44 | `backend/tests/cli/test_init_system.py`（C）：兩種狀態各重跑一次，斷言資料不變、已設密碼者被拒絕；`make check` |
| DOM-AC45 | `backend/tests/db/test_migration_backfill.py`（B）：建立舊結構資料庫與資料、執行 upgrade head，斷言回填與欄位移除；`make check` |
| DOM-AC46 | `backend/tests/api/`（C）：首次設定流程新增第一個使用者，斷言 `created_by`、`updated_by` 是內建 `admin`；`make check` |

## 考慮過但沒採用的做法

- **`Company`、`User` 業務欄位與 `Role`、`ProjectMember` 一次建表**：少兩個 PR，但一個 PR 會同時處理四個實體、互相引用的外鍵與初始化問題，審查範圍太大；而且每個 PR 最多一支 migration，合在一起只能寫成一支很大的 migration。
- **`Company.created_by` 允許空值，避開互相引用**：最簡單，但違反 #54 的裁定（所有資料的 `created_by` 都有值）。
- **把權限代碼存成 `Role` 上的一個 JSON 欄位**：少一張子表，但資料庫無法保證同一角色內不重複，SQLite 與 PostgreSQL 的 JSON 查詢方式也不同，違反 [PR-03](../../intents/02-principles.md#pr-03) 盡量不依賴資料庫專屬功能的方向。
- **把有效權限預先存到 `ProjectMember`**：查詢較快，但修改角色時要同步更新所有持有者，違反 DOM-R26「修改角色立即影響所有持有者」的簡單語意；等效能出現問題再評估快取。
- **範本角色用資料 migration 建立**：migration 在每個環境都會跑，但範本角色要以內建 `admin` 為 `created_by`，而 `admin` 由初始化指令建立，順序上只能放在初始化指令裡。
