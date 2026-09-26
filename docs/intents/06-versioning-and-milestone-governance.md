# 版本與 Milestone 治理（Versioning and Milestone Governance）

**這份文件回答**：InspectFlow 的版本號、GitHub Milestone、Issue 與 Pull Request 的版本歸屬規則是什麼？既有歷史 Issue／PR 的 Milestone 要怎麼整理？
**什麼時候讀**：規劃版本／Roadmap、建立或修改 Issue／PR 的 Milestone、判斷一項工作該歸屬哪個版本系列，或執行既有 GitHub metadata 的版本遷移時。

## 目的

本文件定義 InspectFlow 的版本號、GitHub Milestone、Issue 與 Pull Request 的版本歸屬，以及既有歷史資料的整理方式。

InspectFlow 在正式發布 `1.0.0` 前，會持續以 `0.x.x` 發展。版本號不代表開發週數、Issue 數量或 PR 數量，而代表產品能力與成熟度。

本文件的核心目標是：

1. 讓版本號可以表達 InspectFlow 已經具備哪些產品能力。
2. 讓 GitHub Milestone 成為產品 Roadmap，而不是單純的 Issue 分組。
3. 讓 Issue、Pull Request、Spec、Decision 與 Release 之間具有一致且可追溯的關係。
4. 讓人與 Agent 都可以依相同規則判斷工作應屬於哪一個版本。
5. 讓既有歷史 Issue / PR 可以逐步整理，不需要一次性大規模修改。
6. 在 `1.0.0` 前建立清楚、可持續演進的產品成熟路徑。

**狀態：已決定。**

**依據：負責人決定（2026-09-26）。**

---

## 1. 核心原則

### 1.1 版本號代表產品能力，不代表時間

InspectFlow 的版本號不得直接以：

- 開發週次
- Sprint 編號
- Issue 數量
- PR 數量
- Commit 數量

決定。

版本號應表示系統已經達成的產品能力階段。

例如：

```text
0.1.x  Core Foundation
0.2.x  Identity & Access
0.3.x  Template System
0.4.x  Inspection Planning
...
```

因此看到一個版本號時，應可以大致理解當時 InspectFlow 已經具備哪些主要能力。

---

<a id="phase-vs-milestone"></a>
### 1.2 Phase 與 Milestone 是不同概念

`docs/specs/README.md` 裡的 Phase 與 GitHub Milestone 不得混為一談。

#### Phase

Phase 表達：

> 功能與架構的實作順序、相依關係及產品生命週期位置。

例如：

```text
P3 Template System
P4 Inspection Planning
P6 Field Evidence
P9 Report Delivery
```

#### Milestone

Milestone 表達：

> 哪一個版本系列應該交付這項能力。

例如：

```text
0.3.x Template System
0.4.x Inspection Planning
0.6.x Evidence
0.9.x Formal Report
```

大部分 Phase 與 Milestone 會自然對齊，但共享 Domain Model、State Machine、Infrastructure 或 Decision Issue 可能跨越多個 Phase。

因此：

> **不得只依 Phase 編號機械式決定 Milestone。**

應依「這項工作主要交付什麼能力」判斷。

---

## 2. 正式版號規則

InspectFlow 在正式 `1.0.0` 前採用：

```text
0.MINOR.PATCH
```

例如：

```text
0.1.0
0.2.0
0.2.1
0.3.0
0.9.2
0.10.0
```

注意：

```text
0.10.0
```

是 `0.9.x` 之後的下一個 Minor 系列，不是小數點意義上的 `0.10`。

---

### 2.1 MINOR：產品能力階段

第二個數字 `MINOR` 代表新的主要產品能力階段。

例如：

```text
0.1.x → Core Foundation
0.2.x → Identity & Access
0.3.x → Template System
```

當新的主要產品能力開始形成時：

```text
0.2.x
↓
0.3.x
```

而不是持續增加：

```text
0.2.8
0.2.9
0.2.10
```

來代表新產品階段。

---

### 2.2 PATCH：既有能力的修正與補強

