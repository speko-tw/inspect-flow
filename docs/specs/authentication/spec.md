# 認證與授權（authentication）

**代碼**：`AUT`　**Phase**：P2　**狀態**：已凍結
**前置規格**：`domain-model`（`User`、`Company`、`Role`、`ProjectMember`、初始化指令、目前操作者入口，見 DOM-R02～DOM-R27、DOM-R45～DOM-R54）、`database-foundation`（UUID 主鍵與建立及修改紀錄，見 DBF-R11、DBF-R14）、`api-conventions`（`/api/v1`、錯誤 envelope 與 `error.code`，見 API-R01～API-R07）
**引用意圖**：[PR-01](../../intents/02-principles.md#pr-01)、[PR-08](../../intents/02-principles.md#pr-08)、[PR-18](../../intents/02-principles.md#pr-18)、[KD-17](../../intents/03-decisions-and-stack.md#kd-17)、[KD-18](../../intents/03-decisions-and-stack.md#kd-18)（已被取代，見 KD-45）、[KD-20](../../intents/03-decisions-and-stack.md#kd-20)～[KD-31](../../intents/03-decisions-and-stack.md#kd-31)、[KD-43](../../intents/03-decisions-and-stack.md#kd-43)～[KD-46](../../intents/03-decisions-and-stack.md#kd-46)、[OQ-08](../../intents/05-open-questions.md#oq-08)（已裁定）、[OQ-13](../../intents/05-open-questions.md#oq-13)（已裁定）
**被擋議題**：無（登入機制與密碼雜湊見 [OQ-13](../../intents/05-open-questions.md#oq-13)，權限機制見 [OQ-08](../../intents/05-open-questions.md#oq-08)，皆已裁定）。個別數值與細節待本規格的[待釐清](#待釐清)與 `domain-model` 的裁定（DOM-Q2、DOM-Q3、DOM-Q6 皆已裁定，[#122](https://github.com/speko-tw/inspect-flow/issues/122)、[#123](https://github.com/speko-tw/inspect-flow/issues/123)、[#126](https://github.com/speko-tw/inspect-flow/issues/126)），只擋對應任務，不擋本規格

## 目的

人員用帳號名稱或 email 與密碼登入後，伺服器保存他的登入狀態；後端對每個請求預設拒絕，只放行已登入、而且有對應權限的人：Admin 可以查看、修改所有專案，其他人依他在該專案的角色權限加總。停用人員時，他既有的登入立即失效。系統剛安裝時內建 `admin` 還沒有密碼，由部署人員執行初始化指令取得一次性的首次登入碼，再在網頁上設定 `admin` 密碼、新增第一個使用者（依據：架構基準 §17；[KD-21](../../intents/03-decisions-and-stack.md#kd-21)、[KD-24](../../intents/03-decisions-and-stack.md#kd-24)～[KD-31](../../intents/03-decisions-and-stack.md#kd-31)，負責人決定 #63、#82，2026-09-26；帳號名稱登入與首次設定：[KD-45](../../intents/03-decisions-and-stack.md#kd-45)、[KD-43](../../intents/03-decisions-and-stack.md#kd-43)，負責人裁定 [#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）。

## 範圍

**包含**：

- 帳號名稱或 email＋密碼登入、登出、取得目前使用者的 API（[KD-45](../../intents/03-decisions-and-stack.md#kd-45)、[KD-30](../../intents/03-decisions-and-stack.md#kd-30)）。
- 伺服器端登入狀態（本規格稱 `AuthSession`）與 HttpOnly Cookie：產生、驗證、有效期限、登出、停用人員後立即失效（[KD-21](../../intents/03-decisions-and-stack.md#kd-21)、[KD-30](../../intents/03-decisions-and-stack.md#kd-30)）。
- 密碼以 Argon2id 雜湊與驗證，參數依 OWASP 建議值（[KD-31](../../intents/03-decisions-and-stack.md#kd-31)）。
- 權限檢查的執行方式：後端預設拒絕、`is_admin` 可查看、修改所有專案、依 `ProjectMember` 上角色的權限加總，以及系統管理操作與「本人或 Admin」的檢查（[KD-24](../../intents/03-decisions-and-stack.md#kd-24)～[KD-29](../../intents/03-decisions-and-stack.md#kd-29)；資料模型與有效權限的計算引用 DOM-R19～DOM-R27，不重複定義）。
- 登入後，`domain-model` 的「目前操作者」入口改回傳實際登入的人（DOM-R14；[#54](https://github.com/speko-tw/inspect-flow/issues/54) 補充裁定）。
- 首次設定與 `admin` 密碼重設（[KD-43](../../intents/03-decisions-and-stack.md#kd-43)；負責人裁定，[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）：初始化指令印出的一次性首次登入碼（產生、只存雜湊、24 小時有效、重跑作廢）、首次登入碼的失敗鎖定、首次設定的公開路由與網頁流程（輸入首次登入碼、設定 `admin` 密碼、新增第一個使用者）、新增使用者時的系統臨時密碼與「給予 admin 權限」勾選框，以及 `admin` 忘記密碼時的伺服器端重設指令。一般使用者的設定密碼指令移除（AUT-R24 已被取代）。
- 臨時密碼與首次登入強制變更：臨時密碼標記、標記未清除前只能變更密碼或登出、本人變更密碼的 API，以及供使用者管理 API（0.2.x）呼叫的「設定密碼（可標為臨時）」Service 入口（[AUT-Q4](#aut-q4) 裁定，[#146](https://github.com/speko-tw/inspect-flow/issues/146)）。
- 停用人員前計算他有幾個有效的登入狀態，供影響範圍顯示使用（[PR-18](../../intents/02-principles.md#pr-18)）。
- 前端登入頁（帳號名稱或 email）、未登入時導向登入頁、登出；首次設定頁；變更密碼頁，以及臨時密碼未變更時導向變更密碼頁。

**不包含**（注明移到哪份規格，或屬於哪一條非目標）：

- `User`、`Company`、`Role`、`ProjectMember` 的欄位與約束、有效權限與角色影響範圍的計算、初始化指令本身：由 `domain-model` 定義（DOM-R02～DOM-R27、DOM-R45～DOM-R54），本規格只引用；初始化指令建立哪些資料由 DOM-R53 定義，本規格只定義它印出的首次登入碼與其後的流程。
- 外部身分來源（LDAP、AD、Entra ID）的登入與同步，以及本系統帳號轉成外部帳號時既有登入狀態的處理：移至 `external-identity-sync`。本規格的設計不得阻礙日後串接（AUT-R20；[KD-20](../../intents/03-decisions-and-stack.md#kd-20)、[KD-30](../../intents/03-decisions-and-stack.md#kd-30) 的理由）。
- 人員與公司的簡易管理（新增、修改、停用、連結或解除連結公司）：屬 0.2.x，API 由 [#263](https://github.com/speko-tw/inspect-flow/issues/263)、畫面由 [#265](https://github.com/speko-tw/inspect-flow/issues/265) 提供（負責人裁定 [#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29），本規格只提供它們要呼叫的權限檢查、登入狀態筆數與設定密碼入口（AUT-R16、AUT-R19、AUT-R36、AUT-R46）。進階功能（搜尋、分頁、批次操作等）以及角色、專案成員的管理 API 與畫面、停用人員前顯示影響範圍的畫面與確認流程：由 `admin-dashboard`（[#107](https://github.com/speko-tw/inspect-flow/issues/107)）等功能規格負責。「替客戶公司成員指派可修改角色的確認提示」已隨客戶公司概念取消（KD-28、DOM-R24 已被取代）。
- 權限代碼的命名規則與可用清單：見 `domain-model` 的 DOM-R30、DOM-R35（[DOM-Q3](../domain-model/spec.md#dom-q3) 已裁定）。本規格的檢查元件以權限代碼字串為輸入，不登記任何代碼。
- 稽核紀錄：[KD-29](../../intents/03-decisions-and-stack.md#kd-29) 要求權限與角色的變更寫稽核紀錄，資料模型由 `audit-log` 定義（[DOM-Q6](../domain-model/spec.md#dom-q6) 裁定，[#203](https://github.com/speko-tw/inspect-flow/issues/203)）。本規格不新增權限或角色的寫入入口。設定或變更密碼、帳號被鎖寫稽核紀錄；登入成功、登入失敗、登出只寫應用程式日誌（AUT-R39、AUT-R40，[AUT-Q6](#aut-q6) 裁定）。
- Admin 在畫面上替他人設定臨時密碼與新增使用者的 API 與畫面：屬 0.2.x 的簡易使用者管理（API [#263](https://github.com/speko-tw/inspect-flow/issues/263)、畫面 [#265](https://github.com/speko-tw/inspect-flow/issues/265)；負責人裁定 [#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29），呼叫本規格的 Service 入口（AUT-R36）並標為臨時。原本「在那之前由部署人員以指令設定」的做法已被取代（AUT-R24），一般使用者的設定密碼指令移除。本規格只提供入口、系統臨時密碼與勾選框的規則（AUT-R46）和首次登入強制變更的機制（[AUT-Q4](#aut-q4) 裁定；[AUT-Q7](#aut-q7)）。
- 忘記密碼、以 email 寄送設定密碼的連結：需要寄信服務，目前沒有（[AUT-Q4](#aut-q4) 選項 C 未採用）。使用者忘記密碼時由 Admin 重設；`admin` 忘記密碼時只能由伺服器端的重設指令處理（AUT-R47）。
- 臨時密碼的有效期限（例如 72 小時內未變更就失效）：intents 與 [AUT-Q4](#aut-q4) 裁定都沒有依據，這次不做；臨時密碼外洩或過久未用時，由 Admin 重新設定。若要加上期限，屬範圍變更。
- 外部來源帳號（`auth_source = external`）的密碼：由 AD／LDAP 驗證，本系統不保存外部密碼，也不使用本地密碼；帳號轉成外部來源時要不要刪除既有的 `UserPassword`，由 `external-identity-sync` 決定（[AUT-Q4](#aut-q4) 裁定）。
- 多因素認證、Corporate SSO：架構基準 §35 延後的能力，不在 MVP。
- 常見或已外洩密碼的黑名單檢查：這次不做，等日後改用外部身分來源（LDAP／AD）登入時，由 `external-identity-sync` 一併評估。這低於 NIST SP 800-63B（第 4 版）§3.1.1.2 的要求，是負責人接受的取捨（[AUT-Q3](#aut-q3) 裁定，[#145](https://github.com/speko-tw/inspect-flow/issues/145)）。
- 部署時的 HTTPS 終止與反向代理設定：由 `pilot-deployment` 負責；本規格只要求 Cookie 帶 `Secure`（AUT-R06）。

## 使用情境

- 部署人員執行初始化指令，終端機印出一組首次登入碼（只顯示這一次）；負責人開啟網頁，輸入首次登入碼、設定 `admin` 的密碼，接著新增自己的個人帳號：系統產生臨時密碼，畫面顯示一次；他勾選「給予 admin 權限」後，以帳號名稱與臨時密碼登入，被帶到變更密碼頁。密碼不出現在指令列參數、環境變數或 repo 裡。
- 首次登入碼超過 24 小時才用，或有人亂猜輸錯 10 次被鎖 15 分鐘；部署人員在 `admin` 還沒有密碼時重跑初始化指令，舊碼作廢、印出新碼，就能繼續。`admin` 已設定密碼後，初始化指令拒絕再執行。
- 負責人開啟 Admin Web，因為尚未登入而被導向登入頁；輸入帳號名稱（或 email）與密碼後回到原本的頁面，畫面顯示他的姓名。
- 一位工程師輸錯密碼，畫面只顯示「帳號或密碼錯誤」，不透露這個帳號名稱或 email 是否存在、帳號是否已停用。
- 現場查核人員在專案 P 有「現場查核」與「唯讀」兩個角色，呼叫 P 的某個端點時，後端依兩個角色權限的聯集判斷是否放行；他對不是成員的專案 Q 呼叫同一個端點，被拒絕。
- Admin 對任何專案的端點都能讀取與修改，不必先加入該專案。
- Admin 準備停用一位離職人員，畫面先顯示「此人目前有 2 個登入中的裝置」；確認停用後，那位人員下一個請求就被要求重新登入。
- 使用者按下登出，伺服器刪除他的登入狀態；即使有人留著舊的 Cookie，也無法再用。
- Admin 在畫面上新增新進工程師，系統產生一組臨時密碼、只顯示一次，Admin 口頭交給他。工程師第一次登入後直接被帶到變更密碼頁；變更前，他打開任何其他頁面都會被帶回來。改好後回到原本要去的頁面，他在其他裝置上的登入狀態都失效。
- 負責人帳號無法使用時，部署人員以保管的密碼登入內建 `admin`（緊急備援帳號），處理完再回到個人帳號。`admin` 的密碼忘記時，部署人員在伺服器上執行 `make reset-admin-password`，互動輸入兩次新密碼；這次重設會留下稽核紀錄，`admin` 既有的登入狀態全部失效。

## 需求

用「必須／應／得」，每條附依據；來源只是建議的，不得寫成「必須」。識別字（資料表、欄位、路徑、錯誤碼、Cookie 名稱）是本規格建議的名稱，強度為「應」。OWASP 的建議值查詢日期為 2026-09-26，來源為 [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)、[Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)；以 OWASP 為依據的需求維持「應」，KD 明文要求的才是「必須」。

### 密碼

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| AUT-R01 | 密碼**必須**以 Argon2id 雜湊後儲存；**不得**儲存明文或可逆加密的密碼。每個雜湊**必須**使用各自隨機產生的 salt，雜湊值連同演算法、參數與 salt 以 PHC 字串格式（`$argon2id$v=19$m=…,t=…,p=…$…`）存放。參數**應**採 OWASP 列出、防護程度相同的其中一組完整配置（m／t／p 為 47104／1／1、19456／2／1、12288／3／1、9216／4／1、7168／5／1，單位 KiB），本規格建議 m = 19456 KiB（19 MiB）、t = 2、p = 1；實作時得依伺服器規格改選同一份清單中的另一組，並寫在計畫與程式的單一常數處 | 必須（Argon2id、不存明文、salt）；應（參數） | [KD-31](../../intents/03-decisions-and-stack.md#kd-31)；參數依 OWASP Password Storage Cheat Sheet（2026-09-26 查詢） |
| AUT-R02 | 登入時驗證成功、但雜湊的參數與目前設定不同時，**應**以目前參數重新雜湊並更新儲存值 | 應 | OWASP Password Storage Cheat Sheet「等使用者下次登入時重新雜湊」 |
| AUT-R03 | 密碼雜湊**必須**只存在本規格的 `UserPassword`（見[資料](#資料)），**不得**出現在任何 API 回應、錯誤訊息或應用程式日誌。請求中的明文密碼同樣**不得**寫入日誌 | 必須 | [KD-31](../../intents/03-decisions-and-stack.md#kd-31)（雜湊儲存的前提是雜湊與明文都不外流）；本規格推導 |
| AUT-R04 | 設定密碼時，長度**必須**介於 8～128 個字元（含兩端）才能設定，不符合時拒絕、資料不變；長度以 Unicode 字元（code point）計算，不以位元組計算。不要求大小寫、數字、符號等字元組成。不強制定期更換密碼，也不設密碼有效期限；只有在有證據顯示密碼外洩時才要求更換，更換方式是 Admin 重設（AUT-R36）、`admin` 的重設指令（AUT-R47）或本人變更密碼（AUT-R34）。本規格不檢查常見或已外洩的密碼（見[範圍](#範圍)的「不包含」）。最短 8 字元與不做黑名單都未達 NIST 對只用密碼登入的規定，是負責人接受的取捨，見 [AUT-Q3](#aut-q3) | 必須 | [AUT-Q3](#aut-q3) 裁定（負責人，[#145](https://github.com/speko-tw/inspect-flow/issues/145)，2026-09-26）；上限 128 用來防止超長輸入拖慢雜湊運算；以 code point 計算長度依 NIST SP 800-63B（第 4 版）§3.1.1.2 |

### 登入、登出與目前使用者

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| AUT-R05 | 後端**必須**提供以「帳號名稱或 email」與密碼登入的 API，請求本體為 `{"login","password"}`。`login` 含 `@` 時當 email 比對，不含 `@` 時當帳號名稱比對（帳號名稱不允許 `@`，DOM-R45，所以兩者不會混淆）。輸入與一筆 `auth_source = local`、`is_active = true`、已設定密碼的 `User` 相符，且密碼驗證成功時，建立一筆新的 `AuthSession`，以 Cookie 回傳，並在回應本體回傳目前使用者，欄位與取得目前使用者的 API 完全相同（AUT-R08），兩者共用同一個建構函式（同 AUT-R10）。email 與帳號名稱的比對**必須**都不分大小寫（DOM-R02、DOM-R45）；比對前去除前後空白。內建 `admin` 以帳號名稱 `admin` 登入（DOM-R50，它的 email 可為空） | 必須 | [KD-45](../../intents/03-decisions-and-stack.md#kd-45)（帳號名稱或 email 登入，取代 [KD-18](../../intents/03-decisions-and-stack.md#kd-18)）；[KD-44](../../intents/03-decisions-and-stack.md#kd-44)；負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）；`login` 欄位名稱與去除前後空白是本規格的判讀，見 [AUT-Q7](#aut-q7)；[KD-30](../../intents/03-decisions-and-stack.md#kd-30) |
| AUT-R06 | 以下情況登入**必須**失敗，而且**不得**建立 `AuthSession`：帳號名稱或 email 不存在、密碼錯誤、帳號已停用、帳號為 `auth_source = external`、帳號尚未設定密碼（含首次設定前的內建 `admin`）。這幾種失敗**應**回傳完全相同的狀態碼與回應本體（401、`auth.invalid_credentials`），不透露是哪一種；帳號不存在或沒有密碼時，**應**仍執行一次同樣成本的雜湊驗證，讓回應時間不因帳號是否存在而明顯不同 | 必須（失敗、不建立）；應（回應一致、時間一致） | [KD-21](../../intents/03-decisions-and-stack.md#kd-21)（停用不能登入）；帳號名稱登入依 [KD-45](../../intents/03-decisions-and-stack.md#kd-45)；[KD-20](../../intents/03-decisions-and-stack.md#kd-20)（外部帳號由外部來源驗證，本規格判讀）；回應一致依 OWASP Authentication Cheat Sheet |
| AUT-R07 | 後端**必須**提供登出 API：刪除這個請求所帶的 `AuthSession`，並要求瀏覽器清除 Cookie。請求沒有帶有效登入狀態時，登出**應**仍回傳成功，行為冪等 | 必須（刪除）；應（冪等） | [KD-30](../../intents/03-decisions-and-stack.md#kd-30)（伺服器保存登入狀態，登出就是刪除它）；冪等依 OWASP Session Management Cheat Sheet |
| AUT-R08 | 後端**必須**提供取得目前使用者的 API：已登入時回傳該 `User` 的 `id`、`username`（所有帳號都不可為 `null`）、`email` 與 `name_zh`（只有內建 `admin` 可為 `null`）、`name_en`（得為 `null`）、`is_admin`，以及 `must_change_password`（布林值，是否需要先變更臨時密碼，見 AUT-R33）；另回傳我的工作台用的公司資料：`company`（`{id, name}`，未連結公司時為 `null`）、`department`、`location`、`employee_no`（皆得為 `null`，與 DOM-R46 的連動規則一致）；未登入時回傳 401、`auth.not_authenticated`。登入 API（AUT-R05）的成功回應本體與這支 API 完全相同，也帶這四個公司欄位；另回傳三個存取摘要布林值，讓前端依實際權限決定落點與導覽，不得只靠 `is_admin` 猜：`has_office_access`（在任一專案有內業權限碼）、`has_field_access`（在任一專案有 `inspection_task.inspect`）、`has_template_access`（範本庫管理：具範本管理員系統角色；與範本寫入路由同一條規則，只有專案的 `project_inspection_item.edit` 不算，套用範本屬專案頁的功能）；Admin 三者皆為 `true`。內業權限碼是 `inspection_task.inspect` 與 `inspection_task.read` 以外的所有已註冊權限碼（專案成員、查核項目、分區、計畫、任務的管理）；單獨的 `inspection_task.read` 沿用 ADM-R18，視為現場側而非內業，也不算現場可用（現場任務清單需要 `inspection_task.inspect`），分類表在 `backend/app/services/access_summary.py`，新增權限碼時契約測試會要求同時歸類 | 必須 | [KD-24](../../intents/03-decisions-and-stack.md#kd-24)（前端需要知道是不是 Admin）；架構基準 §17 與[認證與授權卡片](../../intents/03-decisions-and-stack.md#stack-auth)（負責「登入、目前使用者與 API 權限檢查」）；`must_change_password` 依 [AUT-Q4](#aut-q4) 裁定（前端要知道是否導向變更密碼頁）；`username` 對所有帳號必填、不可為 `null`；只有內建 `admin` 的 `email` 與 `name_zh` 可為 `null`；`name_en` 對所有帳號選填，依 [KD-45](../../intents/03-decisions-and-stack.md#kd-45)、[KD-44](../../intents/03-decisions-and-stack.md#kd-44)；公司、部門、地點、工號依負責人指示（[#290](https://github.com/speko-tw/inspect-flow/issues/290)，我的工作台要顯示「我的公司」），登入回應與目前使用者 API 完全相同是依業界做法的審查裁定（第 1 輪，[#292](https://github.com/speko-tw/inspect-flow/pull/292)），避免前端兩個入口拿到的使用者資料不一致；三個存取摘要欄位依負責人指示（[#480](https://github.com/speko-tw/inspect-flow/issues/480#issuecomment-6013263124)，內業帳號登入後被導到 `/field` 而卡住），欄位與分類細節為規格設計（非負責人裁定） |
| AUT-R09 | 登入成功後，Service 層取得「目前操作者」的單一入口（DOM-R14）**必須**在處理 HTTP 請求時回傳這個請求的登入者；不在 HTTP 請求中執行的程式（例如指令）**必須**維持回傳內建 `admin`。請求中沒有登入者時，入口**不得**退回內建 `admin`，而是拒絕執行。唯一的例外是首次設定的公開路由（AUT-R44）：它沒有登入者，由路由明確把該次寫入當系統事件、操作者記為內建 `admin`（DOM-R14、ALG-R18），不是「退回」 | 必須 | [#54](https://github.com/speko-tw/inspect-flow/issues/54) 補充裁定（認證完成後改填實際登入的人）；指令維持 `admin`、請求中不退回 `admin` 是本規格的判讀；首次設定的例外依 負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）（首次設定當系統事件、操作者 `admin`）。理由：指令沒有登入者，而請求若退回 `admin` 會讓未登入的寫入被記成 `admin` 做的 |
| AUT-R10 | 目前使用者 API 與登入 API 的回應本體**必須**不含密碼雜湊、`AuthSession` 的 token 或其雜湊 | 必須 | [KD-30](../../intents/03-decisions-and-stack.md#kd-30)（token 只放在 HttpOnly Cookie）；AUT-R03 |

### 登入狀態（`AuthSession`）

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| AUT-R11 | 登入狀態**必須**保存在伺服器端資料庫的 `AuthSession`。Cookie 只帶一個隨機產生、不含任何個人資料的 token；token **應**至少有 256 位元的隨機性（OWASP 下限為 64 位元），資料庫**應**只存 token 的 SHA-256 雜湊，不存 token 本身 | 必須（伺服器端、token 不含個資）；應（長度、存雜湊） | [KD-30](../../intents/03-decisions-and-stack.md#kd-30)；OWASP Session Management Cheat Sheet；存雜湊是本規格的建議，理由：資料庫外洩時，外洩的內容不能直接拿來登入 |
| AUT-R12 | Cookie **必須**帶 `HttpOnly`、`Secure`、`SameSite`。`SameSite` **應**為 `Strict`；Cookie **應**命名為 `__Host-inspectflow_session`，`Path=/`、不設 `Domain` | 必須（三個屬性）；應（`Strict`、名稱、`__Host-` 前綴） | [KD-30](../../intents/03-decisions-and-stack.md#kd-30)；OWASP Session Management Cheat Sheet（`SameSite=Strict`、`__Host-` 前綴、不用框架預設名稱） |
| AUT-R13 | 每次登入成功**必須**產生新的 token；後端**不得**沿用請求帶來的任何 token 作為新登入狀態 | 必須 | [KD-30](../../intents/03-decisions-and-stack.md#kd-30)（伺服器決定登入狀態）；防止 session fixation，依 OWASP Session Management Cheat Sheet |
| AUT-R14 | 每個需要登入的請求，後端**必須**確認：Cookie 的 token 對應到一筆 `AuthSession`、未超過有效期限（AUT-R15）、對應的 `User` 目前 `is_active = true`。任一不成立時，視為未登入（401、`auth.not_authenticated`），並刪除該筆 `AuthSession`。`is_active` **必須**在每個請求時讀取資料庫目前的值，不得快取在 `AuthSession`，停用人員才會立即生效 | 必須 | [KD-21](../../intents/03-decisions-and-stack.md#kd-21)、[KD-30](../../intents/03-decisions-and-stack.md#kd-30)（停用時現有登入立即失效，不需撤銷機制）。本條不檢查 `auth_source`：外部帳號日後經外部驗證建立的登入狀態也適用本條（AUT-R27、[KD-30](../../intents/03-decisions-and-stack.md#kd-30)）；本系統帳號轉成外部帳號時，既有登入狀態是否撤銷，由 `external-identity-sync` 決定 |
| AUT-R15 | `AuthSession` **應**有兩種有效期限，都由伺服器判斷：從登入起算的絕對期限，以及從最後一次請求起算的閒置期限。兩個值**應**可由環境變數設定；未設定時，閒置期限預設 60 分鐘、絕對期限預設 8 小時（[AUT-Q1](#aut-q1) 裁定）。從登入起算滿絕對期限（經過時間大於或等於期限）即失效；閒置時間超過閒置期限（大於期限）才失效，剛好等於時仍有效。請求成功通過 AUT-R14 時，更新最後一次請求的時間 | 應 | OWASP Session Management Cheat Sheet（伺服器端逾時）；NIST SP 800-63B §2.2.3（AAL2）；預設值依 [AUT-Q1](#aut-q1) 裁定（[#143](https://github.com/speko-tw/inspect-flow/issues/143)） |
| AUT-R16 | Service 層**應**能算出一個 `User` 目前有效（未過期）的 `AuthSession` 筆數，供停用人員前顯示影響範圍；畫面顯示與確認流程由提供停用操作的功能規格負責 | 應 | [PR-18](../../intents/02-principles.md#pr-18)（影響範圍怎麼計算留給相關規格決定）；[KD-21](../../intents/03-decisions-and-stack.md#kd-21) |
| AUT-R17 | 同一個 `User` **得**同時有多筆 `AuthSession`（例如電腦與手機）；本規格不限制筆數 | 得 | [KD-30](../../intents/03-decisions-and-stack.md#kd-30)；限制筆數沒有 intents 依據 |

### 權限檢查

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| AUT-R18 | 後端**必須**預設拒絕：每一條 `/api/v1` 業務路由都**必須**明確宣告一種存取層級：公開、需登入、需 Admin、需專案權限（附權限代碼）、需系統角色（`SYSTEM_ROLE_REQUIRED`，附固定角色代碼），需 Admin／指定系統角色（`ADMIN_OR_SYSTEM_ROLE`），或需指定系統角色／任一專案權限（`SYSTEM_ROLE_OR_ANY_PROJECT_PERMISSION`，附兩種代碼；Admin 依 AUT-R19 放行）。沒有宣告的路由**必須**讓自動化測試失敗；公開路由**必須**列在一份明確的清單上，目前只有健康檢查、登入、登出，以及首次設定的兩條路由（AUT-R44：`GET /api/v1/setup/status`、`POST /api/v1/setup/admin-password`）。需登入以上的路由，未登入時回傳 401、`auth.not_authenticated` | 必須 | [KD-29](../../intents/03-decisions-and-stack.md#kd-29)（後端預設拒絕）、[PR-01](../../intents/02-principles.md#pr-01)（伺服器端覆核）；「沒宣告就測試失敗」是本規格把預設拒絕落實成可驗證的做法；首次設定路由為公開，因為此時還沒有任何可登入的帳號（[KD-43](../../intents/03-decisions-and-stack.md#kd-43)，負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29））；`admin` 已設定密碼後這兩條路由不再放行（AUT-R44） |
| AUT-R19 | 需專案權限的檢查**必須**依下列順序判斷，只在通過時放行，否則回傳 403、`permission.denied`：（1）登入者 `is_admin = true`：放行所有專案權限代碼，含讀取、新增、修改、刪除與簽核、匯出等特殊動作，不需要 `ProjectMember`，也不看代碼的動作類別。（2）登入者不是 Admin：取他在該專案的有效權限（DOM-R26：所有角色權限代碼的聯集，使用時從 `Role` 目前內容計算），含所需代碼時放行。（3）非 Admin 且不是該專案成員，有效權限為空集合，拒絕。某個動作若要求「本人親自具備角色」（例如簽核的職責分離），由該功能規格另訂，不改本條。有效權限**不得**跨請求快取，修改角色才會立即影響下一個請求 | 必須 | [AUT-Q2](#aut-q2) 裁定（負責人，[#144](https://github.com/speko-tw/inspect-flow/issues/144#issuecomment-5852180954)，2026-09-27）：Admin 本來就能把自己加進專案並指派任何角色，限縮只多一道手續、擋不住 Admin；[KD-24](../../intents/03-decisions-and-stack.md#kd-24)、[KD-25](../../intents/03-decisions-and-stack.md#kd-25)、[KD-26](../../intents/03-decisions-and-stack.md#kd-26)（修改角色立即影響持有者）、[KD-27](../../intents/03-decisions-and-stack.md#kd-27)、[KD-29](../../intents/03-decisions-and-stack.md#kd-29)；DOM-R26、DOM-R27 |
| AUT-R20 | 需 Admin 的檢查**必須**只放行 `is_admin = true` 的登入者，否則回傳 403、`permission.denied`。管理人員（含建立帳號、停用、修改 `is_admin`）、公司、角色定義的端點**必須**使用這一層。內建 `admin` 永遠是 Admin，不能被停用或被收回權限（DOM-R50），這是 Service 層的規則，不因這一層而改變 | 必須 | [KD-24](../../intents/03-decisions-and-stack.md#kd-24)（Admin 管理系統設定、人員、公司、角色定義）；建立帳號只由 Admin 做，依 [#54](https://github.com/speko-tw/inspect-flow/issues/54) 裁定（之後每個帳號都由某個 Admin 建立；第一個使用者由 Admin 在首次設定的第三步建立，AUT-R44）；內建 `admin` 的限制依 [KD-44](../../intents/03-decisions-and-stack.md#kd-44) |
| AUT-R21 | 後端**必須**提供「本人或 Admin」的檢查：登入者就是目標 `User`，或 `is_admin = true` 時放行，否則回傳 403、`permission.denied`。修改人員聯絡與補充欄位的端點**必須**使用這一層 | 必須 | [KD-17](../../intents/03-decisions-and-stack.md#kd-17)；DOM-R04（判斷操作者是不是 Admin 或本人由本規格執行） |
| AUT-R22 | 替 `ProjectMember` 指派或移除角色的端點，**必須**使用需專案權限的檢查（代碼依 `domain-model` 的 DOM-R35 登記）；Admin 依 AUT-R19 一律放行，本條不另設例外 | 必須 | [KD-27](../../intents/03-decisions-and-stack.md#kd-27)（角色由有權限的人設定） |
| AUT-R23 | 未登入的錯誤碼 `auth.not_authenticated`、帳號密碼錯誤 `auth.invalid_credentials`、權限不足 `permission.denied` **必須**登記在共用的錯誤碼列舉，並使用共用錯誤 envelope | 必須 | API-R05、API-R07；[KD-15](../../intents/03-decisions-and-stack.md#kd-15) |

### 首次設定與 admin 重設

依 [KD-43](../../intents/03-decisions-and-stack.md#kd-43)（負責人裁定，[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）：初始化指令不設任何密碼，改印一組一次性的首次登入碼；`admin` 的第一個密碼在網頁上設定，之後的重設走伺服器端指令。AUT-R42～AUT-R47 是本次新增，AUT-R24 已被取代。細節裡標「判讀」的是本規格的推導，見 [AUT-Q7](#aut-q7)。

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| AUT-R24 | **已被取代**（由 AUT-R42～AUT-R47 取代，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。原規定：提供以 email 指定使用者、互動輸入兩次密碼的「設定密碼指令」，可指定內建 `admin`。改由：初始化指令印出的首次登入碼與網頁上的首次設定（AUT-R42～AUT-R44）取得 `admin` 的第一個密碼、Admin 在畫面上新增使用者並得到系統產生的臨時密碼（AUT-R46）、`admin` 忘記密碼時用 `make reset-admin-password`（AUT-R47）。一般使用者的設定密碼指令移除。 | 已取代 | 原依據：[#54](https://github.com/speko-tw/inspect-flow/issues/54) 裁定、[KD-22](../../intents/03-decisions-and-stack.md#kd-22)（已被取代）、[AUT-Q4](#aut-q4) 第二題（選項甲）；取代依據：[KD-43](../../intents/03-decisions-and-stack.md#kd-43)、負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29） |
| AUT-R25 | 設定密碼成功時，**應**刪除該 `User` 所有既有的 `AuthSession` | 應 | OWASP Session Management Cheat Sheet（權限等級改變時換發登入狀態）；本規格的建議，理由：重設密碼通常是因為密碼可能外流 |
| AUT-R26 | 初始化指令與 `admin` 重設指令（AUT-R47）寫入時，建立與修改紀錄的操作者**必須**依 DOM-R14 為內建 `admin`；首次設定路由（AUT-R44）同理 | 必須 | [#54](https://github.com/speko-tw/inspect-flow/issues/54) 補充裁定；DOM-R14；AUT-R09；負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）（首次設定的操作者為 `admin`） |
| AUT-R42 | 初始化指令（DOM-R53）**必須**在建立內建 `admin` 之後產生一組**首次登入碼**，只在終端機印出這一次。首次登入碼**必須**是密碼學安全的隨機值（長度足以抵抗線上猜測，判讀：至少 128 位元的隨機量），有效期限 24 小時；資料庫**只存它的雜湊**（判讀：用 AUT-R01 的雜湊函式），**不得**存明文，也**不得**寫進 repo、設定檔、應用程式日誌或稽核紀錄。首次登入碼只能用一次：`admin` 的密碼設定成功時作廢（AUT-R44） | 必須 | [KD-43](../../intents/03-decisions-and-stack.md#kd-43)；負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）：一次性、24 小時有效、只存雜湊；隨機量與用 AUT-R01 的雜湊函式是本規格的判讀，見 [AUT-Q7](#aut-q7) |
| AUT-R43 | 初始化指令重跑時：`admin` **尚未設定密碼**，指令**必須**作廢舊的首次登入碼、產生並印出新的（其餘資料不重複建立，DOM-R13），新碼重新計算 24 小時；`admin` **已設定密碼**，指令**必須**拒絕並回報系統已初始化，不產生首次登入碼。判讀：重跑同時清除首次登入碼的失敗鎖定（AUT-R45），讓部署人員能用新碼繼續 | 必須（作廢重印、已設定即拒絕）；應（清除鎖定） | [KD-43](../../intents/03-decisions-and-stack.md#kd-43)；負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）：重跑會作廢舊碼並印新碼、設定密碼後拒絕；清除鎖定是判讀，見 [AUT-Q7](#aut-q7) |
| AUT-R44 | 後端**必須**提供首次設定的兩條公開路由（列入 AUT-R18 的公開清單）。（1）`GET /api/v1/setup/status`：回傳 `{"setup_required": 布林值}`，`admin` 尚未設定密碼時為 `true`；前端據此決定是否顯示首次設定頁，回應**不得**含其他資訊。（2）`POST /api/v1/setup/admin-password`，請求本體 `{"code","password"}`：首次登入碼有效、未過期、未作廢、未被鎖定，且密碼符合 AUT-R04 時，經設定密碼的 Service 入口（AUT-R36，**不標**為臨時）設定 `admin` 的密碼、把首次登入碼作廢、寫一筆 `user.password_set` 稽核（系統事件、操作者 `admin`，ALG-R18），並建立 `admin` 的 `AuthSession` 以 Cookie 回傳（判讀：設完密碼直接登入，接著新增第一個使用者）；同時寫一筆 `auth.login_succeeded` 應用程式日誌，比照 AUT-R40。首次登入碼錯誤、過期、已作廢或被鎖定時，一律回 401、`setup.invalid_code`，回應本體與狀態碼相同，不透露是哪一種；`admin` 已設定密碼時，兩條路由的第二條回 409、`setup.already_completed`，`status` 回 `false`；密碼不符 AUT-R04 時回 422、`auth.password_invalid`，**不**作廢首次登入碼、也**不**計入 AUT-R45 的失敗次數（碼是對的）。完整流程是：輸入首次登入碼、設定 `admin` 密碼（首次登入碼作廢）、新增第一個使用者（用一般的 Admin 使用者 API，AUT-R20、AUT-R46，屬 [#263](https://github.com/speko-tw/inspect-flow/issues/263)） | 必須（兩條路由、作廢、稽核、錯誤一致）；應（設完直接登入） | [KD-43](../../intents/03-decisions-and-stack.md#kd-43)；負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）：網頁流程三步、設定密碼後碼作廢、首次設定為系統事件；錯誤碼與直接登入是本規格的判讀，見 [AUT-Q7](#aut-q7) |
| AUT-R45 | 首次登入碼的失敗**必須**鎖定：15 分鐘內輸錯 10 次，鎖定 15 分鐘，時間到自動解鎖。這個計數與密碼登入的鎖定（AUT-R28）**必須**分開，不共用計數、不互相解鎖；因為首次登入碼不屬於任何帳號，計數以整個系統為單位（判讀），實際存放在目前有效那一筆 `SetupCode` 的 `failed_attempts`、`failure_window_started_at`、`locked_until`（見[資料](#資料)）。鎖定期間輸入任何值（含正確的碼）都拒絕，回應同 AUT-R44 的 401、`setup.invalid_code`，**不得**另有錯誤碼或標頭透露被鎖。被鎖時寫**應用程式日誌**，**不寫**稽核紀錄；日誌**不得**記錄輸入的碼。門檻與期間**應**集中在一處常數、可由環境變數覆寫，比照 AUT-R28 的做法。成功設定密碼（碼作廢）後計數清零；重跑初始化指令新增一列，計數自然從 0 開始（AUT-R43） | 必須（門檻、期間、與密碼登入分開、被鎖寫日誌不寫稽核、回應不透露）；應（常數集中、可覆寫） | [KD-43](../../intents/03-decisions-and-stack.md#kd-43)；負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）：10 次／15 分鐘、鎖 15 分鐘、計數與密碼登入分開、被鎖寫應用程式日誌不寫稽核；以系統為單位與常數做法是判讀，比照 AUT-R28，見 [AUT-Q7](#aut-q7) |
| AUT-R46 | Admin 新增使用者時（API 由 [#263](https://github.com/speko-tw/inspect-flow/issues/263) 提供，本規格定義它要遵守的密碼規則）：（1）**必須**由系統產生一組隨機臨時密碼，符合 AUT-R04，只在建立的回應中回傳一次，之後**不得**再能取得；（2）**必須**經 AUT-R36 的 Service 入口設定並標為臨時（`must_change_password = true`），使用者第一次登入後強制變更（AUT-R33）；（3）建立表單有「給予 admin 權限」勾選框，**預設不勾**，勾選才設 `is_admin = true`，且寫 `user.admin_changed` 稽核（ALG-R14）。第一個使用者與之後的使用者走同一條路徑 | 必須 | [KD-43](../../intents/03-decisions-and-stack.md#kd-43)：第一個使用者用系統產生的臨時密碼、只顯示一次、首次登入強制變更、勾選框預設不勾（負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29））；之後的使用者也由系統產生臨時密碼是判讀，見 [AUT-Q7](#aut-q7)；臨時密碼機制依 [AUT-Q4](#aut-q4) |
| AUT-R47 | 後端**必須**提供 `admin` 的密碼重設指令（`make reset-admin-password` 呼叫它），只在伺服器端執行、不是 HTTP 路由：只能指定內建 `admin`，在終端機互動輸入兩次密碼（不回顯），兩次相同且符合 AUT-R04 才寫入；密碼**不得**從指令列參數、環境變數或設定檔讀取，repo **不得**含任何密碼或其預設值；指令**得**另提供從標準輸入讀取的方式供自動化測試使用。指令經 AUT-R36 的 Service 入口寫入（**不標**臨時），所以會刪除 `admin` 既有的 `AuthSession`、清除密碼登入的失敗計數與鎖定（AUT-R25、AUT-R28 細節 6），並**必須**寫一筆 `user.password_set` 稽核（系統事件、操作者 `admin`）。兩次輸入不同或不符合規則時指令回報失敗、資料不變。`admin` 尚未設定密碼時指令拒絕並提示改用初始化指令取得首次登入碼（判讀）。一般使用者沒有這種指令；他們忘記密碼由 Admin 重設（AUT-R36） | 必須；得（標準輸入） | [KD-43](../../intents/03-decisions-and-stack.md#kd-43)；負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）：`admin` 重設走伺服器端 `make reset-admin-password`、互動輸入兩次、寫稽核、移除一般的設定密碼指令；拒絕未設定密碼的 `admin` 是判讀，見 [AUT-Q7](#aut-q7)；不得從參數與環境變數讀密碼沿用原 AUT-R24（[#54](https://github.com/speko-tw/inspect-flow/issues/54) 裁定） |

### 臨時密碼與變更密碼

「有臨時密碼標記、標記未清除前強制變更、本人能變更密碼」依 [AUT-Q4](#aut-q4) 裁定（負責人，[#146](https://github.com/speko-tw/inspect-flow/issues/146)，2026-09-26），強度為「必須」；欄位約束、錯誤碼、狀態碼與實作方式是本規格的建議，強度為「應」。

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| AUT-R32 | `UserPassword` **必須**記錄這組密碼是不是臨時密碼（本規格稱 `must_change_password`）；欄位**應**為不可空值，未指定時為 `false`。標記只對 `auth_source = local` 的帳號有作用；外部來源帳號不使用本地密碼，標記一律不影響它 | 必須（記錄標記、只對 `local` 有作用）；應（不可空值、預設 `false`） | [AUT-Q4](#aut-q4) 裁定（負責人，[#146](https://github.com/speko-tw/inspect-flow/issues/146)，2026-09-26）（選項 B：Admin 設定臨時密碼，首次登入強制變更；外部帳號不使用本地密碼） |
| AUT-R33 | `auth_source = local` 且 `must_change_password = true` 的帳號，仍可依 AUT-R05 登入並取得 `AuthSession`；但標記清除前，這個登入狀態的請求只放行一份明確的允許清單：取得目前使用者、登出、變更密碼（AUT-R34）。其他需登入以上的請求（含需 Admin、需專案權限、本人或 Admin）**必須**拒絕，而且不執行路由處理函式；拒絕時**應**回傳 403、`auth.password_change_required`。允許清單**應**集中在一處，並由自動化測試斷言內容 | 必須（只放行允許清單、各存取層級都拒絕、不執行處理函式）；應（狀態碼與錯誤碼、清單集中與測試方式） | [AUT-Q4](#aut-q4) 裁定（負責人，[#146](https://github.com/speko-tw/inspect-flow/issues/146)，2026-09-26）（首次登入強制變更）；以允許清單而非封鎖清單實作，延續 AUT-R18 的預設拒絕 |
| AUT-R34 | 後端**必須**提供本人變更密碼的 API：已登入的 `auth_source = local` 帳號送出目前密碼與新密碼，目前密碼驗證成功、新密碼符合 AUT-R04，且（標記為臨時時）新密碼與目前密碼不同，才以新密碼的雜湊取代舊的、清除 `must_change_password`。任一條件不符時資料不變，**應**分別回傳：目前密碼錯誤 400、`auth.current_password_incorrect`；新密碼不符 AUT-R04 為 422、`auth.password_invalid`；臨時密碼改成同一組 422、`auth.password_unchanged`。外部來源帳號呼叫時**必須**拒絕，資料不變（**應**回傳 403、`permission.denied`）。修改紀錄的操作者依 AUT-R09 為本人。本條與 AUT-R33 實際採用的錯誤碼，依 API-R07 登記在共用的錯誤碼列舉 | 必須（API、三項檢查、外部帳號拒絕）；應（狀態碼與錯誤碼的名稱）；錯誤碼的登記方式依 API-R07 | [AUT-Q4](#aut-q4) 裁定（負責人，[#146](https://github.com/speko-tw/inspect-flow/issues/146)，2026-09-26）（變更密碼的流程與頁面）；「臨時密碼不得改成同一組」是本規格的推導，理由：否則強制變更沒有效果；API-R05、API-R07 |
| AUT-R35 | 變更密碼成功時，**應**刪除該 `User` 所有的 `AuthSession`（含發出這個請求的那一筆），並依 AUT-R11～AUT-R13 為這個請求建立一筆新的 `AuthSession`、以 Cookie 回傳，讓本人不必重新登入 | 應 | OWASP Session Management Cheat Sheet（密碼變更屬權限等級改變，應換發登入識別碼；其他登入狀態失效）；換發而非要求重新登入是本規格的建議，理由：本人剛證明知道密碼 |
| AUT-R36 | 後端**必須**提供可把密碼標為臨時的設定方式；Admin 在畫面上替他人設定或新增使用者時給的密碼**必須**標為臨時（AUT-R46）。這個設定方式**應**是 Service 層的單一入口，參數含目標 `User`、新密碼與是否標為臨時，負責 AUT-R04 的長度檢查、雜湊、寫入 `UserPassword` 與 `must_change_password`，以及 AUT-R25 的刪除登入狀態與 AUT-R28 細節（6）的解鎖；首次設定（AUT-R44）、`admin` 重設指令（AUT-R47）與 Admin 設定臨時密碼**應**都經過這個入口 | 必須（可標為臨時、Admin 設定的標為臨時）；應（單一入口，三個呼叫方共用） | [AUT-Q4](#aut-q4) 裁定（負責人，[#146](https://github.com/speko-tw/inspect-flow/issues/146)，2026-09-26）；單一入口是本規格的建議，理由：規則只寫一次，各呼叫方不會各自漏掉長度檢查或刪除登入狀態；呼叫方由指令改為首次設定與重設指令依 [KD-43](../../intents/03-decisions-and-stack.md#kd-43)（負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）） |
| AUT-R37 | 標為臨時的規則依情境決定：Admin 新增使用者或替他人重設的密碼標為臨時（AUT-R46、AUT-R36），本人第一次登入時變更；內建 `admin` 的密碼不標臨時：首次設定時是它本人在網頁上自己設的（AUT-R44），重設指令是部署人員自己輸入、自己保管（AUT-R47） | 應 | [AUT-Q4](#aut-q4) 裁定（一般帳號首次登入強制變更；內建 `admin` 作為緊急備援、密碼由部署人員保管）；[KD-43](../../intents/03-decisions-and-stack.md#kd-43)、[KD-44](../../intents/03-decisions-and-stack.md#kd-44)；負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）（原規定「設定密碼的指令依帳號決定」，指令已改為只服務 `admin`） |

### 外部身分來源與登入失敗

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| AUT-R27 | 「驗證身分」與「建立登入狀態」**應**是兩個分開的步驟：密碼驗證只負責確認一個 `User`；建立 `AuthSession`、Cookie、AUT-R14 的檢查不依賴密碼。日後外部身分來源只需新增一種驗證方式，驗證成功後沿用同一套登入狀態 | 應 | [KD-30](../../intents/03-decisions-and-stack.md#kd-30) 的理由（外部來源登入成功後一樣建立伺服器端登入狀態）、[KD-20](../../intents/03-decisions-and-stack.md#kd-20) |
| AUT-R28 | 後端**必須**依帳號（`User`）計算密碼驗證失敗：同一帳號在 15 分鐘內失敗 10 次，第 10 次失敗起鎖定 15 分鐘，時間到自動解鎖，不需 Admin 操作。計入的入口有兩個，共用同一個計數：登入 API（AUT-R05）與變更密碼 API 驗證目前密碼（AUT-R34）。細節：（1）「15 分鐘內」從當下往回算，經過時間大於或等於 15 分鐘的失敗不再計入；（2）鎖定從第 10 次失敗的時間起算，經過時間大於或等於 15 分鐘即解鎖，解鎖後重新計數；（3）鎖定期間的嘗試不論密碼對錯都拒絕，不計入、不延長鎖定；（4）任一入口密碼驗證成功時，該帳號的失敗計數清零；（5）帳號不存在時不記錄；用帳號名稱或用 email 登入指向同一個帳號，計入同一個計數；（6）經設定密碼的 Service 入口（AUT-R36）重設密碼時（含 `admin` 重設指令與 Admin 設定臨時密碼），不論是否知道目前密碼、也不論是否鎖定中，都視同該帳號驗證成功：清除失敗計數並解除鎖定。鎖定期間的回應**必須**與該入口的一般失敗相同：登入回 AUT-R06 的 401 `auth.invalid_credentials`，變更密碼回 400 `auth.current_password_incorrect`、資料不變；**不得**另有錯誤碼、訊息或標頭透露帳號被鎖。SQLite 寫鎖等待逾時時，不論帳號已知、未知或已鎖定，登入**必須**回 503 `server.temporarily_unavailable`、`Retry-After: 5` 且不設定 Cookie；逾時不得留下登入狀態、失敗計數或 `auth.login_failed` 日誌。三個鎖定數值（10 次、15 分鐘、15 分鐘）**應**集中在一處常數，並比照 AUT-R15 可由環境變數覆寫（未設定或空值時用上述預設值）。被鎖時寫稽核紀錄，見 AUT-R39。首次登入碼的失敗鎖定另立（AUT-R45），計數與這裡分開，被鎖只寫應用程式日誌 | 必須（門檻、期間、自動解鎖、兩個入口共用計數、重設密碼解鎖、回應不透露、SQLite 寫鎖等待逾時回應一致）；應（常數集中、環境變數覆寫） | [AUT-Q5](#aut-q5) 裁定（負責人，[#147](https://github.com/speko-tw/inspect-flow/issues/147)，2026-09-27）；細節（1）～（5）是本規格的推導，依 OWASP Authentication Cheat Sheet（依帳號計算、成功後重設計數、鎖定可能被用來阻擋他人，因此不延長）；細節（6）為負責人裁定（[#192](https://github.com/speko-tw/inspect-flow/issues/192) 留言，2026-09-27）：重設密碼的人已確認過本人身分，繼續鎖著只會讓人乾等；SQLite 登入等待上限與逾時回應依負責人裁定（[#320](https://github.com/speko-tw/inspect-flow/issues/320)、[#321](https://github.com/speko-tw/inspect-flow/issues/321)）。落地由 T11 的 Service 入口負責清除，實際計數與解鎖由 T8 的鎖定模組實作，見計畫 T8「與 T11 的銜接」。環境變數覆寫比照 AUT-R15 的慣例 |

### 稽核紀錄與日誌

依 [AUT-Q6](#aut-q6) 裁定（負責人，[#148](https://github.com/speko-tw/inspect-flow/issues/148)，2026-09-27）：少見且重要的事件寫稽核紀錄，頻繁的事件寫應用程式日誌。請求來源（IP 等）不記，待 `audit-log` 的 [ALG-Q5](../audit-log/spec.md#alg-q5)。

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| AUT-R39 | 下列事件成功時，**必須**在同一個交易裡經 `audit-log` 的寫入入口（ALG-R05）寫恰好一筆稽核紀錄，事件代碼與欄位依 `audit-log` 的[`authentication` 事件](../audit-log/spec.md#authentication-事件)：（1）設定密碼，含首次設定 `admin` 密碼（AUT-R44，系統事件，ALG-R18）、`admin` 重設指令（AUT-R47，系統事件）、Service 入口（AUT-R36，含 Admin 新增使用者與設定臨時密碼）、本人變更密碼（AUT-R34），寫 `user.password_set`；（2）帳號因 AUT-R28 被鎖，寫 `user.locked`。設定被拒絕、資料不變時**不得**寫；鎖定期間的嘗試不再寫。首次登入碼被鎖（AUT-R45）**不**寫稽核，只寫應用程式日誌 | 必須 | [AUT-Q6](#aut-q6) 裁定（負責人，[#148](https://github.com/speko-tw/inspect-flow/issues/148)，2026-09-27）；「同一個交易、恰好一筆」依 ALG-R06、ALG-R14 的做法；首次設定與重設的事件來源與首次登入碼被鎖不寫稽核依 [KD-43](../../intents/03-decisions-and-stack.md#kd-43)（負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）） |
| AUT-R40 | 登入成功、登入失敗（含鎖定期間被拒絕）、登出**必須**寫一筆應用程式日誌，不寫資料庫。日誌**應**用 Python `logging`、固定的 logger 名稱，並以結構化欄位記錄：事件（`auth.login_succeeded`、`auth.login_failed`、`auth.logout`）、`user_id`（帳號不存在時為空值）、失敗原因（帳密不符、帳號停用、鎖定中，只在日誌內區分，回應仍依 AUT-R06 一致） | 必須（三種事件、不寫資料庫）；應（logger 與欄位） | [AUT-Q6](#aut-q6) 裁定；OWASP Logging Cheat Sheet（登入成功與失敗都要記）；logger 與欄位是本規格的建議，理由：專案目前只有 `app.api.errors` 用 `logging.getLogger`，沒有統一的日誌設定（[#41](https://github.com/speko-tw/inspect-flow/issues/41) 仍未完成），先用標準 `logging` 最不綁實作 |
| AUT-R41 | 稽核紀錄與應用程式日誌**不得**含密碼（含錯誤的密碼）、密碼雜湊、登入 token、Cookie 值，以及首次登入碼（含輸入的與產生的，雜湊除外的任何形式）；登入失敗與首次登入碼失敗的日誌**不得**記錄使用者輸入的帳號名稱、email 或碼的原文（使用者可能把密碼打在帳號欄） | 必須 | [AUT-Q6](#aut-q6) 裁定（任何紀錄不得含密碼或 token）；[PR-14](../../intents/02-principles.md#pr-14)；不記輸入原文依 OWASP Logging Cheat Sheet（不記錄可能誤輸入的密碼），是本規格的推導；首次登入碼比照密碼處理是 [KD-43](../../intents/03-decisions-and-stack.md#kd-43) 的落地（負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）） |

### 前端

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| AUT-R29 | 前端**必須**提供登入頁，欄位為「帳號名稱或 email」與密碼，送出到登入 API；認證失敗（401）時只顯示一種通用訊息（「帳號或密碼錯誤」），不得透露帳號是否存在或鎖定；伺服器暫時無法處理（503）時顯示「伺服器暫時忙碌，請稍後再試。」Admin Web 與 Field Web 在目前使用者 API 回傳 401 時，**必須**導向登入頁，登入成功後回到原本的頁面（主動登出後與換帳號登入的例外見 [ADM-R23](../admin-dashboard/spec.md#需求)）。Admin Web 另**必須**提供首次設定頁：`GET /api/v1/setup/status` 回 `setup_required = true` 時，未登入的使用者被導向此頁，輸入首次登入碼與新密碼（兩次），送出到 AUT-R44 的路由；`invalid_code` 只顯示一種通用訊息，設定成功後（已登入）進入新增第一個使用者的步驟，由首次設定流程提供，呼叫新增使用者 API（[#263](https://github.com/speko-tw/inspect-flow/issues/263)）；一般的使用者與公司管理頁屬 [#265](https://github.com/speko-tw/inspect-flow/issues/265)。`setup_required = false` 時，首次設定頁不可進入 | 必須 | [KD-30](../../intents/03-decisions-and-stack.md#kd-30)；架構基準 §17；通用訊息依 AUT-R06；[KD-45](../../intents/03-decisions-and-stack.md#kd-45)、[KD-43](../../intents/03-decisions-and-stack.md#kd-43)；負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）；[PR #311 審查建議（規格澄清）](https://github.com/speko-tw/inspect-flow/pull/311#pullrequestreview-5393249857) |
| AUT-R30 | 前端**不得**讀取、儲存或自行傳送登入 token（Cookie 由瀏覽器自動帶），也**不得**把登入資訊寫入 `localStorage`、`sessionStorage`；前端**必須**提供登出操作 | 必須 | [KD-30](../../intents/03-decisions-and-stack.md#kd-30)（不把長效 token 放在 browser localStorage）、[認證與授權卡片](../../intents/03-decisions-and-stack.md#stack-auth)「不要用」 |
| AUT-R31 | 前端依目前使用者隱藏無權使用的功能，只是方便；**不得**取代 AUT-R18～AUT-R22 的後端檢查 | 必須 | [PR-01](../../intents/02-principles.md#pr-01) |
| AUT-R38 | 前端**必須**提供變更密碼頁（目前密碼、新密碼、再輸入一次新密碼），兩次新密碼不同時不送出；依 AUT-R34 的錯誤碼顯示對應訊息。目前使用者 API 回傳 `must_change_password = true` 時，Admin Web 與 Field Web **必須**導向變更密碼頁，變更成功後回到原本的頁面。前端**得**在登出操作旁提供變更密碼的入口，供本人主動變更 | 必須；得（主動變更的入口） | [AUT-Q4](#aut-q4) 裁定（負責人，[#146](https://github.com/speko-tw/inspect-flow/issues/146)，2026-09-26）（變更密碼的頁面）；後端的強制仍以 AUT-R33 為準（[PR-01](../../intents/02-principles.md#pr-01)） |

## 資料

`User`、`Company`、`Role`、`ProjectMember` 的定義見 `domain-model`（DOM-R02～DOM-R27）。`domain-model` 的資料段寫明「認證欄位歸 `authentication`」，本規格新增下列三個實體；三者都沿用共通結構（UUID 主鍵、`created_at`、`updated_at`、`created_by`、`updated_by`，見 DBF-R11、DBF-R14、DOM-R15）。

| 實體 | 欄位（本規格定義） | 說明 | 對應需求 |
|---|---|---|---|
| `UserPassword` | `user_id`（不可空值、唯一、外鍵指向 `User`）、`password_hash`（不可空值，PHC 字串）、`must_change_password`（不可空值，未指定時為 `false`） | 一個 `User` 至多一筆；沒有這一筆就是「尚未設定密碼」，不能以密碼登入。外部帳號不需要這一筆；轉成外部帳號後留下的這一筆（含標記）不被使用 | AUT-R01～AUT-R04、AUT-R32、AUT-R36 |
| `AuthSession` | `user_id`（不可空值、外鍵指向 `User`）、`token_hash`（不可空值、唯一）、`expires_at`（絕對期限，UTC）、`last_seen_at`（最後一次請求，UTC） | 一次登入一筆；登出、過期、帳號停用時刪除。`created_by`、`updated_by` 填登入者本人 | AUT-R11～AUT-R17 |
| `SetupCode` | `code_hash`（不可空值，首次登入碼的雜湊）、`expires_at`（不可空值，建立時間加 24 小時，UTC）、`voided_at`（可空值，作廢時間，UTC；空值表示尚未作廢）、`failed_attempts`（整數，不可空值，預設 0，目前這個視窗內的失敗次數）、`failure_window_started_at`（可空值，UTC，目前計數視窗的起點；空值表示尚無失敗）、`locked_until`（可空值，UTC；空值或已過表示未鎖定） | 首次登入碼（AUT-R42）。只存雜湊，不存明文；同一時間至多一筆有效（未作廢、未過期）；重跑初始化指令時舊列填 `voided_at`、新增一列（AUT-R43）；設定 `admin` 密碼成功時填 `voided_at`（AUT-R44）。失敗計數與鎖定狀態（AUT-R45）直接存在**目前有效的那一筆** `SetupCode` 列上，不放在 `User` 或 `UserPassword` 上，也不與 AUT-R28 的計數混用；重跑初始化指令會新增一列，新列的計數從 0 開始，等同清除鎖定，不需要另建計數表。`created_by`、`updated_by` 填內建 `admin` | AUT-R42～AUT-R45 |

- **為什麼密碼放在獨立的 `UserPassword`，不放在 `User` 上**：外部帳號沒有密碼，獨立一張表就不必在 `User` 上留一個只對本系統帳號有意義、而且永遠不能出現在回應裡的欄位；`domain-model` 的 `User` 修改入口與查詢也不會意外帶出雜湊。帳號轉成外部帳號（DOM-R09）時，`UserPassword` 留著也不會被使用，AUT-R06 以 `auth_source` 擋下密碼登入；既有登入狀態是否撤銷由 `external-identity-sync` 決定。
- **為什麼 `AuthSession` 也沿用共通結構**：[#54](https://github.com/speko-tw/inspect-flow/issues/54) 補充裁定要求所有資料的 `created_by`、`updated_by` 都有值；登入狀態的操作者就是登入者本人，填起來沒有額外成本。
- **為什麼臨時密碼標記放在 `UserPassword`**：標記描述的是「這一組密碼」，換一組密碼時一起改寫；放在 `User` 上，外部帳號會多一個沒有意義的欄位，理由同上。
- **為什麼首次登入碼放在獨立的 `SetupCode`**：它不屬於任何帳號的登入憑證，而是安裝當下的一次性憑證；放進 `UserPassword` 會讓「`admin` 尚未設定密碼」與「有一組待用的首次登入碼」混在一起。（判讀，見 [AUT-Q7](#aut-q7)）
- 刪除 `User` 本來就被外鍵擋下（DOM-R10），因此 `UserPassword` 與 `AuthSession` 不需要設定連帶刪除。

## 介面

路徑、內容型別與錯誤 envelope 沿用 `api-conventions`。

| 方法 | 路徑 | 用途 | 權限 |
|---|---|---|---|
| `POST` | `/api/v1/auth/login` | 本體 `{"login": "帳號名稱或 email", "password": "…"}`；成功 200，設定 Cookie，本體與 `GET /api/v1/auth/me` 完全相同（含公司欄位）；失敗 401 `auth.invalid_credentials`；本體不合法 422（沿用共用錯誤處理） | 公開 |
| `POST` | `/api/v1/auth/logout` | 刪除登入狀態並清除 Cookie；一律 204 | 公開（沒有登入狀態也回 204） |
| `GET` | `/api/v1/auth/me` | 目前使用者 `{"id", "username", "email", "name_en", "name_zh", "is_admin", "must_change_password", "company", "department", "location", "employee_no", "has_office_access", "has_field_access", "has_template_access"}`（`company` 為 `{"id", "name"}` 或 `null`；後三者為存取摘要布林值，AUT-R08）；未登入 401 `auth.not_authenticated` | 需登入（臨時密碼未變更時仍放行） |
| `POST` | `/api/v1/auth/password` | 本人變更密碼，本體 `{"current_password": "…", "new_password": "…"}`；成功 204，並以 `Set-Cookie` 換發新的登入 Cookie；目前密碼錯誤 400 `auth.current_password_incorrect`；新密碼不符規則 422 `auth.password_invalid`；臨時密碼改成同一組 422 `auth.password_unchanged`；外部帳號 403 `permission.denied` | 需登入（臨時密碼未變更時仍放行） |
| `GET` | `/api/v1/setup/status` | 回傳 `{"setup_required": true \| false}`；`admin` 尚未設定密碼時為 `true` | 公開（AUT-R44） |
| `POST` | `/api/v1/setup/admin-password` | 本體 `{"code": "…", "password": "…"}`；成功 204，設定 `admin` 密碼、作廢首次登入碼、設定登入 Cookie；碼錯誤、過期、作廢或被鎖 401 `setup.invalid_code`；已設定過密碼 409 `setup.already_completed`；密碼不符規則 422 `auth.password_invalid` | 公開（AUT-R44） |
| `GET` | `/api/v1/users?q=&cursor=&limit=` | `{items: [既有 User 欄位], next_cursor}`；依 `(username,id)` 升冪 cursor 分頁，預設 `limit=50`、範圍 1–100；`q` 省略或空白時不篩選，否則以不分大小寫子字串搜尋 `username`、`name_zh`、`name_en`、`email`、`employee_no`；無效 cursor、超長 `q` 或超出範圍的 `limit` 回 422 | 需 Admin（AUT-R20） |
| `GET` | `/api/v1/companies?q=&cursor=&limit=` | `{items: [既有 Company 欄位], next_cursor}`；依 `(name,id)` 升冪 cursor 分頁，預設 `limit=50`、範圍 1–100；`q` 省略或空白時不篩選，否則以不分大小寫子字串搜尋 `name`；無效 cursor、超長 `q` 或超出範圍的 `limit` 回 422 | 需 Admin（AUT-R20） |

| 其他介面 | 內容 | 對應需求 |
|---|---|---|
| 程式介面 | 路由的存取層級宣告：公開、需登入、需 Admin、需系統角色、需專案權限（權限代碼、取得專案 ID 的方式）、系統角色或任一專案權限、本人或 Admin；以及列出所有路由宣告的方式，供 AUT-R18 的測試使用 | AUT-R18～AUT-R22 |
| 程式介面 | 目前操作者入口（改寫 `domain-model` 的入口，簽章不變） | AUT-R09 |
| 程式介面 | 一個 `User` 有效 `AuthSession` 筆數的查詢 | AUT-R16 |
| 程式介面 | 設定密碼的 Service 入口（目標 `User`、新密碼、是否標為臨時），供首次設定、`admin` 重設指令與使用者管理 API（0.2.x）呼叫 | AUT-R36、AUT-R46 |
| 程式介面 | 臨時密碼未變更時的允許清單（取得目前使用者、登出、變更密碼） | AUT-R33 |
| 指令 | 初始化指令（`make init`）印出首次登入碼；重跑時作廢舊碼、印新碼，`admin` 已設定密碼時拒絕 | AUT-R42、AUT-R43 |
| 指令 | `make reset-admin-password`：只指定內建 `admin`，互動輸入兩次密碼，不標為臨時，寫稽核 | AUT-R47、AUT-R37 |
| 環境變數 | 登入狀態的絕對期限與閒置期限（名稱由計畫決定，並寫入 `.env.example`） | AUT-R15 |
| 環境變數 | 登入失敗鎖定的門檻、計算期間、鎖定時間（名稱由計畫決定，並寫入 `.env.example`） | AUT-R28 |
| 環境變數 | 首次登入碼的失敗鎖定門檻、計算期間、鎖定時間（名稱由計畫決定，並寫入 `.env.example`） | AUT-R45 |
| 環境變數 | `INSPECTFLOW_SQLITE_BUSY_TIMEOUT_MS`：SQLite 登入寫鎖等待上限，預設 5000 毫秒，範圍 1～60000 毫秒；非正整數或超出範圍時後端啟動必須拒絕 | #320、#321 |
| 日誌 | 登入成功、失敗、登出，以及首次登入碼被鎖的應用程式日誌：固定 logger 名稱與結構化欄位（名稱由計畫決定） | AUT-R40、AUT-R41、AUT-R45 |
| 畫面 | 前端 `/login` 登入頁（帳號名稱或 email）、`/setup` 首次設定頁；Admin Web、Field Web 的登出操作 | AUT-R29、AUT-R30 |
| 畫面 | 前端 `/change-password` 變更密碼頁；臨時密碼未變更時導向此頁 | AUT-R38 |

具體模組、函式、指令與環境變數名稱由計畫決定，不屬於本規格的契約；上表的 HTTP 路徑、狀態碼與錯誤碼是契約。

## 驗收條件

後端 AC 以 `make check` 內的自動化測試驗證，資料庫由 `alembic upgrade head` 建立，HTTP 請求用 FastAPI 的測試用戶端並以 `https://` 為 base URL（`Secure` Cookie 只在 HTTPS 下回傳）。前端 AC 以 Vitest 與 Testing Library 驗證，API 以測試替身回應。

### 密碼

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| AUT-AC01 | 一段測試用的密碼 | 以本規格的雜湊函式雜湊兩次，並檢查結果 | 兩個雜湊字串都以 `$argon2id$` 開頭，參數段等於程式設定的參數組，且該組是 AUT-R01 列出的 OWASP 配置之一，兩者不同（salt 不同），都不含明文；以正確密碼驗證成功、以錯誤密碼驗證失敗 | AUT-R01 |
| AUT-AC02 | 一個以「與程式設定不同的另一組 AUT-R01 配置」產生的密碼雜湊存在 `UserPassword`（例如程式設定為 19456／2／1 時，用 12288／3／1） | 以正確密碼登入 | 登入成功；`UserPassword.password_hash` 被改寫為程式設定的參數組，且新的雜湊仍能驗證同一個密碼 | AUT-R02 |
| AUT-AC03 | 一個已設定密碼的帳號；測試擷取應用程式日誌 | 分別呼叫登入（成功與失敗）與目前使用者 API | 每個回應本體都不含 `password_hash` 的值、明文密碼與 token；擷取到的日誌不含明文密碼與雜湊 | AUT-R03、AUT-R10 |
| AUT-AC04 | 初始化後的資料庫，內建 `admin` 已設定密碼 | 以 `admin` 重設指令（標準輸入）分別設定：7 字元的密碼；8 字元的密碼；128 字元、其中含中文字（UTF-8 編碼超過 128 個位元組）的密碼；129 字元的 ASCII 密碼；12 字元、只含小寫英文字母的密碼 | 8 字元、128 字元與只含小寫字母的三次成功，每次成功後 `UserPassword` 的雜湊都能驗證剛設定的密碼；7 字元與 129 字元的兩次失敗，`UserPassword` 不變 | AUT-R04、AUT-R47 |

### 登入、登出與目前使用者

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| AUT-AC05 | 一個啟用中、`local`、已設定密碼、帳號名稱為 `anna.deng`、email 為 `Anna.Deng@demo.example` 的帳號 | 分別以 `anna.deng`、`ANNA.DENG`、`anna.deng@demo.example`、` Anna.Deng@DEMO.example `（前後有空白）與正確密碼呼叫 `POST /api/v1/auth/login` | 四次都是 200；本體含該帳號的 `id`、`username`、`email`、`name_en`、`name_zh`、`is_admin`、`must_change_password`、`company`、`department`、`location`、`employee_no`、`has_office_access`、`has_field_access`、`has_template_access`，且與同一用戶端緊接著呼叫 `GET /api/v1/auth/me` 的本體逐欄相同；`Set-Cookie` 名稱為 `__Host-inspectflow_session`，帶 `HttpOnly`、`Secure`、`SameSite=Strict`、`Path=/`，沒有 `Domain`；每次資料庫多一筆該帳號的 `AuthSession`，其 `token_hash` 等於 Cookie 值的 SHA-256，且不等於 Cookie 值本身 | AUT-R05、AUT-R08、AUT-R11、AUT-R12 |
| AUT-AC06 | 六個帳號情境：帳號名稱或 email 不存在；密碼錯誤；帳號已停用；`auth_source = external`；`local` 但沒有 `UserPassword`（含尚未設定密碼的內建 `admin`）；輸入含 `@` 但只符合某人的帳號名稱前段（例如 `anna.deng@x`） | 各以一組登入名稱與密碼呼叫登入 | 六次都回 401，回應本體逐位元組相同（`error.code` 為 `auth.invalid_credentials`），都沒有 `Set-Cookie`，`AuthSession` 筆數不變；帳號不存在與沒有密碼的兩種情況，密碼驗證函式仍被呼叫一次 | AUT-R06 |
| AUT-AC07 | 已登入的用戶端 | 呼叫 `POST /api/v1/auth/logout`，再以同一個 Cookie 呼叫 `GET /api/v1/auth/me`；另以沒有 Cookie 的用戶端呼叫登出 | 登出回 204，`Set-Cookie` 讓瀏覽器清除該 Cookie，該筆 `AuthSession` 已不存在；之後的 `me` 回 401 `auth.not_authenticated`；沒有 Cookie 的登出也回 204 | AUT-R07 |
| AUT-AC08 | 已登入與未登入的用戶端各一；已登入者含內建 `admin` 與一般帳號 | 各呼叫 `GET /api/v1/auth/me` | 已登入：200，本體的鍵恰為 `id`、`username`、`email`、`name_en`、`name_zh`、`is_admin`、`must_change_password`、`company`、`department`、`location`、`employee_no`、`has_office_access`、`has_field_access`、`has_template_access`；有連結公司的帳號，`company` 為該公司的 `{id, name}`，沒有連結公司的帳號（含內建 `admin`）四個公司欄位皆為 `null`；所有帳號的 `username` 都不為 `null`；內建 `admin` 的 `email` 與 `name_zh` 為 `null`，一般帳號的 `email`、`name_zh` 有值，`name_en` 得為 `null`；`admin` 的三個存取摘要皆為 `true`；未登入：401 `auth.not_authenticated` | AUT-R08、AUT-R10、DOM-R46、DOM-R50 |
| AUT-AC09 | 一條僅存在於測試中、需登入、會透過目前操作者入口寫入一筆 `Company` 的路由；另有一段不經過 HTTP 請求、直接呼叫同一個 Service 的測試程式 | 以已登入的帳號 U 呼叫該路由；再不帶 Cookie 呼叫；再執行那段測試程式 | 第一次寫入的 `created_by`、`updated_by` 為 U；第二次回 401 且沒有寫入；第三次寫入的 `created_by` 為內建 `admin` | AUT-R09 |

### 登入狀態

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| AUT-AC10 | 一個帳號 | 登入兩次（兩個不同用戶端），第二次請求時另帶上第一次取得的 Cookie | 兩次取得的 token 不同，長度至少 43 個 base64url 字元（256 位元）；第二次回應的 token 不等於請求帶來的 token；兩個 Cookie 都能呼叫 `me` 成功（同一人可有多筆） | AUT-R11、AUT-R13、AUT-R17 |
| AUT-AC11 | 帳號 U 已在兩個用戶端登入 | 直接在資料庫把 U 的 `is_active` 改為 `false`（不經過任何登出或撤銷流程），再以兩個 Cookie 各呼叫 `me` | 兩次都回 401 `auth.not_authenticated`；U 的 `AuthSession` 都已刪除 | AUT-R14 |
| AUT-AC12 | 一個啟用中的 `external` 帳號 E（沒有 `UserPassword`）；由測試直接呼叫「建立登入狀態」的函式替 E 建立登入狀態 | 以取得的 Cookie 呼叫 `me`；再以 E 的 email 與任意密碼呼叫登入 API | `me` 回 200（登入狀態的檢查不因 `auth_source` 拒絕）；密碼登入回 401 `auth.invalid_credentials` | AUT-R06、AUT-R14、AUT-R27 |
| AUT-AC13 | 以可替換的時鐘控制時間；未設定逾時相關環境變數，因此 A = 8 小時、I = 60 分鐘（AUT-R15 的預設值） | 登入後，每隔少於 I 的時間呼叫一次 `me`，在登入後 A 減 1 秒時呼叫一次，再推進到剛好 A 呼叫一次；另兩個用戶端各自登入後，一個閒置剛好 I、一個閒置 I 加 1 秒再呼叫 `me`；每次成功呼叫後檢查 `last_seen_at` | 第一個用戶端到 A 減 1 秒時都成功、剛好 A 時 401；閒置剛好 I 的用戶端成功、閒置 I 加 1 秒的用戶端 401；成功呼叫後 `last_seen_at` 等於當下時間；過期的 `AuthSession` 都已刪除 | AUT-R15 |
| AUT-AC14 | 帳號 U 有兩筆有效與一筆已過期的 `AuthSession`；帳號 V 沒有 | 計算 U、V 的有效登入狀態筆數 | U 為 2、V 為 0 | AUT-R16 |
| AUT-AC15 | 預設的環境（未設定逾時相關環境變數），以及分別設定這兩個環境變數的環境 | 讀取後端的逾時設定 | 未設定時，閒置期限為 60 分鐘、絕對期限為 8 小時；有設定時等於設定值；`.env.example` 列出這兩個變數 | AUT-R15 |

### 權限檢查

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| AUT-AC16 | 正式應用程式掛載的所有業務路由（範圍同 API-AC01）；另在測試中掛上一條沒有宣告存取層級的路由 | 執行路由宣告檢查 | 正式路由全部有宣告，公開路由恰為健康檢查、登入、登出、`GET /api/v1/setup/status`、`POST /api/v1/setup/admin-password`；加上未宣告的路由後，檢查失敗並指出該路由 | AUT-R18、AUT-R44 |
| AUT-AC17 | 測試中的四條路由，分別宣告需登入、需 Admin、需專案權限、本人或 Admin | 不帶 Cookie 呼叫四條路由 | 都回 401 `auth.not_authenticated`，路由處理函式都沒有被執行 | AUT-R18、AUT-R23 |
| AUT-AC18 | 專案 P、Q；非 Admin 的 U 在 P 有角色 R1（`report.read`）與 R2（`report.approve`），不是 Q 的成員；Admin A 不是任何專案的成員；一條測試路由要求 `report.read`，另一條要求 `evidence.read` | U 呼叫 P 的兩條路由、Q 的 `report.read` 路由；A 呼叫 P、Q 的兩條路由 | U：P 的 `report.read` 放行，`evidence.read` 回 403 `permission.denied`，Q 回 403；A：四次都放行 | AUT-R19、AUT-R23 |
| AUT-AC19 | 承 AUT-AC18，U 已登入且沒有重新登入 | 把 R1 的權限內容改為 `evidence.read`，U 以同一個 Cookie 再呼叫 P 的兩條路由；再把 U 的 `is_admin` 改為 `true`，呼叫 Q 的路由 | R1 修改後，U 在 P 的有效權限變成 `{evidence.read, report.approve}`：`evidence.read` 放行，`report.read` 回 403，證明修改角色立即影響同一個登入狀態的下一個請求；改成 Admin 後，Q 放行 | AUT-R19 |
| AUT-AC20 | 一條需 Admin 的測試路由；Admin A、非 Admin 的 U | 各呼叫一次 | A 放行；U 回 403 `permission.denied` | AUT-R20 |
| AUT-AC21 | 一條「本人或 Admin」、以路徑指定目標 `User` 的測試路由；使用者 U、V、Admin A | U 以自己為目標、U 以 V 為目標、A 以 V 為目標各呼叫一次 | 第一、三次放行；第二次 403 `permission.denied` | AUT-R21 |
| AUT-AC22 | 共用錯誤碼列舉與由它產生的對照表（API-AC10） | 檢查對照表 | 含 `auth.not_authenticated`、`auth.invalid_credentials`、`permission.denied`，且都符合 API-AC09 的 dot-namespace 格式 | AUT-R23 |

### 首次設定與 admin 重設

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| AUT-AC23 | **已被取代**（由 AUT-AC54～AUT-AC64 取代，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。原驗收：以設定密碼的指令替負責人帳號設定密碼。該指令已移除（AUT-R24 已被取代） | | | AUT-R24（已取代） |
| AUT-AC24 | 初始化後的資料庫，內建 `admin` 已設定密碼 | 分別執行 `admin` 重設指令：兩次輸入不同；兩次相同但只有 7 字元；另在 `admin` 尚未設定密碼的資料庫執行一次 | 三次都回報失敗；`UserPassword` 筆數與內容不變，沒有新增稽核紀錄；第三次的失敗訊息提示改用初始化指令 | AUT-R47 |
| AUT-AC25 | 初始化後的資料庫，內建 `admin` 已設定密碼；執行環境設有 `INSPECTFLOW_PASSWORD`、`PASSWORD` 兩個環境變數，值為一組有效密碼 | 以 `--help` 取得重設指令的定義；再以空的標準輸入、另在指令列多加 `--password <有效密碼>` 各執行一次 | 指令列定義沒有任何接受密碼的選項，也沒有指定帳號的參數；空輸入時指令回報失敗、沒有使用環境變數的值；多加 `--password` 時指令以「不認得的參數」失敗；兩次 `UserPassword` 都沒有變動 | AUT-R47 |
| AUT-AC32 | **已被取代**（由 AUT-AC58 取代，[#259](https://github.com/speko-tw/inspect-flow/issues/259)）。原驗收：以設定密碼的指令替內建 `admin` 設定密碼後可登入。改由首次設定流程取得 `admin` 的第一個密碼 | | | AUT-R24（已取代） |
| AUT-AC54 | 初始化後的空資料庫（未做過任何設定） | 執行初始化指令；查詢 `SetupCode`、`UserPassword`、稽核紀錄與指令輸出 | 輸出恰有一組首次登入碼；`SetupCode` 恰一筆，`code_hash` 不等於輸出的碼、也無法在資料庫任何欄位找到明文，`expires_at` 為建立時間加 24 小時，`voided_at` 為空；內建 `admin` 沒有 `UserPassword`；稽核紀錄 0 筆；沒有 `Company`，也沒有 `admin` 以外的 `User` | AUT-R42、DOM-R53 |
| AUT-AC55 | 初始化後、`admin` 尚未設定密碼，已有舊碼 C1 | 再執行初始化指令，得到新碼 C2；分別以 C1、C2 呼叫 `POST /api/v1/setup/admin-password`（密碼有效）；接著在 `admin` 已設定密碼後再執行初始化指令 | 第二次執行時 C1 的 `SetupCode` 已填 `voided_at`、新增一筆有效的 C2，其餘資料筆數不變；C1 回 401 `setup.invalid_code`，C2 成功；`admin` 已設定密碼後的初始化指令拒絕並回報已初始化，不產生新碼、`SetupCode` 與其他資料都不變 | AUT-R43、DOM-R13 |
| AUT-AC56 | 初始化後、`admin` 尚未設定密碼、碼 C 有效；可控時間 | 呼叫 `GET /api/v1/setup/status`；以 C 與符合 AUT-R04 的密碼呼叫 `POST /api/v1/setup/admin-password`；再呼叫 `status`；再以同一組 C 呼叫第二次 | `status` 先回 `true` 後回 `false`；第一次成功（204），`admin` 有 `UserPassword` 且 `must_change_password` 為 `false`，`SetupCode` 已填 `voided_at`，回應帶 `admin` 的登入 Cookie 且該 Cookie 可呼叫 `me`；恰有一筆 `user.password_set` 稽核，操作者為內建 `admin`（系統事件，ALG-R18）；第二次回 409 `setup.already_completed` | AUT-R44、AUT-R25、ALG-R18 |
| AUT-AC57 | 初始化後、碼 C 有效；另備：已過期的碼（時間快轉 24 小時）、已作廢的碼、隨機錯碼 | 各以一種碼與有效密碼呼叫 `POST /api/v1/setup/admin-password` | 全部回 401，回應本體逐位元組相同（`error.code` 為 `setup.invalid_code`），沒有 `Set-Cookie`；`UserPassword`、SetupCode 的碼與有效狀態、稽核紀錄都不變。為符合 AUT-R45，隨機錯碼得更新目前有效 SetupCode 的失敗計數與鎖定欄位 | AUT-R44、AUT-R42、AUT-R45 |
| AUT-AC58 | 初始化後、碼 C 有效 | 以 C 與 7 字元的密碼呼叫；再以 C 與符合規則的密碼呼叫 | 第一次回 422 `auth.password_invalid`，`SetupCode` 未作廢、失敗計數不增加、`UserPassword` 未寫入；第二次成功，`admin` 可用帳號名稱 `admin` 與該密碼登入（取代 AUT-AC32 的驗證） | AUT-R44、AUT-R04、AUT-R05 |
| AUT-AC59 | 初始化後、碼 C 有效；可控時間；設有應用程式日誌擷取；另有一般帳號 U（AUT-AC27 的情境） | 在 15 分鐘內以隨機錯碼呼叫 10 次；再以正確的 C 呼叫；快轉到第 10 次失敗起滿 15 分鐘後再以 C 呼叫；另於鎖定前後，讓 U 各做 5 次密碼登入失敗 | 前 10 次回 401；鎖定期間以正確的 C 也回 401 `setup.invalid_code`，回應與一般失敗相同、沒有額外標頭；15 分鐘後 C 成功；被鎖時應用程式日誌有一筆紀錄、稽核紀錄 0 筆；日誌不含任何輸入的碼；U 的登入失敗計數只受自己的 5 次影響，首次登入碼的失敗不計入 U，也不解除 U 的鎖定 | AUT-R45、AUT-R28、AUT-R41 |
| AUT-AC60 | 初始化後、首次登入碼被鎖定中 | 再執行初始化指令；以新碼呼叫 | 新碼成功（重跑清除鎖定，AUT-R43；判讀，見 [AUT-Q7](#aut-q7)） | AUT-R43、AUT-R45 |
| AUT-AC61 | `admin` 已登入（首次設定之後），呼叫 Service 入口新增使用者 T 兩次：未勾「給予 admin 權限」與勾選；可用 [#263](https://github.com/speko-tw/inspect-flow/issues/263) 的新增使用者 API 驗證時以 API 為準 | 讀取建立回應；再嘗試以任何方式再次取得 T 的臨時密碼；T 以帳號名稱與臨時密碼登入 | 回應含一組符合 AUT-R04 的臨時密碼，只出現這一次；資料庫只存雜湊；`must_change_password` 為 `true`，T 登入後被要求先變更密碼（AUT-R33）；未勾選的 `is_admin` 為 `false`，勾選的為 `true` 並多一筆 `user.admin_changed`；勾選框預設值為不勾 | AUT-R46、AUT-R36、AUT-R33 |
| AUT-AC62 | 初始化後，`admin` 已設定密碼並登入兩個用戶端，且處於密碼登入鎖定狀態 | 以標準輸入提供兩次相同的有效密碼，執行 `make reset-admin-password`；再以新密碼與帳號名稱 `admin` 登入 | 指令成功；原本兩個用戶端的 `me` 回 401；鎖定與失敗計數已清除，新密碼登入回 200 且 `must_change_password` 為 `false`；恰有一筆 `user.password_set` 稽核，操作者為內建 `admin`（系統事件）；`created_by`、`updated_by` 為內建 `admin` | AUT-R47、AUT-R25、AUT-R28、AUT-R39 |
| AUT-AC63 | 初始化後、`admin` 尚未設定密碼 | 執行重設指令 | 指令拒絕、資料不變，並提示改用初始化指令（判讀，見 [AUT-Q7](#aut-q7)） | AUT-R47 |
| AUT-AC64 | 專案的指令清單（Makefile 與後端指令入口） | 檢查是否有可用來設定「一般使用者」密碼的指令，並執行 `make help` | 沒有一般的設定密碼指令；只有初始化與 `reset-admin-password` 兩種與密碼相關的指令 | AUT-R24（已取代）、AUT-R47 |
| AUT-AC65 | 前端登入頁與首次設定頁；`setup_required` 分別為 `true`、`false` | 未登入時開啟 Admin Web 根路徑；在 `false` 時直接開啟首次設定頁；在登入頁輸入 `anna.deng` 與 `anna.deng@demo.example`；在首次設定頁輸入錯碼；再以有效碼與密碼完成設定，並在新增第一個使用者的步驟送出 | `true` 時被導向首次設定頁；`false` 時首次設定頁不可進入（導向登入頁）；登入頁兩種輸入都能登入，欄位標示為「帳號名稱或 email」；錯碼只顯示一種通用訊息；設定成功後進入新增第一個使用者的步驟，送出後顯示一次臨時密碼，「給予 admin 權限」預設不勾（AUT-R46） | AUT-R29、AUT-R44、AUT-R46 |
| AUT-AC66 | 應用程式日誌與稽核紀錄擷取；完成一次首次設定、一次失敗的首次登入碼輸入、一次把密碼打在帳號欄的登入失敗 | 全文搜尋日誌與稽核紀錄 | 找不到首次登入碼（輸入與產生的）、密碼、雜湊、token、Cookie 值，也找不到登入失敗時輸入的帳號欄原文 | AUT-R41、AUT-R42 |

### 臨時密碼與變更密碼

以下的測試帳號 T 是啟用中、`is_admin = false` 的 `local` 帳號。

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| AUT-AC33 | 對空資料庫執行 `alembic upgrade head` 之後，以 ORM 新增一筆不指定 `must_change_password` 的 `UserPassword` | 用 SQLAlchemy inspector 檢查 `UserPassword` 資料表，讀回該筆；再新增一筆 `must_change_password` 為空值的資料 | 有 `must_change_password` 欄位且不可空值；讀回的值為 `false`；空值那一筆被資料庫拒絕，筆數不變 | AUT-R32 |
| AUT-AC34 | 初始化後的資料庫；`admin` 已由首次設定取得密碼；另有由 Admin 經 Service 入口新增的帳號 T | 各自登入後呼叫 `GET /api/v1/auth/me`；再以 `admin` 重設指令重設 `admin` 密碼並登入 | T 的 `UserPassword.must_change_password` 為 `true`，登入與 `me` 的本體 `must_change_password` 為 `true`；`admin` 首次設定與重設後的標記都是 `false`，本體為 `false` | AUT-R08、AUT-R37、AUT-R44、AUT-R47 |
| AUT-AC35 | T 的密碼標為臨時；一條僅存在於測試中、需登入的路由，處理函式會計數；一個 `external` 帳號 E，有一筆 `must_change_password = true` 的 `UserPassword`（模擬轉成外部帳號前留下的），由測試直接呼叫「建立登入狀態」的函式替 E 建立登入狀態 | T 登入，依序呼叫 `me`、測試路由、登出；E 以取得的 Cookie 呼叫測試路由 | T 登入 200 並取得 Cookie；`me` 200；測試路由 403 `auth.password_change_required`，處理函式計數為 0；登出 204；E 呼叫測試路由放行（標記不影響外部帳號） | AUT-R32、AUT-R33 |
| AUT-AC36 | 臨時密碼的允許清單 | 讀取允許清單，並比對正式應用程式的路由 | 清單恰為 `GET /api/v1/auth/me`、`POST /api/v1/auth/logout`、`POST /api/v1/auth/password`，每一條都存在於正式路由 | AUT-R33 |
| AUT-AC37 | T 的密碼標為臨時且已登入；E 同 AUT-AC35 | T 分別送出：錯誤的目前密碼；正確的目前密碼與 7 字元的新密碼；正確的目前密碼與「和目前密碼相同」的新密碼。E 以正確格式的本體呼叫變更密碼 | 依序回 400 `auth.current_password_incorrect`、422 `auth.password_invalid`、422 `auth.password_unchanged`、403 `permission.denied`；四次之後 T 的 `UserPassword`（雜湊與標記）不變，T 的登入狀態筆數不變 | AUT-R34 |
| AUT-AC38 | T 的密碼標為臨時，在三個用戶端 A、B、C 登入；記下 A 原本的 Cookie 值 | A 以正確的目前密碼與一組符合規則的新密碼呼叫變更密碼；之後 A 以回應換發的 Cookie 呼叫 AUT-AC35 的測試路由，另以 A 原本的 Cookie、B、C 呼叫 `me`；再分別以舊密碼、新密碼登入 | 變更回 204，`Set-Cookie` 帶新的 token（不等於原本的值，長度至少 43 個 base64url 字元，屬性同 AUT-AC05）；`must_change_password` 為 `false`，雜湊能驗證新密碼，`updated_by` 為 T；新 Cookie 呼叫測試路由放行；A 原本的 Cookie、B、C 都回 401，T 只剩一筆 `AuthSession`，其 `token_hash` 等於新 Cookie 值的 SHA-256；舊密碼登入 401、新密碼登入 200 | AUT-R09、AUT-R34、AUT-R35 |
| AUT-AC39 | 帳號 T 已登入兩個用戶端 | 直接呼叫設定密碼的 Service 入口：標為臨時設定一次，檢查後再不標為臨時設定一次；另以 7 字元的密碼呼叫一次 | 第一次後標記為 `true`、第二次後為 `false`，每次的雜湊都能驗證剛設定的密碼，兩個用戶端在第一次後都回 401；7 字元那一次被拒絕，`UserPassword` 不變 | AUT-R04、AUT-R25、AUT-R36 |
| AUT-AC40 | 共用錯誤碼列舉與由它產生的對照表（API-AC10） | 檢查對照表 | 含 `auth.password_change_required`、`auth.current_password_incorrect`、`auth.password_invalid`、`auth.password_unchanged`，且都符合 API-AC09 的 dot-namespace 格式 | AUT-R33、AUT-R34 |
| AUT-AC43 | 帳號 T 為 `is_admin = true`、`must_change_password = true`，已登入；T 是專案 P 的成員，角色含 `report.read`；AUT-AC17 的四條測試路由（需登入、需 Admin、需專案權限 `report.read`、本人或 Admin），處理函式會計數 | T 以 P 與自己為目標呼叫四條路由；再由測試把標記改為 `false`，重呼叫一次 | 第一次四條都回 403 `auth.password_change_required`，處理函式計數都是 0；標記清除後四條都放行 | AUT-R18、AUT-R33 |
| AUT-AC44 | 專案 P；Admin A 不是 P 的成員；非 Admin 的 U 是 P 的成員，角色只有 `report.read`；四條測試路由分別要求 `evidence.create`、`evidence.update`、`evidence.delete`、`report.approve` | A、U 各呼叫四條路由 | A：四條都放行；U：四條都回 403 `permission.denied` | AUT-R19 |

### 外部身分來源與登入失敗

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| AUT-AC26 | 一個 `local` 帳號，不經過登入 API，由測試直接呼叫「建立登入狀態」的函式 | 以回傳的 Cookie 呼叫 `me` | 200；建立登入狀態的函式簽章不含密碼參數 | AUT-R27 |
| AUT-AC27 | 一個 `local` 帳號 U，密碼為 P；以可控時間測試；未設定鎖定相關環境變數 | 在時間 T0 起 1 分鐘內以錯誤密碼登入 10 次（第 10 次在時間 L）；接著以 P 登入；在 L 加 14 分鐘以錯誤密碼再登入一次；在 L 加 15 分鐘減 1 秒、L 加 15 分鐘各以 P 登入一次 | 前 10 次都回 401 `auth.invalid_credentials`；L 之後、L 加 15 分鐘之前的三次（含 P）都回 401，狀態碼與回應本體和一般失敗完全相同，沒有 `Set-Cookie`；L 加 15 分鐘以 P 登入回 200 | AUT-R28 |
| AUT-AC45 | 同 AUT-AC27 的 U；可控時間 | 情境一：在時間 T0 以錯誤密碼登入 9 次，在 T0 加 15 分鐘減 1 秒再錯 1 次，接著以 P 登入。情境二（新帳號）：在 T0 錯 9 次，在 T0 加 15 分鐘再錯 1 次，接著以 P 登入 | 情境一以 P 登入回 401（第 10 次在 15 分鐘內，已鎖定）；情境二以 P 登入回 200（前 9 次經過剛好 15 分鐘，不再計入） | AUT-R28 |
| AUT-AC46 | 同 AUT-AC27 的 U；可控時間 | 在 1 分鐘內依序：錯 9 次、以 P 登入、再錯 9 次、以 P 登入、再錯 10 次、以 P 登入 | 前兩次以 P 登入都回 200（成功會清零，所以 18 次失敗沒有觸發鎖定）；連續錯 10 次後以 P 登入回 401 | AUT-R28 |
| AUT-AC47 | 同 AUT-AC27 的 U，已登入；可控時間 | 以錯誤的目前密碼呼叫變更密碼 API 5 次，再以錯誤密碼登入 5 次；接著以 P 登入，並以正確的目前密碼 P 與有效新密碼呼叫變更密碼 API | 以 P 登入回 401；變更密碼回 400 `auth.current_password_incorrect`，回應與一般的目前密碼錯誤相同；`UserPassword` 與登入狀態筆數不變 | AUT-R28、AUT-R34 |
| AUT-AC48 | 預設的環境（未設定鎖定相關環境變數），以及分別設定這三個環境變數的環境 | 讀取後端的鎖定設定 | 未設定時為 10 次、15 分鐘、15 分鐘；有設定時等於設定值；`.env.example` 列出這三個變數 | AUT-R28 |
| AUT-AC53 | 同 AUT-AC27 的 U；依 AUT-AC27 觸發鎖定（第 10 次在時間 L），鎖定仍在生效中 | 在鎖定期間，經設定密碼的 Service 入口（Admin 設定臨時密碼的畫面，或以測試直接呼叫入口）替 U 重設密碼 | 重設後立即以新密碼登入回 200（鎖定已解除、失敗計數已歸零）；重設前後 `AuthSession` 與 `UserPassword` 的筆數、`updated_by` 符合 AUT-R36 的一般寫入行為 | AUT-R28、AUT-R36 |
| AUT-AC67 | SQLite 資料庫；一個已知帳號（含密碼錯誤與正確密碼）、一個已鎖定帳號，以及一個未知帳號；以較短的 `INSPECTFLOW_SQLITE_BUSY_TIMEOUT_MS` 設定重現另一連線持有寫鎖 | 寫鎖仍被持有時分別呼叫三種登入情境；釋放寫鎖後再次登入未知與已鎖定帳號 | 寫鎖等待逾時的所有情境都回 503 `server.temporarily_unavailable`、`Retry-After: 5`，回應本體相同且沒有 `Set-Cookie`；逾時沒有新增或改變失敗計數、沒有建立 `AuthSession`，也沒有 `auth.login_failed` 日誌；鎖釋放後，未知與已鎖定帳號都回 401 `auth.invalid_credentials`、沒有 Cookie，且各記一筆對應的失敗日誌 | AUT-R28；`test_sqlite_write_lock_timeout_returns_retryable_error`、`test_locked_account_and_unknown_login_share_sqlite_timeout` |
| AUT-AC68 | `INSPECTFLOW_SQLITE_BUSY_TIMEOUT_MS` 分別設為 `1`、`60000`、`60001` 毫秒 | 啟動後端應用程式 | 1 與 60000 毫秒可啟動；60001 毫秒啟動失敗並指出變數名稱 | AUT-R28；`test_sqlite_busy_timeout_accepts_bounds`、`test_sqlite_busy_timeout_rejects_above_maximum` |
| AUT-AC69 | 專案 P；成員 U 有 `inspection_plan.read`；成員 F 只有 `inspection_task.inspect`；非成員 N；Admin A 不屬於 P | U、F、N、A 讀取 `GET /api/v1/projects/{project_id}`；A 另讀取不存在的專案 | U 回 200 且只含基本欄位；F、N 回 403 `permission.denied`；A 回完整欄位；不存在的專案回 404 `resource.not_found` | AUT-R19、DOM-R43 |
| AUT-AC70 | Admin；專案 P1、P2；U1 在 P1 只有 `project_member.manage`；U2 只有 `inspection_task.inspect`；U3 同時有兩者；U4 只有空角色；U5 在 P1 有 `inspection_task.read`；U6 在 P1 只有 `project_inspection_item.edit`；U7 沒有任何專案但具範本管理員系統角色 | 各呼叫 `GET /api/v1/auth/me`；再比較 U1 與在兩個專案各有多個權限碼的帳號所發出的 SELECT 數；另檢查權限碼分類表 | `(has_office_access, has_field_access, has_template_access)`：Admin 為全 `true`；U1 為 `(true, false, false)`；U2 為 `(false, true, false)`；U3 為 `(true, true, false)`；U4 為全 `false`；U5 為全 `false`（單獨的任務讀取兩邊都不算，ADM-R18）；U6 為 `(true, false, false)`；U7 為 `(false, false, true)`；SELECT 數不隨專案數或權限碼數增加；分類表的內業碼、現場碼與單獨任務讀取三組互斥，聯集恰為全部已註冊權限碼 | AUT-R08 |

### 稽核紀錄與日誌

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| AUT-AC49 | 初始化後的資料庫；一般帳號 U（由 Admin 經 Service 入口設定臨時密碼）與已設定密碼的內建 `admin`；`audit-log` 的寫入入口可用 | 以 Service 入口替 U 設定臨時密碼一次；以 `admin` 重設指令替 `admin` 重設一次；再執行一次兩次輸入不同的重設指令 | 前兩次各恰有一筆 `user.password_set`，`entity_id` 分別是 U 與內建 `admin`，`created_by` 都是內建 `admin`（Service 入口那次為實際操作的 Admin），`is_temporary` 符合 AUT-R37；失敗的那次沒有紀錄；紀錄的 `before`、`after` 序列化後不含輸入的密碼或雜湊 | AUT-R39、AUT-R41 |
| AUT-AC50 | 初始化後的資料庫；Admin A、一般帳號 U，U 已有一組非臨時的本地密碼；`audit-log` 的寫入入口可用 | A 經 Service 入口替 U 設定臨時密碼；U 登入後以變更密碼 API 改成新密碼；再以太短的新密碼、錯誤的目前密碼各呼叫一次 | 前兩次各恰有一筆 `user.password_set`，`entity_id` 是 U，`created_by` 依序是 A、U，`before.is_temporary`／`after.is_temporary` 依序為 `false`／`true`、`true`／`false`；被拒絕的兩次沒有紀錄；紀錄序列化後不含任何一組密碼、雜湊或 Cookie 值 | AUT-R39、AUT-R41 |
| AUT-AC51 | 同 AUT-AC27 的 U；可控時間 | 依 AUT-AC27 觸發鎖定（第 10 次在時間 L），鎖定期間再嘗試 2 次 | `audit_logs` 恰有一筆 `user.locked`，`entity_id` 是 U，`created_by` 是內建 `admin`，`after.locked_until` 等於 L 加 15 分鐘；鎖定期間的嘗試沒有新增紀錄；登入回應仍是 401 | AUT-R28、AUT-R39 |
| AUT-AC52 | 一個 `local` 帳號 U；測試攔截該 logger 的輸出 | 以正確密碼登入、登出；以錯誤密碼登入；以不存在的 email 登入；U 被鎖後以正確密碼登入 | 依序各有一筆 `auth.login_succeeded`、`auth.logout`、`auth.login_failed`（帳密不符）、`auth.login_failed`（`user_id` 為空值）、`auth.login_failed`（鎖定中）；`user_id` 正確；所有日誌的訊息與欄位都不含送出的密碼、Cookie 值、token 或送出的 email 原文；`audit_logs` 沒有登入、登出的紀錄 | AUT-R40、AUT-R41 |

### 前端

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| AUT-AC28 | 目前使用者 API 的測試替身回 401 | 分別渲染 `/admin` 與 `/field` | 兩者都導向 `/login`，並保留原本的路徑；登入 API 的替身回 200 後送出表單，畫面回到原本的路徑 | AUT-R29 |
| AUT-AC29 | 登入 API 的測試替身回 401 `auth.invalid_credentials` | 在登入頁送出表單 | 顯示一則通用錯誤訊息，文字不因失敗原因而不同；密碼欄位的 `type` 為 `password` | AUT-R29 |
| AUT-AC30 | 已登入的畫面；測試監看 `localStorage`、`sessionStorage` 與 `fetch` | 完成登入、瀏覽、登出 | 登入與登出請求以 `credentials: 'same-origin'`（或預設）送出，前端沒有自行設定 Cookie 或 `Authorization` 標頭；`localStorage`、`sessionStorage` 沒有被寫入；登出後呼叫了登出 API 並導向 `/login` | AUT-R30 |
| AUT-AC41 | 目前使用者 API 的測試替身回 200、`must_change_password` 為 `true` | 分別渲染 `/admin` 與 `/field`；在變更密碼頁送出表單，變更密碼 API 的替身回 204，目前使用者的替身改回 `must_change_password` 為 `false` | 兩者都導向 `/change-password`，並保留原本的路徑；送出成功後畫面回到原本的路徑 | AUT-R38 |
| AUT-AC42 | 變更密碼頁；變更密碼 API 的替身依序回 400 `auth.current_password_incorrect`、422 `auth.password_invalid`、422 `auth.password_unchanged` | 先在兩個新密碼欄位輸入不同的值送出；再輸入相同的值送出三次 | 兩次新密碼不同時沒有呼叫 API，並顯示不一致的訊息；三次錯誤各顯示一則不同的訊息；三個密碼欄位的 `type` 都是 `password` | AUT-R38 |

### 資料表

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| AUT-AC31 | 對空資料庫執行 `alembic upgrade head` 之後，已有一筆 `User` 與它的 `UserPassword`、`AuthSession`，以及一筆 `SetupCode` | 用 SQLAlchemy inspector 檢查 `UserPassword`、`AuthSession`、`SetupCode` 資料表；再分別新增：同一個 `User` 的第二筆 `UserPassword`；`token_hash` 與既有相同的 `AuthSession`；`user_id` 指向不存在 UUID 的兩種資料；`password_hash`、`token_hash`、`expires_at`、`created_by` 為空值的資料；`code_hash`、`expires_at`、`created_by`、`failed_attempts` 為空值的 `SetupCode` | 三張表都有 UUID 主鍵、[資料](#資料)列出的欄位（`must_change_password` 由 AUT-AC33 驗收，不在本條範圍）與建立及修改紀錄欄位，`user_id` 外鍵指向 `User`；`SetupCode` 的 `voided_at`、`failure_window_started_at`、`locked_until` 可空值，`code_hash`、`expires_at`、`failed_attempts` 不可空值，`failed_attempts` 為整數、未指定時預設 0（新增一筆沒有提供它的 `SetupCode`，讀回為 0）；每一次錯誤寫入都被資料庫拒絕，筆數不變；`User` 資料表沒有任何密碼或 token 欄位 | AUT-R01、AUT-R03、AUT-R11、AUT-R42、AUT-R45 |

AUT-R31 屬設計約束，由 AUT-AC16～AUT-AC21 的後端測試保證：前端怎麼隱藏功能，都不影響後端的判斷。

AUT-R20～AUT-R22 中「哪些端點必須使用哪一層」的部分（管理人員、公司、角色定義的端點；修改聯絡欄位的端點；指派角色的端點），本規格只驗收檢查元件本身（AUT-AC18～AUT-AC21）；端點實際使用哪一層，由提供那些端點的功能規格驗收：人員與公司的簡易管理端點屬 0.2.x（[#263](https://github.com/speko-tw/inspect-flow/issues/263)，負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）），進階功能與角色、專案成員的管理端點屬 `admin-dashboard`。

## 待釐清

撰寫中發現、intents 沒有依據、需要負責人選定的細節。每題附選項與建議；裁定後屬規格澄清，在實作該任務的 PR 內更新本規格。

<a id="aut-q1"></a>
- **AUT-Q1：登入狀態的絕對期限與閒置期限預設值**（已裁定，[#143](https://github.com/speko-tw/inspect-flow/issues/143)；AUT-R15、AUT-AC13、AUT-AC15）。OWASP 建議一般辦公用途絕對期限 4～8 小時、低風險系統閒置期限 15～30 分鐘。選項：（A）閒置 30 分鐘、絕對 8 小時，符合 OWASP；（B）閒置 2 小時、絕對 12 小時，現場查核人員拍照、走動時不容易被登出，但超出 OWASP 範圍；（C）不設閒置期限，絕對 7 天，最方便，風險最高。**建議 A**，現場使用若反映太常被登出，再以環境變數調長。影響計畫 T3。
  - **裁定**（負責人，[#143](https://github.com/speko-tw/inspect-flow/issues/143)，2026-09-26）：閒置期限 60 分鐘、絕對期限 8 小時。裁定留言標為選項 B，但數值與上列三個選項都不同，以這裡的數值為準。依據：OWASP Session Management Cheat Sheet 對整天使用的辦公系統，絕對期限建議 4～8 小時，低風險系統閒置期限建議 15～30 分鐘；NIST SP 800-63B（第 4 版）§2.2.3 要求 AAL2 設定絕對的重新認證期限，並建議絕對期限不超過 24 小時、閒置期限不超過 1 小時（兩個數值上限都是建議，不是強制）。現場工程師在查核點之間移動時常有一段時間沒有操作，閒置期限放寬到 60 分鐘，避免在現場被登出。60 分鐘仍在 NIST AAL2 的範圍內，但高於 OWASP 對低風險系統建議的 30 分鐘，這是依使用情境接受的取捨。
  - **落地**：寫進 AUT-R15、AUT-AC13、AUT-AC15；實作由計畫 T3 負責。
<a id="aut-q2"></a>
- **AUT-Q2：Admin 是否也通過新增、刪除與特殊動作（例如簽核、匯出列印）的權限檢查**（已裁定，[#144](https://github.com/speko-tw/inspect-flow/issues/144#issuecomment-5852180954)；AUT-R19、AUT-AC44）。以下是裁定前的討論紀錄。[KD-24](../../intents/03-decisions-and-stack.md#kd-24) 寫「查看、修改所有專案」，[KD-25](../../intents/03-decisions-and-stack.md#kd-25) 把讀取、新增、修改、刪除與特殊動作分列，因此本規格只把讀取、修改視為已裁定。選項：（A）Admin 通過所有專案權限代碼，含新增、刪除與特殊動作；（B）Admin 通過讀取、新增、修改、刪除，特殊動作仍要專案角色；（C）Admin 只通過讀取、修改，其餘都要專案角色。裁定前建議 A：Admin 本來就能把自己加進專案並指派任何角色，B、C 只多一道手續，擋不住 Admin；若簽核要求「本人親自具備角色」，應在該功能規格另訂。當時寫影響計畫 T4。
  - **裁定**（負責人，[#144](https://github.com/speko-tw/inspect-flow/issues/144#issuecomment-5852180954)，2026-09-27）：選 A。Admin 通過所有專案權限代碼，含新增、刪除與特殊動作，不必是專案成員。理由：B、C 只多一道手續、擋不住 Admin，規則最簡單。簽核若要求「本人親自具備角色」，由該功能規格（例如 `report-delivery`）另訂；Admin 的角色與 `is_admin` 變更依 `audit-log` 規格寫稽核紀錄。
  - **落地**：AUT-R19 改寫為 Admin 一律放行、刪除「待裁定」的例外；AUT-R22 改引用 AUT-R19；新增 AUT-AC44。實作由計畫 T4（[#152](https://github.com/speko-tw/inspect-flow/issues/152)）負責。
<a id="aut-q3"></a>
- **AUT-Q3：密碼長度與字元規則**（已裁定，[#145](https://github.com/speko-tw/inspect-flow/issues/145)；AUT-R04、AUT-AC04）。以下是裁定前的討論紀錄。OWASP：沒有多因素認證時，短於 15 字元視為弱密碼；上限至少 64 字元；不建議強制字元組成規則。當時的選項：（A）下限 15、上限 128、不限字元組成，符合 OWASP；（B）下限 12、上限 128，較好記，但低於 OWASP 無 MFA 時的建議；（C）下限 8，另要求大小寫、數字、符號。裁定前建議 A，當時寫影響計畫 T1；裁定後長度規則併入 T6，實際影響計畫 T6。
  - **裁定**（負責人，[#145](https://github.com/speko-tw/inspect-flow/issues/145)，2026-09-26）：不採上述三個選項。最短 8 字元、最長 128 字元（只用來防止超長輸入拖慢雜湊運算）；不要求字元組成；不強制定期更換，只有在有證據顯示密碼外洩時才要求更換；常見密碼黑名單這次不做，等之後改用外部身分來源（LDAP／AD）登入時再一併評估。
  - **取捨**（照實記錄）：NIST SP 800-63B（第 4 版）§3.1.1.2 對只用密碼登入規定（SHALL）最短 15 字元，並規定（SHALL）檢查常見或已外洩的密碼；搭配多因素驗證時，最短是 8 字元。本裁定的最短 8 字元低於 NIST 對單一因素的規定，也沒有做黑名單，**不符合** NIST 對只用密碼登入的規定。負責人的考量：系統在公司內網使用；現場用手機輸入長密碼負擔大；之後會改用公司的 LDAP／AD 帳號，或加入驗證碼等多因素驗證，屆時本系統的密碼不再是主要的登入方式，因此接受這個取捨，規則以簡單為原則。加入多因素驗證後，最短 8 字元這一項就符合 NIST 的規定；黑名單仍要另外評估。
  - **落地**：寫進 AUT-R04、AUT-AC04，黑名單寫成「不包含」的排除項；長度規則由計畫 T6（[#154](https://github.com/speko-tw/inspect-flow/issues/154)）實作，T1 不受影響。
<a id="aut-q4"></a>
- **AUT-Q4：之後建立的帳號怎麼取得第一次的密碼，以及內建 `admin` 能不能登入**（已裁定，[#146](https://github.com/speko-tw/inspect-flow/issues/146)；AUT-R24、AUT-R32～AUT-R38）。以下是裁定前的討論紀錄。本規格原本只提供部署人員執行的指令（AUT-R24）。Admin 在畫面上建立帳號後，被建立的人怎麼拿到密碼，#54 沒有規定。選項：（A）先只用指令，畫面上的重設與自助變更密碼另開規格；（B）`admin-dashboard` 提供「Admin 設定臨時密碼，首次登入強制變更」；（C）以 email 寄送設定密碼的連結（需要寄信服務，目前沒有）。**建議 A**，等 `admin-dashboard` 開工時再決定是否擴充為 B。另外，內建 `admin`（`is_system`）是否可以設定密碼並登入：選項（甲）可以，作為負責人帳號無法使用時的備援；（乙）不行，只作為系統操作者，指令拒絕替它設定密碼。**建議甲**，並由部署人員妥善保管密碼。當時寫：裁定前，AUT-R24 對內建 `admin` 的行為不定義；計畫 T6 在裁定後才開工。
  - **裁定**（負責人，[#146](https://github.com/speko-tw/inspect-flow/issues/146)，2026-09-26）：第一題選 B，由 Admin 設定臨時密碼，本人第一次登入時強制變更；理由是本系統在企業內部使用，這是內網系統常見的做法。`authentication` 補後端機制（臨時密碼標記、首次登入強制變更、變更密碼的流程與頁面）；「Admin 在畫面上設定臨時密碼」的操作介面屬 `admin-dashboard`，在那之前帳號密碼仍由部署人員以指令設定（AUT-R24）。外部來源帳號（`auth_source = external`）交給 AD／LDAP 驗證，本系統不保存外部密碼，也不使用本地密碼；轉成外部來源時要不要刪除本地密碼，留給 `external-identity-sync`。第二題選甲，內建 `admin` 可以設定密碼並登入，作為負責人帳號無法使用時的緊急備援帳號（業界稱 break-glass 帳號），密碼由部署人員保管，平常使用個人帳號。
  - **後續變更**（負責人裁定，[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）：第二題已被取代。內建 `admin` 仍可設定密碼並登入（緊急備援帳號的用途不變），但取得密碼的方式改為初始化指令印出的首次登入碼與網頁上的首次設定（AUT-R42～AUT-R44），不再用設定密碼的指令；`admin` 忘記密碼時用 `make reset-admin-password`（AUT-R47）。第一題保留：Admin 設定臨時密碼、首次登入強制變更；「在那之前由部署人員以指令設定（AUT-R24）」已被取代，改為 Admin 新增使用者時由系統產生臨時密碼（AUT-R46），簡易管理畫面提前到 0.2.x。新增 AUT-R42～AUT-R47、AUT-AC54～AUT-AC66，AUT-R24、AUT-AC23、AUT-AC32 已被取代。
  - **落地**：AUT-R24 寫明可指定內建 `admin`（AUT-AC32）；新增 AUT-R32～AUT-R38 與 AUT-AC33～AUT-AC43；AUT-R08、AUT-AC08 的目前使用者回應加上 `must_change_password`；「不包含」改寫畫面上設定密碼的歸屬，並排除臨時密碼的有效期限。實作由計畫 T4（[#152](https://github.com/speko-tw/inspect-flow/issues/152)）、T6（[#154](https://github.com/speko-tw/inspect-flow/issues/154)）與新增的 T9、T10、T11 負責。
<a id="aut-q5"></a>
- **AUT-Q5：登入失敗鎖定**（已裁定，[#147](https://github.com/speko-tw/inspect-flow/issues/147)；AUT-R28、AUT-AC27、AUT-AC45～AUT-AC48、AUT-AC53）。以下是裁定前的討論紀錄。OWASP 建議依帳號計算、鎖定時間可遞增，並提醒鎖定可能被用來阻擋他人登入。選項：（A）15 分鐘內失敗 10 次，鎖定 15 分鐘；（B）失敗 5 次後開始遞增延遲（1、2、4…分鐘，上限 1 小時）；（C）MVP 不做，只在內網使用。**建議 A**：規則簡單、好測試，10 次的門檻讓一般打錯密碼不會被鎖。鎖定是否要寫稽核紀錄，併入 AUT-Q6。當時寫：影響計畫 T8，裁定前 T8 不開工。
  - **裁定**（負責人，[#147](https://github.com/speko-tw/inspect-flow/issues/147)，2026-09-27）：選 A。依帳號計算，15 分鐘內失敗 10 次鎖定 15 分鐘，時間到自動解鎖；鎖定期間的回應與一般失敗相同；登入與變更密碼 API（驗證目前密碼）共用同一個失敗計數。理由：規則簡單好測；10 次門檻讓一般打錯不會被鎖；自動解鎖降低帳號被故意鎖住的影響（內網風險低）；最短 8 字元的密碼（AUT-Q3）需要限制猜測次數。鎖定是否寫稽核紀錄併入 AUT-Q6。
  - **落地**：寫進 AUT-R28、AUT-AC27、AUT-AC45～AUT-AC48；計算方式、成功清零、鎖定期間不延長等細節是本規格依 OWASP 的推導。實作由計畫 T8（[#156](https://github.com/speko-tw/inspect-flow/issues/156)）負責，變更密碼 API 的計數與 T11（[#192](https://github.com/speko-tw/inspect-flow/issues/192)）銜接，見計畫 T8。負責人後續補充裁定（[#192](https://github.com/speko-tw/inspect-flow/issues/192#issuecomment-5853201917)，2026-09-27）：經設定密碼的 Service 入口重設密碼時（指令、日後 Admin 設定臨時密碼；[#259](https://github.com/speko-tw/inspect-flow/issues/259) 之後指令只剩 `admin` 重設指令）一併清除失敗計數並解除鎖定，寫進 AUT-R28 細節（6）與新增的 AUT-AC53；測試由持有鎖定模組的 T8 實作，T11 只在 Service 入口留呼叫點，見計畫 T8、T11。
<a id="aut-q6"></a>
- **AUT-Q6：登入、登出、設定密碼、登入失敗是否寫稽核紀錄**（已裁定，[#148](https://github.com/speko-tw/inspect-flow/issues/148)；AUT-R39～AUT-R41、AUT-AC49～AUT-AC52）。以下是裁定前的討論紀錄。[KD-29](../../intents/03-decisions-and-stack.md#kd-29) 只要求權限與角色的變更寫稽核紀錄；登入事件沒有 intents 依據。稽核紀錄的資料模型由 `audit-log` 定義（[#203](https://github.com/speko-tw/inspect-flow/issues/203)）。選項：（A）不寫，只保留 `AuthSession` 與 `UserPassword` 的建立及修改紀錄；（B）設定密碼寫、登入事件不寫；（C）全部寫。當時建議 A，等 `audit-log` 定案後再評估 B。
  - **裁定**（負責人，[#148](https://github.com/speko-tw/inspect-flow/issues/148)，2026-09-27）：選 D（不在上列選項）。設定或變更密碼（含 Admin 設臨時密碼、本人變更、設定密碼指令）與帳號被鎖寫稽核紀錄；登入成功、登入失敗、登出寫應用程式日誌，不進資料庫；任何紀錄都不得含密碼（含錯誤的密碼）或 token。（[#259](https://github.com/speko-tw/inspect-flow/issues/259) 之後補充：「設定密碼指令」改為 `admin` 重設指令與首次設定，兩者都是系統事件、操作者 `admin`；首次登入碼被鎖寫應用程式日誌、不寫稽核，也不得記錄任何碼。見 AUT-R39、AUT-R41、AUT-R45。）理由：OWASP 建議這些事件都要留紀錄；少見且重要的放稽核紀錄，頻繁的放日誌，避免稽核紀錄被淹沒。IP 等來源資訊屬 ALG-Q5，另行裁定。
  - **落地**：寫進 AUT-R39～AUT-R41、AUT-AC49～AUT-AC52；`audit-log` 登記 `user.password_set`、`user.locked` 兩種事件（ALG-R15～ALG-R17）。實作：指令、Service 入口與變更密碼都由 T11（[#192](https://github.com/speko-tw/inspect-flow/issues/192)，指令經 Service 入口寫入）、鎖定由 T8（[#156](https://github.com/speko-tw/inspect-flow/issues/156)）、日誌由新增的 T12 負責；寫稽核紀錄的任務都依賴 `audit-log` T2（[#216](https://github.com/speko-tw/inspect-flow/issues/216)）。

<a id="aut-q7"></a>
- **AUT-Q7：首次設定與帳號名稱登入的判讀**（已裁定，[#259](https://github.com/speko-tw/inspect-flow/issues/259)；判讀已由負責人確認（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）；AUT-R05、AUT-R42～AUT-R47、AUT-AC54～AUT-AC66）。
  - **裁定**（負責人，[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）：初始化指令建立資料庫與內建 `admin`，不預建角色（負責人裁定 #261，2026-09-29；角色由 Admin 之後在系統內新增），並印出一次性首次登入碼（24 小時有效、只存雜湊；15 分鐘內輸錯 10 次鎖 15 分鐘，計數與密碼登入分開，被鎖寫應用程式日誌、不寫稽核）；初始化不問公司與個人資料、不設密碼；`admin` 沒有密碼時重跑會作廢舊碼並印新碼，設定密碼後拒絕；網頁流程是輸入首次登入碼、設定 `admin` 密碼（碼作廢）、新增第一個使用者（系統產生臨時密碼、只顯示一次、首次登入強制變更、「給予 admin 權限」勾選框預設不勾）；`admin` 忘記密碼用伺服器端 `make reset-admin-password`（互動輸入兩次、寫稽核），一般的設定密碼指令移除；輸入含 `@` 用 email 登入，否則用帳號名稱。
  - **判讀，已確認**（裁定沒有說明，本規格自行推導，已由負責人確認（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29））：
    1. **重跑初始化是否清除首次登入碼的失敗鎖定**（AUT-R43、AUT-AC60）：本規格寫「清除」（重跑會新增一列 `SetupCode`，計數與鎖定存在該列，新列從 0 開始），理由是部署人員已能在伺服器上操作，再擋沒有意義；若要保留鎖定，改 AUT-R43 與 AUT-AC60。
    2. **首次設定成功後直接登入**（AUT-R44）：本規格讓回應帶 `admin` 的登入 Cookie，第三步才不必再登入一次；若要求重新登入，只影響 AUT-R44 與 AUT-AC56、AUT-AC65。
    3. **之後每一位由 Admin 新增的使用者都由系統產生臨時密碼**（AUT-R46）：裁定只寫第一個使用者；本規格讓所有新增走同一條路徑，避免有兩套建立密碼的方式。
    4. **`admin` 沒有密碼時，重設指令拒絕並提示改用初始化指令**（AUT-R47、AUT-AC63）：裁定沒有說明這種情況，避免繞過首次登入碼的流程。
    5. **首次登入碼的鎖定以整個系統為單位、門檻沿用 AUT-R28 的數值與常數做法**（AUT-R45）：裁定只給 10 次與 15 分鐘，沒有說計數的單位。密碼不符 AUT-R04 不計入失敗次數，因為碼本身是對的。
    6. **請求欄位名稱 `login`、比對前去除前後空白**（AUT-R05）；**首次登入碼至少 128 位元隨機量、用 AUT-R01 的雜湊函式儲存**（AUT-R42）；**`SetupCode` 獨立成表**（[資料](#資料)）：都是實作細節的建議，可由計畫調整，不影響裁定。
  - **落地**：新增 AUT-R42～AUT-R47、AUT-AC54～AUT-AC66；AUT-R24、AUT-AC23、AUT-AC32 已被取代；改寫 AUT-R04～AUT-R06、AUT-R08、AUT-R09、AUT-R18、AUT-R20、AUT-R26、AUT-R28、AUT-R29、AUT-R36、AUT-R37、AUT-R39、AUT-R41 與 AUT-AC04～AUT-AC06、AUT-AC08、AUT-AC16、AUT-AC24、AUT-AC25、AUT-AC34、AUT-AC49、AUT-AC53。實作由計畫「本次變更後續實作」的 C（[#261](https://github.com/speko-tw/inspect-flow/issues/261)）、D（[#262](https://github.com/speko-tw/inspect-flow/issues/262)）、E（[#263](https://github.com/speko-tw/inspect-flow/issues/263)）、F（[#264](https://github.com/speko-tw/inspect-flow/issues/264)）、H（[#266](https://github.com/speko-tw/inspect-flow/issues/266)）負責。

本規格另依賴 `domain-model` 的下列題目；尚未裁定的，本規格不自行定案：

- [DOM-Q2](../domain-model/spec.md#dom-q2)（email 比對是否不分大小寫）：已裁定（[#122](https://github.com/speko-tw/inspect-flow/issues/122)），不分大小寫，AUT-R05 已依此寫定；計畫 T3 不再受本題擋。
- [DOM-Q3](../domain-model/spec.md#dom-q3)（權限代碼命名規則與清單）：已裁定（[#123](https://github.com/speko-tw/inspect-flow/issues/123)），代碼登記在程式內的登記表（DOM-R35）；AUT-R22 用哪個代碼，由登記它的規格決定。
- [DOM-Q6](../domain-model/spec.md#dom-q6)（稽核紀錄由哪份規格定義）：已裁定（[#126](https://github.com/speko-tw/inspect-flow/issues/126)），另開 `audit-log`（[#203](https://github.com/speko-tw/inspect-flow/issues/203)）；[AUT-Q6](#aut-q6) 也已裁定（[#148](https://github.com/speko-tw/inspect-flow/issues/148)）。
- [DOM-Q7](../domain-model/spec.md#dom-q7)（`is_active` 預設值；`Company` 停用後其人員能不能登入）：已裁定（[#127](https://github.com/speko-tw/inspect-flow/issues/127)）。人員能不能登入只看 `User.is_active`，不需要檢查公司狀態；AUT-R06、AUT-R14 維持現狀（見 DOM-R32）。
- [DOM-Q9](../domain-model/spec.md#dom-q9)（帳號名稱與公司欄位連動的判讀）：已裁定（負責人確認（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29））；本規格只用到其中「內建 `admin` 的 email 選填」與 email 前段回填兩點，都不影響 AUT-R05 的比對規則。

## 變更紀錄

凍結後的「範圍變更」以上才記；一行寫改了什麼與 issue 連結。

- AUT-Q1 裁定：AUT-R15 寫入預設值閒置 60 分鐘、絕對 8 小時，以及邊界（絕對期限滿即失效、閒置剛好等於期限仍有效）；AUT-AC13 改用預設值，驗證絕對期限未滿（A 減 1 秒）與剛好到期（A）、閒置期限剛好到期（I）與超過（I 加 1 秒）時的結果，AUT-AC15 寫明預設值 — #143
- 依 AUT-Q3 裁定，AUT-R04 定為長度 8～128 字元、不要求字元組成、不強制定期更換，AUT-AC04 改為具體邊界值並補只含小寫字母的情境，「不包含」新增常見密碼黑名單 — [#145](https://github.com/speko-tw/inspect-flow/issues/145)
- 依 AUT-Q4 裁定，AUT-R24 可指定內建 `admin`，新增臨時密碼與首次登入強制變更（AUT-R32～AUT-R38、AUT-AC32～AUT-AC43），AUT-R08、AUT-AC08 的目前使用者回應加上 `must_change_password`，「不包含」改寫 Admin 設定臨時密碼的歸屬並排除臨時密碼的有效期限 — [#146](https://github.com/speko-tw/inspect-flow/issues/146)
- 依 AUT-Q2 裁定，AUT-R19 改為 Admin 通過所有專案權限代碼（含新增、刪除與特殊動作），AUT-R22 改引用 AUT-R19，新增 AUT-AC44 — [#144](https://github.com/speko-tw/inspect-flow/issues/144)
- 依 AUT-Q5 裁定，AUT-R28 定為依帳號 15 分鐘內失敗 10 次鎖定 15 分鐘、自動解鎖，登入與變更密碼共用計數；AUT-AC27 改為具體邊界，新增 AUT-AC45～AUT-AC48 — [#147](https://github.com/speko-tw/inspect-flow/issues/147)
- 範圍變更（負責人指示，#407）：既有使用者與公司列表加入 `q` 搜尋及 cursor 分頁，回應改為 `{items,next_cursor}`，依各自欄位與 UUID 穩定排序 — [#407 維護者留言](https://github.com/speko-tw/inspect-flow/issues/407#issuecomment-5979672050)。
- 依 AUT-Q6 裁定，新增 AUT-R39～AUT-R41（設定密碼與帳號被鎖寫稽核紀錄；登入、登出寫應用程式日誌；紀錄不得含密碼或 token）與 AUT-AC49～AUT-AC52，「範圍」的稽核紀錄段改寫 — [#148](https://github.com/speko-tw/inspect-flow/issues/148)
- 負責人裁定：AUT-R28 補上細節（6），經設定密碼的 Service 入口重設密碼（指令、Admin 設定臨時密碼）時一併清除失敗計數並解鎖；新增 AUT-AC53；落地由 T11 的 Service 入口留呼叫點，實際計數、解鎖與測試由 T8 接上 — [#192](https://github.com/speko-tw/inspect-flow/issues/192#issuecomment-5853201917) 裁定
- 範圍變更（admin 與帳號重新設計）：新增首次登入碼、首次設定公開路由、首次登入碼失敗鎖定、新增使用者的臨時密碼與勾選框、`admin` 重設指令（AUT-R42～AUT-R47、AUT-AC54～AUT-AC66、`SetupCode`、AUT-Q7）；AUT-R24、AUT-AC23、AUT-AC32 已被取代（一般使用者的設定密碼指令移除）；改寫 AUT-R04～AUT-R06、AUT-R08、AUT-R09、AUT-R18、AUT-R20、AUT-R26、AUT-R28、AUT-R29、AUT-R36、AUT-R37、AUT-R39、AUT-R41 與對應驗收；AUT-Q4 第二題標為已被取代；目的、範圍、不包含、使用情境與介面同步改寫；人員與公司的簡易管理改屬 0.2.x（#263、#265） — [#259](https://github.com/speko-tw/inspect-flow/issues/259)
- 規格澄清（審查修正）：AUT-AC31 增列 `SetupCode` 的欄位、可空性與外鍵斷言（資料表與 migration 由 #260 建立）；AUT-R29、AUT-AC65 明定首次設定後的「新增第一個使用者」步驟由首次設定流程提供、呼叫新增使用者 API（#263）；帳號名稱欄位統一稱 `username`；規格內引用 domain-model 的範圍不再含已被取代的 DOM-R01 — [#259](https://github.com/speko-tw/inspect-flow/issues/259)
- 規格澄清（審查修正，第 2 輪）：`SetupCode` 增列 `failed_attempts`、`failure_window_started_at`、`locked_until`，首次登入碼的失敗計數與鎖定存在有效那一列（AUT-R45、AUT-AC31）；AUT-R08 明定 `username` 必填、只有內建 `admin` 的 `email` 與 `name_zh` 可為 `null`；`name_en` 對所有帳號選填，AUT-AC08 對齊 — [#259](https://github.com/speko-tw/inspect-flow/issues/259)
- 規格澄清：AUT-AC57 的 SetupCode 不變不包含 AUT-R45 的失敗計數與鎖定欄位；隨機錯碼仍計入目前有效碼的鎖定計數 — [#261](https://github.com/speko-tw/inspect-flow/issues/261)
- 規格澄清：首次設定成功並建立登入狀態時，也寫 `auth.login_succeeded` 應用程式日誌，比照 AUT-R40 — [#261](https://github.com/speko-tw/inspect-flow/issues/261)
- 負責人裁定（#261，2026-09-29）：初始化不再預建三個範本角色，角色由 Admin 之後在系統內新增；更新初始化流程的裁定紀錄，權限模型與首次登入碼流程不變 — [#261](https://github.com/speko-tw/inspect-flow/issues/261)
- 規格澄清（#320、#321）：新增可設定且啟動時驗證的 SQLite 登入寫鎖等待上限；明定已知、未知與已鎖定帳號逾時都回 503、`Retry-After: 5`、不設 Cookie，且不新增登入失敗副作用 — [#320](https://github.com/speko-tw/inspect-flow/issues/320)、[#321](https://github.com/speko-tw/inspect-flow/issues/321)
- 範圍變更（負責人指示，#290）：AUT-R08、AUT-AC08 與介面表的目前使用者 API 新增 `company`（`{id, name}`，可為 `null`）、`department`、`location`、`employee_no`，供我的工作台顯示「我的公司」；登入 API 的成功回應與目前使用者 API 完全相同，也帶這四個欄位（審查第 1 輪裁定） — [#290](https://github.com/speko-tw/inspect-flow/issues/290)
- 範圍變更（負責人指示，[#480](https://github.com/speko-tw/inspect-flow/issues/480#issuecomment-6013263124)）：AUT-R08 與介面表的目前使用者 API 新增 `has_office_access`、`has_field_access`、`has_template_access`（登入 API 同步），前端依此決定登入落點與管理頁導覽；AUT-AC08 補欄位，新增 AUT-AC70；欄位與分類細節為規格設計（非負責人裁定） — [#480](https://github.com/speko-tw/inspect-flow/issues/480#issuecomment-6013263124)
