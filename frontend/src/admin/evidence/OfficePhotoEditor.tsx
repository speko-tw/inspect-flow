import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { ConfirmBox } from '../../ui/ConfirmBox'
import { fieldErrorMessage, mapFieldErrors } from '../../ui/fieldErrors'
import type { HttpFieldError } from '../../http'
import {
  fitCropRatio,
  moveCrop,
  orientedSize,
  resizeCrop,
  type CropHandle,
  type CropRect,
} from './geometry'
import {
  clampLayerOffset,
  getEditedImageSize,
  getLayerBox,
  getLayerPreviewRect,
  moveLayerOffset,
} from './layerGeometry'
import { formatRecordedTime } from './labelTime'
import {
  officeImageUrl,
  type OfficeEdit,
  type OfficeLayer,
  type OfficePhoto,
} from './api'

type Props = {
  photo: OfficePhoto
  taskId: string
  busy: boolean
  error: string
  validation: { code?: string; fields?: HttpFieldError[] } | null
  leaveGuard: { pending: boolean; stay: () => void; leave: () => void }
  onCancel: () => void
  onDirtyChange: (dirty: boolean) => void
  onErrorClear: () => void
  onSave: (input: OfficeEdit & { layer?: OfficeLayer }) => Promise<boolean>
}

type Crop = CropRect
type RatioChoice = 'free' | 'original' | '1:1' | '4:3' | '16:9'
type Snapshot = {
  edit: OfficeEdit
  crop: Crop | null
  ratio: number | null
  ratioChoice: RatioChoice
}
type LayerDrag = {
  pointerId: number
  x: number
  y: number
  layer: OfficeLayer
}
const OFFICE_FIELD_BINDINGS = [
  { path: '/rotation', key: 'rotation' },
  { path: '/straighten', key: 'straighten' },
  { path: '/brightness', key: 'brightness' },
  { path: '/crop/x', key: 'crop_x' },
  { path: '/crop/y', key: 'crop_y' },
  { path: '/crop/width', key: 'crop_width' },
  { path: '/crop/height', key: 'crop_height' },
  { path: '/layer/enabled', key: 'layer_enabled' },
  { path: '/layer/corner', key: 'layer_corner' },
  { path: '/layer/offset_x', key: 'layer_offset_x' },
  { path: '/layer/offset_y', key: 'layer_offset_y' },
  { path: '/layer/size', key: 'layer_size' },
  { path: '/layer/style', key: 'layer_style' },
  { path: '/layer/overrides/project_name', key: 'project_name' },
  { path: '/layer/overrides/item_name', key: 'item_name' },
  {
    path: '/layer/overrides/inspection_location',
    key: 'inspection_location',
  },
] as const
type OfficeFieldKey = (typeof OFFICE_FIELD_BINDINGS)[number]['key']
const FIELD_KEY_BY_PATH = new Map<string, OfficeFieldKey>(
  OFFICE_FIELD_BINDINGS.map(({ path, key }) => [path, key]),
)
const FIELD_ERROR_IDS: Record<OfficeFieldKey, string> = {
  rotation: 'office-error-rotation',
  straighten: 'office-error-straighten',
  brightness: 'office-error-brightness',
  crop_x: 'office-error-crop-x',
  crop_y: 'office-error-crop-y',
  crop_width: 'office-error-crop-width',
  crop_height: 'office-error-crop-height',
  layer_enabled: 'office-error-layer-enabled',
  layer_corner: 'office-error-layer-corner',
  layer_offset_x: 'office-error-layer-offset-x',
  layer_offset_y: 'office-error-layer-offset-y',
  layer_size: 'office-error-layer-size',
  layer_style: 'office-error-layer-style',
  project_name: 'office-error-project-name',
  item_name: 'office-error-item-name',
  inspection_location: 'office-error-inspection-location',
}
const INITIAL_CROP: Crop = { x: 0.08, y: 0.08, width: 0.84, height: 0.84 }
const CROP_HANDLE_LABELS: Record<CropHandle, string> = {
  move: '中央',
  nw: '左上角',
  n: '上方中點',
  ne: '右上角',
  e: '右側中點',
  se: '右下角',
  s: '下方中點',
  sw: '左下角',
  w: '左側中點',
}

function straightenScale(
  width: number,
  height: number,
  degrees: number,
): number {
  const radians = Math.abs((degrees * Math.PI) / 180)
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return Math.max(
    cosine + (height / width) * sine,
    cosine + (width / height) * sine,
  )
}

