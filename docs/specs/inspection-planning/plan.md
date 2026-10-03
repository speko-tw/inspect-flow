# 查核計畫與任務（inspection-planning）：實作計畫

**規格**：[spec.md](spec.md)

本計畫依草稿拆分工作。2026-10-03 業務裁定已由 PR #344 寫入 KD-55／KD-56。多項目 Task 的 KD-55 項目級重查補充裁定見[負責人留言](https://github.com/speko-tw/inspect-flow/issues/103#issuecomment-5970063986)，待 Issue #346 追蹤的 PR #347 合併及 `state-machines` 同步；本計畫不代表規格凍結。實作 task 開立前仍須核對最新已合併來源及責任檔案。

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1 | 定義 P4 `ProjectInspectionItem` 擴充欄位、Plan、Task、多項目關聯、每項 Snapshot／狀態／歷史及 KD-55 修改紀錄資料結構；建立 migration 與資料庫約束 | `backend/app/models/`、`backend/alembic/versions/`、`backend/tests/db/` | `template-system`、`domain-model`、`database-foundation`；核對 PR #344 已合併的 KD-55／KD-56，並追蹤 Issue #346 追蹤的 PR #347 及同步後的 `state-machines` | IP-AC02～IP-AC05 | 待開 |
| T2 | 實作 Plan／Task／Snapshot 服務層、派出／草稿刪除／取消／恢復、KD-55 項目級重新查核及衍生狀態；受影響 Task 回到 `IN_PROGRESS`，草稿 Task 原位更新；封存期間 Task 唯讀、取消封存後重算 Plan 狀態。集中登記權限代碼與稽核事件 | `backend/app/services/`、`backend/tests/services/`、`backend/app/permission_codes.py`、`docs/specs/audit-log/spec.md` | T1、`authentication`、`state-machines`；核對 PR #344 已合併的 KD，並追蹤 Issue #346 追蹤的 PR #347 所承載的補充裁定及狀態機同步；TPL 已登記的權限沿用 | IP-AC03～IP-AC09 | 待開 |
| T3 | 實作 Plan／Task／專案項目修改 API，含權限檢查、UUID、分頁、錯誤契約及快照讀寫 | `backend/app/api/`、`backend/app/schemas/`、`backend/tests/api/` | T1、T2、`api-conventions` | IP-AC01～IP-AC10 | 待開 |
| T4 | 建立內業 Plan 管理、手動建立多項目 Task、派出／草稿刪除／取消／恢復操作與任務建議指派 UI；草稿 Task 僅內業可見；封存 Plan 的 Task 唯讀 | `frontend/src/features/`、`frontend/src/routes/`、`frontend/tests/` | T3；核對 PR #344 的 KD 及 Issue #346 追蹤的 PR #347 合併後同步的 `state-machines` 契約 | IP-AC01、IP-AC02、IP-AC06～IP-AC08 | 待開 |
| T5 | 建立專案查核項目修改確認介面，說明重新查核後果；呈現受影響項目作廢歷史、其他項目保留及來源 Task 為 `DRAFT` 時原位更新 | `frontend/src/features/`、`frontend/tests/` | T3；依 IP-Q07／IP-Q08 的項目級技術設計，追蹤 Issue #346 追蹤的 PR #347 同步 | IP-AC04、IP-AC05、IP-AC08 | 待開 |
| T6 | 端到端驗收快照隔離、修改影響範圍、權限、指派非排他性、自動 Plan 狀態與歷史保存，補文件及索引收尾 | `backend/tests/`、`frontend/tests/`、`docs/specs/inspection-planning/`、`docs/specs/README.md` | T1～T5；受影響規則均已裁定 | IP-AC01～IP-AC10 | 待開 |

- 每個 task issue 開立前，應將路徑清單縮到具體檔案，並依共用 migration、model registry、router、API client 等實際重疊情況調整責任界線。
- 所有 AC 至少由一個 task 涵蓋；IP-Q 業務裁定已由 PR #344 寫入 KD-55／KD-56；KD-55 項目級補充依 Issue #346 追蹤的 PR #347 合併後與 `state-machines` 同步。本規格草稿不代表凍結。
- 任務按專案查核項目手動建立；本計畫不包含依 interval、起訖點或間距自動切分任務。

## 並行分組

