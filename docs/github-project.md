# GitHub Project 操作規範

[InspectFlow Development](https://github.com/orgs/speko-tw/projects/1) 是彙整開發工作的看板，不是權威來源。
狀態、分類與版本歸屬以原始 Issue／PR、Milestone、labels 和 repo 文件為準。

## 資料責任

| 資料 | 負責什麼 |
|---|---|
| [Spec／Plan](specs/README.md) | 需求、驗收條件與工作計畫 |
| [Issue](specs/README.md#github-taxonomy) | 工作、決策與原生開關狀態 |
| PR | 修改、審查與合併結果 |
| [Milestone](intents/06-versioning-and-milestone-governance.md) | 產品能力版本歸屬 |
| [Labels](specs/README.md#github-taxonomy) | 工作範圍與例外狀態 |
| Project | 彙整 Issue／PR，方便查看進度與找到原始討論 |

不新增 Project 欄位來複製既有分類；Issue／PR 欄位規則見[規格索引](specs/README.md#issue-pr-fields)。

## Views

| View | 用途 |
|---|---|
| **All Issues by Milestone** | 所有 Issue，依 Milestone 分組 |
| **Current Milestone** | 目前聚焦的版本系列；篩選依版本規劃調整 |
| **Open Work** | 所有開啟中的 Issue |
| **Review Queue** | 所有開啟中的 PR |
| **Needs Decision** | 開啟且標有 `needs-decision` 的 Issue |
| **Blocked** | 開啟且標有 `blocked` 的 Issue |
| **Issue History** | 已關閉的 Issue |
| **PR History** | 已合併或關閉的 PR |

設定以 GitHub 現況為準；新增或修改 View 要負責人同意，並在同一個 PR 更新本文件。

## 自動化

- **Auto-add 開啟**：以 `is:issue,pr` 收錄新項目。建立 Issue／PR 後要確認已出現在 Project；不要假設它會自動補進舊項目。
- **Auto-close issue 關閉**：改 Project `Status` 不會、也不應關閉 Issue。
- **Issue 自動關閉**：PR 合併且內文標明 `Closes #<issue>` 時，才關閉對應 Issue；PR 關閉但未合併不算完成。
- **看板狀態**：原生 workflow 可在 PR 連結 Issue 時將 Issue 設為 In Progress、PR 合併時將 PR 設為 Done。這些狀態和 Insights 圖表不是 open／closed 的權威統計；不一致時以 Issue／PR 為準，不要為了對齊看板改 Issue。

操作權限、人工關卡、署名與機密規則見 [AGENTS.md](../AGENTS.md)。

## 負責人回饋

1. 在看板卡片連結的原 Issue 或 PR 留言，不要只寫在 Project。
2. 收到回饋後先讀原 Issue／PR 的最新留言；範圍不清楚就在原討論串發問。
3. GitHub 留言不會自動喚醒工作中的 agent；要立刻處理，請把連結交給 agent。

Project 設定改變時，在同一個 PR 更新本文件。
