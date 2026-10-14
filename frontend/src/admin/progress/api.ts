import { request, type Page } from '../api'
import type { InspectionTask } from '../planning/api'
import type { TaskStatus } from '../projectItems/api'

export type ProgressFilter = TaskStatus | 'reinspection' | 'all'

/** 依 IP-R18 將篩選交給後端，讓游標涵蓋完整結果集。 */
export function listProgressTasks(
  projectId: string,
  filter: ProgressFilter,
  cursor: string | null = null,
): Promise<Page<InspectionTask>> {
  const query = new URLSearchParams({ limit: '10' })
  if (filter === 'reinspection') {
    query.set('needs_reinspection', 'true')
  } else if (filter !== 'all') {
    query.set('status', filter)
  }
  if (cursor) query.set('cursor', cursor)
  return request(`/projects/${projectId}/inspection-tasks?${query.toString()}`)
}
