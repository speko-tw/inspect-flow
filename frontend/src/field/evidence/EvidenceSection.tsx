import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { useCurrentUser } from '../../auth/useCurrentUser'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { SectionHeader } from '../../components/SectionHeader'
import { ResourceState } from '../../components/layout/LayoutPatterns'
import { ConfirmBox } from '../../ui/ConfirmBox'
import { Notice } from '../../ui/Notice'
import { readCaptureTime } from './captureTime'
import { type CaptureTarget, CoverageList, pointLabel } from './CoverageList'
import {
  deletePhoto,
  fetchCoverage,
  fetchFieldPhotos,
  updatePhoto,
} from './evidenceApi'
import {
  type ImageSource,
  canvasToJpeg,
  loadImageSource,
  newIdempotencyKey,
  renderFieldVersion,
  sha256Hex,
} from './imageEdit'
import { LeaveGuard } from './LeaveGuard'
import { mutationFailureMessage } from './messages'
import {
  type EditorState,
  INITIAL_EDITOR_STATE,
  PhotoEditor,
} from './PhotoEditor'
import { type DeleteState, PhotoList } from './PhotoList'
import { TargetForm, type TargetValues } from './TargetForm'
import type {
  CaptureSource,
  Coverage,
  CoverageItem,
  FieldPhoto,
  LayerLabels,
} from './types'
import { UploadList } from './UploadList'
import { useUploadQueue } from './useUploadQueue'
import './evidence.css'

/** 任務詳情已知的狀態；照片寫入只在進行中開放（FEV-R09）。 */
type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

/** 編修中的照片：解碼後的來源、要對應的目標與目前的編修狀態。 */
interface Draft {
  source: ImageSource
  itemId: string
  pointIds: string[]
  overview: boolean
  captureSource: CaptureSource
  capturedAt: string | null
  edit: EditorState
}

/** 確認編修後壓縮好的現場版，只存在記憶體。 */
interface Processed {
  blob: Blob
  sha256: string
  previewUrl: string
}

type View =
  | { kind: 'home' }
  | { kind: 'opening' }
  | { kind: 'editor'; draft: Draft; busy: boolean; error: string }
  | { kind: 'target'; draft: Draft; processed: Processed }
  | { kind: 'modify'; photo: FieldPhoto; busy: boolean; error: string }

type Message = { variant: 'success' | 'error' | 'info'; text: string }

/** 釋放流程中持有的記憶體（解碼影像與預覽網址）。 */
function discard(view: View) {
  if (view.kind === 'editor') view.draft.source.release()
  if (view.kind === 'target') URL.revokeObjectURL(view.processed.previewUrl)
}

/** 目前流程（編修、選項次、修改）對應的查核項目識別。 */
function itemIdOf(view: Exclude<View, { kind: 'home' | 'opening' }>) {
  return view.kind === 'modify' ? view.photo.item_id : view.draft.itemId
}

/** 分區與補充地點合成一行，缺值照規格顯示「未填寫」（FEV-R22）。 */
function locationText(location: {
  zone_name: string | null
  location_text: string | null
}): string {
  return (
    [location.zone_name, location.location_text].filter(Boolean).join('／') ||
    '未填寫'
  )
}

/**
 * 現場任務詳情的照片區（T7、FEV-R02、R05、R08、R15、R23）。
 *
 * 流程：每個項次旁拍照（或從相簿選）→ 編修（旋轉、亮度、圖層）→
 * 選項次與註記 → 上傳；失敗時照片留在畫面、自動重試三次後手動重送。
 * 待上傳照片只在記憶體，不寫任何持久儲存，也沒有離線佇列（FEV-R08），
 * 所以有未完成的照片時離開頁面會先提示。
 *
 * 任務未開始時不顯示拍照，計畫封存、完成或取消後唯讀（FEV-R09）；後端仍會覆核。
 */
