import { request } from '../api'

/**
 * IP-R11（流程摘要）的下一步代碼、待辦數與是否待處理；首頁主要
 * 動作取後端的 primary_step，不自行由 count 推導（ADM-R16）。
 */
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

/**
 * IP-R11（流程摘要）的摘要與有效權限；task_counts_visible 為
 * false 時任務數字固定回 0，畫面不得當成真的 0 顯示（ADM-R16）。
 */
export interface WorkflowSummary {
  project: {
    id: string
    project_code: string
    name: string
    /** DOM-R76：登記表中的角色值；標籤由前端依角色清單對應。 */
    company_role: string
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
