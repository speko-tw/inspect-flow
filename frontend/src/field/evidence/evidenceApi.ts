// 現場照片 API client（FEV 規格「介面」一節）。
//
// T2 上傳 receipt 與 T3 現場查詢各自驗證實際回應，避免將上傳成功誤判失敗。

import { withBasePath } from '../../basePath'
import {
  API_BASE,
  HttpError,
  SESSION_EXPIRED_EVENT,
  listAllPages,
  request,
} from '../../http'
import type {
  Coverage,
  FieldPhoto,
  StoredLayer,
  UploadRequest,
  UploadResponse,
} from './types'

/** 照片 API 回傳非預期狀態碼時拋出；`code` 取自錯誤 envelope。 */
export class EvidenceApiError extends HttpError {
  constructor(status: number, code?: string, details?: unknown) {
    super(status, code, details)
    this.name = 'EvidenceApiError'
  }
}

/** 寫入已獲成功回應但投影無法驗證；須重讀，不當作離線重送。 */
export class PhotoMutationResponseError extends Error {
  constructor() {
    super('Photo mutation response has an unexpected shape')
    this.name = 'PhotoMutationResponseError'
  }
}

/** 單次上傳請求超過時限；視為網路問題，可自動重試（FEV-R08）。 */
export class UploadTimeoutError extends Error {
  constructor() {
    super('Photo upload timed out')
    this.name = 'UploadTimeoutError'
  }
}

/** 單次上傳的時限；手機網路差時給足時間，仍要能被判定為逾時。 */
export const UPLOAD_TIMEOUT_MS = 120_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string'
}

