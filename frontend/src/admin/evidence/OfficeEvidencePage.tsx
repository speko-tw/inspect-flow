import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link } from 'react-router'

import { ConfirmBox } from '../../ui/ConfirmBox'
import { useUnsavedNavigationGuard } from '../../ui/navigation'
import { ManagementApiError } from '../api'
import type { HttpFieldError } from '../../http'
import type { TaskStatus } from '../projectItems/api'
import {
  deletePhoto,
  editOfficePhoto,
  getOfficePhoto,
  listOfficePhotos,
  officeImageUrl,
  type OfficePhoto,
} from './api'
import { OfficePhotoEditor } from './OfficePhotoEditor'
import { OfficePhotoViewer } from './OfficePhotoViewer'
import { formatRecordedTime } from './labelTime'
import './evidence-office.css'

type TaskItem = {
  id: string
  current_snapshot: {
    title: string
  } | null
}

type Props = {
  projectId: string
  planId: string
  taskId: string
  taskName: string
  items: TaskItem[]
  canEdit: boolean
  canDelete: boolean
  taskStatus: TaskStatus
  planArchived: boolean
}

type Filter = 'all' | 'active' | 'voided' | 'deleted'

function photoTime(photo: OfficePhoto): string {
  const value = photo.captured_at ?? photo.uploaded_at
  const formatted = new Intl.DateTimeFormat('zh-TW', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Taipei',
  }).format(new Date(value))
  return photo.captured_at ? formatted : `上傳時間 ${formatted}`
}

function photoIdentity(photo: OfficePhoto): string {
  return `${photo.uploaded_by.name_zh ?? '未記錄拍照者'}，${photoTime(photo)}`
}

function isOfficeReadback(
  value: unknown,
  photoId: string,
): value is OfficePhoto {
  if (!value || typeof value !== 'object') return false
  const photo = value as Partial<OfficePhoto>
  return (
    photo.id === photoId &&
    typeof photo.variants?.field?.sha256 === 'string' &&
    typeof photo.variants?.office?.sha256 === 'string' &&
    photo.variants.office.edit_params !== undefined &&
    Boolean(photo.layer) &&
    Boolean(photo.labels) &&
    Boolean(photo.uploaded_by) &&
    Array.isArray(photo.point_ids)
  )
}

function filtersFor(filter: Filter): { voided?: boolean; deleted?: boolean } {
  if (filter === 'active') return { voided: false, deleted: false }
  if (filter === 'voided') return { voided: true, deleted: false }
  if (filter === 'deleted') return { voided: false, deleted: true }
  return {}
}

function mutationMessage(error: unknown): string {
  if (error instanceof ManagementApiError) {
    if (error.status === 403) return '你沒有修改這張照片的權限。'
    if (error.status === 404) return '找不到這張照片，請重新載入。'
    if (error.status === 409) return '照片狀態已改變，請重新載入後再試。'
    if (error.status === 422 && error.code === 'evidence.invalid_layer')
      return '圖層設定無法放入這張照片，請調整工程標示。'
    if (error.status === 422 && error.code === 'evidence.invalid_edit')
      return '影像編修範圍不符合限制，請檢查裁切或亮度設定。'
    if (error.status === 422) return '欄位內容不符合規則，請檢查標示的欄位。'
  }
  return '照片操作失敗，請重新載入後再試。'
}

