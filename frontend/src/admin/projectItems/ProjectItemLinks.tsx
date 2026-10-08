import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'

import { isForbidden } from '../../http'
import { listProjectItems, type ProjectItemData } from './api'

export default function ProjectItemLinks({
  projectId,
}: {
  projectId: string
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
      <Link
        className="btn btn-primary"
        to={`/admin/projects/${projectId}/templates`}
      >
        套用範本
      </Link>
      {loading && <p>載入中…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && items.length === 0 && <p>目前沒有查核項目。</p>}
      {items.length > 0 && (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              {highlightedItemIds.has(item.id) && (
                <p className="project-item-applied-notice" role="status">
                  剛套用
                </p>
              )}
              <strong>{item.title}</strong>
              <p>來源範本：{item.source_template_name}</p>
              <time
                className="project-item-applied-time"
                dateTime={item.applied_at}
              >
                套用時間：{new Date(item.applied_at).toLocaleString('zh-TW')}
              </time>
              <Link
                to={`/admin/projects/${projectId}/inspection-items/${item.id}`}
              >
                修改「{item.title}」
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
