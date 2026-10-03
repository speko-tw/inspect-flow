# 查核計畫與任務（inspection-planning）：實作計畫

**規格**：[spec.md](spec.md)

本計畫依草稿拆分工作，尚不能據此開始實作未定業務轉換。待 IP-Q 題目裁定、OQ-09 阻擋邊界確認及規格凍結後，工程師應依實際責任檔案更新各 task 的檔案清單與依賴。

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1 | 定義 P4 `ProjectInspectionItem` 擴充欄位、Plan、Task、Snapshot 及 KD-55 修改紀錄資料結構；建立 migration 與資料庫約束。技術欄位待規格凍結後確定 | `backend/app/models/`、`backend/alembic/versions/`、`backend/tests/db/` | `template-system`、`domain-model`、`database-foundation` | IP-AC02～IP-AC05 | 待開 |
| T2 | 實作 Plan／Task／Snapshot 的服務層、授權與自動狀態判定；僅涵蓋已凍結狀態規則，未裁定取消／派出／重查路徑不得實作 | `backend/app/services/`、`backend/tests/services/` | T1、`authentication`、`state-machines`；IP-Q 裁定 | IP-AC03～IP-AC09 | 待開 |
| T3 | 實作 Plan／Task／專案項目修改 API，含權限檢查、UUID、分頁、錯誤契約及快照讀寫 | `backend/app/api/`、`backend/app/schemas/`、`backend/tests/api/` | T1、T2、`api-conventions` | IP-AC01～IP-AC10 | 待開 |
| T4 | 建立內業 Plan 管理、手動建立任務與任務建議指派 UI；只提供已凍結的操作與狀態 | `frontend/src/features/`、`frontend/src/routes/`、`frontend/tests/` | T3；介面與權限契約凍結 | IP-AC01、IP-AC02、IP-AC06～IP-AC08 | 待開 |
| T5 | 建立專案查核項目修改確認介面，說明重新查核後果，提交 KD-55 選擇並呈現更正或作廢結果 | `frontend/src/features/`、`frontend/tests/` | T3；IP-Q07／IP-Q08 裁定 | IP-AC04、IP-AC05、IP-AC08 | 待開 |
| T6 | 端到端驗收快照隔離、修改影響範圍、權限、指派非排他性、自動 Plan 狀態與歷史保存，補文件及索引收尾 | `backend/tests/`、`frontend/tests/`、`docs/specs/inspection-planning/`、`docs/specs/README.md` | T1～T5；受影響規則均已裁定 | IP-AC01～IP-AC10 | 待開 |

- 每個 task issue 開立前，應將路徑清單縮到具體檔案，並依共用 migration、model registry、router、API client 等實際重疊情況調整責任界線。
- 所有 AC 至少由一個 task 涵蓋；IP-AC08 是待決題守門條件，須在相應業務題裁定前保持不可凍結／不可實作狀態。
- 任務按專案查核項目手動建立；本計畫不包含依 interval、起訖點或間距自動切分任務。

## 並行分組