/** FEV-R16：依項目查看 FIELD／OFFICE，並管理保存的內業照片。 */
export function OfficeEvidencePage({
  projectId,
  planId,
  taskId,
  taskName,
  items,
  canEdit,
  canDelete,
  taskStatus,
  planArchived,
}: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [photos, setPhotos] = useState<OfficePhoto[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [historyByPhoto, setHistoryByPhoto] = useState<
    Record<
      string,
      {
        photo?: OfficePhoto
        loading: boolean
        error: boolean
        moreLoading: boolean
        moreError: boolean
      }
    >
  >({})
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<string[]>([])
  const [viewingPhoto, setViewingPhoto] = useState<OfficePhoto | null>(null)
  const [editing, setEditing] = useState<OfficePhoto | null>(null)
  const [editorDirty, setEditorDirty] = useState(false)
  const [deleting, setDeleting] = useState<OfficePhoto | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [validation, setValidation] = useState<{
    code?: string
    fields?: HttpFieldError[]
  } | null>(null)
  const [noticeByPhoto, setNoticeByPhoto] = useState<Record<string, string>>(
    {},
  )
  const [deleteError, setDeleteError] = useState('')
  const pageHeading = useRef<HTMLHeadingElement | null>(null)
  const viewerTrigger = useRef<HTMLButtonElement | null>(null)
  const historyTriggers = useRef<Record<string, HTMLButtonElement | null>>({})
  const historyHeadings = useRef<Record<string, HTMLHeadingElement | null>>({})
  const pendingHistoryFocus = useRef<string | null>(null)
  // FEV-R16：同一照片的後續請求會淘汰較早的非同步回應。
  const historyRequestSeq = useRef<Record<string, number>>({})
  const errorRef = useRef<HTMLParagraphElement | null>(null)
  const operationRef = useRef(false)
  const leaveGuard = useUnsavedNavigationGuard(
    editorDirty,
    '放棄這次編修，已存內業版不受影響。要離開嗎？',
  )

  const reload = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const found: OfficePhoto[] = []
      let cursor: string | undefined
      do {
        const page = await listOfficePhotos(taskId, filtersFor(filter), cursor)
        found.push(...page.items)
        cursor = page.next_cursor ?? undefined
      } while (cursor)
      setPhotos(found)
    } catch {
      setLoadError('照片清單載入失敗，請重新載入。')
    } finally {
      setLoading(false)
    }
  }, [filter, taskId])

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0)
    return () => window.clearTimeout(timer)
  }, [reload])

  function beginHistoryRequest(photoId: string): number {
    const next = (historyRequestSeq.current[photoId] ?? 0) + 1
    historyRequestSeq.current[photoId] = next
    return next
  }

  function isCurrentHistoryRequest(photoId: string, requestId: number) {
    return historyRequestSeq.current[photoId] === requestId
  }

  useEffect(() => {
    const photoId = pendingHistoryFocus.current
    if (!photoId || !expandedHistoryIds.includes(photoId)) return
    pendingHistoryFocus.current = null
    const heading = historyHeadings.current[photoId]
    heading?.scrollIntoView?.({ block: 'nearest' })
    heading?.focus({ preventScroll: true })
  }, [expandedHistoryIds])

  useEffect(() => {
    if (error) {
      errorRef.current?.scrollIntoView?.({ block: 'nearest' })
      errorRef.current?.focus({ preventScroll: true })
    }
  }, [error])

  useEffect(() => {
    if (!editing) pageHeading.current?.focus({ preventScroll: true })
  }, [editing])

  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  )
  const grouped = useMemo(() => {
    const groups = new Map<string, OfficePhoto[]>()
    for (const photo of photos) {
      const group = groups.get(photo.item_id) ?? []
      group.push(photo)
      groups.set(photo.item_id, group)
    }
    for (const group of groups.values()) {
      group.sort((a, b) => Number(b.is_overview) - Number(a.is_overview))
    }
    return [...groups.entries()]
  }, [photos])

  async function runMutation(
    action: () => Promise<unknown>,
    onFailure?: (message: string) => void,
  ): Promise<boolean> {
    if (operationRef.current) return false
    operationRef.current = true
    setBusy(true)
    setError('')
    setValidation(null)
    try {
      await action()
      await reload()
      return true
    } catch (caught) {
      // FEV-R16：2xx 回應無法解析時也只重讀狀態，不重送異動。
      await reload()
      const message = mutationMessage(caught)
      if (caught instanceof ManagementApiError) {
        setValidation({ code: caught.code, fields: caught.fields })
      }
      if (onFailure) onFailure(message)
      else setError(message)
      return false
    } finally {
      operationRef.current = false
      setBusy(false)
    }
  }

  async function openEditor(photo: OfficePhoto): Promise<void> {
    setError('')
    try {
      const detail = await getOfficePhoto(taskId, photo.id)
      setEditorDirty(false)
      setEditing(detail)
    } catch {
      setError('照片詳情載入失敗，請重新載入。')
    }
  }

  async function openHistory(photo: OfficePhoto): Promise<void> {
    if (expandedHistoryIds.includes(photo.id)) {
      beginHistoryRequest(photo.id)
      setExpandedHistoryIds((ids) => ids.filter((id) => id !== photo.id))
      // FEV-R16：卸載歷程後把焦點還給原本的展開按鈕。
      window.setTimeout(() => historyTriggers.current[photo.id]?.focus(), 0)
      return
    }
    const requestId = beginHistoryRequest(photo.id)
    pendingHistoryFocus.current = photo.id
    setExpandedHistoryIds((ids) => [...ids, photo.id])
    setHistoryByPhoto((current) => ({
      ...current,
      [photo.id]: {
        photo: current[photo.id]?.photo,
        loading: true,
        error: false,
        moreLoading: false,
        moreError: false,
      },
    }))
    try {
      const detail = await getOfficePhoto(taskId, photo.id)
      if (!isCurrentHistoryRequest(photo.id, requestId)) return
      setHistoryByPhoto((current) => ({
        ...current,
        [photo.id]: {
          photo: detail,
          loading: false,
          error: false,
          moreLoading: false,
          moreError: false,
        },
      }))
    } catch {
      if (!isCurrentHistoryRequest(photo.id, requestId)) return
      setHistoryByPhoto((current) => ({
        ...current,
        [photo.id]: {
          loading: false,
          error: true,
          moreLoading: false,
          moreError: false,
        },
      }))
    }
  }

  async function retryHistory(photoId: string): Promise<void> {
    const requestId = beginHistoryRequest(photoId)
    historyHeadings.current[photoId]?.focus({ preventScroll: true })
    setHistoryByPhoto((current) => ({
      ...current,
      [photoId]: {
        ...current[photoId],
        loading: true,
        error: false,
      },
    }))
    try {
      const detail = await getOfficePhoto(taskId, photoId)
      if (!isCurrentHistoryRequest(photoId, requestId)) return
      setHistoryByPhoto((current) => ({
        ...current,
        [photoId]: {
          photo: detail,
          loading: false,
          error: false,
          moreLoading: false,
          moreError: false,
        },
      }))
    } catch {
      if (!isCurrentHistoryRequest(photoId, requestId)) return
      setHistoryByPhoto((current) => ({
        ...current,
        [photoId]: { ...current[photoId], loading: false, error: true },
      }))
    }
  }

  async function loadMoreHistory(photoId: string): Promise<void> {
    const current = historyByPhoto[photoId]?.photo
    const cursor = current?.layer_history?.next_cursor
    if (!current || !cursor) return
    const requestId = beginHistoryRequest(photoId)
    setHistoryByPhoto((state) => ({
      ...state,
      [photoId]: { ...state[photoId], moreLoading: true, moreError: false },
    }))
    try {
      const detail = await getOfficePhoto(taskId, current.id, cursor)
      if (!isCurrentHistoryRequest(photoId, requestId)) return
      setHistoryByPhoto((state) => ({
        ...state,
        [photoId]: {
          ...state[photoId],
          photo: {
            ...current,
            layer_history: {
              ...detail.layer_history!,
              items: [
                ...(current.layer_history?.items ?? []),
                ...(detail.layer_history?.items ?? []),
              ],
            },
          },
          moreLoading: false,
        },
      }))
    } catch {
      if (!isCurrentHistoryRequest(photoId, requestId)) return
      setHistoryByPhoto((state) => ({
        ...state,
        [photoId]: { ...state[photoId], moreLoading: false, moreError: true },
      }))
    }
  }

  async function confirmDelete(): Promise<void> {
    const photo = deleting
    if (!photo) return
    const ok = await runMutation(
      () => deletePhoto(taskId, photo.id),
      (message) => setDeleteError(message),
    )
    if (ok) {
      setNoticeByPhoto((current) => ({
        ...current,
        [photo.id]: '照片已刪除，清單已重新讀取。',
      }))
      setDeleting(null)
    }
  }

  function backToTask() {
    return `/projects/${projectId}/planning/${planId}/tasks/${taskId}`
  }

  if (editing) {
    return (
      <OfficePhotoEditor
        key={editing.id}
        photo={editing}
        taskId={taskId}
        busy={busy}
        error={error}
        validation={validation}
        leaveGuard={leaveGuard}
        onCancel={() => {
          setEditorDirty(false)
          setEditing(null)
        }}
        onDirtyChange={setEditorDirty}
        onErrorClear={() => {
          setError('')
          setValidation(null)
        }}
        onSave={async (input) => {
          const ok = await runMutation(async () => {
            const response: unknown = await editOfficePhoto(
              taskId,
              editing.id,
              input,
            )
            if (!isOfficeReadback(response, editing.id))
              throw new Error('OFFICE readback envelope malformed')
            return response
          })
          if (ok) {
            const refreshIds = expandedHistoryIds.map(
              (photoId) => [photoId, beginHistoryRequest(photoId)] as const,
            )
            try {
              const detail = await getOfficePhoto(taskId, editing.id)
              setPhotos((current) =>
                current.map((photo) =>
                  photo.id === editing.id ? detail : photo,
                ),
              )
              const refreshedHistory = await Promise.all(
                refreshIds.map(async ([photoId, requestId]) => {
                  try {
                    const updated = await getOfficePhoto(taskId, photoId)
                    return [photoId, requestId, updated] as const
                  } catch {
                    return [photoId, requestId, null] as const
                  }
                }),
              )
              setHistoryByPhoto((current) => {
                const next = { ...current }
                for (const [photoId, requestId, updated] of refreshedHistory) {
                  if (!isCurrentHistoryRequest(photoId, requestId)) continue
                  if (updated) {
                    next[photoId] = {
                      photo: updated,
                      loading: false,
                      error: false,
                      moreLoading: false,
                      moreError: false,
                    }
                  } else {
                    next[photoId] = {
                      ...next[photoId],
                      loading: false,
                      error: true,
                    }
                  }
                }
                return next
              })
            } catch {
              setHistoryByPhoto((current) => {
                const next = { ...current }
                for (const [photoId, requestId] of refreshIds) {
                  if (!isCurrentHistoryRequest(photoId, requestId)) continue
                  next[photoId] = {
                    ...next[photoId],
                    loading: false,
                    error: true,
                  }
                }
                return next
              })
              setError('內業版已更新，但詳情讀回失敗，請重新載入。')
            }
            setNoticeByPhoto((current) => ({
              ...current,
              [editing.id]: '內業版已更新。',
            }))
            setEditorDirty(false)
            setEditing(null)
          }
          return ok
        }}
      />
    )
  }

  return (
    <div className="office-evidence" data-project-id={projectId}>
      <Link className="btn" to={backToTask()}>
        返回任務詳情
      </Link>
      <header className="office-evidence-heading">
        <h2 ref={pageHeading} tabIndex={-1}>
          {taskName}｜照片
        </h2>
        <p>
          {planArchived
            ? '計畫已封存，照片只能查看。'
            : taskStatus === 'CANCELLED'
              ? '任務已取消，照片只能查看。'
              : taskStatus === 'COMPLETED'
                ? canEdit
                  ? '任務已完成：可以編修內業版，不能刪除照片。'
                  : '照片只能查看。'
                : canEdit && canDelete
                  ? '依查核項目查看現場版與內業版；編修後直接更新內業版。'
                  : '照片只能查看。'}
        </p>
      </header>

      <div className="office-evidence-toolbar">
        <label>
          照片狀態
          <select
            onChange={(event) => setFilter(event.target.value as Filter)}
            value={filter}
          >
            <option value="all">全部</option>
            <option value="active">有效</option>
            <option value="voided">標準變更作廢</option>
            <option value="deleted">已刪除</option>
          </select>
        </label>
        <button disabled={loading} onClick={() => void reload()} type="button">
          重新載入
        </button>
      </div>

      {(loadError || error) && (
        <p
          className="office-inline-error"
          ref={errorRef}
          role="alert"
          tabIndex={-1}
        >
          {error || loadError}
        </p>
      )}
      {loading && <p role="status">正在載入照片…</p>}
      {!loading && !loadError && photos.length === 0 && (
        <p>目前沒有符合條件的照片。</p>
      )}

      <div className="office-photo-groups">
        {grouped.map(([itemId, group]) => {
          const item = itemById.get(itemId)
          const labelTitle = group.find((photo) => photo.labels.item_title)
            ?.labels.item_title
          const hasItemPhoto = group.some((photo) => !photo.is_overview)
          const title =
            labelTitle ??
            item?.current_snapshot?.title ??
            (hasItemPhoto ? '查核項目' : '總覽照片')
          return (
            <section
              aria-label={title}
              className="office-photo-group"
              key={itemId}
            >
              <h3>{title}</h3>
              <ul className="office-photo-list">
                {group.map((photo) => (
                  <li key={photo.id}>
                    <article
                      aria-label={photoIdentity(photo)}
                      className="office-photo-card"
                      onKeyDown={(event) => {
                        if (
                          event.key === 'Escape' &&
                          expandedHistoryIds.includes(photo.id)
                        ) {
                          event.preventDefault()
                          setExpandedHistoryIds((ids) =>
                            ids.filter((id) => id !== photo.id),
                          )
                          beginHistoryRequest(photo.id)
                          // FEV-R16：Esc 卸載歷程後還原觸發按鈕焦點。
                          window.setTimeout(
                            () => historyTriggers.current[photo.id]?.focus(),
                            0,
                          )
                        }
                      }}
                    >
                      {photo.is_overview && <h4>總覽照片</h4>}
                      <div className="office-comparison">
                        <figure>
                          <img
                            alt={`現場版，${photoIdentity(photo)}`}
                            src={officeImageUrl(
                              taskId,
                              photo.id,
                              'field',
                              photo.variants.field.sha256,
                            )}
                          />
                          <figcaption>現場版</figcaption>
                        </figure>
                        <figure>
                          <img
                            alt={`內業版，${photoIdentity(photo)}`}
                            src={officeImageUrl(
                              taskId,
                              photo.id,
                              'office',
                              photo.variants.office.sha256,
                            )}
                          />
                          <figcaption>內業版</figcaption>
                        </figure>
                      </div>
                      <p className="office-photo-meta">
                        {photo.caption || '未填註記'}
                        <br />
                        {photoIdentity(photo)}
                      </p>
                      <p>對應項次：{photo.point_ids.length}</p>
                      {noticeByPhoto[photo.id] && (
                        <p className="office-success-notice" role="status">
                          {noticeByPhoto[photo.id]}
                        </p>
                      )}
                      <div
                        aria-label="照片標示"
                        className="office-photo-badges"
                        role="group"
                      >
                        {photo.voided_at && (
                          <span className="office-photo-badge">
                            標準變更作廢
                          </span>
                        )}
                        {photo.deleted_at && (
                          <span className="office-photo-badge">已刪除</span>
                        )}
                        {photo.capture_source === 'library' && (
                          <span className="office-photo-badge">相簿匯入</span>
                        )}
                        {photo.is_non_realtime_capture &&
                          photo.capture_source !== 'library' && (
                            <span className="office-photo-badge">
                              非即時拍攝
                            </span>
                          )}
                        {photo.layer_render.render_state ===
                          'omitted_too_small' && (
                          <span className="office-photo-badge">
                            照片太小，標示未合成
                          </span>
                        )}
                        {photo.layer_render.render_state ===
                          'fallback_small' && (
                          <span className="office-photo-badge">
                            這張照片太小，已自動用小尺寸
                          </span>
                        )}
                        {photo.has_layer_overrides && (
                          <span className="office-photo-badge">
                            已修改工程標示文字
                          </span>
                        )}
                      </div>
                      <div className="office-photo-actions">
                        <button
                          aria-label={`查看大圖，${photoIdentity(photo)}`}
                          onClick={(event) => {
                            viewerTrigger.current = event.currentTarget
                            setViewingPhoto(photo)
                          }}
                          type="button"
                        >
                          查看大圖
                        </button>
                        <button
                          aria-controls={`history-${photo.id}`}
                          aria-expanded={expandedHistoryIds.includes(photo.id)}
                          aria-label={[
                            expandedHistoryIds.includes(photo.id)
                              ? '收起歷程'
                              : '查看歷程',
                            photoIdentity(photo),
                          ].join('，')}
                          onClick={() => void openHistory(photo)}
                          ref={(node) => {
                            historyTriggers.current[photo.id] = node
                          }}
                          type="button"
                        >
                          {expandedHistoryIds.includes(photo.id)
                            ? '收起歷程'
                            : '查看歷程'}
                        </button>
                        {canEdit && !photo.deleted_at && !photo.voided_at && (
                          <button
                            aria-label={`編修內業版，${photoIdentity(photo)}`}
                            onClick={() => void openEditor(photo)}
                            type="button"
                          >
                            編修內業版
                          </button>
                        )}
                        {canDelete &&
                          !photo.deleted_at &&
                          !photo.voided_at && (
                            <button
                              aria-label={`刪除照片，${photoIdentity(photo)}`}
                              className="btn-danger"
                              onClick={() => {
                                setDeleteError('')
                                setDeleting(photo)
                              }}
                              type="button"
                            >
                              刪除照片
                            </button>
                          )}
                        <a
                          className="btn"
                          download
                          href={officeImageUrl(
                            taskId,
                            photo.id,
                            'office',
                            photo.variants.office.sha256,
                          )}
                        >
                          下載內業版
                        </a>
                      </div>
                      {expandedHistoryIds.includes(photo.id) && (
                        <OfficePhotoHistory
                          error={historyByPhoto[photo.id]?.error ?? false}
                          headingRef={(node) => {
                            historyHeadings.current[photo.id] = node
                          }}
                          id={`history-${photo.id}`}
                          loading={historyByPhoto[photo.id]?.loading ?? true}
                          moreError={
                            historyByPhoto[photo.id]?.moreError ?? false
                          }
                          moreLoading={
                            historyByPhoto[photo.id]?.moreLoading ?? false
                          }
                          onMore={() => void loadMoreHistory(photo.id)}
                          onRetry={() => void retryHistory(photo.id)}
                          photo={historyByPhoto[photo.id]?.photo ?? photo}
                        />
                      )}
                      {deleting?.id === photo.id && (
                        <ConfirmBox
                          busy={busy}
                          cancelLabel="保留照片"
                          confirmLabel="確認刪除"
                          onCancel={() => setDeleting(null)}
                          onConfirm={confirmDelete}
                          title={`刪除照片｜${photoIdentity(photo)}`}
                          variant="danger"
                        >
                          <p>
                            將軟刪除「{photoIdentity(photo)}
                            」。照片會保留在內業紀錄中， 但不再列入有效照片。
                          </p>
                          {deleteError && (
                            <p className="office-inline-error" role="alert">
                              {deleteError}
                            </p>
                          )}
                        </ConfirmBox>
                      )}
                    </article>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
      {viewingPhoto && (
        <OfficePhotoViewer
          identity={photoIdentity(viewingPhoto)}
          onClose={() => setViewingPhoto(null)}
          photo={viewingPhoto}
          taskId={taskId}
          triggerRef={viewerTrigger}
        />
      )}
      {leaveGuard.pending && (
        <ConfirmBox
          cancelLabel="繼續編修"
          confirmLabel="放棄編修並離開"
          onCancel={leaveGuard.stay}
          onConfirm={leaveGuard.leave}
          title="編修尚未套用"
          variant="danger"
        >
          <p>放棄這次編修，已存內業版不受影響。</p>
        </ConfirmBox>
      )}
    </div>
  )
}

function OfficePhotoHistory({
  photo,
  onMore,
  onRetry,
  loading,
  error,
  moreLoading,
  moreError,
  id,
  headingRef,
}: {
  photo: OfficePhoto
  onMore: () => void
  onRetry: () => void
  loading: boolean
  error: boolean
  moreLoading: boolean
  moreError: boolean
  id: string
  headingRef: (node: HTMLHeadingElement | null) => void
}) {
  const history = photo.layer_history?.items ?? []
  return (
    <section
      aria-label={`圖層修改歷程｜${photoIdentity(photo)}`}
      className="office-history"
      id={id}
    >
      <h3 ref={headingRef} tabIndex={-1}>
        圖層修改歷程｜{photoIdentity(photo)}
      </h3>
      {loading ? (
        <p role="status">正在讀取歷程…</p>
      ) : error ? (
        <div role="alert">
          <p>歷程讀取失敗，請再試一次。</p>
          <button onClick={onRetry} type="button">
            重試
          </button>
        </div>
      ) : history.length === 0 ? (
        <p>這張照片還沒有修改過工程標示。</p>
      ) : (
        <ol className="office-history-list">
          {history.map((entry) => {
            const name = entry.actor.snapshot || '未記錄'
            return (
              <li key={entry.id}>
                <p>
                  {name}・{formatRecordedTime(entry.occurred_at)}
                </p>
                <details>
                  <summary>查看修改前後</summary>
                  <HistoryValues title="修改前" value={entry.before} />
                  <HistoryValues title="修改後" value={entry.after} />
                </details>
              </li>
            )
          })}
        </ol>
      )}
      {photo.layer_history?.next_cursor && !loading && !error && (
        <>
          {moreError && <p role="alert">更多歷程讀取失敗，請再試一次。</p>}
          <button disabled={moreLoading} onClick={onMore} type="button">
            {moreLoading ? '正在讀取更多歷程…' : '載入更多歷程'}
          </button>
        </>
      )}
    </section>
  )
}

function HistoryValues({
  title,
  value,
}: {
  title: string
  value: NonNullable<OfficePhoto['layer_history']>['items'][number]['before']
}) {
  const corner = {
    bottom_left: '左下',
    bottom_right: '右下',
    top_left: '左上',
    top_right: '右上',
  }[value.layer.corner]
  const style = {
    dark: '深色底',
    outline: '白字加描邊',
    paper: '白底黑字',
  }[value.layer.style]
  const size = { small: '小', medium: '中', large: '大' }[value.layer.size]
  const overrides = [
    ['工程名稱', 'project_name', value.labels.project_name],
    ['檢驗項目', 'item_name', value.labels.item_title],
    ['檢驗位置', 'inspection_location', value.labels.location],
  ] as const
  return (
    <div className="office-history-values">
      <h4>{title}</h4>
      <dl>
        <dt>工程標示</dt>
        <dd>{value.layer.enabled ? '顯示' : '隱藏'}</dd>
        <dt>位置與偏移</dt>
        <dd>
          {corner}・水平 {value.layer.offset_x}・垂直 {value.layer.offset_y}
        </dd>
        <dt>尺寸與樣式</dt>
        <dd>
          {size}・{style}
        </dd>
        {overrides.map(([label, key, source]) => {
          const hasOverride = Object.prototype.hasOwnProperty.call(
            value.layer.overrides,
            key,
          )
          const override = value.layer.overrides[key]
          const description = hasOverride
            ? override === ''
              ? '明示空字串'
              : `自訂文字：${override}`
            : `沿用來源：${source ?? '未記錄'}`
          return (
            <Fragment key={key}>
              <dt>{label}</dt>
              <dd>{description}</dd>
            </Fragment>
          )
        })}
        <dt>檢驗人員</dt>
        <dd>{value.labels.uploader_name ?? '未記錄'}</dd>
        <dt>檢驗時間</dt>
        <dd>{formatRecordedTime(value.labels.uploaded_at)}</dd>
      </dl>
    </div>
  )
}
