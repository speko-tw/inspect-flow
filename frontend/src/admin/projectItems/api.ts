import { isForbidden } from '../../http'
import { listAllPages, ManagementApiError, request } from '../api'
import type { InspectionPoint } from '../templates/api'

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

function patchPoints(points: InspectionPoint[]) {
  return points.map((point) => ({
    id: point.id,
    sequence: point.sequence,
    title: point.title,
    instruction: point.instruction,
    text_standard: point.text_standard,
    numeric_standard: point.numeric_standard
      ? {
          value: point.numeric_standard.value,
          condition: point.numeric_standard.condition,
          unit: point.numeric_standard.unit,
          tolerance: point.numeric_standard.tolerance,
          range_form: point.numeric_standard.range_form ?? null,
          lower_bound: point.numeric_standard.lower_bound ?? null,
          upper_bound: point.numeric_standard.upper_bound ?? null,
          measurement_field_client_id:
            point.numeric_standard.measurement_field_id,
        }
      : null,
    measurement_fields: point.measurement_fields.map((field) => ({
      id: field.id,
      client_id: field.client_id ?? field.id ?? crypto.randomUUID(),
      name: field.name,
      field_type: field.field_type,
      unit:
        point.numeric_standard?.measurement_field_id !== undefined &&
        field.id === point.numeric_standard.measurement_field_id
          ? null
          : field.unit,
    })),
    evidence_requirements: point.evidence_requirements.map((row) => ({
      min_count: row.min_count,
    })),
  }))
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
        inspection_points: patchPoints(change.inspection_points),
        ...(change.reinspect === undefined
          ? {}
          : { reinspect: change.reinspect }),
      }),
    })
  },
}
