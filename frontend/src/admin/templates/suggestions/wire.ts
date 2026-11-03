import type {
  SuggestionApproval,
  SuggestionDetail,
  SuggestionEvent,
  SuggestionReturn,
  SuggestionRevision,
  SuggestionStatus,
  SuggestionSummary,
} from './api'
import type { SuggestionContent } from './content'

/** TPL-R32：後端不可變審核的原始回應，不把它混成狀態歷程。 */
export interface ReviewResponse {
  id: string
  revision_id: string
  decision: 'RETURNED' | 'APPROVED'
  reason: string | null
  approved_template_id: string | null
  approved_template_title: string | null
  target_category_id: string | null
  target_category_name: string | null
  target_system_id: string | null
  target_system_name: string | null
  reviewer_id: string
  reviewer_name: string
  reviewed_at: string
}

/** TPL-R32：狀態歷程另外連到 review 與 audit；沒有虛構的 events 欄位。 */
export interface TransitionResponse {
  from_status: SuggestionStatus | null
  to_status: SuggestionStatus
  operator_id: string
  operator_name: string
  created_at: string
  review_id: string | null
  audit_log_id: string
}

/** 真實 revisions 分頁中的單筆修訂。 */
export interface RevisionResponse {
  id: string
  suggestion_id: string
  revision_no: number
  based_on_revision_id: string | null
  content: SuggestionContent
  content_sha256: string
  editor_id: string
  editor_name: string
  created_at: string
  status: SuggestionStatus
  reviews: ReviewResponse[]
  transitions: TransitionResponse[]
}

/** 真實清單回應；時間與人名均由授權內的後端投影提供。 */
export interface SummaryResponse {
  id: string
  status: SuggestionStatus
  proposer_id: string
  proposer_name: string
  source_project_id: string
  source_project_name: string
  source_item_id: string | null
  source_item_title: string
  title: string
  current_revision_id: string
  revision_no: number
  content_sha256: string
  last_editor_id: string
  last_editor_name: string
  last_submitted_at: string
  return_reason: string | null
  latest_review: ReviewResponse | null
  approval: ReviewResponse | null
  approved_template_id: string | null
  first_submitted_at: string
  created_at: string
  updated_at: string
}

/** 詳情及所有寫入的真回應是主件摘要加 content，沒有 current_revision。 */
export interface DetailResponse extends SummaryResponse {
  content: SuggestionContent
}

/** 後端提供差異判定；前端僅把 before／after 格式化為使用者可讀文字。 */
export interface DifferenceResponse {
  kind: 'added' | 'removed' | 'modified' | 'reordered'
  entity: 'item' | 'inspection_point' | 'measurement_field'
  logical_id: string | null
  parent_logical_id: string | null
  before: unknown
  after: unknown
}

/** 比較端點的版本摘要不包含整份狀態歷程。 */
export type ComparisonVersion = Pick<
  RevisionResponse,
  'id' | 'revision_no' | 'content' | 'editor_id' | 'editor_name' | 'created_at'
>

export interface ComparisonResponse {
  from_revision: ComparisonVersion
  to_revision: ComparisonVersion
  changes: DifferenceResponse[]
}

/** 把真實 transitions／reviews 合併成畫面用事件，審核原因按 review_id 對應。 */
export function revisionView(row: RevisionResponse): SuggestionRevision {
  const reviews = new Map(row.reviews.map((review) => [review.id, review]))
  const events: SuggestionEvent[] = row.transitions.map((transition) => ({
    status: transition.to_status,
    actor_id: transition.operator_id,
    actor_name: transition.operator_name,
    reason: transition.review_id
      ? (reviews.get(transition.review_id)?.reason ?? null)
      : null,
    created_at: transition.created_at,
  }))
  return {
    id: row.id,
    revision_no: row.revision_no,
    based_on_revision_id: row.based_on_revision_id,
    content: row.content,
    editor_id: row.editor_id,
    editor_name: row.editor_name,
    created_at: row.created_at,
    events,
  }
}

/** 清單不額外搬完整歷程，未投影的受審版次留空，不能猜成目前版本。 */
export function summaryView(row: SummaryResponse): SuggestionSummary {
  const review = row.latest_review
  const latestReturn: SuggestionReturn | null = row.return_reason
    ? {
        reason: row.return_reason,
        revision_no:
          review?.decision === 'RETURNED' &&
          review.revision_id === row.current_revision_id
            ? row.revision_no
            : null,
        reviewer_name:
          review?.decision === 'RETURNED' ? review.reviewer_name : '',
        returned_at:
          review?.decision === 'RETURNED' ? review.reviewed_at : null,
      }
    : null
  const approval: SuggestionApproval | null = row.approval
    ? {
        template_id: row.approved_template_id,
        template_title: row.approval.approved_template_title ?? '',
        category_name: row.approval.target_category_name ?? '',
        system_name: row.approval.target_system_name ?? '',
        sequence: null,
        revision_no:
          row.approval.revision_id === row.current_revision_id
            ? row.revision_no
            : null,
        reviewer_name: row.approval.reviewer_name,
        reviewed_at: row.approval.reviewed_at,
      }
    : null
  return { ...row, latest_return: latestReturn, approval }
}

/** 畫面 current_revision 與歷史版次均由真 revisions 對照，並非伺服器欄位。 */
export function detailView(
  row: DetailResponse,
  revisions: SuggestionRevision[],
): SuggestionDetail {
  const current = revisions.find(
    (revision) => revision.id === row.current_revision_id,
  )
  if (!current) throw new Error('目前修訂不在歷程中，請重新載入。')
  const summary = summaryView(row)
  const returned = [...revisions]
    .reverse()
    .flatMap((revision) =>
      revision.events
        .filter((event) => event.status === 'RETURNED')
        .map((event) => ({ revision, event })),
    )[0]
  if (returned)
    summary.latest_return = {
      reason: returned.event.reason ?? '',
      revision_no: returned.revision.revision_no,
      reviewer_name: returned.event.actor_name,
      returned_at: returned.event.created_at,
    }
  return { ...summary, current_revision: current }
}
