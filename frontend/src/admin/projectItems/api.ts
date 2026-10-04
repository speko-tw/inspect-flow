/**
 * UI-facing contract for the pending project inspection item PATCH endpoint.
 * #361 has not defined a response schema yet, so the adapter boundary stays
 * semantic and the page runs against this mock until that contract is merged.
 * The eventual request is PATCH /api/v1/projects/{project_id}/inspection-items/
 * {project_inspection_item_id}; include `reinspect` when affected Tasks exist.
 */

export type TaskStatus =
  'DRAFT' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

export interface ProjectInspectionItem {
  id: string
  sequence: number
  title: string
  standard: string
}

export interface AffectedTask {
  id: string
  name: string
  planName: string
  status: TaskStatus
  planArchived: boolean
  hasResult: boolean
}

export interface ProjectItemPreview {
  item: ProjectInspectionItem
  affectedTasks: AffectedTask[]
  preservedItemTitles: string[]
}

export interface ProjectItemChange {
  title: string
  standard: string
  reinspect: boolean
}

export interface ProjectItemChangeResult {
  invalidatedHistory: string[]
  invalidatedResults: string[]
  preservedItems: string[]
  updatedDraftTasks: string[]
  reinspectionSelected: boolean
}

/**
 * Implementations map transport-specific responses into this view contract.
 * UI code deliberately does not depend on an unratified #361 response shape.
 */
export interface ProjectItemApi {
  loadPreview(projectId: string, itemId: string): Promise<ProjectItemPreview>
  update(
    projectId: string,
    itemId: string,
    change: ProjectItemChange,
  ): Promise<ProjectItemChangeResult>
}

export class ProjectItemApiError extends Error {
  constructor(readonly status: number) {
    super(`專案查核項目 API 錯誤（狀態碼 ${status}）`)
    this.name = 'ProjectItemApiError'
  }
}

const DEMO_ITEM: ProjectInspectionItem = {
  id: 'item-1',
  sequence: 1,
  title: '混凝土表面檢查',
  standard: '不得有明顯裂縫',
}

const DEMO_TASKS: AffectedTask[] = [
  {
    id: 'task-draft',
    name: '地下室抽查',
    planName: '地下室查核計畫',
    status: 'DRAFT',
    planArchived: false,
    hasResult: false,
  },
  {
    id: 'task-pending',
    name: '一樓巡檢',
    planName: '樓層巡檢計畫',
    status: 'PENDING',
    planArchived: false,
    hasResult: false,
  },
  {
    id: 'task-done',
    name: '二樓巡檢',
    planName: '樓層巡檢計畫',
    status: 'COMPLETED',
    planArchived: false,
    hasResult: true,
  },
  {
    id: 'task-in-progress',
    name: '三樓巡檢',
    planName: '樓層巡檢計畫',
    status: 'IN_PROGRESS',
    planArchived: false,
    hasResult: false,
  },
  {
    id: 'task-cancelled',
    name: '屋頂抽查',
    planName: '屋頂查核計畫',
    status: 'CANCELLED',
    planArchived: false,
    hasResult: true,
  },
]

/** Mock used for the T5 UI before the #361 HTTP response contract exists. */
export const mockProjectItemApi: ProjectItemApi = {
  async loadPreview() {
    return {
      item: { ...DEMO_ITEM },
      affectedTasks: DEMO_TASKS.map((task) => ({ ...task })),
      preservedItemTitles: ['鋼筋間距', '保護層厚度'],
    }
  },
  async update(_projectId, _itemId, change) {
    const activeTasks = DEMO_TASKS.filter(
      (task) => task.status !== 'CANCELLED',
    )
    return {
      invalidatedHistory: change.reinspect
        ? activeTasks
            .filter((task) => task.status !== 'DRAFT')
            .map((task) => `${task.name}：${change.title}`)
        : [],
      invalidatedResults: change.reinspect
        ? activeTasks
            .filter((task) => task.status !== 'DRAFT' && task.hasResult)
            .map((task) => `${task.name}：${change.title}`)
        : [],
      preservedItems: ['鋼筋間距', '保護層厚度'],
      updatedDraftTasks: activeTasks
        .filter((task) => task.status === 'DRAFT')
        .map((task) => task.name),
      reinspectionSelected: change.reinspect,
    }
  },
}
