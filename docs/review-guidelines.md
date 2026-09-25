# 審查準則（Review Guidelines）

**這份文件回答**：審查一個 PR 時要查哪些項目、哪些沒過就不能合併，以及自審留言怎麼寫。
**什麼時候讀**：開出 PR 後自審、審查別人的 PR，或在審查中發現值得固定的規則時。

## 怎麼用

- **誰審**：agent 開出 PR 後，**必須**依本準則自審，並把結果留言在該 PR；人開的 PR 由人或 agent 依同一份準則審查；最後一律由人核准合併（依據：[SKL-R08](specs/skeleton/spec.md#需求)、[人的關卡](specs/README.md#human-gates)）。
- **交叉審查**：自審之外，**得**再請另一個 agent 依本準則審查，逐輪修正到沒有意見為止。交叉審查不取代自審。
- **怎麼判定**：
  - **必修**：來源是「必須」等級的規則。未通過就要修正後才請人合併；不適用的項目寫明為什麼不適用。
  - **建議**：來源是「應」等級的規則，或沒有規格來源的一般做法。可以不採用，但留言要寫理由。
- **編號**：必修為 `RG-M<nn>`、建議為 `RG-S<nn>`，審查意見與自審留言都以編號引用。刪除的項目保留編號並標「撤回」，編號不重複使用。

## 必修

### 範圍與規格

- **RG-M01**：一個 PR 對應一個 task，不跨兩份規格；改動的檔案都在 `plan.md` 該 task 的「改動的檔案」內，超出時已在同一個 PR 更新 `plan.md`（依據：[流程](specs/README.md#流程與-github-對應)、[變更規則](specs/README.md#change)）。
- **RG-M02**：PR 依範本填寫「規格」「滿足的驗收條件」「規格影響」「驗證」，並以 `Closes #<task issue>` 關聯 issue；不屬於任何規格的工作，「規格」段寫 `N/A`（依據：[流程](specs/README.md#流程與-github-對應)）。
- **RG-M03**：規格影響等級判斷正確；範圍變更與意圖變更已先透過 spec-change issue 與 PR 合併，未以程式碼繞過規格；拿不準等級時往高一級處理（依據：[變更規則](specs/README.md#change)、[AGENTS.md](../AGENTS.md)）。
- **RG-M04**：PR 聲稱滿足的每條驗收條件，都附上 `plan.md`「驗證」欄指定的證據（測試，或貼在 PR 說明的指令輸出與連結）（依據：[狀態](specs/README.md#狀態)、各規格的 `plan.md`）。
- **RG-M05**：不違反 [02-principles.md](intents/02-principles.md) 中「必須」等級的原則；確有需要時，已先在 [03-decisions-and-stack.md](intents/03-decisions-and-stack.md) 新增決策並經團隊同意（依據：[AGENTS.md](../AGENTS.md)）。
- **RG-M06**：沒有把 [05-open-questions.md](intents/05-open-questions.md) 中未定案或來源矛盾的議題當成既定事實（依據：[AGENTS.md](../AGENTS.md)）。
- **RG-M07**：遵守共用檔案規則：每個 PR 最多新增一支 Alembic migration 且不留多個 head；lockfile 衝突以重新產生處理，不手動合併；應用程式入口與 router 註冊只加一行（依據：[共用檔案規則](specs/README.md#parallel)）。
- **RG-M08**：規格狀態只在 PR 裡改，並同步更新規格索引；撤回的需求或驗收條件保留編號並標「撤回」，不默默刪除（依據：[狀態](specs/README.md#狀態)、[變更規則](specs/README.md#change)）。

### Git

- **RG-M09**：分支名稱為 `<issue 編號>-<簡短描述>`（依據：[AGENTS.md](../AGENTS.md)）。
- **RG-M10**：commit 訊息用英文，格式為 `<type>(scope): <description>`，內文列點，最後一行 `Issue: #<編號>`，不含 `PR:` 或 `MR:` 行（依據：[AGENTS.md](../AGENTS.md)）。
- **RG-M11**：commit、PR、issue 留言與程式註解都沒有 AI 署名（`Co-Authored-By`、`Claude-Session`、「Generated with」、`🤖`，或 AI／Claude／Codex／LLM／bot／assistant 等字眼）；每個 commit 都跑過 AGENTS.md 的檢查指令且沒有輸出（依據：[AGENTS.md](../AGENTS.md)）。
- **RG-M12**：diff 只包含與該 task 相關的檔案，沒有順手改到其他任務的檔案（依據：[AGENTS.md](../AGENTS.md)）。
- **RG-M13**：PR 標題用英文，內文與留言用繁體中文；area label 依實際改動範圍標記（依據：[AGENTS.md](../AGENTS.md)、[GitHub 分類](specs/README.md#github-taxonomy)）。

### 程式碼

- **RG-M14**：CI 的 check 通過。統一檢查入口 `make check` 建立前，以各子目錄既有的格式、lint、型別檢查、測試與 build 指令驗證，並把結果貼在「驗證」段（依據：[SKL-R03、SKL-R04](specs/skeleton/spec.md#需求)）。
- **RG-M15**：程式碼行寬不超過 79 字元；更動 formatter、linter 或型別檢查的規則集與設定，已先開 `needs-decision` issue 經團隊決定（依據：[程式品質工具](intents/03-decisions-and-stack.md#stack-code-quality)、[人的關卡](specs/README.md#human-gates)）。

### 安全

- **RG-M16**：沒有提交 `.env`、secret 或連線字串，repo 只保存 `.env.example`；API 回應與 log 不含密碼、session secret、token 或設定值（依據：[PR-14](intents/02-principles.md#pr-14)、[SKL-R01、SKL-R10](specs/skeleton/spec.md#需求)）。

### 文件

- **RG-M17**：文件用繁體中文（臺灣用語），只有 AGENTS.md 列出的項目用英文；`README.md` 與 `README.zh-TW.md` 內容同步並保留頂端語言切換列；不標示文件版本號（依據：[AGENTS.md](../AGENTS.md)）。
- **RG-M18**：新增或修改的原則、決策與非目標都標註架構基準章節；規範用語「必須／應／得」使用正確，來源只是建議的項目不升級為「必須」（依據：[AGENTS.md](../AGENTS.md)）。
- **RG-M19**：沒有新建 `CLAUDE.md`、`.claude/CLAUDE.md` 或 `CLAUDE.local.md`（依據：[AGENTS.md](../AGENTS.md)）。

## 建議

- **RG-S01**：沒有遵守 [02-principles.md](intents/02-principles.md) 中「應」等級的原則時（例如避免 SQLite-specific 的 raw SQL、API 錯誤使用 `error.code`），在 PR 說明理由（依據：[02-principles.md](intents/02-principles.md)）。
- **RG-S02**：以 `noqa`、`type: ignore`、`eslint-disable` 等方式就地關閉檢查時，同一行或上一行註明理由。
- **RG-S03**：檢查類腳本找不到任何檢查對象時，以失敗結束，不當成通過（依據：[skeleton 計畫的風險](specs/skeleton/plan.md#風險)）。
- **RG-S04**：PR 維持單一目的；每個 commit 可以單獨看懂。
- **RG-S05**：PR 掛上與所關 issue 相同的 milestone（依據：[GitHub 分類](specs/README.md#github-taxonomy)）。
- **RG-S06**：自審後又推送了會影響範圍或驗收條件的改動時，更新自審留言。

## 自審留言格式

每個必修項目標「通過」「不適用」或「未通過」，並附證據（檔案、指令或連結）；「不適用」寫明原因。建議項目只列有相關的，寫明採用與否。

```markdown
## 自審（依 docs/review-guidelines.md）

### 必修

- RG-M01 通過：改動只有 `<檔案>`，都在 plan T<n> 的範圍內。
- RG-M04 通過：<AC 編號> 的證據見「驗證」段。
- RG-M07 不適用：本 PR 沒有 migration、lockfile 或入口檔。
- …（逐條列出 RG-M01 至最後一條）

### 建議

- RG-S02 採用：`<檔案>:<行>` 的 `noqa` 已註明理由。

### 結論

必修 <n> 項通過、<n> 項不適用、<n> 項未通過（未通過時列出修正計畫）。
```

## 準則怎麼改

- 審查中發現值得固定的規則，由發現的 PR 直接補進本準則，並給新編號。
- 會引起爭議或影響既有程式碼的規則（例如換 formatter、改命名慣例），開 issue 標 `needs-decision` 討論，決定後再補進本準則（依據：[人的關卡](specs/README.md#human-gates)）。
