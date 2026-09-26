# 認證與授權（authentication）：實作計畫

**規格**：[spec.md](spec.md)

計畫記錄「為什麼這樣拆」。實作中發現更好的拆法就直接更新本檔（屬於「計畫調整」）；進度看 issue，不在這裡打勾。

本計畫涵蓋 AUT-AC01～AUT-AC43。跨規格的依賴：`database-foundation` T4（[#59](https://github.com/speko-tw/inspect-flow/issues/59)，`User`、`Project` 資料表），以及 `domain-model` 計畫的 T2（`User` 業務欄位）、T4（目前操作者與 Service 層）、T5（有效權限計算）、T6（初始化指令）；後者開 task issue 前還沒有編號，下表以「DOM T<n>」表示，開 issue 時換成 issue 編號。

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1 | 加入 Argon2id 套件（例如 `argon2-cffi`），實作密碼雜湊、驗證與「是否需要重新雜湊」三個函式；參數採 AUT-R01 建議的 m = 19456 KiB、t = 2、p = 1（改選 OWASP 清單中另一組時，在本 PR 更新本檔），集中在一處常數。本任務不含長度規則（AUT-Q3 已裁定，併入 T6） | `backend/pyproject.toml`、`backend/uv.lock`、`backend/app/auth/__init__.py`、`backend/app/auth/passwords.py`（新增）、`backend/tests/auth/__init__.py`、`backend/tests/auth/test_passwords.py`（新增） | — | AUT-AC01 | #149 |
| T2 | `UserPassword`、`AuthSession` 資料表：兩個 model 繼承 `database-foundation` 的共用基底；`UserPassword.user_id` 唯一、`AuthSession.token_hash` 唯一，`user_id` 為不可空值、指向 `User` 的外鍵；新增一支 migration | `backend/app/models/user_password.py`、`backend/app/models/auth_session.py`（新增）、`backend/app/models/__init__.py`（加 import）、`backend/alembic/versions/`（新增一支）、`backend/tests/db/test_auth_tables.py`（新增） | #59 | AUT-AC31 | #150 |
| T3 | 登入狀態與登入、登出、目前使用者 API：產生 token 與存 SHA-256、建立與刪除 `AuthSession`、每個請求的檢查（存在、兩種期限、`is_active`）並更新 `last_seen_at`、有效筆數查詢；密碼登入（一致的失敗回應、帳號不存在時仍驗證一次雜湊、驗證後重新雜湊）；「建立登入狀態」與「驗證密碼」分成兩個函式；需登入的 FastAPI dependency，並把登入者放進請求範圍的 context，供 T5 讀取；逾時設定讀環境變數（未設定時閒置 60 分鐘、絕對 8 小時）並寫進 `.env.example`；`auth.*` 錯誤碼加入 `ErrorCode`；`/api/v1/auth` router 註冊到 `main.py` | `backend/app/auth/sessions.py`、`backend/app/auth/login.py`、`backend/app/auth/settings.py`、`backend/app/auth/dependencies.py`（新增）、`backend/app/api/v1/auth.py`（新增）、`backend/app/api/errors.py`（加列舉成員）、`backend/app/main.py`（加一行註冊）、`.env.example`、`backend/tests/auth/test_sessions.py`、`backend/tests/auth/test_login_api.py`（新增） | T1、T2、#130（[AUT-Q1](spec.md#aut-q1) 已裁定，#143；[DOM-Q2](../domain-model/spec.md#dom-q2) 已裁定，#122：email 不分大小寫） | AUT-AC02、AUT-AC03、AUT-AC05～AUT-AC07、AUT-AC10～AUT-AC15、AUT-AC26（AUT-AC08 因 `must_change_password` 移到 T9；本任務的 `me` 先回傳其餘五個鍵） | #151 |
| T4 | 權限檢查共用元件：路由存取層級的宣告方式（公開、需登入、需 Admin、需專案權限、本人或 Admin）、公開路由清單、列出所有路由宣告並檢查的測試；需專案權限的判斷依 AUT-R19 呼叫 DOM T5 的有效權限計算，每次請求重算；`permission.denied` 加入 `ErrorCode`；替既有的健康檢查與 T3 的三條路由補上宣告；各存取層級都疊在 T3 的需登入 dependency 上，臨時密碼的阻擋（T9）因此對所有層級生效 | `backend/app/auth/access.py`（新增）、`backend/app/api/errors.py`（加列舉成員）、`backend/app/api/v1/health.py`、`backend/app/api/v1/auth.py`（只加宣告）、`backend/tests/auth/test_access.py`、`backend/tests/contract/test_route_access.py`（新增） | T3、T9（臨時密碼的阻擋）、#133；[AUT-Q2](spec.md#aut-q2)（Admin 與新增、刪除、特殊動作）、[DOM-Q3](../domain-model/spec.md#dom-q3)（從代碼辨識動作類別）裁定 | AUT-AC16～AUT-AC22、AUT-AC43 | #152 |
| T5 | 目前操作者入口改寫：HTTP 請求中回傳 T3 放進 context 的登入者，沒有登入者時拒絕；不在請求中時維持回傳內建 `admin` | `backend/app/services/operator.py`（修改，檔案由 DOM T4 建立）、`backend/tests/services/test_operator_auth.py`（新增） | T3、#132 | AUT-AC09 | #153 |
| T6 | 設定密碼的指令：以 email 指定帳號（含內建 `admin`，AUT-Q4 裁定），`getpass` 輸入兩次，也接受標準輸入；長度規則檢查；拒絕不存在與 `external` 帳號；寫入或更新 `UserPassword`（操作者為內建 `admin`）並刪除該帳號所有 `AuthSession`；指令列不提供密碼參數；在 `Makefile` 加一個執行入口 | `backend/app/cli/set_password.py`（新增；`backend/app/cli/` 套件由 DOM T6 建立）、`backend/app/auth/passwords.py`（加長度規則）、`Makefile`（加一個 target）、`backend/tests/cli/test_set_password.py`（新增） | T1、T2、T3（刪除登入狀態）、#134（[AUT-Q3](spec.md#aut-q3)、[AUT-Q4](spec.md#aut-q4) 已裁定，#145、#146） | AUT-AC04、AUT-AC23～AUT-AC25、AUT-AC32 | #154 |
| T7 | 前端登入：`/login` 頁、呼叫目前使用者 API 的共用 hook、未登入導向 `/login` 並保留原路徑的守衛、登出按鈕；Admin Web 與 Field Web 都掛上守衛。守衛與登入頁放在 `src/auth/`，不得 import `src/admin/`，拆包檢查（SKL-AC03）照常通過。**新 worktree 先執行 `make setup`** | `frontend/src/auth/`（新增 `LoginPage.tsx`、`RequireAuth.tsx`、`api.ts` 與測試）、`frontend/src/App.tsx`（加路由與守衛）、`frontend/src/admin/AdminPage.tsx`、`frontend/src/field/FieldPage.tsx`（加登出操作）、`frontend/vite.config.ts`（加開發用的 `/api` proxy） | —（依 spec 的 HTTP 契約以測試替身開發；與後端的實際串接在 T3 合併後手動確認一次） | AUT-AC28～AUT-AC30 | #155 |
| T8 | 登入失敗鎖定：依帳號記錄失敗次數與時間，達門檻後在鎖定期間回傳一般失敗；需要保存失敗紀錄時，新增欄位或資料表與一支 migration | `backend/app/auth/login.py`（修改）、`backend/app/models/`（視設計新增）、`backend/alembic/versions/`（視設計新增一支）、`backend/tests/auth/test_login_lockout.py`（新增） | T3；[AUT-Q5](spec.md#aut-q5) 裁定；選 C（不做）時本任務以 *not planned* 關閉，AUT-R28 改標撤回 | AUT-AC27 | #156 |
| T9 | 臨時密碼標記與阻擋：`UserPassword` 加 `must_change_password` 欄位與一支 migration；需登入的 dependency 在 AUT-R14 的檢查之後加上臨時密碼檢查，只放行集中在一處的允許清單（本任務先列 `me`、登出，T11 加入變更密碼）；`me` 與登入回應加 `must_change_password`；`auth.password_change_required` 加入 `ErrorCode` | `backend/app/models/user_password.py`（加欄位）、`backend/alembic/versions/`（新增一支）、`backend/app/auth/dependencies.py`（加檢查與允許清單）、`backend/app/api/v1/auth.py`（回應加欄位）、`backend/app/api/errors.py`（加列舉成員）、`backend/tests/auth/test_password_gate.py`、`backend/tests/db/test_user_password_flag.py`（新增） | T2（#150）、T3 | AUT-AC08、AUT-AC33、AUT-AC35 | 待開 |
| T10 | 前端變更密碼：`/change-password` 頁（目前密碼、新密碼、再輸入一次）、依錯誤碼顯示訊息；守衛在 `must_change_password = true` 時導向此頁並保留原路徑；Admin Web 與 Field Web 的登出旁加變更密碼入口。守衛與頁面放在 `src/auth/`，不得 import `src/admin/`。**新 worktree 先執行 `make setup`** | `frontend/src/auth/`（新增 `ChangePasswordPage.tsx` 與測試；修改 `RequireAuth.tsx`、`api.ts`）、`frontend/src/App.tsx`（加路由）、`frontend/src/admin/AdminPage.tsx`、`frontend/src/field/FieldPage.tsx`（加入口） | T7（#155）；依 spec 的 HTTP 契約以測試替身開發，與後端的實際串接在 T9、T11 合併後手動確認一次 | AUT-AC41、AUT-AC42 | 待開 |
| T11 | 變更密碼與設定密碼入口（後端）：設定密碼的 Service 入口（目標、新密碼、是否標為臨時；長度檢查、雜湊、寫入、刪除登入狀態），T6 的指令改呼叫它，並依 `is_system` 決定是否標為臨時；`POST /api/v1/auth/password`（驗證目前密碼、長度規則、臨時密碼不得不變、外部帳號拒絕、刪除所有登入狀態並換發目前這一筆），加入 T9 的允許清單；變更密碼的三個錯誤碼加入 `ErrorCode`。T4 已合併時，替新路由補上存取層級宣告；否則由 T4 補 | `backend/app/auth/password_service.py`（新增）、`backend/app/auth/dependencies.py`（允許清單加一條）、`backend/app/api/v1/auth.py`（加路由）、`backend/app/api/errors.py`（加列舉成員）、`backend/app/cli/set_password.py`（改呼叫 Service 入口）、`backend/tests/auth/test_password_change.py`（新增）、`backend/tests/cli/test_set_password.py`（加案例） | T5（操作者為本人）、T6、T9 | AUT-AC34、AUT-AC36～AUT-AC40 | 待開 |

- 每個任務一個 PR 就能完成，並能單獨驗收。
- 每個任務至少對應一條 AC；AUT-AC01～AUT-AC43 每條都被一個任務涵蓋。
- 依 plan 開 task issue 時才建立上表的 issue 編號；本 PR 只寫文件，不開 task issue。開 issue 時，若依賴的裁定或其他規格的任務尚未完成，issue 標 `blocked` 並寫明原因。
- AUT-R31（前端隱藏功能不取代後端檢查）沒有獨立的任務，由 T4 的後端測試保證。

## 並行分組

依「改動的檔案」與「依賴」分波；同一波內的任務檔案不重疊，也互不依賴。

- 第 1 波：T1、T2、T7。T1 改依賴檔與 `app/auth/passwords.py`，T2 改 `app/models/` 與 migration（等 #59），T7 只改 `frontend/`。
- 第 2 波：T3（依賴 T1、T2、DOM T2）。
- 第 3 波：T5（依賴 T3、DOM T4）、T6（依賴 T1～T3、DOM T6）、T9（依賴 T2、T3）。T5 只改 `app/services/operator.py`；T6 改 `app/cli/`、`passwords.py`、`Makefile`；T9 改 `user_password.py`、migration、`dependencies.py`、`auth.py`、`errors.py`。三者檔案不重疊。
- 第 4 波：T4（依賴 T3、T9、DOM T5 與 AUT-Q2 等裁定）、T8（依賴 T3 與 AUT-Q5；改 T3 的 `login.py`）。T4 改 `access.py`、`errors.py`、兩個 router；T8 改 `login.py` 與視設計新增的 model、migration。兩者檔案不重疊。
- 第 5 波：T11（依賴 T5、T6、T9）。T11 與 T4 都改 `errors.py`、`api/v1/auth.py`，所以排在 T4 之後；T4 仍被裁定擋住時，T11 得先做，後合併的一方 rebase。
- T10 只改 `frontend/`，依賴已合併的 T7，得隨時開工，不必等後端。

碰到[共用檔案](../README.md#parallel)的地方：

- lockfile：只有 T1 新增套件（`argon2-cffi`），T1 先合併，其他後端分支再 rebase 並重新產生 `uv.lock`。其他任務若發現需要新套件，改為先開獨立任務加依賴。
- Alembic migration 鏈：T2 新增一支，T8 視設計新增一支，T9 新增一支（加欄位）；每個 PR 最多一支，T2、T8、T9 之間後合併的一方 rebase 並改接 `down_revision`。T2 與 `domain-model` 的 T1～T3 都會新增 migration，後合併的一方先 rebase，並把 `down_revision` 改接到最新 head。
- `backend/app/models/__init__.py`：T2 加兩行 import；`domain-model` 的 T1、T3 也改這個檔案，同時進行時後合併的一方 rebase。
- `backend/app/api/errors.py` 的 `ErrorCode`：T3 加 `auth.*`，T4 加 `permission.denied`，T9 加 `auth.password_change_required`，T11 加變更密碼的三個 `auth.*`；各任務不同波，T11 若先於 T4 合併，後合併的一方 rebase。
- `backend/app/main.py`：只有 T3 加一行 router 註冊。
- `Makefile`：只有 T6 加一個 target（T11 只改指令內部，不動 target）；`domain-model` T6 也加一個 target，後合併的一方 rebase。
- `.env.example`：只有 T3 加逾時的兩個變數。

## 風險

- **`Secure` 與 `__Host-` Cookie 在本機開發與測試中不會被送出**：瀏覽器與 httpx 只在 HTTPS（或瀏覽器視為安全的 `localhost`）送出 `Secure` Cookie。測試用戶端一律以 `https://testserver` 為 base URL；本機開發以 `localhost` 開啟。Safari 對 `http://localhost` 的 `Secure` Cookie 支援程度不確定，T7 在 PR 說明記下實際在哪些瀏覽器確認過。**不得**為了開發方便加上關閉 `Secure` 的設定。
- **Vite 開發伺服器與後端不同 port**：`SameSite=Strict` 看的是 site（不含 port），`localhost:5173` 與 `localhost:8000` 同 site，Cookie 會帶；但跨 origin 的 `fetch` 需要 CORS 與 `credentials`。目前 `vite.config.ts` 沒有 proxy，T7 **應**加上 Vite 的 dev proxy，讓前端以同 origin 呼叫 `/api`，避免為了開發開 CORS。
- **預設拒絕被新路由繞過**：新路由忘了宣告存取層級時，T4 的測試會失敗；但若有人宣告成「公開」就能繞過。公開路由集中在一份清單，測試斷言清單內容恰為健康檢查、登入、登出，新增公開路由必須同時改清單與測試，審查時看得到。
- **帳號不存在時的時間差**：AUT-R06 要求帳號不存在時仍驗證一次雜湊。T3 以一個啟動時產生的假雜湊來驗證，不要每次重新產生（產生雜湊本身也要時間，會讓兩條路徑的時間不同）。AC 只驗「驗證函式有被呼叫」，不量測時間，避免測試不穩定。
- **有效權限每次請求重算的效能**：AUT-R19 不允許跨請求快取。一次請求多次檢查時，T4 **得**在同一個請求內重用第一次的結果；跨請求的快取等效能出現問題再評估，且必須先處理「修改角色立即生效」。
- **目前操作者入口在請求中不再退回 `admin`**：T5 合併後，任何在請求中寫入、卻沒有經過需登入 dependency 的程式會直接失敗。這是預期行為（AUT-R09），但 T5 要先在 repo 內搜尋所有呼叫端，確認都在已宣告需登入以上的路由之下。
- **T4 的存取層級必須疊在 T3 的需登入 dependency 上**：AUT-R33 的臨時密碼檢查放在需登入的 dependency（T9）；需 Admin、需專案權限、本人或 Admin 若另寫一套登入檢查，會繞過臨時密碼的限制。因此 T4 排在 T9 之後，並以 AUT-AC43 驗收四種存取層級都被擋。
- **T11 改寫 T6 的指令**：T6 先照 AUT-R24 直接寫 `UserPassword`，T11 再把寫入改成呼叫 Service 入口並加上標記。T6 實作時把寫入集中在一個函式，T11 才容易替換；AUT-AC04、AUT-AC23～AUT-AC25、AUT-AC32 在 T11 之後仍須通過。
- **裁定未完成就開工**：T3 的裁定都已完成（AUT-Q1、DOM-Q2）；T4 依 AUT-Q2、DOM-Q3；T6 的裁定都已完成（AUT-Q3、AUT-Q4）；T8 依 AUT-Q5。不要先用建議值實作再等裁定；建議值寫在規格裡，是給負責人選的，不是預設。

## 驗證（Proof）

後端皆以 `make check` 執行；PostgreSQL 由 `database-foundation` T3 的 CI 補驗。

| AC | 驗證方式 |
|---|---|
| AUT-AC01 | `backend/tests/auth/test_passwords.py`：雜湊兩次，斷言前綴、參數段等於設定的參數組且屬於 AUT-R01 的清單、兩者不同、驗證正確與錯誤密碼 |
| AUT-AC02 | `backend/tests/auth/test_login_api.py`：以 AUT-R01 清單中與程式設定不同的一組完整參數預先寫入雜湊，登入後讀回 `UserPassword`，斷言參數段已更新且仍可驗證 |
| AUT-AC03 | `backend/tests/auth/test_login_api.py`：以 pytest 的 `caplog` 擷取日誌，呼叫登入與 `me`，斷言回應本體與日誌不含密碼、雜湊與 token |
| AUT-AC04 | `backend/tests/cli/test_set_password.py`（T6）：以標準輸入依 AUT-AC04 的五種密碼（7、8、128 含中文字、129、只含小寫字母）各執行一次指令，斷言成功或失敗與 `UserPassword` 的內容 |
| AUT-AC05 | `backend/tests/auth/test_login_api.py`：解析 `Set-Cookie` 的屬性，查資料庫比對 `token_hash` 與 Cookie 值的 SHA-256 |
| AUT-AC06 | `backend/tests/auth/test_login_api.py`：參數化五種情境，斷言狀態碼、回應本體逐位元組相同、無 `Set-Cookie`、`AuthSession` 筆數不變；以 monkeypatch 計數驗證函式的呼叫次數 |
| AUT-AC07 | `backend/tests/auth/test_login_api.py`：登出後斷言 204、清除 Cookie 的 `Set-Cookie`、資料庫無該筆，再呼叫 `me` 斷言 401；無 Cookie 登出斷言 204 |
| AUT-AC08 | `backend/tests/auth/test_password_gate.py`（T9）：斷言 `me` 回應的鍵集合（含 `must_change_password`）與未登入的 401 |
| AUT-AC09 | `backend/tests/services/test_operator_auth.py`（T5）：測試專用路由經 Service 層寫入 `Company`，分別以登入、未登入、非請求情境斷言 `created_by` |
| AUT-AC10 | `backend/tests/auth/test_sessions.py`：兩個用戶端登入，斷言 token 不同、長度、不沿用請求帶來的 token、兩者皆可呼叫 `me` |
| AUT-AC11 | `backend/tests/auth/test_sessions.py`：直接以 ORM 停用帳號，斷言兩個 Cookie 都 401 且 `AuthSession` 已刪除 |
| AUT-AC12 | `backend/tests/auth/test_sessions.py`：以 ORM 建立 `external` 帳號，直接呼叫建立登入狀態的函式後呼叫 `me` 斷言 200，再以密碼登入斷言 401 |
| AUT-AC13 | `backend/tests/auth/test_sessions.py`：以 `database-foundation` 的可控時間推進時鐘，斷言預設的絕對期限在滿 8 小時前 1 秒仍有效、剛好 8 小時失效，閒置期限在剛好 60 分鐘仍有效、超過 1 秒失效，以及`last_seen_at` 的更新與過期資料的刪除 |
| AUT-AC14 | `backend/tests/auth/test_sessions.py`：直接建立三筆 `AuthSession`（其中一筆過期），呼叫筆數查詢 |
| AUT-AC15 | `backend/tests/auth/test_sessions.py`：以 monkeypatch 設定與清除環境變數，斷言讀到的設定值；讀取 repo 根目錄的 `.env.example`，斷言含兩個變數名稱 |
| AUT-AC16 | `backend/tests/contract/test_route_access.py`（T4）：走訪 `create_app()` 的業務路由（沿用 API-AC01 的走訪方式），斷言都有宣告、公開清單內容；另建一個加了未宣告路由的 app，斷言檢查失敗並回報路由路徑 |
| AUT-AC17 | `backend/tests/auth/test_access.py`（T4）：四條測試路由不帶 Cookie 呼叫，斷言 401 與處理函式的呼叫計數為 0 |
| AUT-AC18 | `backend/tests/auth/test_access.py`（T4）：以 ORM 建立專案、角色與成員，斷言各組合的狀態碼 |
| AUT-AC19 | `backend/tests/auth/test_access.py`（T4）：同一個已登入用戶端，修改 R1 與 `is_admin` 後再呼叫，斷言狀態碼改變 |
| AUT-AC20 | `backend/tests/auth/test_access.py`（T4）：Admin 與非 Admin 呼叫需 Admin 的測試路由 |
| AUT-AC21 | `backend/tests/auth/test_access.py`（T4）：三種組合呼叫「本人或 Admin」的測試路由 |
| AUT-AC22 | `backend/tests/contract/test_route_access.py`（T4）：呼叫 `build_error_code_descriptions(ErrorCode)`，斷言含三個代碼並符合 API-AC09 的 regex |
| AUT-AC23 | `backend/tests/cli/test_set_password.py`（T6）：初始化後先以 T3 的函式替負責人建立一筆登入狀態，再以標準輸入執行指令；斷言 `UserPassword` 內容與操作者、舊 Cookie 401、新密碼登入成功 |
| AUT-AC24 | `backend/tests/cli/test_set_password.py`（T6）：三種失敗輸入，斷言回報失敗且 `UserPassword` 不變 |
| AUT-AC25 | `backend/tests/cli/test_set_password.py`（T6）：以 subprocess 執行 `--help`、空標準輸入與多加 `--password`，設定兩個環境變數，斷言輸出、結束碼與 `UserPassword` 無寫入 |
| AUT-AC26 | `backend/tests/auth/test_sessions.py`：直接呼叫建立登入狀態的函式後以 Cookie 呼叫 `me`；以 `inspect.signature` 斷言參數不含密碼 |
| AUT-AC27 | `backend/tests/auth/test_login_lockout.py`（T8）：以可控時間依 AUT-Q5 裁定方案的觸發與解除條件推進，斷言鎖定期間的回應與一般失敗相同、解除後登入成功 |
| AUT-AC28 | `frontend/src/auth/RequireAuth.test.tsx`（T7）：以 `MemoryRouter` 渲染 `/admin`、`/field`，替身回 401，斷言導向 `/login` 並帶原路徑；替身改回 200 後送出表單，斷言回到原路徑；`npm run test` |
| AUT-AC29 | `frontend/src/auth/LoginPage.test.tsx`（T7）：替身回 401，斷言顯示通用訊息、密碼欄位的 `type`；`npm run test` |
| AUT-AC30 | `frontend/src/auth/LoginPage.test.tsx`（T7）：以 `vi.spyOn` 監看 `Storage.prototype.setItem` 與 `fetch`，斷言沒有寫入、沒有自訂 `Authorization` 或 `Cookie` 標頭、登出呼叫 API 並導向 `/login`；`npm run test` |
| AUT-AC31 | `backend/tests/db/test_auth_tables.py`（T2）：inspector 檢查兩張表的欄位、可空性、唯一與外鍵，並斷言 `User` 資料表沒有密碼或 token 欄位；依 AC 的錯誤寫入斷言 `IntegrityError` 且筆數不變 |
| AUT-AC32 | `backend/tests/cli/test_set_password.py`（T6）：初始化後以標準輸入對內建 `admin` 執行指令，斷言 `UserPassword` 有一筆，再以登入 API 斷言 200 與 `is_admin` |
| AUT-AC33 | `backend/tests/db/test_user_password_flag.py`（T9）：inspector 檢查欄位與可空性；以 ORM 新增不指定欄位的資料讀回 `false`，空值寫入斷言 `IntegrityError` 且筆數不變 |
| AUT-AC34 | `backend/tests/cli/test_set_password.py`（T11）：分別對一般帳號與內建 `admin` 執行指令，斷言標記，再登入並呼叫 `me` 斷言回應欄位 |
| AUT-AC35 | `backend/tests/auth/test_password_gate.py`（T9）：以 ORM 把標記設為 `true`，掛一條計數的需登入測試路由，斷言 403 與計數 0、`me` 與登出放行；以 ORM 建立帶標記的 `external` 帳號，直接建立登入狀態後斷言放行 |
| AUT-AC36 | `backend/tests/auth/test_password_change.py`（T11）：讀取允許清單常數，斷言內容恰為三條，且每條都在 `create_app()` 的路由中 |
| AUT-AC37 | `backend/tests/auth/test_password_change.py`（T11）：參數化四種失敗，斷言狀態碼與 `error.code`，並讀回 `UserPassword` 與登入狀態筆數斷言不變 |
| AUT-AC38 | `backend/tests/auth/test_password_change.py`（T11）：三個用戶端登入後由 A 變更，斷言 204、換發的 `Set-Cookie`（值不同於原 Cookie、至少 43 個 base64url 字元、屬性同 AUT-AC05）、標記、`updated_by`、A 原 Cookie 與 B、C 的 401、剩一筆登入狀態且 `token_hash` 對應新 Cookie，以及新舊密碼登入結果 |
| AUT-AC39 | `backend/tests/auth/test_password_change.py`（T11）：直接呼叫 Service 入口，依序斷言標記、雜湊可驗證、登入狀態刪除，以及 7 字元被拒絕 |
| AUT-AC40 | `backend/tests/auth/test_password_change.py`（T11）：呼叫 `build_error_code_descriptions(ErrorCode)`，斷言含四個代碼並符合 API-AC09 的 regex |
| AUT-AC41 | `frontend/src/auth/RequireAuth.test.tsx`（T10）：替身回 `must_change_password: true`，渲染 `/admin`、`/field` 斷言導向 `/change-password` 並帶原路徑；送出表單後斷言回到原路徑；`npm run test` |
| AUT-AC42 | `frontend/src/auth/ChangePasswordPage.test.tsx`（T10）：兩次新密碼不同時斷言 `fetch` 未被呼叫；依序讓替身回三種錯誤，斷言三則訊息不同、三個欄位的 `type`；`npm run test` |
| AUT-AC43 | `backend/tests/auth/test_access.py`（T4）：以 ORM 建立 Admin 兼專案成員的 T 並設標記，呼叫 AUT-AC17 的四條測試路由，斷言 403 `auth.password_change_required` 與計數 0；清除標記後斷言四條放行 |

## 考慮過但沒採用的做法

- **初始化指令直接詢問密碼**：部署人員少執行一次指令，但初始化指令歸 `domain-model`（DOM-R11～DOM-R13），要改它的契約；而且之後 Admin 建立的帳號還是需要一個單獨設定密碼的方式。改為獨立的設定密碼指令，兩者都適用。
- **把 `password_hash` 放在 `User` 上**：少一張表，但外部帳號會有一個永遠是空值的欄位，`User` 的查詢與修改入口也容易意外帶出雜湊；理由見規格的[資料](spec.md#資料)段。
- **資料庫存 token 本身**：實作最簡單，但資料庫備份外洩時，裡面的 token 可以直接拿來登入；存 SHA-256 的成本只是多一次雜湊。token 本身有 256 位元的隨機性，不需要加 salt 或用慢雜湊。
- **用框架或套件的簽章 Cookie（例如 Starlette `SessionMiddleware`）**：把資料放在 Cookie 裡，不是伺服器端保存，停用人員時無法讓既有登入立即失效，牴觸 [KD-30](../../intents/03-decisions-and-stack.md#kd-30)。
- **非成員存取專案時回 404，隱藏專案是否存在**：可以避免從錯誤碼推測專案存在，但與 `api-conventions` 的 `resource.not_found` 語意混在一起，前端也難以區分「沒權限」與「不存在」。專案 ID 是 UUID，無法列舉，先採 403；若日後有需要，屬範圍變更。
- **把臨時密碼併進 T6 或 T3，或整包放在一個任務**：T6 只是一支指令，併入欄位、migration、dependency 與新 API 後就不是一個 PR 能單獨驗收的大小；併進 T3 則會讓 T3 多等 T5、T6。整包放在一個任務時，T4 要等 T5、T6 才能驗收各層級都被擋。因此拆成 T9（標記與阻擋，只依賴 T2、T3，讓 T4 儘早接上）與 T11（變更密碼 API 與設定入口，依賴 T5、T6），代價是 T9、T11 要改寫 T3、T6 已合併的檔案，見[風險](#風險)。前端獨立成 T10，因為它只依賴 HTTP 契約，可以先做。
- **另做 CSRF token**：`SameSite=Strict` 讓跨站請求不帶 Cookie，加上非上傳 API 只接受 JSON（API-R03），跨站表單無法送出有效請求；多一套 token 會增加前端與測試的負擔。若 `SameSite` 改為 `Lax`，要重新評估。
