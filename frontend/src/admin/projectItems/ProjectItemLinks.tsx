import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { canManageTemplateLibrary } from '../../auth/landing'
import { useCurrentUser } from '../../auth/useCurrentUser'
import AccessDeniedPage from '../../components/layout/AccessDeniedPage'
import { httpErrorMessage, isForbidden } from '../../http'
import { ConfirmBox } from '../../ui/ConfirmBox'
import { revealElement } from '../../ui/reveal'
import { ManagementApiError } from '../api'
import {
  deleteProjectItem,
  listProjectItems,
  setProjectItemActive,
  type ProjectItemListData,
} from './api'
import {
  withoutTemplateSaveNotice,
  type ProjectItemsLocationState,
} from './templateSaveNotice'
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
  const navigate = useNavigate()
  const { user } = useCurrentUser()
  const [items, setItems] = useState<ProjectItemListData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<ProjectItemListData | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [busy, setBusy] = useState(false)
  const [activation, setActivation] = useState<{
    item: ProjectItemListData
    active: boolean
  } | null>(null)
  const [activationError, setActivationError] = useState('')
  const activationAlert = useRef<HTMLParagraphElement | null>(null)
  const [notice, setNotice] = useState('')

  const savedNotice = useRef<HTMLParagraphElement | null>(null)
  const deleteTrigger = useRef<HTMLButtonElement | null>(null)
  const heading = useRef<HTMLHeadingElement | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)
  const routeState = location.state as ProjectItemsLocationState | null
  const [saveResult, setSaveResult] = useState(() =>
    routeState?.savedFromItemId ? routeState : null,
  )
  useEffect(() => {
    if (!routeState?.savedFromItemId) return
    navigate(
      {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      },
      { replace: true, state: withoutTemplateSaveNotice(routeState) },
    )
  }, [routeState, location.pathname, location.search, location.hash, navigate])
  const highlightedItemIds = new Set(
    Array.isArray(routeState?.highlightedItemIds)
      ? routeState.highlightedItemIds.filter(
          (id): id is string => typeof id === 'string',
        )
      : [],
  )
  const canEdit = viewerPermissions.includes('project_inspection_item.edit')
  const canManageTemplates = canManageTemplateLibrary(user)
  const isInUse = (deleting?.task_count ?? 0) > 0
  const deleteAlert = useRef<HTMLParagraphElement | null>(null)

  useEffect(() => {
    if (!loading) revealElement(savedNotice.current)
  }, [loading, location.key])

  useEffect(() => {
    if (!deleteError || !deleteAlert.current) return
    // #734 T7：刪除錯誤留在確認區或項目列，先捲入視野再聚焦。
    const alert = deleteAlert.current
    const block =
      alert.getBoundingClientRect().height > window.innerHeight * 0.8
        ? 'start'
        : 'nearest'
    alert.scrollIntoView?.({ block })
    alert.focus({ preventScroll: true })
  }, [deleteError, deleting?.id, isInUse])

  useEffect(() => {
    const alert = activationAlert.current
    if (!activationError || !alert) return
    // 讓就近確認區的停用／恢復錯誤可見，並讓鍵盤使用者接續操作。
    const block =
      alert.getBoundingClientRect().height > window.innerHeight * 0.8
        ? 'start'
        : 'nearest'
    alert.scrollIntoView?.({ block })
    alert.focus({ preventScroll: true })
  }, [activationError])

  useEffect(() => {
    let active = true
    listProjectItems(projectId)
      .then((loaded) => {
        if (active) setItems(loaded)
      })
      .catch((caught: unknown) => {
        if (!active) return
        if (isForbidden(caught)) {
          setAccessDenied(true)
        } else {
          setError('無法載入專案查核項目。')
        }
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
        const parsedCount =
          typeof count === 'string' && /^\d+$/.test(count)
            ? Number(count)
            : Math.max(1, deleting.task_count ?? 0)
        const updated = { ...deleting, task_count: parsedCount }
        setItems((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        )
        setDeleting(updated)
        setDeleteError(blockedDeleteMessage(parsedCount))
      } else {
        setDeleteError(
          httpErrorMessage(caught, {
            codes: {
              'permission.denied': '你沒有權限刪除此查核項目。',
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

  async function changeActive() {
    if (!activation || busy) return
    setBusy(true)
    setActivationError('')
    try {
      const updated = await setProjectItemActive(
        projectId,
        activation.item.id,
        activation.active,
      )
      setItems((current) =>
        current.map((item) =>
          item.id === updated.id ? { ...item, ...updated } : item,
        ),
      )
      setNotice(
        `已${activation.active ? '恢復' : '停用'}「${activation.item.title}」。`,
      )
      setActivation(null)
      setDeleting(null)
      heading.current?.focus()
    } catch (caught) {
      setActivationError(
        httpErrorMessage(caught, {
          codes: {
            'permission.denied': '你沒有權限停用或恢復此查核項目。',
            'resource.not_found': '找不到此查核項目，請重新載入清單。',
          },
          fallback: '操作失敗，請稍後再試。',
        }),
      )
    } finally {
      setBusy(false)
    }
  }

  function activationConfirmation(item: ProjectItemListData) {
    if (activation?.item.id !== item.id) return null
    return (
      <ConfirmBox
        busy={busy}
        confirmLabel={activation.active ? '確認恢復' : '確認停用'}
        headingLevel={3}
        onCancel={() => {
          setActivation(null)
          setActivationError('')
          deleteTrigger.current?.focus()
        }}
        onConfirm={changeActive}
        title={activation.active ? '恢復查核項目' : '停用查核項目'}
      >
        <p>對象：「{item.title}」</p>
        <p>
          {activation.active
            ? '恢復後會重新出現在新任務的選單，既有任務與查核紀錄不變。'
            : '停用後不會出現在新任務的選單，既有任務與查核紀錄不受影響，之後可以恢復。'}
        </p>
        {activationError && (
          <p ref={activationAlert} role="alert" tabIndex={-1}>
            {activationError}
          </p>
        )}
      </ConfirmBox>
    )
  }

  // IP-R23：清單預設只列啟用項目，停用者收進底部「已停用（N）」，
  // 須先恢復才可修改（API 清單預設兩種狀態都回，依 IP-R26 由前端過濾）。
  const activeItems = items.filter((item) => item.is_active !== false)
  const inactiveItems = items.filter((item) => item.is_active === false)

  if (accessDenied) return <AccessDeniedPage headingLevel={2} />

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
      {canEdit && !canManageTemplates && (
        <p className="project-item-template-hint">
          要把項目存回範本庫，需要「管理範本庫」功能，請找系統管理者開通。
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading && <p>載入中…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && activeItems.length === 0 && (
        <p>
          {inactiveItems.length > 0
            ? '目前沒有啟用的查核項目。'
            : '目前沒有查核項目。'}
        </p>
      )}
      {activeItems.length > 0 && (
        <ul className="project-item-list">
          {activeItems.map((item) => (
            <li key={item.id}>
              {highlightedItemIds.has(item.id) && (
                <p className="project-item-applied-notice" role="status">
                  剛套用
                </p>
              )}
              {saveResult?.savedFromItemId === item.id && (
                <p className="notice-success" ref={savedNotice} role="status">
                  已將「{saveResult.savedTemplateTitle}」存為範本。{' '}
                  <Link
                    to="/templates"
                    state={{
                      savedTemplateId: saveResult.savedTemplateId,
                      savedCategoryId: saveResult.savedCategoryId,
                      savedSystemId: saveResult.savedSystemId,
                    }}
                  >
                    到範本庫查看
                  </Link>
                </p>
              )}
              <div className="project-item-title">
                <strong>{item.title}</strong>
                {canEdit &&
                  item.task_count !== null &&
                  item.task_count > 0 && (
                    <span className="project-item-usage">
                      使用中（{item.task_count} 個任務）
                    </span>
                  )}
              </div>
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
                套用時間：{formatAppliedAt(item.applied_at)}
              </time>
              <div className="project-item-actions">
                <Link
                  aria-label={`${canEdit ? '修改' : '檢視'}「${item.title}」`}
                  className="btn btn-sm"
                  to={`/projects/${projectId}/inspection-items/${item.id}`}
                >
                  {canEdit ? '修改' : '檢視'}
                </Link>
                {canManageTemplates && (
                  <Link
                    aria-label={`將「${item.title}」存為範本`}
                    className="btn btn-sm"
                    state={{ saveItemId: item.id }}
                    to={`/projects/${projectId}/inspection-items/templates`}
                  >
                    存為範本
                  </Link>
                )}
                {canEdit && (
                  <button
                    aria-label={`刪除「${item.title}」`}
                    className="btn btn-sm btn-danger-outline"
                    disabled={busy}
                    onClick={(event) => {
                      deleteTrigger.current = event.currentTarget
                      setDeleting(item)
                      setActivation(null)
                      setActivationError('')
                      setSaveResult(null)
                      setDeleteError(
                        (item.task_count ?? 0) > 0
                          ? blockedDeleteMessage(item.task_count ?? 0)
                          : '',
                      )
                      setNotice('')
                    }}
                    type="button"
                  >
                    刪除
                  </button>
                )}
              </div>
              {deleting?.id === item.id && isInUse && !activation && (
                <div
                  aria-label="無法刪除查核項目"
                  className="project-item-delete-blocked"
                  role="group"
                >
                  <p ref={deleteAlert} role="alert" tabIndex={-1}>
                    {deleteError || blockedDeleteMessage(item.task_count ?? 0)}
                  </p>
                  <div className="project-item-actions">
                    <button
                      className="btn btn-sm btn-danger-outline"
                      disabled={busy}
                      onClick={() => {
                        setActivation({ item, active: false })
                        setActivationError('')
                      }}
                      type="button"
                    >
                      停用這個項目
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={cancelDelete}
                      type="button"
                    >
                      知道了
                    </button>
                    <Link
                      className="btn btn-sm"
                      onClick={() => setDeleting(null)}
                      to={`/projects/${projectId}/inspection-items/${item.id}`}
                    >
                      前往修改
                    </Link>
                  </div>
                </div>
              )}
              {activationConfirmation(item)}
              {deleting?.id === item.id && !isInUse && (
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
                    只有沒有任務引用的項目可以刪除，草稿與已取消任務也算引用。
                  </p>
                  {deleteError && (
                    <p ref={deleteAlert} role="alert" tabIndex={-1}>
                      {deleteError}
                    </p>
                  )}
                </ConfirmBox>
              )}
            </li>
          ))}
        </ul>
      )}
      {inactiveItems.length > 0 && (
        <details className="project-item-inactive">
          <summary>已停用（{inactiveItems.length}）</summary>
          <ul className="project-item-list">
            {inactiveItems.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong>
                <p>已停用；恢復後才能修改或用於新任務。</p>
                {canEdit && (
                  <button
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={(event) => {
                      deleteTrigger.current = event.currentTarget
                      setDeleting(null)
                      setActivation({ item, active: true })
                      setActivationError('')
                      setSaveResult(null)
                      setNotice('')
                    }}
                    type="button"
                  >
                    恢復「{item.title}」
                  </button>
                )}
                {activationConfirmation(item)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function blockedDeleteMessage(count: number): string {
  return (
    `已有 ${count} 個任務使用這個項目，為保留查核紀錄不能刪除；` +
    '草稿與已取消的任務也算。若只是寫錯名稱或標準，' +
    '請改用『修改』。若都是草稿，到計畫與任務刪除草稿後即可刪除。'
  )
}

function formatAppliedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未記錄'
  const datePart = new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .replace(/-/g, '/')
  const timePart = new Intl.DateTimeFormat('zh-TW', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
  return `${datePart} ${timePart}`
}
