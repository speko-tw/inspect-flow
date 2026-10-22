import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'

import { httpErrorMessage, isForbidden } from '../../http'
import { ConfirmBox } from '../../ui/ConfirmBox'
import { ManagementApiError } from '../api'
import {
  deleteProjectItem,
  listProjectItems,
  type ProjectItemData,
} from './api'
import './ProjectItemLinks.css'

/**
 * 依 ADM-R17 列出專案查核項目；只有編輯權限者顯示修改入口。
 * 列表讀取被拒絕時顯示錯誤，避免將權限不足誤認為空清單。
 */
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
  const [deleting, setDeleting] = useState<ProjectItemData | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const deleteTrigger = useRef<HTMLButtonElement | null>(null)
  const heading = useRef<HTMLHeadingElement | null>(null)
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

  function cancelDelete() {
    setDeleting(null)
    setDeleteError('')
    deleteTrigger.current?.focus()
  }

  async function removeItem() {
    if (!deleting || busy) return
    setBusy(true)
    setDeleteError('')
    try {
      await deleteProjectItem(projectId, deleting.id)
      setItems((current) => current.filter((item) => item.id !== deleting.id))
      setNotice(`已刪除「${deleting.title}」。`)
      setDeleting(null)
      heading.current?.focus()
    } catch (caught) {
      // #435：任務數由後端持鎖後計算，不能信任列表載入時的引用狀況。
      if (
        caught instanceof ManagementApiError &&
        caught.code === 'project_inspection_item.in_use'
      ) {
        const count: unknown = Array.isArray(caught.details)
          ? caught.details[0]
          : undefined
        const prefix =
          typeof count === 'string' && /^\d+$/.test(count)
            ? `已有 ${count} 個任務使用這個項目`
            : '已有任務使用這個項目'
        setDeleteError(
          `${prefix}，為保留查核紀錄不能刪除。` +
            '若都是草稿任務，刪除草稿後即可移除。',
        )
      } else {
        setDeleteError(
          httpErrorMessage(caught, {
            codes: {
              'authorization.forbidden': '你沒有權限刪除此查核項目。',
              'resource.not_found': '找不到此查核項目，請重新載入清單。',
            },
            fallback: '刪除失敗，請稍後再試。',
          }),
        )
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="project-items-heading">
      <h2 id="project-items-heading" ref={heading} tabIndex={-1}>
        專案查核項目
      </h2>
      {canEdit && (
        <Link
          className="btn btn-primary"
          to={`/projects/${projectId}/inspection-items/templates`}
        >
          從範本新增查核項目
        </Link>
      )}
      {notice && <p role="status">{notice}</p>}
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
              <p>
                來源分類／系統：{' '}
                {item.source_category_name && item.source_system_name
                  ? `${item.source_category_name} / ${item.source_system_name}`
                  : '未記錄'}
              </p>
              <time
                className="project-item-applied-time"
                dateTime={item.applied_at}
              >
                套用時間：{new Date(item.applied_at).toLocaleString('zh-TW')}
              </time>
              <Link
                aria-label={`${canEdit ? '修改' : '檢視'}「${item.title}」`}
                className="btn"
                to={`/projects/${projectId}/inspection-items/${item.id}`}
              >
                {canEdit ? '修改' : '檢視'}
              </Link>
              {canEdit && (
                <button
                  aria-label={`刪除「${item.title}」`}
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={(event) => {
                    deleteTrigger.current = event.currentTarget
                    setDeleting(item)
                    setDeleteError('')
                    setNotice('')
                  }}
                  type="button"
                >
                  刪除
                </button>
              )}
              {deleting?.id === item.id && (
                <ConfirmBox
                  busy={busy}
                  confirmLabel="確認刪除"
                  headingLevel={3}
                  onCancel={cancelDelete}
                  onConfirm={removeItem}
                  title="刪除查核項目"
                  variant="danger"
                >
                  <p>確定刪除「{item.title}」？刪除後無法復原。</p>
                  <p>
                    只有沒有任務引用的項目可以刪除， 草稿與已取消任務也算引用。
                  </p>
                  {deleteError && <p role="alert">{deleteError}</p>}
                </ConfirmBox>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
