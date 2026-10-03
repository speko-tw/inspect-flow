# 查核計畫與任務（inspection-planning）：實作計畫

**規格**：[spec.md](spec.md)

本計畫依草稿拆分工作。負責人已於 2026-10-03 裁定 IP-Q02/Q05/Q06/Q09/Q10；Issue #343 是追蹤 issue，其後續 intents PR 尚待合併，且 `state-machines` 尚未同步。本計畫不代表規格凍結；實作 task 開立前仍須依最新已合併來源確認規則及責任檔案。

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1 | 定義 P4 `ProjectInspectionItem` 擴充欄位、Plan、Task、多項目關聯、每項 Snapshot 及 KD-55 修改紀錄資料結構；建立 migration 與資料庫約束 | `backend/app/models/`、`backend/alembic/versions/`、`backend/tests/db/` | `template-system`、`domain-model`、`database-foundation`；檢視 #343 對應 intents PR 合併結果及同步後的 `state-machines` | IP-AC02～IP-AC05 | 待開 |
| T2 | 實作 Plan／Task／Snapshot 服務層、派出／取消／恢復及衍生狀態；集中登記本功能權限代碼，並在 audit-log 事件目錄登記 `project_inspection_item.updated`、`inspection_task.cancelled`、`inspection_task.restored` 事件及可稽核欄位。Task 實際查核人存領域欄位 | `backend/app/services/`、`backend/tests/services/`、`backend/app/permission_codes.py`、`docs/specs/audit-log/spec.md` | T1、`authentication`、`state-machines`；開發前核對 #343 對應 intents PR 合併後的 KD 及同步後狀態機；若 TPL 實作已登記 `project_inspection_item.edit`，沿用而不重複新增 | IP-AC03～IP-AC09 | 待開 |
| T3 | 實作 Plan／Task／專案項目修改 API，含權限檢查、UUID、分頁、錯誤契約及快照讀寫 | `backend/app/api/`、`backend/app/schemas/`、`backend/tests/api/` | T1、T2、`api-conventions` | IP-AC01～IP-AC10 | 待開 |
| T4 | 建立內業 Plan 管理、手動建立多項目 Task、派出／取消／恢復操作與任務建議指派 UI；草稿 Task 僅內業可見 | `frontend/src/features/`、`frontend/src/routes/`、`frontend/tests/` | T3；確認 #343 對應 intents PR 合併後的 KD 與 `state-machines` 契約 | IP-AC01、IP-AC02、IP-AC06～IP-AC08 | 待開 |
| T5 | 建立專案查核項目修改確認介面，說明重新查核後果，提交 KD-55 選擇並呈現 Snapshot 更正、舊 Task 作廢及自動建立重查 Task 的結果 | `frontend/src/features/`、`frontend/tests/` | T3；IP-Q07／IP-Q08 依 SM-Q03 技術設計；檢視多項目 Task 對重查的影響 | IP-AC04、IP-AC05、IP-AC08 | 待開 |
| T6 | 端到端驗收快照隔離、修改影響範圍、權限、指派非排他性、自動 Plan 狀態與歷史保存，補文件及索引收尾 | `backend/tests/`、`frontend/tests/`、`docs/specs/inspection-planning/`、`docs/specs/README.md` | T1～T5；受影響規則均已裁定 | IP-AC01～IP-AC10 | 待開 |

- 每個 task issue 開立前，應將路徑清單縮到具體檔案，並依共用 migration、model registry、router、API client 等實際重疊情況調整責任界線。
- 所有 AC 至少由一個 task 涵蓋；IP-Q 業務裁定已完成，但須待 Issue #343 對應的 intents PR 合併並同步 `state-machines` 後確認最終實作依據。本規格草稿本身不代表凍結。
- 任務按專案查核項目手動建立；本計畫不包含依 interval、起訖點或間距自動切分任務。

## 並行分組

