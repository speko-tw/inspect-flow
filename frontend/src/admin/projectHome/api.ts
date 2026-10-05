import { request } from '../api'

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

export type WorkflowStepCode = WorkflowStep['code']

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

export function getWorkflowSummary(
  projectId: string,
): Promise<WorkflowSummary> {
  return request(`/projects/${projectId}/workflow-summary`)
}
