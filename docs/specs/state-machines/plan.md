# 狀態機：實作計畫

**規格**：[spec.md](spec.md)

Plan／Task 已裁定的狀態行為依部分凍結規則於 spec 中凍結；Evidence／Report 仍為草稿。G-01 未定的 interval 歸屬及快照規則只涉及未來選用功能，不阻擋 MVP 範圍。資料模型仍須等 `domain-model` 凍結 Plan／Task 實體後才能實作；`inspection-planning` 負責 Plan／Task 建立、任務組成、派出操作與現場可見性及操作契約，本規格負責派出後的狀態轉換、KD-55 項目結果狀態及 Plan 狀態彙總。技術選擇均在 spec 中標為「規格設計（非負責人裁定）」，不增補業務規則。Evidence 受 G-05 阻擋，Report 受 G-06（其他產製狀態）與 G-07 阻擋。需求與 AC 編號見 [spec.md](spec.md)。

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1（待依賴） | 實作凍結範圍內的 Plan／Task 後端狀態轉換、完成時伺服器覆核、KD-55 項目層級作廢／更正、實際查核人紀錄與 Service 層狀態驗證。Result 欄位驗證與寫入及改善追蹤屬 0.7.x，不納入。拆分前須有 `inspection-planning` API／流程契約及 `domain-model` Plan／Task 實體凍結。 | `backend/app/services/`、`backend/app/models/`、`backend/app/api/`、對應測試與 Alembic migration | `inspection-planning` API／流程契約；`domain-model` Plan／Task 實體凍結；本規格凍結範圍 | STM-AC01～STM-AC05、STM-AC08～STM-AC15 | 待開 |
| T2（待依賴） | 實作凍結範圍內的 Plan／Task 動作之前端狀態顯示與互動，包含 KD-55 確認對話框（由功能規格定義）、取消原因及「有缺失」任務標示。須待 T1 與 API 契約確認後拆分。 | `frontend/src/`、對應前端測試 | T1；API 契約；本規格凍結範圍 | STM-AC02～STM-AC05、STM-AC08～STM-AC15 | 待開 |
| T3（待凍結） | Evidence 照片流程、獨立刪除與保留政策；未達凍結條件，不可開工。 | G-05 裁定後拆分 | G-05；Evidence 凍結 | 待凍結 | 待開 |
| T4（待凍結） | Report 狀態、快照、版次、核發與產製失敗流程；未達凍結條件，不可開工。 | G-06／G-07 裁定後拆分 | G-06 其他狀態、G-07；Report 凍結 | STM-AC06（草稿） | 待開 |

- 規格凍結後，每個實作任務應能以一個 PR 完成並單獨驗收；任務須待其範圍凍結後拆分。
- 本規格 Plan／Task 範圍依標頭已凍結；T1、T2 只涵蓋列出的需求／AC，仍待 `domain-model` 凍結 Plan／Task 實體與 `inspection-planning` 契約後拆分。T3、T4 須待各自範圍阻擋議題裁定並凍結。
- 涉及資料模型的任務須等 `domain-model` 凍結相關實體；跨規格依賴由後續 issue 確認。
- 若任務檔案範圍重疊，依共用檔案規則重新分波；本計畫不預先授權同時修改共用 model、migration 或服務檔案。

## 並行分組

- 待依賴：T1、T2 僅涵蓋本規格已凍結範圍；拆分前須有 `inspection-planning` 契約及 `domain-model` Plan／Task 實體凍結。
- 待凍結：T3、T4；分別待 G-05 與 G-06／G-07 裁定及對應範圍凍結。

## 風險

- **把待決範圍當成凍結**：只實作 spec 標頭列出的 Plan／Task 凍結範圍；`inspection-planning` 負責派出操作，不負責本規格的 Plan 狀態彙總。雖本規格狀態行為已凍結，`domain-model` 尚未凍結 Plan／Task 實體，相關資料模型工作不可提前；G-05、G-06、G-07 仍阻擋 Evidence／Report。
- **混淆技術提案與決策**：英文狀態名稱及項目層級作廢資料表示等內容如標示為規格設計，仍不得視為額外業務規則。
- **項目作廢範圍錯誤或追溯關聯遺失**：KD-55 只作廢被修改項目的舊結果與照片，保留同 Task 其他項目；項目層級追溯表示由 `domain-model` 定義，不得把整個 Task 作廢。
- **Report 來源差異**：其他產製狀態、快照與版次邊界未定，T4 不得提前實作。

## 驗證（Proof）

| AC | 驗證方式 |
|---|---|
| STM-AC01 | 後端 Service/API 測試涵蓋 Plan／Task 允許及拒絕的轉換，確認用戶端無法任意指定狀態。 |
| STM-AC02 | 整合測試：第一個 Task 派出令 Plan 自動進行；草稿阻擋完成與取消；全部完成且無草稿時 Plan 自動完成；全數取消且無完成 Task 時 Plan 自動取消；手動完成狀態寫入遭拒。 |
| STM-AC03 | 整合測試：已完成 Task 修正後仍為完成，並查核修正者、時間及內容紀錄。 |
| STM-AC04 | 整合測試：KD-55 選「要」只作廢該項目的舊結果與照片，同 Task 其他項目保留；僅已完成 Task 回到進行中補查，未完成 Task 維持狀態；原已完成 Plan 退回進行中，補查完成後依完成判定更新。 |
| STM-AC05 | 整合測試：選「不要」只更正文字，結果、照片及狀態不變，且更正可追溯；互動依 KD-55 功能規格。 |
| STM-AC07 | 規格審查確認未凍結的 Evidence／Report 行為仍標記草稿，實作 issue 僅涵蓋已凍結範圍。 |
| STM-AC08 | 完成請求由伺服器覆核必要資料且沒有待重查項目；含「不符合」仍可完成並於任務清單標示「有缺失」。不驗證 Result 欄位寫入或改善追蹤。 |
| STM-AC09 | 整合測試：未指派及已指派 Task 均可由具權限的同專案成員開始／完成；實際操作者紀錄與稽核／報告使用的查核人一致。 |
| STM-AC10 | 整合測試：未完成 Task 可取消、已完成 Task 不可取消；取消保留原因與資料、不計入完成判定；可恢復至取消前狀態；Plan 任一狀態可封存且封存後 Task 不得查核、取消或恢復。 |
| STM-AC11～STM-AC15 | 整合測試：來源狀態取消限制、恢復權限與 Plan 狀態重算、封存後唯讀、草稿刪除限制，以及取消 Task 遇 KD-55 標準變更後以目前標準恢復並標示待重查。 |

本輪只更新規格與計畫文件，以上測試未執行（NOT_RUN）。

## 考慮過但沒採用的做法

- 在本輪拆出 Evidence／Report 的可執行實作任務：不採用，相關狀態仍受 G-05、G-06、G-07 阻擋。
- 以通用 PATCH 讓前端直接設定任意狀態：不採用，違反 PR-16 的後端 Service 狀態轉換邊界。