第三個數字 `PATCH` 用於同一產品能力階段內：

- Bug fix
- Validation 補強
- 安全性修正
- 文件修正
- 相容性修正
- 小型 UX 改善
- 不改變主要產品能力範圍的重構

例如：

```text
v0.2.0
v0.2.1
v0.2.2
```

都屬於 Identity & Access 系列。

---

### 2.3 PATCH 不應偷偷帶入新的主要能力

例如 `0.2.x` 定義為 Identity & Access。

新增完整 Inspection Template System 時，不應發布：

```text
v0.2.4
```

而應進入：

```text
v0.3.0
```

同樣地，已發布版本中的外部契約若需要重大行為改變，也不應假裝成一般 Patch。

---

## 3. GitHub Milestone 與 Release Tag 分離

GitHub Milestone 使用：

```text
0.MINOR.x
```

例如：

```text
0.1.x
0.2.x
0.3.x
0.4.x
```

Git tag / GitHub Release 才使用完整版本：

```text
v0.2.0
v0.2.1
v0.2.2
```

因此：

```text
GitHub Milestone
0.2.x
    │
    ├── Issue
    ├── Issue
    ├── Issue
    └── PR
         │
         ▼
主要能力完成
         │
         ▼
GitHub Release
v0.2.0
         │
         ├── fixes
         ▼
v0.2.1
```

GitHub Milestone 中的 `x` 是版本系列的 wildcard 概念，不是實際發布版號。

---

## 4. InspectFlow Pre-1.0 Roadmap

### 4.1 0.1.x — Core Foundation

#### 目標

建立整個 InspectFlow 可以安全持續開發的基礎。

#### 主要範圍

- Repository skeleton
- Agent / Git / PR workflow
- CI
- Backend / Frontend 基礎
- API conventions
- Database foundation
- SQLAlchemy
- Alembic
- SQLite / PostgreSQL compatibility
- UUID / UTC / error envelope 等共用規則
- `User`
- `Company`
- `Project`
- 共用 audit / timestamp 基礎
- Repository governance
- Documentation governance

#### 不包含

完整 Authentication、Role / Permission 等產品能力。

---

### 4.2 0.2.x — Identity & Access

#### 目標

讓 InspectFlow 具有真正可以登入並判斷「誰可以做什麼」的能力。

#### 主要範圍

- Login
- Logout
- Current User
- Server-managed Session
- HttpOnly Cookie
- Password hashing
- Password management
- Account activation
- Role
- ProjectMember
- Permission
- Access enforcement
- Current operator
- Admin rules
- Initialization account
- Login lockout / authentication hardening

Domain Model 中直接服務 Authentication / Authorization 的部分，即使來源規格屬共用 Domain Model，也應歸入 `0.2.x`。

---

### 4.3 0.3.x — Template System

#### 目標

建立可版本化、可重製、可供未來 Inspection Task 固定需求的查核範本系統。

#### 主要範圍

- Inspection Template
- Template Version
- Template Item
- Evidence Requirement
- Template CRUD
- Template versioning
- Template publication semantics
- Evidence Requirement 定義
- 與 Template 直接相關的決策

---

### 4.4 0.4.x — Inspection Planning

#### 目標

可以建立真正的工程查核計畫與任務。

#### 主要範圍

- Inspection Plan
- Inspection Task
- Assignment
- 起點 / 終點 / interval
- Task generation
- Task Requirement Snapshot
- Plan / Task state
- 任務指派
- Template Version 固定

---

### 4.5 0.5.x — Field UI

#### 目標

現場工程師可以使用手機或平板完成日常查核工作的基本導航與操作。

#### 主要範圍

- `/field/*`
- 今日任務
- Task list
- Task detail
- Evidence checklist
- Mobile / Tablet UX
- Authentication integration
- Field routing
- 基礎 PWA-ready 結構

本階段不要求完整 Evidence 上傳與影像編輯能力。

---

### 4.6 0.6.x — Evidence

#### 目標

完成工程查核證據的建立、保存、追溯與非破壞式影像處理。