依檔案責任與資料相依分波。下列為初步安排，具體檔案清單須在開 task 前再檢查；Alembic migration 鏈是共用檔案，每波最多一支 migration，並按 [共用檔案規則](../README.md#parallel) 處理。

- 第 1 波：T1（資料模型與 migration；獨占 migration 鏈及相關 model registry）。
- 第 2 波：T2（服務、權限與狀態行為；依賴 T1）。
- 第 3 波：T3（API 與 schema；依賴 T1、T2）。
- 第 4 波：T4 與 T5（前端；只有路由、共用 client 與 feature 檔案責任確認不重疊時才並行，否則依序）。
- 第 5 波：T6（跨端驗收與文件收尾；依賴 T1～T5）。

## 風險

- **KD-55 項目級補充待同步**：2026-10-03 負責人補充裁定只作廢受影響項目的舊 Snapshot、結果與照片，保留同 Task 其他項目；Task 回到 `IN_PROGRESS`，來源為 `DRAFT` 時原位更新。此補充與 main 現有 KD-55 的整筆 Task 作廢文字不同，依負責人留言 5970063986 作為本規格依據；Issue #346 仍開放，其追蹤的 PR #347 亦仍開放，待合併後更新 KD-55。不得把補充誤述為已合併。
- **狀態機不同步**：PR #344 已合併 KD-56 的 Plan 任意狀態封存規則；本規格依負責人裁定採封存時 Task 唯讀、取消封存後依現況重算，且草稿 Task 阻止完成。`state-machines` 草稿仍只列 `COMPLETED ↔ ARCHIVED` 並保留封存前狀態語義；Issue #346 追蹤的 PR #347 合併後須同步該規格。本規格不宣稱其已更新或凍結。
- **Task 組成**：負責人已裁定一個 Task 得含多個項目；關聯表／明細表、各項 Snapshot／狀態／歷史結構仍為規格設計，需涵蓋 KD-55 只作廢受影響項目且 Task 重回 `IN_PROGRESS`。
- **快照結構與更正**：Snapshot 必須保存建立時需求；KD-55 的「不要」重新查核是明確更正例外，需確保結果、照片與狀態不變且有可追溯紀錄。欄位採明確欄位或關聯子表為**規格設計（非負責人裁定）**，實作前確認不破壞歷史追溯。
- **專案項目修改範圍**：KD-55 只影響同專案使用該項次的任務；若跨 Plan，必須確保查全所有關聯，而不是只查目前頁面或目前 Plan。
- **取消與完成判定**：未派出的 `DRAFT` Task 可刪除、不可取消；派出後未完成 Task 可取消及恢復，完成 Task 不可取消。草稿 Task 阻止 Plan 完成；零 Task 維持 `DRAFT`，全取消且至少一筆為 `CANCELLED`，有完成且其餘取消為 `COMPLETED`。取消封存後依當前 Task 重算 Plan。
- **報告與 Evidence 範圍**：KD-55 對作廢資料保存與已發出報告的要求，不等於 G-05／G-06／G-07 已裁定；不可在本規格自行補足 Evidence 刪除或 Report 狀態政策。
- **共用檔案競爭**：Plan／Task models、router 註冊、權限表及 migration 都可能與其他 P4 工作重疊；開 task 時需依最新 main 及 issue 狀態確認，不以本草稿推定可同波。

## 驗證（Proof）

每條 AC 的實際命令與證據應在對應實作 PR 記錄；純文件規格草稿階段不執行產品驗收。

| AC | 驗證方式 |
|---|---|
| IP-AC01 | API 整合測試：授權與拒絕任意狀態輸入；跨專案存取測試。 |
| IP-AC02 | API／服務測試：內業建立含多個明選項目的 Task 與只含單項的 Task；確認建立後為草稿且現場不可見，沒有 interval 仍可建立，也不自動切分任務。 |
| IP-AC03 | 服務／資料庫測試：建立 Task 後修改 Template 與 ProjectInspectionItem，確認 Snapshot 仍為建立時內容。 |
| IP-AC04 | 服務／API 測試：驗證跨 Plan 多項目 Task 僅作廢受影響項目、舊 Snapshot／結果／照片可查找、其他項目保持有效、Task 回到 `IN_PROGRESS`；DRAFT Task 原位更新；封存中拒絕修改且唯讀，取消封存後重算狀態再成功。 |
| IP-AC05 | 服務／API 測試：選「不要」後比對 Snapshot 文字更新且 Task 狀態、結果與照片不變，稽核含選擇者及時間。 |
| IP-AC06 | 權限整合測試：非指派但有專案現場權限的成員可操作；實際操作者欄位記錄該成員。 |
| IP-AC07 | 狀態機整合測試：零 Task 維持 `DRAFT`；`DRAFT` Task 阻止 Plan 完成，可刪除但不可取消且現場不可見；已完成 Plan 新增草稿 Task 後回 `IN_PROGRESS`；派出後才可取消，取消保留結果／照片與取消前狀態，恢復原狀態；完成不可取消；全取消且至少一筆成為 `CANCELLED`，已有完成且其餘取消則 `COMPLETED`。 |
| IP-AC08 | 狀態機整合測試：封存各有效 Plan 狀態後確認所屬 Task 唯讀；取消封存後依目前 Task 狀態重算有效狀態，不直接還原封存前狀態。`state-machines` 同步後再對照 PR #344 KD-56 與 Issue #346 追蹤的 PR #347。 |
| IP-AC09 | API／服務測試：P4 不存在結果或照片新增／更正端點，也不提供一般人工將 Task 從 `COMPLETED` 重開的端點；KD-55「不要」只更新 Snapshot 文字且狀態、結果、照片不變；KD-55「要」是明確系統例外，可使受影響的 `COMPLETED` Task 自動回 `IN_PROGRESS`。 |
| IP-AC10 | API 整合測試：權限、專案邊界、非法狀態輸入與共用錯誤格式。 |

## 考慮過但沒採用的做法

- **依 interval 自動切分任務**：MVP 已由 KD-36／G-01 定為不要求，任務由內業依專案項目建立。
- **以目前專案／範本資料即時組裝舊任務內容**：違反 PR-04 的任務需求快照；每個 Task 必須保有建立當時的 Snapshot。
- **直接覆寫已建立任務的 Snapshot**：KD-55 只允許「不要重新查核」時更正任務文字，並保留結果、照片與狀態；此例外需留下操作者、時間與內容紀錄。
- **已完成 Task 重新開啟**：KD-56 不允許重新開啟已完成 Task。KD-55 標準變更是明確的系統例外：受影響的已完成 Task 自動回到 `IN_PROGRESS`，只使相關項目的結果／照片作廢以重新查核；不提供一般人工重開 Task 的端點。此規則待 Issue #346 追蹤的 PR #347 合併後同步。
