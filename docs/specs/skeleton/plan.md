# 專案骨架（skeleton）：實作計畫

**規格**：[spec.md](spec.md)

計畫記錄「為什麼這樣拆」。實作中發現更好的拆法就直接更新本檔（屬於「計畫調整」）；進度看 issue，不在這裡打勾。

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1 | 後端骨架：FastAPI app、health router、pytest 測試；ruff 與 pyright 設定 | `backend/` 全部：`pyproject.toml`（含 ruff、pyright 設定）、`uv.lock`、`.python-version`、`app/`、`tests/`、`backend/.gitignore` | — | SKL-AC01、SKL-AC06（Python 部分） | #11 |
| T2 | 前端骨架：Vite + React + TS；`/admin`、`/field` 以 lazy import 拆分；Vitest 測試；拆包檢查腳本；Prettier、ESLint、tsc 設定 | `frontend/` 全部：`package.json`、`package-lock.json`、`.nvmrc`、Vite／TS／ESLint／Prettier 設定、`src/`、測試、拆包檢查腳本、`frontend/.gitignore` | — | SKL-AC02、SKL-AC03、SKL-AC06（前端部分） | #12 |
| T3 | 審查準則與自審流程 | `docs/review-guidelines.md`、`.github/pull_request_template.md`（「審查重點」段連結到準則） | — | SKL-AC07、SKL-AC08 | #13 |
| T4 | 統一檢查入口與 CI | `Makefile`、`.github/workflows/ci.yml`、`.env.example`、`README.md`、`README.zh-TW.md`（補「怎麼跑檢查」） | T1、T2 | SKL-AC04、SKL-AC05、SKL-AC10 | #14 |
| T5 | `main` 分支保護（**人工步驟**，由人在 repo 設定執行） | repo 設定：必過 check 指定為 T4 的 CI job，並要求至少一人核准 | T4 | SKL-AC09 | #15 |

- 各子目錄自己提供 `make` 可呼叫的指令（後端透過 `uv run`，前端透過 `npm run`）；根目錄 `Makefile` 只負責串接，CI 只呼叫 `make check`。
- Python 版本寫在 `backend/.python-version`（3.12）；Node 用 LTS 版本，寫在 `frontend/.nvmrc`，CI 從這兩個檔讀版本，不在 workflow 另寫一份。
- 拆包檢查：Vite 開啟 build manifest，腳本從 Field 路由的 chunk 追蹤它匯入的模組，出現 Admin 路徑就失敗。
- SKL-AC08 從 T1 起的每個 PR 都要做；T3 合併前，自審依規格與 [AGENTS.md](../../../AGENTS.md) 進行。

## 並行分組

- 第 1 波：T1、T2、T3。三者的檔案互不重疊，可同時進行。
- 第 2 波：T4。要先有前後端的指令才能串接。
- 第 3 波：T5。要先有 CI job 名稱，才能設為必過 check。

碰到[共用檔案](../README.md#parallel)的地方：

- lockfile：T1 擁有 `backend/uv.lock`，T2 擁有 `frontend/package-lock.json`，互不衝突。
- `.gitignore`：刻意拆成 `backend/.gitignore`、`frontend/.gitignore`，避免 T1 與 T2 同時改根目錄的 `.gitignore`。根目錄只在 T4 需要時才建立。
- `.github/`：T3 改 PR 範本，T4 新增 workflow，檔案不同，但兩者都不得順手改對方的檔案。

## 風險

- **Prettier 不會拆長字串**：一個斷不開的長字串超過 79 字元時，Prettier 不會報錯。SKL-AC06 的測資要用可斷行的運算式，否則會誤判為「80 字元也能通過」。
- **拆包檢查依賴 Vite manifest 格式**：Vite 升級改動 manifest 結構時，檢查腳本要一起更新。腳本檢查不到任何 chunk 時必須失敗，不得當成通過。
- **agent 自審靠流程紀律，沒有機制強制**：SKL-AC08 只能人工抽查。若常被漏掉，改用下方的方案 B。
- **T4 的 CI 在第一次跑時才會發現環境差異**（uv、Node 版本、快取）：T4 的 PR 要實際在 GitHub 上跑到綠燈才算完成。

## 驗證（Proof）

| AC | 驗證方式 |
|---|---|
| SKL-AC01 | `backend/tests/` 的 health 測試：設定假 `SECRET_KEY`，斷言狀態碼、內容，以及回應不含該值 |
| SKL-AC02 | `frontend/` 的 Vitest 路由測試：兩條路由各自渲染佔位頁 |
| SKL-AC03 | 拆包檢查腳本，包含在 `make check` |
| SKL-AC04 | T4 PR 說明貼上 `make check` 在乾淨狀態與故意弄壞一步時的結束碼 |
| SKL-AC05 | T4 PR 推一個丟棄式的失敗 commit，確認 CI 變紅後 revert；PR 說明附上兩次 run 的連結 |
| SKL-AC06 | T1、T2 各自在 PR 說明貼上長行與型別錯誤的失敗輸出（測資不留在 repo） |
| SKL-AC07 | T3 PR 審查時確認文件結構 |
| SKL-AC08 | 抽查 T1 至 T4 的 PR 留言 |
| SKL-AC09 | 人設定完成後，在 T5 issue 回報以未核准 PR 嘗試合併的結果 |
| SKL-AC10 | T4 在 CI 加入 `git ls-files` 檢查，或在 PR 說明貼上指令輸出 |

## 考慮過但沒採用的做法

- **方案 B：Claude Code GitHub Action 自動審查**。以 `claude setup-token` 產生的訂閱 OAuth token 認證，用量計入訂閱，不走 API 計費；repo 是 public，GitHub 內建 runner 不收費。目前不採用，理由：要安裝 Claude GitHub App、新增 repo secret（屬人的關卡），token 綁在個人訂閱上，而且 [AGENTS.md](../../../AGENTS.md) 的署名規則要補「外部審查工具的留言不在此限」。出現以下任一情況時改用 B，屬於計畫調整，另開任務處理：
  - 人開的 PR 常沒有人審查。
  - 自審常漏掉準則中的必修項目。
  - 需要一個獨立於寫程式脈絡之外的審查者。
- **`justfile`、`scripts/check.sh` 當統一入口**：團隊都用 macOS，`make` 已內建，不必另外安裝工具。
- **路由拆分延到 `field-ui`**：屆時要回頭改前端入口，並可能與其他任務同時改到同一批檔案，成本比現在高。
- **pnpm**：npm 隨 Node 內建，不必另外安裝。
- **根目錄單一 `package.json` 或 workspace**：會讓前後端任務共用同一個 manifest，T1、T2 就無法並行。