#### 主要範圍

- Photo upload
- Text evidence
- Original Evidence
- Evidence Variant
- Storage abstraction
- Crop
- Rotate
- Brightness
- Zoom / Pan preview
- Edited Variant
- Hash
- Upload retry
- Idempotency
- File size policy
- Evidence deletion / retention policy

---

### 4.7 0.7.x — Completion Validation

#### 目標

由 Server 判斷 Inspection Task 是否真的符合完成條件。

#### 主要範圍

- Required Evidence validation
- Task Requirement Snapshot validation
- Result
- PASS / FAIL / N/A 等語意
- Completion
- Reopen / correction semantics
- Server-side completion enforcement
- Missing evidence handling

---

### 4.8 0.8.x — Admin Dashboard

#### 目標

提供內業人員管理與監控工程查核工作的介面。

#### 主要範圍

- 今日工作量
- 完成數
- 完成率
- Project progress
- Engineer progress
- Read-only overview
- Admin management views
- Dashboard query API

`Dashboard` 是管理工具，不是正式工程交付物。

---

### 4.9 0.9.x — Formal Report

#### 目標

完成 InspectFlow 最重要的正式交付能力。

#### 主要範圍

- Report View Model
- Versioned Report Template
- DOCX
- PDF
- Document Number
- Revision
- Template Version
- Generated By
- Generated Time
- Data Snapshot
- SHA-256
- Report state machine
- Report layout
- Issue / approval semantics
- Issued document immutability

DOCX / PDF 是正式交付物；Dashboard 不取代 Report。

---

### 4.10 0.10.x — Pilot Deployment

#### 目標

讓完整 InspectFlow 可以在真實 Pilot 環境被部署、重啟、備份與復原。

#### 主要範圍

- Linux Server
- Docker Engine
- Docker Compose
- Reverse Proxy
- HTTPS
- Persistent Storage
- Database migration deployment flow
- Backup
- Restore
- Health Check
- Smoke Test
- Server sizing
- Disk monitoring
- Deployment documentation

---

### 4.11 0.11.x — Pilot Hardening & Release Readiness

#### 目標

把「功能完成」提升成「實際可以交付」。

#### 主要範圍

- Pilot feedback
- Bug fixing
- Performance
- Security hardening
- Operational hardening
- Browser / mobile compatibility
- Backup / restore verification
- Report correctness verification
- Deployment reliability
- UX correction
- Documentation completion
- Release readiness

本階段不應刻意新增大型產品能力。

---

## 5. 1.0.0 的定義

`1.0.0` 不因開發時間到了而發布。

InspectFlow 必須完成完整業務閉環：

```text
Project / User / Permission
        ↓
Inspection Template
        ↓
Inspection Plan
        ↓
Inspection Task
        ↓
Field Inspection
        ↓
Evidence
        ↓
Completion Validation
        ↓
Dashboard
        ↓
Report Snapshot
        ↓
DOCX / PDF
        ↓
Pilot Deployment
        ↓
Backup / Restore
```

並完成至少一次具代表性的 Pilot 驗證。

只有在：

- 核心流程可實際使用
- 正式 DOCX / PDF 可產生
- 重要資料可追溯
- 已核發報告不可被靜默覆蓋
- Deployment Definition of Done 通過
- Backup / Restore 經驗證
- 沒有阻擋正式使用的已知 Critical 問題
- Pilot 已完成必要修正

時，才發布：

```text
v1.0.0
```

如果 `0.11.x` 結束仍未達到上述條件，可以繼續：

```text
0.12.x
0.13.x
...
```

不得為了版本號好看而強迫發布 `1.0.0`。

---

## 6. Milestone 的正式用途

Milestone 回答：

> 這項工作最晚應該在哪一個產品能力版本系列完成？

Milestone 不代表：

- Sprint
- 開發者
- Priority
- Effort
- Issue 狀態

這些資訊已有其他 GitHub 原生欄位負責。

---

<a id="issue-milestone-rules"></a>
## 7. Issue 的 Milestone 判斷規則

