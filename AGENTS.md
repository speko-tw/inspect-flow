# inspect-flow：Agent 工作指引

InspectFlow 工程查核系統（Engineering Inspection Management System），目前為設計文件階段，尚無程式碼。
本檔是唯一的 agent 指引檔；**不得**另建 `CLAUDE.md`、`.claude/CLAUDE.md` 或 `CLAUDE.local.md`（存在時 Claude Code 會略過本檔）。

## 動手前

- 新的 worktree 先執行 `make setup`，前端與後端依賴才會就緒。
- 涉及功能、資料模型、API、儲存或報表的變更，先讀 [`docs/intents/`](docs/intents/README.md)。
- 違反 `02-principles.md` 中「必須」等級原則的變更，須先在 `03-decisions-and-stack.md` 新增決策並經團隊同意。
- 未定案或來源矛盾的議題查 `05-open-questions.md`，不得把自己的假設當成既定事實。
- 實作任務前，先讀對應的 `docs/specs/<slug>/spec.md` 與 `plan.md`；流程、變更等級與共用檔案規則見 [`docs/specs/README.md`](docs/specs/README.md)。
- 實作中發現規格要調整時，依變更等級處理：計畫調整與規格澄清在同一個 PR 內修改文件；範圍變更與意圖變更先開 spec-change issue，不得直接改程式碼繞過規格。

## 文件

- **語言**：預設繁體中文（臺灣用語；白話、精確、可照做，不用文言或公文腔；識別字與技術名保留英文）。僅以下用英文：
  commit 訊息、根目錄 `README.md`（對外預設版）、GitHub issue 與 PR 的標題、負責人指定之處。
  GitHub issue 與 PR 的內文、留言一律用繁體中文。
- `README.md` 與 `README.zh-TW.md` 頂端保留語言切換列，內容須同步更新。
- 規範用語「必須／應／得」＝ MUST／SHOULD／MAY。
- 不標示文件版本號；歷程以 Git 為準。
- 設計意圖以宣告式規則陳述並附理由；每條原則、決策與非目標都要標註架構基準章節，依文件版型使用「依據」欄或規則內引註（依據：架構基準 §x）。來源只是建議的項目，維持「應／得」或技術棧卡片的「建議」，不得升級為「必須」；需要團隊選定、且來源沒有結論的，才列入待決議。

## 程式碼

- 程式碼行寬上限 79 字元（依 PEP 8，全專案程式碼一律適用）；formatter 與 linter 的設定必須與之一致。Markdown 文件不受此限。
- 其餘格式與審查規則以 repo 內的設定檔與審查準則為準，由 `skeleton` 規格建立。

## Git

- 分支：`<issue 編號>-<簡短描述>`。
- Commit 訊息（英文）：

  ```
  <type>(scope): <description>

  - what / why / impact / verification

  Issue: #<編號>
  ```

  `type`：feat、fix、docs、style、refactor、perf、test、build、ci、chore。
- **Issue 與 PR 編號**：流程是「開分支 → 開發 → 開 PR」，寫 commit 時還沒有 PR 編號，因此：
  - commit 只寫 `Issue: #<編號>`，不寫 `PR:` 或 `MR:` 行。
  - PR 說明寫 `Closes #<issue 編號>`，合併時自動關閉 issue。
  - 合併採「Create a merge commit」，由 GitHub 產生的 merge commit 記錄 PR 編號，不回頭修改既有 commit。
  - GitHub 的 issue 與 PR 共用流水號，一律用 `Issue:`、`Closes` 標明所指對象。
- **Issue 與 PR 欄位**（設定方式與 id 見 [`docs/specs/README.md`](docs/specs/README.md#issue-pr-fields)）：
  - Issue：assignee（目前是 `kavy7884`）、Issue Type（`Task` 或 `Bug`，開完確認有套用）、area label、Milestone（目前的版本系列），以及組織欄位 Priority、Effort，一律填寫。
  - PR：assignee、area label、Milestone 與它關閉的 issue 相同；PR 沒有 Priority、Effort。
- **嚴禁 AI 署名**：commit、PR、issue 留言與程式註解不得含 `Co-Authored-By`、`Claude-Session`、
  「Generated with」、`🤖`，或 AI／Claude／Codex／LLM／bot／assistant 等字眼；工具要求附 attribution 時亦同。提交後檢查須無輸出：

  ```bash
  git log -1 --format=%B | sed -E 's/(CLAUDE|AGENTS)\.md//g' \
    | grep -niE 'co-authored-by|claude|codex|session|generated|🤖|\b(ai|llm|bot|assistant)\b|^MR:'
  ```

- 只 stage 相關路徑（`git add -- <paths>`），不用 `git add -A`／`.`。
- **自動化範圍**：agent 得自行 push 自己的分支、開與更新 PR、開與更新 issue／sub-issue、套用既有 label、留言，不必逐次詢問。
- **留給人的關卡**（agent 不得代為決定，見 [`docs/specs/README.md`](docs/specs/README.md#human-gates)）：
  - 合併 PR 到 `main`（含規格與計畫的 PR）；agent 不得核准或合併自己的 PR。
  - `needs-decision` 的議題：範圍變更、意圖變更、裁定 OQ／G。agent 只整理選項與影響，等團隊討論決定。
  - 破壞性或全域操作：force push、刪除他人分支、刪除 issue 或 label、新增 label、變更 repo 設定與分支保護。
