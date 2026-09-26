# 領域模型（domain-model）

**代碼**：`DOM`　**Phase**：P1、P3、P4、P6、P9　**狀態**：部分凍結
**前置規格**：`database-foundation`（UUID 主鍵、業務編號、建立與修改紀錄等共通結構，見 DBF-R11～DBF-R14）、`api-conventions`（UUID 字串 ID、UTC 時間格式）
**引用意圖**：[PR-01](../../intents/02-principles.md#pr-01)、[PR-08](../../intents/02-principles.md#pr-08)、[PR-18](../../intents/02-principles.md#pr-18)、[KD-07](../../intents/03-decisions-and-stack.md#kd-07)、[KD-16](../../intents/03-decisions-and-stack.md#kd-16)～[KD-29](../../intents/03-decisions-and-stack.md#kd-29)、[OQ-02](../../intents/05-open-questions.md#oq-02)（已裁定）、[OQ-08](../../intents/05-open-questions.md#oq-08)（已裁定）、[OQ-22](../../intents/05-open-questions.md#oq-22)
**被擋議題**：凍結範圍無；`Project` 業務欄位待 [OQ-01](../../intents/05-open-questions.md#oq-01)；其餘實體受 [G-01](../../intents/05-open-questions.md#g-01)、[G-02](../../intents/05-open-questions.md#g-02)、[OQ-06](../../intents/05-open-questions.md#oq-06) 等[開工門檻](../../intents/05-open-questions.md#gate)擋（依 [OQ-22](../../intents/05-open-questions.md#oq-22)）
**凍結範圍**：`User`（業務欄位、`is_admin`、`is_system`、外部身分預留欄位）、`Company`、`Role`、`ProjectMember`，以及初始化指令與認證前的操作者（DOM-R01～DOM-R21、DOM-R23～DOM-R29、DOM-AC01～DOM-AC20）。DOM-R22（稽核紀錄）待 [DOM-Q6](#dom-q6) 維持草稿；DOM-R40 以後為草稿

## 目的

人員、公司、角色與專案成員有一份確定的資料模型：人員有完整的業務欄位與系統欄位，並預留外部身分來源的欄位；公司分成本公司體系與客戶；系統管理者是人員身上的開關，專案角色可以自訂、掛在專案成員上、權限加總。初始化指令建立第一批 Admin 帳號，登入功能完成前的資料一律以內建 `admin` 為操作者。後續的 `authentication`、`admin-dashboard` 與資料表實作都依這份定義進行（依據：負責人決定，#63，2026-09-26；取代架構基準 §12.1 的最小欄位假設與 §17 的範例矩陣）。

## 範圍

**包含**：

- 凍結：
  - `User` 的業務欄位（基本欄位、聯絡與補充欄位）、系統欄位 `is_admin`、`is_system`，以及外部身分來源的預留欄位。
  - `Company`、`Role`、`ProjectMember` 的資料模型。
  - 這些實體的資料規則：可修改性、內建帳號保護、最後一個 Admin、公司階層、停用公司的限制與影響範圍、角色的權限內容與刪除、有效權限的計算、角色影響範圍的計算。
  - 建立初始 Admin 帳號、本公司與三個範本角色的初始化指令。
  - 登入功能完成前，Service 層取得「目前操作者」的規則。
- 草稿（本次不凍結，不拆任務）：
  - `Project` 的業務欄位：待 [OQ-01](../../intents/05-open-questions.md#oq-01)，見 [DOM-R40](#draft-project)。
  - `Inspection Template`、`Template Version`、`Template Item`、`Evidence Requirement`、`Inspection Plan`、`Inspection Task`、`Task Requirement Snapshot`、`Evidence`、`Evidence Variant`、`Result`、`Report` 等其餘實體：受開工門檻擋，尚未撰寫，見[其他實體](#draft-others)。

**不包含**（注明移到哪份規格，或屬於哪一條非目標）：

- UUID 主鍵、業務編號 `employee_no` 的唯一性、`created_at`／`updated_at`／`created_by`／`updated_by` 的欄位與約束：由 `database-foundation` 定義（DBF-R11～DBF-R14），本規格只引用。
- 密碼與其雜湊（Argon2id）、登入流程、伺服器端 Session 與 HttpOnly Cookie 的實作、「目前使用者」的辨識、API 權限檢查的執行方式（含後端預設拒絕、Admin 可存取所有專案、誰可以建立帳號與指派角色）：移至 `authentication`（登入機制與密碼雜湊已裁定，見 [OQ-13](../../intents/05-open-questions.md#oq-13)（已裁定）、[KD-30](../../intents/03-decisions-and-stack.md#kd-30)、[KD-31](../../intents/03-decisions-and-stack.md#kd-31)）。本規格只定義資料與規則，`authentication` 依此執行。
- 外部身分來源的串接與同步流程（比對、轉換、覆蓋基本欄位）：移至 `external-identity-sync`；本規格只預留欄位與約束（DOM-R08）。
- 修改前顯示影響範圍的畫面與確認流程（[PR-18](../../intents/02-principles.md#pr-18)）、替客戶公司成員指派可修改角色時的確認提示（[KD-28](../../intents/03-decisions-and-stack.md#kd-28)）：屬 UI／API 行為，由提供這些操作的功能規格（例如 `admin-dashboard`）負責；本規格只提供計算影響範圍所需的資料（DOM-R23）。
- 稽核紀錄的資料模型：[KD-20](../../intents/03-decisions-and-stack.md#kd-20)、[KD-29](../../intents/03-decisions-and-stack.md#kd-29) 要求寫稽核紀錄，但哪份規格定義稽核紀錄尚未決定，見 [DOM-Q6](#dom-q6)。
- 人員、公司、角色、專案成員的 API 端點與管理畫面：由之後的功能規格負責（例如 `authentication`、`admin-dashboard`）。
- 職稱、承包商歸屬：不列入人員欄位（[OQ-02](../../intents/05-open-questions.md#oq-02) 裁定，#63）。

## 使用情境

- 部署人員第一次安裝時執行初始化指令，依提示輸入本公司的代碼與名稱，以及內建 `admin` 與負責人個人帳號的基本欄位；指令建立本公司、兩個 Admin 帳號與三個範本角色。這些值不會出現在 repo 裡。
- 登入功能完成前，工程師在 Service 層新增一筆 `Company`，`created_by`、`updated_by` 自動填內建 `admin`。
- Admin 把一位客戶公司的人員加入專案，並替他同時指派「現場查核」與「唯讀」兩個角色；他在這個專案的權限是兩個角色權限的加總。
- Admin 修改「現場查核」角色的權限內容前，系統先算出有多少人、多少筆專案成員持有這個角色，供畫面顯示影響範圍；修改後，所有持有者的權限立即改變。
- 一位外部來源匯入的人員想修改自己的手機號碼，可以改；Admin 想修改他的部門，會被拒絕，因為基本欄位以外部來源為準。
- Admin 想停用內建 `admin`，或拿掉系統中唯一的 Admin，會被拒絕。
- Admin 停用一家已結束合作的客戶公司，畫面先顯示「這家公司還有 3 位啟用中的人員」，並讓他勾選要一併停用哪些人；沒被勾選的人照常登入、照常參與專案，但之後新建人員或修改人員所屬公司時，已經不能選這家公司。

## 需求

用「必須／應／得」，每條附依據；來源只是建議的，不得寫成「必須」。欄位名稱是本規格建議的識別字（強度為「應」）；型別與長度上限見 [DOM-Q1](#dom-q1)。「驗收」欄寫明在本規格驗收，或由哪份規格驗收。

### `User`（凍結）

| 編號 | 需求 | 強度 | 依據 | 驗收 |
|---|---|---|---|---|
| DOM-R01 | `User` **必須**具備基本欄位：公司 `company_id`（外鍵指向 `Company`）、部門 `department`、地點 `location`、工號 `employee_no`（定義與唯一性見 DBF-R12、DBF-R13）、英文姓名 `name_en`、中文姓名 `name_zh`、email `email`、啟用狀態 `is_active`。以上欄位**不得**為空值，由資料庫約束保證；除 `is_active` 外，建立時都**必須**由呼叫端提供；`is_active` 未指定時為 `true`（啟用） | 必須；應（欄位名） | [KD-16](../../intents/03-decisions-and-stack.md#kd-16)、[KD-23](../../intents/03-decisions-and-stack.md#kd-23)（人員屬於一個 `Company`）；[OQ-02](../../intents/05-open-questions.md#oq-02) 裁定；`is_active` 預設啟用為負責人裁定（[DOM-Q7](#dom-q7)，[#127](https://github.com/speko-tw/inspect-flow/issues/127)，2026-09-26） | DOM-AC01 |
| DOM-R02 | `email` 是登入帳號，在所有 `User`（含已停用）之間**必須**唯一，由資料庫約束保證；本規格不另設帳號名稱欄位。email 比對是否不分大小寫見 [DOM-Q2](#dom-q2) | 必須 | [KD-18](../../intents/03-decisions-and-stack.md#kd-18)（登入帳號一律用 email）、[KD-20](../../intents/03-decisions-and-stack.md#kd-20)（同步以 email 找本系統帳號）、[KD-21](../../intents/03-decisions-and-stack.md#kd-21)（停用後資料保留）；唯一（含已停用帳號）為負責人決定（[#70 留言](https://github.com/speko-tw/inspect-flow/issues/70#issuecomment-5844708436)，2026-09-26） | DOM-AC02 |
| DOM-R03 | `User` **必須**具備聯絡與補充欄位：分機1 `extension_1`、分機2 `extension_2`、手機 `mobile`、Line ID `line_id`、WeChat `wechat_id`、負責事務 `responsibilities`；皆為選填（允許空值） | 必須；應（欄位名） | [KD-17](../../intents/03-decisions-and-stack.md#kd-17) | DOM-AC01 |
| DOM-R04 | 基本欄位的可修改性依帳號來源決定：`auth_source = local` 的帳號，基本欄位只由 Admin 修改；`auth_source = external` 的帳號，Service 層**必須**拒絕任何人工修改基本欄位，只有外部身分同步流程得覆蓋。聯絡與補充欄位由本人與 Admin 修改，外部身分同步**不得**覆蓋。Service 層的修改入口**必須**區分「人工修改」與「同步」兩種來源；判斷操作者是不是 Admin 或本人，由 `authentication` 執行 | 必須 | [KD-16](../../intents/03-decisions-and-stack.md#kd-16)、[KD-17](../../intents/03-decisions-and-stack.md#kd-17)；[KD-23](../../intents/03-decisions-and-stack.md#kd-23) 與外部帳號的衝突見 [DOM-Q8](#dom-q8) | DOM-AC04（外部帳號拒絕人工修改）；操作者身分由 `authentication` 驗收；同步不覆蓋由 `external-identity-sync` 驗收 |
| DOM-R05 | `User` **必須**具備系統欄位 `is_admin`（系統管理者）、`is_system`（內建帳號），皆為不可空值的布林值，未指定時為 `false`。系統管理者是 `User` 身上的開關，**不得**以 `Role` 或 `ProjectMember` 表示 | 必須 | [KD-19](../../intents/03-decisions-and-stack.md#kd-19)、[KD-24](../../intents/03-decisions-and-stack.md#kd-24) | DOM-AC01 |
| DOM-R06 | `is_system = true` 的帳號，Service 層**必須**拒絕將其停用（`is_active` 改為 `false`）或拿掉 Admin（`is_admin` 改為 `false`），資料不變 | 必須 | [KD-19](../../intents/03-decisions-and-stack.md#kd-19)、[KD-22](../../intents/03-decisions-and-stack.md#kd-22) | DOM-AC05 |
| DOM-R07 | 一次修改若會讓「啟用中且 `is_admin = true`」的 `User` 數量變成 0，Service 層**必須**拒絕，資料不變。「拿掉 Admin」包含取消 `is_admin` 與停用帳號兩種情況 | 必須 | [KD-29](../../intents/03-decisions-and-stack.md#kd-29)；「停用也算拿掉」是本規格的判讀，理由：停用後不能登入（[KD-21](../../intents/03-decisions-and-stack.md#kd-21)），實際上就沒有人能行使 Admin | DOM-AC06 |
| DOM-R08 | `User` **必須**預留外部身分來源欄位：`auth_source`（只允許 `local`、`external`，不可空值，未指定時為 `local`）、`external_source`（文字，例如 `ldap`、`ad`、`entra`、`erp`）、`external_id`（文字）、`external_synced_at`（UTC 時間）；後三者允許空值。`auth_source = external` 時，`external_source`、`external_id` **必須**有值；`external_source` 與 `external_id` 的組合在有值時**必須**唯一。以上由資料庫約束保證 | 必須 | [KD-20](../../intents/03-decisions-and-stack.md#kd-20)（欄位；同步先以「來源＋`external_id`」找人，組合必須能唯一指到一個人） | DOM-AC03 |
| DOM-R09 | 本系統帳號轉為外部帳號時，**必須**原地更新同一筆 `User`，UUID 不變，不得刪除重建 | 必須 | [KD-20](../../intents/03-decisions-and-stack.md#kd-20) | 由 `external-identity-sync` 驗收 |
| DOM-R10 | 人員離職時以 `is_active = false` 停用，不刪除 `User`。被其他資料以 `created_by`、`updated_by` 引用的 `User` **必須**無法被刪除，由資料庫外鍵約束保證；停用後不能登入，由 `authentication` 執行 | 必須 | [KD-21](../../intents/03-decisions-and-stack.md#kd-21)；外鍵見 DBF-R14 | DOM-AC07（無法刪除）；不能登入由 `authentication` 驗收 |

### 初始化指令與操作者（凍結）

| 編號 | 需求 | 強度 | 依據 | 驗收 |
|---|---|---|---|---|
| DOM-R11 | 後端**必須**提供一個初始化指令，在同一個交易裡建立：一筆 `kind = internal` 的 `Company`；內建 `admin`（`is_admin = true`、`is_system = true`，`created_by`、`updated_by` 指向自己，`company_id` 指向該公司）；負責人的個人帳號（`is_admin = true`、`is_system = false`，`created_by`、`updated_by` 指向 `admin`，`company_id` 指向該公司）；三個範本角色「內業整理」「現場查核」「唯讀」。公司與角色的 `created_by`、`updated_by` 指向 `admin`。任何一步失敗時，整批都不生效 | 必須 | [KD-22](../../intents/03-decisions-and-stack.md#kd-22)、[KD-26](../../intents/03-decisions-and-stack.md#kd-26)（首次安裝預建三個範本角色）；[#54](https://github.com/speko-tw/inspect-flow/issues/54) 兩則裁定（`created_by` 規則；認證前資料的操作者為 `admin`） | DOM-AC08 |
| DOM-R12 | 公司的 `code`、`name`，以及兩個帳號的所有必填基本欄位（DOM-R01，`is_active` 除外），**必須**在執行指令時輸入；repo 內**不得**寫入這些值或其預設值 | 必須 | [KD-22](../../intents/03-decisions-and-stack.md#kd-22)（email 與姓名不寫進 repo）；負責人決定（[#70 留言](https://github.com/speko-tw/inspect-flow/issues/70#issuecomment-5844531219)，2026-09-26：詢問全部必填欄位與本公司） | DOM-AC08 |
| DOM-R13 | 資料庫已有 `is_system = true` 的 `User` 時，初始化指令**必須**不寫入任何資料，並回報系統已初始化 | 必須 | [KD-22](../../intents/03-decisions-and-stack.md#kd-22)（內建 `admin` 只有一個）；「不重複建立」是本規格的推導 | DOM-AC09 |
| DOM-R14 | Service 層**必須**從單一入口取得「目前操作者」，用來填 `created_by`、`updated_by`。`authentication` 完成前，這個入口一律回傳內建 `admin`（`is_system = true` 的 `User`）；完成後改由 `authentication` 回傳實際登入的人 | 必須 | [#54](https://github.com/speko-tw/inspect-flow/issues/54) 補充裁定（負責人，2026-09-26）；DBF-R14 | DOM-AC10 |

### `Company`（凍結）

| 編號 | 需求 | 強度 | 依據 | 驗收 |
|---|---|---|---|---|
| DOM-R15 | `Company` **必須**沿用 `User`、`Project` 的共通結構：UUID 主鍵，以及 `created_at`、`updated_at`、`created_by`、`updated_by`（不可空值、外鍵指向 `User`）。`Role`、`ProjectMember` 同樣適用 | 必須 | [KD-07](../../intents/03-decisions-and-stack.md#kd-07)、[PR-08](../../intents/02-principles.md#pr-08)；做法同 DBF-R11、DBF-R14；[#54](https://github.com/speko-tw/inspect-flow/issues/54) 補充裁定（所有資料的 `created_by` 都有值） | DOM-AC11、DOM-AC14、DOM-AC18 |
| DOM-R16 | `Company` **必須**具備：`code`（不可空值，在所有 `Company` 之間唯一）、`name`（不可空值）、`tax_id`（統一編號，允許空值，有值時唯一）、`kind`（只允許 `internal`、`customer`，不可空值）、`parent_id`（母公司，允許空值，外鍵指向 `Company`）、`is_active`（不可空值的布林值，未指定時為 `true`）。以上由資料庫約束保證 | 必須 | [KD-23](../../intents/03-decisions-and-stack.md#kd-23)；`is_active` 預設啟用為負責人裁定（[DOM-Q7](#dom-q7)，[#127](https://github.com/speko-tw/inspect-flow/issues/127)，2026-09-26） | DOM-AC11 |
| DOM-R17 | `parent_id` **不得**指向自己，由資料庫約束保證。本規格不檢查多層的循環（例如 A → C → B → A）：目前沒有功能會讀取公司階層，循環檢查由日後需要查公司階層的規格負責 | 必須 | [KD-23](../../intents/03-decisions-and-stack.md#kd-23)；不做循環檢查為負責人決定（[#70 留言](https://github.com/speko-tw/inspect-flow/issues/70#issuecomment-5844742074)，2026-09-26） | DOM-AC12 |
| DOM-R18 | 本系統帳號（`auth_source = local`）所屬的 `Company` 得隨時修改，不受原公司或新公司的 `kind` 限制（例如從客戶轉為員工）；新公司須為啟用中，見 DOM-R28 | 得 | [KD-23](../../intents/03-decisions-and-stack.md#kd-23)；外部帳號見 [DOM-Q8](#dom-q8) | DOM-AC13 |
| DOM-R28 | `Company` 停用（`is_active = false`）只有一個效果：Service 層的 `User` 新增入口與人工修改入口，**必須**拒絕把 `company_id` 設為停用中的公司，資料不變。停用公司**不得**改變旗下 `User` 的任何資料（含 `is_active`、`company_id`），也不影響他們登入與參與專案；修改這些人員的其他欄位不受限制。人員能不能登入只看 `User.is_active`，不看所屬公司，由 `authentication` 執行（AUT-R05、AUT-R14 不檢查公司狀態）。外部身分同步把人員對應到停用中的公司時怎麼處理，由 `external-identity-sync` 決定 | 必須 | 負責人裁定（[DOM-Q7](#dom-q7) 選項 A，[#127](https://github.com/speko-tw/inspect-flow/issues/127)，2026-09-26）；[KD-21](../../intents/03-decisions-and-stack.md#kd-21)（停用人員才不能登入） | DOM-AC19；登入不看公司狀態由 `authentication` 驗收 |
| DOM-R29 | Service 層**必須**能列出一個 `Company` 目前啟用中（`is_active = true`）的 `User` 與其人數，供停用公司前顯示「這家公司還有 N 位啟用中的人員」。提供停用公司操作的功能規格**必須**顯示這個人數，並提供一併停用的選擇，由操作者決定實際停用哪些人；選中的人員逐一經 `User` 的停用入口處理，仍受 DOM-R06、DOM-R07 保護。沒有被選中的人員維持啟用 | 必須 | [PR-18](../../intents/02-principles.md#pr-18)；負責人裁定（[DOM-Q7](#dom-q7)，[#127](https://github.com/speko-tw/inspect-flow/issues/127)，2026-09-26：顯示啟用中人數、一併停用由操作者決定） | DOM-AC20（人數、名單與停用公司不連動）；顯示與一併停用的流程由功能規格驗收 |

### `Role`（凍結）

| 編號 | 需求 | 強度 | 依據 | 驗收 |
|---|---|---|---|---|
| DOM-R19 | `Role` 是全系統共用的一份清單，不分專案；**必須**具備名稱 `name`（不可空值），以及權限內容：一組權限代碼（文字，例如 `report.read`、`report.approve`）。同一個 `Role` 內的權限代碼**不得**重複，由資料庫約束保證。名稱是否唯一見 [DOM-Q4](#dom-q4)；權限代碼的命名規則與可用清單見 [DOM-Q3](#dom-q3) | 必須 | [KD-25](../../intents/03-decisions-and-stack.md#kd-25)、[KD-26](../../intents/03-decisions-and-stack.md#kd-26) | DOM-AC14 |
| DOM-R20 | 所有 `Role`（含三個範本角色）都得改名、修改權限內容與刪除；本規格不設不可修改的角色。修改權限內容或名稱時，**必須**更新該 `Role` 的 `updated_at`、`updated_by` | 得（修改、刪除）；必須（修改紀錄） | [KD-26](../../intents/03-decisions-and-stack.md#kd-26)；[PR-08](../../intents/02-principles.md#pr-08) | DOM-AC14 |
| DOM-R21 | 刪除一個 `Role` 時，**必須**同時移除所有 `ProjectMember` 對它的指派；這些 `ProjectMember` 本身與其他角色的指派不受影響 | 必須 | [KD-26](../../intents/03-decisions-and-stack.md#kd-26)（刪除角色立即影響所有持有者） | DOM-AC16 |
| DOM-R22 | （草稿，不在凍結範圍）權限與角色的變更（含角色的新增、修改、刪除，以及 `ProjectMember` 的角色指派）**必須**寫稽核紀錄。稽核紀錄的資料模型未定，本條在 [DOM-Q6](#dom-q6) 裁定、確定由哪份規格與任務實作後，才擴大凍結範圍並補驗收條件 | 必須 | [KD-29](../../intents/03-decisions-and-stack.md#kd-29) | 待 DOM-Q6；裁定前不拆任務 |
| DOM-R23 | Service 層**應**能算出一個 `Role` 的影響範圍：持有它的 `ProjectMember` 筆數，以及這些成員涉及的不重複 `User` 人數，供修改或刪除前顯示。畫面顯示與確認流程由提供該操作的功能規格負責 | 應 | [PR-18](../../intents/02-principles.md#pr-18)（影響範圍怎麼計算留給相關規格決定）、[KD-26](../../intents/03-decisions-and-stack.md#kd-26) | DOM-AC17；顯示與確認由功能規格驗收 |
| DOM-R24 | 替 `kind = customer` 的 `Company` 所屬人員指派「有修改能力」的角色時，功能規格**必須**顯示確認提示、但不阻擋（[KD-28](../../intents/03-decisions-and-stack.md#kd-28)）。本規格提供判斷所需的資料：人員所屬 `Company` 的 `kind`，以及角色的權限代碼；怎麼從權限代碼判斷「有修改能力」見 [DOM-Q3](#dom-q3) | 必須 | [KD-28](../../intents/03-decisions-and-stack.md#kd-28) | 由提供指派操作的功能規格驗收 |

### `ProjectMember`（凍結）

| 編號 | 需求 | 強度 | 依據 | 驗收 |
|---|---|---|---|---|
| DOM-R25 | `ProjectMember` 表示一個 `User` 參與一個 `Project`：**必須**具備 `project_id`（外鍵指向 `Project`）與 `user_id`（外鍵指向 `User`），皆不可空值；同一個 `Project` 與 `User` 的組合**必須**唯一。一筆 `ProjectMember` 得指派多個 `Role`，同一個 `Role` 在同一筆成員上**不得**重複指派。以上由資料庫約束保證。成員得不得沒有任何角色、移除成員時怎麼保留紀錄，見 [DOM-Q5](#dom-q5) | 必須；得（多個角色） | [KD-27](../../intents/03-decisions-and-stack.md#kd-27) | DOM-AC18 |
| DOM-R26 | 一個人在一個專案的有效權限，**必須**是他在該專案的 `ProjectMember` 上所有 `Role` 權限代碼的聯集，而且**必須**在使用時從 `Role` 目前的內容計算，不得把權限代碼複製到 `ProjectMember`，修改角色才會立即影響所有持有者。不是該專案成員的人，有效權限為空集合 | 必須 | [KD-26](../../intents/03-decisions-and-stack.md#kd-26)、[KD-27](../../intents/03-decisions-and-stack.md#kd-27)；空集合對應 [KD-29](../../intents/03-decisions-and-stack.md#kd-29) 預設拒絕 | DOM-AC15 |
| DOM-R27 | Admin 查看、修改所有專案的權力來自 `is_admin`，不需要、也不透過 `ProjectMember`；授權檢查怎麼合併 `is_admin` 與有效權限，由 `authentication` 執行 | 必須 | [KD-24](../../intents/03-decisions-and-stack.md#kd-24) | 由 `authentication` 驗收 |

<a id="draft-project"></a>
### `Project` 業務欄位（草稿）

本段在 [OQ-01](../../intents/05-open-questions.md#oq-01) 裁定前維持草稿，不拆任務。OQ-01 不在開工門檻內，但尚未定案，不得把來源的佔位欄位當成定案（依 [AGENTS.md](../../../AGENTS.md)）。

| 編號 | 需求（草稿） | 強度 | 依據 |
|---|---|---|---|
| DOM-R40 | `Project` 的業務欄位待 OQ-01 裁定。架構基準只給出 `name`、`location`、`status` 等佔位欄位，並提示未來可能需要 Building／Floor／Area／WBS／Contractor 等結構。UUID 主鍵、`project_code` 與建立及修改紀錄已由 DBF-R11～DBF-R14 凍結 | 待 OQ-01 | [OQ-01](../../intents/05-open-questions.md#oq-01)（依據：架構基準 §12.2、§38 Project） |

<a id="draft-others"></a>
### 其他實體（草稿）

`Inspection Template`、`Template Version`、`Template Item`、`Evidence Requirement`、`Inspection Plan`、`Inspection Task`、`Task Requirement Snapshot`、`Evidence`、`Evidence Variant`、`Result`、`Report` 受[開工門檻](../../intents/05-open-questions.md#gate)（G-01～G-07、OQ-06）擋，本次不撰寫。門檻逐一裁定後，依[部分凍結](../README.md#partial-freeze)規則擴大凍結範圍，需求編號從 DOM-R41 起接續。

## 資料

本規格定義下列實體的完整欄位；共通結構（UUID 主鍵、業務編號、建立與修改紀錄）由 `database-foundation` 定義，這裡只引用。

| 實體 | 共通結構（`database-foundation`） | 本規格定義 | 狀態 |
|---|---|---|---|
| `User` | UUID 主鍵、`employee_no`、`created_at`、`updated_at`、`created_by`、`updated_by`（DBF-R11～DBF-R14） | 基本欄位、聯絡與補充欄位、`is_admin`、`is_system`、外部身分預留欄位（DOM-R01～DOM-R10）；認證欄位歸 `authentication` | 凍結 |
| `Company` | 沿用同一套共通結構（DOM-R15） | `code`、`name`、`tax_id`、`kind`、`parent_id`、`is_active`（DOM-R16～DOM-R18） | 凍結 |
| `Role` | 沿用同一套共通結構（DOM-R15） | `name`、權限代碼集合（DOM-R19～DOM-R24） | 凍結 |
| `ProjectMember` | 沿用同一套共通結構（DOM-R15） | `project_id`、`user_id`、角色指派（DOM-R25～DOM-R27） | 凍結 |
| `Project` | UUID 主鍵、`project_code`、建立與修改紀錄（DBF-R11～DBF-R14） | 業務欄位待 OQ-01（DOM-R40） | 草稿 |
| 其他實體 | — | 見[其他實體](#draft-others) | 草稿 |

關聯：`Company` 1—多 `User`；`Company` 可指向母公司 `Company`；`User` 1—多 `ProjectMember`；`Project` 1—多 `ProjectMember`；`ProjectMember` 多—多 `Role`（見 [01-overview 實體關係](../../intents/01-overview.md#人員公司與權限的實體關係)）。`User.company_id` 與 `Company.created_by` 互相引用，而且都不可空值，所以初始化指令必須在同一個交易裡建立兩者（DOM-R11）。

**門檻比對**（依[部分凍結](../README.md#partial-freeze)規則 1，含其中的「例外：只用 ID 引用」）：逐條比對[開工門檻](../../intents/05-open-questions.md#gate)的 G-01～G-07、OQ-06 的「為什麼要先決定」、選項原文與門檻摘要，搜尋人員、使用者、管理者、核可者、角色、權限、公司、成員、客戶、帳號、專案等字面。

| 實體 | 比對過的議題 | 字面命中 | 結論 | 理由 |
|---|---|---|---|---|
| `User` | G-01～G-07、OQ-06 | G-01 立場 B「由**管理者**輸入的參數」；G-03「**使用者**何時看到編輯結果」；G-04「Variant 核可紀錄、**核可者**」 | 無關，凍結 | G-01 的「管理者」指輸入 `Inspection Plan` 參數的人，議題只在問 interval 放在哪一張表，不涉及 `User` 欄位。G-03 的「使用者」是泛稱，談的是編輯與上傳的時序。G-04 的「核可者」是記錄「是哪個人」，若日後要記錄，是在 Variant 或核可紀錄那一側加指向 `User` 的 UUID 外鍵，`User` 自己的欄位、狀態與規則都不會改變，適用規則 1 的「只用 ID 引用」例外。G-01、G-03 是泛稱，連 ID 引用都不是 |
| `Company` | G-01～G-07、OQ-06 | 無 | 無關，凍結 | 門檻內沒有任何議題提到公司、客戶或組織 |
| `Role` | G-01～G-07、OQ-06 | 無直接命中；G-04「核可者、核可流程」可能延伸到「誰有權核可」 | 無關，凍結 | G-04 若裁定「由具備某權限的人核可」，只會多一個權限代碼（例如 `evidence_variant.approve`），那是 `Role` 權限內容裡的一筆資料，不改變 `Role` 的欄位或約束（[KD-25](../../intents/03-decisions-and-stack.md#kd-25)：系統存的是權限代碼，不是寫死的功能表） |
| `ProjectMember` | G-01～G-07、OQ-06 | G-02 立場 A 的範例路徑 `photos/<project_id>/...` | 無關，凍結 | 路徑裡的是 `Project` 的 UUID，不是 `ProjectMember`，本身就不算命中 `ProjectMember`；`ProjectMember` 只以 UUID 外鍵引用 `Project`、`User`，不依賴 `Project` 的業務欄位 |
| `Project`（業務欄位） | G-01～G-07、OQ-06 | G-02 立場 A 的範例路徑（同 `database-foundation` 的比對） | 門檻無關，但維持草稿 | 路徑只以 UUID 引用 `Project`，適用規則 1 的「只用 ID 引用」例外，結論同 `database-foundation`；不凍結的原因是門檻外的 [OQ-01](../../intents/05-open-questions.md#oq-01) 尚未裁定（負責人決定，[#70 留言](https://github.com/speko-tw/inspect-flow/issues/70#issuecomment-5844531219)，2026-09-26） |

`User` 的命中屬於規則 1 的「只用 ID 引用」例外（不影響 `User` 本身），或只是泛稱。`Role` 不適用這個例外，判為無關的理由是：G-04 沒有點名角色；依 [KD-25](../../intents/03-decisions-and-stack.md#kd-25)、[KD-26](../../intents/03-decisions-and-stack.md#kd-26)，「誰能核可」只能表示成一個權限代碼，由有權限的人勾選進任何角色，是 `Role` 權限內容裡的資料，不改變 `Role` 的欄位、狀態或規則。G-04 的選項原文也只談 Variant 的核可紀錄、核可者與狀態欄位，沒有要求固定或不可刪除的角色；若要那樣做，會牴觸 KD-26「角色全部可自訂」，屬意圖變更，不是 G-04 的裁定範圍。

## 介面

本規格不新增 API 端點。對開發者的介面如下；具體模組、函式與指令名稱由計畫決定，不屬於本規格的契約。

| 介面 | 內容 | 對應需求 |
|---|---|---|
| 指令 | 初始化指令：互動式詢問本公司與兩個帳號的欄位，建立初始資料；已初始化時不寫入 | DOM-R11～DOM-R13 |
| 程式介面 | 取得「目前操作者」的單一入口 | DOM-R14 |
| 程式介面 | `User` 修改入口（區分人工修改與同步；內建帳號與最後一個 Admin 的保護） | DOM-R04、DOM-R06、DOM-R07 |
| 程式介面 | `User` 新增入口（拒絕停用中的公司） | DOM-R28 |
| 程式介面 | `Company` 新增與修改入口（填建立與修改紀錄）；列出公司啟用中的人員與人數 | DOM-R14、DOM-R29 |
| 程式介面 | `Role` 修改與刪除、角色影響範圍、有效權限計算 | DOM-R20、DOM-R21、DOM-R23、DOM-R26 |

## 驗收條件

每條至少對應一個需求；皆以 `make check` 內的自動化測試驗證，資料庫由 `alembic upgrade head` 建立。

### `User`

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| DOM-AC01 | 對空資料庫執行 `alembic upgrade head` 之後，由測試在同一個交易裡建立一筆 `Company` 與一筆作為操作者的 `User`（`created_by`、`updated_by` 指向自己，`company_id` 指向該公司） | 用 SQLAlchemy inspector 檢查 `User` 資料表；以該操作者為 `created_by`、`updated_by`，新增一筆只提供必填基本欄位的 `User`；再分別嘗試新增缺少任一必填基本欄位的 `User` | DOM-R01、DOM-R03、DOM-R05、DOM-R08 列出的欄位都存在；基本欄位（含 `is_active`）、`is_admin`、`is_system`、`auth_source` 不可空值，聯絡與補充欄位可空值；`company_id` 外鍵指向 `Company`；第一筆成功，且 `is_active` 為 `true`、`is_admin`、`is_system` 為 `false`、`auth_source` 為 `local`、聯絡欄位為空值；缺欄位的每一次都被資料庫拒絕，筆數不變 | DOM-R01、DOM-R03、DOM-R05 |
| DOM-AC02 | 與 DOM-AC01 相同的前置資料，並已有一筆 `email = "a@example.com"` 的 `User`，並已停用 | 新增另一筆相同 `email` 的 `User` | 因唯一約束失敗；該 email 的 `User` 仍只有一筆，`User` 總筆數與新增前相同 | DOM-R02 |
| DOM-AC03 | 與 DOM-AC01 相同的前置資料，並已有一筆 `auth_source = local`、外部欄位皆為空值的 `User` | 另新增一筆同樣外部欄位皆為空值的 `local` 帳號；新增一筆 `auth_source = external` 且 `external_source`、`external_id` 有值的帳號；再分別嘗試：`auth_source` 為 `local`、`external` 以外的值；`external` 但 `external_id` 為空值；`external` 但 `external_source` 為空值；`external_source` 與 `external_id` 都和前一筆相同的帳號 | 前兩次新增成功；後四次都被資料庫拒絕，筆數不變 | DOM-R08 |
| DOM-AC04 | 一筆 `external` 帳號、一筆 `local` 帳號 | 透過 Service 層的人工修改入口，分別修改兩者的 `department` 與 `mobile` | `external` 帳號的 `department` 修改被拒絕、值不變，`mobile` 修改成功；`local` 帳號兩者都修改成功 | DOM-R04 |
| DOM-AC05 | 初始化後的資料庫（內建 `admin` 與另一位 Admin） | 透過 Service 層嘗試把 `admin` 的 `is_active` 改為 `false`，以及把 `is_admin` 改為 `false` | 兩次都被拒絕，`admin` 的資料不變 | DOM-R06 |
| DOM-AC06 | 一個只有一位啟用中 Admin（`is_system = false`）的測試資料庫 | 透過 Service 層取消他的 `is_admin`，以及停用他；再新增第二位啟用中的 Admin 後，重做一次取消 `is_admin` | 前兩次都被拒絕、資料不變；有第二位 Admin 時修改成功 | DOM-R07 |
| DOM-AC07 | 一筆 `User`，被另一筆資料的 `created_by` 引用 | 刪除這筆 `User` | 被資料庫外鍵約束拒絕，資料不變 | DOM-R10 |

### 初始化指令與操作者

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| DOM-AC08 | 對空資料庫執行 `alembic upgrade head` 之後；一組只存在於測試內的輸入值 | 執行初始化指令並提供這組輸入；另在一個新的空資料庫，提供會讓第二個帳號寫入失敗的輸入（例如兩個帳號的 email 相同）再執行一次 | 第一次：恰有一筆 `kind = internal` 的 `Company`、兩筆 `User`、三筆 `Role`（名稱為「內業整理」「現場查核」「唯讀」），欄位值等於輸入值；`admin` 為 `is_admin`、`is_system`，`created_by`、`updated_by` 指向自己；個人帳號為 `is_admin`、非 `is_system`，`created_by`、`updated_by` 指向 `admin`；公司與三個角色的 `created_by`、`updated_by` 指向 `admin`；兩個帳號的 `company_id` 指向該公司。第二次：指令回報失敗，資料庫沒有任何 `Company`、`User`、`Role` | DOM-R11、DOM-R12 |
| DOM-AC09 | 已執行過一次初始化指令的資料庫 | 以另一組輸入再執行一次 | 指令回報已初始化；`Company`、`User`、`Role` 的筆數與內容都不變 | DOM-R13 |
| DOM-AC10 | 初始化後的資料庫，尚未有 `authentication` | 透過 Service 層新增一筆 `Company`，之後修改它 | 新增後 `created_by`、`updated_by` 都等於 `admin` 的 UUID；修改後 `updated_by` 仍為 `admin` | DOM-R14 |

### `Company`

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| DOM-AC11 | 對空資料庫執行 `alembic upgrade head` 之後，已有一筆 `code = "C001"`、`tax_id = "12345678"` 的 `Company` | 用 inspector 檢查 `Company` 資料表；再分別新增：`code` 相同的公司；`tax_id` 相同的公司；兩筆 `tax_id` 皆為空值、未指定 `is_active` 的公司；`kind` 為 `internal`、`customer` 以外值的公司；`parent_id` 指向不存在 UUID 的公司；`created_by` 為空值的公司；`is_active` 為空值的公司 | 資料表有 UUID 主鍵、DOM-R16 的欄位與建立及修改紀錄欄位；兩筆 `tax_id` 空值的公司（都未指定 `is_active`）新增成功，`is_active` 都是 `true`；其餘每一次都被資料庫拒絕，筆數不變 | DOM-R15、DOM-R16 |
| DOM-AC12 | 對空資料庫執行 `alembic upgrade head` 之後，兩筆 `Company`：A、B | 把 B 的 `parent_id` 設為 B；再把 B 的 `parent_id` 設為 A | 第一次被資料庫拒絕、資料不變；第二次成功 | DOM-R17 |
| DOM-AC13 | 一筆 `local` 帳號，屬於一間 `kind = customer` 的公司 | 透過 Service 層把他的 `company_id` 改為一間 `kind = internal` 的公司 | 修改成功 | DOM-R18 |
| DOM-AC19 | 啟用中的公司 A、停用中的公司 B；`local` 帳號 U 屬於 A；`local` 帳號 V 屬於 B（B 啟用時建立，之後才停用），`is_active = true` | 透過 Service 層：新增一筆 `company_id` 為 B 的 `User`；把 U 的 `company_id` 改為 B；修改 V 的 `department` 與 `mobile`；把 V 的 `company_id` 改為 A | 前兩次都被拒絕，`User` 筆數與 U 的資料不變；V 的兩個欄位修改成功，`is_active` 仍為 `true`；V 改到 A 成功 | DOM-R18、DOM-R28 |
| DOM-AC20 | 公司 C 有三筆 `User`：兩筆啟用中、一筆已停用；公司 D 沒有啟用中的人員 | 列出 C、D 啟用中的人員與人數；再透過 Service 層把 C 的 `is_active` 改為 `false` | C 為 2 人，名單恰為那兩筆啟用中的 `User`；D 為 0 人、名單為空；C 停用成功，三筆 `User` 的 `is_active` 與 `company_id` 都和停用前相同 | DOM-R28、DOM-R29 |

### `Role` 與 `ProjectMember`

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| DOM-AC14 | 對空資料庫執行 `alembic upgrade head` 之後，一個含 `report.read` 的 `Role` | 用 inspector 檢查 `Role` 資料表；在同一個 `Role` 再加一次 `report.read`；在另一個 `Role` 加 `report.read`；以可控時間在建立至少一秒後，透過 Service 層改名並加入 `report.approve` | 資料表有 UUID 主鍵與建立及修改紀錄欄位；同一角色重複的代碼被資料庫拒絕；另一角色加入成功；改名與新增代碼成功，`updated_at` 晚於修改前，`updated_by` 為目前操作者 | DOM-R15、DOM-R19、DOM-R20 |
| DOM-AC15 | 使用者 U 在專案 P 的 `ProjectMember` 上有角色 R1（`report.read`）與 R2（`report.approve`、`report.read`）；U 不是專案 Q 的成員 | 計算 U 在 P、Q 的有效權限；再把 R1 的權限內容改為 `evidence.read`，重新計算 U 在 P 的有效權限 | P 的第一次結果為 `{report.read, report.approve}`；Q 為空集合；R1 修改後，P 的結果為 `{evidence.read, report.read, report.approve}`，且 `ProjectMember` 上沒有權限代碼的副本 | DOM-R26 |
| DOM-AC16 | 兩筆 `ProjectMember` 都持有角色 R1，其中一筆另持有 R2 | 透過 Service 層刪除 R1 | R1 不存在；兩筆 `ProjectMember` 仍存在；沒有任何指派指向 R1；持有 R2 的那筆仍持有 R2 | DOM-R21 |
| DOM-AC17 | 角色 R 被三筆 `ProjectMember` 持有，分屬兩個 `User`（其中一人在兩個專案都持有 R）；另一個角色沒有人持有 | 計算兩個角色的影響範圍 | R 為 3 筆成員、2 人；另一個角色為 0 筆、0 人 | DOM-R23 |
| DOM-AC18 | 對空資料庫執行 `alembic upgrade head` 之後，已有一筆 P、U 的 `ProjectMember` | 用 inspector 檢查 `ProjectMember` 與角色指派的資料表；再新增相同 P、U 的 `ProjectMember`；對同一筆成員重複指派同一個 `Role`；新增 `project_id` 或 `user_id` 指向不存在 UUID 的成員；對同一筆成員指派兩個不同的 `Role` | 資料表有 UUID 主鍵與建立及修改紀錄欄位；重複成員、重複指派、外鍵不存在都被資料庫拒絕，筆數不變；兩個不同的角色指派成功 | DOM-R15、DOM-R25 |

## 待釐清

撰寫中發現、本規格不自行拍板的問題。若負責人判定需要團隊裁定，另開 issue 移到 `05-open-questions.md`，並在此留連結。

<a id="dom-q1"></a>
- **DOM-Q1：字串欄位的長度上限與格式**。#63 只定了欄位，沒有定長度（例如 `email`、`employee_no`、`Company.code`、`name_en`、`name_zh`、權限代碼）與格式（例如 `tax_id` 是否限定 8 位數字、`email` 是否檢查格式）。SQLite 不強制 `VARCHAR` 長度，PostgreSQL 會；之後再加上限需要新的 migration。影響計畫 T1～T3。
<a id="dom-q2"></a>
- **DOM-Q2：email 比對是否不分大小寫**。DOM-R02 要求 email 唯一；`A@example.com` 與 `a@example.com` 算不算同一個人，會影響唯一約束的寫法（存正規化後的值，或以小寫比對的唯一索引），以及 `external-identity-sync` 以 email 比對時的結果。影響計畫 T2。
<a id="dom-q3"></a>
- **DOM-Q3：權限代碼的命名規則、可用清單與「有修改能力」的判斷**。[KD-25](../../intents/03-decisions-and-stack.md#kd-25) 只給出 `report.read`、`report.approve` 的例子，並寫明命名規則待相關規格定案。待定的有：格式是否固定為 `<資料>.<動作>`；可用的權限代碼清單放在哪裡（程式內的登記表或資料表），`Role` 能不能存清單以外的代碼；清單的初始範圍（目前還沒有任何功能規格登記代碼）；[KD-28](../../intents/03-decisions-and-stack.md#kd-28) 的「有修改能力」是否等於含 `create`、`update`、`delete` 或特殊動作任一者。影響計畫 T3 的約束與 T6 的範本角色。
<a id="dom-q4"></a>
- **DOM-Q4：範本角色的初始權限內容與角色名稱是否唯一**。[OQ-08](../../intents/05-open-questions.md#oq-08) 裁定各範本角色勾選哪些權限在系統畫面上調整，但沒說首次安裝時三個範本角色的權限內容是空集合還是有預設值（DOM-R11 目前只建立名稱）。另外 `Role.name` 是否必須唯一，#63 沒有寫；名稱重複時指派畫面會難以分辨。影響計畫 T3、T6。
<a id="dom-q5"></a>
- **DOM-Q5：專案成員的角色下限與移除方式**。`ProjectMember` 得不得沒有任何角色（沒有角色時有效權限為空集合，依預設拒絕仍然安全）；把人移出專案時是刪除 `ProjectMember`，還是保留紀錄並標記移除（[KD-21](../../intents/03-decisions-and-stack.md#kd-21) 只規定人員停用時保留資料）。影響計畫 T3。
<a id="dom-q6"></a>
- **DOM-Q6：稽核紀錄的資料模型由哪份規格定義**。[KD-20](../../intents/03-decisions-and-stack.md#kd-20)（外部值覆蓋基本欄位）與 [KD-29](../../intents/03-decisions-and-stack.md#kd-29)（權限與角色變更）都要求寫稽核紀錄，[04-glossary](../../intents/04-glossary.md)「稽核紀錄」只是概念，目前沒有規格定義它的欄位。可以放在本規格擴大凍結範圍，或另開規格。另外要決定：初始化指令建立的帳號與範本角色是否也要寫稽核紀錄，以及 `is_admin` 的變更是否算「權限變更」（本規格依字面視為是）。DOM-R22 在此之前無法驗收，計畫 T6、T7 依賴本題裁定。
<a id="dom-q7"></a>
- **DOM-Q7：`is_active` 的預設值，以及停用公司的影響**（已裁定，[#127](https://github.com/speko-tw/inspect-flow/issues/127)）。[KD-16](../../intents/03-decisions-and-stack.md#kd-16) 說啟用狀態不是必填，但沒說未提供時是啟用還是停用；`Company.is_active` 同樣沒有預設值。另外 `Company` 停用後，其人員能不能登入、能不能再被加入專案，#63 沒有寫。影響計畫 T1、T2。
  - **裁定**（負責人，[#127](https://github.com/speko-tw/inspect-flow/issues/127)，2026-09-26）：`User.is_active`、`Company.is_active` 未指定時都是啟用。公司停用不影響旗下人員（選項 A）：停用只代表新建或修改人員時不能再選這家公司；人員能不能登入只看自己的 `is_active`，`authentication` 不需要增加公司狀態的檢查。停用公司時依 [PR-18](../../intents/02-principles.md#pr-18) 顯示「這家公司還有 N 位啟用中的人員」，並提供一併停用的選擇，實際停用哪些人由操作者決定。
  - **落地**：預設值寫進 DOM-R01、DOM-R16、DOM-AC01、DOM-AC11；停用公司的效果與影響範圍寫進 DOM-R28、DOM-R29、DOM-AC19、DOM-AC20，DOM-R18 加上新公司須為啟用中的引用。
<a id="dom-q8"></a>
- **DOM-Q8：外部帳號能不能修改所屬公司**。[KD-23](../../intents/03-decisions-and-stack.md#kd-23) 說人員所屬公司可以隨時修改，[KD-16](../../intents/03-decisions-and-stack.md#kd-16) 說外部帳號的基本欄位（含公司）任何人都不能修改，兩者對外部帳號的說法相反。本規格只凍結本系統帳號的部分（DOM-R18），外部帳號依 DOM-R04 暫以 KD-16 為準；這屬於意圖層的衝突，需要負責人裁定後回頭調整 KD-16 或 KD-23。

## 變更紀錄

凍結後的「範圍變更」以上才記；一行寫改了什麼與 issue 連結。

- DOM-Q7 裁定：DOM-R01、DOM-R16 補上 `is_active` 預設啟用；新增 DOM-R28（停用公司不能再被選用、不影響旗下人員）、DOM-R29（停用前列出啟用中人員與人數），以及 DOM-AC19、DOM-AC20；DOM-AC01、DOM-AC11 補上預設值的斷言 — [#127](https://github.com/speko-tw/inspect-flow/issues/127)