### 7.1 Implementation Issue

實作 Issue 應歸到：

> 它主要交付的產品能力所屬版本。

例如：

```text
Add login, logout and current user API
→ 0.2.x
```

```text
Add Template Version
→ 0.3.x
```

```text
Generate DOCX and PDF reports
→ 0.9.x
```

---

### 7.2 Decision Issue

`needs-decision` Issue 仍然必須有 Milestone。

它應歸到：

> 最早會因為這個決策未完成而無法完成的版本系列。

例如：

```text
Permission code naming
→ 0.2.x
```

```text
Inspection interval ownership
→ 0.3.x
```

因為 Template System 已經會受到影響。

```text
Report snapshot timing
→ 0.9.x
```

---

### 7.3 Blocked Issue

`blocked` 與 Milestone 是兩件不同的事情。

即使一個 Issue 被擋住：

```text
blocked
```

它仍應保持它真正所屬的 Milestone。

不得因為目前無法實作就把它留在錯誤版本。

---

### 7.4 Spec / Plan Issue

撰寫特定功能 Spec / Plan 的 Issue，跟著該能力的 Milestone。

例如：

```text
Write template-system spec and plan
→ 0.3.x
```

```text
Write report-delivery spec and plan
→ 0.9.x
```

---

### 7.5 Repository / Workflow / Governance

跨產品能力的基礎治理工作，如果屬於整個開發基礎，歸：

```text
0.1.x
```

例如：

- AGENTS.md governance
- Issue / PR metadata rules
- CI foundation
- Review guidelines
- Version governance

但若 Infrastructure 明確服務 Pilot Deployment，例如 Docker Compose、Production HTTPS、Backup，則應歸：

```text
0.10.x
```

---

## 8. Cross-cutting Issue 的處理

若一個 Issue 同時涵蓋多個版本系列，先判斷：

> 它是否真的可以作為一個單一任務完成？

若答案是否定的，應拆分 Issue，而不是硬塞進一個 Milestone。

例如一個 State Machine Issue 同時要求：

- TemplateVersion
- Inspection Plan
- Inspection Task
- Evidence
- Report

而 Report 決策要到 `0.9.x` 才能完成，卻因此阻擋 `0.4.x` 的 Inspection Task，這表示 Issue 的範圍可能過大。

原則：

> **Milestone 模糊通常是 Scope 模糊的訊號。**

若無法合理拆分，則暫時使用：

> 最早無法在缺少該 Issue 的情況下完成的版本系列。

但應把這種情況列入 migration audit，由人確認是否需要後續拆分。

---

<a id="pr-milestone"></a>
## 9. Pull Request 的 Milestone

PR 原則上必須與它所關閉的 Issue 使用同一個 Milestone。

```text
Issue #151 → 0.2.x
PR #xxx    → 0.2.x
```

如果 Issue 的 Milestone 在 PR 合併前被修改，PR 也必須同步。

---

### 9.1 PR 關閉一個 Issue

直接繼承該 Issue 的 Milestone。

---

### 9.2 PR 關閉多個 Issue

若所有 Issue 都屬於同一 Milestone，使用該 Milestone。

若跨 Milestone：

1. 先檢查 PR 是否範圍過大。
2. 歷史資料無法拆分時，以主要交付能力判定。
3. 無法明確判定時，不得猜測，列入人工檢查。

---

### 9.3 沒有 Issue 的歷史 PR

依序參考：

1. PR title
2. PR body
3. changed files
4. 相關 Spec
5. 相關 commit
6. 最接近的產品能力

判定 Milestone。

仍無法可靠判斷時標記為：

```text
NEEDS_REVIEW
```

不得任意分類。

---

## 10. Milestone 與 Priority / Effort 分離

Milestone 表達：

> 哪個產品版本需要它。

Priority 表達：

> 現在有多重要。

Effort 表達：

> 工作量大約多少。

例如：

```text
Milestone: 0.9.x
Priority: High
Effort: Medium
```

完全合理。

