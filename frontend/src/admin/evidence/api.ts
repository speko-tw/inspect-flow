import { request } from '../api'

/** 內業照片的圖層來源，姓名與時間欄位由後端鎖定。 */
export type OfficeLayer = {
  enabled: boolean
  corner: 'bottom_left' | 'bottom_right' | 'top_left' | 'top_right'
  offset_x: number
  offset_y: number
  size: 'small' | 'medium' | 'large'
  style: 'dark' | 'outline' | 'paper'
  overrides: Partial<
    Record<'project_name' | 'item_name' | 'inspection_location', string>
  >
}

export type OfficeLabels = {
  project_name?: string | null
  item_title?: string | null
  location?: string | null
  uploader_name?: string | null
  uploaded_at?: string | null
}

/** API 對照片的內業視圖；OFFICE 圖片只由保存檔案端點提供。 */
export type OfficePhoto = {
  id: string
  task_id: string
  item_id: string
  is_overview: boolean
  point_ids: string[]
  caption: string | null
  captured_at: string | null
  uploaded_at: string
  uploaded_by: { name_zh: string | null; is_me: boolean }
  capture_source: 'camera' | 'library' | null
  layer: OfficeLayer
  labels: OfficeLabels
  layer_render: { render_state: string | null; effective_size: string | null }
  voided_at: string | null
  void_reason: string | null
  deleted_at: string | null
  is_non_realtime_capture: boolean
  has_layer_overrides: boolean
  variants: {
    field: { sha256: string; width: number; height: number; byte_size: number }
    office: {
      sha256: string
      width: number
      height: number
      byte_size: number
      edit_params: OfficeEdit | Record<string, unknown> | null
      edited_by: string | null
      edited_at: string | null
    }
  }
  layer_history?: {
    items: Array<{
      id: string
      /** ALG-R29：姓名、身分與單位已合成，不拆解或回查快照。 */
      actor: { id: string | null; snapshot: string }
      occurred_at: string
      before: { layer: OfficeLayer; labels: OfficeLabels }
      after: { layer: OfficeLayer; labels: OfficeLabels }
    }>
    next_cursor: string | null
  }
}

/** FEV-R24 的影像編修參數，與可選的完整圖層取代設定分開。 */
export type OfficeEdit = {
  rotation: 0 | 90 | 180 | 270
  straighten: number
  crop: { x: number; y: number; width: number; height: number } | null
  brightness: number
}

/** 專案內業 Task 照片清單及分頁游標。 */
export type OfficePhotoPage = {
  items: OfficePhoto[]
  next_cursor: string | null
}

/** 以真實內業清單 API 載入可篩選照片；清單預設包含作廢與刪除項。 */
export function listOfficePhotos(
  taskId: string,
  filters: { voided?: boolean; deleted?: boolean },
  cursor?: string,
): Promise<OfficePhotoPage> {
  const query = new URLSearchParams({ limit: '100' })
  if (filters.voided !== undefined) query.set('voided', String(filters.voided))
  if (filters.deleted !== undefined)
    query.set('deleted', String(filters.deleted))
  if (cursor) query.set('cursor', cursor)
  return request(`/inspection-tasks/${taskId}/photos?${query}`)
}

/** 讀取單張內業詳情與本照片歷程，供一般 evidence.read 權限使用。 */
export function getOfficePhoto(
  taskId: string,
  photoId: string,
  cursor?: string,
): Promise<OfficePhoto> {
  const query = new URLSearchParams({ layer_history_limit: '50' })
  if (cursor) query.set('layer_history_cursor', cursor)
  return request(`/inspection-tasks/${taskId}/photos/${photoId}?${query}`)
}

/** 以正式串流 API 顯示保存版本，不在瀏覽器重新合成 OFFICE。 */
export function officeImageUrl(
  taskId: string,
  photoId: string,
  variant: 'field' | 'office',
): string {
  return (
    `/api/v1/inspection-tasks/${taskId}/photos/${photoId}` +
    `/image?variant=${variant}`
  )
}

/** 軟刪除照片；刪除結果以後續清單讀回為準。 */
export function deletePhoto(taskId: string, photoId: string): Promise<void> {
  return request(`/inspection-tasks/${taskId}/photos/${photoId}`, {
    method: 'DELETE',
  })
}

/** 送出 OFFICE 編修；省略圖層代表只使用影像參數。 */
export function editOfficePhoto(
  taskId: string,
  photoId: string,
  input: OfficeEdit & { layer?: OfficeLayer },
): Promise<OfficePhoto> {
  return request(
    `/inspection-tasks/${taskId}/photos/${photoId}/office-version`,
    { method: 'PUT', body: JSON.stringify(input) },
  )
}
