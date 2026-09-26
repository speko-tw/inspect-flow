# 領域模型（domain-model）：實作計畫

**規格**：[spec.md](spec.md)

計畫記錄「為什麼這樣拆」。實作中發現更好的拆法就直接更新本檔（屬於「計畫調整」）；進度看 issue，不在這裡打勾。

本計畫只涵蓋 spec 標頭「凍結範圍」內的部分（DOM-R01～DOM-R21、DOM-R23～DOM-R33、DOM-AC01～DOM-AC23）。DOM-R22（稽核紀錄）待 [DOM-Q6](spec.md#dom-q6) 裁定後再補任務與 AC。[KD-29](../../intents/03-decisions-and-stack.md#kd-29) 要求所有權限與角色的變更都寫稽核紀錄，所以會寫入這類變更的入口集中在 T7，T7 在稽核紀錄可用之前不開工；其餘任務只建資料表、只做讀取，或不涉及權限。`Project` 業務欄位（DOM-R40）與其他實體在擴大凍結範圍後，再於同一份計畫補任務。

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1 | `Company` 資料表：model 繼承 `database-foundation` 的共用基底（UUID 主鍵、建立與修改紀錄），`created_by`、`updated_by` 為不可空值、指向 `User` 的外鍵；`code` 唯一、`tax_id` 可空值且有值時唯一、`kind` 以 CHECK 約束限定 `internal`、`customer`、`parent_id` 自參照外鍵並以 CHECK 約束禁止指向自己；`code`、`name`、`tax_id` 依 DOM-R29 設長度上限，並在 model 寫入前檢查長度與格式（DOM-R31）；新增一支 migration | `backend/app/models/company.py`（新增）、`backend/app/models/__init__.py`（加一行 import，讓 `Company` 登記到 `Base.metadata`；檔案由 #59 建立）、`backend/alembic/versions/`（新增一支）、`backend/tests/db/test_company.py`（新增）、`backend/tests/db/test_narrow_business_number_lengths.py`（修改，檔案由 #140 建立：round-trip 測試的 downgrade 改用明確的 revision，本任務的 migration 成為 head 後，相對的 `"-1"` 就不再退到 #140 的 migration） | #59（`User` 資料表）；[DOM-Q7](spec.md#dom-q7) 裁定 | DOM-AC11、DOM-AC12、DOM-AC20 | #129 |
| T2 | `User` 業務欄位：在 #59 建好的 `User` 資料表加上基本欄位（`company_id` 為不可空值、指向 `Company` 的外鍵）、聯絡與補充欄位、`is_admin`、`is_system`、外部身分預留欄位；`email` 不分大小寫的唯一約束（依 DOM-R02，採 `lower(email)` 的唯一索引，`email` 原樣存放、不另設正規化欄位；理由見[風險](#風險)）；`auth_source` 的 CHECK 約束、`external` 時外部欄位必填的 CHECK 約束、`external_source` 與 `external_id` 組合的唯一約束；`company_id` 與 `Company.created_by` 互相引用，外鍵設為可延後到提交時才檢查（見[風險](#風險)）；新增的字串欄位依 DOM-R28 設長度上限；DOM-R28 列出的所有欄位，含 #59 建立的 `employee_no`，都在 model 寫入前檢查長度，`email` 另檢查格式（DOM-R31），並有對應測試；`employee_no` 的欄位型別由 #140 的 migration 收緊（或依 #140 併入本任務的 migration）；新增一支 migration | `backend/app/models/user.py`（修改，檔案由 #59 建立）、`backend/alembic/versions/`（新增一支）、`backend/tests/db/test_user_fields.py`（新增）、`backend/tests/db/conftest.py`（修改：加共用的「同一交易建立帳號與公司」helper，T3、T4 沿用）、`backend/tests/db/test_user_project.py`、`backend/tests/db/test_auth_tables.py`、`backend/tests/db/test_company.py`、`backend/tests/db/test_narrow_business_number_lengths.py`（修改：`User` 新增必填欄位後，改用共用 helper 建立帳號；#140 的往返測試改為只往返到 `22bfdd8a72a4`，因為 head 的 `company_id` 沒有預設值，既有資料列無法跨越本任務的 migration 重建） | T1；[#140](https://github.com/speko-tw/inspect-flow/issues/140)（`employee_no` 收緊到 16；若本任務先動工，依 #140 併入本任務的 migration）；[DOM-Q2](spec.md#dom-q2)、[DOM-Q7](spec.md#dom-q7) 裁定 | DOM-AC01、DOM-AC02、DOM-AC03、DOM-AC07、DOM-AC19 | #130 |
| T3 | `Role`、`ProjectMember` 資料表：`Role` 與 `ProjectMember` 繼承共用基底；`Role` 的權限代碼存在子表（`role_id`、權限代碼，組合唯一，刪除 `Role` 時一併刪除）；`ProjectMember` 的 `project_id`、`user_id` 為不可空值外鍵、組合唯一；角色指派存在關聯表（`project_member_id`、`role_id`，組合唯一；刪除 `Role` 時一併刪除指派）；`Role.name` 與權限代碼依 DOM-R30 設長度上限，並在 model 寫入前檢查長度與權限代碼格式（DOM-R31）；新增一支 migration | `backend/app/models/role.py`、`backend/app/models/project_member.py`（新增）、`backend/app/models/__init__.py`（加 import）、`backend/alembic/versions/`（新增一支）、`backend/tests/db/test_role_member.py`（新增） | #59（`User`、`Project` 資料表）；[DOM-Q3](spec.md#dom-q3)、[DOM-Q4](spec.md#dom-q4)、[DOM-Q5](spec.md#dom-q5) 裁定 | DOM-AC18、DOM-AC21 | #131 |
| T4 | 目前操作者與 `User`、`Company` 的 Service 層規則（不含權限變更）：取得目前操作者的單一入口（認證前回傳 `is_system` 的 `User`）；`Company` 新增與修改（填 `created_by`、`updated_by`，可改 `is_active`）、列出一個公司啟用中的人員與人數；`User` 新增入口（拒絕停用中的公司）與人工修改入口（外部帳號拒絕修改基本欄位、本系統帳號改公司時新公司須啟用中）。本任務不提供 `is_admin`、`is_active` 的修改，也不做授權檢查 | `backend/app/services/__init__.py`、`backend/app/services/operator.py`、`backend/app/services/companies.py`、`backend/app/services/users.py`（新增）、`backend/tests/services/__init__.py`、`backend/tests/services/conftest.py`、`backend/tests/services/test_users.py`、`backend/tests/services/test_companies.py`（新增）、`backend/tests/services/test_operator.py`（新增） | T2 | DOM-AC04、DOM-AC10、DOM-AC13、DOM-AC22、DOM-AC23 | #132 |
| T5 | 權限的唯讀計算：有效權限（從 `Role` 目前內容取聯集，非成員為空集合）與角色影響範圍。只讀取，不修改任何資料；測試資料直接以 ORM 建立與修改 | `backend/app/services/permissions.py`（新增）、`backend/tests/services/test_permissions.py`（新增） | T3、T4（`backend/app/services/` 套件由 T4 建立） | DOM-AC15、DOM-AC17 | #133 |
| T6 | 初始化指令：互動式詢問本公司的 `code`、`name` 與兩個帳號的必填基本欄位，也接受測試用的非互動輸入（例如從標準輸入讀取），但原始碼不含任何預設值；在同一個交易裡建立本公司、內建 `admin`（UUID 在寫入前由應用端產生，`created_by`、`updated_by` 指向自己）、個人帳號與三個範本角色；已有 `is_system` 帳號時不寫入並回報已初始化；在 `Makefile` 加一個執行入口 | `backend/app/cli/__init__.py`、`backend/app/cli/init_system.py`（新增）、`backend/pyproject.toml`（只加指令入口，不改依賴）、`Makefile`（加一個 target）、`backend/tests/cli/test_init_system.py`（新增） | T2、T3；[DOM-Q4](spec.md#dom-q4) 裁定（範本角色的初始權限）；[DOM-Q6](spec.md#dom-q6) 裁定（初始化建立的帳號與角色是否要寫稽核紀錄） | DOM-AC08、DOM-AC09 | #134 |
| T7 | 權限與角色的寫入入口：`User` 的 `is_admin`、`is_active` 修改（內建帳號保護、最後一個 Admin 保護）；`Role` 改名、修改權限內容（更新修改紀錄）、刪除（連同指派）。每一次成功的變更都依 DOM-R22 寫稽核紀錄 | `backend/app/services/users.py`（加入口，檔案由 T4 建立）、`backend/app/services/roles.py`（新增）、`backend/tests/services/test_users.py`（加案例）、`backend/tests/services/test_roles.py`（新增） | T3、T4；[DOM-Q6](spec.md#dom-q6) 裁定，且稽核紀錄的資料表已由對應任務建立（DOM-R22 擴大凍結範圍後補上 AC） | DOM-AC05、DOM-AC06、DOM-AC14、DOM-AC16 | #135 |

- 每個任務一個 PR 就能完成，並能單獨驗收。
- 每個任務至少對應一條 AC；DOM-AC01～DOM-AC23 每條都被一個任務涵蓋。
- 依 plan 開 task issue 時才建立上表的 issue 編號；本 PR 只寫文件，不開 task issue。開 issue 時，若依賴的裁定尚未完成，issue 標 `blocked` 並寫明原因。
- **與 `database-foundation` T4（#59）的分工**：本計畫假設 #59 只建 `User`、`Project` 的共通結構（UUID 主鍵、業務編號、建立與修改紀錄），`User` 業務欄位由本計畫 T2 以另一支 migration 加上。這樣 #59 不必跨兩份規格，也不必等 `Project` 的 [OQ-01](../../intents/05-open-questions.md#oq-01)。`database-foundation` 計畫 T4 目前寫「業務欄位依 `domain-model` 已凍結的定義」，要不要改成這個分工由負責人決定；若改，屬 `database-foundation` 的計畫調整，在 #59 的 PR 內更新。若負責人決定 #59 一起建 `User` 業務欄位，T2 併入 #59，T1 改為 #59 的前置任務（`company_id` 要指向 `Company`），而 `Company.created_by` 指向 `User` 的外鍵要由 T1 之後的 migration 補上。
- 本規格其餘實體仍是草稿，凍結範圍的任務全部合併後，規格仍是「部分凍結」，不改為「已完成」。

## 並行分組

依「改動的檔案」與「依賴」分波；同一波內的任務檔案不重疊，也互不依賴。

- 第 1 波：T1（依賴 #59）。
- 第 2 波：T2（依賴 T1 的 `Company`）、T3（依賴 #59）。T2 改 `user.py`，T3 改 `role.py`、`project_member.py`、`models/__init__.py`，檔案不重疊，但都新增 migration。T3 排在 T1 之後，是因為兩者都要改 `backend/app/models/__init__.py`。
- 第 3 波：T4（依賴 T2）、T6（依賴 T2、T3）；T4 改 `backend/app/services/`，T6 改 `backend/app/cli/`、`Makefile`、`pyproject.toml`，檔案不重疊。
- 第 4 波：T5（依賴 T3、T4）。
- 第 5 波：T7（依賴 T3、T4 與 DOM-Q6；改 T4 建立的 `users.py`，因此排在 T4 之後）。

碰到[共用檔案](../README.md#parallel)的地方：

- Alembic migration 鏈：T1、T2、T3 各新增一支，每個 PR 最多一支。T2、T3 同一波並行，後合併的一方先 rebase，並把 `down_revision` 改接到最新 head，不留多個 head。驗證特定 migration 的 upgrade／downgrade 往返時，downgrade **應**指定該 migration 的上一個 revision，不用相對的 `"-1"`：之後有新 migration 疊上去，`"-1"` 只會退掉最新的那一支，測試仍會通過，卻不再驗證原本的 migration。
- `backend/app/models/__init__.py`：`backend/alembic/env.py` 只 import `app.models`，新 model 要在這個檔案 import 才會進入 `Base.metadata`。T1、T3 都要改，所以不同波；T1、T3 的測試都要斷言 upgrade head 後新資料表存在，確認註冊沒有漏掉。
- `backend/pyproject.toml`：只有 T6 加指令入口，不改依賴，因此不動 lockfile；若實作時發現需要新套件，改為先開獨立任務加依賴。
- `Makefile`：只有 T6 加一個 target。
- `backend/app/main.py`：本計畫不改；Service 層由之後的功能規格在 API 層取用。

## 風險

- **`User.company_id` 與 `Company.created_by` 互相引用**：兩者都不可空值，初始化時不論先寫哪張表，當下都會違反外鍵。降低方式：T2 把 `User.company_id` 設為 `DEFERRABLE INITIALLY DEFERRED`（SQLite 與 PostgreSQL 都支援），`Company.created_by` 維持立即檢查，不改 T1 的資料表與共用的建立及修改紀錄欄位。因此同一個交易的寫入順序是：先寫帳號（`company_id` 指向由應用端預先產生 UUID、尚未寫入的公司），再寫公司（`created_by` 指向該帳號），外鍵在提交時才檢查。T6 照這個順序寫入；T2 的測試要包含這個情境，以及提交時公司仍不存在會被拒絕的反向情境，並由 `database-foundation` T3 的 CI 在 PostgreSQL 上補驗。
- **`email` 不分大小寫的唯一約束**：採 `lower(email)` 的唯一索引，SQLite 與 PostgreSQL 都支援運算式索引，而且唯一性由資料庫保證，任何寫入路徑都擋得下。不採正規化欄位，因為以 Core `update()` 只改 `email` 時，正規化欄位可能沒有同步更新，唯一性就出現漏洞。已知差異：SQLite 的 `lower()` 只轉換 ASCII 字母，PostgreSQL 依資料庫語系也會轉換非 ASCII 字母，所以只差非 ASCII 大小寫的兩個 email，在 SQLite 會被當成不同；DOM-AC02 只用 ASCII，兩種資料庫結果一致。
- **對既有資料表加不可空值欄位**：SQLite 的 `ALTER TABLE ADD COLUMN` 不能直接加沒有預設值的不可空值欄位，也不能事後加外鍵與 CHECK 約束。T2 的 migration 用 Alembic 的 batch 模式重建資料表；因為這時 `User` 資料表還沒有正式資料，重建不需要資料轉換。
- **內建 `admin` 的自我參照**：`created_by` 要在同一筆 INSERT 裡指向自己，主鍵必須在寫入前由應用端產生（同 `database-foundation` 計畫的風險段）。T6 照這個方式建立 `admin`。
- **裁定未完成就開工**：T1～T3 的唯一約束與預設值依 DOM-Q2～DOM-Q7（欄位長度與格式已由 DOM-Q1 裁定，見 DOM-R28～DOM-R31）。任一裁定未完成時，對應任務標 `blocked`；不要先用猜的長度或預設值建表，事後改約束要多一支 migration。
- **Service 層規則被繞過**：DOM-R04、DOM-R06、DOM-R07 的保護只在 Service 層，直接用 ORM 寫入可以繞過。T4 的模組說明寫明修改 `User` 必須經 Service 層；之後的 API 規格只能呼叫 Service 層，這一點由 [PR-01](../../intents/02-principles.md#pr-01) 與 Backend 分層約束。

## 驗證（Proof）

| AC | 驗證方式 |
|---|---|
| DOM-AC01 | `backend/tests/db/test_user_fields.py`：upgrade head 後，以 fixture 在同一交易建立 `Company` 與自我參照的操作者 `User`（DOM-AC02、DOM-AC03 共用）；以 inspector 檢查欄位、可空性與外鍵；新增只含必填欄位的 `User` 斷言預設值；逐一省略必填欄位斷言 `IntegrityError` 且筆數不變；`make check` |
| DOM-AC02 | `backend/tests/db/test_user_fields.py`：已停用帳號的 email 原樣與只差大小寫各寫入一次，斷言都是 `IntegrityError`，且不分大小寫相同的 `User` 仍只有一筆、`User` 總筆數與寫入前相同；另寫入一筆大小寫混合的 email，重新查詢後斷言字串逐字相同；`make check` |
| DOM-AC03 | `backend/tests/db/test_user_fields.py`：依 AC 列出的六種寫入，斷言前兩種成功、後四種 `IntegrityError`；`make check` |
| DOM-AC04 | `backend/tests/services/test_users.py`：呼叫人工修改入口，斷言外部帳號的基本欄位被拒絕且值不變、聯絡欄位成功；`make check` |
| DOM-AC05 | `backend/tests/services/test_users.py`（T7）：對 `is_system` 帳號停用與取消 Admin，斷言被拒絕且資料不變；`make check` |
| DOM-AC06 | `backend/tests/services/test_users.py`（T7）：只有一位 Admin 時取消與停用都被拒絕；新增第二位後取消成功；`make check` |
| DOM-AC07 | `backend/tests/db/test_user_fields.py`：刪除被 `created_by` 引用的 `User`，斷言 `IntegrityError` 且資料不變；`make check` |
| DOM-AC08 | `backend/tests/cli/test_init_system.py`：在暫存 SQLite 上 upgrade head 後以非互動輸入執行指令，逐欄斷言三張表的內容與操作者；另以兩個相同 email 的輸入、以及 `email` 不含 `@` 的輸入各執行一次，斷言指令失敗且三張表皆為空；`make check`，PostgreSQL 由 `database-foundation` T3 的 CI 補驗 |
| DOM-AC09 | `backend/tests/cli/test_init_system.py`：執行兩次，斷言第二次回報已初始化，且三張表的筆數與內容不變；`make check` |
| DOM-AC10 | `backend/tests/services/test_companies.py`：初始化後以 Service 層新增與修改 `Company`，斷言 `created_by`、`updated_by` 等於 `admin` 的 UUID；`make check` |
| DOM-AC11 | `backend/tests/db/test_company.py`：inspector 檢查欄位與約束；依 AC 列出的寫入斷言成功或 `IntegrityError`；`make check` |
| DOM-AC12 | `backend/tests/db/test_company.py`（T1）：`parent_id` 指向自己時斷言 `IntegrityError` 且資料不變，指向另一筆公司時成功；`make check` |
| DOM-AC13 | `backend/tests/services/test_users.py`：本系統帳號改公司，斷言成功；`make check` |
| DOM-AC14 | `backend/tests/services/test_roles.py`（T7）：inspector 檢查 `Role` 資料表、重複代碼斷言 `IntegrityError`，再以可控時間斷言改名與新增代碼後的修改紀錄；`make check` |
| DOM-AC15 | `backend/tests/services/test_permissions.py`（T5）：依 AC 建立資料，斷言兩個專案的有效權限集合，修改 R1 後再斷言一次，並以 inspector 確認 `ProjectMember` 相關資料表沒有權限代碼欄位；`make check` |
| DOM-AC16 | `backend/tests/services/test_roles.py`（T7）：刪除 R1 後斷言成員仍在、R1 的指派為零、R2 的指派仍在；`make check` |
| DOM-AC17 | `backend/tests/services/test_permissions.py`（T5）：斷言兩個角色的影響範圍數字；`make check` |
| DOM-AC18 | `backend/tests/db/test_role_member.py`：inspector 檢查資料表；依 AC 的寫入斷言 `IntegrityError` 或成功；`make check` |
| DOM-AC19 | `backend/tests/db/test_user_fields.py`（T2）：inspector 斷言各字串欄位的長度；以 ORM 寫入恰為上限的值斷言成功，逐欄超過上限與 `email` 格式不符斷言被拒絕且筆數不變；再以 ORM 修改既有資料為無效值，斷言被拒絕且資料不變；`make check`，PostgreSQL 由 `database-foundation` T3 的 CI 補驗 |
| DOM-AC20 | `backend/tests/db/test_company.py`（T1）：同 DOM-AC19 的做法，涵蓋 `code` 的字元限制與 `tax_id` 的 8 位數字；`make check`，PostgreSQL 由 CI 補驗 |
| DOM-AC21 | `backend/tests/db/test_role_member.py`（T3）：同 DOM-AC19 的做法，涵蓋 `Role.name` 的長度與權限代碼的長度及格式；`make check`，PostgreSQL 由 CI 補驗 |
| DOM-AC22 | `backend/tests/services/test_users.py`：以 Service 層對停用中的公司分別嘗試新增 `User`、把本系統帳號的 `company_id` 改過去，斷言都被拒絕且資料不變；改其他欄位、改到啟用中的公司斷言成功；`make check` |
| DOM-AC23 | `backend/tests/services/test_companies.py`：列出一個公司啟用中的人員與人數，斷言名單與人數；透過 Service 層停用該公司後，斷言旗下 `User` 的 `is_active`、`company_id` 都不變；`make check` |

## 考慮過但沒採用的做法

- **`Company`、`User` 業務欄位與 `Role`、`ProjectMember` 一次建表**：少兩個 PR，但一個 PR 會同時處理四個實體、互相引用的外鍵與初始化問題，審查範圍太大；而且每個 PR 最多一支 migration，合在一起只能寫成一支很大的 migration。
- **`Company.created_by` 允許空值，避開互相引用**：最簡單，但違反 #54 的裁定（所有資料的 `created_by` 都有值）。
- **把權限代碼存成 `Role` 上的一個 JSON 欄位**：少一張子表，但資料庫無法保證同一角色內不重複，SQLite 與 PostgreSQL 的 JSON 查詢方式也不同，違反 [PR-03](../../intents/02-principles.md#pr-03) 盡量不依賴資料庫專屬功能的方向。
- **把有效權限預先存到 `ProjectMember`**：查詢較快，但修改角色時要同步更新所有持有者，違反 DOM-R26「修改角色立即影響所有持有者」的簡單語意；等效能出現問題再評估快取。
- **範本角色用資料 migration 建立**：migration 在每個環境都會跑，但範本角色要以內建 `admin` 為 `created_by`，而 `admin` 由初始化指令建立，順序上只能放在初始化指令裡。
