import { listAllPages, request } from '../api'
import type { TaskStatus } from '../projectItems/api'
import { HttpError, httpErrorMessage, isForbidden } from '../../http'

/**
 * 除 ARCHIVED（封存旗標，由 :archive 操作設定）外，其餘狀態
 * 由任務衍生，用戶端不得任意設定（IP-R06）。
 */
export type PlanStatus =
  'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'ARCHIVED'

/** 依 IP-R03 保留任務項目快照，依 IP-R04 標示待重查。 */
export interface TaskInspectionItem {
  id: string
  status: string
  needs_reinspection: boolean
  snapshots: Array<Record<string, unknown>>
  current_snapshot: {
    revision: number
    source_standard_revision: number
    title: string
    instruction: string
    source_template_name: string
    is_current: boolean
    inspection_points: unknown[]
  } | null
}

/** 依 IP-R05，指派候選人只是建議，並非執行者白名單。 */
export interface SuggestedAssignee {
  is_active?: boolean
  id: string
  username: string
  name_zh: string | null
}

/** IP-R10 的分區必須屬於目前專案。 */
export interface ProjectZone {
  id: string
  project_id: string
  name: string
}

/** 任務回應供內業判斷狀態、地點與受影響項目；寫入仍由後端驗證。 */
export interface InspectionTask {
  id: string
  project_id: string
  plan_id: string
  plan: { id: string; name: string; archived: boolean }
  item_summary: { first_title: string | null; count: number }
  name: string
  status: TaskStatus
  /**
   * IP-R16：建立時由後端依專案當時的本公司角色帶入，之後不變；
   * 值取自角色登記表（目前 `self_inspection`、`spot_check`），
   * 以字串承載讓新增層級時前端不必改型別。
   */
  inspection_level: string
  items: TaskInspectionItem[]
  assignee_id: string | null
  assignee: SuggestedAssignee | null
  zone_id: string | null
  zone: { id: string; name: string } | null
  location_text: string | null
  cancellation_reason: string | null
  cancelled_from: 'PENDING' | 'IN_PROGRESS' | null
  started_by: string | null
  completed_by: string | null
  started_by_user?: { id: string; name_zh: string | null } | null
  completed_by_user?: { id: string; name_zh: string | null } | null
  dispatched_at: string | null
  created_at: string
  updated_at: string
}

/** 依 IP-R06，Plan 狀態由任務衍生，封存時任務唯讀。 */
export interface InspectionPlan {
  id: string
  project_id: string
  name: string
  status: PlanStatus
  archived: boolean
  created_at: string
  updated_at: string
  tasks?: InspectionTask[]
}

/** Plan 清單的 cursor 必須持續取頁，避免漏掉後續計畫。 */
export interface PlanPage {
  items: InspectionPlan[]
  next_cursor: string | null
}

/** 建立 Plan 的名稱輸入；空白與長度由後端檢查。 */
export interface CreatePlanInput {
  name: string
}

/** IP-R02、IP-R10 的手動任務輸入；項目與分區須屬於同專案。 */
export interface CreateTaskInput {
  name: string
  item_ids: string[]
  suggested_assignee_id: string | null
  zone_id: string | null
  location_text: string | null
}

/** IP-R10 的地點可由分區與補充文字共同表示。 */
export interface UpdateLocationInput {
  zone_id: string | null
  location_text: string | null
}

/** #497 的任務名稱欄位；長度與空白規則由後端驗證。 */
export interface UpdateTaskNameInput {
  name: string
}

/** IP-R20 送出的草稿任務查核項目集合。 */
export interface UpdateTaskItemsInput {
  item_ids: string[]
}

/**
 * 對應 IP-R01～IP-R10 的規劃端點；拒絕與狀態轉換由後端決定。
 * IP-R06 的衍生狀態只有讀取，不能透過任意狀態更新操作覆寫。
 */
