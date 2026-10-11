import { request } from '../api'

/** IP-R11 的下一步代碼與待辦數，供首頁選唯一主要動作。 */
export interface WorkflowStep {
  code:
    | 'add_members'
    | 'add_inspection_items'
    | 'create_plan'
    | 'dispatch_draft_tasks'
    | 'complete_reinspection'
  count: number
  pending: boolean
}

/** 首頁可導向的下一步代碼。 */
export type WorkflowStepCode = WorkflowStep['code']

/** IP-R11 的摘要與有效權限；任務數字不可見時不得以零代替。 */
export interface WorkflowSummary {
  project: {
    id: string
    project_code: string
    name: string
  }
  member_count: number
  inspection_item_count: number
  zone_count: number
  plan_count: number
  task_counts: {
    DRAFT: number
    PENDING: number
    IN_PROGRESS: number
    COMPLETED: number
    CANCELLED: number
  }
  pending_reinspection_task_count: number
  next_steps: WorkflowStep[]
  primary_step: WorkflowStepCode | null
  task_counts_visible: boolean
  draft_tasks_missing_assignee: number
  viewer_permission_codes: string[]
}

/** 讀取專案流程摘要；非成員或無摘要讀取權限時由後端拒絕。 */
export function getWorkflowSummary(
  projectId: string,
): Promise<WorkflowSummary> {
  return request(`/projects/${projectId}/workflow-summary`)
}
