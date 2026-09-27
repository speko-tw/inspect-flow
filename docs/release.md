# 發布流程（Release Process）

**這份文件回答**：一個版本從「功能做完」到「建好 Git tag 與 GitHub Release」要經過哪些步驟、誰負責做？
**什麼時候讀**：規劃版本、準備發版，或要寫 Release Notes 草稿時。

版號規則見 06 的 [VG-03](intents/06-versioning-and-milestone-governance.md#vg-03)、[VG-04](intents/06-versioning-and-milestone-governance.md#vg-04)：tag 用 `v0.MINOR.PATCH`，新能力升 MINOR，PATCH 只放修正。第一個正式版是 `v0.2.0`（#211）。

## 誰做什麼

| 工作 | 誰做 |
|---|---|
| 開 Release 追蹤 issue、發版前檢查 issue | agent 或負責人 |
| 發版前檢查的清單盤點、小 PR 修正 | agent |
| 確認檢查清單（要修哪些、哪些延後） | 負責人 |
| Release Notes 草稿 | agent |
| 建立 tag 與 GitHub Release | **負責人**（對外操作，agent 不得代做） |

## 步驟

1. **開 Release 追蹤 issue**：每個版本一個（例：#211），標題 `Release v0.X.Y`，放在該版本的 Milestone，列出發版前必須完成的 issue 清單。
2. **完成功能**：清單上的功能 issue 都關閉。
3. **發版前檢查（程式碼優化與安全性檢查）**：每個版本開一個檢查 issue（第一次是 #222），放在同一個 Milestone，功能都完成後才開始。
   1. 先盤點問題，每項標嚴重度與建議處理，列成清單貼在檢查 issue，給負責人確認。
   2. 負責人確認要修的項目，以小 PR 逐項（或同類一組）修正。
   3. 這次不修的項目，開 issue 並設 Milestone 追蹤，不可只記在留言。
   4. 完成條件：清單全部處理完、`make check` 與 CI 通過、手動驗收重跑通過；檢查 issue 關閉。
   - PATCH 版（例：`v0.2.1`）得只檢查這次變更的部分。
4. **確認可以發**：
   - Release 追蹤 issue 的清單全部關閉（含檢查 issue）。
   - 取得 `main` 最新 commit，確認它的 CI 綠燈並記下來，這個 commit 就是要打 tag 的對象：
     ```bash
     git fetch origin
     git rev-parse origin/main
     ```
5. **準備 Release Notes 草稿**：agent 依下方格式撰寫，貼在 Release 追蹤 issue 的留言。
6. **建立 tag 與 Release**（負責人）：先把確認後的草稿存成 `release-notes.md`，再執行：
   ```bash
   RELEASE_SHA=0123abcd   # 換成第 4 步記下的 commit；v0.X.Y 換成版號
   if git fetch origin &&
     [ "$(git rev-parse origin/main)" = "$(git rev-parse "$RELEASE_SHA")" ]
   then
     git tag -a v0.X.Y "$RELEASE_SHA" -m "v0.X.Y" &&
       git push origin v0.X.Y &&
       gh release create v0.X.Y --verify-tag --title "v0.X.Y" \
         --notes-file release-notes.md
   else
     echo "fetch 失敗或 main 已變動，未建 tag"
   fi
   ```
   印出「fetch 失敗或 main 已變動」時不會建 tag 或 Release：fetch 失敗就排除網路或權限問題後重跑；`main` 已變動（第 4 步之後又有合併）就回到第 4 步。建 tag 之後任一行失敗也會停在該行；不要整段重跑，先用 `git rev-parse v0.X.Y^{commit}` 確認 tag 指向第 4 步的 commit，再從中斷的那行（push 或 `gh release create`）接著執行。tag 指向別的 commit 就停下，找負責人處理。
7. **收尾**：關閉 Release 追蹤 issue，留言附 Release 連結。
   - Milestone `0.X.x` 保持開啟，之後的 PATCH（例：`v0.2.1`）照樣放在同一個 Milestone；確定這個系列不用再修 bug，或確認沒問題要進入下一個階段後才關閉。

## Release Notes 格式

| 段落 | 寫什麼 |
|---|---|
| 新增功能 | 使用者看得到的能力，一項一句；附 issue 或 PR 編號 |
| 修正 | bug fix、安全性修正（PATCH 版的主體） |
| 已知限制 | 這版還不能做的事、延後處理的檢查項目（附 issue） |
| 升級或初始化步驟 | 從上一版升級，或第一次安裝要執行的指令（例：migration、初始化指令）；沒有就寫「無」 |

沒有內容的段落寫「無」，不要刪掉，讀者才知道有檢查過。

範本：

```markdown
## 新增功能
- 帳號登入、登出（#…）

## 修正
- 無

## 已知限制
- …（#…）

## 升級或初始化步驟
1. `make migrate`
2. …
```

## 不做

- 自動化發布（release workflow）：目前手動，需要時再開 issue。
