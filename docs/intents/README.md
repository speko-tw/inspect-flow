# 設計意圖文件（Design Intents）

InspectFlow 要把工程現場查核從「照片、檢查表事後人工彙整」串成一個完整閉環系統；本資料夾把來源的架
構討論稿蒸餾成給實作者看的規範性結論——一條規則一句話，附理由與來源引註。

## 核心意圖一覽

一旦做錯，之後很難補救的規則：

1. 任務建立當下就把需求凍結成快照，之後範本怎麼改都不影響舊任務 → [PR-04](02-principles.md#pr-04)
2. 報告是版本化快照，已核發版次不能覆蓋，只能發新版次 → [PR-06](02-principles.md#pr-06)
3. 證據照片不能就地覆寫，原圖必須永久保留，編輯只能產生新版本 → [PR-05](02-principles.md#pr-05)
4. 前端一律經後端 API 存取資料，能不能完成永遠由後端覆核一次 → [PR-01](02-principles.md#pr-01)
5. 照片不進資料庫，只存 metadata；儲存鍵由後端產生，不用原始檔名 → [PR-02](02-principles.md#pr-02)
6. 資料庫存取與結構演進只能走 SQLAlchemy／Alembic，不能手動改 schema → [PR-03](02-principles.md#pr-03)
7. 主要 entity 一律用 UUID，業務編號另外存，兩者不可混用 → [KD-07](03-decisions-and-stack.md#kd-07)
8. 備份必須涵蓋資料庫、照片與報表，且要回到同一個時間點 → [PR-12](02-principles.md#pr-12)

## 文件索引

| 檔案 | 這份回答什麼 |
|---|---|
| [01-overview.md](01-overview.md) | InspectFlow 要解決什麼、服務誰、第一階段做到哪、整體架構長怎樣。 |
| [02-principles.md](02-principles.md) | 每次改動都要對照檢查的設計原則（PR-xx）。 |
| [03-decisions-and-stack.md](03-decisions-and-stack.md) | 已拍板的關鍵決策（KD-xx）與技術棧選型。 |
| [04-glossary.md](04-glossary.md) | 名詞對照：中文說法 ↔ 系統實體名。 |
| [05-open-questions.md](05-open-questions.md) | 待決議（OQ-xx）與來源矛盾／缺漏（G-xx）。 |

## 任務 → 要讀的條目

| 要做什麼 | 先讀 |
|---|---|
| 規劃新功能，確認是否屬第一階段範圍 | [01-overview.md](01-overview.md) |
| 寫程式前檢查有沒有違反設計原則 | [02-principles.md](02-principles.md) |
| 改報表欄位或版面 | [PR-06](02-principles.md#pr-06)、[PR-15](02-principles.md#pr-15)、[KD-05](03-decisions-and-stack.md#kd-05)、[G-06/G-07](05-open-questions.md#g-06) |
| 新增證據類型（NUMBER／SIGNATURE 等） | [OQ-20](05-open-questions.md#oq-20)、[PR-09](02-principles.md#pr-09) |
| 選或換技術棧套件 | [03-decisions-and-stack.md](03-decisions-and-stack.md) |
| 命名或資料模型問題 | [04-glossary.md](04-glossary.md) |
| 部署／上線流程 | [PR-13](02-principles.md#pr-13)、[PR-14](02-principles.md#pr-14)、[KD-09](03-decisions-and-stack.md#kd-09)、[OQ-18](05-open-questions.md#oq-18) |
| 遇到看似矛盾或未定案的地方 | [05-open-questions.md](05-open-questions.md) |

## 用語

- 規範用語：**必須**＝來源明確拍板，違反算架構問題；**應**＝來源建議的預設做法，偏離要有理由；
  **得**＝來源列為選項，或留待團隊決定。
- 狀態：**已決定**＝已拍板可直接照做；**暫定（待團隊確認）**＝本資料夾為釐清落差所作的暫定判讀；
  **待決議**＝來源留待團隊拍板，或來源內部矛盾，不能自行假設答案。

凍結 Domain Model／API 契約前，先看 [05-open-questions.md](05-open-questions.md) 的開工門檻清單。
