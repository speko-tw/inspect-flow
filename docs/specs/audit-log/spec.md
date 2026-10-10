# 稽核紀錄（audit-log）

**代碼**：`ALG`　**Phase**：P2　**狀態**：已凍結
**前置規格**：`database-foundation`（UUID 主鍵、UTC 時間、`created_by` 外鍵，見 DBF-R08、DBF-R11、DBF-R14）、`domain-model`（`User`、`Role`、`ProjectMember`、目前操作者，見 DOM-R05、DOM-R14、DOM-R19～DOM-R25；帳號名稱與公司連結見 DOM-R45、DOM-R47、DOM-R53）、`api-conventions`（UUID 字串、時間格式，見 API-R06、API-R09）
**引用意圖**：[PR-03](../../intents/02-principles.md#pr-03)、[PR-08](../../intents/02-principles.md#pr-08)、[PR-14](../../intents/02-principles.md#pr-14)、[KD-07](../../intents/03-decisions-and-stack.md#kd-07)、[KD-14](../../intents/03-decisions-and-stack.md#kd-14)、[KD-20](../../intents/03-decisions-and-stack.md#kd-20)、[KD-24](../../intents/03-decisions-and-stack.md#kd-24)、[KD-43](../../intents/03-decisions-and-stack.md#kd-43)、[KD-45](../../intents/03-decisions-and-stack.md#kd-45)、[KD-46](../../intents/03-decisions-and-stack.md#kd-46)、[KD-29](../../intents/03-decisions-and-stack.md#kd-29)、[04-glossary](../../intents/04-glossary.md)「稽核紀錄」
**被擋議題**：無（[ALG-Q1](#alg-q1)、[ALG-Q3](#alg-q3)、[ALG-Q5](#alg-q5) 不擋凍結：Q1、Q3 不影響資料表；Q5 若選 B，另加一支 migration 新增可空值欄位，已凍結的欄位不變；[ALG-Q2](#alg-q2)、[ALG-Q4](#alg-q4)、[ALG-Q6](#alg-q6) 已裁定）

## 目的

權限與角色每一次變更都留下一筆不能修改、不能刪除的紀錄，事後能回答「誰、何時、對哪一筆資料、做了什麼、改之前與改之後是什麼」。這份規格定義紀錄的資料模型、寫入方式與第一批事件，之後外部身分同步覆蓋基本欄位時沿用同一套（依據：[KD-29](../../intents/03-decisions-and-stack.md#kd-29)、[KD-20](../../intents/03-decisions-and-stack.md#kd-20)、[04-glossary](../../intents/04-glossary.md)「稽核紀錄」（架構基準 §19）；由本規格定義為負責人裁定，[#126](https://github.com/speko-tw/inspect-flow/issues/126)，2026-09-27）。

## 範圍

**包含**：

- `AuditLog` 的資料模型與「只能新增」的保護。
- Service 層寫入稽核紀錄的單一入口，以及事件目錄（每種事件記哪些欄位）。
- 第一批事件：`Role` 的新增、修改、刪除；`ProjectMember` 的角色指派；把人移出專案；`User.is_admin` 的變更（[KD-29](../../intents/03-decisions-and-stack.md#kd-29)、DOM-R22、[#126](https://github.com/speko-tw/inspect-flow/issues/126)、[#125](https://github.com/speko-tw/inspect-flow/issues/125)）。
- `authentication` 的兩種事件：設定密碼、帳號被鎖（[AUT-Q6](../authentication/spec.md#aut-q6) 裁定，[#148](https://github.com/speko-tw/inspect-flow/issues/148)），見 [`authentication` 事件](#authentication-事件)；首次設定 `admin` 密碼與 `admin` 重設指令沿用 `user.password_set`（ALG-R18、ALG-R21）。
- 帳號名稱修改與公司連結變更（含因此清空的欄位）兩種事件（DOM-R22；負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）），見[帳號與公司連結事件](#帳號與公司連結事件)。
- 帳號停用與啟用事件，以及模組權限的授予與收回、模組委派的指派與收回、權限組合、建立者角色設定事件（DOM-R22；負責人裁定（[#538](https://github.com/speko-tw/inspect-flow/issues/538)，2026-10-09），見 [KD-69](../../intents/03-decisions-and-stack.md#kd-69)），見[帳號與公司連結事件](#帳號與公司連結事件)與[模組權限事件](#模組權限事件)。
- `ProjectZone` 新增、改名與刪除事件，依 `inspection-planning` IP-R10 登記，見[`inspection-planning` 事件](#inspection-planning-事件)。
- 寫入時機的驗收：DOM-R22 列出的每一種變更是否寫出正確的紀錄（DOM-R22 寫明由本規格驗收）。
- 預留：外部身分同步覆蓋基本欄位的事件（[KD-20](../../intents/03-decisions-and-stack.md#kd-20)），只保證之後不用改資料表就能套用。
- 0.5.x 的 Admin 唯讀稽核查詢 API 與管理後台頁面，依[ALG-Q2](#alg-q2) 裁定及 [admin-dashboard](../admin-dashboard/spec.md#介面)契約實作。

**不包含**：

- 寫入入口本身（`Role`、角色指派、移出專案、`is_admin` 的 Service 層入口）與在其中呼叫本規格的寫入入口：由 `domain-model` 實作（DOM-R22；計畫 T7，[#135](https://github.com/speko-tw/inspect-flow/issues/135)），本規格只驗收，見[寫入時機](#寫入時機)。
- 初始化指令建立的資料：不寫稽核紀錄（[#126](https://github.com/speko-tw/inspect-flow/issues/126) 裁定），見 ALG-R12；首次設定流程的事件是系統事件，見 ALG-R18。首次登入碼被鎖只寫應用程式日誌，不寫稽核紀錄（[AUT-R45](../authentication/spec.md)）。
- 外部身分同步的事件代碼與欄位：由 `external-identity-sync` 登記（ALG-R13）。
- 登入成功、登入失敗、登出：只寫應用程式日誌，不寫稽核紀錄（AUT-R40，[AUT-Q6](../authentication/spec.md#aut-q6) 裁定）。
- `authentication` 事件的寫入入口與寫入時機的驗收：由 `authentication` 實作與驗收（AUT-R39、AUT-AC49～AUT-AC51、AUT-AC62）。
- 保存期限、讀取紀錄是否另寫稽核、請求來源資訊：見[待釐清](#待釐清)；查詢 API 與畫面已依 [ALG-Q2](#alg-q2) 裁定納入範圍。
- 其他資料（`Company`、`User` 基本欄位的人工修改等）的完整操作歷史：屬「延後但不排除」的 Audit Trail（[01-overview](../../intents/01-overview.md#延後但不排除的能力)，架構基準 §35）；這些資料目前只靠 [PR-08](../../intents/02-principles.md#pr-08) 的建立與修改紀錄。
  - **部分已被取代**（負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29））：「`User` 基本欄位的修改不寫稽核」這一部分不再成立，帳號名稱修改與公司連結變更（含清空的工號、部門與地點）改為要寫，見 ALG-R19、ALG-R20；`User` 的姓名、email 與 `Company` 的修改，以及單獨修改工號、部門、地點，仍不寫；`User.is_active` 的變更改為要寫（[ALG-Q4](#alg-q4) 已裁定，ALG-R25）。
- 資料庫層的防竄改（trigger、權限控管、雜湊鏈）：見[考慮過但沒採用的做法](plan.md#考慮過但沒採用的做法)。

## 使用情境

- Admin 把「現場查核」角色的權限加上 `report.approve`；系統同時寫一筆 `role.updated`，記下改前、改後的權限代碼清單與操作者。
- Admin 刪除「唯讀」角色；三位成員的這個角色指派一併被移除（DOM-R21），紀錄保留角色原本的名稱、權限與受影響的成員。角色刪掉後，紀錄仍查得到。
- Admin 把一位同事設為 Admin；寫一筆 `user.admin_changed`。
- 負責人首次登入設定 `admin` 密碼；寫一筆 `user.password_set`，操作者記為內建 `admin`（系統事件）。
- Admin 把一位同事的帳號名稱從 `anna.deng` 改成 `anna.d`；寫一筆 `user.username_changed`。Admin 把同事從甲公司改到乙公司；寫一筆 `user.company_changed`，連同被清空的工號、部門與地點一起記下。
- 修改在寫稽核紀錄時失敗，整筆修改一起回滾，不會出現「改了但沒紀錄」。
- 工程師想改掉一筆寫錯的稽核紀錄，程式會拒絕。

## 需求

欄位名稱是本規格建議的識別字（強度為「應」）。

### 資料模型

| 編號 | 需求 | 強度 | 依據 | 驗收 |
|---|---|---|---|---|
| ALG-R01 | `AuditLog`（資料表 `audit_logs`）**必須**具備：`id`（UUID 主鍵）、`created_at`（事件時間，含時區的 UTC）、`created_by`（操作者，外鍵指向 `User`）、`event_type`（事件代碼）、`entity_type`（被記錄的資料種類，例如 `role`）、`entity_id`（被記錄那一筆的 UUID）、`before`、`after`（改前、改後的內容，JSON），以及可空值、有索引的 `project_id`（事件所屬專案 UUID，不設外鍵）。`before`、`after`、`project_id` 允許空值，其餘不可空值，由資料庫約束保證；新增 `project_id` 以後續 migration 落地，既有紀錄不回填 | 必須；應（欄位名） | [04-glossary](../../intents/04-glossary.md)「稽核紀錄」（誰、何時、哪個 entity、做了什麼、前後內容，架構基準 §19）；[KD-07](../../intents/03-decisions-and-stack.md#kd-07)；[PR-08](../../intents/02-principles.md#pr-08)；做法同 DBF-R08、DBF-R11、DBF-R14；`project_id` 為規格設計（非負責人裁定），依 [ALG-Q2](#alg-q2) 專案篩選需求保留事件當下脈絡 | ALG-AC01、ALG-AC18 |
| ALG-R02 | `AuditLog` **不得**有 `updated_at`、`updated_by` | 必須 | 本規格推導：紀錄不會被修改（ALG-R04），PR-08 的「最後修改」不適用，留著欄位會讓人以為可以改 | ALG-AC01 |
| ALG-R03 | `entity_id` **不得**是外鍵；被記錄的資料刪除後，紀錄**必須**保留 | 必須 | [#126](https://github.com/speko-tw/inspect-flow/issues/126)（只能新增、不能刪除）；`Role` 可刪除（DOM-R21），外鍵會擋下刪除或連帶刪掉紀錄 | ALG-AC02 |
| ALG-R04 | 稽核紀錄只能新增：Service 層只提供新增入口；後端經 SQLAlchemy 對 `audit_logs` 執行的任何修改或刪除（ORM flush、ORM 批次 `update`／`delete`、Core 語句、`text()` 原始 SQL）**必須**被拒絕，資料不變。後端以外直接連資料庫不在本條範圍：後端程式不得直接用資料庫驅動（DBF-R01），資料庫層保護見[計畫](plan.md#考慮過但沒採用的做法) | 必須 | [#126](https://github.com/speko-tw/inspect-flow/issues/126) 裁定（依 OWASP：只能新增，不能修改或刪除）；不要求資料庫層保護，理由：要寫資料庫專用 SQL（[PR-03](../../intents/02-principles.md#pr-03)） | ALG-AC03 |

### 寫入

| 編號 | 需求 | 強度 | 依據 | 驗收 |
|---|---|---|---|---|
| ALG-R05 | Service 層**必須**從單一入口寫稽核紀錄。`created_by` **必須**取自「目前操作者」入口（DOM-R14、AUT-R09），`created_at` 由後端填寫，呼叫端不能指定；系統事件依 ALG-R15、ALG-R18 | 必須 | [KD-29](../../intents/03-decisions-and-stack.md#kd-29)；DOM-R14、AUT-R09（請求中沒有登入者時拒絕，不記成內建 `admin`） | ALG-AC04 |
| ALG-R06 | 稽核紀錄**必須**和它記錄的變更在同一個交易（DBF-R09）寫入：變更回滾時紀錄一起回滾；寫紀錄失敗時變更也不生效 | 必須 | 本規格推導：[KD-29](../../intents/03-decisions-and-stack.md#kd-29) 要求所有變更都有紀錄，分開提交會留下「改了但沒紀錄」 | ALG-AC05 |
| ALG-R07 | `event_type` **必須**是事件目錄（ALG-R11）登記過的代碼，否則拒絕寫入。代碼**應**採 `<資料>.<動作>`，符合 `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$` | 必須（登記）；應（格式） | [KD-29](../../intents/03-decisions-and-stack.md#kd-29)；格式沿用 API-R07、DOM-R30 的 dot-namespace（[KD-15](../../intents/03-decisions-and-stack.md#kd-15)），理由：同一套命名好辨認 | ALG-AC06、ALG-AC10 |
| ALG-R08 | `before`、`after` **必須**只含事件目錄為該事件宣告的欄位，多出的欄位拒絕寫入；密碼、密碼雜湊、Session 值**不得**出現在任何事件的宣告欄位裡 | 必須 | [PR-14](../../intents/02-principles.md#pr-14)（log 不得記錄密碼、Session secret）；稽核紀錄也是一種 log，本規格從嚴判讀 | ALG-AC06 |
| ALG-R09 | 內容的形狀：新增事件 `before` 為空值；刪除事件 `after` 為空值；修改事件只記有變動的欄位，目錄另有標明「一律記錄」的欄位除外。修改前後完全相同時**應**不寫紀錄，寫入入口拒絕；每次都寫的事件依 ALG-R16 | 必須（形狀）；應（無變動不寫） | [04-glossary](../../intents/04-glossary.md)「稽核紀錄」（修改前後內容）；形狀是本規格的定義，理由：讀紀錄的人一眼看出改了什麼 | ALG-AC06、ALG-AC07 |
| ALG-R10 | JSON 內的值**應**統一表示：UUID 為字串（API-R06）；時間為 API-R09 格式；權限代碼、角色 ID 等集合為排序後的陣列 | 應 | API-R06、API-R09；排序是本規格的推導，理由：同樣的內容永遠寫成同樣的 JSON，比對前後才不會誤判 | ALG-AC07 |

### 事件

| 編號 | 需求 | 強度 | 依據 | 驗收 |
|---|---|---|---|---|
| ALG-R11 | 事件目錄**必須**至少包含[第一批事件](#第一批事件)，欄位依該表 | 必須 | [KD-29](../../intents/03-decisions-and-stack.md#kd-29)（權限與角色的變更）；DOM-R22（事件範圍，含移出專案，[#125](https://github.com/speko-tw/inspect-flow/issues/125)）；[#126](https://github.com/speko-tw/inspect-flow/issues/126)（`is_admin` 的變更算權限變更） | ALG-AC07 |
| ALG-R12 | 初始化指令（DOM-R53）**不得**寫稽核紀錄。初始化建立內建 `admin`、首次登入碼（AUT-R42）與預建的專案角色、建立者角色設定、預設權限組合（DOM-R68；負責人裁定，[#538 第 10 點](https://github.com/speko-tw/inspect-flow/issues/538)）。這些是系統安裝資料，不含任何人工操作；之後由首次設定流程產生的事件依 ALG-R18 | 必須 | [#126](https://github.com/speko-tw/inspect-flow/issues/126) 裁定（初始化是系統安裝，不是權限變更；資料本身已有建立紀錄）；負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）：初始化指令改寫為 DOM-R53，首次設定另算系統事件 | ALG-AC08 |
| ALG-R13 | 外部來源的值覆蓋 `User` 基本欄位時，每次覆蓋**必須**寫一筆稽核紀錄；事件代碼與欄位由 `external-identity-sync` 登記進事件目錄。本規格的資料表與寫入入口**必須**不改 schema 就能登記新事件 | 必須 | [KD-20](../../intents/03-decisions-and-stack.md#kd-20)；「不改 schema」是本規格為預留所做的推導 | ALG-AC09（新增事件不需 migration）；覆蓋時寫紀錄由 `external-identity-sync` 驗收 |
| ALG-R14 | DOM-R22 列出的每一種變更成功時，**必須**在同一個交易裡寫恰好一筆對應事件的紀錄，內容依[第一批事件](#第一批事件)與[帳號與公司連結事件](#帳號與公司連結事件)；變更被拒絕或回滾時**不得**留下紀錄（唯一的例外是被擋下的違規指派，見 ALG-R28）；DOM-R22 範圍外的變更（例如新增沒有角色的成員）不寫 | 必須 | [KD-29](../../intents/03-decisions-and-stack.md#kd-29)；DOM-R22（由本規格驗收，範圍含帳號名稱修改與公司連結變更：負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29））；「恰好一筆」是本規格推導，理由：同一次變更寫多筆或漏寫都會讓紀錄對不上 | ALG-AC11；帳號名稱與公司連結的變更由 ALG-AC14、ALG-AC15 |
| ALG-R15 | 事件目錄**得**把事件標為「系統事件」：由系統自動觸發、沒有登入者的事件（例如帳號被鎖）。系統事件的 `created_by` **必須**是內建 `admin`（`is_system = true`），不論是否在請求中、有沒有登入者；未標為系統事件的事件照 ALG-R05，請求中沒有登入者時仍拒絕 | 得（標記）；必須（操作者） | [AUT-Q6](../authentication/spec.md#aut-q6) 裁定（帳號被鎖寫稽核紀錄，[#148](https://github.com/speko-tw/inspect-flow/issues/148)）；鎖定發生在未登入的登入請求裡，照 ALG-R05 會被拒絕。用內建 `admin` 是本規格的推導，理由：它本來就是「不在請求中」時的系統操作者（DOM-R14）；只開放給標記的事件，漏掛需登入的一般寫入仍會被擋 | ALG-AC12 |
| ALG-R16 | 事件目錄**得**把事件標為「每次都寫」：宣告的欄位一律記錄，`before`、`after` 相同也照寫，不適用 ALG-R09 的「只記有變動的欄位」與「無變動不寫」 | 得 | 本規格推導：設定密碼時旗標可能不變（例如本人把非臨時密碼換成另一組），但這仍是一次要留紀錄的事件，差別在雜湊，而雜湊不得記錄（ALG-R08） | ALG-AC12 |
| ALG-R17 | 事件目錄**必須**包含 [`authentication` 事件](#authentication-事件)，欄位依該表 | 必須 | [AUT-Q6](../authentication/spec.md#aut-q6) 裁定；依 ALG-R13 只登記事件，不改資料表 | ALG-AC12 |
| ALG-R18 | 首次設定 `admin` 密碼（[AUT-R44](../authentication/spec.md)）**必須**寫一筆 `user.password_set`，並視為系統事件：操作者是內建 `admin`（`is_system = true`），即使該次請求沒有登入者。事件目錄把 `user.password_set` 標為「得為系統事件」，由呼叫端明確宣告；只有首次設定的公開路由這樣呼叫，本人變更密碼、Service 入口等其他來源照 ALG-R05，沒有登入者時仍拒絕 | 必須（首次設定的事件與操作者）；得（標記） | 負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）：首次設定當系統事件、操作者 `admin`，比照 ALG-R15；「由呼叫端宣告、其他來源不受影響」是本規格的判讀（見 [ALG-Q6](#alg-q6)），理由：`user.password_set` 也有需要登入者的來源，不能像 `user.locked` 一樣整個事件都固定成系統事件 | ALG-AC13 |
| ALG-R19 | 事件目錄**必須**包含[帳號與公司連結事件](#帳號與公司連結事件)，欄位依該表 | 必須 | 負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）（帳號名稱修改與公司連結變更要寫稽核，DOM-R22）；依 ALG-R13 只登記事件，不改資料表 | ALG-AC14、ALG-AC15 |
| ALG-R20 | `user.company_changed` 只在 `User.company_id` 改變（換公司、連結、解除連結）時寫；`before`、`after` **必須**一律記錄 `company_id`、`employee_no`、`department`、`location` 四個欄位，讓被清空與被重新填入的值看得出來。單獨修改工號、部門或地點（`company_id` 不變）不寫 | 必須（欄位與觸發）；應（一律記錄四欄） | 負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）：換公司或解除連結時清空欄位要寫稽核；「四欄一律記錄」與「單獨改工號不寫」是本規格的判讀（見 [ALG-Q6](#alg-q6)），理由：讀紀錄的人一眼看出清掉了什麼；沿用 `project_member.roles_changed` 一律記錄識別欄位的做法 | ALG-AC15 |
| ALG-R21 | `admin` 重設指令（[AUT-R47](../authentication/spec.md)）沿用 `user.password_set`，**不得**新增事件代碼；因為指令不在 HTTP 請求中，操作者依 DOM-R14 是內建 `admin`，`is_temporary` 記為 `false`（重設後的密碼不是臨時密碼） | 必須 | 負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）：重設指令沿用 `user.password_set`；`is_temporary` 為 `false` 依 AUT-R47 重設後不標臨時 | ALG-AC16 |

### 查詢

| 編號 | 需求 | 強度 | 依據 | 驗收 |
|---|---|---|---|---|
| ALG-R22 | 0.5.x 管理後台**必須**提供 Admin 專用的稽核紀錄查詢頁與唯讀 API；未登入者與非 Admin 不得取得紀錄，查詢不得新增、修改或刪除紀錄 | 必須 | [ALG-Q2](#alg-q2) 負責人裁定（[#107 留言](https://github.com/speko-tw/inspect-flow/issues/107#issuecomment-5977843511)）；[ADM-R07](../admin-dashboard/spec.md#需求)、ALG-R04 | ALG-AC17；ADM-AC06 |
| ALG-R23 | 查詢**必須**支援專案、操作者、時間範圍、事件類型的多條件篩選與穩定 cursor 分頁；具體參數、排序、回應與錯誤契約依[查詢 API](#查詢-api)及 [ADM-R08](../admin-dashboard/spec.md#需求)。格式正確但不存在的 `project_id` 必須回 200 空頁 | 必須 | [ALG-Q2](#alg-q2) 負責人裁定了篩選與唯讀畫面；[ADM-R08](../admin-dashboard/spec.md#需求)、[KD-13](../../intents/03-decisions-and-stack.md#kd-13)、API-R08；查詢 API 的具體比對、時間邊界、排序、page size、錯誤與不存在專案空頁均為規格設計（非負責人裁定），細節見[查詢 API](#查詢-api) | ALG-AC18；ADM-AC07、ADM-AC13 |
| ALG-R24 | 寫入入口在事件具專案脈絡時**必須**將事件當下的專案 UUID 寫入 `AuditLog.project_id`：已登記的 `project_member.*`、`project_zone.*`、`inspection_task.*`、`project_inspection_item.*` 取其所屬專案，`template_item.created_from_project` 取來源專案；日後登記的 Plan／Task 事件若具專案脈絡，同樣填入。無專案脈絡的 `role.*`、`user.*` 等寫空值。刪除或修改事件即使 `before`／`after` 未列 `project_id`，仍須從被操作資料的所屬專案取得。帶 `project_id` 篩選只回欄位相符的紀錄，排除空值；不帶時回全部。既有紀錄不回填，歷史事件的 `project_id` 為空，無法由專案篩選找回 | 必須 | 規格設計（非負責人裁定）：為 [ALG-Q2](#alg-q2) 的專案篩選建立明確、可索引且不依賴已刪除 entity 的依據；不回填避免猜測歷史事件的專案歸屬 | ALG-AC18 |
| ALG-R25 | `User.is_active` 改變（停用或啟用）成功時，**必須**在同一個交易裡寫恰好一筆 `user.active_changed`；改前改後相同不寫；被拒絕（例如停用最後一位 Admin、內建 `admin`）不寫。經由停用公司而一併停用的人員，逐人各寫一筆（DOM-R33）。重新啟用時，事件另記下 Admin 勾選的恢復項目與被移除的項目（含模組委派，DOM-R67），未勾選而被收回與移除的項目另依各自事件（`module_permission.revoked`、`module_delegation.revoked`、`project_member.removed`）在同一交易寫稽核；外部協作人員的自動停用是系統事件，到期只寫一次（DOM-R75） | 必須 | 負責人裁定（[#538 第 5 點](https://github.com/speko-tw/inspect-flow/issues/538)，2026-10-09）、負責人裁定（[#538 第 23 點](https://github.com/speko-tw/inspect-flow/issues/538)，2026-10-09）（補停用與啟用稽核事件、重新啟用前勾選確認）；「恰好一筆」比照 ALG-R14；逐人各寫與恢復項目的記錄方式是規格設計（非負責人裁定） | ALG-AC19 |
| ALG-R26 | 事件目錄**必須**包含[模組權限事件](#模組權限事件)；DOM-R59～DOM-R64 的每一種變更成功時，**必須**在同一個交易裡寫恰好一筆對應事件，授權事件含 `source`；變更被拒絕、回滾或冪等（重複授予、重複收回）時**不得**留下紀錄。套用權限組合只寫 `permission_bundle.applied` 一筆，整組被拒絕時不寫；自動蘊含的授權（`project.create` 一併授予 `project.use`）各寫一筆 | 必須 | 負責人裁定（[#538 第 8 點](https://github.com/speko-tw/inspect-flow/issues/538)，2026-10-09）、負責人裁定（[#538 第 13 點](https://github.com/speko-tw/inspect-flow/issues/538)，2026-10-09）、負責人裁定（[#538 第 19 點](https://github.com/speko-tw/inspect-flow/issues/538)，2026-10-09）（模組權限與委派的授予、收回都寫稽核、開設專案蘊含可使用、套用組合逐項驗權）；權限組合與建立者角色設定的事件、套用組合只寫一筆、標示授權來源是規格設計（非負責人裁定）（兩位專家審查建議）；比照 [KD-29](../../intents/03-decisions-and-stack.md#kd-29) 與刪除角色只寫一筆（ALG-R14） | ALG-AC20、ALG-AC21 |
| ALG-R27 | 初始化指令的預建資料（三個專案角色、建立者角色設定、三組預設權限組合，DOM-R68）與改造 migration 的資料轉換（`template_admin` 轉為 `template.manage`、既有成員回填「可使用」，`source = backfill`）**不寫**稽核紀錄，與初始化指令同樣屬於系統搬遷、不含任何人工授權（ALG-R12）；轉換前後的有效權限比對由改造任務驗收（DOM-AC63、AUT-AC74）；回填的授權靠 `source` 欄位追溯 | 必須 | 負責人裁定（[#538 第 14 點](https://github.com/speko-tw/inspect-flow/issues/538)，2026-10-09）（回填只寫在 migration、以自動化測試驗證）；不寫稽核與以 `source` 追溯是規格設計（非負責人裁定）（比照 ALG-R12 的初始化規則）；見 [KD-69](../../intents/03-decisions-and-stack.md#kd-69) | ALG-AC22 |
| ALG-R28 | 專案事件（[專案事件](#專案事件)）：新增專案**必須**在同一交易寫 `project.created`，修改專案基本欄位**必須**在同一交易寫 `project.updated`；指派被 DOM-R70 或 DOM-R72 擋下、授權被 DOM-R62 或 DOM-R63 拒絕時，後端**必須**分別寫 `project_member.assignment_denied`、`module_permission.grant_denied`，且在獨立交易寫入，使請求失敗後仍保留，這是 ALG-R14「被拒絕不留紀錄」的唯一例外 | 必須 | 負責人裁定（[#538 第 18 點](https://github.com/speko-tw/inspect-flow/issues/538)，2026-10-09）（後端擋下違規並寫稽核）；`project.created`、`project.updated`、獨立交易的做法與授權拒絕事件是規格設計（非負責人裁定）（兩位專家審查建議） | ALG-AC23、ALG-AC24 |
| ALG-R29 | **操作者身分快照**：每筆稽核紀錄**必須**保存寫入當下的操作者身分快照（欄位 `actor_snapshot`，文字，由寫入入口依操作者當下的姓名、外部協作人員標記與單位組成）：外部協作人員為「姓名．外部協作人員．單位」，沒有單位時為「外部協作人員（未填單位）」，內部人員為「姓名．單位」（沒有單位時只有姓名）；日後人員資料變更不影響已寫入的快照；這是 ALG-R05 的欄位補充，新增一支 migration 加不可空值欄位（既有紀錄以當時 `created_by` 的現值回填一次），事件目錄不變 | 必須 | 負責人裁定（[#538 第 25 點](https://github.com/speko-tw/inspect-flow/issues/538)，2026-10-10）第 6 點：每筆紀錄保存寫入當下的身分快照；欄位名稱、組成方式與既有紀錄的回填是規格設計（非負責人裁定） | ALG-AC25 |

## 第一批事件

`entity_type` 與事件代碼的「資料」段相同。「一律記錄」的欄位不論有沒有變動都寫，讓紀錄在被記錄的資料刪除後仍看得懂。

| 事件代碼 | 什麼時候寫 | `entity_type` | `before` | `after` |
|---|---|---|---|---|
| `role.created` | 新增 `Role` | `role` | 空值 | `name`、`permission_codes` |
| `role.updated` | 改名、修改權限內容、修改 `is_assignable`（DOM-R70）或 `is_external_allowed`（DOM-R72、DOM-R73） | `role` | 有變動的 `name`、`permission_codes`、`is_assignable`、`is_external_allowed` | 同左 |
| `role.deleted` | 刪除 `Role`，連同移除所有指派（DOM-R21） | `role` | `name`、`permission_codes`、`project_member_ids`（被一併移除這個角色的成員） | 空值 |
| `project_member.roles_changed` | 一筆 `ProjectMember` 的角色集合改變：加入專案時就指派角色、之後增減角色。加入時 `before.role_ids` 為空陣列；加入時沒有指派角色不寫（DOM-R22 範圍外，DOM-R36 允許沒有角色） | `project_member` | `role_ids`；一律記錄 `project_id`、`user_id` | 同左 |
| `project_member.removed` | 把人移出專案，刪除 `ProjectMember` 與它的指派（DOM-R36）；成員沒有角色時也寫 | `project_member` | `project_id`、`user_id`、`role_ids` | 空值 |
| `user.admin_changed` | `User.is_admin` 改變 | `user` | `is_admin` | `is_admin` |

- `permission_codes`、`role_ids`、`project_member_ids` 記整個集合，不記差異，讀的人不必自己推算。
- 刪除角色只寫一筆 `role.deleted`，不再替每位受影響的成員各寫一筆 `project_member.roles_changed`；移出專案同理，只寫 `project_member.removed`：`project_member_ids` 已能還原影響範圍，也避免一次刪除寫出大量紀錄。

<a id="template-system-事件"></a>
## `template-system` 事件

依 [TPL-R09](../template-system/spec.md#需求) 登記全系統範本管理員角色指派與收回事件；事件須和角色指派變更在同一個交易內寫入（ALG-R06、ALG-R14）。這兩種事件只在過渡期（`template_admin` 改造完成前）使用，改造後範本管理權限改用[模組權限事件](#模組權限事件)。

範本管理員將專案查核項目存成範本時，另寫 `template_item.created_from_project`；事件與範本建立在同一個交易內完成，並記錄來源專案、副本及目標系統的 ID。

| 事件代碼 | 什麼時候寫 | `entity_type` | `before` | `after` |
|---|---|---|---|---|
| `system_role_assignment.created` | 指派固定的 `template_admin` 角色 | `system_role_assignment` | 空值 | `user_id`、`role_code` |
| `system_role_assignment.deleted` | 收回固定的 `template_admin` 角色 | `system_role_assignment` | `user_id`、`role_code` | 空值 |
| `template_item.created_from_project` | 範本管理員將專案查核項目存成範本 | `template_item` | 空值 | `project_id`、`project_inspection_item_id`、`system_id` |

<a id="模組權限事件"></a>
## 模組權限事件

依 DOM-R22（負責人裁定（[#538](https://github.com/speko-tw/inspect-flow/issues/538)，2026-10-09），見 [KD-69](../../intents/03-decisions-and-stack.md#kd-69)）登記；本節事件是正式行為，隨 `domain-model` 任務 L 起的各實作任務生效，過渡期結束前 `system_role_assignment.*` 照舊。入口由 `domain-model` 的人員模組 Service 實作（DOM-R59～DOM-R64），寫入時機由本規格驗收（ALG-R26）。改造 migration 回填的權限（`source = backfill`）與預建資料不寫事件（ALG-R27）。

| 事件代碼 | 什麼時候寫 | `entity_type` | `before` | `after` |
|---|---|---|---|---|
| `module_permission.granted` | 授予一項模組權限（DOM-R62）；已有時不寫；自動蘊含的 `project.use`（`source = implied`）同樣各寫一筆 | `module_permission` | 空值 | `user_id`、`permission_code`、`module`、`source` |
| `module_permission.revoked` | 收回一項模組權限（DOM-R62）；沒有時不寫 | `module_permission` | `user_id`、`permission_code`、`module`、`source` | 空值 |
| `module_delegation.granted` | Admin 指派模組委派者（DOM-R61）；已被委派時不寫 | `module_delegation` | 空值 | `user_id`、`module` |
| `module_delegation.revoked` | Admin 收回模組委派者；沒有委派時不寫 | `module_delegation` | `user_id`、`module` | 空值 |
| `permission_bundle.created` | 新增權限組合（DOM-R63） | `permission_bundle` | 空值 | `name`、`permission_codes` |
| `permission_bundle.updated` | 改名或修改組合內容 | `permission_bundle` | 有變動的 `name`、`permission_codes` | 同左 |
| `permission_bundle.deleted` | 刪除權限組合；已套用過的人不受影響 | `permission_bundle` | `name`、`permission_codes` | 空值 |
| `permission_bundle.applied` | 把組合套用到一個人（DOM-R63；`entity_id` 為組合），全部通過才寫；只寫這一筆，不另寫逐項 `module_permission.granted`；整組被拒絕時不寫 | `permission_bundle` | 空值 | `user_id`、`bundle_id`、`bundle_name`、實際新增的 `permission_codes`（這些權限的 `source` 為 `bundle`） |
| `creator_role.changed` | 建立者角色設定改變（DOM-R64；`entity_id` 為新的建立者角色） | `creator_role` | `creator_role_id` | `creator_role_id` |

- 授予與收回由被委派者執行時，`created_by` 仍是操作者本人，讓紀錄能看出是誰授予的；`permission_codes` 記整個集合並排序（ALG-R10）。
- `permission_bundle.applied` 的 `permission_codes` 只含這次實際新增的代碼（已有的不重複記）；全部都已有時不寫。
- 帳號停用與啟用事件 `user.active_changed` 見[帳號與公司連結事件](#帳號與公司連結事件)。

<a id="專案事件"></a>
## 專案事件

依 DOM-R22（負責人裁定（[#538 第 3 點](https://github.com/speko-tw/inspect-flow/issues/538)，2026-10-09）、負責人裁定（[#538 第 18 點](https://github.com/speko-tw/inspect-flow/issues/538)，2026-10-09），見 [KD-69](../../intents/03-decisions-and-stack.md#kd-69)）登記；本節事件是正式行為，隨 `domain-model` 任務 N 生效。

| 事件代碼 | 什麼時候寫 | `entity_type` | `before` | `after` |
|---|---|---|---|---|
| `project.created` | 新增專案（DOM-R65），與建立者或建立者角色人選的 `project_member.roles_changed` 同一交易 | `project` | 空值 | `project_code`、`name`、`company_role`；Admin 帶 `creator_role_user_id` 時另含該欄位 |
| `project.updated` | 修改專案基本欄位（DOM-R66）；沒有變動不寫；改本公司角色（DOM-R76）沿用此事件，不另登記 | `project` | 有變動的欄位（含 `company_role`） | 同左；`company_role` 有變動時另含 `company_role_change_reason`（原因） |
| `project_member.assignment_denied` | 指派被 DOM-R70 的（1）（2）或 DOM-R72 擋下：不可指派的角色（含移除與替換）、修改自己的角色、外部協作人員被指派不可外部使用的角色。屬安全事件，在獨立交易寫入，使請求失敗後仍保留；記錄被擋下的原因代碼 | `project_member` | 空值 | `project_id`、`user_id`（被指派的人）、`role_ids`（企圖指派的集合）、`reason`（錯誤碼） |
| `module_permission.grant_denied` | 授權被拒絕（`entity_id` 為被授權的人）：自授、授予超出委派範圍、被委派者授予 `all_project_progress.read`、對外部協作人員授予不可外部使用的代碼、組合套用整組被拒絕（DOM-R62、DOM-R63）。屬安全事件，在獨立交易寫入，不隨主交易回滾 | `module_permission` | 空值 | `user_id`（被授權的人）、企圖授予的 `permission_codes`、`bundle_id`（套用組合時）、`reason`（原因代碼） |

- `project_member.assignment_denied` 與 `module_permission.grant_denied` 是 ALG-R14「被拒絕不留紀錄」的例外：它們記錄的是被擋下的違規嘗試，不是一次變更；最後一位管理者規則（DOM-R70 的（3））被擋下時不寫。
- `project.created`、`project.updated` 與事件目錄其他事件一樣不得含密碼或 token（ALG-R08）。

<a id="inspection-planning-事件"></a>
## `inspection-planning` 事件

依 `inspection-planning` IP-R03、IP-R04、IP-R10 登記 Plan／Task 與專案查核項目變更事件，包括 ProjectZone 管理、Task 地點、刪除、取消、恢復，以及 KD-55 選擇與修改內容。每次成功變更依下表記錄；失敗或回滾不得留紀錄，且事件須與領域變更在同一交易內寫入。欄位依 ALG-R07～ALG-R10，刪除事件保存分區名稱與所屬 Project ID，避免依賴已刪除實體。

| 事件代碼 | 什麼時候寫 | `entity_type` | `before` | `after` |
|---|---|---|---|---|
| `project_zone.created` | 新增專案分區 | `project_zone` | 空值 | `project_id`、`name` |
| `project_zone.updated` | 修改分區名稱 | `project_zone` | 有變動的 `name` | 同左 |
| `project_zone.deleted` | 刪除未被 Task 引用的專案分區 | `project_zone` | `project_id`、`name` | 空值 |
| `inspection_task.deleted` | 硬刪除 DRAFT Task | `inspection_task` | `project_id`、`status`、`item_count` | 空值 |
| `inspection_task.cancelled` | 取消 PENDING／IN_PROGRESS Task | `inspection_task` | 變更前 `status` | `CANCELLED`、取消原因 |
| `inspection_task.restored` | 恢復已取消 Task | `inspection_task` | `CANCELLED` | 恢復後 `status` |
| `inspection_task.location_updated` | 修改 Task 地點 | `inspection_task` | 有變動的 `zone_id`、`location_text` | 同左 |
| `project_inspection_item.updated` | 修改專案查核項目並選擇是否重新查核 | `project_inspection_item` | 有變動的 `title`／`instruction`，以及重新查核選擇 | 修改後欄位與重新查核選擇 |

`inspection_task.location_updated` 的 `zone_id` 與 `location_text` 可為空值，以表達移除分區或補充文字。Task 刪除、取消、恢復、地點修改及專案查核項目修改事件，均須與對應資料變更在同一交易內寫入。`project_inspection_item.updated` 每次都記錄重新查核選擇；未改變的標準文字欄位不重複記錄。

<a id="authentication-事件"></a>
## `authentication` 事件

依 [AUT-Q6](../authentication/spec.md#aut-q6) 裁定登記；只記旗標與時間，不記密碼、雜湊或 token（ALG-R08、AUT-R41）。欄位名稱不含 `password`，ALG-AC06 的掃描照常適用。

| 事件代碼 | 什麼時候寫 | `entity_type` | 標記 | `before` | `after` |
|---|---|---|---|---|---|
| `user.password_set` | 設定或變更本地密碼：首次設定 `admin` 密碼（系統事件，ALG-R18）、`admin` 重設指令（ALG-R21）、Service 入口（含 Admin 新增使用者時設的臨時密碼）、本人變更密碼（AUT-R39） | `user` | 每次都寫；得為系統事件 | `is_temporary`（設定前的 `must_change_password`）；之前沒有密碼時為空值 | `is_temporary`（設定後的 `must_change_password`） |
| `user.locked` | 帳號因連續登入失敗被鎖（AUT-R28） | `user` | 系統事件 | 空值 | `locked_until`（解鎖時間，API-R09 格式） |

寫入時機由 `authentication` 驗收（AUT-AC49～AUT-AC51、AUT-AC62）。

<a id="帳號與公司連結事件"></a>
## 帳號與公司連結事件

依 DOM-R22（負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29））登記。入口由 `domain-model` 的使用者 Service 實作，寫入時機由本規格驗收（ALG-R14、ALG-AC14、ALG-AC15）。

| 事件代碼 | 什麼時候寫 | `entity_type` | `before` | `after` |
|---|---|---|---|---|
| `user.username_changed` | `User.username` 被修改（DOM-R45）；只有具 Admin 權限的人能改，改前改後相同不寫 | `user` | `username` | `username` |
| `user.company_changed` | `User.company_id` 改變：換公司、連結公司、解除連結（DOM-R47）；因此被清空的工號、部門、地點一併記下（ALG-R20） | `user` | `company_id`、`employee_no`、`department`、`location` | 同左 |
| `user.active_changed` | `User.is_active` 改變：停用或啟用帳號（DOM-R67）；改前改後相同不寫；停用公司時選擇一併停用的人員逐一寫（DOM-R33）；重新啟用時另記下 Admin 勾選的恢復與被移除的項目；自動停用（外部協作人員最後一個專案身分被移除或到期，DOM-R75）是系統事件（ALG-R15），到期只寫一次 | `user` | `is_active` | `is_active`；自動停用時另含 `reason`（`last_membership_removed`、`account_expired`，DOM-R75）；重新啟用時另含 `restored_permission_codes`、`removed_permission_codes`、`restored_delegated_modules`、`removed_delegated_modules`、`restored_project_ids`、`removed_project_ids`、`cleared_task_ids`（皆為排序後的陣列） |
| `user.external_flag_changed` | `User.is_external_collaborator` 改變：外部改內部（確認後放行）與內部改外部（通過資格檢查後）都寫（DOM-R73）；被擋下的內部改外部不寫 | `user` | `is_external_collaborator` | `is_external_collaborator` |

- 值用 `username` 存放的小寫（DOM-R45）；`company_id` 沒有公司時是空值；欄位沒有值時記空值，不省略。
- 本系統帳號與外部帳號都適用；外部身分同步覆蓋這些欄位時另依 ALG-R13 寫。

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
| `AuditLog` | UUID 主鍵、`created_at`、`created_by`（做法同 DBF-R11、DBF-R14）；不含 `updated_at`、`updated_by` | `event_type`、`entity_type`、`entity_id`、`before`、`after`；新增可空值且有索引的 `project_id`（ALG-R01、ALG-R24），既有資料不回填 | 已凍結；`project_id` 待 #412 migration |

關聯：`User` 1—多 `AuditLog`（`created_by`）。`entity_id` 只存 UUID，不是外鍵（ALG-R03）。

**門檻比對**（參照[部分凍結](../README.md#partial-freeze)規則 1）：逐條比對[開工門檻](../../intents/05-open-questions.md#gate)的 G-01～G-07、OQ-06，搜尋稽核、紀錄、歷程、刪除、保留、核可等字面。

| 實體 | 字面命中 | 結論 | 理由 |
|---|---|---|---|
| `AuditLog` | G-04「核可紀錄」；G-05「刪除與保留」 | 無關 | G-04 的核可紀錄是 Variant 那一側的欄位；日後若要把核可寫進稽核紀錄，只是在事件目錄多登記一種事件，不改資料表（ALG-R13）。Evidence 刪除與保留政策已由維護者依負責人授權決定（#388），見 [KD-62](../../intents/03-decisions-and-stack.md#kd-62)；這項政策與稽核紀錄的保留無關 |

## 介面

本規格的寫入部分不新增 API 端點；依 [ALG-Q2](#alg-q2) 裁定，查詢部分新增下列唯讀 API 與 Admin 頁面。對開發者的寫入介面如下；模組與函式名稱由計畫決定。

| 介面 | 內容 | 對應需求 |
|---|---|---|
| 程式介面 | 寫入稽核紀錄的單一入口：傳入事件代碼、被記錄的資料與 `before`、`after`；操作者與時間由入口填寫 | ALG-R05～ALG-R10 |
| 程式介面 | 事件目錄：事件代碼與各自宣告的欄位；其他規格在這裡登記自己的事件 | ALG-R07、ALG-R08、ALG-R11、ALG-R13 |

### 查詢 API

| 介面 | 契約 | 權限與錯誤 | 對應需求 |
|---|---|---|---|
| `GET /api/v1/audit-logs?project_id=&actor_id=&from=&to=&event_type=&cursor=&limit=` | 回 `{items:[AuditLog 欄位（含 project_id）],next_cursor}`；依 `(created_at,id)` 降冪；`project_id` 精確比對 `AuditLog.project_id`，不提供時含所有紀錄；`actor_id` 精確比對 `created_by`，`event_type` 完全相符；`from`、`to` 為 UTC ISO-8601，含起不含迄；多條件 AND 篩選。`cursor` 為不透明字串，`limit` 預設 50、範圍 1–100。合法但不存在的 `project_id` 回 `{items:[],next_cursor:null}` | Admin 專用；未登入 401、非 Admin 403；格式錯誤、無效 cursor／limit 或 `from` 大於 `to` 回 422；不存在專案為 200 空頁；錯誤 envelope 與代碼依 API-R05、API-R07 | ALG-R22～ALG-R24 |
| Admin 稽核查詢頁 | 呈現上述紀錄與專案、操作者、時間、事件類型篩選及 cursor 翻頁；只讀 | 僅 Admin 可進入 | ALG-R22、ALG-R23 |

以上查詢契約與 [admin-dashboard 介面](../admin-dashboard/spec.md#介面)一致；`project_id` 欄位及各篩選的比對依本規格 ALG-R24 與本表為準，該規格的 ADM-R07、ADM-R08 與 ADM-AC06、ADM-AC07、ADM-AC13 共同約束實作。`cursor` 不透明、`limit` 預設 50 且範圍 1–100、`from`／`to` 含起不含迄、`(created_at,id)` 降冪、`from` 大於 `to` 回 422，均為規格設計（非負責人裁定）；分頁鍵包含 UUID 依 API-R08，時間欄位輸出依 API-R09。錯誤代碼沿用 API-R07 的命名慣例，由共用 ErrorCode 列舉提供，不另在本規格指定代碼。

## 驗收條件

皆以 `make check` 內的自動化測試驗證，資料庫由 `alembic upgrade head` 建立；ALG-AC01～ALG-AC03、ALG-AC07 的測試放在 `backend/tests/db/`，CI 也對 PostgreSQL 執行（DBF-R10）。

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| ALG-AC01 | 對空資料庫執行 `alembic upgrade head` 之後，一筆作為操作者的 `User` | 用 SQLAlchemy inspector 檢查 `audit_logs`；新增一筆欄位齊全的紀錄；再分別嘗試新增 `created_by`、`event_type`、`entity_type`、`entity_id` 各為空值的紀錄，以及 `created_by` 指向不存在 UUID 的紀錄 | 有 ALG-R01 的所有欄位，主鍵是 UUID；`before`、`after`、`project_id` 可空值，其餘不可空值；`project_id` 有索引且沒有外鍵；`created_by` 外鍵指向 `users.id`；沒有 `updated_at`、`updated_by`；第一筆成功，其餘每一次都被資料庫拒絕，筆數不變 | ALG-R01、ALG-R02 |
| ALG-AC02 | 同 ALG-AC01 | 用 inspector 列出 `audit_logs` 的外鍵；新增一筆 `entity_id` 為任何資料表都不存在的 UUID 的紀錄 | 唯一的外鍵是 `created_by`；新增成功 | ALG-R03 |
| ALG-AC03 | 已有一筆紀錄 | 以 ORM 修改它的 `after` 後 flush；以 ORM 刪除它後 flush；以 `session.execute` 對 `AuditLog` 執行 ORM 批次 `update`、`delete`；以 `connection.execute` 執行 Core 的 `update(audit_logs)`、`delete(audit_logs)`；以 `text()` 執行 `UPDATE`、`DELETE FROM` 各一組寫法：不加引號、表名加雙引號（`"audit_logs"`）、加 schema 前綴（SQLite 用 `main.audit_logs`，PostgreSQL 用 `public.audit_logs`）、關鍵字與表名大小寫混用（`uPdAtE AUDIT_LOGS`）、前面有空白與換行；再以 `text()` 執行 `INSERT INTO audit_logs ...` 與 `SELECT ... FROM audit_logs`；（issue #233，兩輪審查後改採保守判斷）另以 `text()` 驗證：只要敘述中任何位置同時出現修改動作關鍵字（`UPDATE`、`DELETE`、`REPLACE`、`MERGE`——涵蓋 `REPLACE INTO`、`INSERT OR REPLACE`、`INSERT ... ON CONFLICT ... DO UPDATE`、`MERGE`，以及以上任一種包在 `WITH`／CTE 裡，不論修改在 CTE 本身或 CTE 之後、CTE 之間夾 PostgreSQL 的 `SEARCH`／`CYCLE` 子句）與 `audit_logs` 識別字（不分大小寫、可加引號與 schema 前綴），無論兩者實際語法位置關係、也無論關鍵字之間或關鍵字與表名之間是否夾 `/* */`、`--` 註解，都拒絕；`TRUNCATE` 敘述只要出現 `audit_logs` 識別字（不論在表清單第幾個、`*`／逗號前後是否有空白），或帶 `CASCADE`（不論對哪個資料表），也都拒絕；再驗證 `ON CONFLICT DO NOTHING`、SQLite 的 `INSERT OR IGNORE`、純新增（含值或 `RETURNING` 子句的字面文字恰好含關鍵字字樣者）、純讀取，以及不含 `audit_logs` 的其他敘述；`audit_logs` 識別字判斷改用 ASCII-only 不分大小寫（避免 Unicode 大小寫折疊，例如 `İ` 被誤判為 `i`）；再以 `text()` 驗證：PostgreSQL 的 `E'...'` 逸出字串（SQLite 不支援此語法，此處只驗證攔截器在送到資料庫前就先行判斷、與資料庫本身是否支援語法無關）內含反斜線跳脫引號（`E'\''`）的 upsert 仍被拒絕（正規化不會把跳脫的引號誤判成字串結尾而漏看後面的修改動作）；雙引號識別字內容經去除跳脫後完全等於 `audit_logs`（ASCII-only 不分大小寫）才視為 `audit_logs`，否則視為不相關的識別字（佔位處理，內容不再被當成一般 SQL 掃描），因此 `"audit_logs archive"`、`SELECT "UPDATE audit_logs" FROM other`、以及使用外觀相似字元（如 `İ`）的 `"audİt_logs"` 都不被誤判為 `audit_logs` 或修改動作關鍵字；反引號與 `[ ]` 識別字**不**做內容解析（PostgreSQL 的 `[` 是陣列／下標語法，不是識別字引號，嘗試比對配對括號曾經吞掉後面真正的修改動作，改採不吞內容的保守做法）：SQLite 的 `` `audit_logs` ``／`[audit_logs]` 精確引用因此仍會被偵測到，但 `` `audit_logs archive` ``／`[audit_logs archive]` 之類名稱裡剛好含 `audit_logs` 或關鍵字字樣的不同資料表會被誤擋（已知限制）；`ARRAY[[1, 2], [3, 4]]`、`ARRAY[(SELECT count(*) FROM audit_logs)]` 之後接 `UPDATE audit_logs` 的敘述驗證陣列語法不會吞掉後面的修改動作；PostgreSQL 的 `U&"..."` Unicode 逸出識別字（含 `UESCAPE`）不解碼跳脫序列，只要敘述同時出現修改動作與 `U&"` 識別字就一律保守視為可能指向 `audit_logs` 而拒絕（含與 `audit_logs` 無關的識別字，已知限制）；PostgreSQL 的 dollar-quoted 字串（`$$...$$`）與 `standard_conforming_strings = off` 的非 `E` 前綴逸出字串無法用字串比對可靠辨識，不在本條驗收範圍，改由 [#232](https://github.com/speko-tw/inspect-flow/issues/232) 的資料庫層保護涵蓋；再以 `text()` 驗證：不帶 `audit_log_ddl_allowed` 執行選項的一般連線上，`DROP TABLE audit_logs`（含 `IF EXISTS`、加引號、schema 前綴）、`ALTER TABLE audit_logs`（`RENAME`、`DROP COLUMN`、`ADD COLUMN` 一視同仁，不分是否具破壞性）、以及 `DROP TABLE` 其他資料表帶 `CASCADE`（比照 `TRUNCATE ... CASCADE` 的理由）都被拒絕；帶 `audit_log_ddl_allowed=True` 執行選項的連線上，前述 DDL 都成功執行，但 `UPDATE`／`DELETE`／`TRUNCATE audit_logs` 仍被拒絕（此選項只豁免 DDL 檢查）；以 `alembic upgrade`／`downgrade` 執行 T1 的 migration（往返 upgrade→downgrade→upgrade）在 `backend/alembic/env.py` 設定該執行選項後照常成功 | ORM 的四次、Core 的兩次與 `text()` 的十次修改、刪除（共 16 次）都被拒絕；重新讀取時，筆數與內容都和操作前相同；`text()` 的新增與讀取、ORM 新增紀錄、讀取其他資料表都成功，不被誤擋；issue #233 保守規則涵蓋的每種寫法都同樣被拒絕，資料不變；`ON CONFLICT DO NOTHING`、`INSERT OR IGNORE`、字面文字恰好含關鍵字字樣的純新增、純讀取都成功執行，不被誤擋；帶跳脫引號的 `E'...'` upsert 仍被拒絕；雙引號識別字內容不等於 `audit_logs` 的敘述都成功執行、內容等於的則被拒絕；陣列語法之後的 `UPDATE audit_logs` 都被拒絕；`U&"..."` 識別字搭配修改動作的敘述都被拒絕；一般連線上的 `DROP TABLE`／`ALTER TABLE audit_logs` 與帶 `CASCADE` 的 `DROP TABLE` 都被拒絕，資料與 schema 不變；帶執行選項的連線可以成功執行這些 DDL，但仍無法 `UPDATE`／`DELETE`／`TRUNCATE`；一律拒絕修改動作與 `TRUNCATE`、完全不看執行選項（因此帶執行選項的連線上，`UPDATE`／`DELETE`／`INSERT ... ON CONFLICT ... DO UPDATE` 即使敘述裡別處出現 `DROP`／`ALTER` 字樣，例如 `AS [DROP]` 別名，也被拒絕；`Connection` 與 `Session.connection(execution_options=...)` 兩種取得連線的方式都驗證）；關鍵字與引號識別字、字面值之間不夾空白的寫法（`DELETE FROM"audit_logs"`、`DROP TABLE"audit_logs"`、`main."audit_logs"`、`"x"."audit_logs"`）都被拒絕；migration 往返正常完成；保守規則已知會誤擋部分同時修改別的資料表又讀取 `audit_logs` 的敘述、帶 `CASCADE` 卻與 `audit_logs` 無關的 `TRUNCATE`／`DROP`、名稱含 `audit_logs`／關鍵字字樣的反引號或 `[ ]` 識別字、與 `audit_logs` 無關的 `U&"..."` 識別字，以及一般連線上對 `audit_logs` 做的任何 `ALTER TABLE`（即使只是新增欄位），記在 `app/models/audit_log.py` 模組說明的「已知限制」 | ALG-R04 |
| ALG-AC04 | 初始化後的資料庫（有內建 `admin`）與另一位已登入的 `User` U；以可控時間固定現在時刻 | 不在 HTTP 請求中寫一筆紀錄；在已綁定 U 的請求範圍內寫一筆；在沒有登入者的請求範圍內寫一筆；呼叫端試圖自行指定操作者或時間 | 第一筆的 `created_by` 是 `admin`，第二筆是 U，兩筆的 `created_at` 都等於固定的時刻；第三次被拒絕、不寫入；入口不接受操作者與時間參數 | ALG-R05 |
| ALG-AC05 | 一個交易單位（DBF-R09） | 在同一個交易裡修改一筆 `Company`、寫一筆紀錄，然後拋出例外；另一個交易裡修改同一筆 `Company` 後，用未登記的事件代碼寫紀錄 | 兩次都回滾：`Company` 不變，`audit_logs` 沒有新紀錄 | ALG-R06 |
| ALG-AC06 | 事件目錄已登記 `role.updated` | 分別寫入：未登記的代碼 `role.renamed`；`after` 多了未宣告欄位 `password_hash`；`before`、`after` 完全相同的 `role.updated`；另掃描事件目錄所有宣告欄位 | 三次都被拒絕，筆數不變；沒有任何事件宣告含 `password`、`secret`、`token`、`session` 字樣的欄位 | ALG-R07、ALG-R08、ALG-R09 |
| ALG-AC07 | 初始化後的資料庫 | 依[第一批事件](#第一批事件)各寫一筆（`role.updated` 只改名；`project_member.roles_changed` 為新加入；`project_member.removed` 的 `role_ids` 為空陣列），集合欄位故意以未排序的順序、UUID 以 `uuid.UUID` 物件傳入，再從資料庫讀回 | 六種代碼都寫入成功；讀回的 `event_type`、`entity_type`、`entity_id` 等於輸入；`role.created` 的 `before`、`role.deleted` 與 `project_member.removed` 的 `after` 為空值；`role.updated` 只有 `name`；`project_member.roles_changed` 前後都有 `project_id`、`user_id`，`before.role_ids` 為空陣列；UUID 為字串、集合為排序後的陣列 | ALG-R09、ALG-R10、ALG-R11 |
| ALG-AC08 | 對空資料庫執行 `alembic upgrade head` 之後 | 執行初始化指令（DOM-AC43 的成功案例）；再重跑一次（`admin` 尚未設定密碼，DOM-AC44 的甲案例） | 兩次都成功，`audit_logs` 都是 0 筆 | ALG-R12 |
| ALG-AC09 | 事件目錄；測試結束後還原 | 在測試中登記一個測試用事件（`entity_type = user`，三個欄位），寫入一筆再讀回；比對寫入前後的 `alembic heads` 與 `audit_logs` 欄位 | 寫入與讀回成功；migration head 與欄位都沒有變 | ALG-R13 |
| ALG-AC10 | 事件目錄 | 逐一檢查所有已登記的事件代碼 | 每個代碼都符合 ALG-R07 的格式，且「資料」段等於該事件的 `entity_type` | ALG-R07 |
| ALG-AC11 | 初始化後的資料庫，`domain-model` T7 的入口可用；兩位啟用中的 Admin；角色 R1 由兩筆成員持有；專案 P | 透過 Service 層依序：新增角色 R2；R2 改名；把 U 加入 P 並指派 R2；替 U 再加 R1；把 V 加入 P 但不指派角色；刪除 R1；把 V 移出 P；取消一位 Admin 的 `is_admin`；嘗試取消最後一位 Admin 的 `is_admin`；停用一位非 Admin 的帳號 | 每一次成功的變更各恰有一筆紀錄，事件代碼依序為 `role.created`、`role.updated`、`project_member.roles_changed`、`project_member.roles_changed`、`role.deleted`、`project_member.removed`、`user.admin_changed`、`user.active_changed`，內容依第一批事件與帳號與公司連結事件；`role.deleted` 的 `project_member_ids` 恰為刪除當下持有 R1 的三筆成員（前置的兩筆與 U），且沒有另寫 `roles_changed`；加入 V 與被拒絕的取消都沒有紀錄；`created_by` 都是目前操作者 | ALG-R14 |
| ALG-AC12 | 初始化後的資料庫（有內建 `admin`）；事件目錄已登記 `authentication` 事件 | 在沒有登入者的請求範圍內寫一筆 `user.locked`、一筆 `user.password_set`；在已綁定 U 的請求範圍內寫一筆 `user.locked`、兩筆 `before`、`after` 相同的 `user.password_set`；另在沒有登入者的請求範圍內寫一筆 `role.created`（`user.password_set` 未宣告為系統事件） | 兩筆 `user.locked` 都寫入成功，`created_by` 都是內建 `admin`（含已綁定 U 的那筆）；沒有登入者的 `user.password_set` 與 `role.created` 都被拒絕；U 的兩筆都寫入成功，`created_by` 是 U | ALG-R15、ALG-R16、ALG-R17 |
| ALG-AC13 | 初始化後的資料庫（有內建 `admin`，尚未設定密碼）；事件目錄已登記 `user.password_set`；以可控時間固定現在時刻 | 在沒有登入者的請求範圍內，以首次設定的公開路由的方式（宣告為系統事件）寫一筆 `user.password_set`；在同樣沒有登入者的請求範圍內，不宣告為系統事件再寫一筆；在已綁定 U 的請求範圍內，不宣告再寫一筆 | 第一筆寫入成功，`created_by` 是內建 `admin`，`before` 為空值、`after.is_temporary` 為 `false`；第二筆被拒絕，筆數不變；第三筆寫入成功，`created_by` 是 U；宣告為系統事件的呼叫對其他事件（例如 `role.created`）仍被拒絕 | ALG-R18 |
| ALG-AC14 | 初始化後的資料庫；具 Admin 權限的操作者 A、本系統帳號 U（`username = anna.deng`）；`domain-model` 的使用者 Service 可用 | 以 A 把 U 的 `username` 改為 `Anna.D`；再改為 `anna.d`（與上一次存放的值相同）；以 A 嘗試改成已被使用的名稱；掃描事件目錄中這兩種事件的宣告欄位 | 第一次恰有一筆 `user.username_changed`，`entity_id` 是 U，`created_by` 是 A，`before.username` 為 `anna.deng`、`after.username` 為 `anna.d`（小寫）；第二次、被拒絕的那次都沒有紀錄；事件代碼符合 ALG-R07 格式，宣告欄位沒有 `password`、`secret`、`token`、`session` 字樣 | ALG-R14、ALG-R19 |
| ALG-AC15 | 公司 A、B；具 Admin 權限的操作者 A0；本系統帳號 U 屬於公司 A，`employee_no`、`department`、`location` 都有值；沒有公司的帳號 V | 以 A0 依序：把 U 的 `company_id` 改為 B；把 U 的 `department` 單獨改成新值（`company_id` 不變）；為 U 重新填入三個欄位後把 `company_id` 改為空值；把 V 的 `company_id` 設為 A；以會使工號重複的值把 U 改到 A（被資料庫拒絕） | 第一次恰有一筆 `user.company_changed`，`before` 是 A 與三個欄位的原值，`after` 是 B 與三個空值；第二次沒有紀錄；第三次一筆，`after.company_id` 為空值、三欄為空值；第四次一筆，`before.company_id` 為空值；被拒絕的那次沒有紀錄；`created_by` 都是 A0 | ALG-R14、ALG-R19、ALG-R20 |
| ALG-AC16 | 初始化後的資料庫；`admin` 已設定過一次密碼 | 執行 `admin` 重設指令一次（兩次輸入相同的有效密碼）；再執行一次兩次輸入不同的指令 | 第一次恰有一筆 `user.password_set`，`entity_id` 是內建 `admin`，`created_by` 是內建 `admin`，`after.is_temporary` 為 `false`；事件目錄沒有為重設指令新增的事件代碼；第二次沒有紀錄 | ALG-R21 |
| ALG-AC17 | 已有稽核紀錄；Admin、非 Admin 及未登入者 | 分別開啟稽核查詢頁並呼叫查詢 API，再比對查詢前後的紀錄 | Admin 可唯讀查詢；未登入回 401、非 Admin 回 403，均不回稽核內容；查詢不新增、修改或刪除紀錄 | ALG-R22；ADM-AC06 |
| ALG-AC18 | 多筆跨專案、不同操作者與事件類型的紀錄，含相同事件時間；混入 `role.*`／`user.*` 無專案事件與 migration 前既有的歷史紀錄；另有不存在的合法專案 UUID | 組合專案、操作者、時間、事件類型篩選並跨 cursor 翻頁；以不存在的 `project_id` 查詢；不帶專案篩選再查；送無效篩選、cursor／limit 及 `from` 大於 `to` | 新的有專案事件寫入正確 `project_id`，無專案事件及未回填的歷史紀錄為空值；帶專案篩選只回欄位相符的紀錄，排除無專案與歷史紀錄，不帶時均可查到；`actor_id` 精確比對 `created_by`、`event_type` 完全相符；結果符合 AND 篩選、`(created_at,id)` 降冪且跨頁無重複遺漏；不存在的專案回 200、`items: []`、`next_cursor: null`；無效格式與反向時間範圍回 422 且符合 API-R05 錯誤 envelope | ALG-R01、ALG-R23、ALG-R24；ADM-AC07、ADM-AC13 |
| ALG-AC19 | 非 Admin 的使用者 U、已停用的 V、被停用公司 C 一併選中的兩位人員；U 有模組權限、專案成員身分與未完成任務 | 停用 U；對已啟用的 U 再次「啟用」；停用後重新啟用 U 並只勾選部分恢復項目；嘗試停用最後一位 Admin；停用公司 C 並一併停用兩位人員 | 停用與啟用各恰有一筆 `user.active_changed`（`before`、`after` 為 `is_active` 的前後值），重新啟用的事件另含恢復與移除的項目；重複啟用與被拒絕的停用不寫；一併停用的兩位人員各一筆 | ALG-R25 |
| ALG-AC20 | Admin A；被委派 `template` 的 D；使用者 W；事件目錄已登記模組權限事件 | A 為 W 授予 `template.use` 與重複授予一次；A 授予 W `project.create`（自動蘊含 `project.use`）；D 收回後重複收回；A 指派 D 的委派後重複指派；A 收回委派；D 授予時看紀錄的 `created_by`；D 嘗試授予專案模組代碼與替自己授權（被拒絕） | 每次成功的授予、收回、委派指派與收回各恰有一筆對應事件，授權事件含 `source`；`project.create` 與蘊含的 `project.use` 各一筆；重複與被拒絕的操作不留紀錄；D 授予的紀錄 `created_by` 是 D；集合欄位為排序後的陣列 | ALG-R26 |
| ALG-AC21 | Admin A；組合 B1（含三個代碼）；被委派 `template` 的 D；使用者 U（已有其中一個代碼）、U2（都沒有）、U3 | A 新增 B1、改名並修改內容、套用到 U、套用到 U2、再套用到已全數具備的 U2、D 套用含其他模組代碼的 B1 到 U3、刪除 B1 | 新增、修改、刪除各一筆 `permission_bundle.*`；套用到 U 只寫一筆 `permission_bundle.applied`，`permission_codes` 為 U 實際新增的兩個；套用到 U2 一筆含三個；再次套用不寫；D 的套用整組被拒絕、不寫；沒有任何逐項 `module_permission.granted` | ALG-R26 |
| ALG-AC22 | 有 `system_role_assignment` 資料列與既有專案成員的資料庫（過渡期資料），以及空資料庫 | 執行初始化指令與 `template_admin` 轉換與回填 migration | 轉換前後每個人的有效權限一致，回填的權限 `source` 為 `backfill`；預建角色與組合建立；`audit_logs` 筆數不變；過渡期的 `system_role_assignment.*` 事件在 Admin 操作舊路由時仍照常寫入 | ALG-R27 |
| ALG-AC23 | 非管理者 U 具 `project.create`；Admin A；專案 P | U 新增專案；A 新增專案；持 `project.update` 者修改 P 的名稱與預計日期，再以相同內容修改一次；新增時讓成員寫入失敗（故障注入） | `project.created` 各恰有一筆且與成員加入事件同一交易；`project.updated` 只記有變動的欄位，無變動不寫；故障注入時專案、成員與事件全數回滾 | ALG-R28 |
| ALG-AC24 | 非管理者 M 持 `project_member.manage`；可指派角色與不可指派的角色；外部協作人員 Y；M 是專案最後一位管理者 | M 指派不可指派的角色；M 修改自己的角色；M 把 Y 指派為不是外部可用的角色；M 移除最後一位管理者；M 做一次合法指派 | 前三種違規（含移除不可指派角色的嘗試）各寫一筆 `project_member.assignment_denied`（含原因代碼，請求回 422 後仍保留）；最後一位管理者規則被擋下不寫；合法指派寫 `project_member.roles_changed` 而不寫 denied | ALG-R28 |
| ALG-AC25 | 外部協作人員 L（單位為公司 A）、沒有單位的外部協作人員 L2、內部人員 X | 三人各寫一筆稽核紀錄；之後修改 L 的姓名、公司與標記；列出紀錄；既有紀錄經 migration | `actor_snapshot` 依 ALG-R29 的格式保存（L 為「姓名．外部協作人員．公司 A」、L2 為「外部協作人員（未填單位）」、X 為「姓名．單位」）；人員資料變更後舊快照不變；欄位不可空值，既有紀錄已回填 | ALG-R29 |
| ALG-AC26 | 非管理者 M；被委派 `template` 的 D；外部協作人員 L | D 為自己授權；D 套用含其他模組代碼的組合；D 對 L 授予 `project.create`；M 把 L 指派為不是外部可用的角色；上述每個操作的主交易都失敗或回滾 | 每個被拒絕的授權寫一筆 `module_permission.grant_denied`、被拒絕的指派寫一筆 `project_member.assignment_denied`，且在主交易回滾後仍保留 | ALG-R28 |
| ALG-AC27 | 外部協作人員 L（持合格資料）與內部人員 X（合格轉外部）；角色 R | 把 L 由外部改內部；把 X 由內部改外部；修改 R 的 `is_external_allowed`；重新啟用時未勾選的模組權限、模組委派與成員身分 | 兩個方向的標記變更各寫一筆 `user.external_flag_changed`；`role.updated` 記下 `is_external_allowed` 的前後值；未勾選而被收回與移除的項目各寫 `module_permission.revoked`、`module_delegation.revoked`、`project_member.removed` | ALG-R25、ALG-R14 |
| ALG-AC28 | 專案 P；具專案權限 `project.update` 的成員 M（程式改造完成後的行為） | M 把 `company_role` 由 `contractor` 改為 `supervisor` 並帶原因；再只改專案名稱；再以相同的 `company_role` 重送 | 改角色一筆 `project.updated`：前後值含 `company_role`，後值另含 `company_role_change_reason`；只改名稱的 `project.updated` 不含原因欄；沒有變動不寫 | ALG-R28、DOM-R76 |

## 待釐清

以下未裁定議題沒有 intents 依據，本規格不自行拍板；需要團隊裁定時另開 issue 移到 `05-open-questions.md`。ALG-Q1、Q3、Q4 不影響資料表；ALG-Q5 若選 B，要另加一支 migration 新增可空值的來源欄位，本規格已凍結的欄位不變。ALG-Q2、Q6 已裁定；都不擋凍結。

<a id="alg-q1"></a>
- **ALG-Q1：保存期限**。選項：（A）永久保存，不提供清除；（B）保存固定年限後清除或封存；（C）可設定。業界：OWASP Logging Cheat Sheet 要求依法規與內部政策訂保存期限；ISO 27001、SOC 2 的稽核常見要求至少保存一年。**建議 A**：第一批事件只有權限變更，量很小，也和「不能刪除」一致；真要清除時另開規格。
<a id="alg-q2"></a>
- **ALG-Q2：查詢介面（已裁定）**。負責人於 2026-10-04 [裁定選 C](https://github.com/speko-tw/inspect-flow/issues/107#issuecomment-5977843511)：0.5.x 管理後台提供 Admin 專用、唯讀的稽核紀錄查詢頁，可依專案、操作者、時間與事件類型篩選；查詢 API 與 cursor 契約見 [ALG-R22～ALG-R23](#查詢)、[查詢 API](#查詢-api)，由 [admin-dashboard](../admin-dashboard/spec.md#介面) 的 T5b（[#412](https://github.com/speko-tw/inspect-flow/issues/412)）實作。
<a id="alg-q3"></a>
- **ALG-Q3：要不要記錄讀取**。選項：（A）不記錄；（B）只記錄敏感資料的讀取或匯出（例如報告匯出）。業界：OWASP 建議視需要記錄敏感資料的存取，但讀取量大，一般不全記。**建議 A**：intents 沒有敏感讀取的要求；日後報告匯出若要記錄，再登記事件（ALG-R13）。
<a id="alg-q4"></a>
- **ALG-Q4：`User.is_active`（停用、啟用帳號）要不要記錄**（已裁定，負責人裁定（[#538](https://github.com/speko-tw/inspect-flow/issues/538)，2026-10-09）第 5 項：停用和啟用都留下稽核紀錄）。選 A：記錄，新增 `user.active_changed`，由 DOM-R67 的入口寫入；事件做法見 ALG-R25。
<a id="alg-q5"></a>
- **ALG-Q5：要不要記錄請求來源（IP、User-Agent、Session）**。選項：（A）不記錄；（B）新增可空值的來源欄位。業界：OWASP 建議記錄「何時、何處、誰、做什麼」，「何處」通常包含 IP。**建議 A**：第一階段是單機、內網，操作者已記在 `created_by`；之後要加，只需一支新增可空值欄位的 migration。

<a id="alg-q6"></a>
- **ALG-Q6：本次變更（[#259](https://github.com/speko-tw/inspect-flow/issues/259)）的判讀**（已裁定，負責人確認（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29））。負責人裁定了「哪些事要寫稽核」，事件的做法是本規格的判讀，已由負責人確認：（1）`user.password_set` 標為「得為系統事件」由呼叫端宣告，而不是整個事件固定為系統事件，理由是它另有需要登入者的來源（本人變更、Admin 設臨時密碼）；（2）`user.company_changed` 只在 `company_id` 改變時寫，並一律記錄四個欄位；（3）事件代碼取名 `user.username_changed`、`user.company_changed`，沿用 `user.admin_changed` 的形式；（4）首次設定與 `admin` 重設指令共用 `user.password_set`，紀錄本身分不出兩者，只看得出操作者是系統事件的 `admin`，需要區分時再加欄位。都不影響資料表。

## 變更紀錄

- 範圍變更（負責人指示，#411）：依 ALG-Q2 選項 C 納入 Admin 唯讀稽核查詢頁、API、需求與驗收；`project_id` 可空欄位、索引及篩選語意為規格設計（非負責人裁定） — [#107 裁定](https://github.com/speko-tw/inspect-flow/issues/107#issuecomment-5977843511)、[#411](https://github.com/speko-tw/inspect-flow/issues/411)
- 同步 G-05 已決定狀態與 KD-62 引用；不影響本規格或稽核紀錄保留範圍 — [#404](https://github.com/speko-tw/inspect-flow/issues/404)
- 對齊 #375 路線圖，將 Admin Dashboard 的 milestone 引用更新為 0.5.x — [#375](https://github.com/speko-tw/inspect-flow/issues/375)

凍結後的「範圍變更」以上才記；一行寫改了什麼與 issue 連結。

- 範圍變更（負責人指示，#369）：登記 `ProjectZone` 新增、改名與刪除事件，依 IP-R10 同一交易寫入 — [#73 裁定](https://github.com/speko-tw/inspect-flow/issues/73#issuecomment-5976192382)、[#369](https://github.com/speko-tw/inspect-flow/issues/369)

- 依 AUT-Q6 裁定，新增 ALG-R15～ALG-R17（系統事件、每次都寫、`authentication` 事件）與 ALG-AC12，登記 `user.password_set`、`user.locked`，ALG-R05、ALG-R09 補上對應的例外 — [#148](https://github.com/speko-tw/inspect-flow/issues/148)
- 負責人裁定（#261，2026-09-29）：初始化不再預建三個範本角色；ALG-R12 僅描述內建 `admin` 與首次登入碼，初始化仍不寫稽核紀錄 — [#261](https://github.com/speko-tw/inspect-flow/issues/261)
- 範圍變更（admin 與帳號重新設計）：改寫 ALG-R05、ALG-R12、ALG-R14、ALG-AC08，新增 ALG-R18～ALG-R21（首次設定為系統事件、帳號名稱與公司連結事件、`admin` 重設沿用 `user.password_set`）與 ALG-AC13～ALG-AC16、ALG-Q6，「`User` 基本欄位修改不寫稽核」的非目標部分已被取代 — [#259](https://github.com/speko-tw/inspect-flow/issues/259)
- 登記 `template-system` 的固定範本管理員角色指派／收回事件及其稽核欄位 — [#325](https://github.com/speko-tw/inspect-flow/issues/325)
- 澄清存成範本事件與範本建立同交易，並列明其來源與目標識別欄位 — [PR #370 第 1 輪審查](https://github.com/speko-tw/inspect-flow/pull/370#pullrequestreview-5404213410)
- 意圖變更跟進（負責人裁定，[#538](https://github.com/speko-tw/inspect-flow/issues/538)，意圖變更見 KD-69，裁定留言：[問題 1～5](https://github.com/speko-tw/inspect-flow/issues/538#issuecomment-6081228914)、[補充裁定 6～9](https://github.com/speko-tw/inspect-flow/issues/538#issuecomment-6081327833)）：新增停用與啟用事件 `user.active_changed`（ALG-Q4 已裁定、ALG-R25）、模組權限事件（授予與收回、委派、權限組合、建立者角色，ALG-R26）與過渡期轉換不寫稽核（ALG-R27）；`system_role_assignment.*` 事件僅過渡期使用；ALG-R14、ALG-AC11 同步；新增 ALG-AC19～ALG-AC22；權限組合與建立者角色設定的事件為規格設計（非負責人裁定） — [#538](https://github.com/speko-tw/inspect-flow/issues/538)
- 意圖變更跟進（負責人裁定，[#538 第 10～24 點](https://github.com/speko-tw/inspect-flow/issues/538)）：授權事件加 `source`、`role.updated` 加 `is_assignable`、`user.active_changed` 加重新啟用的恢復與移除項目；新增「專案事件」（`project.created`、`project.updated`、`project_member.assignment_denied`）與 ALG-R28、ALG-AC23、ALG-AC24；ALG-R14 註明唯一例外；ALG-R25～R27 與 ALG-AC19～AC22 同步；`creator_role.changed` 不再有角色被刪除而回到空值；專案事件與 `source` 標示為規格設計（非負責人裁定） — [#538](https://github.com/speko-tw/inspect-flow/issues/538)
- 意圖變更跟進（負責人裁定，[#538 第 25 點](https://github.com/speko-tw/inspect-flow/issues/538)）：新增 `module_permission.grant_denied`、`user.external_flag_changed` 事件，`user.active_changed` 加自動停用的原因；新增 ALG-R29（操作者身分快照 `actor_snapshot`）、ALG-AC25～ALG-AC27；ALG-R28 擴及授權拒絕；`project_member.assignment_denied` 涵蓋移除與替換及外部可用檢查；欄位名稱與快照組成為規格設計（非負責人裁定） — [#538](https://github.com/speko-tw/inspect-flow/issues/538)
- 規格澄清（規格設計，非負責人裁定，[#553](https://github.com/speko-tw/inspect-flow/issues/553)，PR #544 延後項）：`role.updated` 觸發條件補 `is_external_allowed`；第 25 點變更紀錄補 ALG-AC27 — [#553](https://github.com/speko-tw/inspect-flow/issues/553)
- 規格澄清（規格設計，非負責人裁定，[#553](https://github.com/speko-tw/inspect-flow/issues/553)，PR #563 第 1 輪審查）：`role.updated` 引用的 DOM-R73 改為 DOM-R72、DOM-R73 — [#553](https://github.com/speko-tw/inspect-flow/issues/553)
- 範圍變更（意圖變更跟進，負責人裁定，走標準路徑、未使用負責人直接指示的例外，[#559](https://github.com/speko-tw/inspect-flow/issues/559)）：`project.created` 加 `company_role`，`project.updated` 沿用於改本公司角色並於後值加 `company_role_change_reason`；新增 ALG-AC28。裁定留言：[六題裁定](https://github.com/speko-tw/inspect-flow/issues/559#issuecomment-6093033801)、[專家審視後修正](https://github.com/speko-tw/inspect-flow/issues/559#issuecomment-6093171971)、[最後一題](https://github.com/speko-tw/inspect-flow/issues/559#issuecomment-6093217072)；欄位名為規格設計（非負責人裁定） — [#559](https://github.com/speko-tw/inspect-flow/issues/559)
