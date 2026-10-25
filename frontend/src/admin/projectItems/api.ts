import { isForbidden } from '../../http'
import { listAllPages, ManagementApiError, request } from '../api'
import type { InspectionPoint } from '../templates/api'
import { forWire } from '../templates/templateEditorUtils'

/** IP-R04 所需的任務狀態，供修改項目時說明重查後果。 */
export type TaskStatus =
  'DRAFT' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

/** 專案項目及點位的目前資料；更新時保留既有識別。 */
export interface ProjectItemData {
  id: string
  project_id: string
  sequence: number
  title: string
  instruction: string
  source_template_name: string
  source_category_name?: string | null
  source_system_name?: string | null
  applied_at: string
  inspection_points: InspectionPoint[]
}

/** TPL-R27：只有專案項目列表回傳的全狀態任務引用數。 */
export interface ProjectItemListData extends ProjectItemData {
  task_count: number | null
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

/** 依 IP-R04 呈現受影響 Task 與未受影響項目。 */
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

/** 儲存前的影響預覽；讀取 Tasks 被拒絕時只供唯讀顯示。 */
export interface ProjectItemPreview {
  item: ProjectItemData
  affectedTasks: AffectedTask[]
  readOnly?: boolean
}

/** IP-R04、IP-R13 的修改輸入；有 Task 使用時須明確選擇重查。 */
export interface ProjectItemChange {
  title: string
  instruction: string
  inspection_points: InspectionPoint[]
  reinspect?: boolean
}

/** 區分草稿原位更新、已完成退回與取消後恢復的影響。 */
export type TaskAction =
  | 'draft_updated'
  | 'returned_to_in_progress'
  | 'needs_reinspection'
  | 'updated'
  | 'apply_current_standard_on_restore'

/** IP-R04 的單筆受影響 Task 回應，不代表整筆 Task 都需重查。 */
export interface AffectedTaskResult {
  task_id: string
  prior_status: TaskStatus
  status: TaskStatus
  action: TaskAction
  needs_reinspection: boolean
}

/** 修改成功後的項目與受影響任務結果。 */
export interface ProjectItemChangeResult extends ProjectItemData {
  reinspection_selected: boolean | null
  affected_tasks: AffectedTaskResult[]
}

/** 提供影響預覽與修改；後端會拒絕封存 Plan 及不合法項次變更。 */
export interface ProjectItemApi {
  loadPreview(projectId: string, itemId: string): Promise<ProjectItemPreview>
  update(
    projectId: string,
    itemId: string,
    change: ProjectItemChange,
  ): Promise<ProjectItemChangeResult>
}

/** 列出專案項目所有分頁，避免確認畫面遺漏項目。 */
export function listProjectItems(
  projectId: string,
): Promise<ProjectItemListData[]> {
  return listAllPages(`/projects/${projectId}/inspection-items`)
}

/** #435：由後端覆核任務引用，僅刪除未使用項目。 */
export function deleteProjectItem(
  projectId: string,
  itemId: string,
): Promise<void> {
  return request(`/projects/${projectId}/inspection-items/${itemId}`, {
    method: 'DELETE',
  })
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

/** 讀取跨 Plan 的影響預覽並提交修改；403 預覽降為唯讀。 */
export const projectItemApi: ProjectItemApi = {
  async loadPreview(projectId, itemId) {
    const path = `/projects/${projectId}/inspection-items`
    const items = await listProjectItems(projectId)
    const item = items.find((entry) => entry.id === itemId)
    if (!item) throw new ManagementApiError(404, 'resource.not_found')
    // IP-R04 的「使用」涵蓋同專案所有 Plan，不限目前頁面。
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
