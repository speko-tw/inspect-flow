// 現場照片（field-evidence）的前端型別。欄位依 FEV 規格「介面」一節；
// 現場視圖不含儲存鍵、雜湊或內業版資訊（FEV-R01、FEV-R13）。

/** 圖層四個角落，現場只能在這四個位置之間選（FEV-R23）。 */
export type LayerCorner =
  'bottom_left' | 'bottom_right' | 'top_left' | 'top_right'

/**
 * 現場上傳可帶的圖層子集。偏移、大小、樣式與文字覆寫由後端採系統預設，
 * 現場多帶任何鍵都會被後端以 422 拒絕（FEV-R22、FEV-R23）。
 */
export interface FieldLayerChoice {
  enabled: boolean
  corner: LayerCorner
}

/** 後端保存的完整圖層設定；現場只讀取，用來在縮圖上預覽。 */
export interface StoredLayer extends FieldLayerChoice {
  offset_x: number
  offset_y: number
  size: 'small' | 'medium' | 'large'
  style: 'dark' | 'outline' | 'paper'
  overrides: Record<string, string>
}

/**
 * 解析後的五欄標示內容（FEV-R22）。`uploaded_at` 是 UTC 原值，
 * 上傳前尚無此值。
 */
export interface LayerLabels {
  project_name: string | null
  item_title: string | null
  location: string | null
  uploader_name: string | null
  uploaded_at: string | null
}

/** 現場編修摘要，只供稽核，後端無法驗證（FEV-R02、FEV-R18）。 */
export interface FieldEditSummary {
  rotation: 0 | 90 | 180 | 270
  brightness: number
}

/** 照片來源；由用戶端回報，供稽核（現場決定：相機或相簿）。 */
export type CaptureSource = 'camera' | 'library'

/** T3 以 OFFICE 規則回傳唯讀的實際合成狀態；舊資料可能尚無摘要。 */
export interface LayerRender {
  render_state:
    'applied' | 'fallback_small' | 'omitted_too_small' | 'disabled' | null
  effective_size: StoredLayer['size'] | null
}

/** 現場視圖的一張照片（只含有效照片）。 */
export interface FieldPhoto {
  id: string
  item_id: string
  is_overview: boolean
  point_ids: string[]
  caption: string | null
  captured_at: string | null
  uploaded_at: string
  uploaded_by: { name_zh: string | null; is_me: boolean }
  capture_source: CaptureSource | null
  width: number
  height: number
  byte_size: number
  layer_render: LayerRender
  layer: StoredLayer
  labels: LayerLabels
}

/** 覆蓋狀態裡的一個項次（FEV-R04）。 */
export interface CoveragePoint {
  id: string
  sequence: number
  title: string
  min_count: number
  photo_count: number
  missing_count: number
  satisfied: boolean
}

/** 覆蓋狀態裡的一個查核項目；總覽照不計入項次覆蓋數。 */
export interface CoverageItem {
  item_id: string
  title: string
  overview_count: number
  points: CoveragePoint[]
}

/** `GET /field/inspection-tasks/{id}/evidence` 的回應。 */
export interface Coverage {
  items: CoverageItem[]
  all_points_satisfied: boolean
}

/** 上傳一張現場版所需的內容（FEV-R06、FEV-R07 的請求欄位）。 */
export interface UploadRequest {
  /** 前端產生的冪等鍵；重試與手動重送一律沿用同一個。 */
  key: string
  file: Blob
  sha256: string
  itemId: string
  isOverview: boolean
  pointIds: string[]
  caption: string
  capturedAt: string | null
  fieldEdit: FieldEditSummary
  layer: FieldLayerChoice
  captureSource: CaptureSource
}

/** T2 上傳 receipt 與 T3 現場清單不同；雜湊只供傳輸確認，不放入畫面。 */
export interface UploadResponse extends Omit<
  FieldPhoto,
  'uploaded_by' | 'width' | 'height' | 'byte_size'
> {
  task_id: string
  variants: Record<
    'field' | 'office',
    {
      width: number
      height: number
      byte_size: number
      sha256: string
    }
  >
}