export interface PlanningClient {
  /** GET /api/v1/projects/{project_id}/zones. */
  listProjectZones(projectId: string): Promise<ProjectZone[]>
  /** GET /projects/{project_id}/inspection-task-assignees. */
  listProjectAssignees(projectId: string): Promise<SuggestedAssignee[]>
  /** POST /api/v1/projects/{project_id}/zones. */
  createZone(projectId: string, name: string): Promise<ProjectZone>
  /** PATCH /api/v1/projects/{project_id}/zones/{zone_id}. */
  renameZone(
    projectId: string,
    zoneId: string,
    name: string,
  ): Promise<ProjectZone>
  /** DELETE /api/v1/projects/{project_id}/zones/{zone_id}. */
  deleteZone(projectId: string, zoneId: string): Promise<void>
  /** GET /api/v1/projects/{project_id}/inspection-plans?cursor={cursor}. */
  listPlans(projectId: string, cursor?: string | null): Promise<PlanPage>
  /** GET /api/v1/inspection-plans/{plan_id}. */
  getPlan(planId: string): Promise<InspectionPlan>
  /** GET /api/v1/inspection-tasks/{task_id}. */
  getTask(taskId: string): Promise<InspectionTask>
  /** POST /api/v1/projects/{project_id}/inspection-plans. */
  createPlan(
    projectId: string,
    input: CreatePlanInput,
  ): Promise<InspectionPlan>
  /** PATCH /api/v1/inspection-plans/{plan_id}. */
  updatePlan(
    planId: string,
    input: Partial<CreatePlanInput>,
  ): Promise<InspectionPlan>
  /** POST /api/v1/inspection-plans/{plan_id}/tasks. */
  createTask(planId: string, input: CreateTaskInput): Promise<InspectionTask>
  /** POST /api/v1/inspection-tasks/{task_id}:assign. */
  setSuggestedAssignee(
    taskId: string,
    assigneeId: string | null,
  ): Promise<InspectionTask>
  /** POST /api/v1/inspection-tasks/{task_id}:start. */
  startTask(taskId: string): Promise<InspectionTask>
  /** POST /api/v1/inspection-tasks/{task_id}:complete. */
  completeTask(taskId: string): Promise<InspectionTask>
  /** PATCH /api/v1/inspection-tasks/{task_id}. */
  updateLocation(
    taskId: string,
    input: UpdateLocationInput,
  ): Promise<InspectionTask>
  /** PATCH /api/v1/inspection-tasks/{task_id}，修改任務名稱。 */
  updateTaskName(
    taskId: string,
    input: UpdateTaskNameInput,
  ): Promise<InspectionTask>

  /** PUT /api/v1/inspection-tasks/{task_id}/items. */
  updateTaskItems(
    taskId: string,
    input: UpdateTaskItemsInput,
  ): Promise<InspectionTask>
  /** POST /api/v1/inspection-tasks/{task_id}:dispatch. */
  dispatchTask(taskId: string): Promise<InspectionTask>
  /** DELETE /api/v1/inspection-tasks/{task_id}. */
  deleteDraftTask(taskId: string): Promise<void>
  /** POST /api/v1/inspection-tasks/{task_id}:cancel. */
  cancelTask(taskId: string, reason: string): Promise<InspectionTask>
  /** POST /api/v1/inspection-tasks/{task_id}:restore. */
  restoreTask(taskId: string): Promise<InspectionTask>
  /** POST /api/v1/inspection-plans/{plan_id}:archive. */
  archivePlan(planId: string): Promise<InspectionPlan>
  /** POST /api/v1/inspection-plans/{plan_id}:unarchive. */
  unarchivePlan(planId: string): Promise<InspectionPlan>
}