依檔案責任與資料相依分波。下列為初步安排，具體檔案清單須在開 task 前再檢查；Alembic migration 鏈是共用檔案，每波最多一支 migration，並按 [共用檔案規則](../README.md#parallel) 處理。

- 第 1 波：T1（資料模型與 migration；獨占 migration 鏈及相關 model registry）。
- 第 2 波：T2（服務、權限與狀態行為；依賴 T1）。
- 第 3 波：T3（API 與 schema；依賴 T1、T2）。
- 第 4 波：T4 與 T5（前端；只有路由、共用 client 與 feature 檔案責任確認不重疊時才並行，否則依序）。
- 第 5 波：T6（跨端驗收與文件收尾；依賴 T1～T5）。

## 風險

- **OQ-09 未定狀態轉換**：Plan 草稿／就緒、Task 取消來源狀態、取消後恢復、全數取消的 Plan 狀態與「尚未查核」語意仍待決；不可將狀態機草稿中的技術提案當成已核准行為。
- **任務派出定義**：KD-56 以「任務派出」觸發 Plan 進入進行中，具體何時派出尚未定義。須先裁定 IP-Q09，否則可能過早改變 Plan 狀態與現場可見性。
- **Task 分組規則**：一個項目是否對應一個 Task 尚未由負責人裁定；此選擇會影響資料模型、完成判定與 KD-55 影響範圍。先裁定 IP-Q02 再定 schema。
- **快照結構與更正**：Snapshot 必須保存建立時需求；KD-55 的「不要」重新查核是明確更正例外，需確保結果、照片與狀態不變且有可追溯紀錄。欄位採明確欄位或關聯子表為**規格設計（非負責人裁定）**，實作前確認不破壞歷史追溯。
- **專案項目修改範圍**：KD-55 只影響同專案使用該項次的任務；若跨 Plan，必須確保查全所有關聯，而不是只查目前頁面或目前 Plan。
- **取消與完成判定**：取消任務不計入完成判定已裁定，但全數取消時 Plan 終態未知；實作前須取得 IP-Q05／IP-Q06 裁定。
- **報告與 Evidence 範圍**：KD-55 對作廢資料保存與已發出報告的要求，不等於 G-05／G-06／G-07 已裁定；不可在本規格自行補足 Evidence 刪除或 Report 狀態政策。
- **共用檔案競爭**：Plan／Task models、router 註冊、權限表及 migration 都可能與其他 P4 工作重疊；開 task 時需依最新 main 及 issue 狀態確認，不以本草稿推定可同波。

## 驗證（Proof）

每條 AC 的實際命令與證據應在對應實作 PR 記錄；純文件規格草稿階段不執行產品驗收。

| AC | 驗證方式 |
|---|---|
| IP-AC01 | API 整合測試：授權與拒絕任意狀態輸入；跨專案存取測試。 |
| IP-AC02 | API／服務測試：手動選取項目建任務；沒有 interval 仍可建立，不產生額外任務。 |
| IP-AC03 | 服務／資料庫測試：建立 Task 後修改 Template 與 ProjectInspectionItem，確認 Snapshot 仍為建立時內容。 |
| IP-AC04 | 服務／API 測試：以未開始、進行中及已完成 Task 驗證只作廢使用受改項次的任務，保留歷史與修改紀錄。 |
| IP-AC05 | 服務／API 測試：選「不要」後比對結果、照片、狀態不變，文字按裁定更新且有操作者／時間紀錄。 |
| IP-AC06 | 權限整合測試：非指派但有專案現場權限的成員可操作；實際操作者欄位記錄該成員。 |
| IP-AC07 | 狀態機整合測試：任務派出、自動完成及 KD-55 作廢後退回進行中；用戶端不能直接完成 Plan。 |
| IP-AC08 | 規格審查對照 OQ-09、IP-Q05／IP-Q06：裁定前不得新增未核准轉換或以其作為實作驗收。 |
| IP-AC09 | 服務測試：完成後更正不改 Task 狀態、不要求重做完成流程。 |
| IP-AC10 | API 整合測試：權限、專案邊界、非法狀態輸入與共用錯誤格式。 |

## 考慮過但沒採用的做法

- **依 interval 自動切分任務**：MVP 已由 KD-36／G-01 定為不要求，任務由內業依專案項目建立。
- **以目前專案／範本資料即時組裝舊任務內容**：違反 PR-04 的任務需求快照；每個 Task 必須保有建立當時的 Snapshot。
- **直接覆寫已建立任務的 Snapshot**：KD-55 只允許「不要重新查核」時更正任務文字，並保留結果、照片與狀態；此例外需留下操作者、時間與內容紀錄。
- **已完成 Task 重新開啟**：KD-56 不允許；資料修正依 KD-42 維持完成，重新查核依 KD-55 作廢並另依 IP-Q07 確認後續任務方式。
