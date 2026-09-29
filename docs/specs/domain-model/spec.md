# 領域模型（domain-model）

**代碼**：`DOM`　**Phase**：P1、P3、P4、P6、P9　**狀態**：部分凍結
**前置規格**：`database-foundation`（UUID 主鍵、業務編號、建立與修改紀錄等共通結構，見 DBF-R11～DBF-R14）、`api-conventions`（UUID 字串 ID、UTC 時間格式）
**引用意圖**：[PR-01](../../intents/02-principles.md#pr-01)、[PR-08](../../intents/02-principles.md#pr-08)、[PR-18](../../intents/02-principles.md#pr-18)、[KD-07](../../intents/03-decisions-and-stack.md#kd-07)、[KD-15](../../intents/03-decisions-and-stack.md#kd-15)、[KD-16](../../intents/03-decisions-and-stack.md#kd-16)～[KD-29](../../intents/03-decisions-and-stack.md#kd-29)（KD-16、KD-18、KD-22、KD-28 已被取代，KD-23 已改寫）、[KD-43](../../intents/03-decisions-and-stack.md#kd-43)～[KD-46](../../intents/03-decisions-and-stack.md#kd-46)、[OQ-02](../../intents/05-open-questions.md#oq-02)（已裁定；欄位部分已被取代）、[OQ-08](../../intents/05-open-questions.md#oq-08)（已裁定）、[OQ-22](../../intents/05-open-questions.md#oq-22)
**被擋議題**：凍結範圍無；其餘實體受 [G-01](../../intents/05-open-questions.md#g-01)、[G-02](../../intents/05-open-questions.md#g-02)、[OQ-06](../../intents/05-open-questions.md#oq-06) 等[開工門檻](../../intents/05-open-questions.md#gate)擋（依 [OQ-22](../../intents/05-open-questions.md#oq-22)）
**凍結範圍**：`User`（業務欄位、帳號名稱、`is_admin`、`is_system`、外部身分預留欄位）、`Company`（名稱與啟用狀態）、`Role`、`ProjectMember`、`Project` 業務欄位，以及初始化指令、認證前的操作者、字串欄位的長度及格式與稽核紀錄的寫入範圍（DOM-R01～DOM-R36、DOM-R40～DOM-R54、DOM-AC01～DOM-AC46；其中已被取代的條目見各條）。其餘實體待 [G-01](../../intents/05-open-questions.md#g-01) 等裁定，需求編號從 DOM-R55 起接續

## 目的

人員、公司、角色與專案成員有一份確定的資料模型：人員有帳號名稱、業務欄位與系統欄位，並預留外部身分來源的欄位，不一定屬於公司；公司只有名稱與啟用狀態；系統管理者是人員身上的開關，專案角色可以自訂、掛在專案成員上、權限加總。初始化指令只建立內建 `admin`，不預建角色；角色由 Admin 之後在系統內新增。第一個使用者與公司由首次設定流程在網頁上建立；登入功能完成前的資料一律以內建 `admin` 為操作者。後續的 `authentication`、`admin-dashboard` 與資料表實作都依這份定義進行（依據：負責人決定，#63，2026-09-26；取代架構基準 §12.1 的最小欄位假設與 §17 的範例矩陣；帳號、公司與初始化的部分由負責人裁定改寫，[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）。

## 範圍

**包含**：

- 凍結：
  - `User` 的業務欄位（帳號名稱、基本欄位、聯絡與補充欄位）、系統欄位 `is_admin`、`is_system`，以及外部身分來源的預留欄位。
  - `Company`、`Role`、`ProjectMember` 的資料模型。
  - 這些實體的資料規則：字串欄位的長度上限與格式、帳號名稱的規則、可修改性、內建帳號的欄位與保護、最後一個 Admin、指派與收回他人的 Admin 權限、公司連結與工號、部門、地點的清空、公司名稱的唯一性、停用公司的限制與影響範圍、角色名稱的唯一性、權限代碼的登記表、角色的權限內容與刪除、有效權限的計算、角色影響範圍的計算、專案成員的角色下限與移出方式（沒有公司的人也能加入專案），以及哪些變更要寫稽核紀錄。
  - 建立內建 `admin` 的初始化指令，以及既有資料的回填規則。
  - 登入功能完成前，Service 層取得「目前操作者」的規則。
  - `Project` 的業務欄位：依 [OQ-01](../../intents/05-open-questions.md#oq-01)（已裁定）與 [KD-39](../../intents/03-decisions-and-stack.md#kd-39)，見 [`Project` 業務欄位](#project-business-fields)。
- 草稿（本次不凍結，不拆任務）：
  - `Inspection Template`、`Template Version`、`Template Item`、`Evidence Requirement`、`Inspection Plan`、`Inspection Task`、`Task Requirement Snapshot`、`Evidence`、`Evidence Variant`、`Result`、`Report` 等其餘實體：受開工門檻擋，尚未撰寫，見[其他實體](#draft-others)。

**不包含**（注明移到哪份規格，或屬於哪一條非目標）：

- UUID 主鍵、業務編號 `employee_no` 與 `project_code` 的定義與唯一性、`created_at`／`updated_at`／`created_by`／`updated_by` 的欄位與約束：由 `database-foundation` 定義（DBF-R11～DBF-R14），本規格只引用。兩個業務編號的長度上限例外，由本規格定義（`employee_no` 見 DOM-R28，`project_code` 見 DOM-R40），`database-foundation` 引用。
- 密碼與其雜湊（Argon2id）、登入流程（含以帳號名稱或 email 登入）、首次登入碼與首次設定流程、`admin` 密碼重設指令、伺服器端 Session 與 HttpOnly Cookie 的實作、「目前使用者」的辨識、API 權限檢查的執行方式（含後端預設拒絕、Admin 可存取所有專案、誰可以建立帳號與指派角色）：移至 `authentication`（登入機制與密碼雜湊已裁定，見 [OQ-13](../../intents/05-open-questions.md#oq-13)（已裁定）、[KD-30](../../intents/03-decisions-and-stack.md#kd-30)、[KD-31](../../intents/03-decisions-and-stack.md#kd-31)）。本規格只定義資料與規則，`authentication` 依此執行。
- 外部身分來源的串接與同步流程（比對、轉換、覆蓋基本欄位）：移至 `external-identity-sync`；本規格只預留欄位與約束（DOM-R08）。
- 修改前顯示影響範圍的畫面與確認流程（[PR-18](../../intents/02-principles.md#pr-18)）：屬 UI／API 行為，由提供這些操作的功能規格（例如 `admin-dashboard`）負責；本規格只提供計算影響範圍所需的資料（DOM-R23）。
- 稽核紀錄的資料模型（欄位、只能新增不能修改）與各事件的驗收：移至 `audit-log`（[#203](https://github.com/speko-tw/inspect-flow/issues/203) 撰寫；[DOM-Q6](#dom-q6) 裁定）。本規格只定義哪些變更要寫（DOM-R22）。
- 人員、公司、角色、專案成員的 API 端點與管理畫面：由之後的功能規格負責。基本的使用者與公司管理（簡便版：公司列表、新增、改名稱、停用，以及把使用者連結或解除公司）屬 0.2.x（API 見 [#263](https://github.com/speko-tw/inspect-flow/issues/263)、頁面見 [#265](https://github.com/speko-tw/inspect-flow/issues/265)）；進階功能（搜尋、分頁、批次等）仍屬 `admin-dashboard`（[#107](https://github.com/speko-tw/inspect-flow/issues/107)）。依據：負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）。
- 職稱、承包商歸屬：不列入人員欄位（[OQ-02](../../intents/05-open-questions.md#oq-02) 裁定，#63）。
- 替客戶公司成員指派可修改角色時的確認提示：已取消（[KD-28](../../intents/03-decisions-and-stack.md#kd-28) 已取消，公司不再有類型），見 DOM-R24。
- `Project` 的其他參與單位（承攬／送審等）：不列為建立 `Project` 的必填欄位，待上線後依需求調整（見 DOM-R43）。文件編號、查驗日期、送審版次、查驗結果與會簽等資訊：屬單次文件／查驗／報表層級資料，不放進 `Project`，由之後處理文件與報表的功能規格負責（[OQ-01](../../intents/05-open-questions.md#oq-01) 裁定，負責人，#71，2026-09-28）。工項分類與分區：依 [KD-40](../../intents/03-decisions-and-stack.md#kd-40) 屬另外的實體，皆依專案需求選用，不放進 `Project`，由後續規格定義。

## 使用情境

- 部署人員第一次安裝時執行初始化指令，指令不問任何公司或個人資料，只建立內建 `admin`，並印出首次登入碼；`admin` 用首次登入碼進網頁設定密碼，再新增第一個使用者。
- 登入功能完成前，工程師在 Service 層新增一筆 `Company`，`created_by`、`updated_by` 自動填內建 `admin`。
- Admin 把一位人員加入專案，並替他同時指派「現場查核」與「唯讀」兩個角色；他在這個專案的權限是兩個角色權限的加總。這位人員可以不屬於任何公司（例如獨立顧問），角色跟著人，不跟著公司。
- Admin 修改「現場查核」角色的權限內容前，系統先算出有多少人、多少筆專案成員持有這個角色，供畫面顯示影響範圍；修改後，所有持有者的權限立即改變。
- 一位外部來源匯入的人員想修改自己的手機號碼，可以改；Admin 想修改他的部門，會被拒絕，因為基本欄位以外部來源為準。
- 任何人想停用內建 `admin`，或收回它的 Admin 權限，會被拒絕；具 Admin 權限的人可以指派或收回其他人的 Admin 權限。
- Admin 把一位人員從 A 公司改到 B 公司，系統清空他的工號、部門與地點（B 公司的值另外填），並留下稽核紀錄；解除公司連結時同樣清空。沒有公司的人不能填這三個欄位。
- 新增使用者時要有帳號名稱與 email，登入時輸入其中一個都可以；帳號名稱只有具 Admin 權限的人能修改。
- Admin 停用一家已結束合作的公司，畫面先顯示「這家公司還有 3 位啟用中的人員」，並讓他勾選要一併停用哪些人；沒被勾選的人照常登入、照常參與專案，但之後新建人員或修改人員所屬公司時，已經不能選這家公司。

## 需求

用「必須／應／得」，每條附依據；來源只是建議的，不得寫成「必須」。欄位名稱是本規格建議的識別字（強度為「應」）；字串欄位的長度上限與格式見 DOM-R28～DOM-R31、DOM-R45、DOM-R49。已被取代的條目保留編號、標示「已被取代」並連到取代它的新條目與 [#259](https://github.com/speko-tw/inspect-flow/issues/259)，編號不重用；新條目從 DOM-R45（需求）、DOM-AC33（驗收）接續。「驗收」欄寫明在本規格驗收，或由哪份規格驗收。

### `User`（凍結）

| 編號 | 需求 | 強度 | 依據 | 驗收 |
|---|---|---|---|---|
| DOM-R01 | **已被取代**（由 DOM-R46 取代，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。原規定：`User` 必須具備公司、部門、地點、工號、英文姓名、中文姓名、email、`is_active`，且都不得為空值（`is_active` 預設 `true`）；改由 DOM-R46 依「公司可選、內建 admin 例外」重新定義。 | 已取代 | 原依據：[KD-16](../../intents/03-decisions-and-stack.md#kd-16)、[KD-23](../../intents/03-decisions-and-stack.md#kd-23)（人員屬於一個 `Company`）；[OQ-02](../../intents/05-open-questions.md#oq-02) 裁定；`is_active` 預設啟用為負責人裁定（[DOM-Q7](#dom-q7)，[#127](https://github.com/speko-tw/inspect-flow/issues/127)，2026-09-26）；取代依據：負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29） | 原驗收：DOM-AC01（已隨取代條文改寫） |
| DOM-R02 | `email` 是登入識別之一（另一個是帳號名稱，DOM-R45），有值時在所有 `User`（含已停用）之間**必須**唯一，由資料庫約束保證；`email` 只有內建 `admin` 得為空值（DOM-R50），空值不參與唯一比對。email 的比對與唯一性**必須**不分大小寫：`Anna.Deng@company.com` 與 `anna.deng@company.com` 是同一個 email，已有其中一個時，另一個新增會被擋下。`email` **必須**保留輸入的原樣存放，只在比對與唯一約束時轉成小寫；唯一約束的寫法（以小寫比對的唯一索引，或另存正規化欄位並加唯一約束）由實作任務選擇，並寫在計畫。其他以 email 找帳號的地方（`authentication` 的登入、`external-identity-sync` 的帳號對應）也**必須**不分大小寫 | 必須 | [KD-18](../../intents/03-decisions-and-stack.md#kd-18)（已被取代：登入帳號一律用 email，改為帳號名稱或 email，見 DOM-R45）、[KD-20](../../intents/03-decisions-and-stack.md#kd-20)（同步以 email 找本系統帳號）、[KD-21](../../intents/03-decisions-and-stack.md#kd-21)（停用後資料保留）；唯一（含已停用帳號）為負責人決定（[#70 留言](https://github.com/speko-tw/inspect-flow/issues/70#issuecomment-5844708436)，2026-09-26）；不分大小寫與原樣存放為負責人決定（[#122 裁定](https://github.com/speko-tw/inspect-flow/issues/122#issuecomment-5845418601)，2026-09-26；[DOM-Q2](#dom-q2)）；刪除「不另設帳號名稱欄位」並允許內建 `admin` 的 email 空值：負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29），[KD-45](../../intents/03-decisions-and-stack.md#kd-45)、[KD-44](../../intents/03-decisions-and-stack.md#kd-44) | DOM-AC02 |
| DOM-R03 | `User` **必須**具備聯絡與補充欄位：分機1 `extension_1`、分機2 `extension_2`、手機 `mobile`、Line ID `line_id`、WeChat `wechat_id`、負責事務 `responsibilities`；皆為選填（允許空值） | 必須；應（欄位名） | [KD-17](../../intents/03-decisions-and-stack.md#kd-17) | DOM-AC01 |
| DOM-R04 | 基本欄位（DOM-R46 列出的欄位，含帳號名稱、公司、部門、地點、工號、姓名、email）的可修改性依帳號來源決定：`auth_source = local` 的帳號，基本欄位只由 Admin 修改；`auth_source = external` 的帳號，Service 層**必須**拒絕任何人工修改基本欄位，只有外部身分同步流程得覆蓋。聯絡與補充欄位由本人與 Admin 修改，外部身分同步**不得**覆蓋。Service 層的修改入口**必須**區分「人工修改」與「同步」兩種來源；判斷操作者是不是 Admin 或本人，由 `authentication` 執行 | 必須 | [KD-16](../../intents/03-decisions-and-stack.md#kd-16)、[KD-17](../../intents/03-decisions-and-stack.md#kd-17)；外部帳號的公司也不能人工修改，見 [DOM-Q8](#dom-q8)（已裁定）；帳號名稱與公司連結以外部來源為準：負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29），[KD-45](../../intents/03-decisions-and-stack.md#kd-45)、[KD-46](../../intents/03-decisions-and-stack.md#kd-46) | DOM-AC04（外部帳號拒絕人工修改）；操作者身分由 `authentication` 驗收；同步不覆蓋由 `external-identity-sync` 驗收 |
| DOM-R05 | `User` **必須**具備系統欄位 `is_admin`（系統管理者）、`is_system`（內建帳號），皆為不可空值的布林值，未指定時為 `false`。系統管理者是 `User` 身上的開關，**不得**以 `Role` 或 `ProjectMember` 表示。內建帳號的欄位規則見 DOM-R50 | 必須 | [KD-19](../../intents/03-decisions-and-stack.md#kd-19)、[KD-24](../../intents/03-decisions-and-stack.md#kd-24) | DOM-AC01 |
| DOM-R06 | `is_system = true` 的帳號，Service 層**必須**拒絕將其停用（`is_active` 改為 `false`）或拿掉 Admin（`is_admin` 改為 `false`），資料不變；操作者是誰都一樣，包含具 Admin 權限的其他人與內建 `admin` 本人 | 必須 | [KD-19](../../intents/03-decisions-and-stack.md#kd-19)、[KD-44](../../intents/03-decisions-and-stack.md#kd-44)（原依據 [KD-22](../../intents/03-decisions-and-stack.md#kd-22) 已被取代）；「任何人都不能收回」：負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29） | DOM-AC05 |
| DOM-R07 | 一次修改若會讓「啟用中且 `is_admin = true`」的 `User` 數量變成 0，Service 層**必須**拒絕，資料不變。「拿掉 Admin」包含取消 `is_admin` 與停用帳號兩種情況。內建 `admin` 永遠是啟用中的 Admin（DOM-R06），所以資料庫裡有內建帳號時，這條規則不會被觸發；保留它作為防線，擋住沒有內建帳號的資料（例如測試資料）與日後規則變動 | 必須 | [KD-29](../../intents/03-decisions-and-stack.md#kd-29)；「停用也算拿掉」是本規格的判讀，理由：停用後不能登入（[KD-21](../../intents/03-decisions-and-stack.md#kd-21)），實際上就沒有人能行使 Admin | DOM-AC06 |
| DOM-R08 | `User` **必須**預留外部身分來源欄位：`auth_source`（只允許 `local`、`external`，不可空值，未指定時為 `local`）、`external_source`（文字，例如 `ldap`、`ad`、`entra`、`erp`）、`external_id`（文字）、`external_synced_at`（UTC 時間）；後三者允許空值。`auth_source = external` 時，`external_source`、`external_id` **必須**有值；`external_source` 與 `external_id` 的組合在有值時**必須**唯一。以上由資料庫約束保證 | 必須 | [KD-20](../../intents/03-decisions-and-stack.md#kd-20)（欄位；同步先以「來源＋`external_id`」找人，組合必須能唯一指到一個人） | DOM-AC03 |
| DOM-R09 | 本系統帳號轉為外部帳號時，**必須**原地更新同一筆 `User`，UUID 不變，不得刪除重建 | 必須 | [KD-20](../../intents/03-decisions-and-stack.md#kd-20) | 由 `external-identity-sync` 驗收 |
| DOM-R10 | 人員離職時以 `is_active = false` 停用，不刪除 `User`。被其他資料以 `created_by`、`updated_by` 引用的 `User` **必須**無法被刪除，由資料庫外鍵約束保證；停用後不能登入，由 `authentication` 執行 | 必須 | [KD-21](../../intents/03-decisions-and-stack.md#kd-21)；外鍵見 DBF-R14 | DOM-AC07（無法刪除）；不能登入由 `authentication` 驗收 |
| DOM-R28 | `User` 字串欄位的長度上限：`username` 32（最少 3 個字元，格式見 DOM-R45）、`email` 254、`employee_no` 16、`name_en` 128、`name_zh` 64、`department` 與 `location` 各 64、`extension_1`、`extension_2`、`mobile` 各 64、`line_id` 與 `wechat_id` 各 64、`responsibilities` 2000；超過上限的值**必須**被拒絕。`email` 只檢查基本格式：**必須**含 `@`，且**不得**含任何空白字元（例如空格、Tab、換行）。其餘欄位不限格式，例如分機得含地點文字（「新竹3875」）。長度的算法與檢查方式見 DOM-R31 | 必須 | [#121 裁定](https://github.com/speko-tw/inspect-flow/issues/121#issuecomment-5845332305)（負責人，2026-09-26；`username` 的長度：負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29））：上限不短於將來外部身分來源（AD、Entra ID）的上限，避免同步時截斷或寫入失敗（[KD-20](../../intents/03-decisions-and-stack.md#kd-20)）；`employee_no` 的定義與唯一性見 DBF-R12、DBF-R13 | DOM-AC19 |
| DOM-R45 | `User` **必須**具備帳號名稱 `username`：3～32 個字元，第一個字元是英文字母，其餘只能是英文字母、數字、`.`、`_`、`-`（不可中文、不可 `@`、不可空白）；`admin`、`system`、`root` 是保留字，只有內建 `admin` 能使用 `admin`，其餘帳號**不得**使用這三個字。輸入時接受任意大小寫，**必須**一律轉成小寫後存放與比對；在所有 `User`（含已停用）之間**必須**唯一，由資料庫約束保證。只有具 Admin 權限的人能修改帳號名稱；`auth_source = external` 的帳號以外部來源為準，Service 層**必須**拒絕人工修改，只有外部身分同步流程得覆蓋。帳號名稱的修改**必須**寫稽核紀錄（DOM-R22）。長度與格式的檢查方式見 DOM-R31 | 必須 | [KD-45](../../intents/03-decisions-and-stack.md#kd-45)；負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）：格式、保留字、小寫存放、修改權限與外部帳號以外部來源為準 | DOM-AC34（格式、保留字、唯一）；DOM-AC35（修改權限、外部帳號）；改名稽核由 `audit-log` 驗收 |
| DOM-R46 | `User` **必須**具備基本欄位：帳號名稱 `username`（DOM-R45）、email `email`、中文姓名 `name_zh`、英文姓名 `name_en`、公司 `company_id`（外鍵指向 `Company`）、部門 `department`、地點 `location`、工號 `employee_no`（定義見 DBF-R12，唯一性見 DBF-R13、DOM-R47）、啟用狀態 `is_active`。`username`、`is_active` 在資料庫層不可空值（NOT NULL）；`email`、`name_zh` 在資料庫層**允許**空值，另加 CHECK：`is_system = true`，或兩者都不為空值，所以一般帳號不得為空、內建帳號得為空；`name_en`、`company_id`、`department`、`location`、`employee_no` 允許空值，其中後三者只有在 `company_id` 有值時才能有值（DOM-R47）。內建帳號（`is_system = true`）是例外：`email` 允許空值，且公司、部門、地點、工號、中文姓名、英文姓名都必須為空值（DOM-R50）。NOT NULL 與上述 CHECK 由資料庫約束保證；其餘跨欄位的約束（沒有公司就不能填三個欄位、內建帳號公司與姓名為空）用資料庫 CHECK 或寫入前檢查，由計畫選擇，但**必須**涵蓋所有經 ORM model 的寫入（比照 DOM-R31）。`is_active` 未指定時為 `true`；建立時 `username`、`email`、`name_zh` 都**必須**由呼叫端提供（內建帳號除外） | 必須；應（欄位名） | [KD-46](../../intents/03-decisions-and-stack.md#kd-46)、[KD-45](../../intents/03-decisions-and-stack.md#kd-45)；`is_active` 預設啟用為負責人裁定（[DOM-Q7](#dom-q7)，[#127](https://github.com/speko-tw/inspect-flow/issues/127)，2026-09-26）；公司可選、英文姓名選填、工號與部門與地點跟著公司：負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）；跨欄位約束的寫法交計畫選擇是本規格的推導，理由同 DOM-R31 | DOM-AC33、DOM-AC40 |
| DOM-R47 | 人員最多連結一家公司，得沒有；`employee_no`、`department`、`location` 在 `company_id` 為空值時**必須**為空值。本系統帳號換公司或解除連結（`company_id` 改為空值）時，Service 層**必須**在同一次修改內清空這三個欄位，並寫稽核紀錄（DOM-R22）；同一次修改若明確提供新的值，則保留新值。`employee_no` 在同一家公司內**必須**唯一，不同公司得相同；沒有公司的人沒有工號，不受這條約束；由資料庫約束保證。外部帳號的公司與這三個欄位依 DOM-R04，不能人工修改 | 必須 | [KD-46](../../intents/03-decisions-and-stack.md#kd-46)；負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）：不一定屬於公司、連結前不能填、換公司或解除時清空並寫稽核、工號同公司內唯一；「同一次修改提供新值則保留」是本規格的判讀，已由負責人確認（見 [DOM-Q9](#dom-q9)） | DOM-AC38、DOM-AC39；清空的稽核由 `audit-log` 驗收 |

### 初始化指令與操作者（凍結）

| 編號 | 需求 | 強度 | 依據 | 驗收 |
|---|---|---|---|---|
| DOM-R11 | **已被取代**（由 DOM-R53 取代，[#259](https://github.com/speko-tw/inspect-flow/issues/259)；預建範本角色部分再由負責人裁定（#261，2026-09-29）取代）。原規定：初始化指令在同一個交易裡建立本公司（`kind = internal`）、內建 `admin`、負責人個人帳號與三個範本角色（權限為空集合），任何一步失敗整批不生效，初始化不寫稽核；改由 DOM-R53 定義（不再建立公司、個人帳號或範本角色）。 | 已取代 | 原依據：[KD-22](../../intents/03-decisions-and-stack.md#kd-22)、[KD-26](../../intents/03-decisions-and-stack.md#kd-26)；[#54](https://github.com/speko-tw/inspect-flow/issues/54) 兩則裁定（`created_by` 規則；認證前資料的操作者為 `admin`）；權限為空集合為負責人裁定（[DOM-Q4](#dom-q4)，[#124](https://github.com/speko-tw/inspect-flow/issues/124)，2026-09-27）；取代依據：負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)、#261，2026-09-29） | 原驗收：DOM-AC08（已被 DOM-AC43 與 #261 裁定取代） |
| DOM-R12 | **已被取代**（由 DOM-R53 取代，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。原規定：公司的代碼、名稱與兩個帳號的必填基本欄位必須在執行指令時輸入，repo 內不得寫入這些值或預設值；初始化指令不再詢問任何公司或個人資料，改由 DOM-R53 定義。 | 已取代 | 原依據：[KD-22](../../intents/03-decisions-and-stack.md#kd-22)（email 與姓名不寫進 repo）；負責人決定（[#70 留言](https://github.com/speko-tw/inspect-flow/issues/70#issuecomment-5844531219)，2026-09-26：詢問全部必填欄位與本公司）；取代依據：負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29） | 原驗收：DOM-AC08（已隨取代條文改寫） |
| DOM-R13 | 資料庫已有 `is_system = true` 的 `User` 時，初始化指令**必須**不重複建立內建 `admin`，也不寫入任何其他資料。`admin` 已設定密碼時，指令**必須**拒絕並回報系統已初始化；`admin` 尚未設定密碼時的處理（作廢舊首次登入碼、印出新碼）由 `authentication` 定義（AUT-R43） | 必須 | [KD-43](../../intents/03-decisions-and-stack.md#kd-43)、[KD-44](../../intents/03-decisions-and-stack.md#kd-44)（原依據 [KD-22](../../intents/03-decisions-and-stack.md#kd-22) 已被取代）；「不重複建立」是本規格的推導；已設定密碼即拒絕、未設定密碼時可重跑：負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29） | DOM-AC44；作廢舊碼與印新碼由 `authentication` 驗收 |
| DOM-R14 | Service 層**必須**從單一入口取得「目前操作者」，用來填 `created_by`、`updated_by`。`authentication` 完成前，這個入口一律回傳內建 `admin`（`is_system = true` 的 `User`）；完成後改由 `authentication` 回傳實際登入的人。首次設定流程（`admin` 還沒有密碼，只能以首次登入碼進入）建立的資料，操作者同樣記為內建 `admin`，`created_by`、`updated_by` 都指向它 | 必須 | [#54](https://github.com/speko-tw/inspect-flow/issues/54) 補充裁定（負責人，2026-09-26）；DBF-R14；首次設定流程的操作者為 負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29） | DOM-AC10、DOM-AC46 |
| DOM-R53 | 後端**必須**提供一個初始化指令（`make init` 呼叫它），在同一個交易裡只建立內建 `admin`（DOM-R50，`is_admin = true`、`is_system = true`、沒有公司、沒有密碼）。任何一步失敗時，整批都不生效；角色由 Admin 之後在系統內自行新增。指令**不得**詢問或建立任何公司與個人資料（不建立 `Company`，也不建立 `admin` 以外的 `User`），**不得**設定 `admin` 的密碼。首次登入碼的產生與印出、首次設定的網頁流程、`admin` 的重設指令，由 `authentication` 定義（AUT-R42～AUT-R47）。初始化不寫稽核紀錄（DOM-R22） | 必須 | [KD-43](../../intents/03-decisions-and-stack.md#kd-43)、[KD-44](../../intents/03-decisions-and-stack.md#kd-44)（取代 [KD-22](../../intents/03-decisions-and-stack.md#kd-22)）、[KD-26](../../intents/03-decisions-and-stack.md#kd-26)（全系統共用、自訂角色；負責人裁定（#261，2026-09-29）取消預建範本角色）；[#54](https://github.com/speko-tw/inspect-flow/issues/54) 兩則裁定（`created_by` 規則；認證前資料的操作者為 `admin`）；只建系統資料、不問任何資料、不設密碼：負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）；不預建角色：負責人裁定（#261，2026-09-29） | DOM-AC43 |
| DOM-R54 | 既有資料的 migration **必須**：為每個既有 `User` 回填 `username`——內建 `admin` 填 `admin`，其他人取 `email` 的 `@` 前段轉小寫，重複時加數字，使回填後的值在所有 `User` 之間唯一；內建 `admin` 的公司、姓名、部門、地點、工號清空（DOM-R50）；移除 `Company` 的 `code`、`tax_id`、`kind`、`parent_id`。`email` 前段不符 DOM-R45 格式（過短、非字母開頭、含不允許的字元、是保留字）時的處理，以及既有公司名稱重複時的處理，裁定沒有涵蓋，見 [DOM-Q9](#dom-q9) | 必須 | [KD-45](../../intents/03-decisions-and-stack.md#kd-45)；負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）：回填規則（內建 `admin` 填 `admin`、其他人取 email 前段轉小寫、重複加數字）；清空內建 `admin` 的欄位與移除公司欄位是為了符合 DOM-R48、DOM-R50 的推導 | DOM-AC45 |

### `Company`（凍結）

| 編號 | 需求 | 強度 | 依據 | 驗收 |
|---|---|---|---|---|
| DOM-R15 | `Company` **必須**沿用 `User`、`Project` 的共通結構：UUID 主鍵，以及 `created_at`、`updated_at`、`created_by`、`updated_by`（不可空值、外鍵指向 `User`）。`Role`、`ProjectMember` 同樣適用 | 必須 | [KD-07](../../intents/03-decisions-and-stack.md#kd-07)、[PR-08](../../intents/02-principles.md#pr-08)；做法同 DBF-R11、DBF-R14；[#54](https://github.com/speko-tw/inspect-flow/issues/54) 補充裁定（所有資料的 `created_by` 都有值） | DOM-AC36、DOM-AC14、DOM-AC18 |
| DOM-R16 | **已被取代**（由 DOM-R48 取代，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。原規定：`Company` 具備 `code`（唯一）、`name`、`tax_id`（有值時唯一）、`kind`（`internal`／`customer`）、`parent_id`、`is_active`；公司只保留名稱與啟用狀態，改由 DOM-R48 定義。 | 已取代 | 原依據：[KD-23](../../intents/03-decisions-and-stack.md#kd-23)；`is_active` 預設啟用為負責人裁定（[DOM-Q7](#dom-q7)，[#127](https://github.com/speko-tw/inspect-flow/issues/127)，2026-09-26）；取代依據：負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29） | 原驗收：DOM-AC11（已隨取代條文改寫） |
| DOM-R17 | **已被取代**（由 DOM-R48 取代，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。原規定：`parent_id` 不得指向自己，不檢查多層循環；公司不再有母公司，這條隨 `parent_id` 一併移除。 | 已取代 | 原依據：[KD-23](../../intents/03-decisions-and-stack.md#kd-23)；不做循環檢查為負責人決定（[#70 留言](https://github.com/speko-tw/inspect-flow/issues/70#issuecomment-5844742074)，2026-09-26）；取代依據：負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29） | 原驗收：DOM-AC12（已隨取代條文改寫） |
| DOM-R18 | 本系統帳號（`auth_source = local`）所屬的 `Company` 得隨時修改，也得解除（`company_id` 改為空值）；新公司須為啟用中，見 DOM-R32；換公司或解除時清空工號、部門、地點，見 DOM-R47 | 得 | [KD-23](../../intents/03-decisions-and-stack.md#kd-23)（已改寫）；公司改為可選、原「不受 `kind` 限制」隨 `kind` 移除：負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）；外部帳號依 DOM-R04 不能人工修改，見 [DOM-Q8](#dom-q8)（已裁定） | DOM-AC13 |
| DOM-R29 | **已被取代**（由 DOM-R48、DOM-R49 取代，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。原規定：`Company.code` 最多 32 字元且限英數字、`-`、`_`；`name` 最多 128 字元；`tax_id` 選填、有值時恰為 8 位數字；`code` 與 `tax_id` 已隨欄位移除，`name` 的長度改由 DOM-R49 定義。 | 已取代 | 原依據：[#121 裁定](https://github.com/speko-tw/inspect-flow/issues/121#issuecomment-5845332305)（負責人，2026-09-26）；[KD-23](../../intents/03-decisions-and-stack.md#kd-23)；取代依據：負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29） | 原驗收：DOM-AC20（已隨取代條文改寫） |
| DOM-R32 | `Company` 停用（`is_active = false`）只有一個效果：Service 層的 `User` 新增入口與人工修改入口，**必須**拒絕把 `company_id` 設為停用中的公司，資料不變。停用公司**不得**改變旗下 `User` 的任何資料（含 `is_active`、`company_id`），也不影響他們登入與參與專案；修改這些人員的其他欄位不受限制；沒有公司的人不受這條影響。人員能不能登入只看 `User.is_active`，不看所屬公司，由 `authentication` 執行（AUT-R05、AUT-R14 不檢查公司狀態）。外部身分同步把人員對應到停用中的公司時怎麼處理，由 `external-identity-sync` 決定 | 必須 | 負責人裁定（[DOM-Q7](#dom-q7) 選項 A，[#127](https://github.com/speko-tw/inspect-flow/issues/127)，2026-09-26；公司不再有類型，本條文字不依賴 `kind`，見 [DOM-Q9](#dom-q9)）；[KD-21](../../intents/03-decisions-and-stack.md#kd-21)（停用人員才不能登入） | DOM-AC22；登入不看公司狀態由 `authentication` 驗收 |
| DOM-R33 | Service 層**必須**能列出一個 `Company` 目前啟用中（`is_active = true`）的 `User` 與其人數，供停用公司前顯示「這家公司還有 N 位啟用中的人員」。提供停用公司操作的功能規格**必須**顯示這個人數，並提供一併停用的選擇，由操作者決定實際停用哪些人；選中的人員逐一經 `User` 的停用入口處理，仍受 DOM-R06、DOM-R07 保護。沒有被選中的人員維持啟用 | 必須 | [PR-18](../../intents/02-principles.md#pr-18)；負責人裁定（[DOM-Q7](#dom-q7)，[#127](https://github.com/speko-tw/inspect-flow/issues/127)，2026-09-26：顯示啟用中人數、一併停用由操作者決定） | DOM-AC23（人數、名單與停用公司不連動）；顯示與一併停用的流程由功能規格驗收 |
| DOM-R48 | `Company` **必須**只具備業務欄位 `name`（不可空值）與 `is_active`（不可空值的布林值，未指定時為 `true`），加上共通結構（DOM-R15）；以上由資料庫約束保證。`Company` **不得**有代碼（`code`）、統一編號（`tax_id`）、公司類型（`kind`）與母公司（`parent_id`）；有獨立營業登記的分公司、子公司各自是獨立的 `Company`，彼此沒有階層。停用公司的效果見 DOM-R32、DOM-R33 | 必須；不得（代碼、統一編號、類型、母公司） | [KD-23](../../intents/03-decisions-and-stack.md#kd-23)（已改寫）；`is_active` 預設啟用為負責人裁定（[DOM-Q7](#dom-q7)，[#127](https://github.com/speko-tw/inspect-flow/issues/127)，2026-09-26）；只留名稱與啟用狀態：負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29） | DOM-AC36 |
| DOM-R49 | `Company.name` 最多 128 個字元，不限格式；存放前**必須**去除前後空白，去除後不得為空字串。名稱在所有 `Company`（含已停用）之間**必須**唯一，比對不分大小寫：已有 `Demo Co` 時，新增或改名為 `demo co` 會被擋下。`name` **必須**保留輸入的原樣（去除前後空白之後）存放，只在比對與唯一約束時轉成小寫；寫法比照 DOM-R34，由計畫選擇。長度的算法與檢查方式見 DOM-R31 | 必須 | 負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）：名稱去前後空白、不分大小寫比對、含已停用公司；長度上限 128 沿用原 DOM-R29 | DOM-AC36、DOM-AC37 |

### `Role`（凍結）

| 編號 | 需求 | 強度 | 依據 | 驗收 |
|---|---|---|---|---|
| DOM-R19 | `Role` 是全系統共用的一份清單，不分專案；**必須**具備名稱 `name`（不可空值），以及權限內容：一組權限代碼（文字，例如 `report.read`、`report.approve`）。同一個 `Role` 內的權限代碼**不得**重複，由資料庫約束保證。名稱的唯一性見 DOM-R34；名稱與權限代碼的長度及格式見 DOM-R30，可用的權限代碼見 DOM-R35 | 必須 | [KD-25](../../intents/03-decisions-and-stack.md#kd-25)、[KD-26](../../intents/03-decisions-and-stack.md#kd-26) | DOM-AC14 |
| DOM-R20 | 所有 `Role` 都得改名、修改權限內容與刪除；本規格不設不可修改的角色。修改權限內容或名稱時，**必須**更新該 `Role` 的 `updated_at`、`updated_by` | 得（修改、刪除）；必須（修改紀錄） | [KD-26](../../intents/03-decisions-and-stack.md#kd-26)；[PR-08](../../intents/02-principles.md#pr-08) | DOM-AC14 |
| DOM-R21 | 刪除一個 `Role` 時，**必須**同時移除所有 `ProjectMember` 對它的指派；這些 `ProjectMember` 本身與其他角色的指派不受影響 | 必須 | [KD-26](../../intents/03-decisions-and-stack.md#kd-26)（刪除角色立即影響所有持有者） | DOM-AC16 |
| DOM-R22 | 權限與角色的變更**必須**寫稽核紀錄，包括：角色的新增、修改、刪除，`ProjectMember` 的角色指派、把人移出專案（刪除 `ProjectMember`），以及 `User.is_admin` 的變更（Admin 的提升與取消屬權限變更，含具 Admin 權限的人指派、收回他人，DOM-R51）；另外，帳號名稱的修改（DOM-R45）與 `User` 的公司連結變更（換公司或解除連結，含因此清空的工號、部門與地點，DOM-R47）也**必須**寫。初始化指令建立的資料**不**寫稽核紀錄；首次設定流程的事件視為系統事件，操作者記為內建 `admin`（DOM-R14）。稽核紀錄的資料模型由 `audit-log` 規格定義（[#203](https://github.com/speko-tw/inspect-flow/issues/203)），每種變更對應的事件與內容見 [audit-log 事件目錄](../audit-log/spec.md#第一批事件) | 必須 | [KD-29](../../intents/03-decisions-and-stack.md#kd-29)；負責人裁定（[DOM-Q6](#dom-q6)，[#126](https://github.com/speko-tw/inspect-flow/issues/126)，2026-09-27：另開 `audit-log`、初始化不寫、`is_admin` 變更要寫）；移出專案要寫為負責人裁定（[DOM-Q5](#dom-q5)，[#125](https://github.com/speko-tw/inspect-flow/issues/125)，2026-09-27）；帳號名稱、公司連結與首次設定的稽核：負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29） | 由 `audit-log` 驗收 |
| DOM-R23 | Service 層**應**能算出一個 `Role` 的影響範圍：持有它的 `ProjectMember` 筆數，以及這些成員涉及的不重複 `User` 人數，供修改或刪除前顯示。畫面顯示與確認流程由提供該操作的功能規格負責 | 應 | [PR-18](../../intents/02-principles.md#pr-18)（影響範圍怎麼計算留給相關規格決定）、[KD-26](../../intents/03-decisions-and-stack.md#kd-26) | DOM-AC17；顯示與確認由功能規格驗收 |
| DOM-R24 | **已被取代**（已取消，沒有取代條目，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。原規定：替 `kind = customer` 的 `Company` 所屬人員指派「有修改能力」的角色時，功能規格必須顯示確認提示、但不阻擋，Service 層提供「有修改能力」的判斷（角色的權限代碼中只要有一個動作不是 `read` 就算）；公司不再有類型，這個提示與判斷一併取消，沒有取代條目。 | 已取代 | 原依據（已取消）：[KD-28](../../intents/03-decisions-and-stack.md#kd-28)；判斷規則為負責人裁定（[DOM-Q3](#dom-q3)，[#123](https://github.com/speko-tw/inspect-flow/issues/123)，2026-09-27）：規則簡單，寧可多提醒一次；讀取的動作一律寫成 `read` 為負責人裁定（[PR #205](https://github.com/speko-tw/inspect-flow/pull/205#issuecomment-5851837293)，2026-09-27），見 DOM-R35；取代依據：負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29） | 原驗收：DOM-AC26（判斷）；確認提示由提供指派操作的功能規格驗收（已隨取代條文改寫） |
| DOM-R30 | `Role.name` 最多 64 個字元，不限格式。權限代碼最多 64 個字元，格式**必須**是 `<資料>.<動作>`，與 `error.code` 的 dot-namespace 格式一致：符合 `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$`（與 API-AC09 相同），例如 `report.read`、`evidence_variant.approve`。不符的值**必須**被拒絕；長度的算法與檢查方式見 DOM-R31。可用的權限代碼見 DOM-R35 | 必須 | [#121 裁定](https://github.com/speko-tw/inspect-flow/issues/121#issuecomment-5845332305)（負責人，2026-09-26）；[KD-15](../../intents/03-decisions-and-stack.md#kd-15)、API-R07（格式）；[KD-25](../../intents/03-decisions-and-stack.md#kd-25)（命名規則待相關規格定案） | DOM-AC21 |
| DOM-R34 | `Role.name` 在所有 `Role` 之間**必須**唯一，由資料庫約束保證；比對與唯一性**必須**不分大小寫：已有 `Viewer` 時，新增或改名為 `viewer` 會被擋下。`name` **必須**保留輸入的原樣存放，只在比對與唯一約束時轉成小寫；寫法比照 DOM-R02 的 `email`，由計畫選擇；SQLite 只比對 ASCII 字母大小寫的差異已接受（[負責人裁定](https://github.com/speko-tw/inspect-flow/pull/205#issuecomment-5851795833)，見計畫風險段） | 必須 | 負責人裁定（[DOM-Q4](#dom-q4)，[#124](https://github.com/speko-tw/inspect-flow/issues/124)，2026-09-27）：名稱重複時指派畫面分辨不出來；規則與 `email` 一致（DOM-R02） | DOM-AC24 |
| DOM-R35 | 可用的權限代碼**必須**集中登記在程式內的一份登記表（做法比照 `ErrorCode`，API-R07），不存在資料表。`Role` 寫入未登記的權限代碼時**必須**拒絕、不寫入；比照 DOM-R31，檢查涵蓋所有經 ORM model 的寫入。登記表初始為空，由各功能規格登記自己用到的代碼。讀取動作的代碼**必須**寫成 `read`（例如 `report.read`），**不得**用 `view`、`get` 等同義字；之後登記新代碼都照這個規則 | 必須 | 負責人裁定（[DOM-Q3](#dom-q3)，[#123](https://github.com/speko-tw/inspect-flow/issues/123)，2026-09-27）：每個代碼都對應一段檢查程式，清單應和程式放在一起，存在資料表可能出現程式不認得的代碼；拒絕未登記代碼可擋住打錯字（例如 `reprot.read`）；清單先空著，每個代碼都要有規格依據；讀取一律寫 `read` 為負責人裁定（[PR #205](https://github.com/speko-tw/inspect-flow/pull/205#issuecomment-5851837293)，2026-09-27），「有修改能力」的判斷（原 DOM-R24）才能只看動作名稱；DOM-R24 已隨 [KD-28](../../intents/03-decisions-and-stack.md#kd-28) 取消（[#259](https://github.com/speko-tw/inspect-flow/issues/259)），這條命名規則不受影響，仍然有效 | DOM-AC25（拒絕未登記代碼）；`read` 命名由登記代碼的功能規格在審查時確認 |

### `ProjectMember`（凍結）

| 編號 | 需求 | 強度 | 依據 | 驗收 |
|---|---|---|---|---|
| DOM-R25 | `ProjectMember` 表示一個 `User` 參與一個 `Project`：**必須**具備 `project_id`（外鍵指向 `Project`）與 `user_id`（外鍵指向 `User`），皆不可空值；同一個 `Project` 與 `User` 的組合**必須**唯一。一筆 `ProjectMember` 得指派多個 `Role`，同一個 `Role` 在同一筆成員上**不得**重複指派。以上由資料庫約束保證。成員的角色下限與移出方式見 DOM-R36 | 必須；得（多個角色） | [KD-27](../../intents/03-decisions-and-stack.md#kd-27)；成員不依賴公司見 DOM-R52 | DOM-AC18 |
| DOM-R26 | 一個人在一個專案的有效權限，**必須**是他在該專案的 `ProjectMember` 上所有 `Role` 權限代碼的聯集，而且**必須**在使用時從 `Role` 目前的內容計算，不得把權限代碼複製到 `ProjectMember`，修改角色才會立即影響所有持有者。不是該專案成員的人，以及沒有任何角色的成員，有效權限為空集合 | 必須 | [KD-26](../../intents/03-decisions-and-stack.md#kd-26)、[KD-27](../../intents/03-decisions-and-stack.md#kd-27)；空集合對應 [KD-29](../../intents/03-decisions-and-stack.md#kd-29) 預設拒絕 | DOM-AC15 |
| DOM-R27 | Admin 查看、修改所有專案的權力來自 `is_admin`，不需要、也不透過 `ProjectMember`；授權檢查怎麼合併 `is_admin` 與有效權限，由 `authentication` 執行 | 必須 | [KD-24](../../intents/03-decisions-and-stack.md#kd-24) | 由 `authentication` 驗收 |
| DOM-R36 | 一筆 `ProjectMember` 得沒有任何 `Role`。把人移出專案時**必須**刪除該筆 `ProjectMember`，不保留「已移除」的紀錄；它的角色指派**必須**一併刪除，由資料庫外鍵的連帶刪除保證。其他成員的指派與 `Role` 本身不受影響；成員在專案中建立的其他資料不因移出而改變 | 得（沒有角色）；必須（刪除方式） | 負責人裁定（[DOM-Q5](#dom-q5)，[#125](https://github.com/speko-tw/inspect-flow/issues/125)，2026-09-27）；[KD-21](../../intents/03-decisions-and-stack.md#kd-21) 只規範人員停用；移出專案的稽核紀錄見 DOM-R22 | DOM-AC27 |
| DOM-R50 | 內建 `admin`（`is_system = true`）代表系統本身：`username` 固定為 `admin`；**不得**屬於任何公司，`company_id`、`department`、`location`、`employee_no`、`name_zh`、`name_en` 都**必須**為空值；`email` 選填；`is_admin` 永遠為 `true`；`created_by`、`updated_by` 指向自己；不可停用，任何人（含它自己）都不得收回它的 Admin 權限（DOM-R06）。系統自動觸發、沒有實際操作者的事件，操作者記為內建 `admin`（DOM-R14）。初始化指令不重複建立（DOM-R13） | 必須 | [KD-44](../../intents/03-decisions-and-stack.md#kd-44)；負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）：不屬公司、沒有部門與地點與工號與姓名、帳號名稱固定 `admin`、email 選填；`is_admin` 永遠為 `true` 由「不可收回」推得 | DOM-AC40、DOM-AC05 |
| DOM-R51 | 具備 Admin 權限（`is_admin = true`）的人，Service 層**必須**允許他指派或收回**其他人**的 Admin 權限；內建 `admin` 的 Admin 權限不能被任何人收回（DOM-R06）。收回仍受 DOM-R07 保護。指派與收回都**必須**寫稽核紀錄（DOM-R22）。判斷操作者是不是 Admin，由 `authentication` 執行 | 必須 | [KD-24](../../intents/03-decisions-and-stack.md#kd-24)（已補充）；負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）：Admin 可指派、收回他人的 Admin 權限，內建 `admin` 除外；本人收回自己的 Admin 權限，裁定沒有說明，見 [DOM-Q9](#dom-q9) | DOM-AC41；操作者身分由 `authentication` 驗收 |
| DOM-R52 | 專案成員只依 `user_id` 關聯人員，**不得**要求人員有所屬公司：沒有公司的人（獨立或外部人員）也**必須**能加入專案、被指派角色。專案角色跟著人，不跟著公司：人員換公司、解除連結或所屬公司被停用，都**不得**改變他的 `ProjectMember` 與角色指派 | 必須 | [KD-46](../../intents/03-decisions-and-stack.md#kd-46)；負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）：沒有公司的人也可加入專案，專案角色跟著人 | DOM-AC42 |

### 字串長度與格式的檢查方式（凍結）

| 編號 | 需求 | 強度 | 依據 | 驗收 |
|---|---|---|---|---|
| DOM-R31 | DOM-R28～DOM-R30、DOM-R45、DOM-R49 的長度以字元數計，不是位元組數。長度上限**必須**寫進資料庫欄位型別（例如 `VARCHAR(n)`），PostgreSQL 因此會直接拒絕超長的值。SQLite 不強制 `VARCHAR` 長度，兩種資料庫的格式比對語法也不同，所以後端**必須**在寫入資料庫前檢查長度與格式，不符時拒絕、不寫入；這個檢查**必須**涵蓋所有經 ORM model 的寫入（含初始化指令與 migration 回填），不只 Service 層。本規格不要求以資料庫 CHECK 約束檢查長度或格式 | 必須 | [DOM-Q1](#dom-q1) 原文（SQLite 不強制 `VARCHAR` 長度，之後再加上限要新的 migration）；[PR-03](../../intents/02-principles.md#pr-03)（SQLite 與 PostgreSQL 結果一致，不依賴資料庫專屬功能）；「寫入前檢查、涵蓋所有 ORM 寫入」是本規格的推導，理由：建表任務沒有 Service 層，而直接用 ORM 寫入可以繞過 Service 層，只在 Service 層檢查會讓 SQLite 上的超長值寫得進去 | DOM-AC19、DOM-AC21、DOM-AC34、DOM-AC37 |

<a id="project-business-fields"></a>
### `Project` 業務欄位（凍結）

本段依 [OQ-01](../../intents/05-open-questions.md#oq-01)（已裁定，[#71 留言](https://github.com/speko-tw/inspect-flow/issues/71#issuecomment-5870105643)、[#71 補充](https://github.com/speko-tw/inspect-flow/issues/71#issuecomment-5872016815)，2026-09-28）與 [KD-39](../../intents/03-decisions-and-stack.md#kd-39) 由草稿轉為正式並納入凍結範圍。UUID 主鍵、`project_code` 與建立及修改紀錄已由 DBF-R11～DBF-R14 凍結；`project_code` **得**與其他 `Project` 重複，見 DBF-R13。

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| DOM-R40 | `Project` **必須**具備必填業務欄位：`project_code`（專案編號／代號，定義見 DBF-R12，得重複見 DBF-R13）、`name`（工程名稱）、`client_name`（業主／委託單位）、`site_location`（整體工程地點）。以上欄位**不得**為空值，由資料庫約束保證，建立時**必須**由呼叫端提供 | 必須 | [KD-39](../../intents/03-decisions-and-stack.md#kd-39)（依據：架構基準 §12.2、§38 Project）；「業主／委託單位」是介面建議用語，公共工程等契約文件的正式稱謂於報表規格另行調整（負責人決定，[#71 留言](https://github.com/speko-tw/inspect-flow/issues/71#issuecomment-5870105643)，2026-09-28） |
| DOM-R41 | `Project` **得**具備選填業務欄位：`planned_start_date`（預計開工日）、`planned_completion_date`（預計完工日），皆允許空值 | 得 | [KD-39](../../intents/03-decisions-and-stack.md#kd-39) |
| DOM-R42 | `project_code` 與既有 `Project` 重複時**不得**阻擋建立或儲存，由 DBF-R13 的資料庫規則保證。Service 層**必須**提供依 `project_code` 查出既有 `Project` 的介面，供新建或修改 `Project` 時判斷是否重複並提示警告；警告畫面與提示時機由使用這個介面的功能規格負責 | 必須 | [KD-39](../../intents/03-decisions-and-stack.md#kd-39)；重複時提示警告但不阻擋為負責人補充裁定（[#71 留言](https://github.com/speko-tw/inspect-flow/issues/71#issuecomment-5872016815)，2026-09-28） |
| DOM-R43 | `Project` 建立後**必須**直接可用，供內業建立查核工項，**不要求**額外的啟用步驟；本規格**不**為 `Project` 定義啟用、停用或狀態欄位。其他參與單位（承攬／送審等）**不**列為建立 `Project` 的必填欄位，待上線後依需求調整 | 必須（直接可用）；不（本規格不設狀態欄位、不要求其他參與單位為必填） | [KD-39](../../intents/03-decisions-and-stack.md#kd-39) |
| DOM-R44 | `Project` 字串欄位的長度上限：`project_code` 32（沿用 DOM-Q1 的暫定值，[#121](https://github.com/speko-tw/inspect-flow/issues/121#issuecomment-5845332305)，**待確認**）、`name` 128、`client_name` 128、`site_location` 256；超過上限的值**必須**被拒絕。`name`、`client_name`、`site_location` 不限格式；長度的算法與檢查方式見 DOM-R31 | 必須 | `project_code` 依 [DOM-Q1](#dom-q1)（[#121](https://github.com/speko-tw/inspect-flow/issues/121)）暫定、待確認；`name`、`client_name`、`site_location` 是本規格依 DOM-R28（`User`）、DOM-R29（`Company`）的既有長度慣例推導的暫定值，intents 未定，見 PR 說明 |

<a id="draft-others"></a>
### 其他實體（草稿）

`Inspection Template`、`Template Version`、`Template Item`、`Evidence Requirement`、`Inspection Plan`、`Inspection Task`、`Task Requirement Snapshot`、`Evidence`、`Evidence Variant`、`Result`、`Report` 受[開工門檻](../../intents/05-open-questions.md#gate)（G-01～G-07、OQ-06）擋，本次不撰寫。門檻逐一裁定後，依[部分凍結](../README.md#partial-freeze)規則擴大凍結範圍，需求編號從 DOM-R55 起接續。

## 資料

本規格定義下列實體的完整欄位；共通結構（UUID 主鍵、業務編號、建立與修改紀錄）由 `database-foundation` 定義，這裡只引用。

| 實體 | 共通結構（`database-foundation`） | 本規格定義 | 狀態 |
|---|---|---|---|
| `User` | UUID 主鍵、`employee_no`（同一家公司內唯一，DBF-R13）、`created_at`、`updated_at`、`created_by`、`updated_by`（DBF-R11～DBF-R14） | 帳號名稱、基本欄位、聯絡與補充欄位、`is_admin`、`is_system`、外部身分預留欄位（DOM-R02～DOM-R10、DOM-R45～DOM-R47、DOM-R50、DOM-R51；DOM-R01 已被取代）；字串欄位的長度與格式，含 `employee_no` 的長度（DOM-R28）；認證欄位歸 `authentication` | 凍結 |
| `Company` | 沿用同一套共通結構（DOM-R15） | `name`、`is_active`（DOM-R48、DOM-R49）；公司連結的規則（DOM-R18）；DOM-R16、DOM-R17、DOM-R29 已被取代 | 凍結 |
| `Role` | 沿用同一套共通結構（DOM-R15） | `name`、權限代碼集合（DOM-R19～DOM-R24）；名稱與權限代碼的長度及格式（DOM-R30）；名稱不分大小寫唯一（DOM-R34）；權限代碼須已登記（DOM-R35） | 凍結 |
| `ProjectMember` | 沿用同一套共通結構（DOM-R15） | `project_id`、`user_id`、角色指派（DOM-R25～DOM-R27） | 凍結 |
| `Project` | UUID 主鍵、`project_code`（得重複，DBF-R13）、建立與修改紀錄（DBF-R11～DBF-R14） | 必填業務欄位、選填業務欄位、重複查詢介面、字串長度（`project_code` 暫定 32、待確認）（DOM-R40～DOM-R44） | 凍結 |
| 其他實體 | — | 見[其他實體](#draft-others) | 草稿 |

關聯：`Company` 1—多 `User`（每位 `User` 至多連結一家，得沒有）；公司之間沒有階層；`User` 1—多 `ProjectMember`；`Project` 1—多 `ProjectMember`；`ProjectMember` 多—多 `Role`（見 [01-overview 實體關係](../../intents/01-overview.md#人員公司與權限的實體關係)）。內建 `admin` 不屬於任何公司（DOM-R50），`Company.created_by` 指向 `admin`，所以原本「`User.company_id` 與 `Company.created_by` 互相引用、必須在同一個交易建立」的限制不再成立（原 DOM-R11 已被取代）。

**門檻比對**（依[部分凍結](../README.md#partial-freeze)規則 1，含其中的「例外：只用 ID 引用」）：逐條比對[開工門檻](../../intents/05-open-questions.md#gate)的 G-01～G-07、OQ-06 的「為什麼要先決定」、選項原文與門檻摘要，搜尋人員、使用者、管理者、核可者、角色、權限、公司、成員、客戶、帳號、專案等字面。

| 實體 | 比對過的議題 | 字面命中 | 結論 | 理由 |
|---|---|---|---|---|
| `User` | G-01～G-07、OQ-06 | G-01 立場 B「由**管理者**輸入的參數」；G-03「**使用者**何時看到編輯結果」；G-04「Variant 核可紀錄、**核可者**」 | 無關，凍結 | G-01 的「管理者」指輸入 `Inspection Plan` 參數的人，議題只在問 interval 放在哪一張表，不涉及 `User` 欄位。G-03 的「使用者」是泛稱，談的是編輯與上傳的時序。G-04 的「核可者」是記錄「是哪個人」，若日後要記錄，是在 Variant 或核可紀錄那一側加指向 `User` 的 UUID 外鍵，`User` 自己的欄位、狀態與規則都不會改變，適用規則 1 的「只用 ID 引用」例外。G-01、G-03 是泛稱，連 ID 引用都不是 |
| `Company` | G-01～G-07、OQ-06 | 無 | 無關，凍結 | 門檻內沒有任何議題提到公司、客戶或組織 |
| `Role` | G-01～G-07、OQ-06 | 無直接命中；G-04「核可者、核可流程」可能延伸到「誰有權核可」 | 無關，凍結 | G-04 若裁定「由具備某權限的人核可」，只會多一個權限代碼（例如 `evidence_variant.approve`），那是 `Role` 權限內容裡的一筆資料，不改變 `Role` 的欄位或約束（[KD-25](../../intents/03-decisions-and-stack.md#kd-25)：系統存的是權限代碼，不是寫死的功能表） |
| `ProjectMember` | G-01～G-07、OQ-06 | G-02 立場 A 的範例路徑 `photos/<project_id>/...` | 無關，凍結 | 路徑裡的是 `Project` 的 UUID，不是 `ProjectMember`，本身就不算命中 `ProjectMember`；`ProjectMember` 只以 UUID 外鍵引用 `Project`、`User`，不依賴 `Project` 的業務欄位 |
| `Project`（業務欄位） | G-01～G-07、OQ-06 | G-02 立場 A 的範例路徑（同 `database-foundation` 的比對） | 無關，凍結 | 路徑只以 UUID 引用 `Project`，適用規則 1 的「只用 ID 引用」例外，結論同 `database-foundation`；門檻外的 [OQ-01](../../intents/05-open-questions.md#oq-01) 已裁定（負責人，#71，2026-09-28），因此擴大凍結範圍，不再維持草稿 |

`User` 的命中屬於規則 1 的「只用 ID 引用」例外（不影響 `User` 本身），或只是泛稱。`Role` 不適用這個例外，判為無關的理由是：G-04 沒有點名角色；依 [KD-25](../../intents/03-decisions-and-stack.md#kd-25)、[KD-26](../../intents/03-decisions-and-stack.md#kd-26)，「誰能核可」只能表示成一個權限代碼，由有權限的人勾選進任何角色，是 `Role` 權限內容裡的資料，不改變 `Role` 的欄位、狀態或規則。G-04 的選項原文也只談 Variant 的核可紀錄、核可者與狀態欄位，沒有要求固定或不可刪除的角色；若要那樣做，會牴觸 KD-26「角色全部可自訂」，屬意圖變更，不是 G-04 的裁定範圍。

## 介面

本規格不新增 API 端點。對開發者的介面如下；具體模組、函式與指令名稱由計畫決定，不屬於本規格的契約。

| 介面 | 內容 | 對應需求 |
|---|---|---|
| 指令 | 初始化指令：不詢問任何資料，建立內建 `admin`，並交由 `authentication` 印出首次登入碼；已初始化時不重複建立 | DOM-R13、DOM-R53 |
| 程式介面 | 取得「目前操作者」的單一入口 | DOM-R14 |
| 程式介面 | `User` 修改入口（區分人工修改與同步；內建帳號與最後一個 Admin 的保護；帳號名稱修改；換公司或解除連結時清空欄位；指派與收回他人的 Admin 權限） | DOM-R04、DOM-R06、DOM-R07、DOM-R45、DOM-R47、DOM-R51 |
| 程式介面 | `User` 新增入口（拒絕停用中的公司；帳號名稱、公司連結的檢查） | DOM-R32、DOM-R45～DOM-R47 |
| 程式介面 | `Company` 新增與修改入口（填建立與修改紀錄；名稱去空白與不分大小寫唯一）；列出公司啟用中的人員與人數 | DOM-R14、DOM-R33、DOM-R49 |
| 程式介面 | `Role` 新增、修改與刪除；`ProjectMember` 的角色指派與移除、移出專案；角色影響範圍、有效權限計算 | DOM-R20～DOM-R23、DOM-R26、DOM-R36、DOM-R52 |
| 程式碼 | 權限代碼登記表（初始為空） | DOM-R35 |
| 程式介面 | `Project` 新增、修改入口；依 `project_code` 查出既有 `Project` 的介面（供重複警告） | DOM-R40、DOM-R42 |

### 管理介面錯誤

管理 `User` 與 `Company` 的 API 使用共用錯誤 envelope。下列錯誤碼由 API 登記表提供；重複資料回 HTTP 409，其餘業務規則拒絕回 HTTP 422。

- `user.builtin_protected` — HTTP 422：嘗試透過一般管理操作修改內建 `admin` 的受保護欄位、公司連結或狀態。
- `user.last_admin` — HTTP 422：停用或移除最後一位啟用中的 Admin。
- `user.external_managed` — HTTP 422：人工修改外部帳號由外部來源管理的基本欄位。
- `company.inactive` — HTTP 422：新增帳號或變更公司連結時指定已停用公司。
- `user.username_conflict` — HTTP 409：新增或修改帳號名稱時，名稱已被其他帳號使用（不分大小寫）。
- `user.email_conflict` — HTTP 409：新增或修改 email 時，email 已被其他帳號使用（不分大小寫）。
- `user.employee_no_conflict` — HTTP 409：指派或變更公司連結時，同一家公司已有相同工號。
- `company.name_conflict` — HTTP 409：新增或修改公司名稱時，名稱已被其他公司使用（不分大小寫）。

## 驗收條件

每條至少對應一個需求；皆以 `make check` 內的自動化測試驗證，資料庫由 `alembic upgrade head` 建立。已被取代的驗收條件保留編號並連到取代它的新條目；新條目從 DOM-AC33 接續。登記表初始為空，AC 用到的權限代碼（例如 `report.read`）由測試暫時登記（DOM-R35）。

### `User`

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| DOM-AC01 | **已被取代**（由 DOM-AC33 取代，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。原驗收：建立公司與作為操作者的 `User` 後，檢查 `User` 資料表；只提供必填基本欄位（含公司、部門、地點、工號、英文姓名）新增成功，缺任一必填欄位被拒絕。 | — | — | DOM-R01、DOM-R03、DOM-R05 |
| DOM-AC02 | 與 DOM-AC33 相同的前置資料（各筆 `User` 另給互不相同的帳號名稱、中文姓名），並已有一筆 `email = "a@example.com"` 的 `User`，並已停用 | 依序新增三筆 `User`：`email` 相同（`a@example.com`）；`email` 只差大小寫（`A@Example.COM`）；`email` 為 `Anna.Deng@Example.com`，新增後重新查詢讀回 | 前兩次都因唯一約束被資料庫拒絕，不分大小寫等於 `a@example.com` 的 `User` 仍只有一筆，`User` 總筆數與新增前相同；第三次成功，讀回的 `email` 逐字等於 `Anna.Deng@Example.com`（大小寫不變） | DOM-R02 |
| DOM-AC03 | 與 DOM-AC33 相同的前置資料，並已有一筆 `auth_source = local`、外部欄位皆為空值的 `User` | 另新增一筆同樣外部欄位皆為空值的 `local` 帳號；新增一筆 `auth_source = external` 且 `external_source`、`external_id` 有值的帳號；再分別嘗試：`auth_source` 為 `local`、`external` 以外的值；`external` 但 `external_id` 為空值；`external` 但 `external_source` 為空值；`external_source` 與 `external_id` 都和前一筆相同的帳號 | 前兩次新增成功；後四次都被資料庫拒絕，筆數不變 | DOM-R08 |
| DOM-AC04 | 各屬於一家公司的一筆 `external` 帳號、一筆 `local` 帳號 | 透過 Service 層的人工修改入口，分別修改兩者的 `department` 與 `mobile` | `external` 帳號的 `department` 修改被拒絕、值不變，`mobile` 修改成功；`local` 帳號兩者都修改成功 | DOM-R04 |
| DOM-AC05 | 初始化後的資料庫（內建 `admin`），另由測試新增一位 Admin | 以那位 Admin 為操作者，透過 Service 層嘗試把 `admin` 的 `is_active` 改為 `false`，以及把 `is_admin` 改為 `false`；再以 `admin` 本人為操作者各試一次 | 四次都被拒絕，`admin` 的資料不變 | DOM-R06、DOM-R50 |
| DOM-AC06 | 一個只有一位啟用中 Admin（`is_system = false`）的測試資料庫（不含內建帳號；正式資料庫有內建 `admin`，不會觸發本規則，見 DOM-R07） | 透過 Service 層取消他的 `is_admin`，以及停用他；再新增第二位啟用中的 Admin 後，重做一次取消 `is_admin` | 前兩次都被拒絕、資料不變；有第二位 Admin 時修改成功 | DOM-R07 |
| DOM-AC07 | 一筆 `User`，被另一筆資料的 `created_by` 引用 | 刪除這筆 `User` | 被資料庫外鍵約束拒絕，資料不變 | DOM-R10 |
| DOM-AC19 | 與 DOM-AC33 相同的前置資料，另有一家 `Company`（供 `department`、`location`、`employee_no` 有值） | 用 inspector 檢查 `User` 資料表的字串欄位；以 ORM 新增一筆 DOM-R28 列出的欄位都恰為上限字元數的 `User`（`name_zh` 用中文字，`email` 符合格式）；再逐欄各新增一筆只有該欄比上限多 1 個字元的 `User`；再分別新增 `email` 不含 `@`、`email` 含空格、`email` 含 Tab 的 `User`；最後以 ORM 把恰為上限的那筆的 `name_en` 改為 129 個字元、`email` 改為不含 `@` 的值（各一次） | inspector 顯示每個欄位的字串長度等於 DOM-R28 的上限；恰為上限的那筆成功；其餘每一次新增都被拒絕，`User` 筆數不變；兩次修改都被拒絕，該筆資料不變 | DOM-R28、DOM-R31 |
| DOM-AC33 | 對空資料庫執行 `alembic upgrade head` 之後，由測試在同一個交易裡建立一筆作為操作者的內建帳號（`is_system = true`、`username = admin`，`created_by`、`updated_by` 以預先產生的 UUID 指向自己，沒有公司、email 與姓名），以及一家 `Company` | 用 SQLAlchemy inspector 檢查 `User` 資料表；以該帳號為操作者，新增一筆只提供 `username`、`email`、`name_zh` 的 `User`；再分別嘗試新增缺少 `username`、缺少 `email`、缺少 `name_zh` 的 `is_system = false` 的 `User`；最後新增一筆提供 `name_en`、`company_id`（指向那家公司）、`department`、`location`、`employee_no` 的 `User` | DOM-R46 列出的欄位都存在；欄位可空性：`username`、`is_active`、`is_admin`、`is_system`、`auth_source` 不可空值，`email`、`name_zh` 資料庫層可空值（另有 CHECK：`is_system = true`，或兩者都不為空值），`name_en`、`company_id`、`department`、`location`、`employee_no` 可空值；`company_id` 外鍵指向 `Company`；內建帳號（沒有 email 與姓名）建立成功；只提供必填欄位的那筆成功，`is_active` 為 `true`、`is_admin`、`is_system` 為 `false`、`auth_source` 為 `local`、公司與相關欄位為空值；缺 `username`、缺 `email`、缺 `name_zh` 的一般帳號每一次都被拒絕，筆數不變；有公司的那筆成功，讀回的欄位等於輸入值 | DOM-R46、DOM-R50、DOM-R03、DOM-R05 |
| DOM-AC34 | 與 DOM-AC33 相同的前置資料，並已有一筆 `username = "anna.deng"` 的 `User`，並已停用 | 依序新增：`username` 恰為 3 個字元與恰為 32 個字元（以英文字母開頭）的 `User`；再分別嘗試新增 2 個字元、33 個字元、以數字開頭、含中文、含 `@`、含空白、含 `+` 的 `username`；`username` 為 `Admin`、`SYSTEM`、`root` 的非內建 `User`；`username` 為 `ANNA.DENG` 的 `User`；最後新增 `username` 為 `Bob.Lee_2-x` 的 `User`，重新查詢讀回，再把它改為 `a` | 兩筆邊界值成功；其餘各次新增都被拒絕（含與已停用帳號只差大小寫的 `ANNA.DENG`），`User` 筆數不變；`Bob.Lee_2-x` 成功，讀回的 `username` 逐字等於 `bob.lee_2-x`（存成小寫）；改為 `a` 被拒絕，資料不變 | DOM-R45、DOM-R31 |
| DOM-AC35 | 本系統帳號 U（`local`）、外部帳號 X（`external`）；具 Admin 權限的操作者 A；不具 Admin 權限的操作者 B（U 本人） | 透過 Service 層：以 A 把 U 的 `username` 改為 `new.name`；以 B 把 U 的 `username` 改為 `other.name`；以 A 人工修改 X 的 `username` | 第一次成功，讀回 `new.name`；第二次被拒絕，值不變；第三次被拒絕，值不變（外部身分同步覆蓋帳號名稱由 `external-identity-sync` 驗收；操作者是不是 Admin 由 `authentication` 判斷，本條以傳入的身分驗證） | DOM-R45、DOM-R04 |
| DOM-AC38 | 啟用中的公司 A、B；`local` 帳號 U 屬於 A，`department`、`location`、`employee_no` 都有值；沒有公司的 `local` 帳號 V | 依序：以 ORM 與 Service 層各試一次為 V 寫入 `department`；透過 Service 層把 U 的 `company_id` 改為 B；為 U 重新填入三個欄位後，把 U 的 `company_id` 改為空值；再以同一次修改把 U 的 `company_id` 改為 A 並同時提供新的 `department` | 第一步兩次都被拒絕，V 的資料不變；第二步成功，U 的 `department`、`location`、`employee_no` 都為空值，並產生公司連結變更的稽核紀錄（事件內容由 `audit-log` 驗收）；第三步成功，`company_id` 為空值、三個欄位為空值；第四步成功，`department` 為新提供的值，`location`、`employee_no` 為空值 | DOM-R18、DOM-R46、DOM-R47 |
| DOM-AC39 | 公司 A、B；A 已有一筆 `employee_no = "E001"` 的 `User`；沒有公司的兩筆 `User` | 依序：在 A 新增一筆 `employee_no = "E001"` 的 `User`；在 B 新增一筆 `employee_no = "E001"` 的 `User`；新增兩筆沒有公司、沒有工號的 `User`（若上一步的兩筆不足以驗證，再各新增一筆）；把 B 的那筆改到 A，並同時提供 `employee_no = "E001"` | 第一次被資料庫拒絕，筆數不變；第二次成功；沒有公司、沒有工號的多筆都成功；最後一次被拒絕，資料不變 | DOM-R47、DBF-R13 |
| DOM-AC40 | 與 DOM-AC33 相同的前置資料 | 分別嘗試：把內建 `admin` 的 `company_id` 設為那家公司；為內建 `admin` 填入 `name_zh`；把內建 `admin` 的 `username` 改為 `root`；新增 `is_system = false` 且 `username = "Admin"` 的 `User`；新增 `is_system = false` 但 `email` 為空值的 `User` | 每一次都被拒絕，`User` 資料不變；（內建 `admin` 沒有 email 與姓名，這在 DOM-AC33 已成功建立） | DOM-R46、DOM-R50、DOM-R45 |
| DOM-AC41 | 具 Admin 權限的操作者 A、一般帳號 U、內建 `admin` | 以 A 為操作者，透過 Service 層：把 U 的 `is_admin` 設為 `true`；再設為 `false`；把內建 `admin` 的 `is_admin` 設為 `false` | 前兩次成功，各產生一筆 `user.admin_changed` 稽核紀錄（內容由 `audit-log` 驗收）；第三次被拒絕，資料不變；操作者是不是 Admin 由 `authentication` 驗收 | DOM-R51、DOM-R06 |

### 初始化指令與操作者

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| DOM-AC08 | **已被取代**（由 DOM-AC43 取代，[#259](https://github.com/speko-tw/inspect-flow/issues/259)；預建範本角色部分再由負責人裁定（#261，2026-09-29）取代）。原驗收：執行初始化指令並提供輸入值，建立一筆內部公司、兩筆 `User`（`admin` 與個人帳號）、三筆範本角色；第二個帳號寫入失敗或 `email` 不含 `@` 時整批不生效。 | — | — | DOM-R11、DOM-R12、DOM-R31 |
| DOM-AC09 | **已被取代**（由 DOM-AC44 取代，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。原驗收：已初始化的資料庫以另一組輸入再執行一次，回報已初始化，`Company`、`User`、`Role` 不變。 | — | — | DOM-R13 |
| DOM-AC10 | 初始化後的資料庫，尚未有 `authentication` | 透過 Service 層新增一筆 `Company`，之後修改它 | 新增後 `created_by`、`updated_by` 都等於 `admin` 的 UUID；修改後 `updated_by` 仍為 `admin` | DOM-R14 |
| DOM-AC43 | 對空資料庫執行 `alembic upgrade head` 之後 | 執行初始化指令（不提供任何輸入）；另在一個新的空資料庫，讓產生首次登入碼時拋出錯誤（測試用替身）後執行一次 | 第一次：指令沒有詢問任何輸入；恰有一筆 `User`、零筆 `Company`、零筆 `Role`；那筆 `User` 是內建 `admin`：`username = admin`、`is_admin`、`is_system`、沒有公司、沒有姓名、沒有密碼，`created_by`、`updated_by` 指向自己；沒有任何稽核紀錄。第二次：指令回報失敗，資料庫沒有任何 `User`、`Role` 或 `SetupCode`。首次登入碼的產生與印出由 `authentication` 驗收 | DOM-R53、DOM-R50、DOM-R31 |
| DOM-AC44 | 兩個已執行過一次初始化指令的資料庫：甲的 `admin` 尚未設定密碼，乙的 `admin` 已設定密碼 | 各再執行一次初始化指令 | 兩個資料庫的 `User`、`Company`、`Role` 筆數與內容都不變（不重複建立內建 `admin`，也不建立角色）；乙的指令回報已初始化並拒絕；甲的指令不重複建立資料，作廢舊首次登入碼與印出新碼由 `authentication` 驗收 | DOM-R13 |
| DOM-AC45 | 停在本次變更前一版的舊結構資料庫：內建 `admin`（有公司與姓名）、幾家有 `code`、`tax_id`、`kind`、`parent_id` 的公司、三位 `User`，`email` 依序為 `Anna.Deng@x.example`、`anna.deng@y.example`、`bob@x.example` | 執行 `alembic upgrade head` | 內建 `admin` 的 `username` 為 `admin`，公司與姓名相關欄位為空值；三位人員的 `username` 為 `anna.deng`、`anna.deng` 加數字的唯一值、`bob`，都符合 DOM-R45；`Company` 資料表沒有 `code`、`tax_id`、`kind`、`parent_id`，公司的 `name` 與 `is_active` 保留 | DOM-R54 |
| DOM-AC46 | 初始化後的資料庫，`admin` 尚未設定密碼，測試以首次登入碼進入首次設定流程 | 流程新增第一個使用者 | 該使用者的 `created_by`、`updated_by` 都等於內建 `admin` 的 UUID | DOM-R14、DOM-R50 |

### `Company`

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| DOM-AC11 | **已被取代**（由 DOM-AC36 取代，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。原驗收：檢查 `Company` 資料表的 `code`、`tax_id`、`kind`、`parent_id` 與 `is_active` 約束：`code`、`tax_id` 重複被拒絕，`kind` 只允許兩種值，`parent_id` 必須指向存在的公司。 | — | — | DOM-R15、DOM-R16 |
| DOM-AC12 | **已被取代**（由 DOM-AC36 取代，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。原驗收：把公司的 `parent_id` 設為自己被資料庫拒絕，設為另一家公司成功；公司不再有 `parent_id`，這條隨欄位移除。 | — | — | DOM-R17 |
| DOM-AC13 | **已被取代**（由 DOM-AC38 取代，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。原驗收：屬於客戶公司的 `local` 帳號改到內部公司，修改成功；公司不再有類型，改由 DOM-AC38 驗收換公司與解除連結。 | — | — | DOM-R18 |
| DOM-AC20 | **已被取代**（由 DOM-AC37 取代，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。原驗收：`Company` 的 `code`（32 字元、限英數字與 `-`、`_`）、`name`（128 字元）、`tax_id`（8 位數字）的長度與格式邊界；`code`、`tax_id` 已移除，`name` 的長度邊界改由 DOM-AC37 驗收。 | — | — | DOM-R29、DOM-R31 |
| DOM-AC22 | 啟用中的公司 A、停用中的公司 B；`local` 帳號 U 屬於 A；`local` 帳號 V 屬於 B（B 啟用時建立，之後才停用），`is_active = true` | 透過 Service 層：新增一筆 `company_id` 為 B 的 `User`；把 U 的 `company_id` 改為 B；修改 V 的 `department` 與 `mobile`；把 V 的 `company_id` 改為 A | 前兩次都被拒絕，`User` 筆數與 U 的資料不變；V 的兩個欄位修改成功，`is_active` 仍為 `true`；V 改到 A 成功（V 的 `department` 依 DOM-R47 清空） | DOM-R18、DOM-R32、DOM-R47 |
| DOM-AC23 | 公司 C 有三筆 `User`：兩筆啟用中、一筆已停用；公司 D 沒有啟用中的人員 | 列出 C、D 啟用中的人員與人數；再透過 Service 層把 C 的 `is_active` 改為 `false` | C 為 2 人，名單恰為那兩筆啟用中的 `User`；D 為 0 人、名單為空；C 停用成功，三筆 `User` 的 `is_active` 與 `company_id` 都和停用前相同 | DOM-R32、DOM-R33 |
| DOM-AC36 | 對空資料庫執行 `alembic upgrade head` 之後，已有 `name = "Demo Co"` 的 `Company`，以及一家已停用、`name = "Old Co"` 的 `Company` | 用 inspector 檢查 `Company` 資料表；再分別新增：`name` 為 `Demo Co`；`name` 為 `DEMO CO`；`name` 為 ` Demo Co `（前後有空白）；`name` 為 `old co`；`name` 為空值；`name` 為只有空白的字串；`is_active` 為空值；`created_by` 為空值；最後新增未指定 `is_active`、`name` 為 `  New Co  ` 的公司，重新查詢讀回 | 資料表有 UUID 主鍵、`name`、`is_active` 與建立及修改紀錄欄位，沒有 `code`、`tax_id`、`kind`、`parent_id`；除最後一次外每一次都被拒絕，`Company` 筆數不變；最後一次成功，`is_active` 為 `true`，讀回的 `name` 逐字等於 `New Co`（去除前後空白，大小寫不變） | DOM-R15、DOM-R48、DOM-R49 |
| DOM-AC37 | 與 DOM-AC36 相同的前置資料 | 用 inspector 檢查 `Company.name` 的字串長度；以 ORM 新增 `name` 恰為 128 個字元（含中文字）的公司；再新增 `name` 為 129 個字元的公司；最後以 ORM 把恰為 128 個字元的那筆改名為 129 個字元 | inspector 顯示 `name` 的字串長度為 128；128 個字元的成功；129 個字元的被拒絕，`Company` 筆數不變；改名被拒絕，資料不變 | DOM-R49、DOM-R31 |

### `Role` 與 `ProjectMember`

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| DOM-AC14 | 對空資料庫執行 `alembic upgrade head` 之後，一個含 `report.read` 的 `Role` | 用 inspector 檢查 `Role` 資料表；在同一個 `Role` 再加一次 `report.read`；在另一個 `Role` 加 `report.read`；以可控時間在建立至少一秒後，透過 Service 層改名並加入 `report.approve` | 資料表有 UUID 主鍵與建立及修改紀錄欄位；同一角色重複的代碼被資料庫拒絕；另一角色加入成功；改名與新增代碼成功，`updated_at` 晚於修改前，`updated_by` 為目前操作者 | DOM-R15、DOM-R19、DOM-R20 |
| DOM-AC15 | 使用者 U 在專案 P 的 `ProjectMember` 上有角色 R1（`report.read`）與 R2（`report.approve`、`report.read`）；U 不是專案 Q 的成員；V 是 P 的成員但沒有任何角色 | 計算 U 在 P、Q 與 V 在 P 的有效權限；再把 R1 的權限內容改為 `evidence.read`，重新計算 U 在 P 的有效權限 | P 的第一次結果為 `{report.read, report.approve}`；Q 為空集合；同在 P、沒有任何角色的成員 V 為空集合；R1 修改後，P 的結果為 `{evidence.read, report.read, report.approve}`，且 `ProjectMember` 上沒有權限代碼的副本 | DOM-R26 |
| DOM-AC16 | 兩筆 `ProjectMember` 都持有角色 R1，其中一筆另持有 R2 | 透過 Service 層刪除 R1 | R1 不存在；兩筆 `ProjectMember` 仍存在；沒有任何指派指向 R1；持有 R2 的那筆仍持有 R2 | DOM-R21 |
| DOM-AC17 | 角色 R 被三筆 `ProjectMember` 持有，分屬兩個 `User`（其中一人在兩個專案都持有 R）；另一個角色沒有人持有 | 計算兩個角色的影響範圍 | R 為 3 筆成員、2 人；另一個角色為 0 筆、0 人 | DOM-R23 |
| DOM-AC18 | 對空資料庫執行 `alembic upgrade head` 之後，已有一筆 P、U 的 `ProjectMember` | 用 inspector 檢查 `ProjectMember` 與角色指派的資料表；再新增相同 P、U 的 `ProjectMember`；對同一筆成員重複指派同一個 `Role`；新增 `project_id` 或 `user_id` 指向不存在 UUID 的成員；對同一筆成員指派兩個不同的 `Role` | 資料表有 UUID 主鍵與建立及修改紀錄欄位；重複成員、重複指派、外鍵不存在都被資料庫拒絕，筆數不變；兩個不同的角色指派成功 | DOM-R15、DOM-R25 |
| DOM-AC21 | 對空資料庫執行 `alembic upgrade head` 之後，一個 `Role` | 用 inspector 檢查 `Role` 與權限代碼的資料表；以 ORM 分別：新增 `name` 恰為 64 個字元的 `Role`；新增 `name` 為 65 個字元的 `Role`；在該角色加入恰為 64 個字元且符合格式的權限代碼；加入 65 個字元的權限代碼；加入 `report`（沒有 `.`）、`Report.read`（大寫）、`report.read.all`（三段）、`1report.read`（數字開頭）；最後以 ORM 把恰為上限的那個 `Role` 的 `name` 改為 65 個字元、把恰為上限的權限代碼改為 `Report.read`（各一次） | inspector 顯示 `name` 與權限代碼欄位的字串長度都是 64；恰為上限的名稱與權限代碼成功；其餘每一次新增都被拒絕，`Role` 與權限代碼的筆數不變；兩次修改都被拒絕，資料不變 | DOM-R30、DOM-R31 |
| DOM-AC24 | 對空資料庫執行 `alembic upgrade head` 之後，已有 `name = "Viewer"` 的 `Role` | 依序新增三個 `Role`：`name` 相同（`Viewer`）；只差大小寫（`viewer`）；`Field Inspector`，新增後重新查詢讀回；再把 `Field Inspector` 改名為 `VIEWER` | 前兩次都被資料庫拒絕，`Role` 筆數不變；第三次成功，讀回的 `name` 逐字等於 `Field Inspector`；改名被拒絕，資料不變 | DOM-R34 |
| DOM-AC25 | 對空資料庫執行 `alembic upgrade head` 之後，一個 `Role`；測試暫時登記 `report.read`，`reprot.read` 未登記 | 以 ORM 在該角色加入 `report.read`；加入 `reprot.read`；再把 `report.read` 那筆改為 `reprot.read` | 第一次成功；第二次被拒絕，權限代碼筆數不變；修改被拒絕，資料不變 | DOM-R35 |
| DOM-AC26 | **已被取代**（已取消，沒有取代條目，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。原驗收：四個 `Role` 是否「有修改能力」的判斷（沒有代碼、只有 `report.read` 為否；含 `report.approve` 或 `evidence.delete` 為是）；判斷已隨 DOM-R24 取消。 | — | — | DOM-R24 |
| DOM-AC27 | 對空資料庫執行 `alembic upgrade head` 之後，專案 P 的兩筆 `ProjectMember`：M1 持有 R1、R2，M2 持有 R1；另一筆沒有任何角色的 M3 | 新增 M3；直接對資料表刪除 M1（不經 ORM 關聯） | M3 新增成功；M1 不存在，指向 M1 的指派為零；R1、R2 仍存在，M2 仍持有 R1 | DOM-R25、DOM-R36 |
| DOM-AC42 | 專案 P；沒有公司的 `local` 帳號 V；公司 A；角色 R1（`report.read`） | 新增 P、V 的 `ProjectMember` 並指派 R1；計算 V 在 P 的有效權限；把 V 的 `company_id` 改為 A；再解除連結；最後把 A 停用 | 新增與指派成功；有效權限為 `{report.read}`；換公司、解除連結、公司停用之後，`ProjectMember` 與角色指派都不變，有效權限仍為 `{report.read}` | DOM-R52、DOM-R26 |

### `Project`

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| DOM-AC28 | 對空資料庫執行 `alembic upgrade head` 之後 | 用 SQLAlchemy inspector 檢查 `Project` 資料表；新增一筆只提供 `project_code`、`name`、`client_name`、`site_location` 的 `Project`；再分別嘗試新增缺少其中任一欄位的 `Project` | `name`、`client_name`、`site_location` 欄位存在且不可空值；第一筆成功；缺欄位的每一次都被資料庫拒絕，`Project` 筆數不變 | DOM-R40 |
| DOM-AC29 | 與 DOM-AC28 相同的前置資料 | 新增一筆不提供 `planned_start_date`、`planned_completion_date` 的 `Project`；再新增一筆兩者皆有值的 `Project` | 兩次都成功；前者兩欄皆為空值，後者兩欄等於輸入值 | DOM-R41 |
| DOM-AC30 | 已有一筆 `project_code = "P001"` 的 `Project` | 新增第二筆 `project_code = "P001"` 的 `Project`；呼叫 Service 層依 `project_code` 查出既有 `Project` 的介面，查詢 `"P001"` | 新增成功，資料庫有兩筆 `project_code = "P001"` 的 `Project`，UUID 不同；查詢介面回傳這兩筆 `Project` | DOM-R42 |
| DOM-AC31 | 對空資料庫執行 `alembic upgrade head` 之後 | 用 inspector 檢查 `Project` 資料表的欄位清單；新增一筆 `Project` 後立即查詢它 | 欄位僅為 DBF-R11～DBF-R14 的共通結構加上 DOM-R40、DOM-R41 列出的業務欄位，沒有任何啟用、停用或狀態欄位；新增後立即查得到，不需要另外呼叫任何啟用或狀態變更動作 | DOM-R43 |
| DOM-AC32 | 與 DOM-AC28 相同的前置資料 | 用 inspector 檢查 `Project` 字串欄位的長度；以 ORM 新增一筆 `project_code`、`name`、`client_name`、`site_location` 皆恰為上限字元數的 `Project`；再逐欄各新增一筆只有該欄比上限多 1 個字元的 `Project`；最後以 ORM 把恰為上限的那筆的 `name` 改為 129 個字元 | inspector 顯示 `project_code`、`name`、`client_name`、`site_location` 的字串長度依序為 32、128、128、256；恰為上限的那筆成功；其餘每一次新增都被拒絕，`Project` 筆數不變；修改被拒絕，資料不變 | DOM-R44、DOM-R31 |

## 待釐清

撰寫中發現、本規格不自行拍板的問題。若負責人判定需要團隊裁定，另開 issue 移到 `05-open-questions.md`，並在此留連結。

<a id="dom-q1"></a>
- **DOM-Q1：字串欄位的長度上限與格式**（已裁定，[#121](https://github.com/speko-tw/inspect-flow/issues/121)）。#63 只定了欄位，沒有定長度（例如 `email`、`employee_no`、`Company.code`、`name_en`、`name_zh`、權限代碼）與格式（例如 `tax_id` 是否限定 8 位數字、`email` 是否檢查格式）。SQLite 不強制 `VARCHAR` 長度，PostgreSQL 會；之後再加上限需要新的 migration。影響計畫 T1～T3。
  - **後續變更**：`Company.code`、`tax_id` 已隨欄位移除（DOM-R29 已被取代），`Company.name` 的上限改由 DOM-R49 定義，`User` 新增 `username`（DOM-R45、DOM-R28），見 [DOM-Q9](#dom-q9)。其餘裁定不變。
  - **裁定**（負責人，[#121](https://github.com/speko-tw/inspect-flow/issues/121#issuecomment-5845332305)，2026-09-26）：欄位上限不短於將來外部身分來源（AD、Entra ID）的上限，避免同步時截斷或寫入失敗；各欄位的上限與格式依裁定表。`email` 只檢查有 `@`、沒有空白；`Company.code` 限英數字、`-`、`_`；`tax_id` 選填，有填時必須是 8 位數字；權限代碼採 `<資料>.<動作>`，與錯誤碼的格式一致（[KD-15](../../intents/03-decisions-and-stack.md#kd-15)）。`project_code` 不在裁定表內，因為 `Project` 的業務欄位還在等 OQ-01；收緊長度時暫定 32，標為待確認。
  - **落地**：寫進 DOM-R28～DOM-R31、DOM-AC19～DOM-AC21；`project_code` 的暫定值寫在 DOM-R40（草稿），不是定案；`database-foundation` 的 DBF-R12 引用本規格的上限，不另外定義。#59 建立 `employee_no`、`project_code` 時沒有設長度，收緊由 [#140](https://github.com/speko-tw/inspect-flow/issues/140) 新增 migration 負責。權限代碼的格式一併定案，DOM-Q3 其餘部分仍待裁定。`external_source`、`external_id` 不在裁定表內，仍未定上限。
<a id="dom-q2"></a>
- **DOM-Q2：email 比對是否不分大小寫**（已裁定，[#122](https://github.com/speko-tw/inspect-flow/issues/122)）。DOM-R02 要求 email 唯一；`A@example.com` 與 `a@example.com` 算不算同一個人，會影響唯一約束的寫法（另存正規化欄位並加唯一約束，或以小寫比對的唯一索引），以及 `external-identity-sync` 以 email 比對時的結果。影響計畫 T2。
  - **裁定**（負責人，[#122](https://github.com/speko-tw/inspect-flow/issues/122#issuecomment-5845418601)，2026-09-26）：不分大小寫，唯一性也不分大小寫（含已停用帳號）；保留輸入的原樣存放，只在比對與唯一約束時轉成小寫，寫法由計畫 T2 選擇；登入與外部身分同步的比對同樣不分大小寫。已寫入 DOM-R02、DOM-AC02。
<a id="dom-q3"></a>
- **DOM-Q3：權限代碼的命名規則、可用清單與「有修改能力」的判斷**（已裁定，[#123](https://github.com/speko-tw/inspect-flow/issues/123)）。[KD-25](../../intents/03-decisions-and-stack.md#kd-25) 只給出 `report.read`、`report.approve` 的例子，並寫明命名規則待相關規格定案。權限代碼的格式與長度已由 [#121](https://github.com/speko-tw/inspect-flow/issues/121) 裁定（DOM-R30）。仍待定的有：可用的權限代碼清單放在哪裡（程式內的登記表或資料表），`Role` 能不能存清單以外的代碼；清單的初始範圍（目前還沒有任何功能規格登記代碼）；[KD-28](../../intents/03-decisions-and-stack.md#kd-28) 的「有修改能力」是否等於含 `create`、`update`、`delete` 或特殊動作任一者。原計畫 T6 建立範本角色的工作已由 #261 負責人裁定取消。
  - **裁定**（負責人，[#123](https://github.com/speko-tw/inspect-flow/issues/123)，2026-09-27）：清單放程式內的登記表（比照 `ErrorCode`）；`Role` 寫入清單外的代碼要拒絕；清單先空著，由各功能規格登記；角色含任何一個讀取以外的動作，就算有修改能力。
  - **理由**：代碼對應檢查程式，清單應和程式放一起；拒絕未登記代碼可擋打錯字；每個代碼都要有規格依據；判斷規則簡單，寧可多提醒一次。
  - **落地**：新增 DOM-R35、DOM-AC25（登記表、拒絕未登記代碼）；DOM-R24 寫明判斷規則並新增 DOM-AC26；DOM-R19、DOM-R30 改引用 DOM-R35、DOM-R24。
  - **後續變更**：「有修改能力」的判斷（DOM-R24、DOM-AC26）已取消，見 [DOM-Q9](#dom-q9)；登記表與拒絕未登記代碼（DOM-R35、DOM-AC25）不變。
<a id="dom-q4"></a>
- **DOM-Q4：範本角色的初始權限內容與角色名稱是否唯一**（已裁定，[#124](https://github.com/speko-tw/inspect-flow/issues/124)；範本角色部分已由 #261 負責人裁定取代）。原題問首次安裝預建角色的初始權限；負責人裁定（#261，2026-09-29）已取消預建三個範本角色，這部分不再適用。`Role.name` 唯一性仍適用於 Admin 建立的角色，因名稱重複時指派畫面會難以分辨。
  - **裁定**（負責人，[#124](https://github.com/speko-tw/inspect-flow/issues/124)，2026-09-27）：原裁定：範本角色的初始權限是空集合，由 Admin 在畫面上勾選；負責人裁定（#261，2026-09-29）已取消預建範本角色，該初始權限規則不再適用；`Role.name` 唯一、不分大小寫。
  - **理由**：原裁定考量目前沒有任何權限代碼（登記表先空著，由功能規格登記，DOM-R35），且預設拒絕最安全（[KD-29](../../intents/03-decisions-and-stack.md#kd-29)）；名稱重複時指派畫面分辨不出來。之後要不要替範本角色補預設權限，等功能規格登記權限代碼時再決定，用 migration 補上；此範本權限裁定已由 #261 取消預建角色而不再適用。
  - **落地**：原 DOM-R11、DOM-AC08 曾補上預建範本角色權限為空集合；負責人裁定（#261，2026-09-29）已取消預建角色，此部分不再適用。DOM-R34、DOM-AC24（名稱不分大小寫唯一）仍適用。
  - **後續變更**：DOM-R11、DOM-AC08 已被 DOM-R53、DOM-AC43 取代（初始化不再建立公司與個人帳號）；負責人裁定（#261，2026-09-29）另取消初始化預建範本角色，原空權限規則不再適用；`Role.name` 唯一仍適用於 Admin 建立的角色，見 [DOM-Q9](#dom-q9)。
<a id="dom-q5"></a>
- **DOM-Q5：專案成員的角色下限與移除方式**（已裁定，[#125](https://github.com/speko-tw/inspect-flow/issues/125)）。`ProjectMember` 得不得沒有任何角色（沒有角色時有效權限為空集合，依預設拒絕仍然安全）；把人移出專案時是刪除 `ProjectMember`，還是保留紀錄並標記移除（[KD-21](../../intents/03-decisions-and-stack.md#kd-21) 只規定人員停用時保留資料）。影響計畫 T3。
  - **裁定**（負責人，[#125](https://github.com/speko-tw/inspect-flow/issues/125)，2026-09-27）：成員可以沒有角色，有效權限為空集合；移出專案時直接刪除 `ProjectMember`，角色指派一併刪除，由稽核紀錄記錄誰、何時移出。
  - **理由**：預設拒絕，沒有角色也安全；刪除 `Role` 本來就會讓成員變成零個角色。保留並標記「已移除」的話，每個查詢都要記得排除，漏掉就是權限漏洞。KD-21 的保留資料講的是人員停用，不是移出專案；成員在專案留下的資料不受影響。
  - **落地**：新增 DOM-R36、DOM-AC27；DOM-R25 改引用 DOM-R36；DOM-R26、DOM-AC15 補上沒有角色的成員；DOM-R22 補上移出專案要寫稽核紀錄。
<a id="dom-q6"></a>
- **DOM-Q6：稽核紀錄的資料模型由哪份規格定義**（已裁定，[#126](https://github.com/speko-tw/inspect-flow/issues/126)）。[KD-20](../../intents/03-decisions-and-stack.md#kd-20)（外部值覆蓋基本欄位）與 [KD-29](../../intents/03-decisions-and-stack.md#kd-29)（權限與角色變更）都要求寫稽核紀錄，[04-glossary](../../intents/04-glossary.md)「稽核紀錄」只是概念，目前沒有規格定義它的欄位。可以放在本規格擴大凍結範圍，或另開規格。另外原題曾問初始化建立的帳號與範本角色是否要寫稽核紀錄；#261 裁定取消預建角色後，不再有該角色建立情境。`is_admin` 的變更是否算「權限變更」由本規格依字面視為是。DOM-R22 在此之前無法驗收，計畫 T6、T7 依賴本題裁定。
  - **裁定**（負責人，[#126](https://github.com/speko-tw/inspect-flow/issues/126)，2026-09-27）：另開 `audit-log` 規格（[#203](https://github.com/speko-tw/inspect-flow/issues/203)，`0.2.x`）；初始化指令不寫稽核紀錄；`is_admin` 的變更算權限變更，要寫。
  - **理由**：稽核紀錄是跨功能的共用機制（KD-29、[KD-20](../../intents/03-decisions-and-stack.md#kd-20)，以及之後的報告）；初始化是系統安裝不是權限變更，資料本身已記錄由 `admin` 建立與時間；Admin 是權限最大的身分，提升或取消是最重要的稽核事件。
  - **落地**：DOM-R22 寫明事件範圍與由 `audit-log` 定義資料模型、由 `audit-log` 驗收，並納入凍結範圍（理由見變更紀錄）；計畫 T6 不再依賴本題，T7 改依賴 `audit-log` 的實作任務。
<a id="dom-q7"></a>
- **DOM-Q7：`is_active` 的預設值，以及停用公司的影響**（已裁定，[#127](https://github.com/speko-tw/inspect-flow/issues/127)）。[KD-16](../../intents/03-decisions-and-stack.md#kd-16) 說啟用狀態不是必填，但沒說未提供時是啟用還是停用；`Company.is_active` 同樣沒有預設值。另外 `Company` 停用後，其人員能不能登入、能不能再被加入專案，#63 沒有寫。影響計畫 T1、T2。
  - **裁定**（負責人，[#127](https://github.com/speko-tw/inspect-flow/issues/127)，2026-09-26）：`User.is_active`、`Company.is_active` 未指定時都是啟用。公司停用不影響旗下人員（選項 A）：停用只代表新建或修改人員時不能再選這家公司；人員能不能登入只看自己的 `is_active`，`authentication` 不需要增加公司狀態的檢查。停用公司時依 [PR-18](../../intents/02-principles.md#pr-18) 顯示「這家公司還有 N 位啟用中的人員」，並提供一併停用的選擇，實際停用哪些人由操作者決定。
  - **落地**：預設值寫進 DOM-R01、DOM-R16、DOM-AC01、DOM-AC11；停用公司的效果與影響範圍寫進 DOM-R32、DOM-R33、DOM-AC22、DOM-AC23，DOM-R18 加上新公司須為啟用中的引用。
  - **後續變更**：預設值已改由 DOM-R46、DOM-R48、DOM-AC33、DOM-AC36 承接（原 DOM-R01、DOM-R16、DOM-AC01、DOM-AC11 已被取代），裁定內容不變，見 [DOM-Q9](#dom-q9)。
<a id="dom-q8"></a>
- **DOM-Q8：外部帳號能不能修改所屬公司**（已裁定，[#128](https://github.com/speko-tw/inspect-flow/issues/128)）。裁定前，[KD-23](../../intents/03-decisions-and-stack.md#kd-23) 寫人員所屬公司可以隨時修改，[KD-16](../../intents/03-decisions-and-stack.md#kd-16) 寫外部帳號的基本欄位（含公司）任何人都不能修改，兩者對外部帳號的說法相反；當時本規格只凍結本系統帳號的部分（DOM-R18），外部帳號依 DOM-R04 以 KD-16 為準，並等負責人裁定意圖層的衝突。
  - **裁定**（負責人，[#128](https://github.com/speko-tw/inspect-flow/issues/128)，2026-09-27）：外部帳號（`auth_source = external`）的所屬公司不能在系統內人工修改，以外部來源（AD／LDAP）為準，由外部身分同步更新；本系統帳號照 DOM-R18，可以隨時修改。
  - **理由**：外部來源是基本欄位的權威來源；在本地手動改的值，下次同步會被蓋掉，反而造成混亂。
  - **落地**：KD-23 補上「適用於本系統帳號；外部帳號依 KD-16」，[01-overview](../../intents/01-overview.md)、[04-glossary](../../intents/04-glossary.md) 的「公司可隨時修改」同步限定。規格行為不變：DOM-R04 本來就拒絕外部帳號人工修改基本欄位（含公司），只在 DOM-R04、DOM-R18 的依據欄改成引用本裁定。同步流程怎麼更新公司，留給延後的 `external-identity-sync`。
  - **後續變更**：公司改為可選，外部帳號的公司連結與工號、部門、地點仍以外部來源為準（DOM-R04、DOM-R47），見 [DOM-Q9](#dom-q9)。

<a id="dom-q9"></a>
- **DOM-Q9：帳號、公司與初始化模型重新設計**（已裁定，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。負責人驗收 [#210](https://github.com/speko-tw/inspect-flow/issues/210) 後重新設計初始化、內建 `admin` 與帳號模型，推翻本規格原有的必填公司、公司類型與階層、初始化指令詢問並建立兩個帳號等規則。本次是範圍變更，決策見 [KD-43](../../intents/03-decisions-and-stack.md#kd-43)～[KD-46](../../intents/03-decisions-and-stack.md#kd-46)。
  - **裁定**（負責人，[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）：初始化只建系統資料（內建 `admin`；負責人裁定 #261，2026-09-29：不預建角色）；內建 `admin` 代表系統，不屬公司、沒有姓名；`User` 新增必填的帳號名稱，帳號名稱與 email 都能登入；公司可選，工號、部門、地點跟著公司，換公司或解除連結時清空；工號在公司內唯一；具 Admin 權限者可指派、收回他人的 Admin 權限；沒有公司的人也可加入專案；`Company` 只留名稱與啟用狀態，名稱不重複；取消客戶公司的確認提示。
  - **理由**：見 [KD-43](../../intents/03-decisions-and-stack.md#kd-43)～[KD-46](../../intents/03-decisions-and-stack.md#kd-46)。
  - **落地**：新增 DOM-R45～DOM-R54、DOM-AC33～DOM-AC46；DOM-R01、DOM-R11、DOM-R12、DOM-R16、DOM-R17、DOM-R24、DOM-R29 與 DOM-AC01、DOM-AC08、DOM-AC09、DOM-AC11～DOM-AC13、DOM-AC20、DOM-AC26 已被取代；DOM-R02、DOM-R04、DOM-R05～DOM-R07、DOM-R13、DOM-R14、DOM-R18、DOM-R22、DOM-R28、DOM-R31～DOM-R33 就地改寫。
  - **裁定沒有說明、本規格先自行判讀的地方（已由負責人確認（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29））**：
    1. 換公司時，同一次修改若同時提供新的工號、部門或地點，保留新值、只清空沒提供的（DOM-R47、DOM-AC38）。
    2. 具 Admin 權限的人收回自己的 Admin 權限：本規格沒有另設限制，只受 DOM-R07 保護（DOM-R51）。
    3. migration 回填帳號名稱時，`email` 前段不符格式（過短、非字母開頭、含不允許的字元、是保留字）怎麼處理，以及既有公司名稱重複時怎麼處理，裁定沒有涵蓋；由 #260 的計畫提出做法並附驗證（DOM-R54）。
    4. 「有修改能力」的判斷（DOM-R24、DOM-AC26）本來只服務客戶公司提示，隨提示一併取消；`read` 命名規則（DOM-R35）沒有被裁定取消，保留。
    5. 內建 `admin` 的 `email` 選填，但仍受 DOM-R02 的唯一與不分大小寫規則（有值時）。

## 變更紀錄

凍結後的「範圍變更」以上才記；一行寫改了什麼與 issue 連結。

- DOM-R28～DOM-R31、DOM-AC19～DOM-AC21：依 DOM-Q1 裁定，新增 `User`、`Company`、`Role` 與權限代碼的字串長度上限及格式，並擴大凍結範圍；`project_code` 的長度暫定、待確認（DOM-R40，草稿） — [#121](https://github.com/speko-tw/inspect-flow/issues/121)
- DOM-Q7 裁定：DOM-R01、DOM-R16 補上 `is_active` 預設啟用；新增 DOM-R32（停用公司不能再被選用、不影響旗下人員）、DOM-R33（停用前列出啟用中人員與人數），以及 DOM-AC22、DOM-AC23；DOM-AC01、DOM-AC11 補上預設值的斷言 — [#127](https://github.com/speko-tw/inspect-flow/issues/127)
- DOM-R02、DOM-AC02：依 DOM-Q2 裁定，email 的比對與唯一性改為不分大小寫、保留原樣存放，並在驗收條件補上大小寫不同被擋下與原樣讀回的檢查 — [#122](https://github.com/speko-tw/inspect-flow/issues/122)
- DOM-Q8 裁定：外部帳號的公司不能人工修改，依 DOM-R04；KD-23 限定為本系統帳號，DOM-R04、DOM-R18 的依據改引用本裁定，需求與驗收條件不變 — [#128](https://github.com/speko-tw/inspect-flow/issues/128)
- DOM-Q4 裁定：DOM-R11、DOM-AC08 補上範本角色的權限為空集合；新增 DOM-R34、DOM-AC24（`Role.name` 不分大小寫唯一），DOM-R19 改引用 DOM-R34 — [#124](https://github.com/speko-tw/inspect-flow/issues/124)
- DOM-Q6 裁定：DOM-R22 補上 `is_admin` 變更、初始化不寫，資料模型與驗收移至 `audit-log`（[#203](https://github.com/speko-tw/inspect-flow/issues/203)）；DOM-R22 沒有待決議題、也與開工門檻無關，比照 DOM-R09 由其他規格驗收的做法納入凍結範圍 — [#126](https://github.com/speko-tw/inspect-flow/issues/126)
- DOM-Q3 裁定：新增 DOM-R35、DOM-AC25（權限代碼登記表，拒絕未登記代碼，初始為空）；DOM-R24 寫明「有修改能力」的判斷並新增 DOM-AC26；DOM-R19、DOM-R30 改引用新條文 — [#123](https://github.com/speko-tw/inspect-flow/issues/123)
- DOM-Q5 裁定：新增 DOM-R36、DOM-AC27（成員可沒有角色；移出專案即刪除成員，指派連帶刪除）；DOM-R26、DOM-AC15 補上沒有角色的成員；DOM-R22 補上移出專案；DOM-R25 改引用 DOM-R36 — [#125](https://github.com/speko-tw/inspect-flow/issues/125)
- DOM-R40～DOM-R44、DOM-AC28～DOM-AC32：依 [OQ-01](../../intents/05-open-questions.md#oq-01) 裁定與 [KD-39](../../intents/03-decisions-and-stack.md#kd-39)，`Project` 業務欄位由草稿轉為正式並納入凍結範圍：必填 `project_code`（得重複）、`name`（工程名稱）、`client_name`（業主／委託單位）、`site_location`（整體工程地點）；選填 `planned_start_date`、`planned_completion_date`；新增依 `project_code` 查重複的 Service 層介面供建立時警告；不設啟用或狀態欄位；`name`、`client_name`、`site_location` 的長度上限為本規格依既有慣例推導的暫定值 — [#246](https://github.com/speko-tw/inspect-flow/issues/246)
- DOM-Q9 裁定（範圍變更；含 [KD-16](../../intents/03-decisions-and-stack.md#kd-16)、[KD-18](../../intents/03-decisions-and-stack.md#kd-18)、[KD-22](../../intents/03-decisions-and-stack.md#kd-22)、[KD-28](../../intents/03-decisions-and-stack.md#kd-28) 的意圖變更）：新增 DOM-R45～DOM-R54、DOM-AC33～DOM-AC46（帳號名稱、`User` 基本欄位改寫、公司連結與工號的清空與同公司內唯一、`Company` 只留名稱與啟用狀態且名稱不重複、內建 `admin` 的欄位、Admin 指派與收回、沒有公司的人加入專案、初始化指令改寫為只建 admin、不預建角色（負責人裁定 #261，2026-09-29）、既有資料回填）；DOM-R01、DOM-R11、DOM-R12、DOM-R16、DOM-R17、DOM-R24、DOM-R29 與 DOM-AC01、DOM-AC08、DOM-AC09、DOM-AC11～DOM-AC13、DOM-AC20、DOM-AC26 標示為已被取代；DOM-R02、DOM-R04～DOM-R07、DOM-R13、DOM-R14、DOM-R18、DOM-R22、DOM-R28、DOM-R31～DOM-R33 與相關驗收就地改寫 — [#259](https://github.com/speko-tw/inspect-flow/issues/259)
- 規格澄清（審查修正）：DOM-R46 明定 `email`、`name_zh` 在資料庫層可空並加 CHECK（`is_system = true`，或兩者都不為空值）；DOM-AC33 改為分開驗證可空性與條件式約束，需求欄改指 DOM-R46、DOM-R50；帳號名稱欄位統一稱 `username` — [#259](https://github.com/speko-tw/inspect-flow/issues/259)
- 負責人裁定（#261，2026-09-29）：`make init` 不再建立三個範本角色，只建立內建 `admin`；同步改寫 DOM-R13、DOM-R53、DOM-AC43～DOM-AC44、DOM-Q4、KD-26 與 OQ-08 對應段，並更新初始化測試 — [#261](https://github.com/speko-tw/inspect-flow/issues/261)
- 規格澄清（審查修正）：補列帳號與公司管理 API 的錯誤碼、HTTP 狀態及觸發條件；四種重複資料回 409，其餘列出的業務規則拒絕回 422 — [#263](https://github.com/speko-tw/inspect-flow/issues/263)