依檔案責任與資料相依分波。下列為初步安排，具體檔案清單須在開 task 前再檢查；Alembic migration 鏈是共用檔案，每波最多一支 migration，並按 [共用檔案規則](../README.md#parallel) 處理。

- 第 1 波：T1（資料模型與 migration；獨占 migration 鏈及相關 model registry）。
- 第 2 波：T2（服務、權限與狀態行為；依賴 T1）。
- 第 3 波：T3（API 與 schema；依賴 T1、T2）。
- 第 4 波：T4 與 T5（前端；只有路由、共用 client 與 feature 檔案責任確認不重疊時才並行，否則依序）。
- 第 5 波：T6（跨端驗收與文件收尾；依賴 T1～T5）。

## 風險

- **意圖尚未合併**：IP-Q02、IP-Q05、IP-Q06、IP-Q09、IP-Q10 已由負責人裁定，但寫入 intents 的 Issue #343 仍開放，尚待其後續 intents PR 合併；正式實作前須核對合併後 KD 與 `state-machines`。
- **狀態機不同步**：本次負責人裁定允許任何狀態封存、Task 草稿後派出、取消與恢復及 Plan `CANCELLED`；目前 `state-machines` 草稿仍只列 `COMPLETED ↔ ARCHIVED`。本規格依新裁定描述，待 #343 對應的 intents PR 合併後同步 state-machines；此處不宣稱其已更新或凍結。
- **Task 組成**：負責人已裁定一個 Task 得含多個項目；關聯表或明細表、各項 Snapshot 結構仍為規格設計，可能影響 KD-55 重查時新 Task 的項目組成。
- **快照結構與更正**：Snapshot 必須保存建立時需求；KD-55 的「不要」重新查核是明確更正例外，需確保結果、照片與狀態不變且有可追溯紀錄。欄位採明確欄位或關聯子表為**規格設計（非負責人裁定）**，實作前確認不破壞歷史追溯。
- **專案項目修改範圍**：KD-55 只影響同專案使用該項次的任務；若跨 Plan，必須確保查全所有關聯，而不是只查目前頁面或目前 Plan。
- **取消與完成判定**：未完成 Task 可取消並可恢復，完成 Task 不可取消；至少一筆 Task 且所有 Task 均取消時 Plan 為 `CANCELLED`，零筆 Task 維持 `DRAFT`，有完成且其餘取消時為 `COMPLETED`。須在 #343 對應 intents PR 合併及 state-machines 同步後確認一致。
- **報告與 Evidence 範圍**：KD-55 對作廢資料保存與已發出報告的要求，不等於 G-05／G-06／G-07 已裁定；不可在本規格自行補足 Evidence 刪除或 Report 狀態政策。
- **共用檔案競爭**：Plan／Task models、router 註冊、權限表及 migration 都可能與其他 P4 工作重疊；開 task 時需依最新 main 及 issue 狀態確認，不以本草稿推定可同波。

## 驗證（Proof）

每條 AC 的實際命令與證據應在對應實作 PR 記錄；純文件規格草稿階段不執行產品驗收。

| AC | 驗證方式 |
|---|---|
| IP-AC01 | API 整合測試：授權與拒絕任意狀態輸入；跨專案存取測試。 |
| IP-AC02 | API／服務測試：內業建立含多個明選項目的 Task 與只含單項的 Task；確認建立後為草稿且現場不可見，沒有 interval 仍可建立，也不自動切分任務。 |
| IP-AC03 | 服務／資料庫測試：建立 Task 後修改 Template 與 ProjectInspectionItem，確認 Snapshot 仍為建立時內容。 |
| IP-AC04 | 服務／API 測試：未封存 Plan 時驗證跨 Plan 相關 Task 作廢、歷史保留、自動建立重查 Task 且可搜尋；另以受影響 Plan 已封存情境驗證原請求拒絕且資料不變，取消封存後重送成功。 |
| IP-AC05 | 服務／API 測試：選「不要」後比對 Snapshot 文字更新且 Task 狀態、結果與照片不變，稽核含選擇者及時間。 |
| IP-AC06 | 權限整合測試：非指派但有專案現場權限的成員可操作；實際操作者欄位記錄該成員。 |
| IP-AC07 | 狀態機整合測試：零 Task 的 Plan 維持 `DRAFT`；草稿 Task 派出後才對現場可見、首筆派出使 Plan 進行中；未開始／進行中可取消且保留結果照片、恢復原狀態，已完成不可取消；全取消成為 `CANCELLED`，已有完成且其餘取消則為 `COMPLETED`。 |
| IP-AC08 | 狀態機整合測試：分別以 `DRAFT`、`IN_PROGRESS`、`COMPLETED`、`CANCELLED` Plan 封存及取消封存，確認皆可封存且恢復原狀態。依 #343 對應 intents PR 合併後的 KD 及同步後 state-machines 規格驗收。 |
| IP-AC09 | API／服務測試：P4 不存在結果或照片新增／更正端點，也不能由 `COMPLETED` 轉出；KD-55「不要」只更新 Snapshot 文字且狀態、結果、照片不變。 |
| IP-AC10 | API 整合測試：權限、專案邊界、非法狀態輸入與共用錯誤格式。 |

## 考慮過但沒採用的做法

- **依 interval 自動切分任務**：MVP 已由 KD-36／G-01 定為不要求，任務由內業依專案項目建立。
- **以目前專案／範本資料即時組裝舊任務內容**：違反 PR-04 的任務需求快照；每個 Task 必須保有建立當時的 Snapshot。
- **直接覆寫已建立任務的 Snapshot**：KD-55 只允許「不要重新查核」時更正任務文字，並保留結果、照片與狀態；此例外需留下操作者、時間與內容紀錄。
- **已完成 Task 重新開啟**：KD-56 不允許；資料修正依 KD-42 維持完成，重新查核依 KD-55 保留作廢 Task 並由系統建立新 Task，依 SM-Q03 標示為技術設計。