/** 內業影像編修器：保存參數交由正式 OFFICE API 產製。 */
export function OfficePhotoEditor({
  photo,
  taskId,
  busy,
  error,
  validation,
  leaveGuard,
  onCancel,
  onDirtyChange,
  onErrorClear,
  onSave,
}: Props) {
  const frame = useRef<HTMLDivElement>(null)
  const imageStage = useRef<HTMLDivElement>(null)
  const ratioSelect = useRef<HTMLSelectElement>(null)
  const brightnessControl = useRef<HTMLInputElement>(null)
  const straightenControl = useRef<HTMLInputElement>(null)
  const rotationControl = useRef<HTMLButtonElement>(null)
  const cropHandles = useRef<Partial<Record<CropHandle, HTMLButtonElement>>>(
    {},
  )
  const layerControl = useRef<HTMLSelectElement>(null)
  const layerEnabledControl = useRef<HTMLInputElement>(null)
  const layerOffsetXControl = useRef<HTMLInputElement>(null)
  const layerOffsetYControl = useRef<HTMLInputElement>(null)
  const layerSizeControl = useRef<HTMLSelectElement>(null)
  const layerStyleControl = useRef<HTMLSelectElement>(null)
  const overrideControls = useRef<
    Partial<
      Record<
        'project_name' | 'item_name' | 'inspection_location',
        HTMLInputElement
      >
    >
  >({})
  const layerDrag = useRef<LayerDrag | null>(null)
  const drag = useRef<{
    kind: CropHandle
    x: number
    y: number
    crop: Crop
    ratio: number | null
  } | null>(null)
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinchDistance = useRef(0)
  const zoomRef = useRef(1)
  const savedParams = photo.variants.office.edit_params
  const savedEdit: OfficeEdit = {
    rotation:
      savedParams?.rotation === 90 ||
      savedParams?.rotation === 180 ||
      savedParams?.rotation === 270
        ? savedParams.rotation
        : 0,
    straighten:
      typeof savedParams?.straighten === 'number' ? savedParams.straighten : 0,
    crop:
      savedParams?.crop && typeof savedParams.crop === 'object'
        ? (savedParams.crop as OfficeEdit['crop'])
        : null,
    brightness:
      typeof savedParams?.brightness === 'number' ? savedParams.brightness : 0,
  }
  const [edit, setEdit] = useState<OfficeEdit>(savedEdit)
  const [crop, setCrop] = useState<Crop | null>(savedEdit?.crop ?? null)
  const [history, setHistory] = useState<Snapshot[]>([])
  const [ratio, setRatio] = useState<number | null>(null)
  const [ratioChoice, setRatioChoice] = useState<RatioChoice>('free')
  const [tab, setTab] = useState<'crop' | 'adjust' | 'layer'>('crop')
  const hasLayerField = validation?.fields?.some((field) =>
    field.path.startsWith('/layer/'),
  )
  const hasBrightnessField = validation?.fields?.some(
    (field) => field.path === '/brightness',
  )
  const hasCropField = validation?.fields?.some((field) =>
    /^\/(crop|rotation|straighten)(\/|$)/.test(field.path),
  )
  const activeTab = hasLayerField
    ? 'layer'
    : hasCropField
      ? 'crop'
      : hasBrightnessField
        ? 'adjust'
        : validation?.code === 'evidence.invalid_layer'
          ? 'layer'
          : validation?.code === 'evidence.invalid_edit'
            ? 'crop'
            : tab
  const [compare, setCompare] = useState(false)
  const [comparePinned, setComparePinned] = useState(false)
  const [cropStep, setCropStep] = useState<0.005 | 0.02>(0.005)
  const [layerStep, setLayerStep] = useState<0.005 | 0.02>(0.005)
  const [selectedCropHandle, setSelectedCropHandle] =
    useState<CropHandle | null>(null)
  const [selectedControl, setSelectedControl] = useState('')
  const showBefore = compare || comparePinned
  const [layer, setLayer] = useState<OfficeLayer>(() => ({
    ...photo.layer,
    size:
      photo.layer_render.effective_size === 'small' ||
      photo.layer_render.effective_size === 'medium' ||
      photo.layer_render.effective_size === 'large'
        ? photo.layer_render.effective_size
        : photo.layer.size,
    overrides: { ...photo.layer.overrides },
  }))
  const [layerChanged, setLayerChanged] = useState(false)
  const imageCrop = crop ?? { x: 0, y: 0, width: 1, height: 1 }
  const layerImageSize = getEditedImageSize(
    photo.variants.field.width,
    photo.variants.field.height,
    { rotation: edit.rotation, crop },
  )
  const layerBox = getLayerBox(layerImageSize, layer)
  const smallLayerBox = getLayerBox(layerImageSize, {
    ...layer,
    size: 'small',
  })
  const layerPreview = getLayerPreviewRect(
    photo.variants.field.width,
    photo.variants.field.height,
    { rotation: edit.rotation, crop },
    layer,
  )
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [fieldError, setFieldError] = useState('')
  const [leaveConfirm, setLeaveConfirm] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [pendingApply, setPendingApply] = useState<
    (OfficeEdit & { layer?: OfficeLayer }) | null
  >(null)
  const [submitting, setSubmitting] = useState(false)
  const submitRef = useRef(false)
  const fieldErrorRef = useRef<HTMLParagraphElement>(null)
  const formattedIdentityTime = new Intl.DateTimeFormat('zh-TW', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Taipei',
  }).format(new Date(photo.captured_at ?? photo.uploaded_at))
  const identityTime = photo.captured_at
    ? formattedIdentityTime
    : `上傳時間 ${formattedIdentityTime}`
  const identity = `${photo.uploaded_by.name_zh ?? '未記錄拍照者'}・${identityTime}`
  const imageSize = orientedSize(
    photo.variants.field.width,
    photo.variants.field.height,
    edit.rotation,
  )
  const sceneSize = showBefore
    ? {
        width: photo.variants.field.width,
        height: photo.variants.field.height,
      }
    : imageSize
  const fieldErrors = mapFieldErrors(
    validation?.fields ?? [],
    OFFICE_FIELD_BINDINGS,
  ).errors as Partial<Record<OfficeFieldKey, string>>
  const hasMappedFieldErrors = Object.keys(fieldErrors).length > 0
  const shortEdge = Math.min(imageSize.width, imageSize.height)
  const layerFields = [
    ['工程名稱', layer.overrides.project_name ?? photo.labels.project_name],
    ['檢驗項目', layer.overrides.item_name ?? photo.labels.item_title],
    ['檢驗位置', layer.overrides.inspection_location ?? photo.labels.location],
    ['檢驗人員', photo.labels.uploader_name ?? photo.uploaded_by.name_zh],
    ['檢驗時間', formatRecordedTime(photo.labels.uploaded_at)],
  ] as const
  const layerSummary = layerFields
    .map(([title, value]) => `${title}：${value ?? '未記錄'}`)
    .join('；')
  const layerOverlayClassName = [
    'office-layer-overlay',
    'office-layer-table',
    `office-layer-table--${layer.style}`,
  ].join(' ')

  function renderFieldError(key: OfficeFieldKey, label: string) {
    const code = fieldErrors[key]
    if (!code) return null
    return (
      <p
        className="office-inline-error"
        id={FIELD_ERROR_IDS[key]}
        role="alert"
      >
        {label}：{fieldErrorMessage(code)}
      </p>
    )
  }

  function fieldErrorId(key: OfficeFieldKey): string | undefined {
    return fieldErrors[key] ? FIELD_ERROR_IDS[key] : undefined
  }

  function fieldErrorIds(...keys: string[]): string | undefined {
    const ids = keys
      .map((key) => fieldErrorId(key as OfficeFieldKey))
      .filter(Boolean)
    return ids.length ? ids.join(' ') : undefined
  }

  const focusMappedField = useCallback((): boolean => {
    const field = validation?.fields?.find(({ path }) =>
      FIELD_KEY_BY_PATH.has(path),
    )
    if (!field) return false
    const key = FIELD_KEY_BY_PATH.get(field.path)
    let target: HTMLElement | null = null
    if (key?.startsWith('layer_') || key?.includes('name')) {
      setTab('layer')
    } else if (key === 'brightness') {
      setTab('adjust')
    } else {
      setTab('crop')
    }
    switch (key) {
      case 'rotation':
        target = rotationControl.current
        break
      case 'straighten':
        target = straightenControl.current
        break
      case 'brightness':
        target = brightnessControl.current
        break
      case 'crop_x':
      case 'crop_y':
        target = cropHandles.current.move ?? null
        break
      case 'crop_width':
        target = cropHandles.current.e ?? cropHandles.current.w ?? null
        break
      case 'crop_height':
        target = cropHandles.current.s ?? cropHandles.current.n ?? null
        break
      case 'layer_enabled':
        target = layerEnabledControl.current
        break
      case 'layer_corner':
        target = layerControl.current
        break
      case 'layer_offset_x':
        target = layerOffsetXControl.current
        break
      case 'layer_offset_y':
        target = layerOffsetYControl.current
        break
      case 'layer_size':
        target = layerSizeControl.current
        break
      case 'layer_style':
        target = layerStyleControl.current
        break
      case 'project_name':
      case 'item_name':
      case 'inspection_location':
        target = overrideControls.current[key] ?? null
        break
    }
    target?.focus({ preventScroll: true })
    return Boolean(target)
  }, [validation])

  function markDirty(): void {
    setIsDirty(true)
    onDirtyChange(true)
  }

  useEffect(() => {
    if (!error && !validation) return
    requestAnimationFrame(() => {
      if (focusMappedField()) return
      if (validation?.code === 'evidence.invalid_layer')
        layerControl.current?.focus()
      else if (validation?.code === 'evidence.invalid_edit')
        ratioSelect.current?.focus()
      else fieldErrorRef.current?.focus()
    })
  }, [error, focusMappedField, validation])

  function snapshot(): Snapshot {
    return { edit, crop, ratio, ratioChoice }
  }

  function saveSnapshot(): void {
    const current = snapshot()
    setHistory((items) => [...items.slice(-19), current])
  }

  function ratioFor(choice: RatioChoice, rotation: number): number | null {
    if (choice === 'free') return null
    const size = orientedSize(
      photo.variants.field.width,
      photo.variants.field.height,
      rotation,
    )
    const aspect = size.width / size.height
    const wanted =
      choice === 'original'
        ? aspect
        : choice === '1:1'
          ? 1
          : choice === '4:3'
            ? 4 / 3
            : 16 / 9
    return wanted / aspect
  }

  function pushEdit(next: OfficeEdit) {
    onErrorClear()
    markDirty()
    saveSnapshot()
    setEdit(next)
    if (next.rotation !== edit.rotation && ratioChoice !== 'free') {
      const nextRatio = ratioFor(ratioChoice, next.rotation)
      setRatio(nextRatio)
      if (crop && nextRatio) {
        const size = orientedSize(
          photo.variants.field.width,
          photo.variants.field.height,
          next.rotation,
        )
        setCrop(fitCropRatio(crop, nextRatio, size.width, size.height))
      }
    }
  }
  function changeLayer(update: (value: OfficeLayer) => OfficeLayer) {
    onErrorClear()
    markDirty()
    setLayer((value) => update(value))
    setLayerChanged(true)
  }
  function setLayerValue<K extends keyof OfficeLayer>(
    key: K,
    value: OfficeLayer[K],
  ) {
    changeLayer((current) => ({ ...current, [key]: value }))
  }
  function setLayerOffset(offsetX: number, offsetY: number): void {
    const next = clampLayerOffset(layerImageSize, layer, offsetX, offsetY)
    changeLayer((current) => ({ ...current, ...next }))
  }
  function nudgeLayer(
    direction: 'left' | 'right' | 'up' | 'down',
    fast: boolean,
  ) {
    const step = fast ? 0.02 : layerStep
    const deltaX =
      direction === 'left'
        ? -step * layerImageSize.width
        : direction === 'right'
          ? step * layerImageSize.width
          : 0
    const deltaY =
      direction === 'up'
        ? -step * layerImageSize.height
        : direction === 'down'
          ? step * layerImageSize.height
          : 0
    const next = moveLayerOffset(layerImageSize, layer, deltaX, deltaY)
    changeLayer((current) => ({ ...current, ...next }))
  }
  function startLayerDrag(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.pointerType === 'touch' && touches.current.size > 1) {
      layerDrag.current = null
      drag.current = null
      return
    }
    if (event.pointerType === 'touch' && zoomRef.current > 1) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    layerDrag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      layer,
    }
  }
  function moveLayerDrag(event: React.PointerEvent<HTMLDivElement>): void {
    const current = layerDrag.current
    const stage = imageStage.current?.getBoundingClientRect()
    if (!current || current.pointerId !== event.pointerId || !stage) return
    const displayWidth = stage.width * imageCrop.width
    const displayHeight = stage.height * imageCrop.height
    if (displayWidth <= 0 || displayHeight <= 0) return
    const deltaX =
      ((event.clientX - current.x) * layerImageSize.width) / displayWidth
    const deltaY =
      ((event.clientY - current.y) * layerImageSize.height) / displayHeight
    const next = moveLayerOffset(layerImageSize, current.layer, deltaX, deltaY)
    if (next.offset_x !== layer.offset_x || next.offset_y !== layer.offset_y) {
      changeLayer((value) => ({ ...value, ...next }))
    }
  }
  function handleLayerKey(event: React.KeyboardEvent<HTMLDivElement>): void {
    const directions = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
    } as const
    const direction = directions[event.key as keyof typeof directions]
    if (!direction) return
    event.preventDefault()
    nudgeLayer(direction, event.shiftKey)
  }
  function setCropValue(next: Crop) {
    onErrorClear()
    markDirty()
    setCrop({
      ...next,
      x: Math.max(0, Math.min(1 - next.width, next.x)),
      y: Math.max(0, Math.min(1 - next.height, next.y)),
    })
  }
  function handleKey(
    kind: CropHandle,
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) {
    if (
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
    )
      return
    event.preventDefault()
    saveSnapshot()
    const size = orientedSize(
      photo.variants.field.width,
      photo.variants.field.height,
      edit.rotation,
    )
    const amount = event.shiftKey ? 0.02 : cropStep
    const current = crop ?? INITIAL_CROP
    const dx =
      event.key === 'ArrowLeft'
        ? -amount
        : event.key === 'ArrowRight'
          ? amount
          : 0
    const dy =
      event.key === 'ArrowUp'
        ? -amount
        : event.key === 'ArrowDown'
          ? amount
          : 0
    const next =
      kind === 'move'
        ? moveCrop(current, dx, dy)
        : resizeCrop(current, kind, dx, dy, ratio, size.width, size.height)
    setCropValue(next)
  }
  function nudgeCrop(direction: 'left' | 'right' | 'up' | 'down'): void {
    const kind = selectedCropHandle ?? 'move'
    const amount = cropStep
    const size = orientedSize(
      photo.variants.field.width,
      photo.variants.field.height,
      edit.rotation,
    )
    const dx =
      direction === 'left' ? -amount : direction === 'right' ? amount : 0
    const dy = direction === 'up' ? -amount : direction === 'down' ? amount : 0
    const current = crop ?? INITIAL_CROP
    const next =
      kind === 'move'
        ? moveCrop(current, dx, dy)
        : resizeCrop(current, kind, dx, dy, ratio, size.width, size.height)
    saveSnapshot()
    setCropValue(next)
  }
  function startDrag(kind: CropHandle, event: React.PointerEvent) {
    if (event.pointerType === 'touch' && touches.current.size > 1) {
      drag.current = null
      layerDrag.current = null
      return
    }
    if (event.pointerType === 'touch' && zoomRef.current > 1) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    saveSnapshot()
    drag.current = {
      kind,
      x: event.clientX,
      y: event.clientY,
      crop: crop ?? INITIAL_CROP,
      ratio,
    }
  }
  function moveDrag(event: React.PointerEvent) {
    const start = drag.current
    if (!start || !imageStage.current) return
    const bounds = imageStage.current.getBoundingClientRect()
    const dx = (event.clientX - start.x) / bounds.width
    const dy = (event.clientY - start.y) / bounds.height
    const c = start.crop
    const size = orientedSize(
      photo.variants.field.width,
      photo.variants.field.height,
      edit.rotation,
    )
    const next =
      start.kind === 'move'
        ? moveCrop(c, dx, dy)
        : resizeCrop(
            c,
            start.kind,
            dx,
            dy,
            start.ratio,
            size.width,
            size.height,
          )
    setCropValue(next)
  }
  function applyRatio(value: RatioChoice) {
    saveSnapshot()
    const ratioValue = ratioFor(value, edit.rotation)
    setRatioChoice(value)
    setRatio(ratioValue)
    if (!ratioValue) {
      setCropValue(crop ?? INITIAL_CROP)
      return
    }
    const size = orientedSize(
      photo.variants.field.width,
      photo.variants.field.height,
      edit.rotation,
    )
    setCropValue(
      fitCropRatio(crop ?? INITIAL_CROP, ratioValue, size.width, size.height),
    )
  }
  function adjustZoom(factor: number) {
    setZoom((current) => Math.max(1, Math.min(4, current * factor)))
  }
  function save() {
    setFieldError('')
    onErrorClear()
    const params = { ...edit, crop: crop ?? edit.crop }
    const targetCrop = params.crop
    const sourceSize = orientedSize(
      photo.variants.field.width,
      photo.variants.field.height,
      edit.rotation,
    )
    if (
      targetCrop &&
      (targetCrop.width * sourceSize.width < 64 ||
        targetCrop.height * sourceSize.height < 64)
    ) {
      setTab('crop')
      setFieldError('裁切範圍至少要保留 64 × 64 像素。')
      requestAnimationFrame(() => ratioSelect.current?.focus())
      return
    }
    setPendingApply(layerChanged ? { ...params, layer } : params)
  }

  async function confirmApply() {
    if (!pendingApply || submitRef.current) return
    submitRef.current = true
    setSubmitting(true)
    try {
      const ok = await onSave(pendingApply)
      setPendingApply(null)
      if (!ok) {
        setTab(layerChanged ? 'layer' : 'crop')
      }
    } finally {
      submitRef.current = false
      setSubmitting(false)
    }
  }

  useEffect(() => {
    const element = frame.current
    if (!element) return
    const down = (event: PointerEvent) => {
      touches.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      })
      if (touches.current.size === 2) {
        drag.current = null
        layerDrag.current = null
        const points = [...touches.current.values()]
        pinchDistance.current = Math.hypot(
          points[0].x - points[1].x,
          points[0].y - points[1].y,
        )
      }
    }
    const move = (event: PointerEvent) => {
      if (!touches.current.has(event.pointerId)) return
      const previous = touches.current.get(event.pointerId)!
      touches.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      })
      if (touches.current.size === 2) {
        const points = [...touches.current.values()]
        const next = Math.hypot(
          points[0].x - points[1].x,
          points[0].y - points[1].y,
        )
        const previousDistance = pinchDistance.current
        if (previousDistance > 0 && next > 0) {
          const scale = next / previousDistance
          setZoom((value) => Math.max(1, Math.min(4, value * scale)))
        }
        pinchDistance.current = next
      } else if (touches.current.size === 1 && zoomRef.current > 1) {
        setPan((value) => ({
          x: value.x + event.clientX - previous.x,
          y: value.y + event.clientY - previous.y,
        }))
      }
    }
    const up = (event: PointerEvent) => {
      touches.current.delete(event.pointerId)
      if (touches.current.size < 2) pinchDistance.current = 0
    }
    element.addEventListener('pointerdown', down)
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', up)
    return () => {
      element.removeEventListener('pointerdown', down)
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', up)
    }
  }, [])

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  return (
    <main className="office-editor" aria-labelledby="office-editor-title">
      <header className="office-editor-header">
        <button
          type="button"
          onClick={() => {
            if (!isDirty) onCancel()
            else setLeaveConfirm(true)
          }}
        >
          取消
        </button>
        <h2 id="office-editor-title">編修內業版</h2>
        <button
          className="btn-primary"
          type="button"
          disabled={busy || submitting}
          onClick={save}
        >
          {busy ? '儲存中…' : '確認'}
        </button>
      </header>
      <div className="office-editor-workspace">
        <section
          aria-label="照片編修畫布"
          className="office-canvas-area"
          onBlurCapture={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setSelectedControl('')
          }}
        >
          <div
            className="office-canvas"
            ref={frame}
            onPointerMove={moveDrag}
            onPointerUp={() => {
              drag.current = null
            }}
          >
            <div
              className="office-image-stage"
              ref={imageStage}
              tabIndex={0}
              role="group"
              aria-label="照片畫面，可用方向鍵平移"
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || zoom <= 1) return
                const delta = event.shiftKey ? 48 : 24
                if (event.key === 'ArrowLeft')
                  setPan((value) => ({ ...value, x: value.x - delta }))
                else if (event.key === 'ArrowRight')
                  setPan((value) => ({ ...value, x: value.x + delta }))
                else if (event.key === 'ArrowUp')
                  setPan((value) => ({ ...value, y: value.y - delta }))
                else if (event.key === 'ArrowDown')
                  setPan((value) => ({ ...value, y: value.y + delta }))
                else return
                event.preventDefault()
              }}
              style={{
                aspectRatio: `${sceneSize.width} / ${sceneSize.height}`,
                width: `min(100%, ${
                  (sceneSize.width / sceneSize.height) * 65
                }vh)`,
                transform: showBefore
                  ? 'none'
                  : `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: 'center',
              }}
            >
              {(() => {
                const size = orientedSize(
                  photo.variants.field.width,
                  photo.variants.field.height,
                  edit.rotation,
                )
                const quarterTurn = !showBefore && edit.rotation % 180 !== 0
                const originalAspect =
                  photo.variants.field.width / photo.variants.field.height
                const straightening = straightenScale(
                  size.width,
                  size.height,
                  edit.straighten,
                )
                return (
                  <img
                    alt="內業版照片預覽"
                    draggable="false"
                    src={officeImageUrl(
                      taskId,
                      photo.id,
                      'field',
                      photo.variants.field.sha256,
                    )}
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: '50%',
                      width: quarterTurn ? `${originalAspect * 100}%` : '100%',
                      height: quarterTurn
                        ? `${(1 / originalAspect) * 100}%`
                        : '100%',
                      objectFit: showBefore ? 'contain' : 'fill',
                      transform: [
                        'translate(-50%, -50%)',
                        `rotate(${
                          showBefore ? 0 : edit.rotation + edit.straighten
                        }deg)`,
                        `scale(${showBefore ? 1 : straightening})`,
                      ].join(' '),
                      filter: `brightness(${
                        showBefore ? 1 : 1 + edit.brightness / 200
                      })`,
                    }}
                  />
                )
              })()}
              {!showBefore && (
                <div
                  className="office-crop-frame"
                  style={
                    crop
                      ? {
                          left: `${crop.x * 100}%`,
                          top: `${crop.y * 100}%`,
                          width: `${crop.width * 100}%`,
                          height: `${crop.height * 100}%`,
                        }
                      : undefined
                  }
                  onPointerDown={(event) => startDrag('move', event)}
                >
                  <button
                    aria-label="移動裁切框"
                    className="office-crop-move"
                    ref={(node) => {
                      if (node) cropHandles.current.move = node
                      else delete cropHandles.current.move
                    }}
                    aria-describedby={fieldErrorIds('crop_x', 'crop_y')}
                    onFocus={() => {
                      setSelectedCropHandle('move')
                      setSelectedControl('裁切框中央')
                    }}
                    onKeyDown={(event) => handleKey('move', event)}
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      setSelectedCropHandle('move')
                      setSelectedControl('裁切框中央')
                      startDrag('move', event)
                    }}
                    type="button"
                  />
                  {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map(
                    (handle) => (
                      <button
                        aria-label={`裁切框${CROP_HANDLE_LABELS[handle]}控制點`}
                        className={`office-crop-handle office-crop-${handle}`}
                        ref={(node) => {
                          if (node) cropHandles.current[handle] = node
                          else delete cropHandles.current[handle]
                        }}
                        aria-describedby={fieldErrorIds(
                          ...(handle === 'n'
                            ? ['crop_y', 'crop_height']
                            : handle === 'ne'
                              ? ['crop_y', 'crop_width']
                              : handle === 'e'
                                ? ['crop_width']
                                : handle === 'se'
                                  ? ['crop_width', 'crop_height']
                                  : handle === 's'
                                    ? ['crop_height']
                                    : handle === 'sw'
                                      ? ['crop_x', 'crop_height']
                                      : handle === 'w'
                                        ? ['crop_x', 'crop_width']
                                        : ['crop_x', 'crop_y']),
                        )}
                        key={handle}
                        onFocus={() => {
                          setSelectedCropHandle(handle)
                          setSelectedControl(
                            `裁切框${CROP_HANDLE_LABELS[handle]}控制點`,
                          )
                        }}
                        onKeyDown={(event) => handleKey(handle, event)}
                        onPointerDown={(event) => {
                          event.stopPropagation()
                          setSelectedCropHandle(handle)
                          setSelectedControl(
                            `裁切框${CROP_HANDLE_LABELS[handle]}控制點`,
                          )
                          startDrag(handle, event)
                        }}
                        type="button"
                      />
                    ),
                  )}
                </div>
              )}
              {layer.enabled && layerBox.fits && !showBefore && (
                <div
                  aria-label={
                    activeTab === 'layer' ? '圖層位置，方向鍵微調' : undefined
                  }
                  aria-hidden={activeTab !== 'layer'}
                  className={
                    activeTab === 'layer'
                      ? 'office-layer-position office-layer-draggable'
                      : 'office-layer-position'
                  }
                  tabIndex={activeTab === 'layer' ? 0 : undefined}
                  onFocus={() => setSelectedControl('工程標示')}
                  onKeyDown={
                    activeTab === 'layer' ? handleLayerKey : undefined
                  }
                  onPointerCancel={() => {
                    layerDrag.current = null
                  }}
                  onPointerDown={
                    activeTab === 'layer'
                      ? (event) => {
                          setSelectedControl('工程標示')
                          startLayerDrag(event)
                        }
                      : undefined
                  }
                  onPointerMove={
                    activeTab === 'layer' ? moveLayerDrag : undefined
                  }
                  onPointerUp={() => {
                    layerDrag.current = null
                  }}
                  role={activeTab === 'layer' ? 'group' : undefined}
                  style={{
                    left: `${layerPreview.left * 100}%`,
                    top: `${layerPreview.top * 100}%`,
                    width: `${layerPreview.width * 100}%`,
                    height: `${layerPreview.height * 100}%`,
                  }}
                >
                  <div
                    aria-hidden="true"
                    className={layerOverlayClassName}
                    style={
                      {
                        '--office-font-ratio': layerBox.fontSize / shortEdge,
                        '--office-inner-ratio': layerBox.inner / shortEdge,
                        '--office-line-height-ratio':
                          layerBox.lineHeight / shortEdge,
                        '--office-row-height-ratio':
                          layerBox.rowHeight / shortEdge,
                        '--office-title-width-ratio':
                          layerBox.titleColumnWidth / shortEdge,
                        '--office-value-width-ratio':
                          (layerBox.width -
                            2 * layerBox.inner -
                            layerBox.titleColumnWidth) /
                          shortEdge,
                        '--office-line-width-ratio':
                          layerBox.lineWidth / shortEdge,
                        '--office-radius-ratio': layerBox.radius / shortEdge,
                        '--office-outline-width-ratio':
                          layerBox.outlineWidth / shortEdge,
                      } as React.CSSProperties
                    }
                  >
                    {layerFields.flatMap(([title, value], index) => [
                      <span
                        className="office-layer-table__title"
                        key={`t-${index}`}
                      >
                        {title}
                      </span>,
                      <span
                        className="office-layer-table__value"
                        key={`v-${index}`}
                      >
                        {value ?? '未記錄'}
                      </span>,
                    ])}
                  </div>
                </div>
              )}
            </div>
          </div>
          {layer.enabled && layerBox.fits && (
            <p className="office-sr-only">工程標示預覽。{layerSummary}</p>
          )}
          {selectedControl && (
            <p className="office-selection-status" role="status">
              已選取：{selectedControl}。
              <span className="office-keyboard-hint">
                按 <kbd>←</kbd>
                <kbd>→</kbd>
                <kbd>↑</kbd>
                <kbd>↓</kbd> 微調；加按
                <kbd>Shift</kbd> 一次移動較多。也可以用下方箭頭按鈕。
              </span>
            </p>
          )}
          <details className="office-canvas-tools">
            <summary>放大／移動畫面</summary>
            <div className="office-canvas-controls">
              <p>放大照片後可用箭頭平移，縮放能看清裁切細節。</p>
              <button
                aria-label="畫面向左平移"
                onClick={() =>
                  setPan((value) => ({ ...value, x: value.x - 24 }))
                }
                type="button"
              >
                ←
              </button>
              <button
                aria-label="畫面向上平移"
                onClick={() =>
                  setPan((value) => ({ ...value, y: value.y - 24 }))
                }
                type="button"
              >
                ↑
              </button>
              <button
                aria-label="畫面向下平移"
                onClick={() =>
                  setPan((value) => ({ ...value, y: value.y + 24 }))
                }
                type="button"
              >
                ↓
              </button>
              <button
                aria-label="畫面向右平移"
                onClick={() =>
                  setPan((value) => ({ ...value, x: value.x + 24 }))
                }
                type="button"
              >
                →
              </button>
              <button
                aria-label="縮小"
                onClick={() => adjustZoom(0.8)}
                type="button"
              >
                −
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button
                aria-label="放大"
                onClick={() => adjustZoom(1.25)}
                type="button"
              >
                ＋
              </button>
              <button onClick={() => setPan({ x: 0, y: 0 })} type="button">
                置中
              </button>
            </div>
          </details>
        </section>
        <section className="office-editor-panel">
          <div
            aria-label="編修工具"
            className="office-editor-tabs"
            role="tablist"
          >
            {(['crop', 'adjust', 'layer'] as const).map((name) => (
              <button
                aria-selected={activeTab === name}
                onClick={() => setTab(name)}
                role="tab"
                type="button"
                key={name}
              >
                {name === 'crop'
                  ? '裁切'
                  : name === 'adjust'
                    ? '調整'
                    : '圖層'}
              </button>
            ))}
          </div>
          {activeTab === 'crop' && (
            <div role="tabpanel" className="office-tool-controls">
              <label>
                比例
                <select
                  ref={ratioSelect}
                  value={ratioChoice}
                  onChange={(event) =>
                    applyRatio(event.target.value as RatioChoice)
                  }
                >
                  <option value="free">自由</option>
                  <option value="1:1">1:1</option>
                  <option value="4:3">4:3</option>
                  <option value="16:9">16:9</option>
                  <option value="original">原始比例</option>
                </select>
              </label>
              {validation?.code === 'evidence.invalid_edit' &&
                !hasMappedFieldErrors && (
                  <p className="office-inline-error" role="alert">
                    影像編修範圍不符合限制，請檢查裁切或亮度設定。
                  </p>
                )}
              <button
                onClick={() => {
                  saveSnapshot()
                  const full = { x: 0, y: 0, width: 1, height: 1 }
                  const size = orientedSize(
                    photo.variants.field.width,
                    photo.variants.field.height,
                    edit.rotation,
                  )
                  setCropValue(
                    ratio
                      ? fitCropRatio(full, ratio, size.width, size.height)
                      : full,
                  )
                }}
                type="button"
              >
                重設裁切框
              </button>
              <p>
                用滑鼠或手指拖曳白點調整範圍。想要更精準？點一下白點，再用下方箭頭微調。
              </p>
              <div className="office-nudge-tools">
                <span>一次移動：</span>
                <button
                  aria-pressed={cropStep === 0.005}
                  onClick={() => setCropStep(0.005)}
                  type="button"
                >
                  小（0.5%）
                </button>
                <button
                  aria-pressed={cropStep === 0.02}
                  onClick={() => setCropStep(0.02)}
                  type="button"
                >
                  大（2%）
                </button>
              </div>
              <div aria-label="裁切框微調" className="office-crop-nudge">
                <button onClick={() => nudgeCrop('left')} type="button">
                  ← 左
                </button>
                <button onClick={() => nudgeCrop('right')} type="button">
                  → 右
                </button>
                <button onClick={() => nudgeCrop('up')} type="button">
                  ↑ 上
                </button>
                <button onClick={() => nudgeCrop('down')} type="button">
                  ↓ 下
                </button>
              </div>
              <details className="office-advanced-values">
                <summary>進階裁切數值（X、Y、寬、高）</summary>
                {(
                  [
                    ['X', 'x'],
                    ['Y', 'y'],
                    ['寬', 'width'],
                    ['高', 'height'],
                  ] as const
                ).map(([label, key]) => (
                  <label key={key}>
                    {label}（%）
                    <input
                      max="100"
                      min="0"
                      onChange={(event) =>
                        setCropValue({
                          ...(crop ?? INITIAL_CROP),
                          [key]: Number(event.target.value) / 100,
                        })
                      }
                      step="0.5"
                      type="range"
                      value={(crop ?? INITIAL_CROP)[key] * 100}
                    />
                  </label>
                ))}
              </details>
              {renderFieldError('crop_x', '裁切水平位置')}
              {renderFieldError('crop_y', '裁切垂直位置')}
              {renderFieldError('crop_width', '裁切寬度')}
              {renderFieldError('crop_height', '裁切高度')}
              <label>
                拉直 {edit.straighten}°
                <input
                  ref={straightenControl}
                  aria-describedby={fieldErrorId('straighten')}
                  max="15"
                  min="-15"
                  onChange={(event) =>
                    pushEdit({
                      ...edit,
                      straighten: Number(event.target.value),
                    })
                  }
                  type="range"
                  value={edit.straighten}
                />
              </label>
              {renderFieldError('straighten', '拉直角度')}
              <p>拉直：微調歪斜（±15°）。旋轉：整張轉 90 度。</p>
              <div>
                <button
                  ref={rotationControl}
                  aria-describedby={fieldErrorId('rotation')}
                  onClick={() =>
                    pushEdit({
                      ...edit,
                      rotation: ((edit.rotation + 270) %
                        360) as OfficeEdit['rotation'],
                    })
                  }
                  type="button"
                >
                  向左旋轉 90°
                </button>
                <button
                  ref={rotationControl}
                  aria-describedby={fieldErrorId('rotation')}
                  onClick={() =>
                    pushEdit({
                      ...edit,
                      rotation: ((edit.rotation + 90) %
                        360) as OfficeEdit['rotation'],
                    })
                  }
                  type="button"
                >
                  向右旋轉 90°
                </button>
              </div>
              {renderFieldError('rotation', '旋轉角度')}
              <div>
                <button
                  aria-pressed={compare || comparePinned}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture?.(event.pointerId)
                    setCompare(true)
                  }}
                  onPointerUp={() => setCompare(false)}
                  onPointerCancel={() => setCompare(false)}
                  onLostPointerCapture={() => setCompare(false)}
                  onKeyDown={(event) => {
                    if (event.key === ' ' || event.key === 'Enter')
                      setCompare(true)
                  }}
                  onKeyUp={(event) => {
                    if (event.key === ' ' || event.key === 'Enter')
                      setCompare(false)
                  }}
                  onBlur={() => setCompare(false)}
                  type="button"
                >
                  按住不放可看修改前
                </button>
                <button
                  aria-pressed={comparePinned}
                  onClick={() => setComparePinned((value) => !value)}
                  type="button"
                >
                  {comparePinned ? '修改前' : '修改後'}
                </button>
                <button
                  disabled={!history.length}
                  onClick={() => {
                    const previous = history.at(-1)
                    if (previous) {
                      setEdit(previous.edit)
                      setCrop(previous.crop)
                      setRatio(previous.ratio)
                      setRatioChoice(previous.ratioChoice)
                      setHistory((items) => items.slice(0, -1))
                    }
                  }}
                  type="button"
                >
                  復原上一步
                </button>
                <button
                  onClick={() => {
                    pushEdit({
                      rotation: 0,
                      straighten: 0,
                      crop: null,
                      brightness: 0,
                    })
                    setCrop(null)
                    setRatio(null)
                    setRatioChoice('free')
                    setZoom(1)
                    setPan({ x: 0, y: 0 })
                  }}
                  type="button"
                >
                  全部重設
                </button>
              </div>
            </div>
          )}
          {activeTab === 'adjust' && (
            <div role="tabpanel" className="office-tool-controls">
              <label>
                亮度 {edit.brightness}
                <input
                  ref={brightnessControl}
                  aria-describedby={fieldErrorId('brightness')}
                  max="100"
                  min="-100"
                  onChange={(event) =>
                    pushEdit({
                      ...edit,
                      brightness: Number(event.target.value),
                    })
                  }
                  type="range"
                  value={edit.brightness}
                />
              </label>
              {renderFieldError('brightness', '亮度')}
            </div>
          )}
          {activeTab === 'layer' && (
            <div role="tabpanel" className="office-tool-controls">
              {layer.enabled && !layerBox.fits && (
                <p className="office-size-note" role="status">
                  {smallLayerBox.fits
                    ? '標示放不進這張照片，請改選「小」。'
                    : '這張照片太小，儲存後不會加上工程標示。'}
                </p>
              )}
              <label>
                <input
                  ref={layerEnabledControl}
                  aria-describedby={fieldErrorId('layer_enabled')}
                  checked={layer.enabled}
                  onChange={(event) =>
                    setLayerValue('enabled', event.target.checked)
                  }
                  type="checkbox"
                />
                顯示工程標示
              </label>
              {renderFieldError('layer_enabled', '工程標示顯示設定')}
              <label>
                位置
                <select
                  ref={layerControl}
                  aria-describedby={fieldErrorId('layer_corner')}
                  onChange={(event) =>
                    setLayerValue(
                      'corner',
                      event.target.value as OfficeLayer['corner'],
                    )
                  }
                  value={layer.corner}
                >
                  <option value="bottom_left">左下</option>
                  <option value="bottom_right">右下</option>
                  <option value="top_left">左上</option>
                  <option value="top_right">右上</option>
                </select>
              </label>
              {renderFieldError('layer_corner', '工程標示位置')}
              {validation?.code === 'evidence.invalid_layer' &&
                !hasMappedFieldErrors && (
                  <p className="office-inline-error" role="alert">
                    圖層設定無法放入這張照片，請調整工程標示。
                  </p>
                )}
              <div aria-label="圖層位置微調" className="office-layer-nudge">
                <button
                  aria-label="圖層左移"
                  disabled={!layer.enabled}
                  onClick={() => nudgeLayer('left', false)}
                  type="button"
                >
                  ← 左
                </button>
                <button
                  aria-label="圖層右移"
                  disabled={!layer.enabled}
                  onClick={() => nudgeLayer('right', false)}
                  type="button"
                >
                  → 右
                </button>
                <button
                  aria-label="圖層上移"
                  disabled={!layer.enabled}
                  onClick={() => nudgeLayer('up', false)}
                  type="button"
                >
                  ↑ 上
                </button>
                <button
                  aria-label="圖層下移"
                  disabled={!layer.enabled}
                  onClick={() => nudgeLayer('down', false)}
                  type="button"
                >
                  ↓ 下
                </button>
              </div>
              <p>一次移動：</p>
              <div className="office-nudge-tools">
                <button
                  aria-pressed={layerStep === 0.005}
                  onClick={() => setLayerStep(0.005)}
                  type="button"
                >
                  小（0.5%）
                </button>
                <button
                  aria-pressed={layerStep === 0.02}
                  onClick={() => setLayerStep(0.02)}
                  type="button"
                >
                  大（2%）
                </button>
              </div>
              <details className="office-advanced-values">
                <summary>進階位置（X、Y）</summary>
                <label>
                  X 位置（%）
                  <input
                    ref={layerOffsetXControl}
                    aria-label="水平位移"
                    aria-describedby={fieldErrorId('layer_offset_x')}
                    max="100"
                    min="-100"
                    onChange={(event) =>
                      setLayerOffset(
                        Number(event.target.value) / 100,
                        layer.offset_y,
                      )
                    }
                    type="range"
                    value={layer.offset_x * 100}
                  />
                </label>
                {renderFieldError('layer_offset_x', '工程標示水平位移')}
                <label>
                  Y 位置（%）
                  <input
                    ref={layerOffsetYControl}
                    aria-label="垂直位移"
                    aria-describedby={fieldErrorId('layer_offset_y')}
                    max="100"
                    min="-100"
                    onChange={(event) =>
                      setLayerOffset(
                        layer.offset_x,
                        Number(event.target.value) / 100,
                      )
                    }
                    type="range"
                    value={layer.offset_y * 100}
                  />
                </label>
                {renderFieldError('layer_offset_y', '工程標示垂直位移')}
              </details>
              <label>
                尺寸
                <select
                  ref={layerSizeControl}
                  aria-describedby={fieldErrorId('layer_size')}
                  onChange={(event) =>
                    setLayerValue(
                      'size',
                      event.target.value as OfficeLayer['size'],
                    )
                  }
                  value={layer.size}
                >
                  <option value="small">小</option>
                  <option value="medium">中</option>
                  <option value="large">大</option>
                </select>
              </label>
              {renderFieldError('layer_size', '工程標示尺寸')}
              <label>
                樣式
                <select
                  ref={layerStyleControl}
                  aria-describedby={fieldErrorId('layer_style')}
                  onChange={(event) =>
                    setLayerValue(
                      'style',
                      event.target.value as OfficeLayer['style'],
                    )
                  }
                  value={layer.style}
                >
                  <option value="dark">深色底</option>
                  <option value="paper">白底黑字</option>
                  <option value="outline">白字加描邊</option>
                </select>
              </label>
              {renderFieldError('layer_style', '工程標示樣式')}
              {photo.layer_render.effective_size &&
                photo.layer_render.effective_size !== photo.layer.size && (
                  <p className="office-size-note">
                    這張照片太小，已自動用小尺寸。套用原設定或未修改圖層時會沿用有效尺寸。
                  </p>
                )}
              <p>檢驗人員與檢驗時間由系統記錄，不能在此修改。</p>
              {(
                ['project_name', 'item_name', 'inspection_location'] as const
              ).map((name, index) => (
                <Fragment key={name}>
                  <label>
                    {['工程名稱', '檢驗項目', '檢驗位置'][index]}
                    <input
                      ref={(node) => {
                        if (node) overrideControls.current[name] = node
                        else delete overrideControls.current[name]
                      }}
                      aria-describedby={fieldErrorId(name)}
                      maxLength={1000}
                      onChange={(event) =>
                        changeLayer((current) => ({
                          ...current,
                          overrides: {
                            ...current.overrides,
                            [name]: event.target.value,
                          },
                        }))
                      }
                      value={
                        layer.overrides[name] ??
                        (name === 'project_name'
                          ? photo.labels.project_name
                          : name === 'item_name'
                            ? photo.labels.item_title
                            : photo.labels.location) ??
                        ''
                      }
                    />
                  </label>
                  {renderFieldError(
                    name,
                    ['工程名稱', '檢驗項目', '檢驗位置'][index],
                  )}
                </Fragment>
              ))}
              <label>
                檢驗人員
                <input
                  disabled
                  value={
                    photo.labels.uploader_name ??
                    photo.uploaded_by.name_zh ??
                    '未記錄'
                  }
                />
              </label>
              <label>
                檢驗時間
                <input
                  disabled
                  value={formatRecordedTime(photo.labels.uploaded_at)}
                />
              </label>
            </div>
          )}
          {(fieldError || (error && !hasMappedFieldErrors)) && (
            <p
              className="office-inline-error"
              ref={fieldErrorRef}
              role="alert"
              tabIndex={-1}
            >
              {fieldError || error}
            </p>
          )}
        </section>
      </div>
      {leaveGuard.pending && (
        <ConfirmBox
          cancelLabel="繼續編修"
          confirmLabel="放棄編修並離開"
          onCancel={leaveGuard.stay}
          onConfirm={leaveGuard.leave}
          title="編修尚未儲存"
          variant="danger"
        >
          <p>放棄這次編修，已存內業版不受影響。</p>
        </ConfirmBox>
      )}
      {leaveConfirm && (
        <ConfirmBox
          cancelLabel="繼續編修"
          confirmLabel="放棄編修並離開"
          onCancel={() => setLeaveConfirm(false)}
          onConfirm={onCancel}
          title="編修尚未儲存"
          variant="danger"
        >
          <p>放棄這次編修，已存內業版不受影響。</p>
        </ConfirmBox>
      )}
      {pendingApply && (
        <ConfirmBox
          busy={busy || submitting}
          cancelLabel="繼續編修"
          confirmLabel="確認套用"
          onCancel={() => setPendingApply(null)}
          onConfirm={confirmApply}
          title={`確認更新內業版｜${identity}`}
          variant="neutral"
        >
          <p>直接更新內業版、現場版不變、不保留舊內業版。</p>
          {fieldError && (
            <p className="office-inline-error" role="alert">
              {fieldError}
            </p>
          )}
        </ConfirmBox>
      )}
    </main>
  )
}
