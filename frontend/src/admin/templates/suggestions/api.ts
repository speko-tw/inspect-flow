import { request } from '../../api'
import type { SuggestionContent } from './content'

// 範本建議 API 用戶端（TPL-R29～R36「資料與 API」）。
//
// 後端 T16（#803）、T17（#804）尚未合併，下列型別與端點依
// spec.md 的 API 契約撰寫；欄位名稱在 #803／#804 合併後以真 API 核對。
// 只有以下幾處是規格沒有逐字定義、由前端暫定的契約，核對時優先檢查：
//   - 審核清單 `status=ALL` 代表「完整歷程」（規格只寫預設 PENDING 與
//     可切換各狀態）。
//   - 修訂回應內的 `events`、詳情的 `approval`／`latest_return`。
//   - 保存修訂無變更時（200）回傳原版，前端以回傳的修訂 ID 是否等於
//     `expected_revision_id` 判斷「內容沒有變更」。

/** TPL-R31 狀態機的四種狀態。 */
export type SuggestionStatus =
  'PENDING' | 'RETURNED' | 'APPROVED' | 'WITHDRAWN'

/** 修訂掛的狀態歷程（TPL-R32）：提交、退回、核准、撤回各一筆。 */
export interface SuggestionEvent {
  /** 轉換後的狀態。 */
  status: SuggestionStatus
  actor_id: string
  actor_name: string
  /** 退回原因；只有退回事件有值。 */
  reason: string | null
  created_at: string
}

/** TPL-R32：不可覆寫的修訂；`content` 是當版完整結構快照。 */
export interface SuggestionRevision {
  id: string
  revision_no: number
  based_on_revision_id: string | null
  content: SuggestionContent
  editor_id: string
  editor_name: string
  created_at: string
  /** 這一版對應的狀態歷程，依時間升冪。 */
  events: SuggestionEvent[]
}

/** TPL-R33 核准時保存的目的地與範本快照。 */
export interface SuggestionApproval {
  template_id: string | null
  template_title: string
  category_name: string
  system_name: string
  sequence: number | null
  revision_no: number
  reviewer_name: string
  reviewed_at: string
}

/** 退回事件摘要，供清單與詳情直接顯示最新退回原因。 */
export interface SuggestionReturn {
  reason: string
  revision_no: number
  reviewer_name: string
  returned_at: string
}

/** 本人清單與管理清單的每一筆。 */
export interface SuggestionSummary {
  id: string
  status: SuggestionStatus
  proposer_id: string
  proposer_name: string
  source_project_id: string
  source_project_name: string
  source_item_id: string | null
  source_item_title: string
  /** 最新版的項目名稱；名稱留白時為空字串。 */
  title: string
  current_revision_id: string
  revision_no: number
  /** 最新版是否由提議人以外的人（管理者）保存。 */
  last_editor_id: string
  last_editor_name: string
  /** 最近一次送審時間；待審清單依此降冪。 */
  last_submitted_at: string
  latest_return: SuggestionReturn | null
  approval: SuggestionApproval | null
}

/** 詳情：摘要加上最新版內容。 */
export interface SuggestionDetail extends SuggestionSummary {
  current_revision: SuggestionRevision
}

/** 游標分頁回應。 */
export interface SuggestionPage {
  items: SuggestionSummary[]
  next_cursor: string | null
}

/** 本人清單另回篩選後件數，不受頁次影響。 */
export interface MySuggestionPage extends SuggestionPage {
  total_count: number
}

/** 所有寫入都帶這兩個欄位，後端鎖定主列後檢查（409 changed）。 */
export interface Expected {
  expected_revision_id: string
  expected_status: SuggestionStatus
}

/** 本人清單的查詢條件（TPL-R34）。 */
export interface MySuggestionQuery {
  status?: SuggestionStatus
  source_project_id?: string
  cursor?: string | null
  limit?: number
}

/** 管理者清單的查詢條件（TPL-R33）。 */
export interface ReviewSuggestionQuery {
  /** 省略代表預設的待審；`ALL` 是完整歷程。 */
  status?: SuggestionStatus | 'ALL'
  cursor?: string | null
  limit?: number
}

function query(params: Record<string, string | number | null | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value))
    }
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

/** TPL-R29：從專案查核項目提出建議，建立即送審。 */
export function createSuggestion(
  projectId: string,
  projectInspectionItemId: string,
): Promise<SuggestionDetail> {
  return request(`/projects/${projectId}/template-suggestions`, {
    method: 'POST',
    body: JSON.stringify({
      project_inspection_item_id: projectInspectionItemId,
    }),
  })
}

