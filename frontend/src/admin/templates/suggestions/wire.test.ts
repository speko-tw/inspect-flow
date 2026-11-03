import { describe, expect, it } from 'vitest'

import {
  detailResponse,
  IDS,
  revisionResponse,
  summaryResponse,
} from './fixtures'
import {
  detailView,
  revisionView,
  summaryView,
  type ReviewResponse,
} from './wire'

const review: ReviewResponse = {
  id: 'review-1',
  revision_id: 'rev-1',
  decision: 'RETURNED',
  reason: '請補充照片',
  approved_template_id: null,
  approved_template_title: null,
  target_category_id: null,
  target_category_name: null,
  target_system_id: null,
  target_system_name: null,
  reviewer_id: IDS.wuUser,
  reviewer_name: '吳經理',
  reviewed_at: '2026-10-31T02:00:00Z',
}

describe('真回應與畫面模型的邊界', () => {
  it('退回原因按 review_id 連結，與狀態歷程保持獨立', () => {
    const wire = revisionResponse(1, {
      reviews: [review],
      transitions: [
        {
          from_status: 'PENDING',
          to_status: 'RETURNED',
          operator_id: IDS.wuUser,
          operator_name: '吳經理',
          created_at: review.reviewed_at,
          review_id: review.id,
          audit_log_id: 'audit-1',
        },
        {
          from_status: 'RETURNED',
          to_status: 'PENDING',
          operator_id: IDS.linUser,
          operator_name: '林小姐',
          created_at: '2026-10-31T03:00:00Z',
          review_id: null,
          audit_log_id: 'audit-2',
        },
      ],
    })
    expect(wire).not.toHaveProperty('events')
    expect(revisionView(wire).events).toEqual([
      expect.objectContaining({
        status: 'RETURNED',
        reason: '請補充照片',
        actor_name: '吳經理',
      }),
      expect.objectContaining({
        status: 'PENDING',
        reason: null,
        actor_name: '林小姐',
      }),
    ])
  })

  it('平面詳情的目前修訂與先前退回版次由真歷程對照', () => {
    const first = revisionView(
      revisionResponse(1, {
        reviews: [review],
        transitions: [
          {
            from_status: 'PENDING',
            to_status: 'RETURNED',
            operator_id: IDS.wuUser,
            operator_name: '吳經理',
            created_at: review.reviewed_at,
            review_id: review.id,
            audit_log_id: 'audit-1',
          },
        ],
      }),
    )
    const second = revisionView(revisionResponse(2))
    const wire = detailResponse({
      current_revision_id: second.id,
      revision_no: 2,
      latest_review: review,
      return_reason: '請補充照片',
    })
    expect(wire).not.toHaveProperty('current_revision')
    expect(summaryView(wire).latest_return?.revision_no).toBeNull()
    const view = detailView(wire, [first, second])
    expect(view.current_revision).toBe(second)
    expect(view.latest_return).toMatchObject({
      revision_no: 1,
      reason: '請補充照片',
      reviewer_name: '吳經理',
    })
    expect(() => detailView(wire, [first])).toThrow('目前修訂不在歷程中')
  })

  it('核准保留目的地與名稱快照，已刪除範本不產生失效連結或捏造序號', () => {
    const view = summaryView(
      summaryResponse({
        status: 'APPROVED',
        approved_template_id: null,
        approval: {
          ...review,
          decision: 'APPROVED',
          reason: null,
          approved_template_id: 'deleted-template',
          approved_template_title: '核准當時名稱',
          target_category_name: '建築',
          target_system_name: '鋼筋',
        },
      }),
    )
    expect(view.approval).toMatchObject({
      template_id: null,
      template_title: '核准當時名稱',
      category_name: '建築',
      system_name: '鋼筋',
      sequence: null,
    })
  })
})
