# 現場介面（field-ui）

**代碼**：`FUI`　**Phase**：P5　**狀態**：草稿
**前置規格**：`inspection-planning`、`state-machines`、`authentication`、`domain-model`、`api-conventions`
**引用意圖**：[PR-01](../../intents/02-principles.md#pr-01)、[PR-10](../../intents/02-principles.md#pr-10)、[KD-21](../../intents/03-decisions-and-stack.md#kd-21)、[KD-12](../../intents/03-decisions-and-stack.md#kd-12)、[KD-59](../../intents/03-decisions-and-stack.md#kd-59)、[KD-58](../../intents/03-decisions-and-stack.md#kd-58)、[OQ-21](../../intents/05-open-questions.md#oq-21)
**被擋議題**：無。`OQ-21` 已裁定；Plan／Task 行為依已凍結的 `state-machines` 與 `inspection-planning`。

## 目的

讓現場查核人員以手機或平板登入後，查看已派給自己的任務、閱讀任務建立時的查核需求，並開始查核；同專案具現場查核權限的成員可協助執行，不受建議指派人限制（依據：架構基準 §5.3、§6.1、§13A.13、§31；[PR-10](../../intents/02-principles.md#pr-10)、[KD-59](../../intents/03-decisions-and-stack.md#kd-59)、[STM-R11](../state-machines/spec.md#需求)）。

## 範圍

**包含**：

- 單一 React application 的 `/field/*` 路由與依路由拆分程式碼；Field 不載入 Admin 程式（[KD-12](../../intents/03-decisions-and-stack.md#kd-12)、[OQ-21](../../intents/05-open-questions.md#oq-21)）。
- 登入整合、今日任務入口、任務清單、任務詳情及開始查核操作。
- 任務詳情顯示 `Task Requirement Snapshot`、位置與目前狀態；將查核需求整理為唯讀檢查清單。
- 新增跨專案現場任務列表 API，遵守登入、專案權限、cursor 分頁及共用 API 錯誤契約。
- 手機／平板操作、Online-first 的 PWA-ready 基礎與區網 HTTPS 開發驗收說明。

**不包含**（注明移到哪份規格，或屬於哪一條非目標）：

- 拍照、Evidence 建立與上傳、影像編輯及上傳佇列：移至 `field-evidence`（0.6.x）。
- 查核結果、實測值填寫及任務完成操作：移至 `completion-validation`（0.7.x）；本階段只允許開始查核。
- Plan、Task、Snapshot 的資料欄位與狀態轉換：由 `domain-model`、`inspection-planning`、`state-machines` 負責，本規格只消費其契約。
- Admin 路由與管理畫面：由 `admin-dashboard` 負責。
- 離線編輯、離線同步及背景上傳：PWA 卡片明確指出 MVP 為 Online-first，未來依試用資料再評估。

## 使用情境

- 現場查核人員登入後，從今日任務看到預設指派給自己的已派任務，並可切換檢視自己有權限的專案中所有已派任務。
- 現場查核人員開啟一筆任務，查看專案、任務地點、狀態、建議執行人，以及每一項需求快照和其需檢查／拍攝／量測的說明。
- 同專案具 `inspection_task.inspect` 權限的成員，即使不是建議指派人，也能開始該任務；系統記錄實際開始者。
- 管理者或專案管理者在區網提供開發中的前端給 iPhone／iPad 測試時，使用 HTTPS 與受信任的開發憑證登入，不把 Cookie 安全要求降級。

## 需求

以下未直接由裁定指定的路由、表示方式、篩選參數與互動細節，均為**規格設計（非負責人裁定）**；不改變已凍結的領域與狀態契約。

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| FUI-R01 | Field **必須**在同一 React application 中提供 `/field/*` 路由，並依路由拆分程式碼，使 Field 路由不載入 Admin 程式。 | 必須 | [KD-12](../../intents/03-decisions-and-stack.md#kd-12)、[OQ-21](../../intents/05-open-questions.md#oq-21)；路由組織為規格設計 |
| FUI-R02 | 今日任務頁**必須**預設列出登入者在其有現場查核權限的專案中、建議指派給本人的未完成已派出 Task（`PENDING` 或 `IN_PROGRESS`）；「今日」不代表依日期欄位篩選。頁面並**必須**提供「專案全部可查核任務」切換，列出登入者有權限專案中所有未完成已派任務，不得擴大至無權限專案。未派出的 `DRAFT` Task 不得出現在任何現場清單或詳情。指派只作為預設篩選建議，不限制同專案其他具 `inspection_task.inspect` 權限成員開始任務。 | 必須 | 負責人裁定（#104，工單摘要）；[IP-R05](../inspection-planning/spec.md#需求)、[IP-R09](../inspection-planning/spec.md#需求)、[STM-R11](../state-machines/spec.md#需求)；頁面與切換細節為規格設計 |
| FUI-R03 | 任務詳情**必須**呈現任務狀態、所屬專案與依 [KD-58](../../intents/03-decisions-and-stack.md#kd-58) 定義的任務地點，並顯示該 Task 的需求快照。需求清單**必須**逐項呈現需求內容與必要的照片／量測要求；唯讀呈現不得建立 Evidence 或 Result。草稿、取消、封存等狀態不得被介面呈現成可操作狀態。 | 必須 | [PR-04](../../intents/02-principles.md#pr-04)、[KD-58](../../intents/03-decisions-and-stack.md#kd-58)、[DOM-R57](../domain-model/spec.md)、[STM-R09](../state-machines/spec.md#需求)；資訊分組為規格設計 |
| FUI-R04 | 對 `PENDING` Task，Field **必須**提供「開始查核」操作；只有登入者具該專案 `inspection_task.inspect` 權限且 Plan 未封存時才可操作。操作呼叫既有開始端點，由伺服器覆核狀態與權限，成功後顯示最新狀態與實際開始者；`IN_PROGRESS` 顯示進行中且不得重複開始，其他狀態不提供該操作。 | 必須 | [IP-R05](../inspection-planning/spec.md#需求)、[IP-R09](../inspection-planning/spec.md#需求)、[STM-R01](../state-machines/spec.md#需求)、[STM-R11](../state-machines/spec.md#需求)；按鈕與回應呈現為規格設計 |
| FUI-R05 | 系統**必須**提供跨專案的現場 Task 清單端點，只回傳已派出的 Task，並依 `inspection_task.read` 專案權限過濾。預設條件為指派給目前登入者；呼叫者得要求列出其所有可查核專案中的已派 Task。端點**必須**使用 cursor-based 分頁、穩定排序（含 UUID）、UUID 識別、共用 JSON 與錯誤契約；不得以客戶端提供的 User ID 決定「指派給我」。 | 必須 | 負責人裁定（#104，工單摘要：0.4.x 缺少跨專案列表端點）；[PR-01](../../intents/02-principles.md#pr-01)、[API-R01](../api-conventions/spec.md#需求)、[API-R06](../api-conventions/spec.md#需求)、[API-R08](../api-conventions/spec.md#需求)、[DOM-R35](../domain-model/spec.md#需求)、[AUT-R19](../authentication/spec.md#權限檢查)；端點契約細節為規格設計 |
| FUI-R06 | 登入狀態**必須**沿用 `authentication` 的伺服器端 Session 與 HttpOnly、Secure Cookie。未登入進入 Field 頁面時導向既有登入流程，登入成功後返回原請求路徑；登入者沒有任務讀取權限時顯示無權限狀態，不得把 403 當成空清單或登出。Session 失效時依 `authentication` 的 401 契約重新登入。 | 必須 | [KD-21](../../intents/03-decisions-and-stack.md#kd-21)、[AUT-R14](../authentication/spec.md#需求)、[AUT-R18](../authentication/spec.md#權限檢查)、[PR-01](../../intents/02-principles.md#pr-01)；返回路徑處理為規格設計 |
| FUI-R07 | Field **必須**提供適配手機與平板的觸控操作：主要操作可見且易於觸及、內容在窄螢幕可讀、清單與詳情可直向操作；不得顯示範本庫設定、資料庫 ID、Requirement Schema、Project Configuration、Storage Key、metadata 或資料庫管理功能。 | 必須／不得 | [PR-10](../../intents/02-principles.md#pr-10)（流暢操作為應；禁止顯示系統細節為不得）；版面驗收基準為規格設計 |
| FUI-R08 | 現場 Web **應**採 Online-first 並具 PWA-ready 基礎；不得宣稱具離線查核、離線同步或背景上傳能力。Field 路由與資產應可依既定拆包方式維護，日後新增安裝或快取能力不得繞過 API 直接讀寫資料。 | 應／不得 | [PR-01](../../intents/02-principles.md#pr-01)、[KD-12](../../intents/03-decisions-and-stack.md#kd-12)、[PWA 技術棧卡片](../../intents/03-decisions-and-stack.md#stack-pwa)；PWA 基礎安排為規格設計 |
| FUI-R09 | 開發環境**必須**保留 `Secure` Cookie 所需的 HTTPS；要從同一區網的 iPhone／iPad 存取時，開發者**必須**用含伺服器區網 IP 的憑證、將前端綁定至區網介面，並在裝置安裝及明確信任開發 CA 根憑證。根憑證私鑰不得傳至裝置或提交至 repository；後端仍只綁定 localhost，由 HTTPS 前端代理 API。此開發流程不得被描述為正式部署的 HTTPS 設定。 | 必須 | [KD-21](../../intents/03-decisions-and-stack.md#kd-21)、[#231](https://github.com/speko-tw/inspect-flow/issues/231)（工單指定情境）、[README iPhone 測試流程](../../../README.zh-TW.md)；憑證步驟沿用現有開發設定 |

## 資料

本規格不新增資料實體或欄位。`Inspection Task`、Task 項目與 `Task Requirement Snapshot` 沿用 [domain-model](../domain-model/spec.md)；Project、Task 地點與派任務規則沿用 [inspection-planning](../inspection-planning/spec.md)；狀態與轉換沿用 [state-machines](../state-machines/spec.md)。Field 清單使用伺服器回傳的目前狀態，不自行推算狀態。

## 介面

畫面路由及新增 API 的精確形式為**規格設計（非負責人裁定）**。本 API 是 0.4.x 規劃缺漏的補充，必須在 0.5.x Field 實作前納入可用後端契約。

| 方法 | 路徑 | 用途 | 權限 |
|---|---|---|---|
| GET | `/field/tasks` | 今日任務與跨專案已派任務清單；預設目前登入者建議指派任務，可切換全部可查核任務；以 `limit`、`cursor` 分頁 | 前端路由需登入；API 依每筆 Task 的 `inspection_task.read` 專案權限過濾 |
| GET | `/field/tasks/{task_id}` | 任務詳情，顯示需求快照、地點及狀態 | 前端路由需登入；API `inspection_task.read` |
| GET | `/api/v1/field/inspection-tasks` | 跨專案列出未完成的已派任務；`assigned_to_me=true` 預設，`false` 列出登入者所有可讀取專案的未完成已派任務；採 cursor-based 分頁 | 已登入；每筆套用 `inspection_task.read`；Admin 按現有規則放行 |
| POST | `/api/v1/inspection-tasks/{task_id}:start` | 開始查核；既有端點，本規格只定義 Field 呼叫行為 | `inspection_task.inspect`，後端覆核 Task 與 Plan 狀態 |

新增 API 清單資料的最小欄位應包含 `task_id`、`project_id`、專案名稱、Task 狀態、建議指派人資訊、Task 地點摘要、`updated_at`，供清單識別及排序。詳情應直接採既有 Task 讀取回應及 Snapshot 契約，不由瀏覽器組合未經核准的資料來源。欄位形狀與篩選參數均為規格設計，T1 應與 `inspection-planning` 的實作議題對齊。

前端可見狀態沿用 `state-machines` 的 Task 狀態，不新增狀態。`PENDING` 可開始；`IN_PROGRESS` 顯示進行中；`COMPLETED` 顯示已完成但本階段唯讀；`CANCELLED` 顯示已取消且不可開始。`DRAFT` 不可由 Field API 列出。Plan 封存中的 Task 依既有規則唯讀。

## 驗收條件

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| FUI-AC01 | 前端已登入；有兩個具 `inspection_task.read` 權限的專案，含指派給本人、指派給他人、未指派、`DRAFT`、`COMPLETED` 與 `CANCELLED` Task | 開啟今日任務並切換清單範圍 | 預設只見本人建議指派且未完成的已派任務；切換後可見所有有權限專案中的未完成已派任務；`DRAFT`、`COMPLETED`、`CANCELLED` 與無權限專案資料不出現；不依日期欄位篩選 | FUI-R02、FUI-R05 |
| FUI-AC02 | 使用者可讀取兩個以上專案的 Task，回傳項目多於一頁 | 以 cursor 逐頁讀取預設清單及全部可查核清單 | 頁面無重複或遺漏；順序穩定且 cursor 不透明；「本人」篩選由伺服器登入者決定 | FUI-R05 |
| FUI-AC03 | 有權限的現場使用者已派出一筆包含多個查核項目的 Task，快照含照片及量測要求 | 開啟任務詳情 | 顯示專案、位置、目前狀態、快照各項內容與要求；不寫入 Evidence、Result 或修改快照 | FUI-R03 |
| FUI-AC04 | `PENDING` Task 屬於使用者有 `inspection_task.inspect` 權限且未封存的專案 | 使用者不是建議指派人，仍按「開始查核」 | 後端接受合法開始動作，Task 變為 `IN_PROGRESS` 並記錄實際使用者；畫面刷新後顯示最新狀態 | FUI-R04 |
| FUI-AC05 | 任務已為 `IN_PROGRESS`、`COMPLETED`、`CANCELLED`，或其 Plan 已封存 | 嘗試查看操作區或直接重送開始請求 | UI 不提供不允許的開始操作；後端拒絕非法狀態／權限請求且 Task 不變；封存 Task 唯讀 | FUI-R04 |
| FUI-AC06 | 使用者尚未登入、登入後沒有指定專案權限，或 Session 已失效 | 開啟 Field 路由或呼叫列表／詳情 API | 未登入依 authentication 流程登入並在成功後回到原路徑；無權限回 403 並顯示無權限狀態；失效 Session 回 401 並重新登入；錯誤不被偽裝為空清單 | FUI-R06 |
| FUI-AC07 | 以手機與平板常用視窗寬度檢視 Field 的清單、詳情及操作區 | 使用觸控操作閱讀需求並開始允許的 Task | 內容不需水平捲動即可讀取，主要操作可觸及；不存在 PR-10 禁止的系統設定或技術細節 | FUI-R07 |
| FUI-AC08 | 開發者依 repo 文件在區網啟動 HTTPS 前端與 localhost 後端，具備開發 CA 的 iPhone／iPad 位於同一區網 | 在裝置 Safari 開啟區網 HTTPS URL 並登入 | 憑證主體涵蓋區網 IP、裝置明確信任根憑證、Secure Cookie 可用且 API 經前端代理；文件不得要求傳送 CA 私鑰，或將開發設定用於正式環境 | FUI-R09 |
| FUI-AC09 | 進入 Field 路由及前端建置產物檢查 | 載入 `/field/*` 並檢查路由拆包與離線行為 | 路由由單一 React application 提供，Field 不載入 Admin chunk；線上 API 為資料來源；未宣稱或執行離線編輯／同步 | FUI-R01、FUI-R08 |

## 待釐清

- 0.4.x 的跨專案清單 API 尚未實作。T1 應將本規格契約落到相應 API issue，確認實際欄位與路由後更新本表；若無法在既有權限及 Task 契約內實作，先提出決策，不得自行擴張 `domain-model`。
- 「今日任務」沒有在凍結的 Task 資料模型中定義排程日期。本規格設計將它視為登入者的預設已派任務入口，不新增日期欄位或假設每日排程；若負責人要求日期語意，需另行裁定並更新規格。

## 變更紀錄

-
