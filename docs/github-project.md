# GitHub Project 操作規範

本文件說明 InspectFlow GitHub Project 的用途、檢視方式與 agent 操作邊界。Project 是讓負責人掌握整體進度與回饋工作的入口；規格、版本歸屬與執行紀錄仍由 repo 文件及 GitHub Issue／PR 負責。

Project：[`InspectFlow Development`](https://github.com/orgs/speko-tw/projects/1)（`speko-tw/inspect-flow` Project #1）。

## 1. 各項資料的責任

| 資料 | 負責回答 | 權威來源 |
|---|---|---|
| Intent、Spec、Plan | 為什麼做、要交付什麼、如何拆解 | `docs/intents/`、`docs/specs/` |
| Issue | 一項工作、決策或待處理缺陷的描述與原生開關狀態 | GitHub Issue；詳細分類依 [`docs/specs/README.md`](specs/README.md#github-taxonomy) |
| PR | 變更內容、審查狀態，以及完成哪些 Issue | GitHub Pull Request |
| Milestone | 工作最晚應在哪個產品能力版本完成 | GitHub Milestone；依 [`版本與 Milestone 治理`](intents/06-versioning-and-milestone-governance.md) |
| Labels | 工作範圍及例外狀態 | Repo 既有七個 labels，依 [`GitHub 分類`](specs/README.md#github-taxonomy) |
| Issue Type、Priority、Effort | 類型、優先順序、估計工作量 | GitHub 組織層級 Issue 欄位，依 [`Issue 與 PR 欄位`](specs/README.md#issue-pr-fields) |
| Project | 以多種檢視呈現以上 GitHub 資料，方便掌握全局與進行中的工作 | GitHub Project #1 |

Project 不另建與上述內容重複的自訂欄位。GitHub Issue／PR 的 open、closed、merged 及審查狀態是狀態權威來源；Project 檢視以這些原生資料篩選呈現，不承諾自動把 Issue state 同步到 Project `Status`。如 Project 顯示和來源紀錄不同，以 Issue／PR 為準，修正 Project 設定或項目關聯，不要改動 Issue／PR 來迎合看板。

## 2. Issue、PR、Milestone 與 Project 的連結

- 每個可執行工作依現行流程建立 Issue；一般是一個 Issue 對一個分支及一個 PR。Issue 的 Issue Type、area label、Milestone、Priority、Effort 等欄位仍依 repo 現行規則填寫。
- PR 必須標示其完成的 Issue（PR 說明使用 `Closes #<issue>`），並遵守與 Issue 一致的 area label、Milestone 規則。PR 不是另一份任務規格。
- Milestone 表示產品能力版本系列，不是 Project、Sprint、優先順序或工作狀態。不得為了讓看板分組好看而移動 Milestone；歸屬依版本治理文件判斷。
- Project #1 收納 InspectFlow 的 Issue 與 PR，供總覽、待辦、決策、阻塞、審查及歷史查詢。文件規範是 repo 內的權威；Project 本身不取代規格索引、Issue 描述或 PR 審查紀錄。
- 已完成／關閉的 Issue 與已完成／關閉的 PR 也屬於專案全貌，應留在歷史檢視中。Project 的加入或檢視設定不可改變原始項目的狀態、內容或版本歸屬。

## 3. 已建立的 Views

Project #1 目前包含以下八個 Views。名稱和篩選條件是導覽方式，不另定義新的狀態：

| View | 用途 |
|---|---|
| **All Issues by Milestone** | 所有 Issue 的 TABLE，依 Milestone 分組；可展開各版本系列查看 Issue |
| **Current Milestone** | `0.2.x` 的開啟中 Issue，查看目前版本系列的交付工作 |
| **Open Work** | 所有開啟中的 Issue，跨 Milestone 查看待辦 |
| **Review Queue** | 開啟中的 PR，供負責人查看待審工作 |
| **Needs Decision** | 開啟且有 `needs-decision` label 的 Issue |
| **Blocked** | 開啟且有 `blocked` label 的 Issue |
| **Issue History** | 已關閉的 Issue |
| **PR History** | 非開啟中的 PR，包含已合併或已關閉的 PR |

`All Issues by Milestone` 已在 Project 介面設定為依 Milestone 分組，並儲存供所有使用者查看。`Current Milestone` 的 Milestone 篩選是視圖設定；若目前版本系列改變，負責人可更新該 View 的篩選。其他 View 也只能依既有 Issue／PR 原生狀態和 labels 做篩選。新增或修改 View 不得引入與分類規範衝突的狀態或欄位。

## 4. 自動更新與歷史資料

- Issue／PR 自己的狀態、label、Milestone 及內容變更後，符合 View 篩選的結果會依 GitHub Project 的篩選呈現更新；這不代表自動把每個狀態轉換成 Project `Status`。
- Project 已啟用原生 **Auto-add to project** 工作流程，來源為 `speko-tw/inspect-flow`，篩選 `is:issue,pr`。新 Issue #241 在未手動加入 Project 的情況下自動出現，已驗證 Issue 路徑；PR 路徑仍須於下一個新 PR 實際核對。Agent 每次建立 Issue／PR 後仍須確認其 Project 關聯；若缺漏，查明原因並修復，不把工作流程設定當成每筆資料都已成功的證據。自動加入規則不得修改或補造 Issue／PR 欄位值。
- Project 的 **Auto-close issue** 工作流程維持關閉。移動 Project `Status` 到 Done 不應關閉 Issue。只有 PR **合併**且 PR 說明中含 `Closes #<issue>`（指向對應 Issue）時，才由 GitHub 的原生關聯關閉該 Issue；關閉未合併 PR 不等於完成 Issue。Agent 要在合併前核對 PR 的 closing issue 關聯，合併後核對實際 Issue state。合併 PR 仍由人執行。
- Project 原生的「Pull request linked to issue」會將關聯 Issue 的 Project `Status` 設為 In Progress；「Pull request merged」會將 PR 項目的 Project `Status` 設為 Done；原生關閉事件也可更新 Project 狀態。`Status` 是輔助看板欄位，不能取代 Issue／PR 的原生狀態或審查結果。
- 歷史資料的完整性以 Issue／PR 本身為準。既有歷史項目可以加入 Project 供歷史檢視，但不得因加入 Project 而改動其 title、body、state、labels、Milestone、assignee 或組織欄位。
- **Insights** 有預設的 **Burn up** 圖表（篩選 `is:issue`），以及自訂的 [**Issue Progress by Milestone**](https://github.com/orgs/speko-tw/projects/1/insights/1)：篩選 `is:issue`、X 軸 Milestone、Y 軸項目數、依 Project `Status` 堆疊。後者用來看各版本系列的看板分布；它顯示的是 Project `Status`，若與 Issue 原生 open／closed 不一致，以 Issue 為準。Insights 不計入已封存的 Project 項目；檢視完整歷史仍用 Issue History／PR History 與 GitHub 原生紀錄。

## 5. Agent 操作規則

### 可以自動處理

- 讀取 Project 與 repo 治理文件，依現行規則建立、更新自己負責的 Issue／PR。
- 將新 Issue／PR 加入 Project，或修復明確缺漏的 Project 關聯；不得因此改動來源紀錄。
- 確認 Project 項目仍連結正確的 repo Issue／PR，並回報缺漏、重複或顯示問題。
- 套用既有七個 labels，更新與核准工作一致的 Milestone，並更新 Issue／PR 本身；需符合本 repo 對 Issue／PR 更新的授權規則。
- 在 PR 或對應 Issue 留言，以繁體中文說明工作進度、驗收結果、阻塞原因、Project 連結及需要負責人回饋的具體問題。
- 對使用者在 Issue／PR 中的回饋，先確認其範圍與驗收條件；明確且授權的修正可依 Issue 建立後續修改及 PR。

### 必須交由人決定

- 合併 PR、核准 agent 自己的 PR，或代替負責人確認產品需求已裁定。
- `needs-decision` 涉及的範圍變更、意圖變更及 OQ／G 裁定。
- 無法依現有版本治理判定的 Milestone、改變里程碑政策或重新定義 Project 的資料責任。
- 新增／刪除 label、改 repo／組織欄位或權限、刪除或重建 Project、批次改寫歷史 Issue／PR 原生欄位。
- 任何無法由 Issue／PR 原始內容和既有治理規則可靠判定的歷史分類。整理既有 Milestone 時另須遵守版本治理文件的 dry-run、分批及人工覆核要求。

### Project 設定護欄

- 不新增自訂欄位來複製 Issue Type、Priority、Effort、area labels、Milestone 或 GitHub 原生狀態。
- 不把 GitHub Issue／PR 狀態與 Project `Status` 的一致性描述為已自動保證；除非日後建立並驗證明確的同步機制，且本規範已透過 PR 更新。
- Auto-add、欄位自動化、可視欄位、分組及 Insights 的狀態必須以 GitHub Project 當前設定實測為準。若介面或權限不支援，記為待辦並交代限制，不推測已完成。
- 所有公開可見的 Issue、PR、Project 描述及留言不得包含機密、存取憑證或未核准的個人資料。

## 6. 負責人回饋給 Agent 的方式

Project 是查看與導覽的入口；實際工作指令和可追蹤上下文放在對應 Issue 或 PR：

1. 若是工作範圍、需求或驗收條件，請在對應 Issue 留言或更新 Issue，寫出預期結果及必要限制。
2. 若是目前 PR 的修改意見，請直接在該 PR 留言；逐行意見可使用 PR review comment。Agent 必須回覆處理方式與驗證結果，並在原有 PR 更新。
3. 若是新工作，開一張 Issue，依現行範本填寫並設定分類欄位；在 Issue 中引用相關 Spec、Plan、Milestone 和 PR。
4. 若 Project 裡只看到項目而不確定如何留言，打開該列連結的 GitHub Issue 或 PR 再留言。不要只在 Project 的摘要或描述寫工作要求，除非 GitHub 明確提供可追蹤並通知 Agent 的討論功能且已確認使用方式。
5. 對需要團隊裁定的回饋加上既有 `needs-decision`；尚未裁定前，Agent 只整理選項和影響，不自行選擇其中一案。

Agent 在收到回饋後，應先確認留言所指 Issue／PR、整理可執行的修改與驗收條件，再依 repo 分支、PR 和人工關卡執行。回饋不清楚或會改變範圍／意圖時，先在原討論串提出具體問題並等待決定。

## 7. 導入與維護順序

1. 先確認 Project #1 可存取，八個 Views 的名稱、篩選及結果都符合本文件。
2. 檢查既有歷史與開啟中的 Issue／PR 是否已加入 Project；只修復 Project 關聯，不批次改動來源欄位。逐批核對總數與例項。
3. Auto-add 已啟用且以新 Issue #241 驗證；下一個新 PR 建立時核對 PR 路徑，不以舊 PR 的既有關聯冒充驗收。
4. 每次調整 Insights，都要核對篩選範圍、軸、分組與封存項目限制；不要把 Project `Status` 圖表誤稱為 Issue 原生狀態統計。
5. 日常只維護 Issue／PR 的原生內容與既有分類；Project 依這些資料提供檢視。Project 設定或治理規則的變更，透過 repo PR 更新本文件並由人合併。

## 8. 本文件的維護

本文件負責 Project 的用途、Views、使用方式和 agent 邊界；Issue Type、labels、Priority／Effort 的具體設定仍以 [`docs/specs/README.md`](specs/README.md#github-taxonomy) 為準，Milestone 歸屬仍以 [`版本與 Milestone 治理`](intents/06-versioning-and-milestone-governance.md) 為準，通用 agent 權限與人工關卡仍以 [`AGENTS.md`](../AGENTS.md) 為準。各文件有衝突時，不自行擴大權限或變更分類；提出文件 PR 調整權威規則與連結。

Project 名稱、連結、View 或已驗證自動化改變時，應在同一 PR 更新本文件。不得把未驗證的設定寫成現況。