不得因為一個 Issue Priority 很高，就把它搬到較早的 Milestone。

---

## 11. GitHub Milestone 名稱

正式使用：

```text
0.1.x
0.2.x
0.3.x
0.4.x
0.5.x
0.6.x
0.7.x
0.8.x
0.9.x
0.10.x
0.11.x
```

暫時不設定 Due Date。

Due Date 只有在團隊真的有交付日期承諾時才設定。

---

## 12. Milestone 建議描述

### 0.1.x

```text
Core Foundation — repository governance, CI, API conventions,
database foundation and core domain entities required for all later work.
```

### 0.2.x

```text
Identity & Access — authentication, sessions, users, roles,
project membership, permissions and authorization enforcement.
```

### 0.3.x

```text
Template System — versioned inspection templates, template items
and evidence requirements.
```

### 0.4.x

```text
Inspection Planning — plans, tasks, assignment, automatic task
generation and requirement snapshots.
```

### 0.5.x

```text
Field UI — mobile/tablet field workflow, task navigation and
inspection checklist experience.
```

### 0.6.x

```text
Evidence — photo/text evidence, uploads, storage and non-destructive
image editing.
```

### 0.7.x

```text
Completion Validation — server-side completion rules, results and
task completion semantics.
```

### 0.8.x

```text
Admin Dashboard — operational monitoring, project progress and
engineer workload views.
```

### 0.9.x

```text
Formal Report — versioned DOCX/PDF generation, snapshots, revisions
and issued-document governance.
```

### 0.10.x

```text
Pilot Deployment — Linux/Docker Compose deployment, HTTPS,
persistent storage, backup, restore and operational verification.
```

### 0.11.x

```text
Pilot Hardening & Release Readiness — pilot feedback, reliability,
security, performance and preparation for the first production release.
```

---

## 13. 既有 GitHub Metadata Migration

本治理規則生效後，既有 Issue 與 PR 必須逐步重新整理。

範圍包含：

- Open Issues
- Closed Issues
- Open PRs
- Closed PRs
- Merged PRs

不因為 Issue / PR 已經關閉，就保留錯誤 Milestone。

歷史 metadata 也是專案歷史的一部分，應保持一致。

---

## 14. Migration 安全原則

Milestone migration 是 metadata 整理。

除非另有 Issue 指示，Agent 在執行時不得修改：

- Issue title
- Issue body
- Issue state
- PR title
- PR body
- PR state
- Assignee
- Labels
- Priority
- Effort
- Commit
- Branch
- Code

原則上只修改：

```text
Milestone
```

不得為了修改 Milestone：

- reopen closed issue
- close open issue
- reopen PR
- 修改歷史 commit

---

## 15. Agent Migration Workflow

Migration 不應一次修改整個 repository。

必須採：

```text
Inventory
↓
Dry Run
↓
Batch Update
↓
Verification
↓
Next Batch
```

---

### 15.1 Step 1 — 確認治理文件已進 main

Agent 開始 migration 前必須確認：

```text
docs/intents/06-versioning-and-milestone-governance.md
```

已經存在於 `main`。

未合併前不得開始大規模修改歷史 metadata。

---

### 15.2 Step 2 — 確認 Milestone

確認以下 Milestone 都存在：

```text
0.1.x
0.2.x
0.3.x
0.4.x
0.5.x
0.6.x
0.7.x
0.8.x
0.9.x
0.10.x
0.11.x
```

已存在者不得重複建立。

未知或既有其他 Milestone 不得直接刪除。

---

### 15.3 Step 3 — Inventory 所有 Issue

使用 GitHub API 或 `gh` 取得：

- number
- title
- state
- labels
- current milestone
- body
- closedAt
- URL

例如：

```bash
gh issue list \
  --repo speko-tw/inspect-flow \
  --state all \
  --limit 1000 \
  --json number,title,state,milestone,labels,body,closedAt,url
```

不得只處理目前 open issue。

---

### 15.4 Step 4 — Inventory 所有 PR

取得：

