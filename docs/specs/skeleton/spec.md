# 專案骨架（skeleton）

**代碼**：`SKL`　**Phase**：P0　**狀態**：已凍結
**前置規格**：無
**引用意圖**：[KD-09](../../intents/03-decisions-and-stack.md#kd-09)、[KD-10](../../intents/03-decisions-and-stack.md#kd-10)、[KD-12](../../intents/03-decisions-and-stack.md#kd-12)、[PR-11](../../intents/02-principles.md#pr-11)、[PR-13](../../intents/02-principles.md#pr-13)、[PR-14](../../intents/02-principles.md#pr-14)；技術棧卡片：[Backend 語言](../../intents/03-decisions-and-stack.md#stack-backend-language)、[Web API](../../intents/03-decisions-and-stack.md#stack-web-api)、[Frontend](../../intents/03-decisions-and-stack.md#stack-frontend)、[測試工具](../../intents/03-decisions-and-stack.md#stack-tests)、[CI](../../intents/03-decisions-and-stack.md#stack-ci)、[程式品質工具](../../intents/03-decisions-and-stack.md#stack-code-quality)
**被擋議題**：無

## 目的

工程師與 agent 在本機或 CI 執行同一個 `make check`，就能證明一個變更格式正確、lint 與型別檢查通過、測試通過、可以 build；每個 PR 都有依審查準則寫成的審查意見，最後由人核准合併。這是 [規格流程閉環前提](../README.md#human-gates) 的落地（依據：架構基準 §28、§29、§30 Phase 0）。

## 範圍

**包含**：

- 後端骨架：Python 3.12、FastAPI，以 uv 管理依賴與 lockfile；提供健康檢查端點。
- 前端骨架：React、TypeScript、Vite 單一 app，以 npm 管理依賴與 lockfile；`/admin`、`/field` 兩個佔位頁，依路由拆分程式碼。
- 根目錄 `Makefile`：`make check` 是本機與 CI 唯一的檢查入口。
- GitHub Actions CI：每個 PR 執行 `make check`。
- 格式、lint、型別檢查的設定檔，進版控。
- 審查準則 `docs/review-guidelines.md`，以及開 PR 的 agent 依準則自審的流程。
- `.env.example`。
- `main` 分支保護的需求（設定由人執行）。

**不包含**：

- 資料庫、SQLAlchemy、Alembic，以及 CI 的 PostgreSQL 相容性測試：移至 `database-foundation`（本規格沒有資料庫可測）。
- `/api/v1` 的錯誤格式與共用慣例：移至 `api-conventions`；本規格只使用 `/api/v1` 前綴。
- 登入、目前使用者與權限：移至 `authentication`。
- Dockerfile、Docker Compose、Reverse Proxy 與部署流程：移至 `pilot-deployment`。
- Playwright 端到端測試、PWA：等有實際使用流程的規格再加入。
- 以 GitHub 上自動觸發的 AI 工具審查 PR：本規格先採 agent 自審，改進方案記在 [plan.md](plan.md#考慮過但沒採用的做法)。

## 使用情境

- 工程師 clone repo，依 README 安裝 uv 與 Node 後執行 `make check`，看到全部通過。
- agent 完成任務後開 PR；CI 自動執行 `make check`；agent 依審查準則自審並在 PR 留言；人看過留言與 CI 結果後合併。
- 有人提交一行 80 字元的程式碼，CI 失敗，PR 無法合併。

## 需求

| 編號 | 需求 | 強度 | 依據 |
|---|---|---|---|
| SKL-R01 | 後端**必須**提供 `GET /api/v1/health`，回傳服務狀態；回應**不得**包含 secret、連線字串或任何設定值 | 必須 | 架構基準 §30 Phase 0、§22.14；[PR-14](../../intents/02-principles.md#pr-14) |
| SKL-R02 | 前端**必須**是單一 React app，`/admin/*`、`/field/*` 依路由拆分程式碼；Field 的程式包**不得**載入 Admin 的模組 | 必須 | 架構基準 §5.1；[KD-12](../../intents/03-decisions-and-stack.md#kd-12) |
| SKL-R03 | 根目錄 `make check` **必須**依序對後端與前端執行格式檢查、lint、型別檢查、測試與 build；任一步失敗即以非零結束碼結束 | 必須 | 架構基準 §28、§29；[閉環前提](../README.md#human-gates) |
| SKL-R04 | CI **必須**在每個 PR 與每次 push 到 `main` 時執行 `make check`，不另寫第二套檢查步驟；失敗時 check 為失敗 | 必須 | 架構基準 §22A.4–22A.7；[CI](../../intents/03-decisions-and-stack.md#stack-ci) |
| SKL-R05 | Python 設定**必須**為：ruff `line-length = 79`，lint 規則 `E F W I B UP N`，排版用 ruff format；pyright `basic` | 必須 | 架構基準 §29；[程式品質工具](../../intents/03-decisions-and-stack.md#stack-code-quality)；起始規則由團隊於 [#5](https://github.com/speko-tw/inspect-flow/issues/5) 決定 |
| SKL-R06 | 前端設定**必須**為：Prettier `printWidth: 79`；ESLint 採 recommended、typescript-eslint recommended、react-hooks，並以 eslint-config-prettier 關閉與 Prettier 重疊的規則；`tsc --noEmit` 採 strict | 必須 | 架構基準 §29；[程式品質工具](../../intents/03-decisions-and-stack.md#stack-code-quality)；起始規則由團隊於 [#5](https://github.com/speko-tw/inspect-flow/issues/5) 決定 |
| SKL-R07 | `docs/review-guidelines.md` **必須**以逐條清單列出審查項目，並分為「必修」與「建議」兩類 | 必須 | [閉環前提](../README.md#human-gates) |
| SKL-R08 | agent 開出 PR 後，**必須**依審查準則自審，並把結果留言在該 PR；人開的 PR 由人或 agent 依同一份準則審查；最後由人核准合併 | 必須 | [閉環前提](../README.md#human-gates)；[AGENTS.md](../../../AGENTS.md) |
| SKL-R09 | `main` **必須**設定分支保護：所有變更經 PR 合併；CI 的 check 通過且分支為最新才能合併；禁止 force push 與刪除（由人設定）。GitHub 核准人數暫設 0，由人在合併前檢視 PR（流程約定）；加入第二位協作者時，改回至少一人核准 | 必須 | 架構基準 §22A.12；[閉環前提](../README.md#human-gates) |
| SKL-R10 | repo **必須**只提交 `.env.example`，**不得**提交 `.env` | 必須 | 架構基準 §22.9；[PR-14](../../intents/02-principles.md#pr-14) |

## 資料

無。本規格不建立資料庫或實體。

## 介面

| 方法 | 路徑 | 用途 | 權限 |
|---|---|---|---|
| GET | `/api/v1/health` | 回傳 `{"status": "ok"}` | 公開 |

**指令**：根目錄 `make check`。子目標（例如只跑測試）由計畫決定，不屬於本規格的契約。

## 驗收條件

| 編號 | Given | When | Then | 對應需求 |
|---|---|---|---|---|
| SKL-AC01 | 後端啟動，環境變數設有假的 `SECRET_KEY` | 呼叫 `GET /api/v1/health` | 回應 200，內容為 `{"status": "ok"}`；回應中找不到 `SECRET_KEY` 的值 | SKL-R01 |
| SKL-AC02 | 前端 app | 分別進入 `/admin` 與 `/field` | 各自顯示自己的佔位頁 | SKL-R02 |
| SKL-AC03 | 前端 build 完成 | 檢查 build 產出的模組依賴 | Field 入口的依賴中沒有任何 Admin 模組；此項檢查包含在 `make check` | SKL-R02 |
| SKL-AC04 | 工作目錄乾淨 | 執行 `make check` | 結束碼為 0；故意讓任一步失敗時，結束碼不為 0 | SKL-R03 |
| SKL-AC05 | 開一個 PR | 推送 commit | CI 執行 `make check`；推送會失敗的 commit 時，check 顯示失敗 | SKL-R04 |
| SKL-AC06 | Python 與 TypeScript 各一行可斷行的 80 字元程式碼，以及各一個型別錯誤 | 執行 `make check` | 格式檢查對兩個長行都失敗；pyright 與 `tsc` 對型別錯誤都失敗 | SKL-R05、SKL-R06 |
| SKL-AC07 | repo | 打開 `docs/review-guidelines.md` | 有「必修」與「建議」兩段逐條清單 | SKL-R07 |
| SKL-AC08 | 實作本規格各任務的 PR 由 agent 開出 | 檢查 PR 留言 | 每個 PR 都有一則依審查準則寫成的自審留言 | SKL-R08 |
| SKL-AC09 | 分支保護已設定 | 對 CI 失敗的 PR 嘗試合併 | GitHub 擋下合併（由人驗證） | SKL-R09 |
| SKL-AC10 | repo | 執行 `git ls-files \| grep '\.env$'` | 沒有輸出，且 `.env.example` 存在 | SKL-R10 |

## 待釐清

- 無。

## 變更紀錄

- SKL-R09 的 GitHub 核准人數暫設 0、改由人在合併前檢視 PR；SKL-AC09 改為只驗證 CI 失敗的 PR 會被擋下 — #22