/** TPL-R34：本人清單；`total_count` 是篩選後的本人件數。 */
export function listMySuggestions(
  params: MySuggestionQuery = {},
): Promise<MySuggestionPage> {
  return request(
    `/me/template-suggestions${query({
      status: params.status,
      source_project_id: params.source_project_id,
      cursor: params.cursor,
      limit: params.limit ?? 50,
    })}`,
  )
}

/** TPL-R33：管理者清單，只列曾送審件。 */
export function listReviewSuggestions(
  params: ReviewSuggestionQuery = {},
): Promise<SuggestionPage> {
  return request(
    `/template-suggestions${query({
      status: params.status,
      cursor: params.cursor,
      limit: params.limit ?? 50,
    })}`,
  )
}

/** TPL-R34：全部 PENDING 主件數，不受頁次與搜尋影響。 */
export function getPendingCount(): Promise<{ pending_count: number }> {
  return request('/template-suggestions:pending-count')
}

/** TPL-R36：本人或對曾送審件具 template.manage 者讀詳情；其餘回 404。 */
export function getSuggestion(id: string): Promise<SuggestionDetail> {
  return request(`/template-suggestions/${id}`)
}

/** 依 `revision_no` 升冪取完所有修訂（每頁 100 筆，沿用共用上限）。 */
export async function listRevisions(
  id: string,
): Promise<SuggestionRevision[]> {
  const items: SuggestionRevision[] = []
  let cursor: string | null = null
  do {
    const page: { items: SuggestionRevision[]; next_cursor: string | null } =
      await request(
        `/template-suggestions/${id}/revisions${query({
          limit: 100,
          cursor,
        })}`,
      )
    items.push(...page.items)
    cursor = page.next_cursor
  } while (cursor)
  return items
}

/** 兩版必須是相鄰修訂，否則後端回 422。 */
export function compareRevisions(
  id: string,
  fromRevisionId: string,
  toRevisionId: string,
): Promise<{ from: SuggestionRevision; to: SuggestionRevision }> {
  return request(
    `/template-suggestions/${id}/revisions:compare${query({
      from_revision_id: fromRevisionId,
      to_revision_id: toRevisionId,
    })}`,
  )
}

/** 不同內容回新修訂；內容沒有變更時後端回原版。 */
export function saveRevision(
  id: string,
  content: SuggestionContent,
  expected: Expected,
): Promise<SuggestionRevision> {
  return request(`/template-suggestions/${id}/revisions`, {
    method: 'POST',
    body: JSON.stringify({ content, ...expected }),
  })
}

/** TPL-R31：退回件修改後重送；須已有退回後的新版，且重查來源編輯權。 */
export function submitSuggestion(
  id: string,
  expected: Expected,
): Promise<SuggestionDetail> {
  return request(`/template-suggestions/${id}:submit`, {
    method: 'POST',
    body: JSON.stringify(expected),
  })
}

/** TPL-R31：本人撤回尚未核准的件，保留內容與歷程，本件不能再重送。 */
export function withdrawSuggestion(
  id: string,
  expected: Expected,
): Promise<SuggestionDetail> {
  return request(`/template-suggestions/${id}:withdraw`, {
    method: 'POST',
    body: JSON.stringify(expected),
  })
}

/** TPL-R32：管理者附原因退回；原因去空白後 1～1000 字元，否則 422。 */
export function returnSuggestion(
  id: string,
  reason: string,
  expected: Expected,
): Promise<SuggestionDetail> {
  return request(`/template-suggestions/${id}:return`, {
    method: 'POST',
    body: JSON.stringify({ reason, ...expected }),
  })
}

/**
 * TPL-R33：管理者核准並建立獨立範本。同名回 409 `template.name_conflict`，
 * 此時狀態與目的地都不變。
 */
export function approveSuggestion(
  id: string,
  target: { category_id: string; system_id: string },
  expected: Expected,
): Promise<SuggestionDetail> {
  return request(`/template-suggestions/${id}:approve`, {
    method: 'POST',
    body: JSON.stringify({ ...target, ...expected }),
  })
}

/** 各狀態件數：以狀態篩選取 `total_count`，limit=1 避免搬資料。 */
export async function getMyStatusCounts(
  sourceProjectId?: string,
): Promise<Record<SuggestionStatus, number>> {
  const statuses: SuggestionStatus[] = [
    'PENDING',
    'RETURNED',
    'APPROVED',
    'WITHDRAWN',
  ]
  const pages = await Promise.all(
    statuses.map((status) =>
      listMySuggestions({
        status,
        source_project_id: sourceProjectId,
        limit: 1,
      }),
    ),
  )
  return Object.fromEntries(
    statuses.map((status, index) => [status, pages[index].total_count]),
  ) as Record<SuggestionStatus, number>
}