- number
- title
- state
- mergedAt
- body
- current milestone
- linked / closing Issue
- changed files（需要時）

例如：

```bash
gh pr list \
  --repo speko-tw/inspect-flow \
  --state all \
  --limit 1000 \
  --json number,title,state,mergedAt,milestone,body,url
```

---

## 16. Dry Run

修改 GitHub 前，Agent 必須先建立分類表：

```text
Type | Number | State | Current | Proposed | Reason
```

例如：

| Type | Number | State | Current | Proposed | Reason |
|---|---:|---|---|---|---|
| Issue | #151 | open | 0.1.x | 0.2.x | Authentication T3 |
| Issue | #108 | open | 0.1.x | 0.9.x | Report Delivery |
| PR | #164 | merged | 0.1.x | 0.2.x | Frontend login |
| PR | #170 | merged | 0.1.x | 0.1.x | Company foundation |

若：

```text
Current == Proposed
```

不得產生無意義 update。

---

## 17. Migration 分批策略

每一批建議最多：

```text
10～20 個 GitHub objects
```

不得一次修改數百筆後才驗證。

建議順序：

#### Batch A — Foundation

```text
0.1.x
```

#### Batch B — Identity & Access

```text
0.2.x
```

#### Batch C — Template / Planning

```text
0.3.x
0.4.x
```

#### Batch D — Field

```text
0.5.x
0.6.x
0.7.x
```

#### Batch E — Admin / Report

```text
0.8.x
0.9.x
```

#### Batch F — Deployment / Hardening

```text
0.10.x
0.11.x
```

#### Batch G — Historical PR parity

確認歷史 PR 與所屬 Issue 的 Milestone 一致。

---

## 18. Issue 更新方式

例如：

```bash
gh issue edit 151 \
  --repo speko-tw/inspect-flow \
  --milestone "0.2.x"
```

修改後立即重新讀取確認。

---

## 19. PR 更新方式

例如：

```bash
gh pr edit 164 \
  --repo speko-tw/inspect-flow \
  --milestone "0.2.x"
```

若 CLI 對歷史 PR 的 Milestone 操作受限，可以透過 GitHub Issue REST API 更新。

GitHub REST 中 Pull Request 同時也是 Issue，因此可修改其 milestone metadata。

Agent 必須使用 GitHub 回傳的 Milestone ID，不得自行猜數字。

---

## 20. 每批驗證

每批完成後重新讀取該批所有 objects。

必須確認：

```text
expected milestone == actual milestone
```

若其中一筆失敗：

1. 不要直接繼續大量修改。
2. 記錄失敗 object。
3. 找出原因。
4. 修正後再繼續下一批。

---

## 21. 不確定項目的處理

若 Agent 無法可靠判斷：

```text
Issue / PR → Milestone
```

不得自行猜測。

加入：

```text
NEEDS_REVIEW
```

清單。

最後交由負責人決定。

通常以下情況需要人工判斷：

- 一個 Issue 同時涵蓋多個主要產品能力
- 一個 PR 關閉不同 Milestone 的多個 Issue
- 歷史 PR 沒有 Issue，也沒有足夠描述
- 純 refactor 無法判斷主要能力
- 大型 cross-cutting spec 同時被早期與晚期版本依賴

---

## 22. Migration 完成條件

Migration 完成後必須符合：

- 所有 Open Issue 都有正確 Milestone。
- 所有 Closed Issue 都有合理的歷史 Milestone。
- 所有 Open PR 都與所屬 Issue Milestone 一致。
- 所有 Merged / Closed PR 都完成歷史整理。
- `needs-decision` Issue 有版本歸屬。
- `blocked` Issue 有版本歸屬。
- 不再把所有工作集中到 `0.1.x`。
- PR 與 Issue 沒有可解釋不了的 Milestone mismatch。
- 所有無法判斷的項目都有 `NEEDS_REVIEW` 清單。
- 沒有因 migration 改變 Issue / PR state。

---

## 23. Migration 完成報告

Agent 完成後應產生：

