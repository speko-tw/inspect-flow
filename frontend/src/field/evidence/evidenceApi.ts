// 現場照片 API client（FEV 規格「介面」一節）。
//
// 這支 client 依規格契約撰寫；後端上傳 API（T2、#791）與讀取 API
// （T3、#792）合併前，元件測試以 mock 驗證，真 API 契約測試待後續接上
// （RG-M22、FEV-AC24）。

import { withBasePath } from '../../basePath'
import {
  API_BASE,
  HttpError,
  SESSION_EXPIRED_EVENT,
  listAllPages,
  request,
} from '../../http'
import type { Coverage, FieldPhoto, StoredLayer, UploadRequest } from './types'

/** 照片 API 回傳非預期狀態碼時拋出；`code` 取自錯誤 envelope。 */
export class EvidenceApiError extends HttpError {
  constructor(status: number, code?: string, details?: unknown) {
    super(status, code, details)
    this.name = 'EvidenceApiError'
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
            isText(point.point_id) &&
            Number.isInteger(point.sequence) &&
            isText(point.title) &&
            Number.isInteger(point.min_count) &&
            Number.isInteger(point.covered_count) &&
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

/** 檢查現場視圖的一張照片；不符契約就拒收，不讓畫面吃到半套資料。 */
export function isFieldPhoto(value: unknown): value is FieldPhoto {
  if (!isRecord(value)) return false
  const labels = value.labels
  const by = value.uploaded_by
  return (
    isText(value.id) &&
    isText(value.item_id) &&
    typeof value.is_overview === 'boolean' &&
    Array.isArray(value.point_ids) &&
    value.point_ids.every(isText) &&
    isOptionalText(value.caption) &&
    isOptionalText(value.captured_at) &&
    isText(value.uploaded_at) &&
    isRecord(by) &&
    isOptionalText(by.name_zh) &&
    typeof by.is_me === 'boolean' &&
    isStoredLayer(value.layer) &&
    isRecord(labels) &&
    isText(labels.project_name) &&
    isText(labels.item_title) &&
    isText(labels.location) &&
    isText(labels.uploader_name) &&
    isOptionalText(labels.uploaded_at)
  )
}

function photoOrThrow(body: unknown): FieldPhoto {
  if (!isFieldPhoto(body)) {
    throw new Error('Field photo response has an unexpected shape')
  }
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
): Promise<FieldPhoto> {
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
    return photoOrThrow(body)
  } catch (error) {
    if (timedOut) throw new UploadTimeoutError()
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', relay)
  }
}

/**
 * 修改註記與對應項次（`PATCH`，FEV-R05）。總覽照不帶 `point_ids`，
 * 否則後端回 422 `evidence.invalid_target`；省略的欄位維持不變。
 */
export async function updatePhoto(
  taskId: string,
  photoId: string,
  change: { caption: string | null; point_ids?: string[] },
): Promise<FieldPhoto> {
  const body = await request<unknown>(
    `${photosBase(taskId)}/${encodeURIComponent(photoId)}`,
    { method: 'PATCH', body: JSON.stringify(change) },
    EvidenceApiError,
  )
  return photoOrThrow(body)
}

/** 軟刪除一張照片（`DELETE`，FEV-R10）；檔案與紀錄由後端保留。 */
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
