# 設計意圖文件（Design Intents）

**這份文件回答**：設計意圖文件要怎麼讀，做不同任務時先看哪些條目？
**什麼時候讀**：第一次接觸 InspectFlow，或準備修改功能、資料模型與部署流程時。

InspectFlow 管理規劃、現場查核、證據與正式報告。本目錄整理可執行的規則、理由與來源引註（依據：架構基準 §0.1、§1）。

## 核心意圖一覽

以下規則一旦做錯，日後很難補救：

1. 草稿任務可隨來源項目同步或重建，派出後需求快照固定，之後範本或專案怎麼改都不影響已派出任務 → [PR-04](02-principles.md#pr-04)
2. 報告是版本化快照；已核發版次不得覆蓋，需要重新產生時應建立新版次 → [PR-06](02-principles.md#pr-06)
3. 證據照片只保存現場版與內業版兩張，不存原圖；刪除依任務完成與報告引用狀態管理 → [PR-05](02-principles.md#pr-05)、[KD-62](03-decisions-and-stack.md#kd-62)
4. 前端一律經後端 API 存取資料，能不能完成永遠由後端覆核一次 → [PR-01](02-principles.md#pr-01)
5. 照片不進資料庫，只存 metadata；儲存鍵由後端產生，不用原始檔名 → [PR-02](02-principles.md#pr-02)
6. 資料庫存取與結構演進只能走 SQLAlchemy／Alembic，不能手動改 schema → [PR-03](02-principles.md#pr-03)
7. 主要 entity 一律用 UUID，業務編號另外存，兩者不可混用 → [KD-07](03-decisions-and-stack.md#kd-07)
8. 資料庫與照片必須配對備份；報表也納入同組還原是待確認的整合決策 → [PR-12](02-principles.md#pr-12)、[G-10](05-open-questions.md#g-10)

## 文件索引

| 檔案 | 這份回答什麼 |
|---|---|
| [01-overview.md](01-overview.md) | InspectFlow 要解決什麼、服務誰、第一階段做到哪、整體架構長怎樣。 |
| [02-principles.md](02-principles.md) | 每次改動都要對照檢查的設計原則（PR-xx）。 |
| [03-decisions-and-stack.md](03-decisions-and-stack.md) | 關鍵決策（KD-xx）與技術棧選型。 |
| [04-glossary.md](04-glossary.md) | 名詞對照：中文說法 ↔ 系統實體名。 |
| [05-open-questions.md](05-open-questions.md) | 仍待決議的議題（OQ-xx）、來源矛盾／缺漏（G-xx）與開工門檻。 |
| [06-versioning-and-milestone-governance.md](06-versioning-and-milestone-governance.md) | InspectFlow 的版本號、GitHub Milestone 規則，以及 Issue／PR 的版本歸屬判斷。 |
| [07-permission-model.md](07-permission-model.md) | 兩層權限模型：模組怎麼分工、判斷順序、導覽可見性與帳號設定、預建角色與成員指派、外部協作人員、開專案流程、權限表、新模組接入規則與委派。 |

## 任務 → 要讀的條目

| 要做什麼 | 先讀 |
|---|---|
| 規劃新功能，確認是否屬第一階段範圍 | [01-overview.md](01-overview.md) |
| 開始寫規格或計畫、拆 task、規格要改 | [docs/specs/README.md](../specs/README.md) |
| 寫程式前檢查有沒有違反設計原則 | [02-principles.md](02-principles.md) |
| 設計重大新畫面或改版 | [PR-19](02-principles.md#pr-19)、[KD-70](03-decisions-and-stack.md#kd-70)、[原型與試用流程](../specs/README.md#ui-prototype-gate) |
| 改報表欄位或版面 | [PR-06](02-principles.md#pr-06)、[PR-15](02-principles.md#pr-15)、[KD-05](03-decisions-and-stack.md#kd-05)、[G-06](05-open-questions.md#g-06)、[G-07](05-open-questions.md#g-07)、[OQ-07](05-open-questions.md#oq-07) |
| 新增證據類型（NUMBER／SIGNATURE 等） | [KD-53](03-decisions-and-stack.md#kd-53)、[PR-09](02-principles.md#pr-09) |
| 選或換技術棧套件 | [03-decisions-and-stack.md](03-decisions-and-stack.md) |
| 命名或名詞問題 | [04-glossary.md](04-glossary.md)、[KD-71](03-decisions-and-stack.md#kd-71) |
| 設計或凍結資料模型、API 契約 | [05-open-questions.md 開工門檻](05-open-questions.md#gate)、[G-06](05-open-questions.md#g-06)、[G-07](05-open-questions.md#g-07) |
| 部署／上線流程 | [PR-13](02-principles.md#pr-13)、[PR-14](02-principles.md#pr-14)、[KD-09](03-decisions-and-stack.md#kd-09)、[OQ-18](05-open-questions.md#oq-18) |
| 人員、公司、角色與權限相關功能 | [07-permission-model.md](07-permission-model.md)、[PR-18](02-principles.md#pr-18)、[KD-17](03-decisions-and-stack.md#kd-17)、[KD-19](03-decisions-and-stack.md#kd-19)～[KD-29](03-decisions-and-stack.md#kd-29)、[KD-43](03-decisions-and-stack.md#kd-43)～[KD-46](03-decisions-and-stack.md#kd-46)、[KD-69](03-decisions-and-stack.md#kd-69)、[KD-71](03-decisions-and-stack.md#kd-71) |
| 登入、登入狀態與密碼 | [KD-21](03-decisions-and-stack.md#kd-21)、[KD-30](03-decisions-and-stack.md#kd-30)、[KD-31](03-decisions-and-stack.md#kd-31)、[KD-43](03-decisions-and-stack.md#kd-43)、[KD-45](03-decisions-and-stack.md#kd-45)、[認證與授權](03-decisions-and-stack.md#stack-auth) |
| 遇到看似矛盾或未定案的地方 | [05-open-questions.md](05-open-questions.md) |

## 用語

- 規範用語：**必須**＝來源明確拍板，違反算架構問題；**應**＝來源建議的預設做法，偏離要有理由；
  **得**＝來源列為選項，或留待團隊決定。
- 狀態：**已決定**＝已拍板可直接照做；**已採用**＝技術棧卡片所述工具或做法已在現行實作使用，與「已決定」表示決策定案有別；**暫定（待團隊確認）**＝本資料夾為釐清落差所作的暫定判讀；
  **待決議**＝來源留待團隊拍板，或來源內部矛盾，不能自行假設答案。

凍結 Domain Model／API 契約前，先看 [05-open-questions.md](05-open-questions.md) 的開工門檻清單。