/** 以後端規劃 API 執行操作；所有專案權限與狀態限制仍由後端覆核。 */
export const planningClient: PlanningClient = {
  listProjectZones(projectId) {
    return listAllPages(`/projects/${projectId}/zones`)
  },
  listProjectAssignees(projectId) {
    return listAllPages(`/projects/${projectId}/inspection-task-assignees`)
  },
  createZone(projectId, name) {
    return request(`/projects/${projectId}/zones`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  },
  renameZone(projectId, zoneId, name) {
    return request(`/projects/${projectId}/zones/${zoneId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    })
  },
  deleteZone(projectId, zoneId) {
    return request(`/projects/${projectId}/zones/${zoneId}`, {
      method: 'DELETE',
    })
  },
  async listPlans(projectId, cursor) {
    const params = new URLSearchParams({ limit: '100' })
    if (cursor) params.set('cursor', cursor)
    return request(`/projects/${projectId}/inspection-plans?${params}`)
  },
  getPlan(planId) {
    return request(`/inspection-plans/${planId}`)
  },
  getTask(taskId) {
    return request(`/inspection-tasks/${taskId}`)
  },
  createPlan(projectId, input) {
    return request(`/projects/${projectId}/inspection-plans`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  updatePlan(planId, input) {
    return request(`/inspection-plans/${planId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  },
  createTask(planId, input) {
    return request(`/inspection-plans/${planId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  setSuggestedAssignee(taskId, assigneeId) {
    return request(`/inspection-tasks/${taskId}:assign`, {
      method: 'POST',
      body: JSON.stringify({ assignee_id: assigneeId }),
    })
  },
  startTask(taskId) {
    return request(`/inspection-tasks/${taskId}:start`, { method: 'POST' })
  },
  completeTask(taskId) {
    return request(`/inspection-tasks/${taskId}:complete`, { method: 'POST' })
  },
  updateLocation(taskId, input) {
    return request(`/inspection-tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  },
  updateTaskName(taskId, input) {
    return request(`/inspection-tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  },

  updateTaskItems(taskId, input) {
    return request(`/inspection-tasks/${taskId}/items`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  },
  dispatchTask(taskId) {
    return request(`/inspection-tasks/${taskId}:dispatch`, { method: 'POST' })
  },
  deleteDraftTask(taskId) {
    return request(`/inspection-tasks/${taskId}`, { method: 'DELETE' })
  },
  cancelTask(taskId, reason) {
    return request(`/inspection-tasks/${taskId}:cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })
  },
  restoreTask(taskId) {
    return request(`/inspection-tasks/${taskId}:restore`, { method: 'POST' })
  },
  archivePlan(planId) {
    return request(`/inspection-plans/${planId}:archive`, { method: 'POST' })
  },
  unarchivePlan(planId) {
    return request(`/inspection-plans/${planId}:unarchive`, { method: 'POST' })
  },
}

const PLANNING_ERROR_CODES: Record<string, string> = {
  'project_zone.name_conflict': '同一專案已有相同名稱的分區。',
  'project_zone.invalid_name': '分區名稱不可空白，且不得超過 128 字元。',
  'inspection_plan.invalid_name': '計畫名稱不可空白，且不得超過 128 字元。',
  'project_zone.in_use': '分區已有任務使用，無法刪除。',
  'inspection_plan.archived': '計畫已封存，無法修改。',
  'inspection_task.invalid_transition': '目前任務狀態不允許這項操作。',
  'inspection_task.reason_required': '請填寫取消原因。',
  'inspection_task.location_locked': '目前任務狀態無法修改地點。',
  'inspection_task.items_required': '請至少選擇一筆查核項目。',
  'inspection_task.invalid_project_item':
    '所選查核項目不屬於這個專案，請重新整理後再選。',
  'inspection_task.item_without_points':
    '所選查核項目沒有查核項次，請先補上項次或改選其他項目。',
  'resource.not_found': '找不到資料，請重新整理後再試。',
}

/** 把規劃 API 拒絕轉成可讀訊息；403 另提示規劃頁進入唯讀。 */
export function planningErrorMessage(error: unknown): string {
  // 唯讀切換的說明是規劃頁的特例，其餘狀態碼走共用對應表。
  if (isForbidden(error)) {
    return '你沒有權限執行這項操作，畫面已切換為唯讀。'
  }
  const status = error instanceof HttpError ? error.status : undefined
  return httpErrorMessage(error, {
    codes: PLANNING_ERROR_CODES,
    fallback:
      status === 422
        ? '輸入資料不符合規格，請檢查後再試。'
        : status === 409
          ? '目前狀態不允許這項操作，請重新整理。'
          : status === 404
            ? '找不到資料，請重新整理後再試。'
            : '目前無法完成操作，請稍後再試。',
  })
}
