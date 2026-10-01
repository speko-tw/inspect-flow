# 認證與授權（authentication）：實作計畫

**規格**：[spec.md](spec.md)

計畫記錄「為什麼這樣拆」。實作中發現更好的拆法就直接更新本檔（屬於「計畫調整」）；進度看 issue，不在這裡打勾。

本計畫涵蓋 AUT-AC01～AUT-AC53，以及本次變更（[#259](https://github.com/speko-tw/inspect-flow/issues/259)）新增的 AUT-AC54～AUT-AC66；已被取代的 AUT-AC23、AUT-AC32 除外。T1～T12 是本次變更之前完成或已排定的任務，內容保持當時的樣子；本次變更對登入、初始化與密碼流程的改寫，由[本次變更後續實作](#本次變更後續實作)的 B～H 接手。跨規格的依賴：`database-foundation` T4（[#59](https://github.com/speko-tw/inspect-flow/issues/59)，`User`、`Project` 資料表），以及 `domain-model` 計畫的 T2（`User` 業務欄位）、T4（目前操作者與 Service 層）、T5（有效權限計算）、T6（初始化指令）；後者開 task issue 前還沒有編號，下表以「DOM T<n>」表示，開 issue 時換成 issue 編號。

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1 | 加入 Argon2id 套件（例如 `argon2-cffi`），實作密碼雜湊、驗證與「是否需要重新雜湊」三個函式；參數採 AUT-R01 建議的 m = 19456 KiB、t = 2、p = 1（改選 OWASP 清單中另一組時，在本 PR 更新本檔），集中在一處常數。本任務不含長度規則（AUT-Q3 已裁定，併入 T6） | `backend/pyproject.toml`、`backend/uv.lock`、`backend/app/auth/__init__.py`、`backend/app/auth/passwords.py`（新增）、`backend/tests/auth/__init__.py`、`backend/tests/auth/test_passwords.py`（新增） | — | AUT-AC01 | #149 |
| T2 | `UserPassword`、`AuthSession` 資料表：兩個 model 繼承 `database-foundation` 的共用基底；`UserPassword.user_id` 唯一、`AuthSession.token_hash` 唯一，`user_id` 為不可空值、指向 `User` 的外鍵；新增一支 migration | `backend/app/models/user_password.py`、`backend/app/models/auth_session.py`（新增）、`backend/app/models/__init__.py`（加 import）、`backend/alembic/versions/`（新增一支）、`backend/tests/db/test_auth_tables.py`（新增） | #59 | AUT-AC31 | #150 |
| T3 | 登入狀態與登入、登出、目前使用者 API：產生 token 與存 SHA-256、建立與刪除 `AuthSession`、每個請求的檢查（存在、兩種期限、`is_active`）並更新 `last_seen_at`、有效筆數查詢；密碼登入（一致的失敗回應、帳號不存在時仍驗證一次雜湊、驗證後重新雜湊）；「建立登入狀態」與「驗證密碼」分成兩個函式；需登入的 FastAPI dependency，並把登入者放進請求範圍的 context，供 T5 讀取；逾時設定讀環境變數（未設定時閒置 60 分鐘、絕對 8 小時）並寫進 `.env.example`；`auth.*` 錯誤碼加入 `ErrorCode`；`/api/v1/auth` router 註冊到 `main.py` | `backend/app/auth/sessions.py`、`backend/app/auth/login.py`、`backend/app/auth/settings.py`、`backend/app/auth/dependencies.py`（新增）、`backend/app/api/v1/auth.py`（新增）、`backend/app/api/errors.py`（加列舉成員）、`backend/app/main.py`（加一行註冊）、`.env.example`、`backend/tests/auth/test_sessions.py`、`backend/tests/auth/test_login_api.py`、`backend/tests/auth/conftest.py`（新增）、`backend/tests/contract/test_error_envelope.py`（豁免清單加 authentication spec）、`backend/tests/db/conftest.py`（`--db-backend` 未註冊時預設 sqlite，讓 `tests/auth` 能單獨執行） | T1、T2、#130（[AUT-Q1](spec.md#aut-q1) 已裁定，#143；[DOM-Q2](../domain-model/spec.md#dom-q2) 已裁定，#122：email 不分大小寫） | AUT-AC02、AUT-AC03、AUT-AC05～AUT-AC07、AUT-AC10～AUT-AC15、AUT-AC26（AUT-AC08 因 `must_change_password` 移到 T9；本任務的 `me` 先回傳其餘五個鍵） | #151 |
| T4 | 權限檢查共用元件：路由存取層級的宣告方式（公開、需登入、需 Admin、需專案權限、本人或 Admin）、公開路由清單、列出所有路由宣告並檢查的測試；需專案權限的判斷依 AUT-R19 呼叫 DOM T5 的有效權限計算，每次請求重算；`permission.denied` 加入 `ErrorCode`；替既有的健康檢查與 T3 的三條路由補上宣告；各存取層級都疊在 T3 的需登入 dependency 上，臨時密碼的阻擋（T9）因此對所有層級生效 | `backend/app/auth/access.py`（新增）、`backend/app/api/errors.py`（加列舉成員）、`backend/app/api/v1/health.py`、`backend/app/api/v1/auth.py`（只加宣告）、`backend/tests/auth/test_access.py`、`backend/tests/contract/test_route_access.py`（新增）、`backend/tests/conftest.py`（測試用登記表加 `evidence.create`、`evidence.update`）、`backend/tests/contract/test_error_envelope.py`（本檔加入錯誤碼提及的豁免清單） | T3、T9（臨時密碼的阻擋）、#133；[AUT-Q2](spec.md#aut-q2)（Admin 一律放行，已裁定，[#144](https://github.com/speko-tw/inspect-flow/issues/144)） | AUT-AC16～AUT-AC22、AUT-AC43、AUT-AC44 | #152 |
| T5 | 目前操作者入口改寫：HTTP 請求中回傳 T3 放進 context 的登入者，沒有登入者時拒絕；不在請求中時維持回傳內建 `admin`。每個 HTTP 請求都在 app 層級標記請求範圍，漏掛需登入的路由在請求中寫入會被拒絕 | `backend/app/services/operator.py`（修改，檔案由 DOM T4 建立）、`backend/app/main.py`（app 層級掛 `bind_request_scope`）、`backend/tests/services/test_operator_auth.py`（新增） | T3、#132 | AUT-AC09 | #153 |
| T6 | 設定密碼的指令：以 email 指定帳號（含內建 `admin`，AUT-Q4 裁定），`getpass` 輸入兩次，也接受標準輸入；長度規則檢查；拒絕不存在與 `external` 帳號；寫入或更新 `UserPassword`（操作者為內建 `admin`）並刪除該帳號所有 `AuthSession`；指令列不提供密碼參數；在 `Makefile` 加一個執行入口；寫入集中在同一個函式，T11 改呼叫 Service 入口。不寫稽核紀錄，指令的 `user.password_set` 由 T11 的 Service 入口負責（見[風險](#風險)「T6 不寫稽核紀錄」） | `backend/app/cli/set_password.py`（新增；`backend/app/cli/` 套件由 DOM T6 建立）、`backend/app/auth/passwords.py`（加長度規則）、`Makefile`（加一個 target）、`backend/tests/cli/test_set_password.py`（新增）、`README.md`、`README.zh-TW.md`（「本機執行」補設定密碼的步驟，#209 交接） | T1、T2、T3（刪除登入狀態）、#134（[AUT-Q3](spec.md#aut-q3)、[AUT-Q4](spec.md#aut-q4) 已裁定，#145、#146） | AUT-AC04、AUT-AC23～AUT-AC25、AUT-AC32 | #154 |
| T7 | 前端登入：`/login` 頁、呼叫目前使用者 API 的共用 hook、未登入導向 `/login` 並保留原路徑的守衛、登出按鈕；Admin Web 與 Field Web 都掛上守衛。守衛與登入頁放在 `src/auth/`，不得 import `src/admin/`，拆包檢查（SKL-AC03）照常通過。**新 worktree 先執行 `make setup`** | `frontend/src/auth/`（新增 `LoginPage.tsx`、`RequireAuth.tsx`、`api.ts` 與測試）、`frontend/src/App.tsx`（加路由與守衛）、`frontend/src/admin/AdminPage.tsx`、`frontend/src/field/FieldPage.tsx`（加登出操作）、`frontend/vite.config.ts`（加開發用的 `/api` proxy） | —（依 spec 的 HTTP 契約以測試替身開發；與後端的實際串接在 T3 合併後手動確認一次） | AUT-AC28～AUT-AC30 | #155 |
| T8 | 登入失敗鎖定（[AUT-Q5](spec.md#aut-q5) 已裁定）：依帳號記錄失敗時間，15 分鐘內 10 次鎖定 15 分鐘、自動解鎖、成功清零、鎖定期間不計入也不延長（AUT-R28）；記錄失敗、是否鎖定、清零三個函式集中在 `lockout.py`，登入呼叫它們；三個數值集中為常數，比照 T3 的 `settings.py` 讀環境變數並寫進 `.env.example`；被鎖時在同一個交易寫 `user.locked` 稽核紀錄（AUT-R39）。**與 T11 的銜接**：變更密碼 API 驗證目前密碼時也要呼叫同一組函式；T8 先合併時由 T11 接上，T11 先合併時由 T8 接上，接上的一方負責 AUT-AC47。另依 AUT-R28（6）（負責人裁定，[#192](https://github.com/speko-tw/inspect-flow/issues/192#issuecomment-5853201917)）：`password_service.set_password`（T11）重設密碼時要呼叫本任務「清零」的函式解除鎖定；T11 已先留一個呼叫點（目前是無動作的 placeholder），本任務合併時把它換成真正呼叫 `lockout.py` 的清零函式，並補上 AUT-AC53 的測試（鎖定中重設密碼後可用新密碼登入） | `backend/app/auth/lockout.py`（新增）、`backend/app/auth/settings.py`（加鎖定設定）、`backend/app/auth/login.py`（修改）、`.env.example`、`backend/app/models/`、`backend/alembic/versions/`（保存失敗紀錄時新增欄位或資料表與一支 migration）、`backend/tests/auth/test_login_lockout.py`（新增，含 AUT-AC53）；T11 已合併時另改 `backend/app/api/v1/auth.py` 或 `password_service.py`（把清零 placeholder 換成真正呼叫） | T3（#151，已合併）；`audit-log` T2（[#216](https://github.com/speko-tw/inspect-flow/issues/216)，寫入入口）；[AUT-Q5](spec.md#aut-q5) 已裁定（#147） | AUT-AC27、AUT-AC45、AUT-AC46、AUT-AC48、AUT-AC51、AUT-AC53；AUT-AC47（T11 先合併時） | #156 |
| T9 | 臨時密碼標記與阻擋：`UserPassword` 加 `must_change_password` 欄位與一支 migration；需登入的 dependency 在 AUT-R14 的檢查之後加上臨時密碼檢查，只放行集中在一處的允許清單（本任務先列 `me`、登出，T11 加入變更密碼）；`me` 與登入回應加 `must_change_password`；AUT-R33 對應的錯誤碼加入 `ErrorCode` | `backend/app/models/user_password.py`（加欄位）、`backend/alembic/versions/`（新增一支）、`backend/app/auth/dependencies.py`（加檢查與允許清單）、`backend/app/api/v1/auth.py`（回應加欄位）、`backend/app/api/errors.py`（加列舉成員）、`backend/tests/auth/test_password_gate.py`、`backend/tests/db/test_user_password_flag.py`（新增） | T2（#150）、T3 | AUT-AC08、AUT-AC33、AUT-AC35 | #190 |
| T10 | 前端變更密碼：`/change-password` 頁（目前密碼、新密碼、再輸入一次）、依錯誤碼顯示訊息；守衛在 `must_change_password = true` 時導向此頁並保留原路徑；Admin Web 與 Field Web 的登出旁加變更密碼入口。守衛與頁面放在 `src/auth/`，不得 import `src/admin/`。**新 worktree 先執行 `make setup`** | `frontend/src/auth/`（新增 `ChangePasswordPage.tsx` 與測試；修改 `RequireAuth.tsx`、`api.ts`）、`frontend/src/App.tsx`（加路由）、`frontend/src/admin/AdminPage.tsx`、`frontend/src/field/FieldPage.tsx`（加入口） | T7（#155）；依 spec 的 HTTP 契約以測試替身開發，與後端的實際串接在 T9、T11 合併後手動確認一次 | AUT-AC41、AUT-AC42 | #191 |
| T11 | 變更密碼與設定密碼入口（後端）：設定密碼的 Service 入口（目標、新密碼、是否標為臨時；長度檢查、雜湊、寫入、刪除登入狀態），T6 的指令改呼叫它，並依 `is_system` 決定是否標為臨時；`POST /api/v1/auth/password`（驗證目前密碼、長度規則、臨時密碼不得不變、外部帳號拒絕、刪除所有登入狀態並換發目前這一筆），加入 T9 的允許清單；變更密碼的三個錯誤碼加入 `ErrorCode`。設定成功時由 Service 入口在同一個交易寫 `user.password_set` 稽核紀錄（AUT-R39），指令與變更密碼 API 都經過它（含 AUT-AC49 的指令情境，由 T6 移來）；依 AUT-R28（6）（負責人裁定，[#192](https://github.com/speko-tw/inspect-flow/issues/192#issuecomment-5853201917)），Service 入口重設密碼時要解除鎖定並清零失敗計數：T8（#156）還沒合併，本任務只在 Service 入口留一個無動作的 placeholder 呼叫點，T8 合併時換成真正呼叫（見 T8 的銜接），本任務不實作鎖定本身，AUT-AC53 的測試與驗收都屬 T8；T8 已合併時，變更密碼 API 驗證目前密碼時另呼叫 T8 的鎖定函式（AUT-AC47，見 T8 的銜接）。T4 已合併時，替新路由補上存取層級宣告；否則由 T4 補 | `backend/app/auth/password_service.py`（新增）、`backend/app/api/v1/auth.py`（加路由，於其中呼叫 T9 的 `register_temporary_password_allowed` 補上允許清單第三條）、`backend/app/api/errors.py`（加列舉成員）、`backend/app/cli/set_password.py`（改呼叫 Service 入口）、`backend/tests/auth/test_password_change.py`（新增）、`backend/tests/cli/test_set_password.py`（加案例）、`backend/tests/auth/test_password_gate.py`（移除 T9 暫時的允許清單內容斷言，改到 `test_password_change.py` 的 AUT-AC36） | T5（操作者為本人）、T6、T9；`audit-log` T2（[#216](https://github.com/speko-tw/inspect-flow/issues/216)） | AUT-AC34、AUT-AC36～AUT-AC40、AUT-AC49、AUT-AC50；AUT-AC47（T8 先合併時） | #192 |
| T12 | 登入、登出的應用程式日誌（[AUT-Q6](spec.md#aut-q6) 已裁定）：Python `logging`，固定 logger 名稱 `app.auth`，以 `extra` 帶結構化欄位（`event`、`user_id`、`reason`）；登入成功、登入失敗（含鎖定中）、登出各寫一筆；不記密碼、token、Cookie 值、輸入的 email 原文（AUT-R40、AUT-R41）。專案目前沒有統一的日誌設定（[#41](https://github.com/speko-tw/inspect-flow/issues/41) 未完成），本任務不加 handler 或格式設定 | `backend/app/auth/login.py`、`backend/app/api/v1/auth.py`（登出）、`backend/tests/auth/test_auth_logging.py`（新增） | T3（#151，已合併）；「鎖定中」的原因要等 T8，T8 未合併時先記另兩種原因，由 T8 補上 | AUT-AC52 | #230 |

- 每個任務一個 PR 就能完成，並能單獨驗收。
- 每個任務至少對應一條 AC；AUT-AC01～AUT-AC52 每條都被一個任務涵蓋。
- 依 plan 開 task issue 時才建立上表的 issue 編號；本 PR 只寫文件，不開 task issue。開 issue 時，若依賴的裁定或其他規格的任務尚未完成，issue 標 `blocked` 並寫明原因。
- AUT-R31（前端隱藏功能不取代後端檢查）沒有獨立的任務，由 T4 的後端測試保證。

## 本次變更後續實作

依據：負責人裁定（[#259](https://github.com/speko-tw/inspect-flow/issues/259)，2026-09-29）。本次是範圍變更：`admin` 密碼改由首次登入碼在網頁上設定、登入改用帳號名稱或 email、一般的設定密碼指令移除、新增 `admin` 重設指令。T1～T12 的內容不改寫；已完成的部分不重做，由下列任務在既有程式上修改。每個任務一個 PR，先開 issue 再動工。

| 任務 | 內容（與本規格有關的部分） | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|
| B | 模型與 migration（`domain-model` 計畫的 B）：`User` 加 `username`、內建 `admin` 欄位限制，`Company` 精簡。**本任務負責建立 `SetupCode` 資料表與其 migration**（欄位見[資料](spec.md#資料)）：UUID 主鍵、建立及修改紀錄欄位（`created_by`、`updated_by` 外鍵指向 `User`）、`code_hash` 與 `expires_at` 不可空值、`voided_at` 可空值，另有失敗計數與鎖定欄位 `failed_attempts`（整數、不可空值、預設 0）、`failure_window_started_at`（可空值）、`locked_until`（可空值）。「同一時間至多一筆有效」是隨時間變化的規則，不做成資料庫約束，由 C 的 Service 保證（AUT-AC55）；重跑初始化建新列，計數從 0 開始，不另建計數表。migration 鏈只排一次，C 不再新增資料表 | T2、T9 | AUT-AC31（增列 `SetupCode` 的欄位、可空性與外鍵斷言） | [#260](https://github.com/speko-tw/inspect-flow/issues/260) |
| C | 初始化與首次設定 API：初始化指令產生並印出首次登入碼、重跑規則（AUT-R42、AUT-R43），**只使用 B 建好的 `SetupCode` 資料表**，不建表、不加 migration；`GET /api/v1/setup/status`、`POST /api/v1/setup/admin-password`（AUT-R44）；首次登入碼失敗鎖定，計數與 T8 分開，用 B 建好的 `failed_attempts`、`failure_window_started_at`、`locked_until` 實作計數、鎖定與成功後清零；重跑初始化新增一列，鎖定自然清除（AUT-R45、AUT-R43）；首次設定與重設寫系統事件的 `user.password_set`（`audit-log` ALG-R18）；`make reset-admin-password` 取代 T6 的設定密碼指令，經 T11 的 Service 入口寫入（AUT-R47）；公開路由清單加兩條（AUT-R18）。首次設定成功後 `admin` 已登入（AUT-R44），C **不**建立使用者的端點，新增第一個使用者由前端呼叫 E 的新增使用者 API | B、T3、T4、T8、T11、`audit-log` T2 | AUT-AC16、AUT-AC23（已取代）、AUT-AC24、AUT-AC25、AUT-AC32（已取代）、AUT-AC34、AUT-AC49、AUT-AC53～AUT-AC64、AUT-AC66；另 AUT-AC04 改用重設指令 | [#261](https://github.com/speko-tw/inspect-flow/issues/261) |
| D | 帳號名稱或 email 登入：登入 API 的請求欄位 `login`、含 `@` 用 email 否則用帳號名稱、比對不分大小寫；`me` 加 `username`；失敗回應與鎖定計數維持一致（AUT-R05、AUT-R06、AUT-R08、AUT-R28） | B、T3、T8 | AUT-AC05、AUT-AC06、AUT-AC08 | [#262](https://github.com/speko-tw/inspect-flow/issues/262) |
| E | 使用者與公司 API：新增使用者時由系統產生臨時密碼、只回傳一次、「給予 admin 權限」勾選（AUT-R46）；其餘規則見 `domain-model` 計畫的 E | B、C、T11 | AUT-AC61 | [#263](https://github.com/speko-tw/inspect-flow/issues/263) |
| F | 前端登入與首次設定頁：登入頁改為「帳號名稱或 email」、`/setup` 首次設定頁與導向守衛（AUT-R29）；首次設定成功後（已登入）進入「新增第一個使用者」步驟，呼叫 E 的新增使用者 API。驗收涵蓋「設定密碼 → 新增第一個使用者」整段流程；一般的使用者與公司管理頁屬 G | C、D、E、T7 | AUT-AC65 | [#264](https://github.com/speko-tw/inspect-flow/issues/264) |
| G | 前端管理頁（簡便版，一般管理頁；首次設定後新增第一個使用者的步驟屬 F）：本規格只要求新增使用者的畫面顯示一次臨時密碼與「給予 admin 權限」勾選框（預設不勾） | E | AUT-AC61（畫面部分） | [#265](https://github.com/speko-tw/inspect-flow/issues/265) |
| H | 端到端驗收：從 `make init` 到首次設定、登入、新增使用者、首次登入強制變更的完整流程 | C～G | 上列各 AC 的端到端串接 | [#266](https://github.com/speko-tw/inspect-flow/issues/266) |

**本次變更對既有任務的影響**（既有任務的內容保持原樣，影響由 B～H 修改）：

| 既有任務 | 影響 | 由誰接手 |
|---|---|---|
| T3（登入、登出、目前使用者） | 登入改用帳號名稱或 email，`me` 加 `username`；帳號不存在時仍驗證一次雜湊的做法不變 | D |
| T6（設定密碼的指令） | 一般使用者的設定密碼指令移除（AUT-R24 已被取代）；`app/cli/set_password.py` 與 `Makefile` 的入口改為 `make reset-admin-password`，只指定內建 `admin`，其餘檢查沿用 | C |
| T8（登入失敗鎖定） | 計數仍依帳號；帳號名稱與 email 指向同一帳號共用計數；另新增首次登入碼的鎖定，獨立計數、不寫稽核、只寫日誌，不改動 T8 的 `lockout.py` 對外行為 | C、D |
| T11（變更密碼與設定密碼入口） | Service 入口的呼叫方改為首次設定、重設指令與使用者管理 API；AUT-R37 的標臨時規則改依情境；入口本身不變 | C、E |
| T12（登入、登出日誌） | 日誌不得記錄帳號欄的原文（AUT-R41）；加首次登入碼被鎖的日誌事件；沿用同一個 logger 與欄位慣例 | C |

- C、D、E 都會改 `backend/app/api/v1/auth.py` 或相鄰的 router，以及 `errors.py`（`setup.invalid_code`、`setup.already_completed`），同一波內後合併的一方 rebase；C 與 D 若同時進行，D 只改 `login.py` 與 `auth.py` 的登入部分，C 新增 `api/v1/setup.py` 與 `cli/`，檔案不重疊。
- `Makefile` 只有 C 改（`init` 的說明與 `reset-admin-password` target）；README 的「本機執行」步驟由 C 同步更新（本次文件變更不動 README，屬 C 的任務）。
- 簡便版的使用者與公司管理屬 0.2.x（E 的 API、G 的頁面）；搜尋、分頁、批次等進階功能仍屬 `admin-dashboard`（[#107](https://github.com/speko-tw/inspect-flow/issues/107)）。
- 這些任務的檔案清單，開 issue 時依當時的程式碼盤點，不在這裡預先寫死。

## 並行分組

依「改動的檔案」與「依賴」分波；同一波內的任務檔案不重疊，也互不依賴。

- 第 1 波：T1、T2、T7。T1 改依賴檔與 `app/auth/passwords.py`，T2 改 `app/models/` 與 migration（等 #59），T7 只改 `frontend/`。
- 第 2 波：T3（依賴 T1、T2、DOM T2）。
- 第 3 波：T5（依賴 T3、DOM T4）、T6（依賴 T1～T3、DOM T6）、T9（依賴 T2、T3）。T5 改 `app/services/operator.py`、`app/main.py`；T6 改 `app/cli/`、`passwords.py`、`Makefile`；T9 改 `user_password.py`、migration、`dependencies.py`、`auth.py`、`errors.py`。三者檔案不重疊。
- 第 4 波：T4（依賴 T3、T9、DOM T5；AUT-Q2 已裁定）、T8（依賴 T3 與 `audit-log` T2；改 T3 的 `login.py`）。T4 改 `access.py`、`errors.py`、兩個 router；T8 改 `lockout.py`、`settings.py`、`login.py`、`.env.example` 與視設計新增的 model、migration。兩者檔案不重疊。
- T12 只依賴已合併的 T3，得隨時開工；它和 T8 都改 `login.py`，同時進行時後合併的一方 rebase。
- 第 5 波：T11（依賴 T5、T6、T9）。T11 與 T4 都改 `errors.py`、`api/v1/auth.py`，所以排在 T4 之後；T4 仍被裁定擋住時，T11 得先做，後合併的一方 rebase。
- T10 只改 `frontend/`，依賴已合併的 T7，得隨時開工，不必等後端。

碰到[共用檔案](../README.md#parallel)的地方：

- lockfile：只有 T1 新增套件（`argon2-cffi`），T1 先合併，其他後端分支再 rebase 並重新產生 `uv.lock`。其他任務若發現需要新套件，改為先開獨立任務加依賴。
- Alembic migration 鏈：T2 新增一支，T8 視設計新增一支，T9 新增一支（加欄位）；每個 PR 最多一支，T2、T8、T9 之間後合併的一方 rebase 並改接 `down_revision`。T2 與 `domain-model` 的 T1～T3 都會新增 migration，後合併的一方先 rebase，並把 `down_revision` 改接到最新 head。
- `backend/app/models/__init__.py`：T2 加兩行 import；`domain-model` 的 T1、T3 也改這個檔案，同時進行時後合併的一方 rebase。
- `backend/app/api/errors.py` 的 `ErrorCode`：T3 加 `auth.*`，T4 加 `permission.denied`，T9 加 `auth.password_change_required`，T11 加變更密碼的三個 `auth.*`；各任務不同波，T11 若先於 T4 合併，後合併的一方 rebase。
- `backend/app/main.py`：T3 加一行 router 註冊，T5 另加 app 層級的 `bind_request_scope` dependency，兩者不衝突。
- `Makefile`：只有 T6 加一個 target（T11 只改指令內部，不動 target）；`domain-model` T6 也加一個 target，後合併的一方 rebase。
- `.env.example`：T3 加逾時的兩個變數，T8 加鎖定的三個變數。

## 風險

- **`Secure` 與 `__Host-` Cookie 在本機開發與測試中不會被送出**：瀏覽器與 httpx 只在 HTTPS（或瀏覽器視為安全的 `localhost`）送出 `Secure` Cookie。測試用戶端一律以 `https://testserver` 為 base URL；本機開發以 `localhost` 開啟。Safari 對 `http://localhost` 的 `Secure` Cookie 支援程度不確定，T7 在 PR 說明記下實際在哪些瀏覽器確認過。**不得**為了開發方便加上關閉 `Secure` 的設定。
- **Vite 開發伺服器與後端不同 port**：`SameSite=Strict` 看的是 site（不含 port），`localhost:5173` 與 `localhost:8000` 同 site，Cookie 會帶；但跨 origin 的 `fetch` 需要 CORS 與 `credentials`。目前 `vite.config.ts` 沒有 proxy，T7 **應**加上 Vite 的 dev proxy，讓前端以同 origin 呼叫 `/api`，避免為了開發開 CORS。
- **預設拒絕被新路由繞過**：新路由忘了宣告存取層級時，T4 的測試會失敗；但若有人宣告成「公開」就能繞過。公開路由集中在一份清單，測試斷言清單內容恰為健康檢查、登入、登出（[#259](https://github.com/speko-tw/inspect-flow/issues/259) 起再加首次設定的兩條路由，AUT-R44），新增公開路由必須同時改清單與測試，審查時看得到。
- **帳號不存在時的時間差**：AUT-R06 要求帳號不存在時仍驗證一次雜湊。T3 以一個啟動時產生的假雜湊來驗證，不要每次重新產生（產生雜湊本身也要時間，會讓兩條路徑的時間不同）。AC 只驗「驗證函式有被呼叫」，不量測時間，避免測試不穩定。
- **有效權限每次請求重算的效能**：AUT-R19 不允許跨請求快取。一次請求多次檢查時，T4 **得**在同一個請求內重用第一次的結果；跨請求的快取等效能出現問題再評估，且必須先處理「修改角色立即生效」。
- **目前操作者入口在請求中不再退回 `admin`**：T5 合併後，任何在請求中寫入、卻沒有經過需登入 dependency 的程式會直接失敗。這是預期行為（AUT-R09）。光靠審查時搜尋呼叫端不夠可靠——路由本身漏掛需登入 dependency 時，`in_request_scope()` 會判斷成「不在請求中」而退回 `admin`，等於繞過這條防線又不會被發現。因此 T5 把 `bind_request_scope` 掛在 `app/main.py` 的 app 層級（對每個路由生效，不必逐一宣告），漏掛需登入的路由仍會落在請求範圍內、寫入時直接失敗，`test_operator_auth.py` 有一條反例測試驗證這個情境。
- **T4 的存取層級必須疊在 T3 的需登入 dependency 上**：AUT-R33 的臨時密碼檢查放在需登入的 dependency（T9）；需 Admin、需專案權限、本人或 Admin 若另寫一套登入檢查，會繞過臨時密碼的限制。因此 T4 排在 T9 之後，並以 AUT-AC43 驗收四種存取層級都被擋。
- **T11 改寫 T6 的指令**：T6 先照 AUT-R24 直接寫 `UserPassword`，T11 再把寫入改成呼叫 Service 入口並加上標記。T6 實作時把寫入集中在一個函式，T11 才容易替換；AUT-AC04、AUT-AC23～AUT-AC25、AUT-AC32 在 T11 之後仍須通過。
- **T6 不寫稽核紀錄**：`user.password_set` 要經 `audit-log` T2（#216）的寫入入口，#216 還沒完成。T6 若等它，本機就沒辦法先設定密碼、試登入登出。所以 T6 只寫 `UserPassword`，AUT-AC49 的指令情境由 T11 負責：T11 本來就要把指令改成呼叫 Service 入口，稽核在入口寫一次，就同時涵蓋指令與 API。代價是 T6 合併到 T11 合併之間，用指令設定密碼不會留下稽核紀錄。
- **鎖定的寫入不能跟著 401 回滾**：登入失敗時回 401，但失敗紀錄、鎖定狀態與 `user.locked` 稽核紀錄都要提交；T8 要確認這個交易在回傳失敗回應前已提交，AUT-AC27、AUT-AC51 會抓到漏提交。
- **裁定未完成就開工**：T3 的裁定都已完成（AUT-Q1、DOM-Q2）；T4 的裁定都已完成（AUT-Q2、DOM-Q3）；T6 的裁定都已完成（AUT-Q3、AUT-Q4）；T8、T12 的裁定都已完成（AUT-Q5、AUT-Q6）。不要先用建議值實作再等裁定；建議值寫在規格裡，是給負責人選的，不是預設。

## 驗證（Proof）

後端皆以 `make check` 執行；PostgreSQL 由 `database-foundation` T3 的 CI 補驗。

| AC | 驗證方式 |
|---|---|
| AUT-AC01 | `backend/tests/auth/test_passwords.py`：雜湊兩次，斷言前綴、參數段等於設定的參數組且屬於 AUT-R01 的清單、兩者不同、驗證正確與錯誤密碼 |
| AUT-AC02 | `backend/tests/auth/test_login_api.py`：以 AUT-R01 清單中與程式設定不同的一組完整參數預先寫入雜湊，登入後讀回 `UserPassword`，斷言參數段已更新且仍可驗證 |
| AUT-AC03 | `backend/tests/auth/test_login_api.py`：以 pytest 的 `caplog` 擷取日誌，呼叫登入與 `me`，斷言回應本體與日誌不含密碼、雜湊與 token |
| AUT-AC04 | `backend/tests/cli/test_set_password.py`（T6）：以標準輸入依 AUT-AC04 的五種密碼（7、8、128 含中文字、129、只含小寫字母）各執行一次指令，斷言成功或失敗與 `UserPassword` 的內容；本次變更（[#259](https://github.com/speko-tw/inspect-flow/issues/259)）後改以 `admin` 重設指令（C）驗證同樣五種密碼 |
| AUT-AC05 | `backend/tests/auth/test_login_api.py`：解析 `Set-Cookie` 的屬性，查資料庫比對 `token_hash` 與 Cookie 值的 SHA-256；本次變更後改以帳號名稱與 email 各種大小寫與前後空白登入（D） |
| AUT-AC06 | `backend/tests/auth/test_login_api.py`：參數化五種情境，斷言狀態碼、回應本體逐位元組相同、無 `Set-Cookie`、`AuthSession` 筆數不變；以 monkeypatch 計數驗證函式的呼叫次數；本次變更後為六種情境（D） |
| AUT-AC07 | `backend/tests/auth/test_login_api.py`：登出後斷言 204、清除 Cookie 的 `Set-Cookie`、資料庫無該筆，再呼叫 `me` 斷言 401；無 Cookie 登出斷言 204 |
| AUT-AC08 | `backend/tests/auth/test_password_gate.py`（T9）：斷言 `me` 回應的鍵集合（含 `must_change_password`）與未登入的 401；本次變更後鍵集合含 `username`（D） |
| AUT-AC09 | `backend/tests/services/test_operator_auth.py`（T5）：測試專用路由經 Service 層寫入 `Company`，分別以登入、未登入、非請求情境斷言 `created_by` |
| AUT-AC10 | `backend/tests/auth/test_sessions.py`：兩個用戶端登入，斷言 token 不同、長度、不沿用請求帶來的 token、兩者皆可呼叫 `me` |
| AUT-AC11 | `backend/tests/auth/test_sessions.py`：直接以 ORM 停用帳號，斷言兩個 Cookie 都 401 且 `AuthSession` 已刪除 |
| AUT-AC12 | `backend/tests/auth/test_sessions.py`：以 ORM 建立 `external` 帳號，直接呼叫建立登入狀態的函式後呼叫 `me` 斷言 200，再以密碼登入斷言 401 |
| AUT-AC13 | `backend/tests/auth/test_sessions.py`：以 `database-foundation` 的可控時間推進時鐘，斷言預設的絕對期限在滿 8 小時前 1 秒仍有效、剛好 8 小時失效，閒置期限在剛好 60 分鐘仍有效、超過 1 秒失效，以及`last_seen_at` 的更新與過期資料的刪除 |
| AUT-AC14 | `backend/tests/auth/test_sessions.py`：直接建立三筆 `AuthSession`（其中一筆過期），呼叫筆數查詢 |
| AUT-AC15 | `backend/tests/auth/test_sessions.py`：以 monkeypatch 設定與清除環境變數，斷言讀到的設定值；讀取 repo 根目錄的 `.env.example`，斷言含兩個變數名稱 |
| AUT-AC16 | `backend/tests/contract/test_route_access.py`（T4）：走訪 `create_app()` 的業務路由（沿用 API-AC01 的走訪方式），斷言都有宣告、公開清單內容；另建一個加了未宣告路由的 app，斷言檢查失敗並回報路由路徑；本次變更後公開清單含首次設定的兩條路由（C） |
| AUT-AC17 | `backend/tests/auth/test_access.py`（T4）：四條測試路由不帶 Cookie 呼叫，斷言 401 與處理函式的呼叫計數為 0 |
| AUT-AC18 | `backend/tests/auth/test_access.py`（T4）：以 ORM 建立專案、角色與成員，斷言各組合的狀態碼 |
| AUT-AC19 | `backend/tests/auth/test_access.py`（T4）：同一個已登入用戶端，修改 R1 與 `is_admin` 後再呼叫，斷言狀態碼改變 |
| AUT-AC20 | `backend/tests/auth/test_access.py`（T4）：Admin 與非 Admin 呼叫需 Admin 的測試路由 |
| AUT-AC21 | `backend/tests/auth/test_access.py`（T4）：三種組合呼叫「本人或 Admin」的測試路由 |
| AUT-AC22 | `backend/tests/contract/test_route_access.py`（T4）：呼叫 `build_error_code_descriptions(ErrorCode)`，斷言含三個代碼並符合 API-AC09 的 regex |
| AUT-AC23 | `backend/tests/cli/test_set_password.py`（T6）：初始化後先以 T3 的函式替負責人建立一筆登入狀態，再以標準輸入執行指令；斷言 `UserPassword` 內容與操作者、舊 Cookie 401、新密碼登入成功。**已被取代**（[#259](https://github.com/speko-tw/inspect-flow/issues/259)）：指令已移除，由 AUT-AC54～AUT-AC64 接手 |
| AUT-AC24 | `backend/tests/cli/test_set_password.py`（T6）：三種失敗輸入，斷言回報失敗且 `UserPassword` 不變；本次變更後改測 `admin` 重設指令的失敗輸入（C） |
| AUT-AC25 | `backend/tests/cli/test_set_password.py`（T6）：以 subprocess 執行 `--help`、空標準輸入與多加 `--password`，設定兩個環境變數，斷言輸出、結束碼與 `UserPassword` 無寫入；本次變更後改測重設指令沒有密碼與帳號參數（C） |
| AUT-AC26 | `backend/tests/auth/test_sessions.py`：直接呼叫建立登入狀態的函式後以 Cookie 呼叫 `me`；以 `inspect.signature` 斷言參數不含密碼 |
| AUT-AC27 | `backend/tests/auth/test_login_lockout.py`（T8）：以可控時間觸發鎖定，斷言鎖定期間三次嘗試的狀態碼與本體和一般失敗相同、沒有 `Set-Cookie`，剛好 15 分鐘時登入成功 |
| AUT-AC28 | `frontend/src/auth/RequireAuth.test.tsx`（T7）：以 `MemoryRouter` 渲染 `/admin`、`/field`，替身回 401，斷言導向 `/login` 並帶原路徑；替身改回 200 後送出表單，斷言回到原路徑；`npm run test` |
| AUT-AC29 | `frontend/src/auth/LoginPage.test.tsx`（T7）：替身回 401，斷言顯示通用訊息、密碼欄位的 `type`；`npm run test` |
| AUT-AC30 | `frontend/src/auth/LoginPage.test.tsx`（T7）：以 `vi.spyOn` 監看 `Storage.prototype.setItem` 與 `fetch`，斷言沒有寫入、沒有自訂 `Authorization` 或 `Cookie` 標頭、登出呼叫 API 並導向 `/login`；`npm run test` |
| AUT-AC31 | `backend/tests/db/test_auth_tables.py`（T2；`SetupCode` 的斷言由 B 增列）：inspector 檢查三張表的欄位、可空性、唯一與外鍵（`SetupCode` 含 `failed_attempts` 的整數型別、不可空與預設 0，`failure_window_started_at`、`locked_until` 可空），並斷言 `User` 資料表沒有密碼或 token 欄位；依 AC 的錯誤寫入斷言 `IntegrityError` 且筆數不變 |
| AUT-AC32 | `backend/tests/cli/test_set_password.py`（T6）：初始化後以標準輸入對內建 `admin` 執行指令，斷言 `UserPassword` 有一筆，再以登入 API 斷言 200 與 `is_admin`。**已被取代**（[#259](https://github.com/speko-tw/inspect-flow/issues/259)）：由 AUT-AC58 接手 |
| AUT-AC33 | `backend/tests/db/test_user_password_flag.py`（T9）：inspector 檢查欄位與可空性；以 ORM 新增不指定欄位的資料讀回 `false`，空值寫入斷言 `IntegrityError` 且筆數不變 |
| AUT-AC34 | `backend/tests/cli/test_set_password.py`（T11）：分別對一般帳號與內建 `admin` 執行指令，斷言標記，再登入並呼叫 `me` 斷言回應欄位；本次變更後改為 Service 入口新增的帳號、首次設定與重設指令（C、E） |
| AUT-AC35 | `backend/tests/auth/test_password_gate.py`（T9）：以 ORM 把標記設為 `true`，掛一條計數的需登入測試路由，斷言 403 與計數 0、`me` 與登出放行；以 ORM 建立帶標記的 `external` 帳號，直接建立登入狀態後斷言放行 |
| AUT-AC36 | `backend/tests/auth/test_password_change.py`（T11）：讀取允許清單常數，斷言內容恰為三條，且每條都在 `create_app()` 的路由中 |
| AUT-AC37 | `backend/tests/auth/test_password_change.py`（T11）：參數化四種失敗，斷言狀態碼與 `error.code`，並讀回 `UserPassword` 與登入狀態筆數斷言不變 |
| AUT-AC38 | `backend/tests/auth/test_password_change.py`（T11）：三個用戶端登入後由 A 變更，斷言 204、換發的 `Set-Cookie`（值不同於原 Cookie、至少 43 個 base64url 字元、屬性同 AUT-AC05）、標記、`updated_by`、A 原 Cookie 與 B、C 的 401、剩一筆登入狀態且 `token_hash` 對應新 Cookie，以及新舊密碼登入結果 |
| AUT-AC39 | `backend/tests/auth/test_password_change.py`（T11）：直接呼叫 Service 入口，依序斷言標記、雜湊可驗證、登入狀態刪除，以及 7 字元被拒絕 |
| AUT-AC40 | `backend/tests/auth/test_password_change.py`（T11）：呼叫 `build_error_code_descriptions(ErrorCode)`，斷言含四個代碼並符合 API-AC09 的 regex |
| AUT-AC41 | `frontend/src/auth/RequireAuth.test.tsx`（T10）：替身回 `must_change_password: true`，渲染 `/admin`、`/field` 斷言導向 `/change-password` 並帶原路徑；送出表單後斷言回到原路徑；`npm run test` |
| AUT-AC42 | `frontend/src/auth/ChangePasswordPage.test.tsx`（T10）：兩次新密碼不同時斷言 `fetch` 未被呼叫；依序讓替身回三種錯誤，斷言三則訊息不同、三個欄位的 `type`；`npm run test` |
| AUT-AC43 | `backend/tests/auth/test_access.py`（T4）：以 ORM 建立 Admin 兼專案成員的 T 並設標記，呼叫 AUT-AC17 的四條測試路由，斷言 403（AUT-R33 的錯誤碼）與計數 0；清除標記後斷言四條放行 |
| AUT-AC44 | `backend/tests/auth/test_access.py`（T4）：以 ORM 建立非成員的 Admin 與只有讀取角色的成員，參數化四條路由，斷言 Admin 放行、成員四次都是 403 且 `error.code` 為 `permission.denied` |
| AUT-AC45 | `backend/tests/auth/test_login_lockout.py`（T8）：兩個帳號各跑一個情境，斷言 15 分鐘減 1 秒時已鎖、剛好 15 分鐘時前 9 次不再計入 |
| AUT-AC46 | `backend/tests/auth/test_login_lockout.py`（T8）：錯 9 次與成功交錯，斷言成功清零；再連錯 10 次斷言鎖定 |
| AUT-AC47 | T8、T11 中後合併的一方：交錯呼叫變更密碼 API 與登入 API 各錯 5 次，斷言登入 401、變更密碼 400 且 `UserPassword` 與登入狀態筆數不變 |
| AUT-AC48 | `backend/tests/auth/test_login_lockout.py`（T8）：以 `monkeypatch` 設定與清除三個環境變數，斷言讀到的值；讀 `.env.example` 斷言列出三個變數 |
| AUT-AC53 | `backend/tests/auth/test_login_lockout.py`（T8）：觸發鎖定後，在鎖定生效中呼叫 Service 入口重設密碼，斷言重設後立即以新密碼登入成功、失敗計數與鎖定狀態都已清除；T11 只在 Service 入口留呼叫點，不驗收本條；本次變更後改由 Admin 設定臨時密碼的入口觸發（T8 已合併，C 或 E 補測） |
| AUT-AC49 | `backend/tests/cli/test_set_password.py`（T11）：以標準輸入替兩個帳號設定、再跑一次失敗案例，查 `audit_logs` 斷言筆數、欄位與序列化內容不含密碼；本次變更後改為 Service 入口與 `admin` 重設指令（C） |
| AUT-AC50 | `backend/tests/auth/test_password_change.py`（T11）：呼叫 Service 入口與變更密碼 API，查 `audit_logs` 斷言筆數、操作者、`is_temporary` 前後值，被拒絕時沒有紀錄 |
| AUT-AC51 | `backend/tests/auth/test_login_lockout.py`（T8）：觸發鎖定後再嘗試 2 次，斷言恰一筆 `user.locked` 與其欄位 |
| AUT-AC52 | `backend/tests/auth/test_auth_logging.py`（T12）：以 `caplog` 攔截 `app.auth`，斷言五筆日誌的 `event`、`user_id`、`reason`，並斷言所有紀錄不含送出的密碼、Cookie 值與 email 原文；`audit_logs` 為 0 筆 |
| AUT-AC54 | `backend/tests/cli/test_init_system.py`（C）：對空資料庫執行初始化指令，捕捉輸出，斷言恰一組碼、`SetupCode` 只存雜湊與 24 小時期限、稽核 0 筆、沒有公司與個人帳號 |
| AUT-AC55 | `backend/tests/cli/test_init_system.py`（C）：重跑後斷言舊碼作廢、新碼有效、其餘資料筆數不變；`admin` 已設定密碼後重跑斷言拒絕且資料不變 |
| AUT-AC56 | `backend/tests/auth/test_setup_api.py`（C）：`status` 前後、成功設定、Cookie 可呼叫 `me`、`SetupCode` 作廢、恰一筆系統事件的 `user.password_set`、第二次 409 |
| AUT-AC57 | `backend/tests/auth/test_setup_api.py`（C）：以可控時間製造過期碼，另備作廢碼與隨機錯碼，斷言回應本體逐位元組相同、密碼與碼狀態不變；隨機錯碼的失敗計數／鎖定欄位依 AUT-R45 更新 |
| AUT-AC58 | `backend/tests/auth/test_setup_api.py`（C）：7 字元密碼回 422 且碼仍有效、失敗計數不變；再設定成功後以帳號名稱 `admin` 登入 |
| AUT-AC59 | `backend/tests/auth/test_setup_lockout.py`（C）：可控時間下 10 次失敗、鎖定期間正確碼也被拒、15 分鐘後成功；`caplog` 斷言有日誌、稽核 0 筆、日誌不含碼；另斷言與密碼登入的失敗計數互不影響 |
| AUT-AC60 | `backend/tests/auth/test_setup_lockout.py`（C）：鎖定中重跑初始化，新碼可用 |
| AUT-AC61 | `backend/tests/auth/test_temp_password_create.py`（E）：Service 入口（API 上線後改用 API）新增兩位使用者，斷言臨時密碼只出現一次、標記、勾選與 `user.admin_changed` |
| AUT-AC62 | `backend/tests/cli/test_reset_admin_password.py`（C）：標準輸入重設，斷言登入狀態刪除、鎖定清除、恰一筆系統事件稽核、新密碼可登入且不標臨時 |
| AUT-AC63 | `backend/tests/cli/test_reset_admin_password.py`（C）：`admin` 無密碼時執行，斷言拒絕、提示、資料不變 |
| AUT-AC64 | `backend/tests/cli/test_reset_admin_password.py`（C）：檢查 `Makefile` 的 target 與 `app/cli/` 的指令清單，斷言沒有一般的設定密碼指令 |
| AUT-AC65 | `frontend/src/auth/SetupPage.test.tsx`、`LoginPage.test.tsx`（F）：替身回 `setup_required` 的兩種值，斷言導向與不可進入；兩種登入輸入；錯碼只顯示一種訊息；以替身走完「設定密碼 → 新增第一個使用者」（呼叫 E 的新增使用者 API），斷言臨時密碼只顯示一次、勾選框預設不勾；`npm run test` |
| AUT-AC66 | `backend/tests/auth/test_auth_logging.py`（C）：全流程後全文搜尋日誌與稽核，斷言不含碼、密碼、雜湊、token、Cookie 值與帳號欄原文 |

## 考慮過但沒採用的做法

- **初始化指令直接詢問密碼**：部署人員少執行一步，但密碼會出現在初始化的輸入裡，也要求部署當下就決定 `admin` 的密碼。改為初始化只印一組一次性首次登入碼，`admin` 的密碼由負責人在網頁上自己設定（[#259](https://github.com/speko-tw/inspect-flow/issues/259) 裁定，取代原本「獨立的設定密碼指令」的做法）；之後忘記密碼時，`admin` 用重設指令，一般使用者由 Admin 重設。
- **把 `password_hash` 放在 `User` 上**：少一張表，但外部帳號會有一個永遠是空值的欄位，`User` 的查詢與修改入口也容易意外帶出雜湊；理由見規格的[資料](spec.md#資料)段。
- **資料庫存 token 本身**：實作最簡單，但資料庫備份外洩時，裡面的 token 可以直接拿來登入；存 SHA-256 的成本只是多一次雜湊。token 本身有 256 位元的隨機性，不需要加 salt 或用慢雜湊。
- **用框架或套件的簽章 Cookie（例如 Starlette `SessionMiddleware`）**：把資料放在 Cookie 裡，不是伺服器端保存，停用人員時無法讓既有登入立即失效，牴觸 [KD-30](../../intents/03-decisions-and-stack.md#kd-30)。
- **非成員存取專案時回 404，隱藏專案是否存在**：可以避免從錯誤碼推測專案存在，但與 `api-conventions` 的 `resource.not_found` 語意混在一起，前端也難以區分「沒權限」與「不存在」。專案 ID 是 UUID，無法列舉，先採 403；若日後有需要，屬範圍變更。
- **把臨時密碼併進 T6 或 T3，或整包放在一個任務**：T6 只是一支指令，併入欄位、migration、dependency 與新 API 後就不是一個 PR 能單獨驗收的大小；併進 T3 則會讓 T3 多等 T5、T6。整包放在一個任務時，T4 要等 T5、T6 才能驗收各層級都被擋。因此拆成 T9（標記與阻擋，只依賴 T2、T3，讓 T4 儘早接上）與 T11（變更密碼 API 與設定入口，依賴 T5、T6），代價是 T9、T11 要改寫 T3、T6 已合併的檔案，見[風險](#風險)。前端獨立成 T10，因為它只依賴 HTTP 契約，可以先做。
- **另做 CSRF token**：`SameSite=Strict` 讓跨站請求不帶 Cookie，加上非上傳 API 只接受 JSON（API-R03），跨站表單無法送出有效請求；多一套 token 會增加前端與測試的負擔。若 `SameSite` 改為 `Lax`，要重新評估。
