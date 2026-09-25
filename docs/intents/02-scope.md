# 範圍（Scope）

第一階段（MVP）承諾完成什麼、明確排除什麼，以及哪些能力是「延後」而非「排除」。

## 第一階段 / MVP 範圍

第一階段的目標是完成一個完整閉環，而不是打造大平台（依據：架構基準 §1）：

```text
後台建立查核工作 → 指定工程師與內容 → 現場工程師查看今日任務 → 拍照/填寫說明
→ 系統驗證必要證據 → 完成確認 → 後台儀表板彙整 → 產出正式報告
```

架構基準文件以開發階段順序具體定義了這個範圍（依據：架構基準 §30）：

- **Phase 0 — Repository / Skeleton**：專案骨架、健康檢查端點。
- **Phase 1 — Database Foundation**：SQLAlchemy + Alembic + SQLite；`User`、`Project`、`Template`、
  `TemplateVersion`。
- **Phase 2 — Authentication**：登入 / 登出 / 目前使用者 / 角色。
- **Phase 3 — Template System**：`Template`、`TemplateVersion`、`TemplateItem`、`EvidenceRequirement`。
- **Phase 4 — Inspection Planning**：`InspectionPlan`、`InspectionTask`、任務需求快照，並由起訖點與
  間距自動產生任務。
- **Phase 5 — Field UI**：今日任務、任務詳情、證據檢查清單、狀態。
- **Phase 6 — Photo Upload & Field Evidence Editor**：拍照、非破壞式編輯、上傳、儲存、Evidence 紀錄。
- **Phase 7 — Task Completion Validation**：必要證據 vs. 已上傳證據的伺服器端驗證。
- **Phase 8 — Admin Dashboard**：今日工作量、完成數／完成率、工程師與專案進度。
- **Phase 9 — Formal Report Delivery**：Report View Model → DOCX 範本 → DOCX 產出 → PDF 轉換 →
  版本／核發控管。MVP 的完成條件明確要求同時具備 DOCX **與** PDF 輸出，而不只是儀表板可視化
  （依據：架構基準 §20.22、§30 Phase 9）。
- **Phase 10 — Pilot Deployment**：單一 Linux 伺服器、Docker Compose、HTTPS、持久化儲存。

一個版本要被視為「可部署」，必須滿足 §22A.20 的完整 Deployment Definition of Done，包括 DOCX／PDF 可
產出、重啟後資料不消失等條件（依據：架構基準 §22A.20）。

### MVP 的證據類型邊界

MVP 的 Evidence Type **必須**僅限 `PHOTO` 與 `TEXT`，除非團隊明確擴大範圍；資料模型雖預留了
`NUMBER`、`BOOLEAN`、`SIGNATURE`、`DOCUMENT`，但這只是預留欄位，不代表這些類型是目前的交付項目
（依據：架構基準 §12.6、§38 Evidence/Result）。

### 目前的運作前提（屬第一階段基準，非永久限制）

第一階段的運作前提為：Online-first、單一後端 host、SQLite + WAL、本機持久化照片／報告儲存、單一
React 專案（Admin／Field 以路由區分）、Linux 伺服器 + Docker Compose
（依據：架構基準 §3、§5.1–5.3、§9、§22.1–22.7）。這些是第一階段的部署決策，不是永久上限；對應的演進
條件見 [04-key-decisions.md](04-key-decisions.md)（KD-08 SQLite、KD-09 Docker Compose、KD-12 單一前端
專案）。

## 明確排除的非目標（第一階段）

架構基準文件明確指出第一階段**不是**：

- 一套龐大的工程 ERP，也不是一次到位的完整工程生命週期管理平台（依據：架構基準 §1）。

為避免過度工程化，第一階段明確不做以下項目（依據：架構基準 §34）：

```text
Microservices                    Data Warehouse
Kubernetes                       Elasticsearch
Kafka                            Advanced BI
Redis Cluster                    多區域 HA
GraphQL                          自動 AI 圖像判定
Complex Event Sourcing           複雜 Workflow BPM
Distributed Transaction          完整 Offline Sync Engine
```

架構基準文件特別強調這是排序決定，不是對這些技術的負面評價：「不是因為這些技術不好，而是目前沒有必
要」（依據：架構基準 §34）。

## 延後但不排除的能力

架構刻意保留以下能力的擴充空間；它們是被排序延後的能力，不是被否決的能力
（依據：架構基準 §35、§1、§10、§22.7、§33）：

```text
離線模式 / 完整 Offline Sync              NCR / 缺失（Defect）追蹤
QR Code 掃描                             Re-inspection（複查）
GPS                                      Approval Workflow（簽核流程）
EXIF                                     Push Notification
數位簽章 / Electronic Approval            Audit Trail（完整事件記錄）
Voice Note（語音備註）                    WBS 整合
文件上傳                                  Drawing Linkage（圖說關聯）
影片                                      Material / Equipment Linkage
PostgreSQL（取代 SQLite）                 MinIO / S3 / NAS（取代本機儲存）
Corporate SSO
```

其中兩項是架構明確設計為「不需改變 API contract 即可演進」的結構性遷移路徑：SQLite → PostgreSQL，以
及 Local Storage → MinIO/S3（依據：架構基準 §10、§32、§33）。觸發這兩項遷移的條件見
[04-key-decisions.md](04-key-decisions.md)（KD-08、KD-02）。

## 架構占位（placeholder）與業務決策的界線

哪些是「架構已經固定的骨架」、哪些是「業務資料還沒定案」，界線如下：實際的專案／人員／地點／工項欄
位、範本規則與每點所需照片數、查核結果（Result）語意、報表最終版面、簽核與編號流程，都留待未來的
Domain / Data Model 規格與 Pilot 階段拍板，本文件不代其決定
（依據：架構基準 §0、§12、§38–39）。這些未定案項目完整列於
[06-open-questions.md](06-open-questions.md)，請勿把架構基準文件裡的「範例」誤讀為已定案欄位。
