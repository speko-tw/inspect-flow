import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'

import { isForbidden } from '../../http'
import { listProjectItems, type ProjectItemData } from './api'
import './ProjectItemLinks.css'

export default function ProjectItemLinks({
  projectId,
  viewerPermissions,
}: {
  projectId: string
  viewerPermissions: string[]
}) {
  const location = useLocation()
  const [items, setItems] = useState<ProjectItemData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const routeState = location.state as { highlightedItemIds?: unknown } | null
  const highlightedItemIds = new Set(
    Array.isArray(routeState?.highlightedItemIds)
      ? routeState.highlightedItemIds.filter(
          (id): id is string => typeof id === 'string',
        )
      : [],
  )
  const canEdit = viewerPermissions.includes('project_inspection_item.edit')

  useEffect(() => {
    let active = true
    listProjectItems(projectId)
      .then((loaded) => {
        if (active) setItems(loaded)
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(
          isForbidden(caught)
            ? '你沒有權限瀏覽此專案的查核項目。'
            : '無法載入專案查核項目。',
        )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [projectId])

  return (
    <section aria-labelledby="project-items-heading">
      <h2 id="project-items-heading">專案查核項目</h2>
      {canEdit && (
        <Link
          className="btn btn-primary"
          to={`/admin/projects/${projectId}/inspection-items/templates`}
        >
          從範本新增查核項目
        </Link>
      )}
      {loading && <p>載入中…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && items.length === 0 && <p>目前沒有查核項目。</p>}
      {items.length > 0 && (
        <ul className="project-item-list">
          {items.map((item) => (
            <li key={item.id}>
              {highlightedItemIds.has(item.id) && (
                <p className="project-item-applied-notice" role="status">
                  剛套用
                </p>
              )}
              <strong>{item.title}</strong>
              <p>{item.inspection_points.length} 個查核項次</p>
              <p>來源範本：{item.source_template_name}</p>
              <time
                className="project-item-applied-time"
                dateTime={item.applied_at}
              >
                套用時間：{new Date(item.applied_at).toLocaleString('zh-TW')}
              </time>
              <Link
                aria-label={`${canEdit ? '修改' : '檢視'}「${item.title}」`}
                className="btn"
                to={`/admin/projects/${projectId}/inspection-items/${item.id}`}
              >
                {canEdit ? '修改' : '檢視'}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
