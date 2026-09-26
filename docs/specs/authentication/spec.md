# 認證與授權（authentication）

**代碼**：`AUT`　**Phase**：P2　**狀態**：已凍結
**前置規格**：`domain-model`（`User`、`Company`、`Role`、`ProjectMember`、初始化指令、目前操作者入口，見 DOM-R01～DOM-R27）、`database-foundation`（UUID 主鍵與建立及修改紀錄，見 DBF-R11、DBF-R14）、`api-conventions`（`/api/v1`、錯誤 envelope 與 `error.code`，見 API-R01～API-R07）
**引用意圖**：[PR-01](../../intents/02-principles.md#pr-01)、[PR-08](../../intents/02-principles.md#pr-08)、[PR-18](../../intents/02-principles.md#pr-18)、[KD-17](../../intents/03-decisions-and-stack.md#kd-17)、[KD-18](../../intents/03-decisions-and-stack.md#kd-18)、[KD-20](../../intents/03-decisions-and-stack.md#kd-20)～[KD-31](../../intents/03-decisions-and-stack.md#kd-31)、[OQ-08](../../intents/05-open-questions.md#oq-08)（已裁定）、[OQ-13](../../intents/05-open-questions.md#oq-13)（已裁定）
**被擋議題**：無（登入機制與密碼雜湊見 [OQ-13](../../intents/05-open-questions.md#oq-13)，權限機制見 [OQ-08](../../intents/05-open-questions.md#oq-08)，皆已裁定）。個別數值與細節待本規格的[待釐清](#待釐清)與 `domain-model` 的 DOM-Q2、DOM-Q3、DOM-Q6，只擋對應任務，不擋本規格

## 目的

人員用 email 與密碼登入後，伺服器保存他的登入狀態；後端對每個請求預設拒絕，只放行已登入、而且有對應權限的人：Admin 可以查看、修改所有專案，其他人依他在該專案的角色權限加總。停用人員時，他既有的登入立即失效（依據：架構基準 §17；[KD-21](../../intents/03-decisions-and-stack.md#kd-21)、[KD-24](../../intents/03-decisions-and-stack.md#kd-24)～[KD-31](../../intents/03-decisions-and-stack.md#kd-31)，負責人決定 #63、#82，2026-09-26）。

## 範圍

**包含**：

- email＋密碼登入、登出、取得目前使用者的 API（[KD-18](../../intents/03-decisions-and-stack.md#kd-18)、[KD-30](../../intents/03-decisions-and-stack.md#kd-30)）。
- 伺服器端登入狀態（本規格稱 `AuthSession`）與 HttpOnly Cookie：產生、驗證、有效期限、登出、停用人員後立即失效（[KD-21](../../intents/03-decisions-and-stack.md#kd-21)、[KD-30](../../intents/03-decisions-and-stack.md#kd-30)）。
- 密碼以 Argon2id 雜湊與驗證，參數依 OWASP 建議值（[KD-31](../../intents/03-decisions-and-stack.md#kd-31)）。
- 權限檢查的執行方式：後端預設拒絕、`is_admin` 可查看、修改所有專案、依 `ProjectMember` 上角色的權限加總，以及系統管理操作與「本人或 Admin」的檢查（[KD-24](../../intents/03-decisions-and-stack.md#kd-24)～[KD-29](../../intents/03-decisions-and-stack.md#kd-29)；資料模型與有效權限的計算引用 DOM-R19～DOM-R27，不重複定義）。
- 登入後，`domain-model` 的「目前操作者」入口改回傳實際登入的人（DOM-R14；[#54](https://github.com/speko-tw/inspect-flow/issues/54) 補充裁定）。
- 設定密碼的指令：初始化指令建立的帳號（DOM-R11，含內建 `admin`）與之後建立的本系統帳號，由部署人員在執行時輸入密碼（[#54](https://github.com/speko-tw/inspect-flow/issues/54) 裁定；內建 `admin` 依 [AUT-Q4](#aut-q4) 裁定）。
- 臨時密碼與首次登入強制變更：臨時密碼標記、標記未清除前只能變更密碼或登出、本人變更密碼的 API，以及供 `admin-dashboard` 呼叫的「設定密碼（可標為臨時）」Service 入口（[AUT-Q4](#aut-q4) 裁定，[#146](https://github.com/speko-tw/inspect-flow/issues/146)）。
- 停用人員前計算他有幾個有效的登入狀態，供影響範圍顯示使用（[PR-18](../../intents/02-principles.md#pr-18)）。
- 前端登入頁、未登入時導向登入頁、登出；變更密碼頁，以及臨時密碼未變更時導向變更密碼頁。

**不包含**（注明移到哪份規格，或屬於哪一條非目標）：

- `User`、`Company`、`Role`、`ProjectMember` 的欄位與約束、有效權限與角色影響範圍的計算、初始化指令本身：由 `domain-model` 定義（DOM-R01～DOM-R27），本規格只引用。
- 外部身分來源（LDAP、AD、Entra ID）的登入與同步，以及本系統帳號轉成外部帳號時既有登入狀態的處理：移至 `external-identity-sync`。本規格的設計不得阻礙日後串接（AUT-R20；[KD-20](../../intents/03-decisions-and-stack.md#kd-20)、[KD-30](../../intents/03-decisions-and-stack.md#kd-30) 的理由）。
- 人員、公司、角色、專案成員的管理 API 與畫面（含停用人員、修改前顯示影響範圍的畫面與確認流程、替客戶公司成員指派可修改角色的確認提示）：由 `admin-dashboard` 等功能規格負責；本規格只提供它們要呼叫的權限檢查與登入狀態筆數（AUT-R16、AUT-R19）。
- 權限代碼的命名規則與可用清單：見 [DOM-Q3](../domain-model/spec.md#dom-q3)。本規格的檢查元件以權限代碼字串為輸入，不登記任何代碼。
- 稽核紀錄：[KD-29](../../intents/03-decisions-and-stack.md#kd-29) 要求權限與角色的變更寫稽核紀錄，資料模型待 [DOM-Q6](../domain-model/spec.md#dom-q6)。本規格不新增權限或角色的寫入入口；登入、登出、設定密碼是否要寫稽核紀錄，見 [AUT-Q6](#aut-q6)。
- Admin 在畫面上替他人設定臨時密碼的 API 與畫面：由 `admin-dashboard` 負責，呼叫本規格的 Service 入口（AUT-R36）並標為臨時；在那之前，帳號密碼由部署人員以指令設定（AUT-R24）。本規格只提供入口與首次登入強制變更的機制（[AUT-Q4](#aut-q4) 裁定）。
- 忘記密碼、以 email 寄送設定密碼的連結：需要寄信服務，目前沒有（[AUT-Q4](#aut-q4) 選項 C 未採用）。
- 臨時密碼的有效期限（例如 72 小時內未變更就失效）：intents 與 [AUT-Q4](#aut-q4) 裁定都沒有依據，這次不做；臨時密碼外洩或過久未用時，由 Admin 重新設定。若要加上期限，屬範圍變更。
- 外部來源帳號（`auth_source = external`）的密碼：由 AD／LDAP 驗證，本系統不保存外部密碼，也不使用本地密碼；帳號轉成外部來源時要不要刪除既有的 `UserPassword`，由 `external-identity-sync` 決定（[AUT-Q4](#aut-q4) 裁定）。
- 多因素認證、Corporate SSO：架構基準 §35 延後的能力，不在 MVP。
- 常見或已外洩密碼的黑名單檢查：這次不做，等日後改用外部身分來源（LDAP／AD）登入時，由 `external-identity-sync` 一併評估。這低於 NIST SP 800-63B（第 4 版）§3.1.1.2 的要求，是負責人接受的取捨（[AUT-Q3](#aut-q3) 裁定，[#145](https://github.com/speko-tw/inspect-flow/issues/145)）。
- 部署時的 HTTPS 終止與反向代理設定：由 `pilot-deployment` 負責；本規格只要求 Cookie 帶 `Secure`（AUT-R06）。

## 使用情境

- 部署人員執行完初始化指令後，對負責人的個人帳號執行設定密碼的指令，在終端機輸入兩次密碼；密碼不出現在指令列參數、環境變數或 repo 裡。
- 負責人開啟 Admin Web，因為尚未登入而被導向登入頁；輸入 email 與密碼後回到原本的頁面，畫面顯示他的姓名。
- 一位工程師輸錯密碼，畫面只顯示「email 或密碼錯誤」，不透露這個 email 是否存在、帳號是否已停用。
- 現場查核人員在專案 P 有「現場查核」與「唯讀」兩個角色，呼叫 P 的某個端點時，後端依兩個角色權限的聯集判斷是否放行；他對不是成員的專案 Q 呼叫同一個端點，被拒絕。
- Admin 對任何專案的端點都能讀取與修改，不必先加入該專案。
- Admin 準備停用一位離職人員，畫面先顯示「此人目前有 2 個登入中的裝置」；確認停用後，那位人員下一個請求就被要求重新登入。
- 使用者按下登出，伺服器刪除他的登入狀態；即使有人留著舊的 Cookie，也無法再用。
- 部署人員以指令替新進工程師設定一組臨時密碼，口頭交給他。工程師第一次登入後直接被帶到變更密碼頁；變更前，他打開任何其他頁面都會被帶回來。改好後回到原本要去的頁面，他在其他裝置上的登入狀態都失效。
- 負責人帳號無法使用時，部署人員以保管的密碼登入內建 `admin`（緊急備援帳號），處理完再回到個人帳號。

## 需求

用「必須／應／得」，每條附依據；來源只是建議的，不得寫成「必須」。識別字（資料表、欄位、路徑、錯誤碼、Cookie 名稱）是本規格建議的名稱，強度為「應」。OWASP 的建議值查詢日期為 2026-09-26，來源為 [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)、[Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)；以 OWASP 為依據的需求維持「應」，KD 明文要求的才是「必須」。

### 密碼

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| AUT-R01 | 密碼**必須**以 Argon2id 雜湊後儲存；**不得**儲存明文或可逆加密的密碼。每個雜湊**必須**使用各自隨機產生的 salt，雜湊值連同演算法、參數與 salt 以 PHC 字串格式（`$argon2id$v=19$m=…,t=…,p=…$…`）存放。參數**應**採 OWASP 列出、防護程度相同的其中一組完整配置（m／t／p 為 47104／1／1、19456／2／1、12288／3／1、9216／4／1、7168／5／1，單位 KiB），本規格建議 m = 19456 KiB（19 MiB）、t = 2、p = 1；實作時得依伺服器規格改選同一份清單中的另一組，並寫在計畫與程式的單一常數處 | 必須（Argon2id、不存明文、salt）；應（參數） | [KD-31](../../intents/03-decisions-and-stack.md#kd-31)；參數依 OWASP Password Storage Cheat Sheet（2026-09-26 查詢） |
| AUT-R02 | 登入時驗證成功、但雜湊的參數與目前設定不同時，**應**以目前參數重新雜湊並更新儲存值 | 應 | OWASP Password Storage Cheat Sheet「等使用者下次登入時重新雜湊」 |
| AUT-R03 | 密碼雜湊**必須**只存在本規格的 `UserPassword`（見[資料](#資料)），**不得**出現在任何 API 回應、錯誤訊息或應用程式日誌。請求中的明文密碼同樣**不得**寫入日誌 | 必須 | [KD-31](../../intents/03-decisions-and-stack.md#kd-31)（雜湊儲存的前提是雜湊與明文都不外流）；本規格推導 |
| AUT-R04 | 設定密碼時，長度**必須**介於 8～128 個字元（含兩端）才能設定，不符合時拒絕、資料不變；長度以 Unicode 字元（code point）計算，不以位元組計算。不要求大小寫、數字、符號等字元組成。不強制定期更換密碼，也不設密碼有效期限；只有在有證據顯示密碼外洩時才要求更換，更換方式是設定密碼的指令（AUT-R24）或本人變更密碼（AUT-R34）。本規格不檢查常見或已外洩的密碼（見[範圍](#範圍)的「不包含」）。最短 8 字元與不做黑名單都未達 NIST 對只用密碼登入的規定，是負責人接受的取捨，見 [AUT-Q3](#aut-q3) | 必須 | [AUT-Q3](#aut-q3) 裁定（負責人，[#145](https://github.com/speko-tw/inspect-flow/issues/145)，2026-09-26）；上限 128 用來防止超長輸入拖慢雜湊運算；以 code point 計算長度依 NIST SP 800-63B（第 4 版）§3.1.1.2 |

### 登入、登出與目前使用者

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| AUT-R05 | 後端**必須**提供以 email 與密碼登入的 API。email 與一筆 `auth_source = local`、`is_active = true`、已設定密碼的 `User` 相符，且密碼驗證成功時，建立一筆新的 `AuthSession`，以 Cookie 回傳，並在回應本體回傳目前使用者（同 AUT-R10）。email 的比對方式依 [DOM-Q2](../domain-model/spec.md#dom-q2) 的裁定 | 必須 | [KD-18](../../intents/03-decisions-and-stack.md#kd-18)（登入帳號用 email）、[KD-30](../../intents/03-decisions-and-stack.md#kd-30) |
| AUT-R06 | 以下情況登入**必須**失敗，而且**不得**建立 `AuthSession`：email 不存在、密碼錯誤、帳號已停用、帳號為 `auth_source = external`、帳號尚未設定密碼。這幾種失敗**應**回傳完全相同的狀態碼與回應本體（401、`auth.invalid_credentials`），不透露是哪一種；email 不存在或沒有密碼時，**應**仍執行一次同樣成本的雜湊驗證，讓回應時間不因帳號是否存在而明顯不同 | 必須（失敗、不建立）；應（回應一致、時間一致） | [KD-21](../../intents/03-decisions-and-stack.md#kd-21)（停用不能登入）；[KD-20](../../intents/03-decisions-and-stack.md#kd-20)（外部帳號由外部來源驗證，本規格判讀）；回應一致依 OWASP Authentication Cheat Sheet |
| AUT-R07 | 後端**必須**提供登出 API：刪除這個請求所帶的 `AuthSession`，並要求瀏覽器清除 Cookie。請求沒有帶有效登入狀態時，登出**應**仍回傳成功，行為冪等 | 必須（刪除）；應（冪等） | [KD-30](../../intents/03-decisions-and-stack.md#kd-30)（伺服器保存登入狀態，登出就是刪除它）；冪等依 OWASP Session Management Cheat Sheet |
| AUT-R08 | 後端**必須**提供取得目前使用者的 API：已登入時回傳該 `User` 的 `id`、`email`、`name_en`、`name_zh`、`is_admin`，以及 `must_change_password`（布林值，是否需要先變更臨時密碼，見 AUT-R33）；未登入時回傳 401、`auth.not_authenticated` | 必須 | [KD-24](../../intents/03-decisions-and-stack.md#kd-24)（前端需要知道是不是 Admin）；架構基準 §17 與[認證與授權卡片](../../intents/03-decisions-and-stack.md#stack-auth)（負責「登入、目前使用者與 API 權限檢查」）；`must_change_password` 依 [AUT-Q4](#aut-q4) 裁定（前端要知道是否導向變更密碼頁） |
| AUT-R09 | 登入成功後，Service 層取得「目前操作者」的單一入口（DOM-R14）**必須**在處理 HTTP 請求時回傳這個請求的登入者；不在 HTTP 請求中執行的程式（例如指令）**必須**維持回傳內建 `admin`。請求中沒有登入者時，入口**不得**退回內建 `admin`，而是拒絕執行 | 必須 | [#54](https://github.com/speko-tw/inspect-flow/issues/54) 補充裁定（認證完成後改填實際登入的人）；指令維持 `admin`、請求中不退回 `admin` 是本規格的判讀，理由：指令沒有登入者，而請求若退回 `admin` 會讓未登入的寫入被記成 `admin` 做的 |
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
| AUT-R18 | 後端**必須**預設拒絕：每一條 `/api/v1` 業務路由都**必須**明確宣告一種存取層級：公開、需登入、需 Admin、需專案權限（附權限代碼）。沒有宣告的路由**必須**讓自動化測試失敗；公開路由**必須**列在一份明確的清單上，目前只有健康檢查與登入、登出。需登入以上的路由，未登入時回傳 401、`auth.not_authenticated` | 必須 | [KD-29](../../intents/03-decisions-and-stack.md#kd-29)（後端預設拒絕）、[PR-01](../../intents/02-principles.md#pr-01)（伺服器端覆核）；「沒宣告就測試失敗」是本規格把預設拒絕落實成可驗證的做法 |
| AUT-R19 | 需專案權限的檢查**必須**依下列順序判斷，只在通過時放行，否則回傳 403、`permission.denied`：（1）登入者 `is_admin = true`，且所需代碼的動作是讀取或修改：放行，不需要 `ProjectMember`。所需代碼是新增、刪除，或簽核、匯出等特殊動作時，Admin 怎麼判斷待 [AUT-Q2](#aut-q2) 裁定，本規格不定義；怎麼從代碼辨識動作類別依 [DOM-Q3](../domain-model/spec.md#dom-q3)。（2）登入者不是 Admin：取他在該專案的有效權限（DOM-R26：所有角色權限代碼的聯集，使用時從 `Role` 目前內容計算），含所需代碼時放行。（3）非 Admin 且不是該專案成員，有效權限為空集合，拒絕。Admin 要求新增、刪除或特殊動作時不適用（2）、（3），待 AUT-Q2 裁定。有效權限**不得**跨請求快取，修改角色才會立即影響下一個請求 | 必須 | [KD-24](../../intents/03-decisions-and-stack.md#kd-24)（Admin 可查看、修改所有專案）、[KD-25](../../intents/03-decisions-and-stack.md#kd-25)、[KD-26](../../intents/03-decisions-and-stack.md#kd-26)（修改角色立即影響持有者）、[KD-27](../../intents/03-decisions-and-stack.md#kd-27)、[KD-29](../../intents/03-decisions-and-stack.md#kd-29)；DOM-R26、DOM-R27 |
| AUT-R20 | 需 Admin 的檢查**必須**只放行 `is_admin = true` 的登入者，否則回傳 403、`permission.denied`。管理人員（含建立帳號、停用、修改 `is_admin`）、公司、角色定義的端點**必須**使用這一層 | 必須 | [KD-24](../../intents/03-decisions-and-stack.md#kd-24)（Admin 管理系統設定、人員、公司、角色定義）；建立帳號只由 Admin 做，依 [#54](https://github.com/speko-tw/inspect-flow/issues/54) 裁定（之後每個帳號都由某個 Admin 建立） |
| AUT-R21 | 後端**必須**提供「本人或 Admin」的檢查：登入者就是目標 `User`，或 `is_admin = true` 時放行，否則回傳 403、`permission.denied`。修改人員聯絡與補充欄位的端點**必須**使用這一層 | 必須 | [KD-17](../../intents/03-decisions-and-stack.md#kd-17)；DOM-R04（判斷操作者是不是 Admin 或本人由本規格執行） |
| AUT-R22 | 替 `ProjectMember` 指派或移除角色的端點，**必須**使用需專案權限的檢查（代碼依 [DOM-Q3](../domain-model/spec.md#dom-q3) 登記）；Admin 是否免查依 AUT-R19，視該代碼的動作類別（[DOM-Q3](../domain-model/spec.md#dom-q3)）與 [AUT-Q2](#aut-q2) 的裁定，本條不另設例外 | 必須 | [KD-27](../../intents/03-decisions-and-stack.md#kd-27)（角色由有權限的人設定） |
| AUT-R23 | 未登入的錯誤碼 `auth.not_authenticated`、帳號密碼錯誤 `auth.invalid_credentials`、權限不足 `permission.denied` **必須**登記在共用的錯誤碼列舉，並使用共用錯誤 envelope | 必須 | API-R05、API-R07；[KD-15](../../intents/03-decisions-and-stack.md#kd-15) |

### 設定密碼的指令

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| AUT-R24 | 後端**必須**提供設定密碼的指令：以 email 指定一個 `auth_source = local` 的 `User`，含內建 `admin`（`is_system = true`；設定後可登入，作為負責人帳號無法使用時的緊急備援帳號，密碼由部署人員保管），在執行時由終端機輸入兩次密碼（不回顯），兩次相同且符合 AUT-R04 才寫入。密碼**不得**從指令列參數、環境變數或設定檔讀取，repo **不得**含任何密碼或其預設值；指令**得**另提供從標準輸入讀取的方式供自動化測試使用。email 不存在、帳號為 `external`、兩次輸入不同或不符合規則時，指令回報失敗且資料不變 | 必須；得（標準輸入） | [#54](https://github.com/speko-tw/inspect-flow/issues/54) 裁定（初始帳號的密碼等本規格；個資與密碼在執行時輸入，不寫進 repo）、[KD-22](../../intents/03-decisions-and-stack.md#kd-22)；內建 `admin` 可設定密碼並登入依 [AUT-Q4](#aut-q4) 裁定（選項甲，[#146](https://github.com/speko-tw/inspect-flow/issues/146)） |
| AUT-R25 | 設定密碼成功時，**應**刪除該 `User` 所有既有的 `AuthSession` | 應 | OWASP Session Management Cheat Sheet（權限等級改變時換發登入狀態）；本規格的建議，理由：重設密碼通常是因為密碼可能外流 |
| AUT-R26 | 指令寫入時，建立與修改紀錄的操作者**必須**依 DOM-R14 為內建 `admin` | 必須 | [#54](https://github.com/speko-tw/inspect-flow/issues/54) 補充裁定；DOM-R14；AUT-R09 |

### 臨時密碼與變更密碼

「有臨時密碼標記、標記未清除前強制變更、本人能變更密碼」依 [AUT-Q4](#aut-q4) 裁定（負責人，[#146](https://github.com/speko-tw/inspect-flow/issues/146)，2026-09-26），強度為「必須」；欄位約束、錯誤碼、狀態碼與實作方式是本規格的建議，強度為「應」。

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| AUT-R32 | `UserPassword` **必須**記錄這組密碼是不是臨時密碼（本規格稱 `must_change_password`）；欄位**應**為不可空值，未指定時為 `false`。標記只對 `auth_source = local` 的帳號有作用；外部來源帳號不使用本地密碼，標記一律不影響它 | 必須（記錄標記、只對 `local` 有作用）；應（不可空值、預設 `false`） | [AUT-Q4](#aut-q4) 裁定（負責人，[#146](https://github.com/speko-tw/inspect-flow/issues/146)，2026-09-26）（選項 B：Admin 設定臨時密碼，首次登入強制變更；外部帳號不使用本地密碼） |
| AUT-R33 | `auth_source = local` 且 `must_change_password = true` 的帳號，仍可依 AUT-R05 登入並取得 `AuthSession`；但標記清除前，這個登入狀態的請求只放行一份明確的允許清單：取得目前使用者、登出、變更密碼（AUT-R34）。其他需登入以上的請求（含需 Admin、需專案權限、本人或 Admin）**必須**拒絕，而且不執行路由處理函式；拒絕時**應**回傳 403、`auth.password_change_required`。允許清單**應**集中在一處，並由自動化測試斷言內容 | 必須（只放行允許清單、各存取層級都拒絕、不執行處理函式）；應（狀態碼與錯誤碼、清單集中與測試方式） | [AUT-Q4](#aut-q4) 裁定（負責人，[#146](https://github.com/speko-tw/inspect-flow/issues/146)，2026-09-26）（首次登入強制變更）；以允許清單而非封鎖清單實作，延續 AUT-R18 的預設拒絕 |
| AUT-R34 | 後端**必須**提供本人變更密碼的 API：已登入的 `auth_source = local` 帳號送出目前密碼與新密碼，目前密碼驗證成功、新密碼符合 AUT-R04，且（標記為臨時時）新密碼與目前密碼不同，才以新密碼的雜湊取代舊的、清除 `must_change_password`。任一條件不符時資料不變，**應**分別回傳：目前密碼錯誤 400、`auth.current_password_incorrect`；新密碼不符 AUT-R04 為 422、`auth.password_invalid`；臨時密碼改成同一組 422、`auth.password_unchanged`。外部來源帳號呼叫時**必須**拒絕，資料不變（**應**回傳 403、`permission.denied`）。修改紀錄的操作者依 AUT-R09 為本人。本條與 AUT-R33 實際採用的錯誤碼，依 API-R07 登記在共用的錯誤碼列舉 | 必須（API、三項檢查、外部帳號拒絕）；應（狀態碼與錯誤碼的名稱）；錯誤碼的登記方式依 API-R07 | [AUT-Q4](#aut-q4) 裁定（負責人，[#146](https://github.com/speko-tw/inspect-flow/issues/146)，2026-09-26）（變更密碼的流程與頁面）；「臨時密碼不得改成同一組」是本規格的推導，理由：否則強制變更沒有效果；API-R05、API-R07 |
| AUT-R35 | 變更密碼成功時，**應**刪除該 `User` 所有的 `AuthSession`（含發出這個請求的那一筆），並依 AUT-R11～AUT-R13 為這個請求建立一筆新的 `AuthSession`、以 Cookie 回傳，讓本人不必重新登入 | 應 | OWASP Session Management Cheat Sheet（密碼變更屬權限等級改變，應換發登入識別碼；其他登入狀態失效）；換發而非要求重新登入是本規格的建議，理由：本人剛證明知道密碼 |
| AUT-R36 | 後端**必須**提供可把密碼標為臨時的設定方式，供 `admin-dashboard` 日後的「Admin 設定臨時密碼」使用；Admin 在畫面上替他人設定的密碼**必須**標為臨時，由 `admin-dashboard` 驗收。這個設定方式**應**是 Service 層的單一入口，參數含目標 `User`、新密碼與是否標為臨時，負責 AUT-R04 的長度檢查、雜湊、寫入 `UserPassword` 與 `must_change_password`，以及 AUT-R25 的刪除登入狀態；設定密碼的指令**應**也經過這個入口 | 必須（可標為臨時、Admin 設定的標為臨時）；應（單一入口與指令共用） | [AUT-Q4](#aut-q4) 裁定（負責人，[#146](https://github.com/speko-tw/inspect-flow/issues/146)，2026-09-26）（Admin 設定臨時密碼；操作介面屬 `admin-dashboard`，本規格提供後端機制）；單一入口是本規格的建議，理由：規則只寫一次，指令與畫面不會各自漏掉長度檢查或刪除登入狀態 |
| AUT-R37 | 設定密碼的指令**應**依帳號決定是否標為臨時：`is_system = false` 的帳號標為臨時，本人第一次登入時變更；內建 `admin`（`is_system = true`）不標，部署人員保管的密碼就是登入用的密碼 | 應 | [AUT-Q4](#aut-q4) 裁定（負責人，[#146](https://github.com/speko-tw/inspect-flow/issues/146)，2026-09-26）（一般帳號首次登入強制變更；內建 `admin` 作為緊急備援、密碼由部署人員保管）；依帳號區分是本規格的建議，待負責人確認 |

### 外部身分來源與登入失敗

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| AUT-R27 | 「驗證身分」與「建立登入狀態」**應**是兩個分開的步驟：密碼驗證只負責確認一個 `User`；建立 `AuthSession`、Cookie、AUT-R14 的檢查不依賴密碼。日後外部身分來源只需新增一種驗證方式，驗證成功後沿用同一套登入狀態 | 應 | [KD-30](../../intents/03-decisions-and-stack.md#kd-30) 的理由（外部來源登入成功後一樣建立伺服器端登入狀態）、[KD-20](../../intents/03-decisions-and-stack.md#kd-20) |
| AUT-R28 | 同一個帳號短時間內連續登入失敗時，後端**應**暫時拒絕該帳號的登入；鎖定期間的回應**應**與一般失敗相同（AUT-R06）。門檻、計算期間、鎖定時間與是否遞增，見 [AUT-Q5](#aut-q5) | 應 | OWASP Authentication Cheat Sheet（依帳號計算，而非 IP）；數值待 [AUT-Q5](#aut-q5) |

### 前端

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| AUT-R29 | 前端**必須**提供登入頁，送出 email 與密碼到登入 API；失敗時只顯示一種通用訊息。Admin Web 與 Field Web 在目前使用者 API 回傳 401 時，**必須**導向登入頁，登入成功後回到原本的頁面 | 必須 | [KD-30](../../intents/03-decisions-and-stack.md#kd-30)；架構基準 §17；通用訊息依 AUT-R06 |
| AUT-R30 | 前端**不得**讀取、儲存或自行傳送登入 token（Cookie 由瀏覽器自動帶），也**不得**把登入資訊寫入 `localStorage`、`sessionStorage`；前端**必須**提供登出操作 | 必須 | [KD-30](../../intents/03-decisions-and-stack.md#kd-30)（不把長效 token 放在 browser localStorage）、[認證與授權卡片](../../intents/03-decisions-and-stack.md#stack-auth)「不要用」 |
| AUT-R31 | 前端依目前使用者隱藏無權使用的功能，只是方便；**不得**取代 AUT-R18～AUT-R22 的後端檢查 | 必須 | [PR-01](../../intents/02-principles.md#pr-01) |
| AUT-R38 | 前端**必須**提供變更密碼頁（目前密碼、新密碼、再輸入一次新密碼），兩次新密碼不同時不送出；依 AUT-R34 的錯誤碼顯示對應訊息。目前使用者 API 回傳 `must_change_password = true` 時，Admin Web 與 Field Web **必須**導向變更密碼頁，變更成功後回到原本的頁面。前端**得**在登出操作旁提供變更密碼的入口，供本人主動變更 | 必須；得（主動變更的入口） | [AUT-Q4](#aut-q4) 裁定（負責人，[#146](https://github.com/speko-tw/inspect-flow/issues/146)，2026-09-26）（變更密碼的頁面）；後端的強制仍以 AUT-R33 為準（[PR-01](../../intents/02-principles.md#pr-01)） |

## 資料

`User`、`Company`、`Role`、`ProjectMember` 的定義見 `domain-model`（DOM-R01～DOM-R27）。`domain-model` 的資料段寫明「認證欄位歸 `authentication`」，本規格新增下列兩個實體；兩者都沿用共通結構（UUID 主鍵、`created_at`、`updated_at`、`created_by`、`updated_by`，見 DBF-R11、DBF-R14、DOM-R15）。

| 實體 | 欄位（本規格定義） | 說明 | 對應需求 |
|---|---|---|---|
| `UserPassword` | `user_id`（不可空值、唯一、外鍵指向 `User`）、`password_hash`（不可空值，PHC 字串）、`must_change_password`（不可空值，未指定時為 `false`） | 一個 `User` 至多一筆；沒有這一筆就是「尚未設定密碼」，不能以密碼登入。外部帳號不需要這一筆；轉成外部帳號後留下的這一筆（含標記）不被使用 | AUT-R01～AUT-R04、AUT-R24、AUT-R32 |
| `AuthSession` | `user_id`（不可空值、外鍵指向 `User`）、`token_hash`（不可空值、唯一）、`expires_at`（絕對期限，UTC）、`last_seen_at`（最後一次請求，UTC） | 一次登入一筆；登出、過期、帳號停用時刪除。`created_by`、`updated_by` 填登入者本人 | AUT-R11～AUT-R17 |

- **為什麼密碼放在獨立的 `UserPassword`，不放在 `User` 上**：外部帳號沒有密碼，獨立一張表就不必在 `User` 上留一個只對本系統帳號有意義、而且永遠不能出現在回應裡的欄位；`domain-model` 的 `User` 修改入口與查詢也不會意外帶出雜湊。帳號轉成外部帳號（DOM-R09）時，`UserPassword` 留著也不會被使用，AUT-R06 以 `auth_source` 擋下密碼登入；既有登入狀態是否撤銷由 `external-identity-sync` 決定。
- **為什麼 `AuthSession` 也沿用共通結構**：[#54](https://github.com/speko-tw/inspect-flow/issues/54) 補充裁定要求所有資料的 `created_by`、`updated_by` 都有值；登入狀態的操作者就是登入者本人，填起來沒有額外成本。
- **為什麼臨時密碼標記放在 `UserPassword`**：標記描述的是「這一組密碼」，換一組密碼時一起改寫；放在 `User` 上，外部帳號會多一個沒有意義的欄位，理由同上。
- 刪除 `User` 本來就被外鍵擋下（DOM-R10），因此兩張表不需要設定連帶刪除。

## 介面

路徑、內容型別與錯誤 envelope 沿用 `api-conventions`。

| 方法 | 路徑 | 用途 | 權限 |
|---|---|---|---|
| `POST` | `/api/v1/auth/login` | 本體 `{"email": "…", "password": "…"}`；成功 200，設定 Cookie，本體同目前使用者；失敗 401 `auth.invalid_credentials`；本體不合法 422（沿用共用錯誤處理） | 公開 |
| `POST` | `/api/v1/auth/logout` | 刪除登入狀態並清除 Cookie；一律 204 | 公開（沒有登入狀態也回 204） |
| `GET` | `/api/v1/auth/me` | 目前使用者 `{"id", "email", "name_en", "name_zh", "is_admin", "must_change_password"}`；未登入 401 `auth.not_authenticated` | 需登入（臨時密碼未變更時仍放行） |
| `POST` | `/api/v1/auth/password` | 本人變更密碼，本體 `{"current_password": "…", "new_password": "…"}`；成功 204，並以 `Set-Cookie` 換發新的登入 Cookie；目前密碼錯誤 400 `auth.current_password_incorrect`；新密碼不符規則 422 `auth.password_invalid`；臨時密碼改成同一組 422 `auth.password_unchanged`；外部帳號 403 `permission.denied` | 需登入（臨時密碼未變更時仍放行） |

| 其他介面 | 內容 | 對應需求 |
|---|---|---|
| 程式介面 | 路由的存取層級宣告：公開、需登入、需 Admin、需專案權限（權限代碼、取得專案 ID 的方式）、本人或 Admin；以及列出所有路由宣告的方式，供 AUT-R18 的測試使用 | AUT-R18～AUT-R22 |
| 程式介面 | 目前操作者入口（改寫 `domain-model` 的入口，簽章不變） | AUT-R09 |
| 程式介面 | 一個 `User` 有效 `AuthSession` 筆數的查詢 | AUT-R16 |
| 程式介面 | 設定密碼的 Service 入口（目標 `User`、新密碼、是否標為臨時），供指令與 `admin-dashboard` 呼叫 | AUT-R36 |
| 程式介面 | 臨時密碼未變更時的允許清單（取得目前使用者、登出、變更密碼） | AUT-R33 |
| 指令 | 設定密碼：指定 email（含內建 `admin`），互動輸入兩次密碼；依帳號決定是否標為臨時 | AUT-R24～AUT-R26、AUT-R37 |
| 環境變數 | 登入狀態的絕對期限與閒置期限（名稱由計畫決定，並寫入 `.env.example`） | AUT-R15 |
| 畫面 | 前端 `/login` 登入頁；Admin Web、Field Web 的登出操作 | AUT-R29、AUT-R30 |
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
| AUT-AC04 | 一個啟用中的 `local` 帳號 | 以設定密碼的指令（標準輸入）分別設定：7 字元的密碼；8 字元的密碼；128 字元、其中含中文字（UTF-8 編碼超過 128 個位元組）的密碼；129 字元的 ASCII 密碼；12 字元、只含小寫英文字母的密碼 | 8 字元、128 字元與只含小寫字母的三次成功，每次成功後 `UserPassword` 的雜湊都能驗證剛設定的密碼；7 字元與 129 字元的兩次失敗，`UserPassword` 不變 | AUT-R04、AUT-R24 |

### 登入、登出與目前使用者

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| AUT-AC05 | 一個啟用中、`local`、已設定密碼的帳號 | 以正確 email 與密碼呼叫 `POST /api/v1/auth/login` | 200；本體含該帳號的 `id`、`email`、`name_en`、`name_zh`、`is_admin`；`Set-Cookie` 名稱為 `__Host-inspectflow_session`，帶 `HttpOnly`、`Secure`、`SameSite=Strict`、`Path=/`，沒有 `Domain`；資料庫多一筆該帳號的 `AuthSession`，其 `token_hash` 等於 Cookie 值的 SHA-256，且不等於 Cookie 值本身 | AUT-R05、AUT-R11、AUT-R12 |
| AUT-AC06 | 五個帳號情境：email 不存在；密碼錯誤；帳號已停用；`auth_source = external`；`local` 但沒有 `UserPassword` | 各以一組 email 與密碼呼叫登入 | 五次都回 401，回應本體逐位元組相同（`error.code` 為 `auth.invalid_credentials`），都沒有 `Set-Cookie`，`AuthSession` 筆數不變；email 不存在與沒有密碼的兩種情況，密碼驗證函式仍被呼叫一次 | AUT-R06 |
| AUT-AC07 | 已登入的用戶端 | 呼叫 `POST /api/v1/auth/logout`，再以同一個 Cookie 呼叫 `GET /api/v1/auth/me`；另以沒有 Cookie 的用戶端呼叫登出 | 登出回 204，`Set-Cookie` 讓瀏覽器清除該 Cookie，該筆 `AuthSession` 已不存在；之後的 `me` 回 401 `auth.not_authenticated`；沒有 Cookie 的登出也回 204 | AUT-R07 |
| AUT-AC08 | 已登入與未登入的用戶端各一 | 各呼叫 `GET /api/v1/auth/me` | 已登入：200，本體的鍵恰為 `id`、`email`、`name_en`、`name_zh`、`is_admin`、`must_change_password`；未登入：401 `auth.not_authenticated` | AUT-R08、AUT-R10 |
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
| AUT-AC16 | 正式應用程式掛載的所有業務路由（範圍同 API-AC01）；另在測試中掛上一條沒有宣告存取層級的路由 | 執行路由宣告檢查 | 正式路由全部有宣告，公開路由恰為健康檢查、登入、登出；加上未宣告的路由後，檢查失敗並指出該路由 | AUT-R18 |
| AUT-AC17 | 測試中的四條路由，分別宣告需登入、需 Admin、需專案權限、本人或 Admin | 不帶 Cookie 呼叫四條路由 | 都回 401 `auth.not_authenticated`，路由處理函式都沒有被執行 | AUT-R18、AUT-R23 |
| AUT-AC18 | 專案 P、Q；非 Admin 的 U 在 P 有角色 R1（`report.read`）與 R2（`report.approve`），不是 Q 的成員；Admin A 不是任何專案的成員；一條測試路由要求 `report.read`，另一條要求 `evidence.read` | U 呼叫 P 的兩條路由、Q 的 `report.read` 路由；A 呼叫 P、Q 的兩條路由 | U：P 的 `report.read` 放行，`evidence.read` 回 403 `permission.denied`，Q 回 403；A：四次都放行 | AUT-R19、AUT-R23 |
| AUT-AC19 | 承 AUT-AC18，U 已登入且沒有重新登入 | 把 R1 的權限內容改為 `evidence.read`，U 以同一個 Cookie 再呼叫 P 的兩條路由；再把 U 的 `is_admin` 改為 `true`，呼叫 Q 的路由 | R1 修改後，U 在 P 的有效權限變成 `{evidence.read, report.approve}`：`evidence.read` 放行，`report.read` 回 403，證明修改角色立即影響同一個登入狀態的下一個請求；改成 Admin 後，Q 放行 | AUT-R19 |
| AUT-AC20 | 一條需 Admin 的測試路由；Admin A、非 Admin 的 U | 各呼叫一次 | A 放行；U 回 403 `permission.denied` | AUT-R20 |
| AUT-AC21 | 一條「本人或 Admin」、以路徑指定目標 `User` 的測試路由；使用者 U、V、Admin A | U 以自己為目標、U 以 V 為目標、A 以 V 為目標各呼叫一次 | 第一、三次放行；第二次 403 `permission.denied` | AUT-R21 |
| AUT-AC22 | 共用錯誤碼列舉與由它產生的對照表（API-AC10） | 檢查對照表 | 含 `auth.not_authenticated`、`auth.invalid_credentials`、`permission.denied`，且都符合 API-AC09 的 dot-namespace 格式 | AUT-R23 |

### 設定密碼的指令

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| AUT-AC23 | 初始化後的資料庫；負責人帳號已登入一個用戶端 | 以標準輸入提供兩次相同的有效密碼，對負責人帳號執行設定密碼的指令；再用新密碼登入 | 指令成功；`UserPassword` 有一筆該帳號的 Argon2id 雜湊，`created_by`（第一次設定）或 `updated_by` 為內建 `admin`；原本那個用戶端呼叫 `me` 回 401；新密碼登入成功 | AUT-R24、AUT-R25、AUT-R26 |
| AUT-AC24 | 初始化後的資料庫，另有一個 `external` 帳號 | 分別執行：不存在的 email；`external` 帳號；兩次輸入不同 | 三次都回報失敗；`UserPassword` 筆數與內容不變 | AUT-R24 |
| AUT-AC25 | 初始化後的資料庫；執行環境設有 `INSPECTFLOW_PASSWORD`、`PASSWORD` 兩個環境變數，值為一組有效密碼 | 以 `--help` 取得指令列定義；再以空的標準輸入、另在指令列多加 `--password <有效密碼>` 各執行一次 | 指令列定義沒有任何接受密碼的選項；空輸入時指令回報失敗、沒有使用環境變數的值；多加 `--password` 時指令以「不認得的參數」失敗；兩次 `UserPassword` 都沒有寫入 | AUT-R24 |
| AUT-AC32 | 初始化後的資料庫，內建 `admin` 尚未設定密碼 | 以標準輸入提供兩次相同的有效密碼，對內建 `admin` 的 email 執行設定密碼的指令；再以該 email 與密碼呼叫登入 API | 指令成功，`UserPassword` 有一筆內建 `admin` 的雜湊；登入回 200，本體的 `id` 為內建 `admin`、`is_admin` 為 `true` | AUT-R24 |

### 臨時密碼與變更密碼

以下的測試帳號 T 是啟用中、`is_admin = false` 的 `local` 帳號。

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| AUT-AC33 | 對空資料庫執行 `alembic upgrade head` 之後，以 ORM 新增一筆不指定 `must_change_password` 的 `UserPassword` | 用 SQLAlchemy inspector 檢查 `UserPassword` 資料表，讀回該筆；再新增一筆 `must_change_password` 為空值的資料 | 有 `must_change_password` 欄位且不可空值；讀回的值為 `false`；空值那一筆被資料庫拒絕，筆數不變 | AUT-R32 |
| AUT-AC34 | 初始化後的資料庫，另有帳號 T | 以設定密碼的指令（標準輸入）分別設定 T 與內建 `admin` 的密碼，各自登入後呼叫 `GET /api/v1/auth/me` | T 的 `UserPassword.must_change_password` 為 `true`，登入與 `me` 的本體 `must_change_password` 為 `true`；內建 `admin` 的標記為 `false`，本體為 `false` | AUT-R08、AUT-R37 |
| AUT-AC35 | T 的密碼標為臨時；一條僅存在於測試中、需登入的路由，處理函式會計數；一個 `external` 帳號 E，有一筆 `must_change_password = true` 的 `UserPassword`（模擬轉成外部帳號前留下的），由測試直接呼叫「建立登入狀態」的函式替 E 建立登入狀態 | T 登入，依序呼叫 `me`、測試路由、登出；E 以取得的 Cookie 呼叫測試路由 | T 登入 200 並取得 Cookie；`me` 200；測試路由 403 `auth.password_change_required`，處理函式計數為 0；登出 204；E 呼叫測試路由放行（標記不影響外部帳號） | AUT-R32、AUT-R33 |
| AUT-AC36 | 臨時密碼的允許清單 | 讀取允許清單，並比對正式應用程式的路由 | 清單恰為 `GET /api/v1/auth/me`、`POST /api/v1/auth/logout`、`POST /api/v1/auth/password`，每一條都存在於正式路由 | AUT-R33 |
| AUT-AC37 | T 的密碼標為臨時且已登入；E 同 AUT-AC35 | T 分別送出：錯誤的目前密碼；正確的目前密碼與 7 字元的新密碼；正確的目前密碼與「和目前密碼相同」的新密碼。E 以正確格式的本體呼叫變更密碼 | 依序回 400 `auth.current_password_incorrect`、422 `auth.password_invalid`、422 `auth.password_unchanged`、403 `permission.denied`；四次之後 T 的 `UserPassword`（雜湊與標記）不變，T 的登入狀態筆數不變 | AUT-R34 |
| AUT-AC38 | T 的密碼標為臨時，在三個用戶端 A、B、C 登入；記下 A 原本的 Cookie 值 | A 以正確的目前密碼與一組符合規則的新密碼呼叫變更密碼；之後 A 以回應換發的 Cookie 呼叫 AUT-AC35 的測試路由，另以 A 原本的 Cookie、B、C 呼叫 `me`；再分別以舊密碼、新密碼登入 | 變更回 204，`Set-Cookie` 帶新的 token（不等於原本的值，屬性同 AUT-AC05）；`must_change_password` 為 `false`，雜湊能驗證新密碼，`updated_by` 為 T；新 Cookie 呼叫測試路由放行；A 原本的 Cookie、B、C 都回 401，T 只剩一筆 `AuthSession`，其 `token_hash` 等於新 Cookie 值的 SHA-256；舊密碼登入 401、新密碼登入 200 | AUT-R09、AUT-R34、AUT-R35 |
| AUT-AC39 | 帳號 T 已登入兩個用戶端 | 直接呼叫設定密碼的 Service 入口：標為臨時設定一次，檢查後再不標為臨時設定一次；另以 7 字元的密碼呼叫一次 | 第一次後標記為 `true`、第二次後為 `false`，每次的雜湊都能驗證剛設定的密碼，兩個用戶端在第一次後都回 401；7 字元那一次被拒絕，`UserPassword` 不變 | AUT-R04、AUT-R25、AUT-R36 |
| AUT-AC40 | 共用錯誤碼列舉與由它產生的對照表（API-AC10） | 檢查對照表 | 含 `auth.password_change_required`、`auth.current_password_incorrect`、`auth.password_invalid`、`auth.password_unchanged`，且都符合 API-AC09 的 dot-namespace 格式 | AUT-R33、AUT-R34 |
| AUT-AC43 | 帳號 T 為 `is_admin = true`、`must_change_password = true`，已登入；T 是專案 P 的成員，角色含 `report.read`；AUT-AC17 的四條測試路由（需登入、需 Admin、需專案權限 `report.read`、本人或 Admin），處理函式會計數 | T 以 P 與自己為目標呼叫四條路由；再由測試把標記改為 `false`，重呼叫一次 | 第一次四條都回 403 `auth.password_change_required`，處理函式計數都是 0；標記清除後四條都放行 | AUT-R18、AUT-R33 |

### 外部身分來源與登入失敗

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| AUT-AC26 | 一個 `local` 帳號，不經過登入 API，由測試直接呼叫「建立登入狀態」的函式 | 以回傳的 Cookie 呼叫 `me` | 200；建立登入狀態的函式簽章不含密碼參數 | AUT-R27 |
| AUT-AC27 | 依 [AUT-Q5](#aut-q5) 裁定的方案；以可控時間測試 | 對同一帳號以錯誤密碼登入直到達成該方案的觸發條件，在解除條件達成前以正確密碼登入；推進時間到解除條件達成後，再以正確密碼登入 | 解除前的正確密碼登入回 401，回應與一般失敗相同；解除後登入成功。具體的觸發次數、期間與等待時間在 AUT-Q5 裁定後補進本條（規格澄清）；若裁定不做（選項 C），本條與 AUT-R28 改標撤回 | AUT-R28 |

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
| AUT-AC31 | 對空資料庫執行 `alembic upgrade head` 之後，已有一筆 `User` 與它的 `UserPassword`、`AuthSession` | 用 SQLAlchemy inspector 檢查 `UserPassword`、`AuthSession` 資料表；再分別新增：同一個 `User` 的第二筆 `UserPassword`；`token_hash` 與既有相同的 `AuthSession`；`user_id` 指向不存在 UUID 的兩種資料；`password_hash`、`token_hash`、`expires_at`、`created_by` 為空值的資料 | 兩張表都有 UUID 主鍵、[資料](#資料)列出的欄位（`must_change_password` 由 AUT-AC33 驗收，不在本條範圍）與建立及修改紀錄欄位，`user_id` 外鍵指向 `User`；每一次錯誤寫入都被資料庫拒絕，筆數不變；`User` 資料表沒有任何密碼或 token 欄位 | AUT-R01、AUT-R03、AUT-R11 |

AUT-R31 屬設計約束，由 AUT-AC16～AUT-AC21 的後端測試保證：前端怎麼隱藏功能，都不影響後端的判斷。

AUT-R20～AUT-R22 中「哪些端點必須使用哪一層」的部分（管理人員、公司、角色定義的端點；修改聯絡欄位的端點；指派角色的端點），本規格只驗收檢查元件本身（AUT-AC18～AUT-AC21）；端點實際使用哪一層，由提供那些端點的功能規格（例如 `admin-dashboard`）驗收。

## 待釐清

撰寫中發現、intents 沒有依據、需要負責人選定的細節。每題附選項與建議；裁定後屬規格澄清，在實作該任務的 PR 內更新本規格。

<a id="aut-q1"></a>
- **AUT-Q1：登入狀態的絕對期限與閒置期限預設值**（已裁定，[#143](https://github.com/speko-tw/inspect-flow/issues/143)；AUT-R15、AUT-AC13、AUT-AC15）。OWASP 建議一般辦公用途絕對期限 4～8 小時、低風險系統閒置期限 15～30 分鐘。選項：（A）閒置 30 分鐘、絕對 8 小時，符合 OWASP；（B）閒置 2 小時、絕對 12 小時，現場查核人員拍照、走動時不容易被登出，但超出 OWASP 範圍；（C）不設閒置期限，絕對 7 天，最方便，風險最高。**建議 A**，現場使用若反映太常被登出，再以環境變數調長。影響計畫 T3。
  - **裁定**（負責人，[#143](https://github.com/speko-tw/inspect-flow/issues/143)，2026-09-26）：閒置期限 60 分鐘、絕對期限 8 小時。裁定留言標為選項 B，但數值與上列三個選項都不同，以這裡的數值為準。依據：OWASP Session Management Cheat Sheet 對整天使用的辦公系統，絕對期限建議 4～8 小時，低風險系統閒置期限建議 15～30 分鐘；NIST SP 800-63B（第 4 版）§2.2.3 要求 AAL2 設定絕對的重新認證期限，並建議絕對期限不超過 24 小時、閒置期限不超過 1 小時（兩個數值上限都是建議，不是強制）。現場工程師在查核點之間移動時常有一段時間沒有操作，閒置期限放寬到 60 分鐘，避免在現場被登出。60 分鐘仍在 NIST AAL2 的範圍內，但高於 OWASP 對低風險系統建議的 30 分鐘，這是依使用情境接受的取捨。
  - **落地**：寫進 AUT-R15、AUT-AC13、AUT-AC15；實作由計畫 T3 負責。
<a id="aut-q2"></a>
- **AUT-Q2：Admin 是否也通過新增、刪除與特殊動作（例如簽核、匯出列印）的權限檢查**（AUT-R19）。[KD-24](../../intents/03-decisions-and-stack.md#kd-24) 寫「查看、修改所有專案」，[KD-25](../../intents/03-decisions-and-stack.md#kd-25) 把讀取、新增、修改、刪除與特殊動作分列，因此本規格只把讀取、修改視為已裁定。選項：（A）Admin 通過所有專案權限代碼，含新增、刪除與特殊動作；（B）Admin 通過讀取、新增、修改、刪除，特殊動作仍要專案角色；（C）Admin 只通過讀取、修改，其餘都要專案角色。**建議 A**：Admin 本來就能把自己加進專案並指派任何角色，B、C 只多一道手續，擋不住 Admin；若簽核要求「本人親自具備角色」，應在該功能規格另訂。影響計畫 T4。
<a id="aut-q3"></a>
- **AUT-Q3：密碼長度與字元規則**（已裁定，[#145](https://github.com/speko-tw/inspect-flow/issues/145)；AUT-R04、AUT-AC04）。以下是裁定前的討論紀錄。OWASP：沒有多因素認證時，短於 15 字元視為弱密碼；上限至少 64 字元；不建議強制字元組成規則。當時的選項：（A）下限 15、上限 128、不限字元組成，符合 OWASP；（B）下限 12、上限 128，較好記，但低於 OWASP 無 MFA 時的建議；（C）下限 8，另要求大小寫、數字、符號。裁定前建議 A，當時寫影響計畫 T1；裁定後長度規則併入 T6，實際影響計畫 T6。
  - **裁定**（負責人，[#145](https://github.com/speko-tw/inspect-flow/issues/145)，2026-09-26）：不採上述三個選項。最短 8 字元、最長 128 字元（只用來防止超長輸入拖慢雜湊運算）；不要求字元組成；不強制定期更換，只有在有證據顯示密碼外洩時才要求更換；常見密碼黑名單這次不做，等之後改用外部身分來源（LDAP／AD）登入時再一併評估。
  - **取捨**（照實記錄）：NIST SP 800-63B（第 4 版）§3.1.1.2 對只用密碼登入規定（SHALL）最短 15 字元，並規定（SHALL）檢查常見或已外洩的密碼；搭配多因素驗證時，最短是 8 字元。本裁定的最短 8 字元低於 NIST 對單一因素的規定，也沒有做黑名單，**不符合** NIST 對只用密碼登入的規定。負責人的考量：系統在公司內網使用；現場用手機輸入長密碼負擔大；之後會改用公司的 LDAP／AD 帳號，或加入驗證碼等多因素驗證，屆時本系統的密碼不再是主要的登入方式，因此接受這個取捨，規則以簡單為原則。加入多因素驗證後，最短 8 字元這一項就符合 NIST 的規定；黑名單仍要另外評估。
  - **落地**：寫進 AUT-R04、AUT-AC04，黑名單寫成「不包含」的排除項；長度規則由計畫 T6（[#154](https://github.com/speko-tw/inspect-flow/issues/154)）實作，T1 不受影響。
<a id="aut-q4"></a>
- **AUT-Q4：之後建立的帳號怎麼取得第一次的密碼，以及內建 `admin` 能不能登入**（已裁定，[#146](https://github.com/speko-tw/inspect-flow/issues/146)；AUT-R24、AUT-R32～AUT-R38）。以下是裁定前的討論紀錄。本規格原本只提供部署人員執行的指令（AUT-R24）。Admin 在畫面上建立帳號後，被建立的人怎麼拿到密碼，#54 沒有規定。選項：（A）先只用指令，畫面上的重設與自助變更密碼另開規格；（B）`admin-dashboard` 提供「Admin 設定臨時密碼，首次登入強制變更」；（C）以 email 寄送設定密碼的連結（需要寄信服務，目前沒有）。**建議 A**，等 `admin-dashboard` 開工時再決定是否擴充為 B。另外，內建 `admin`（`is_system`）是否可以設定密碼並登入：選項（甲）可以，作為負責人帳號無法使用時的備援；（乙）不行，只作為系統操作者，指令拒絕替它設定密碼。**建議甲**，並由部署人員妥善保管密碼。當時寫：裁定前，AUT-R24 對內建 `admin` 的行為不定義；計畫 T6 在裁定後才開工。
  - **裁定**（負責人，[#146](https://github.com/speko-tw/inspect-flow/issues/146)，2026-09-26）：第一題選 B，由 Admin 設定臨時密碼，本人第一次登入時強制變更；理由是本系統在企業內部使用，這是內網系統常見的做法。`authentication` 補後端機制（臨時密碼標記、首次登入強制變更、變更密碼的流程與頁面）；「Admin 在畫面上設定臨時密碼」的操作介面屬 `admin-dashboard`，在那之前帳號密碼仍由部署人員以指令設定（AUT-R24）。外部來源帳號（`auth_source = external`）交給 AD／LDAP 驗證，本系統不保存外部密碼，也不使用本地密碼；轉成外部來源時要不要刪除本地密碼，留給 `external-identity-sync`。第二題選甲，內建 `admin` 可以設定密碼並登入，作為負責人帳號無法使用時的緊急備援帳號（業界稱 break-glass 帳號），密碼由部署人員保管，平常使用個人帳號。
  - **落地**：AUT-R24 寫明可指定內建 `admin`（AUT-AC32）；新增 AUT-R32～AUT-R38 與 AUT-AC33～AUT-AC43；AUT-R08、AUT-AC08 的目前使用者回應加上 `must_change_password`；「不包含」改寫畫面上設定密碼的歸屬，並排除臨時密碼的有效期限。實作由計畫 T4（[#152](https://github.com/speko-tw/inspect-flow/issues/152)）、T6（[#154](https://github.com/speko-tw/inspect-flow/issues/154)）與新增的 T9、T10、T11 負責。
<a id="aut-q5"></a>
- **AUT-Q5：登入失敗鎖定**（AUT-R28、AUT-AC27）。OWASP 建議依帳號計算、鎖定時間可遞增，並提醒鎖定可能被用來阻擋他人登入。選項：（A）15 分鐘內失敗 10 次，鎖定 15 分鐘；（B）失敗 5 次後開始遞增延遲（1、2、4…分鐘，上限 1 小時）；（C）MVP 不做，只在內網使用。**建議 A**：規則簡單、好測試，10 次的門檻讓一般打錯密碼不會被鎖。鎖定是否要寫稽核紀錄，併入 AUT-Q6。影響計畫 T8；裁定前 T8 不開工。
<a id="aut-q6"></a>
- **AUT-Q6：登入、登出、設定密碼、登入失敗是否寫稽核紀錄**。[KD-29](../../intents/03-decisions-and-stack.md#kd-29) 只要求權限與角色的變更寫稽核紀錄；登入事件沒有 intents 依據。稽核紀錄的資料模型待 [DOM-Q6](../domain-model/spec.md#dom-q6)。選項：（A）不寫，只保留 `AuthSession` 與 `UserPassword` 的建立及修改紀錄；（B）設定密碼寫、登入事件不寫；（C）全部寫。**建議 A**，等 DOM-Q6 定案後再評估 B。不擋任何任務。

本規格另依賴 `domain-model` 尚未裁定的題目，本規格不自行定案：

- [DOM-Q2](../domain-model/spec.md#dom-q2)（email 比對是否不分大小寫）：影響 AUT-R05 登入時怎麼比對 email，以及計畫 T3。
- [DOM-Q3](../domain-model/spec.md#dom-q3)（權限代碼命名規則與清單）：影響 AUT-R22 用哪個代碼；檢查元件本身以字串為輸入，不受影響。
- [DOM-Q6](../domain-model/spec.md#dom-q6)（稽核紀錄由哪份規格定義）：影響 [AUT-Q6](#aut-q6)。
- [DOM-Q7](../domain-model/spec.md#dom-q7)（`is_active` 預設值；`Company` 停用後其人員能不能登入）：已裁定（[#127](https://github.com/speko-tw/inspect-flow/issues/127)）。人員能不能登入只看 `User.is_active`，不需要檢查公司狀態；AUT-R06、AUT-R14 維持現狀（見 DOM-R32）。

## 變更紀錄

凍結後的「範圍變更」以上才記；一行寫改了什麼與 issue 連結。

- AUT-Q1 裁定：AUT-R15 寫入預設值閒置 60 分鐘、絕對 8 小時，以及邊界（絕對期限滿即失效、閒置剛好等於期限仍有效）；AUT-AC13 改用預設值，驗證絕對期限未滿（A 減 1 秒）與剛好到期（A）、閒置期限剛好到期（I）與超過（I 加 1 秒）時的結果，AUT-AC15 寫明預設值 — #143
- 依 AUT-Q3 裁定，AUT-R04 定為長度 8～128 字元、不要求字元組成、不強制定期更換，AUT-AC04 改為具體邊界值並補只含小寫字母的情境，「不包含」新增常見密碼黑名單 — [#145](https://github.com/speko-tw/inspect-flow/issues/145)
- 依 AUT-Q4 裁定，AUT-R24 可指定內建 `admin`，新增臨時密碼與首次登入強制變更（AUT-R32～AUT-R38、AUT-AC32～AUT-AC43），AUT-R08、AUT-AC08 的目前使用者回應加上 `must_change_password`，「不包含」改寫 Admin 設定臨時密碼的歸屬並排除臨時密碼的有效期限 — [#146](https://github.com/speko-tw/inspect-flow/issues/146)
