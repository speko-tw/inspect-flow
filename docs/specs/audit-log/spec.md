# 稽核紀錄（audit-log）

**代碼**：`ALG`　**Phase**：P2　**狀態**：已凍結
**前置規格**：`database-foundation`（UUID 主鍵、UTC 時間、`created_by` 外鍵，見 DBF-R08、DBF-R11、DBF-R14）、`domain-model`（`User`、`Role`、`ProjectMember`、目前操作者，見 DOM-R05、DOM-R14、DOM-R19～DOM-R25）、`api-conventions`（UUID 字串、時間格式，見 API-R06、API-R09）
**引用意圖**：[PR-03](../../intents/02-principles.md#pr-03)、[PR-08](../../intents/02-principles.md#pr-08)、[PR-14](../../intents/02-principles.md#pr-14)、[KD-07](../../intents/03-decisions-and-stack.md#kd-07)、[KD-14](../../intents/03-decisions-and-stack.md#kd-14)、[KD-20](../../intents/03-decisions-and-stack.md#kd-20)、[KD-24](../../intents/03-decisions-and-stack.md#kd-24)、[KD-29](../../intents/03-decisions-and-stack.md#kd-29)、[04-glossary](../../intents/04-glossary.md)「稽核紀錄」
**被擋議題**：無（[ALG-Q1](#alg-q1)～[ALG-Q5](#alg-q5) 不擋凍結：Q1～Q4 不影響資料表；Q5 若選 B，另加一支 migration 新增可空值欄位，已凍結的欄位不變）

## 目的

權限與角色每一次變更都留下一筆不能修改、不能刪除的紀錄，事後能回答「誰、何時、對哪一筆資料、做了什麼、改之前與改之後是什麼」。這份規格定義紀錄的資料模型、寫入方式與第一批事件，之後外部身分同步覆蓋基本欄位時沿用同一套（依據：[KD-29](../../intents/03-decisions-and-stack.md#kd-29)、[KD-20](../../intents/03-decisions-and-stack.md#kd-20)、[04-glossary](../../intents/04-glossary.md)「稽核紀錄」（架構基準 §19）；由本規格定義為負責人裁定，[#126](https://github.com/speko-tw/inspect-flow/issues/126)，2026-09-27）。

## 範圍

**包含**：

- `AuditLog` 的資料模型與「只能新增」的保護。
- Service 層寫入稽核紀錄的單一入口，以及事件目錄（每種事件記哪些欄位）。
- 第一批事件：`Role` 的新增、修改、刪除；`ProjectMember` 的角色指派；把人移出專案；`User.is_admin` 的變更（[KD-29](../../intents/03-decisions-and-stack.md#kd-29)、DOM-R22、[#126](https://github.com/speko-tw/inspect-flow/issues/126)、[#125](https://github.com/speko-tw/inspect-flow/issues/125)）。
- `authentication` 的兩種事件：設定密碼、帳號被鎖（[AUT-Q6](../authentication/spec.md#aut-q6) 裁定，[#148](https://github.com/speko-tw/inspect-flow/issues/148)），見 [`authentication` 事件](#authentication-事件)。
- 寫入時機的驗收：DOM-R22 列出的每一種變更是否寫出正確的紀錄（DOM-R22 寫明由本規格驗收）。
- 預留：外部身分同步覆蓋基本欄位的事件（[KD-20](../../intents/03-decisions-and-stack.md#kd-20)），只保證之後不用改資料表就能套用。

**不包含**：

- 寫入入口本身（`Role`、角色指派、移出專案、`is_admin` 的 Service 層入口）與在其中呼叫本規格的寫入入口：由 `domain-model` 實作（DOM-R22；計畫 T7，[#135](https://github.com/speko-tw/inspect-flow/issues/135)），本規格只驗收，見[寫入時機](#寫入時機)。
- 初始化指令建立的資料：不寫稽核紀錄（[#126](https://github.com/speko-tw/inspect-flow/issues/126) 裁定），見 ALG-R12。
- 外部身分同步的事件代碼與欄位：由 `external-identity-sync` 登記（ALG-R13）。
- 登入成功、登入失敗、登出：只寫應用程式日誌，不寫稽核紀錄（AUT-R40，[AUT-Q6](../authentication/spec.md#aut-q6) 裁定）。
- `authentication` 事件的寫入入口與寫入時機的驗收：由 `authentication` 實作與驗收（AUT-R39、AUT-AC49～AUT-AC51）。
- 查詢 API 與畫面、保存期限、讀取紀錄、請求來源資訊：intents 沒有依據，見[待釐清](#待釐清)。
- 其他資料（`Company`、`User` 基本欄位的人工修改等）的完整操作歷史：屬「延後但不排除」的 Audit Trail（[01-overview](../../intents/01-overview.md#延後但不排除的能力)，架構基準 §35）；這些資料目前只靠 [PR-08](../../intents/02-principles.md#pr-08) 的建立與修改紀錄。
- 資料庫層的防竄改（trigger、權限控管、雜湊鏈）：見[考慮過但沒採用的做法](plan.md#考慮過但沒採用的做法)。

## 使用情境

- Admin 把「現場查核」角色的權限加上 `report.approve`；系統同時寫一筆 `role.updated`，記下改前、改後的權限代碼清單與操作者。
- Admin 刪除「唯讀」角色；三位成員的這個角色指派一併被移除（DOM-R21），紀錄保留角色原本的名稱、權限與受影響的成員。角色刪掉後，紀錄仍查得到。
- Admin 把一位同事設為 Admin；寫一筆 `user.admin_changed`。
- 修改在寫稽核紀錄時失敗，整筆修改一起回滾，不會出現「改了但沒紀錄」。
- 工程師想改掉一筆寫錯的稽核紀錄，程式會拒絕。

## 需求

欄位名稱是本規格建議的識別字（強度為「應」）。

### 資料模型

| 編號 | 需求 | 強度 | 依據 | 驗收 |
|---|---|---|---|---|
| ALG-R01 | `AuditLog`（資料表 `audit_logs`）**必須**具備：`id`（UUID 主鍵）、`created_at`（事件時間，含時區的 UTC）、`created_by`（操作者，外鍵指向 `User`）、`event_type`（事件代碼）、`entity_type`（被記錄的資料種類，例如 `role`）、`entity_id`（被記錄那一筆的 UUID）、`before`、`after`（改前、改後的內容，JSON）。`before`、`after` 允許空值，其餘不可空值，由資料庫約束保證 | 必須；應（欄位名） | [04-glossary](../../intents/04-glossary.md)「稽核紀錄」（誰、何時、哪個 entity、做了什麼、前後內容，架構基準 §19）；[KD-07](../../intents/03-decisions-and-stack.md#kd-07)；[PR-08](../../intents/02-principles.md#pr-08)；做法同 DBF-R08、DBF-R11、DBF-R14 | ALG-AC01 |
| ALG-R02 | `AuditLog` **不得**有 `updated_at`、`updated_by` | 必須 | 本規格推導：紀錄不會被修改（ALG-R04），PR-08 的「最後修改」不適用，留著欄位會讓人以為可以改 | ALG-AC01 |
| ALG-R03 | `entity_id` **不得**是外鍵；被記錄的資料刪除後，紀錄**必須**保留 | 必須 | [#126](https://github.com/speko-tw/inspect-flow/issues/126)（只能新增、不能刪除）；`Role` 可刪除（DOM-R21），外鍵會擋下刪除或連帶刪掉紀錄 | ALG-AC02 |
| ALG-R04 | 稽核紀錄只能新增：Service 層只提供新增入口；後端經 SQLAlchemy 對 `audit_logs` 執行的任何修改或刪除（ORM flush、ORM 批次 `update`／`delete`、Core 語句、`text()` 原始 SQL）**必須**被拒絕，資料不變。後端以外直接連資料庫不在本條範圍：後端程式不得直接用資料庫驅動（DBF-R01），資料庫層保護見[計畫](plan.md#考慮過但沒採用的做法) | 必須 | [#126](https://github.com/speko-tw/inspect-flow/issues/126) 裁定（依 OWASP：只能新增，不能修改或刪除）；不要求資料庫層保護，理由：要寫資料庫專用 SQL（[PR-03](../../intents/02-principles.md#pr-03)） | ALG-AC03 |

### 寫入

| 編號 | 需求 | 強度 | 依據 | 驗收 |
|---|---|---|---|---|
| ALG-R05 | Service 層**必須**從單一入口寫稽核紀錄。`created_by` **必須**取自「目前操作者」入口（DOM-R14、AUT-R09），`created_at` 由後端填寫，呼叫端不能指定；系統事件依 ALG-R15 | 必須 | [KD-29](../../intents/03-decisions-and-stack.md#kd-29)；DOM-R14、AUT-R09（請求中沒有登入者時拒絕，不記成內建 `admin`） | ALG-AC04 |
| ALG-R06 | 稽核紀錄**必須**和它記錄的變更在同一個交易（DBF-R09）寫入：變更回滾時紀錄一起回滾；寫紀錄失敗時變更也不生效 | 必須 | 本規格推導：[KD-29](../../intents/03-decisions-and-stack.md#kd-29) 要求所有變更都有紀錄，分開提交會留下「改了但沒紀錄」 | ALG-AC05 |
| ALG-R07 | `event_type` **必須**是事件目錄（ALG-R11）登記過的代碼，否則拒絕寫入。代碼**應**採 `<資料>.<動作>`，符合 `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$` | 必須（登記）；應（格式） | [KD-29](../../intents/03-decisions-and-stack.md#kd-29)；格式沿用 API-R07、DOM-R30 的 dot-namespace（[KD-15](../../intents/03-decisions-and-stack.md#kd-15)），理由：同一套命名好辨認 | ALG-AC06、ALG-AC10 |
| ALG-R08 | `before`、`after` **必須**只含事件目錄為該事件宣告的欄位，多出的欄位拒絕寫入；密碼、密碼雜湊、Session 值**不得**出現在任何事件的宣告欄位裡 | 必須 | [PR-14](../../intents/02-principles.md#pr-14)（log 不得記錄密碼、Session secret）；稽核紀錄也是一種 log，本規格從嚴判讀 | ALG-AC06 |
| ALG-R09 | 內容的形狀：新增事件 `before` 為空值；刪除事件 `after` 為空值；修改事件只記有變動的欄位，目錄另有標明「一律記錄」的欄位除外。修改前後完全相同時**應**不寫紀錄，寫入入口拒絕；每次都寫的事件依 ALG-R16 | 必須（形狀）；應（無變動不寫） | [04-glossary](../../intents/04-glossary.md)「稽核紀錄」（修改前後內容）；形狀是本規格的定義，理由：讀紀錄的人一眼看出改了什麼 | ALG-AC06、ALG-AC07 |
| ALG-R10 | JSON 內的值**應**統一表示：UUID 為字串（API-R06）；時間為 API-R09 格式；權限代碼、角色 ID 等集合為排序後的陣列 | 應 | API-R06、API-R09；排序是本規格的推導，理由：同樣的內容永遠寫成同樣的 JSON，比對前後才不會誤判 | ALG-AC07 |

### 事件

| 編號 | 需求 | 強度 | 依據 | 驗收 |
|---|---|---|---|---|
| ALG-R11 | 事件目錄**必須**至少包含[第一批事件](#第一批事件)，欄位依該表 | 必須 | [KD-29](../../intents/03-decisions-and-stack.md#kd-29)（權限與角色的變更）；DOM-R22（事件範圍，含移出專案，[#125](https://github.com/speko-tw/inspect-flow/issues/125)）；[#126](https://github.com/speko-tw/inspect-flow/issues/126)（`is_admin` 的變更算權限變更） | ALG-AC07 |
| ALG-R12 | 初始化指令（DOM-R11）**不得**寫稽核紀錄 | 必須 | [#126](https://github.com/speko-tw/inspect-flow/issues/126) 裁定（初始化是系統安裝，不是權限變更；資料本身已有建立紀錄） | ALG-AC08 |
| ALG-R13 | 外部來源的值覆蓋 `User` 基本欄位時，每次覆蓋**必須**寫一筆稽核紀錄；事件代碼與欄位由 `external-identity-sync` 登記進事件目錄。本規格的資料表與寫入入口**必須**不改 schema 就能登記新事件 | 必須 | [KD-20](../../intents/03-decisions-and-stack.md#kd-20)；「不改 schema」是本規格為預留所做的推導 | ALG-AC09（新增事件不需 migration）；覆蓋時寫紀錄由 `external-identity-sync` 驗收 |
| ALG-R14 | DOM-R22 列出的每一種變更成功時，**必須**在同一個交易裡寫恰好一筆對應事件的紀錄，內容依[第一批事件](#第一批事件)；變更被拒絕或回滾時**不得**留下紀錄；DOM-R22 範圍外的變更（例如新增沒有角色的成員、`is_active`，待 [ALG-Q4](#alg-q4)）不寫 | 必須 | [KD-29](../../intents/03-decisions-and-stack.md#kd-29)；DOM-R22（由本規格驗收）；「恰好一筆」是本規格推導，理由：同一次變更寫多筆或漏寫都會讓紀錄對不上 | ALG-AC11 |
| ALG-R15 | 事件目錄**得**把事件標為「系統事件」：由系統自動觸發、沒有登入者的事件（例如帳號被鎖）。系統事件的 `created_by` **必須**是內建 `admin`（`is_system = true`），不論是否在請求中、有沒有登入者；未標為系統事件的事件照 ALG-R05，請求中沒有登入者時仍拒絕 | 得（標記）；必須（操作者） | [AUT-Q6](../authentication/spec.md#aut-q6) 裁定（帳號被鎖寫稽核紀錄，[#148](https://github.com/speko-tw/inspect-flow/issues/148)）；鎖定發生在未登入的登入請求裡，照 ALG-R05 會被拒絕。用內建 `admin` 是本規格的推導，理由：它本來就是「不在請求中」時的系統操作者（DOM-R14）；只開放給標記的事件，漏掛需登入的一般寫入仍會被擋 | ALG-AC12 |
| ALG-R16 | 事件目錄**得**把事件標為「每次都寫」：宣告的欄位一律記錄，`before`、`after` 相同也照寫，不適用 ALG-R09 的「只記有變動的欄位」與「無變動不寫」 | 得 | 本規格推導：設定密碼時旗標可能不變（例如本人把非臨時密碼換成另一組），但這仍是一次要留紀錄的事件，差別在雜湊，而雜湊不得記錄（ALG-R08） | ALG-AC12 |
| ALG-R17 | 事件目錄**必須**包含 [`authentication` 事件](#authentication-事件)，欄位依該表 | 必須 | [AUT-Q6](../authentication/spec.md#aut-q6) 裁定；依 ALG-R13 只登記事件，不改資料表 | ALG-AC12 |

## 第一批事件

`entity_type` 與事件代碼的「資料」段相同。「一律記錄」的欄位不論有沒有變動都寫，讓紀錄在被記錄的資料刪除後仍看得懂。

| 事件代碼 | 什麼時候寫 | `entity_type` | `before` | `after` |
|---|---|---|---|---|
| `role.created` | 新增 `Role` | `role` | 空值 | `name`、`permission_codes` |
| `role.updated` | 改名或修改權限內容 | `role` | 有變動的 `name`、`permission_codes` | 同左 |
| `role.deleted` | 刪除 `Role`，連同移除所有指派（DOM-R21） | `role` | `name`、`permission_codes`、`project_member_ids`（被一併移除這個角色的成員） | 空值 |
| `project_member.roles_changed` | 一筆 `ProjectMember` 的角色集合改變：加入專案時就指派角色、之後增減角色。加入時 `before.role_ids` 為空陣列；加入時沒有指派角色不寫（DOM-R22 範圍外，DOM-R36 允許沒有角色） | `project_member` | `role_ids`；一律記錄 `project_id`、`user_id` | 同左 |
| `project_member.removed` | 把人移出專案，刪除 `ProjectMember` 與它的指派（DOM-R36）；成員沒有角色時也寫 | `project_member` | `project_id`、`user_id`、`role_ids` | 空值 |
| `user.admin_changed` | `User.is_admin` 改變 | `user` | `is_admin` | `is_admin` |

- `permission_codes`、`role_ids`、`project_member_ids` 記整個集合，不記差異，讀的人不必自己推算。
- 刪除角色只寫一筆 `role.deleted`，不再替每位受影響的成員各寫一筆 `project_member.roles_changed`；移出專案同理，只寫 `project_member.removed`：`project_member_ids` 已能還原影響範圍，也避免一次刪除寫出大量紀錄。

<a id="authentication-事件"></a>
## `authentication` 事件

依 [AUT-Q6](../authentication/spec.md#aut-q6) 裁定登記；只記旗標與時間，不記密碼、雜湊或 token（ALG-R08、AUT-R41）。欄位名稱不含 `password`，ALG-AC06 的掃描照常適用。

| 事件代碼 | 什麼時候寫 | `entity_type` | 標記 | `before` | `after` |
|---|---|---|---|---|---|
| `user.password_set` | 設定或變更本地密碼：設定密碼的指令、Service 入口（含 Admin 設臨時密碼）、本人變更密碼（AUT-R39） | `user` | 每次都寫 | `is_temporary`（設定前的 `must_change_password`）；之前沒有密碼時為空值 | `is_temporary`（設定後的 `must_change_password`） |
| `user.locked` | 帳號因連續登入失敗被鎖（AUT-R28） | `user` | 系統事件 | 空值 | `locked_until`（解鎖時間，API-R09 格式） |

寫入時機由 `authentication` 驗收（AUT-AC49～AUT-AC51）。

<a id="寫入時機"></a>
### 寫入時機

入口由 `domain-model` 實作，本規格驗收（DOM-R22、ALG-R14、ALG-AC11）：

| 事件 | 入口（`domain-model`） |
|---|---|
| `role.created`、`role.updated`、`role.deleted` | `Role` 新增、改名與修改權限、刪除（DOM-R20、DOM-R21；T7，[#135](https://github.com/speko-tw/inspect-flow/issues/135)） |
| `project_member.roles_changed` | 替 `ProjectMember` 指派與移除 `Role`（T7，#135） |
| `project_member.removed` | 把人移出專案（DOM-R36；T7，#135） |
| `user.admin_changed` | `User.is_admin` 修改（DOM-R06、DOM-R07；T7，#135） |

## 資料

| 實體 | 共通結構（`database-foundation`） | 本規格定義 | 狀態 |
|---|---|---|---|
| `AuditLog` | UUID 主鍵、`created_at`、`created_by`（做法同 DBF-R11、DBF-R14）；不含 `updated_at`、`updated_by` | `event_type`、`entity_type`、`entity_id`、`before`、`after`（ALG-R01～ALG-R04） | 已凍結 |

關聯：`User` 1—多 `AuditLog`（`created_by`）。`entity_id` 只存 UUID，不是外鍵（ALG-R03）。

**門檻比對**（參照[部分凍結](../README.md#partial-freeze)規則 1）：逐條比對[開工門檻](../../intents/05-open-questions.md#gate)的 G-01～G-07、OQ-06，搜尋稽核、紀錄、歷程、刪除、保留、核可等字面。

| 實體 | 字面命中 | 結論 | 理由 |
|---|---|---|---|
| `AuditLog` | G-04「核可紀錄」；G-05「刪除與保留」 | 無關 | G-04 的核可紀錄是 Variant 那一側的欄位；日後若要把核可寫進稽核紀錄，只是在事件目錄多登記一種事件，不改資料表（ALG-R13）。G-05 談的是 `Evidence` 的刪除，與稽核紀錄的保留無關 |

## 介面

本規格不新增 API 端點與畫面（查詢介面見 [ALG-Q2](#alg-q2)）。對開發者的介面如下；模組與函式名稱由計畫決定。

| 介面 | 內容 | 對應需求 |
|---|---|---|
| 程式介面 | 寫入稽核紀錄的單一入口：傳入事件代碼、被記錄的資料與 `before`、`after`；操作者與時間由入口填寫 | ALG-R05～ALG-R10 |
| 程式介面 | 事件目錄：事件代碼與各自宣告的欄位；其他規格在這裡登記自己的事件 | ALG-R07、ALG-R08、ALG-R11、ALG-R13 |

## 驗收條件

皆以 `make check` 內的自動化測試驗證，資料庫由 `alembic upgrade head` 建立；ALG-AC01～ALG-AC03、ALG-AC07 的測試放在 `backend/tests/db/`，CI 也對 PostgreSQL 執行（DBF-R10）。

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| ALG-AC01 | 對空資料庫執行 `alembic upgrade head` 之後，一筆作為操作者的 `User` | 用 SQLAlchemy inspector 檢查 `audit_logs`；新增一筆欄位齊全的紀錄；再分別嘗試新增 `created_by`、`event_type`、`entity_type`、`entity_id` 各為空值的紀錄，以及 `created_by` 指向不存在 UUID 的紀錄 | 有 ALG-R01 的所有欄位，主鍵是 UUID；`before`、`after` 可空值，其餘不可空值；`created_by` 外鍵指向 `users.id`；沒有 `updated_at`、`updated_by`；第一筆成功，其餘每一次都被資料庫拒絕，筆數不變 | ALG-R01、ALG-R02 |
| ALG-AC02 | 同 ALG-AC01 | 用 inspector 列出 `audit_logs` 的外鍵；新增一筆 `entity_id` 為任何資料表都不存在的 UUID 的紀錄 | 唯一的外鍵是 `created_by`；新增成功 | ALG-R03 |
| ALG-AC03 | 已有一筆紀錄 | 以 ORM 修改它的 `after` 後 flush；以 ORM 刪除它後 flush；以 `session.execute` 對 `AuditLog` 執行 ORM 批次 `update`、`delete`；以 `connection.execute` 執行 Core 的 `update(audit_logs)`、`delete(audit_logs)`；以 `text()` 執行 `UPDATE`、`DELETE FROM` 各一組寫法：不加引號、表名加雙引號（`"audit_logs"`）、加 schema 前綴（SQLite 用 `main.audit_logs`，PostgreSQL 用 `public.audit_logs`）、關鍵字與表名大小寫混用（`uPdAtE AUDIT_LOGS`）、前面有空白與換行；再以 `text()` 執行 `INSERT INTO audit_logs ...` 與 `SELECT ... FROM audit_logs`；（issue #233，兩輪審查後改採保守判斷）另以 `text()` 驗證：只要敘述中任何位置同時出現修改動作關鍵字（`UPDATE`、`DELETE`、`REPLACE`、`MERGE`——涵蓋 `REPLACE INTO`、`INSERT OR REPLACE`、`INSERT ... ON CONFLICT ... DO UPDATE`、`MERGE`，以及以上任一種包在 `WITH`／CTE 裡，不論修改在 CTE 本身或 CTE 之後、CTE 之間夾 PostgreSQL 的 `SEARCH`／`CYCLE` 子句）與 `audit_logs` 識別字（不分大小寫、可加引號與 schema 前綴），無論兩者實際語法位置關係、也無論關鍵字之間或關鍵字與表名之間是否夾 `/* */`、`--` 註解，都拒絕；`TRUNCATE` 敘述只要出現 `audit_logs` 識別字（不論在表清單第幾個、`*`／逗號前後是否有空白），或帶 `CASCADE`（不論對哪個資料表），也都拒絕；再驗證 `ON CONFLICT DO NOTHING`、SQLite 的 `INSERT OR IGNORE`、純新增（含值或 `RETURNING` 子句的字面文字恰好含關鍵字字樣者）、純讀取，以及不含 `audit_logs` 的其他敘述；`audit_logs` 識別字判斷改用 ASCII-only 不分大小寫（避免 Unicode 大小寫折疊，例如 `İ` 被誤判為 `i`）；再以 `text()` 驗證：PostgreSQL 的 `E'...'` 逸出字串（SQLite 不支援此語法，此處只驗證攔截器在送到資料庫前就先行判斷、與資料庫本身是否支援語法無關）內含反斜線跳脫引號（`E'\''`）的 upsert 仍被拒絕（正規化不會把跳脫的引號誤判成字串結尾而漏看後面的修改動作）；雙引號識別字內容經去除跳脫後完全等於 `audit_logs`（ASCII-only 不分大小寫）才視為 `audit_logs`，否則視為不相關的識別字（佔位處理，內容不再被當成一般 SQL 掃描），因此 `"audit_logs archive"`、`SELECT "UPDATE audit_logs" FROM other`、以及使用外觀相似字元（如 `İ`）的 `"audİt_logs"` 都不被誤判為 `audit_logs` 或修改動作關鍵字；反引號與 `[ ]` 識別字**不**做內容解析（PostgreSQL 的 `[` 是陣列／下標語法，不是識別字引號，嘗試比對配對括號曾經吞掉後面真正的修改動作，改採不吞內容的保守做法）：SQLite 的 `` `audit_logs` ``／`[audit_logs]` 精確引用因此仍會被偵測到，但 `` `audit_logs archive` ``／`[audit_logs archive]` 之類名稱裡剛好含 `audit_logs` 或關鍵字字樣的不同資料表會被誤擋（已知限制）；`ARRAY[[1, 2], [3, 4]]`、`ARRAY[(SELECT count(*) FROM audit_logs)]` 之後接 `UPDATE audit_logs` 的敘述驗證陣列語法不會吞掉後面的修改動作；PostgreSQL 的 `U&"..."` Unicode 逸出識別字（含 `UESCAPE`）不解碼跳脫序列，只要敘述同時出現修改動作與 `U&"` 識別字就一律保守視為可能指向 `audit_logs` 而拒絕（含與 `audit_logs` 無關的識別字，已知限制）；PostgreSQL 的 dollar-quoted 字串（`$$...$$`）與 `standard_conforming_strings = off` 的非 `E` 前綴逸出字串無法用字串比對可靠辨識，不在本條驗收範圍，改由 [#232](https://github.com/speko-tw/inspect-flow/issues/232) 的資料庫層保護涵蓋 | ORM 的四次、Core 的兩次與 `text()` 的十次修改、刪除（共 16 次）都被拒絕；重新讀取時，筆數與內容都和操作前相同；`text()` 的新增與讀取、ORM 新增紀錄、讀取其他資料表都成功，不被誤擋；issue #233 保守規則涵蓋的每種寫法都同樣被拒絕，資料不變；`ON CONFLICT DO NOTHING`、`INSERT OR IGNORE`、字面文字恰好含關鍵字字樣的純新增、純讀取都成功執行，不被誤擋；帶跳脫引號的 `E'...'` upsert 仍被拒絕；雙引號識別字內容不等於 `audit_logs` 的敘述都成功執行、內容等於的則被拒絕；陣列語法之後的 `UPDATE audit_logs` 都被拒絕；`U&"..."` 識別字搭配修改動作的敘述都被拒絕；保守規則已知會誤擋部分同時修改別的資料表又讀取 `audit_logs` 的敘述、帶 `CASCADE` 卻與 `audit_logs` 無關的 `TRUNCATE`、名稱含 `audit_logs`／關鍵字字樣的反引號或 `[ ]` 識別字，以及與 `audit_logs` 無關的 `U&"..."` 識別字，記在 `app/models/audit_log.py` 模組說明的「已知限制」 | ALG-R04 |
| ALG-AC04 | 初始化後的資料庫（有內建 `admin`）與另一位已登入的 `User` U；以可控時間固定現在時刻 | 不在 HTTP 請求中寫一筆紀錄；在已綁定 U 的請求範圍內寫一筆；在沒有登入者的請求範圍內寫一筆；呼叫端試圖自行指定操作者或時間 | 第一筆的 `created_by` 是 `admin`，第二筆是 U，兩筆的 `created_at` 都等於固定的時刻；第三次被拒絕、不寫入；入口不接受操作者與時間參數 | ALG-R05 |
| ALG-AC05 | 一個交易單位（DBF-R09） | 在同一個交易裡修改一筆 `Company`、寫一筆紀錄，然後拋出例外；另一個交易裡修改同一筆 `Company` 後，用未登記的事件代碼寫紀錄 | 兩次都回滾：`Company` 不變，`audit_logs` 沒有新紀錄 | ALG-R06 |
| ALG-AC06 | 事件目錄已登記 `role.updated` | 分別寫入：未登記的代碼 `role.renamed`；`after` 多了未宣告欄位 `password_hash`；`before`、`after` 完全相同的 `role.updated`；另掃描事件目錄所有宣告欄位 | 三次都被拒絕，筆數不變；沒有任何事件宣告含 `password`、`secret`、`token`、`session` 字樣的欄位 | ALG-R07、ALG-R08、ALG-R09 |
| ALG-AC07 | 初始化後的資料庫 | 依[第一批事件](#第一批事件)各寫一筆（`role.updated` 只改名；`project_member.roles_changed` 為新加入；`project_member.removed` 的 `role_ids` 為空陣列），集合欄位故意以未排序的順序、UUID 以 `uuid.UUID` 物件傳入，再從資料庫讀回 | 六種代碼都寫入成功；讀回的 `event_type`、`entity_type`、`entity_id` 等於輸入；`role.created` 的 `before`、`role.deleted` 與 `project_member.removed` 的 `after` 為空值；`role.updated` 只有 `name`；`project_member.roles_changed` 前後都有 `project_id`、`user_id`，`before.role_ids` 為空陣列；UUID 為字串、集合為排序後的陣列 | ALG-R09、ALG-R10、ALG-R11 |
| ALG-AC08 | 對空資料庫執行 `alembic upgrade head` 之後 | 執行初始化指令（DOM-AC08 的成功案例） | 初始化成功，`audit_logs` 為 0 筆 | ALG-R12 |
| ALG-AC09 | 事件目錄；測試結束後還原 | 在測試中登記一個測試用事件（`entity_type = user`，三個欄位），寫入一筆再讀回；比對寫入前後的 `alembic heads` 與 `audit_logs` 欄位 | 寫入與讀回成功；migration head 與欄位都沒有變 | ALG-R13 |
| ALG-AC10 | 事件目錄 | 逐一檢查所有已登記的事件代碼 | 每個代碼都符合 ALG-R07 的格式，且「資料」段等於該事件的 `entity_type` | ALG-R07 |
| ALG-AC11 | 初始化後的資料庫，`domain-model` T7 的入口可用；兩位啟用中的 Admin；角色 R1 由兩筆成員持有；專案 P | 透過 Service 層依序：新增角色 R2；R2 改名；把 U 加入 P 並指派 R2；替 U 再加 R1；把 V 加入 P 但不指派角色；刪除 R1；把 V 移出 P；取消一位 Admin 的 `is_admin`；嘗試取消最後一位 Admin 的 `is_admin`；停用一位非 Admin 的帳號 | 每一次成功的變更各恰有一筆紀錄，事件代碼依序為 `role.created`、`role.updated`、`project_member.roles_changed`、`project_member.roles_changed`、`role.deleted`、`project_member.removed`、`user.admin_changed`，內容依第一批事件；`role.deleted` 的 `project_member_ids` 恰為刪除當下持有 R1 的三筆成員（前置的兩筆與 U），且沒有另寫 `roles_changed`；加入 V、被拒絕的取消與停用帳號都沒有紀錄；`created_by` 都是目前操作者 | ALG-R14 |
| ALG-AC12 | 初始化後的資料庫（有內建 `admin`）；事件目錄已登記 `authentication` 事件 | 在沒有登入者的請求範圍內寫一筆 `user.locked`、一筆 `user.password_set`；在已綁定 U 的請求範圍內寫一筆 `user.locked`、兩筆 `before`、`after` 相同的 `user.password_set`；另在沒有登入者的請求範圍內寫一筆 `role.created` | 兩筆 `user.locked` 都寫入成功，`created_by` 都是內建 `admin`（含已綁定 U 的那筆）；沒有登入者的 `user.password_set` 與 `role.created` 都被拒絕；U 的兩筆都寫入成功，`created_by` 是 U | ALG-R15、ALG-R16、ALG-R17 |

## 待釐清

以下 intents 沒有依據，本規格不自行拍板；需要團隊裁定時另開 issue 移到 `05-open-questions.md`。ALG-Q1～Q4 不影響資料表；ALG-Q5 若選 B，要另加一支 migration 新增可空值的來源欄位，本規格已凍結的欄位不變。都不擋凍結。

<a id="alg-q1"></a>
- **ALG-Q1：保存期限**。選項：（A）永久保存，不提供清除；（B）保存固定年限後清除或封存；（C）可設定。業界：OWASP Logging Cheat Sheet 要求依法規與內部政策訂保存期限；ISO 27001、SOC 2 的稽核常見要求至少保存一年。**建議 A**：第一批事件只有權限變更，量很小，也和「不能刪除」一致；真要清除時另開規格。
<a id="alg-q2"></a>
- **ALG-Q2：查詢介面**。選項：（A）MVP 不提供，需要時由維運人員查資料庫；（B）Admin 專用的唯讀 API，可依資料、事件、時間篩選，cursor 分頁（KD-13）；（C）另做 `admin-dashboard` 畫面。業界：稽核紀錄通常只給系統管理者或稽核人員看，不給一般使用者。**建議 A**，到 `admin-dashboard`（0.8.x）再決定 B、C；誰能看，建議只限 Admin（[KD-24](../../intents/03-decisions-and-stack.md#kd-24)）。
<a id="alg-q3"></a>
- **ALG-Q3：要不要記錄讀取**。選項：（A）不記錄；（B）只記錄敏感資料的讀取或匯出（例如報告匯出）。業界：OWASP 建議視需要記錄敏感資料的存取，但讀取量大，一般不全記。**建議 A**：intents 沒有敏感讀取的要求；日後報告匯出若要記錄，再登記事件（ALG-R13）。
<a id="alg-q4"></a>
- **ALG-Q4：`User.is_active`（停用、啟用帳號）要不要記錄**。#126 只裁定 `is_admin`。選項：（A）記錄，新增 `user.active_changed`；（B）不記錄，只靠 `updated_at`、`updated_by`。業界：OWASP 把新增、刪除帳號與權限變更列為應記錄的高風險操作。**建議 A**：停用就是拿掉登入能力，DOM-R07 也把停用當成拿掉 Admin。選 A 時只要在事件目錄多登記一種事件，由 DOM T7（#135）寫入。
<a id="alg-q5"></a>
- **ALG-Q5：要不要記錄請求來源（IP、User-Agent、Session）**。選項：（A）不記錄；（B）新增可空值的來源欄位。業界：OWASP 建議記錄「何時、何處、誰、做什麼」，「何處」通常包含 IP。**建議 A**：第一階段是單機、內網，操作者已記在 `created_by`；之後要加，只需一支新增可空值欄位的 migration。

## 變更紀錄

凍結後的「範圍變更」以上才記；一行寫改了什麼與 issue 連結。

- 依 AUT-Q6 裁定，新增 ALG-R15～ALG-R17（系統事件、每次都寫、`authentication` 事件）與 ALG-AC12，登記 `user.password_set`、`user.locked`，ALG-R05、ALG-R09 補上對應的例外 — [#148](https://github.com/speko-tw/inspect-flow/issues/148)
