# InspectFlow 示範環境

本目錄提供可重建的示範資料、啟停腳本與人工點擊走查。所有公司、工程、
單位與人名都是虛構內容。示範資料一律經由正式後端 API 建立；前端和
示範使用者不會直接讀寫資料庫。

## 啟動與重建

先在目前 worktree 安裝依賴：

```bash
make setup
```

從 repo 根目錄啟動：

```bash
demo/scripts/start.sh
```

啟動腳本會在臨時工作目錄建立新的 SQLite 資料庫、執行 migration 與
初始化、啟動後端和 Vite，再載入 `demo/data/seed.json`。每次重新啟動都會
重建這個示範資料庫，確保帳號、任務與 Dashboard 數字一致。預設資料目錄是
`/private/tmp/inspectflow-demo`，不會使用 `backend/data/inspectflow.db`。

工作目錄和連接埠可以分別設定；埠被其他程序使用時，腳本會停止並保留該
程序：

```bash
DEMO_WORK_DIR=/private/tmp/inspectflow-demo-2 \
BACKEND_PORT=8301 FRONTEND_PORT=5301 demo/scripts/start.sh
```

`DEMO_WORK_DIR` 同時決定 `demo.db`、log、結果檔與 PID 檔的位置。腳本先
確認 PID 的命令列符合預期才停止程序。停止服務時，使用啟動時相同的設定：

```bash
DEMO_WORK_DIR=/private/tmp/inspectflow-demo-2 \
BACKEND_PORT=8301 FRONTEND_PORT=5301 demo/scripts/stop.sh
```

## HTTPS 手機走查

需安裝 `mkcert` 並在這台電腦信任它的本機根憑證：

```bash
brew install mkcert
mkcert -install
demo/scripts/start.sh --https
```

命令會在示範工作目錄建立只含本機／區網 IP 的憑證，前端只綁定區網 IP，
並只接受同一個 `/24` 網段。手機與電腦需連到同一個 Wi-Fi，使用啟動輸出的
HTTPS 網址。iPhone 首次使用時，依 iOS「設定 → 一般 → 關於本機 → 憑證信任
設定」信任 mkcert 根憑證；根憑證路徑可用 `mkcert -CAROOT` 查詢。請勿將
私鑰或根憑證複製到 repo。

不用手機時，以 `http://localhost:5300/field` 開啟後切換瀏覽器為 360px 寬。

## 示範帳號

所有帳號的密碼只用於本機示範環境。請勿拿來連正式服務。

| 帳號 | 密碼 | 身分、登入後可見內容與兩層權限 |
|---|---|---|
| `admin` | `DemoAdmin2026` | 系統管理者；預期落點「總覽」，可見總覽、任務、專案、範本與管理項目 |
| `demo-manager` | `DemoManager2026` | 主管；有全部專案進度檢視權限，預期落點「總覽」；未加入專案，不具專案內操作權 |
| `demo-office` | `DemoOffice2026` | 內業工程師；有開設專案、查核及套用範本模組權限，專案角色為「專案工程師」；預期可見任務、專案，可在專案查核項目頁套用範本 |
| `demo-field-a` | `DemoFieldA2026` | 現場工程師；有專案及查核模組權限，專案角色為「現場工程師」；預期落點及導覽為「任務」 |
| `demo-field-b` | `DemoFieldB2026` | 現場工程師；有專案及查核模組權限，專案角色為「現場工程師」；預期落點及導覽為「任務」 |
| `demo-template-manager` | `DemoTemplate2026` | 範本管理者；有範本管理權限，預期落點及導覽為「範本」 |
| `demo-template-delegate` | `DemoDelegate2026` | 範本模組委派者；可為他人授予或收回範本模組權限，沒有範本編輯權；預期落點「帳號」 |
| `demo-consultant` | `DemoConsultant2026` | 外部協作；可唯讀已加入的專案，並有範本瀏覽權限；不能套用範本，因專案查閱角色沒有查核項目編輯權 |
| `demo-no-access` | `DemoNoAccess2026` | 尚未開通任何功能；預期落點「設定」，顯示「尚未開通任何功能，請洽系統管理者」 |

以上導覽名稱與落點描述依 #705 的權限導覽規劃；目前頁面仍待 #705 更新。實際可用內容仍受帳號的模組權限與專案角色共同限制。

內業工程師有 `template.use`，且「專案工程師」角色可編輯查核項目，因此能在專案查核項目頁套用範本。外部協作雖有 `template.use`，但「專案查閱人員」只有唯讀權限，不能套用範本。獨立「範本」導覽只提供給範本管理者（`template.manage`）與系統管理者；此導覽行為待 #705 合併後生效。

專案角色與全公司模組權限分屬兩層。單有模組權限不會自動取得專案內動作；
外部顧問僅能唯讀其加入的專案。權限管理畫面尚未完成，相關畫面走查請標記
「待 #582 合併後補」。

## 預建資料

公司為「示範公司」，範本庫含「建築工程／給排水」下的排水坡度、
給水試壓與止水閥標示範本，以及「建築工程／電氣設備」的配電盤與接地
電阻範本。兩個專案皆由內業帳號開設，因此建立者自動成為
「專案工程師」成員。

| 專案 | 成員 | 任務資料 |
|---|---|---|
| `DEMO-A` 示範大樓機電工程 | 內業、兩位現場工程師 | 一筆待開始任務 |
| `DEMO-B` 示範廠擴建機電工程 | 內業、兩位現場工程師、外部顧問 | 草稿、待開始、進行中、已完成、已取消任務各至少一筆 |

`COMPLETED` 任務是由 seed 以現場帳號呼叫既有 API 建立的教學紀錄；0.5.x
現場頁目前只支援開始任務。Dashboard 因此同時有進行中、完成、待開始與取消
資料，方便示範計數與工作量的差異。`walkthrough` 草稿保留給下方真實點擊
流程。

## 真實點擊走查

安裝 Google Chrome 後，可用 Playwright 自動執行真實瀏覽器流程並保存截圖：

```bash
DEMO_WORK_DIR=/private/tmp/inspectflow-demo-e2e \
BACKEND_PORT=18310 FRONTEND_PORT=18311 demo/scripts/run-e2e.sh
```

腳本會重建隔離資料庫、使用 Chrome 點擊以下流程，並在
`demo/screenshots/` 寫入五張畫面；結束時只停止自己啟動的服務。也可依下方
步驟人工操作。自動化或人工流程的成功結果都應與截圖一併保存。

1. 以 `demo-office` 登入，開啟 `DEMO-B` 的「計畫與任務」。確認「示範廠
   A 棟機房（請開始查核）」是草稿，按該任務的「派出」。畫面應更新為待開始。
2. 以 `demo-field-a` 登入 `/field`，在「派給我的任務」找到同一地點，開啟
   詳情並查看查核需求快照，再按「開始查核」。畫面應顯示進行中。
3. 以 `admin` 或 `demo-office` 重新登入。開啟該專案「進度」區段，確認任務
   數字與狀態已更新；進入 Dashboard 工作量檢視，確認可分別看到建議指派者
   與開始者。seed 的完成紀錄另提供已完成數字供比較。
4. 權限模組與權限委派的畫面段落標示「待 #582 合併後補」。目前示範資料已
   透過 API 設好兩層權限；此註記不代表已實際走查尚未完成的管理頁。
5. 將桌面與 360px 畫面截圖存入 `demo/screenshots/`，記下登入角色、操作步驟、
   畫面狀態和時間。只保存不含密碼或 session 的畫面。

走查步驟是操作指引；只有實際操作且留下畫面與結果記錄，才算已完成驗收。