```markdown
## Milestone Migration Summary

| Milestone | Issues | PRs |
|---|---:|---:|
| 0.1.x | ... | ... |
| 0.2.x | ... | ... |
| 0.3.x | ... | ... |
| ... | ... | ... |

### Updated
- Issues: ...
- PRs: ...

### Unchanged
- Issues: ...
- PRs: ...

### Needs Review
- #...
- #...

### Errors
- None
```

Migration Issue 最後只需要一則完整 summary，不需要對每個歷史 Issue 留言，避免 notification spam。

---

## 24. 未來新 Issue 的規則

建立 Issue 時，Agent 必須依序判斷：

```text
這個 Issue 主要交付什麼能力？
        ↓
這個能力屬於哪一個版本系列？
        ↓
設定 Milestone
```

不得單純使用：

```text
目前正在做 0.2.x
→ 所有新 Issue 都放 0.2.x
```

例如開發 Authentication 時發現未來 Report 的問題：

```text
Report snapshot semantics
→ 0.9.x
```

而不是因為現在正在開發 Authentication 就放進 `0.2.x`。

---

## 25. 未來新 PR 的規則

PR 建立時：

```text
PR Milestone = Closing Issue Milestone
```

若不同：

Agent 應在 PR 建立或自審時修正。

---

## 26. Roadmap 不應僵化

本文件定義的是目前可預見的 Pre-1.0 Roadmap。

未來如果發現需要新的主要能力，可以新增：

```text
0.12.x
0.13.x
```

但新增一個新的 MINOR 系列必須回答：

> 這是一個什麼新的產品能力階段？

不得只是因為：

> 0.11 用完了。

---

## 27. 何時修改本文件

以下情況需要修改本 Intent：

- 改變 MINOR / PATCH 的定義
- 改變 Milestone 與 Release 的關係
- 改變 `1.0.0` 定義
- 新增或重新切分主要產品能力階段
- 改變 Issue / PR Milestone 歸屬規則

單純：

- 新增 Issue
- 完成 Issue
- 發布 Patch
- Bug fix

不需要修改本文件。

---

## 28. Agent 操作契約

當 Agent 被要求整理 InspectFlow 的版本與 Milestone 時：

1. 先讀本文件。
2. 再讀 `docs/specs/README.md`。
3. Inventory 所有相關 Issue / PR。
4. 先產生 dry-run mapping。
5. 依產品能力分類，不依建立日期分類。
6. Decision 使用「最早被它阻擋的能力」判定。
7. PR 優先繼承 Closing Issue Milestone。
8. Cross-cutting scope 不清楚時不得猜測。
9. 每批最多修改約 10～20 個 objects。
10. 每批修改後重新讀取驗證。
11. 不得在 migration 過程改動 Issue / PR state。
12. 最後輸出 Migration Summary。

這套流程同時適用：

- 現在的 repository 整理
- 未來 metadata audit
- 新 Agent 加入專案
- 新版本系列規劃

---

## 29. 與其他文件的關係

本文件負責：

```text
Version
Release family
Milestone
Issue / PR version ownership
Historical milestone migration
```

`docs/specs/README.md` 負責：

```text
Spec
Plan
Task
Phase
Issue / PR workflow
```

`AGENTS.md` 負責：

```text
Agent operating rules
Git workflow
Human gates
```

三者不得重複定義彼此的完整規則。

其他文件需要使用版本治理時，應連結本文件，而不是複製一份規則。

---

## 30. 最終意圖

InspectFlow 的版本號應回答：

> 這個版本已經具備哪些產品能力？

GitHub Milestone 應回答：

> 這項工作屬於哪一個產品能力版本？

Issue 應回答：

> 這次要完成哪一件事情？

Pull Request 應回答：

> 這次實際改了什麼，並完成哪個 Issue？

讓：

```text
Intent
  ↓
Spec
  ↓
Plan
  ↓
Issue
  ↓
PR
  ↓
Milestone
  ↓
Release
```

形成一條一致、可查詢、可追溯並能持續演進的產品開發鏈。