function isOptionalText(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isCoverage(value: unknown): value is Coverage {
  if (!isRecord(value)) return false
  return (
    typeof value.all_points_satisfied === 'boolean' &&
    Array.isArray(value.items) &&
    value.items.every(
      (item: unknown) =>
        isRecord(item) &&
        isText(item.item_id) &&
        isText(item.title) &&
        Number.isInteger(item.overview_count) &&
        Array.isArray(item.points) &&
        item.points.every(
          (point: unknown) =>
            isRecord(point) &&
            isText(point.id) &&
            Number.isInteger(point.sequence) &&
            isText(point.title) &&
            Number.isInteger(point.min_count) &&
            isCount(point.photo_count) &&
            isCount(point.missing_count) &&
            typeof point.satisfied === 'boolean',
        ),
    )
  )
}

function isStoredLayer(value: unknown): value is StoredLayer {
  return (
    isRecord(value) &&
    typeof value.enabled === 'boolean' &&
    ['bottom_left', 'bottom_right', 'top_left', 'top_right'].includes(
      String(value.corner),
    ) &&
    typeof value.offset_x === 'number' &&
    typeof value.offset_y === 'number' &&
    ['small', 'medium', 'large'].includes(String(value.size)) &&
    ['dark', 'outline', 'paper'].includes(String(value.style)) &&
    isRecord(value.overrides)
  )
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function hasPhotoMetadata(value: Record<string, unknown>): boolean {
  const labels = value.labels
  const render = value.layer_render
  return (
    isText(value.id) &&
    isText(value.item_id) &&
    typeof value.is_overview === 'boolean' &&
    Array.isArray(value.point_ids) &&
    value.point_ids.every(isText) &&
    isOptionalText(value.caption) &&
    isOptionalText(value.captured_at) &&
    isText(value.uploaded_at) &&
    (value.capture_source === null ||
      value.capture_source === 'camera' ||
      value.capture_source === 'library') &&
    isStoredLayer(value.layer) &&
    isRecord(labels) &&
    [
      'project_name',
      'item_title',
      'location',
      'uploader_name',
      'uploaded_at',
    ].every((key) => isOptionalText(labels[key])) &&
    isRecord(render) &&
    (render.render_state === null ||
      ['applied', 'fallback_small', 'omitted_too_small', 'disabled'].includes(
        String(render.render_state),
      )) &&
    (render.effective_size === null ||
      ['small', 'medium', 'large'].includes(String(render.effective_size)))
  )
}

/** T3 現場清單必須有實際寬高、大小及上傳者，不能以 T2 receipt 代替。 */
export function isFieldPhoto(value: unknown): value is FieldPhoto {
  if (!isRecord(value) || !hasPhotoMetadata(value)) return false
  const by = value.uploaded_by
  return (
    isRecord(by) &&
    isOptionalText(by.name_zh) &&
    typeof by.is_me === 'boolean' &&
    isCount(value.width) &&
    value.width > 0 &&
    isCount(value.height) &&
    value.height > 0 &&
    isCount(value.byte_size)
  )
}

function isUploadResponse(value: unknown): value is UploadResponse {
  if (
    !isRecord(value) ||
    !hasPhotoMetadata(value) ||
    !isText(value.task_id) ||
    !isRecord(value.variants)
  )
    return false
  const variants = value.variants
  return ['field', 'office'].every((key) => {
    const variant = variants[key]
    return (
      isRecord(variant) &&
      isCount(variant.width) &&
      variant.width > 0 &&
      isCount(variant.height) &&
      variant.height > 0 &&
      isCount(variant.byte_size) &&
      isText(variant.sha256)
    )
  })
}

function photoOrThrow(body: unknown): FieldPhoto {
  if (!isFieldPhoto(body))
    throw new Error('Field photo response has an unexpected shape')
  return body
}

const taskBase = (taskId: string) =>
  `/field/inspection-tasks/${encodeURIComponent(taskId)}`
const photosBase = (taskId: string) =>
  `/inspection-tasks/${encodeURIComponent(taskId)}/photos`

/** 現場覆蓋狀態：每個項目的總覽張數與每個項次的達標情形（FEV-R04）。 */
export async function fetchCoverage(taskId: string): Promise<Coverage> {
  const body = await request<unknown>(
    `${taskBase(taskId)}/evidence`,
    undefined,
    EvidenceApiError,
  )
  if (!isCoverage(body)) {
    throw new Error('Evidence coverage response has an unexpected shape')
  }
  return body
}

/** 取完現場照片清單（只含有效照片；總覽在前，後端已排序）。 */
export async function fetchFieldPhotos(taskId: string): Promise<FieldPhoto[]> {
  const photos = await listAllPages<unknown>(
    `${taskBase(taskId)}/photos`,
    {},
    EvidenceApiError,
  )
  return photos.map(photoOrThrow)
}

/**
 * 現場版圖片網址（同站 Cookie 驗證，沒有公開網址，FEV-R13）。
 * `maxEdge` 讓後端即時縮圖、不落地，清單縮圖不必載入整張原尺寸。
 */
export function photoImageUrl(
  taskId: string,
  photoId: string,
  maxEdge?: number,
): string {
  const query = new URLSearchParams({ variant: 'field' })
  if (maxEdge) query.set('max_edge', String(maxEdge))
  return withBasePath(
    `${API_BASE}${photosBase(taskId)}/${encodeURIComponent(photoId)}/image` +
      `?${query}`,
  )
}

/** 依 FEV-R06、R07 組成 multipart 表單；沒有值的選填欄位不送。 */
export function buildUploadForm(upload: UploadRequest): FormData {
  const form = new FormData()
  form.append('file', upload.file, 'photo.jpg')
  form.append('sha256', upload.sha256)
  form.append('item_id', upload.itemId)
  form.append('is_overview', String(upload.isOverview))
  for (const pointId of upload.pointIds) form.append('point_ids', pointId)
  if (upload.caption) form.append('caption', upload.caption)
  // 拍攝時間不一定可信，讀不到就不送（FEV-R13、FEV-Q16）。
  if (upload.capturedAt) form.append('captured_at', upload.capturedAt)
  form.append('field_edit', JSON.stringify(upload.fieldEdit))
  form.append('layer', JSON.stringify(upload.layer))
  form.append('capture_source', upload.captureSource)
  return form
}

async function failure(response: Response): Promise<EvidenceApiError> {
  if (response.status === 401) {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
  }
  let code: string | undefined
  let details: unknown
  try {
    const body = (await response.json()) as {
      error?: { code?: string; details?: unknown }
    }
    code = body.error?.code
    details = body.error?.details
  } catch {
    // 非 JSON 錯誤回應只以狀態碼處理。
  }
  return new EvidenceApiError(response.status, code, details)
}

/**
 * 上傳一張現場版（`POST /inspection-tasks/{id}/photos`，multipart）。
 *
 * 共用的 `request()` 遇到 body 會固定加 JSON 的 Content-Type，會破壞
 * multipart 的 boundary，所以這裡直接用 fetch，Content-Type 交給瀏覽器。
 * 沒有回應（斷線、逾時）拋出非 `HttpError` 的錯誤，呼叫端視為可重試
 * （FEV-R08）；`signal` 讓放棄照片時能中止進行中的請求。
 */
export async function uploadPhoto(
  taskId: string,
  upload: UploadRequest,
  signal?: AbortSignal,
): Promise<UploadResponse> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, UPLOAD_TIMEOUT_MS)
  const relay = () => controller.abort()
  signal?.addEventListener('abort', relay)
  try {
    const response = await fetch(
      withBasePath(`${API_BASE}${photosBase(taskId)}`),
      {
        method: 'POST',
        body: buildUploadForm(upload),
        credentials: 'same-origin',
        headers: { 'Idempotency-Key': upload.key },
        signal: controller.signal,
      },
    )
    if (!response.ok) throw await failure(response)
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new EvidenceApiError(response.status)
    }
    if (!isUploadResponse(body))
      throw new Error('Photo upload response has an unexpected shape')
    return body
  } catch (error) {
    if (timedOut) throw new UploadTimeoutError()
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', relay)
  }
}

/**
 * T5 修改註記／項次；總覽照省略 point_ids，未送欄位維持不變。
 * 回應依權限為現場或內業視圖；呼叫端儲存後重讀現場清單，避免混用視圖。
 */
export async function updatePhoto(
  taskId: string,
  photoId: string,
  change: { caption: string | null; point_ids?: string[] },
): Promise<void> {
  const body = await request<unknown>(
    `${photosBase(taskId)}/${encodeURIComponent(photoId)}`,
    { method: 'PATCH', body: JSON.stringify(change) },
    EvidenceApiError,
  )
  if (!isFieldPhoto(body) && !isUploadResponse(body)) {
    throw new PhotoMutationResponseError()
  }
}

/** T5 軟刪除（FEV-R10）；成功回 204，之後重讀現場清單與覆蓋。 */
export async function deletePhoto(
  taskId: string,
  photoId: string,
): Promise<void> {
  await request<unknown>(
    `${photosBase(taskId)}/${encodeURIComponent(photoId)}`,
    { method: 'DELETE' },
    EvidenceApiError,
  )
}
