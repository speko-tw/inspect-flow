import type { InspectionPoint } from '../templates/api'

/**
 * TODO(#361): define the read contract for affected Tasks and the PATCH
 * success response. The frozen spec defines only the project item PATCH.
 */

export type TaskStatus =
  'DRAFT' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

export interface ProjectItemData {
  id: string
  sequence: number
  title: string
  instruction: string
  inspection_points: InspectionPoint[]
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
  item: ProjectItemData
  affectedTasks: AffectedTask[]
  preservedItemTitles: string[]
}

/** Matches the frozen inspection-planning PATCH body. */
export interface ProjectItemChange {
  title: string
  instruction: string
  inspection_points: InspectionPoint[]
  reinspect?: boolean
}

/**
 * TODO(#361): map the eventual PATCH response to this UI result contract.
 */
export interface ProjectItemChangeResult {
  invalidatedHistory: string[]
  invalidatedResults: string[]
  preservedItems: string[]
  updatedDraftTasks: string[]
  reinspectionSelected: boolean
}

export interface ProjectItemApi {
  loadPreview(projectId: string, itemId: string): Promise<ProjectItemPreview>
  update(
    projectId: string,
    itemId: string,
    change: ProjectItemChange,
  ): Promise<ProjectItemChangeResult>
}

function textPoint(
  sequence: number,
  title: string,
  text: string,
): InspectionPoint {
  return {
    sequence,
    title,
    instruction: '',
    text_standard: { text },
    numeric_standard: null,
    measurement_fields: [],
    evidence_requirements: [],
  }
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

function copyPreview(preview: ProjectItemPreview): ProjectItemPreview {
  return structuredClone(preview)
}

/** Mock entry for development only; #361 replaces this adapter. */
export function createMockProjectItemApi(): ProjectItemApi {
  const preview: ProjectItemPreview = {
    item: {
      id: 'item-1',
      sequence: 1,
      title: '混凝土表面檢查',
      instruction: '檢查混凝土表面狀況',
      inspection_points: [
        textPoint(1, '表面完整', '不得有明顯裂縫'),
        textPoint(2, '表面平整', '不得有明顯高低差'),
      ],
    },
    affectedTasks: structuredClone(DEMO_TASKS),
    preservedItemTitles: ['鋼筋間距', '保護層厚度'],
  }

  return {
    async loadPreview() {
      return copyPreview(preview)
    },
    async update(_projectId, _itemId, change) {
      const activeTasks = preview.affectedTasks.filter(
        (task) => task.status !== 'CANCELLED',
      )
      preview.item = {
        ...preview.item,
        title: change.title,
        instruction: change.instruction,
        inspection_points: structuredClone(change.inspection_points),
      }
      const result: ProjectItemChangeResult = {
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
        preservedItems: [...preview.preservedItemTitles],
        updatedDraftTasks: activeTasks
          .filter((task) => task.status === 'DRAFT')
          .map((task) => task.name),
        reinspectionSelected: change.reinspect ?? false,
      }
      if (change.reinspect) {
        preview.affectedTasks = preview.affectedTasks.map((task) =>
          task.status === 'COMPLETED'
            ? { ...task, status: 'IN_PROGRESS' }
            : task,
        )
      }
      return result
    },
  }
}