export default function EvidenceSection({
  taskId,
  status,
  projectName,
  location,
  mutationsAvailable = false,
  planArchived = false,
}: {
  taskId: string
  status: TaskStatus
  /** FEV-R09：計畫封存優先於任務的進行中狀態，照片只供查看。 */
  planArchived?: boolean
  /** 依計畫 T7 依賴 T5；#794 尚未提供 PATCH／DELETE 時不顯示入口。 */
  mutationsAvailable?: boolean
  projectName: string
  location: { zone_name: string | null; location_text: string | null }
}) {
  const { user } = useCurrentUser()
  const sectionRef = useRef<HTMLElement | null>(null)
  const cameraInput = useRef<HTMLInputElement | null>(null)
  const libraryInput = useRef<HTMLInputElement | null>(null)
  const pendingTarget = useRef<CaptureTarget | null>(null)
  const [coverage, setCoverage] = useState<Coverage | null>(null)
  const [photos, setPhotos] = useState<FieldPhoto[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  )
  const [reloadKey, setReloadKey] = useState(0)
  const [view, setView] = useState<View>({ kind: 'home' })
  const [message, setMessage] = useState<Message | null>(null)
  const [abandoning, setAbandoning] = useState(false)
  const [deleting, setDeleting] = useState<DeleteState | null>(null)
  const [focusHome, setFocusHome] = useState(0)
  const latestView = useRef(view)
  useEffect(() => {
    latestView.current = view
  }, [view])
  useEffect(() => () => discard(latestView.current), [])

  const canCapture = status === 'IN_PROGRESS' && !planArchived
  const visible = status !== 'PENDING'

  const refresh = useCallback(async () => {
    try {
      const [nextCoverage, nextPhotos] = await Promise.all([
        fetchCoverage(taskId),
        fetchFieldPhotos(taskId),
      ])
      setCoverage(nextCoverage)
      setPhotos(nextPhotos)
      setLoadState('ready')
    } catch (error) {
      console.error('Evidence refresh failed:', error)
      setMessage({
        variant: 'error',
        text: '照片資料暫時無法更新，畫面上的內容可能不是最新的。',
      })
    }
  }, [taskId])

  const queue = useUploadQueue(
    taskId,
    useCallback(() => {
      setMessage({ variant: 'success', text: '照片已上傳。' })
      void refresh()
    }, [refresh]),
  )

  useEffect(() => {
    if (!visible) return
    let active = true
    Promise.all([fetchCoverage(taskId), fetchFieldPhotos(taskId)])
      .then(([nextCoverage, nextPhotos]) => {
        if (!active) return
        setCoverage(nextCoverage)
        setPhotos(nextPhotos)
        setLoadState('ready')
      })
      .catch((error: unknown) => {
        console.error('Evidence load failed:', error)
        if (active) setLoadState('error')
      })
    return () => {
      active = false
    }
  }, [reloadKey, taskId, visible])

  // 回到清單後把焦點放回區塊，鍵盤與讀報器使用者不會迷路。
  useEffect(() => {
    if (focusHome > 0) sectionRef.current?.focus({ preventScroll: true })
  }, [focusHome])

  const items = useMemo(() => coverage?.items ?? [], [coverage])
  const itemOf = (itemId: string) =>
    items.find((item) => item.item_id === itemId)

  const labelsFor = (item: CoverageItem): LayerLabels => ({
    project_name: projectName,
    item_title: item.title,
    location: locationText(location),
    uploader_name: user.name_zh ?? user.username,
    uploaded_at: null,
  })

  function goHome(next?: Message | null) {
    discard(latestView.current)
    setView({ kind: 'home' })
    setAbandoning(false)
    if (next !== undefined) setMessage(next)
    setFocusHome((value) => value + 1)
  }

  function startCapture(target: CaptureTarget, source: CaptureSource) {
    if (!canCapture) return
    setMessage(null)
    pendingTarget.current = target
    const input = source === 'camera' ? cameraInput : libraryInput
    input.current?.click()
  }

  async function onFile(
    event: ChangeEvent<HTMLInputElement>,
    captureSource: CaptureSource,
  ) {
    const file = event.target.files?.[0]
    // 清掉選取，同一張照片之後才能再選一次。
    event.target.value = ''
    const target = pendingTarget.current
    if (!canCapture || !file || !target) return
    setView({ kind: 'opening' })
    try {
      const [capturedAt, source] = await Promise.all([
        readCaptureTime(file),
        loadImageSource(file),
      ])
      setView({
        kind: 'editor',
        busy: false,
        error: '',
        draft: {
          source,
          itemId: target.itemId,
          pointIds: target.pointIds,
          overview: target.overview,
          captureSource,
          capturedAt,
          edit: INITIAL_EDITOR_STATE,
        },
      })
    } catch (error) {
      console.error('Selected photo could not be opened:', error)
      goHome({
        variant: 'error',
        text: '無法開啟這張照片，請重新拍攝或改選其他照片。',
      })
    }
  }

  async function confirmEdit(draft: Draft) {
    if (!canCapture) return
    setView({ kind: 'editor', draft, busy: true, error: '' })
    try {
      // 旋轉與亮度在這裡直接烘進現場版再壓縮，不含圖層（FEV-R02）。
      const canvas = renderFieldVersion(draft.source, {
        rotation: draft.edit.rotation,
        brightness: draft.edit.brightness,
      })
      const blob = await canvasToJpeg(canvas)
      const sha256 = await sha256Hex(blob)
      // 原檔不再需要；只留壓縮後的現場版在記憶體。
      draft.source.release()
      setView({
        kind: 'target',
        draft,
        processed: { blob, sha256, previewUrl: URL.createObjectURL(blob) },
      })
    } catch (error) {
      console.error('Photo processing failed:', error)
      setView({
        kind: 'editor',
        draft,
        busy: false,
        error: '無法處理這張照片，請重新拍攝後再試。',
      })
    }
  }

  function submitTarget(values: TargetValues) {
    if (!canCapture || view.kind !== 'target') return
    const { draft, processed } = view
    const item = itemOf(draft.itemId)
    if (!item) return
    const targetText = values.overview
      ? '總覽照片（選拍）'
      : `佐證項次：${item.points
          .filter((point) => values.pointIds.includes(point.id))
          .map(pointLabel)
          .join('、')}`
    // 同一個請求物件（同鍵、同檔）會被送出所有嘗試與手動重送。
    queue.enqueue({
      itemTitle: item.title,
      targetText,
      previewUrl: processed.previewUrl,
      request: {
        key: newIdempotencyKey(),
        file: processed.blob,
        sha256: processed.sha256,
        itemId: draft.itemId,
        isOverview: values.overview,
        pointIds: values.pointIds,
        caption: values.caption,
        capturedAt: draft.capturedAt,
        fieldEdit: {
          rotation: draft.edit.rotation,
          brightness: draft.edit.brightness,
        },
        layer: draft.edit.layer,
        captureSource: draft.captureSource,
      },
    })
    // 預覽網址已交給上傳清單管理，這裡不能釋放。
    setView({ kind: 'home' })
    setFocusHome((value) => value + 1)
    setMessage({
      variant: 'info',
      text: '照片已加入上傳。完成前請留在這個頁面，不要關閉。',
    })
  }

  async function saveModify(photo: FieldPhoto, values: TargetValues) {
    if (!canCapture || !mutationsAvailable) return
    setView({ kind: 'modify', photo, busy: true, error: '' })
    try {
      await updatePhoto(taskId, photo.id, {
        caption: values.caption || null,
        ...(photo.is_overview ? {} : { point_ids: values.pointIds }),
      })
      await refresh()
      goHome({ variant: 'success', text: '已儲存照片說明與項次。' })
    } catch (error) {
      setView({
        kind: 'modify',
        photo,
        busy: false,
        error: mutationFailureMessage(error),
      })
    }
  }

  async function confirmDelete(photo: FieldPhoto) {
    if (!canCapture || !mutationsAvailable) return
    setDeleting({ photoId: photo.id, busy: true, error: '' })
    try {
      await deletePhoto(taskId, photo.id)
      setDeleting(null)
      await refresh()
      setMessage({ variant: 'success', text: '已刪除照片。' })
    } catch (error) {
      setDeleting({
        photoId: photo.id,
        busy: false,
        error: mutationFailureMessage(error),
      })
    }
  }

  function body(): ReactNode {
    if (!visible) {
      return (
        <Card>
          <p>開始查核後，才能依項次拍照上傳。</p>
        </Card>
      )
    }
    if (canCapture && view.kind === 'opening') {
      return (
        <ResourceState
          message="正在開啟照片。"
          state="loading"
          title="開啟照片中"
        />
      )
    }
    if (canCapture && view.kind !== 'home' && !itemOf(itemIdOf(view))) {
      // 查核項目在流程中被更新（例如標準變更）時，舊項次已不存在。
      return (
        <div className="field-notice field-notice-error" role="alert">
          <p>這個查核項目剛更新，請返回重新操作。</p>
          <Button onClick={() => goHome(null)} type="button">
            返回任務
          </Button>
        </div>
      )
    }
    if (canCapture && view.kind === 'editor') {
      const { draft } = view
      const item = itemOf(draft.itemId)
      return (
        <>
          {item && (
            <PhotoEditor
              busy={view.busy}
              error={view.error}
              labels={labelsFor(item)}
              onCancel={() => setAbandoning(true)}
              onChange={(edit) =>
                setView({ ...view, draft: { ...draft, edit } })
              }
              onConfirm={() => void confirmEdit(draft)}
              source={draft.source}
              state={draft.edit}
            />
          )}
          {abandoning && (
            <AbandonBox
              onCancel={() => setAbandoning(false)}
              onConfirm={() => goHome(null)}
              what="編修中的照片"
            />
          )}
        </>
      )
    }
    if (canCapture && view.kind === 'target') {
      const item = itemOf(view.draft.itemId)
      return (
        <>
          {item && (
            <TargetForm
              busy={false}
              error=""
              initial={{
                overview: view.draft.overview,
                pointIds: view.draft.pointIds,
                caption: '',
              }}
              item={item}
              mode="new"
              onBack={() => setAbandoning(true)}
              onSubmit={submitTarget}
              preview={view.processed.previewUrl}
            />
          )}
          {abandoning && (
            <AbandonBox
              onCancel={() => setAbandoning(false)}
              onConfirm={() => goHome(null)}
              what="這張尚未上傳的照片"
            />
          )}
        </>
      )
    }
    if (canCapture && view.kind === 'modify') {
      const { photo } = view
      const item = itemOf(photo.item_id)
      return (
        item && (
          <TargetForm
            busy={view.busy}
            error={view.error}
            initial={{
              overview: photo.is_overview,
              pointIds: photo.point_ids,
              caption: photo.caption ?? '',
            }}
            item={item}
            mode="modify"
            onBack={() => goHome(null)}
            onSubmit={(values) => void saveModify(photo, values)}
          />
        )
      )
    }
    return (
      <>
        <SectionHeader
          className="field-section-head"
          description="依項次拍照；同一張照片可以佐證多個項次，總覽照不計入需求。"
          title={<span id="evidence-heading">照片佐證</span>}
        />
        {message && (
          <Notice
            autoReveal={message.variant === 'error'}
            variant={message.variant}
          >
            {message.text}
          </Notice>
        )}
        {loadState === 'loading' && (
          <ResourceState
            message="正在取得照片張數與清單。"
            state="loading"
            title="載入照片資料中"
          />
        )}
        {loadState === 'error' && (
          <div className="field-notice field-notice-error" role="alert">
            <p>無法載入照片資料，請稍後再試。</p>
            <Button
              onClick={() => {
                setLoadState('loading')
                setReloadKey((value) => value + 1)
              }}
              type="button"
            >
              重試
            </Button>
          </div>
        )}
        {loadState === 'ready' && coverage && (
          <>
            <CoverageList
              canCapture={canCapture}
              coverage={coverage}
              onCapture={startCapture}
            />
            <UploadList
              canResend={canCapture}
              onAbandon={(localId) => {
                queue.abandon(localId)
                setFocusHome((value) => value + 1)
              }}
              onResend={queue.resend}
              uploads={queue.uploads}
            />
            {canCapture && !mutationsAvailable && photos.length > 0 && (
              <p className="evidence-hint">
                照片上傳後的修改與刪除功能尚未開放。
              </p>
            )}
            <PhotoList
              canChange={canCapture && mutationsAvailable}
              coverage={coverage}
              deleting={canCapture ? deleting : null}
              onAskDelete={(photo) =>
                setDeleting({ photoId: photo.id, busy: false, error: '' })
              }
              onCancelDelete={() => setDeleting(null)}
              onConfirmDelete={(photo) => void confirmDelete(photo)}
              onModify={(photo) =>
                setView({ kind: 'modify', photo, busy: false, error: '' })
              }
              photos={photos}
              taskId={taskId}
            />
          </>
        )}
      </>
    )
  }

  return (
    <section
      aria-labelledby={
        visible && view.kind === 'home' ? 'evidence-heading' : undefined
      }
      aria-label={visible && view.kind === 'home' ? undefined : '照片佐證'}
      className="evidence-section"
      ref={sectionRef}
      tabIndex={-1}
    >
      {/* 守衛與檔案選擇器放在最外層，各步驟切換時不會被重建。 */}
      <LeaveGuard active={view.kind !== 'home' || queue.uploads.length > 0} />
      <input
        accept="image/*"
        aria-label="使用相機拍照"
        capture="environment"
        disabled={!canCapture}
        hidden
        onChange={(event) => void onFile(event, 'camera')}
        ref={cameraInput}
        type="file"
      />
      <input
        accept="image/*"
        aria-label="從相簿選照片"
        disabled={!canCapture}
        hidden
        onChange={(event) => void onFile(event, 'library')}
        ref={libraryInput}
        type="file"
      />
      {planArchived && (
        <Notice variant="info">
          所屬計畫已封存，照片只能查看，無法新增、修改或刪除。
        </Notice>
      )}
      {body()}
    </section>
  )
}

/** 放棄尚未上傳的照片前的頁內確認；說明對象與後果（FEV-R15）。 */
function AbandonBox({
  what,
  onCancel,
  onConfirm,
}: {
  what: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <ConfirmBox
      cancelLabel="繼續處理"
      confirmLabel="放棄照片"
      headingLevel={3}
      onCancel={onCancel}
      onConfirm={onConfirm}
      title="放棄這張照片？"
      variant="danger"
    >
      <p>要放棄{what}。照片還沒有上傳，放棄後無法找回；需要時請重新拍攝。</p>
    </ConfirmBox>
  )
}
