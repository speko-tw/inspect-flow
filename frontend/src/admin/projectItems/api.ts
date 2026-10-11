import { isForbidden } from '../../http'
import { listAllPages, ManagementApiError, request } from '../api'
import type { InspectionPoint } from '../templates/api'
import { forWire } from '../templates/templateEditorUtils'

export type TaskStatus =
  'DRAFT' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

export interface ProjectItemData {
  id: string
  sequence: number
  title: string
  instruction: string
  source_template_name: string
  applied_at: string
  inspection_points: InspectionPoint[]
}

interface TaskItem {
  id: string
  current_snapshot: { title: string } | null
}

interface ImpactTask {
  id: string
  status: TaskStatus
  zone: { id: string; name: string } | null
  location_text: string | null
  plan_name: string | null
  plan_archived: boolean
  has_result: boolean
  items: TaskItem[]
}

export interface AffectedTask {
  id: string
  name: string
  planName: string
  zoneName: string | null
  locationText: string | null
  status: TaskStatus
  planArchived: boolean
  hasResult: boolean
  preservedItemTitles: string[]
}

export interface ProjectItemPreview {
  item: ProjectItemData
  affectedTasks: AffectedTask[]
  readOnly?: boolean
}

export interface ProjectItemChange {
  title: string
  instruction: string
  inspection_points: InspectionPoint[]
  reinspect?: boolean
}

export type TaskAction =
  | 'draft_updated'
  | 'returned_to_in_progress'
  | 'needs_reinspection'
  | 'updated'
  | 'apply_current_standard_on_restore'

export interface AffectedTaskResult {
  task_id: string
  prior_status: TaskStatus
  status: TaskStatus
  action: TaskAction
  needs_reinspection: boolean
}

export interface ProjectItemChangeResult extends ProjectItemData {
  reinspection_selected: boolean | null
  affected_tasks: AffectedTaskResult[]
}

export interface ProjectItemApi {
  loadPreview(projectId: string, itemId: string): Promise<ProjectItemPreview>
  update(
    projectId: string,
    itemId: string,
    change: ProjectItemChange,
  ): Promise<ProjectItemChangeResult>
}

export function listProjectItems(
  projectId: string,
): Promise<ProjectItemData[]> {
  return listAllPages(`/projects/${projectId}/inspection-items`)
}

/** 保留既有識別，並讓新欄位與數值標準以穩定 client_id 綁定。 */
export function serializeProjectItemPoints(points: InspectionPoint[]) {
  return forWire(
    {
      system_id: '',
      sequence: 1,
      title: '',
      instruction: '',
      inspection_points: points,
    },
    { includeIds: true },
  ).inspection_points
}

export const projectItemApi: ProjectItemApi = {
  async loadPreview(projectId, itemId) {
    const path = `/projects/${projectId}/inspection-items`
    const items = await listProjectItems(projectId)
    const item = items.find((entry) => entry.id === itemId)
    if (!item) throw new ManagementApiError(404, 'resource.not_found')
    let tasks: ImpactTask[] = []
    let readOnly = false
    try {
      tasks = await listAllPages<ImpactTask>(`${path}/${itemId}/tasks`)
    } catch (caught) {
      if (!isForbidden(caught)) {
        throw caught
      }
      readOnly = true
    }
    return {
      item,
      readOnly,
      affectedTasks: tasks.map((task) => ({
        id: task.id,
        name:
          task.items.find((entry) => entry.id === itemId)?.current_snapshot
            ?.title ?? item.title,
        planName: task.plan_name ?? '未命名計畫',
        zoneName: task.zone?.name ?? null,
        locationText: task.location_text,
        status: task.status,
        planArchived: task.plan_archived,
        hasResult: task.has_result,
        preservedItemTitles: task.items
          .filter((entry) => entry.id !== itemId)
          .map((entry) => entry.current_snapshot?.title ?? entry.id),
      })),
    }
  },
  update(projectId, itemId, change) {
    return request(`/projects/${projectId}/inspection-items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: change.title,
        instruction: change.instruction,
        inspection_points: serializeProjectItemPoints(
          change.inspection_points,
        ),
        ...(change.reinspect === undefined
          ? {}
          : { reinspect: change.reinspect }),
      }),
    })
  },
}
