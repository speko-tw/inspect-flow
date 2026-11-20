// 工程標示圖層的前端預覽（FEV-R22、FEV-R23）。
//
// 現場編修畫面與清單縮圖都由「乾淨的現場版」加上圖層資料在前端合成；
// 不取內業版檔案、不落地第三張圖片，也不因放不下就擋上傳（FEV-R23）。
// 尺寸比例、字級與兩行省略沿用規格「工程標示內容與版面」；字型用瀏覽器
// 字型，與後端隨附字型允許有視覺差異，內業版才是下載與報告用的影像。

import { getLayerBox } from '../../evidence/layerGeometry'
import { formatRecordedTime, labelText } from './labelText'
import type { LayerLabels, StoredLayer } from './types'

/** 五欄的顯示順序與標題（FEV-R22）。 */
export const LABEL_ROWS: ReadonlyArray<{
  key: keyof LayerLabels
  title: string
}> = [
  { key: 'project_name', title: '工程名稱' },
  { key: 'item_title', title: '檢驗項目' },
  { key: 'location', title: '檢驗位置' },
  { key: 'uploader_name', title: '檢驗人員' },
  { key: 'uploaded_at', title: '檢驗時間' },
]

/** 上傳前還沒有伺服器時間（FEV-R23）。 */
export const PENDING_TIME_TEXT = '上傳後以伺服器時間填入'

/** 現場上傳預設的圖層：開啟、左下（FEV-R22）。 */
export const DEFAULT_LAYER: StoredLayer = {
  enabled: true,
  corner: 'bottom_left',
  offset_x: 0,
  offset_y: 0,
  size: 'medium',
  style: 'dark',
  border: true,
  overrides: {},
}

const FONT_FAMILY =
  '"Noto Sans CJK TC", "PingFang TC", "Microsoft JhengHei", sans-serif'
const MAX_LINES = 2

type LayerSize = StoredLayer['size']

/** 一格文字排版後的結果。 */
export interface LayoutRow {
  titleLines: string[]
  valueLines: string[]
  height: number
}

/** 圖層排版結果；座標以照片左上角為原點，單位 px。 */
export interface LayerLayout {
  size: LayerSize
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  padding: number
  titleWidth: number
  lineHeight: number
  rows: LayoutRow[]
}

/** 量文字寬度的函式；實際繪製用畫布，測試可注入固定寬度。 */
export type Measure = (text: string, fontSize: number) => number

/** 逐字貪婪換行，最多兩行，超出以「…」結尾，完整內容不受影響。 */
export function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
  measure: Measure,
): string[] {
  const lines: string[] = []
  let current = ''
  const chars = Array.from(text)
  for (let i = 0; i < chars.length; i++) {
    const next = current + chars[i]
    if (current && measure(next, fontSize) > maxWidth) {
      if (lines.length === MAX_LINES - 1) {
        let last = current + chars.slice(i).join('')
        while (last.length > 0 && measure(`${last}…`, fontSize) > maxWidth) {
          last = last.slice(0, -1)
        }
        lines.push(`${last}…`)
        return lines
      }
      lines.push(current)
      current = chars[i]
    } else {
      current = next
    }
  }
  lines.push(current)
  return lines
}

function layoutAtSize(
  width: number,
  height: number,
  layer: StoredLayer,
  size: LayerSize,
  values: Record<string, string>,
  measure: Measure,
): LayerLayout | null {
  const box = getLayerBox({ width, height }, { ...layer, size })
  if (!box.fits) return null
  const { fontSize, inner: padding, lineHeight } = box
  const titleWidth = box.titleColumnWidth + padding
  const rows = LABEL_ROWS.map((row) => ({
    titleLines: wrapText(
      row.title,
      titleWidth - 2 * padding,
      fontSize,
      measure,
    ),
    valueLines: wrapText(
      values[row.key] ?? '',
      box.width - titleWidth - 2 * padding,
      fontSize,
      measure,
    ),
    height: box.rowHeight,
  }))
  return {
    size,
    x: box.left,
    y: box.top,
    width: box.width,
    height: box.height,
    fontSize,
    padding,
    titleWidth,
    lineHeight,
    rows,
  }
}

/**
 * 計算圖層排版。先用要求的大小，放不下改試小，仍放不下回 null
 * （預覽就不畫圖層）；這與後端自動產生內業版的退讓順序一致
 * （FEV-R22 通用容納規則），但預覽放不下不得阻擋合法上傳（FEV-R23）。
 */
export function layoutLayer(
  width: number,
  height: number,
  layer: StoredLayer,
  values: Record<string, string>,
  measure: Measure,
): LayerLayout | null {
  for (const size of [layer.size, 'small'] as const) {
    const layout = layoutAtSize(width, height, layer, size, values, measure)
    if (layout) return layout
  }
  return null
}

export { formatRecordedTime as formatLabelTime } from './labelText'

/** 把五欄內容轉成要印在圖層上的文字（時間格式化、缺值照規格顯示）。 */
export function labelValues(
  labels: LayerLabels,
  pending = false,
  timezone = 'Asia/Taipei',
): Record<string, string> {
  return {
    project_name: labelText(labels.project_name),
    item_title: labelText(labels.item_title),
    location: labelText(labels.location, true),
    uploader_name: labelText(labels.uploader_name),
    uploaded_at: pending
      ? PENDING_TIME_TEXT
      : formatRecordedTime(labels.uploaded_at, timezone),
  }
}

/**
 * 在畫布上畫圖層預覽。回傳實際畫出的排版；放不下或圖層關閉時回 null
 * 且不動畫布。
 */
export function drawLabelLayer(
  canvas: HTMLCanvasElement,
  layer: StoredLayer,
  labels: LayerLabels,
  pending = false,
  timezone = 'Asia/Taipei',
  imageSize = { width: canvas.width, height: canvas.height },
): LayerLayout | null {
  const ctx = canvas.getContext('2d')
  if (!ctx || !layer.enabled) return null
  const measure: Measure = (text, fontSize) => {
    ctx.font = `${fontSize}px ${FONT_FAMILY}`
    return ctx.measureText(text).width
  }
  const layout = layoutLayer(
    imageSize.width,
    imageSize.height,
    layer,
    labelValues(labels, pending, timezone),
    measure,
  )
  if (!layout) return null
  ctx.save()
  ctx.scale(canvas.width / imageSize.width, canvas.height / imageSize.height)
  ctx.font = `${layout.fontSize}px ${FONT_FAMILY}`
  ctx.textBaseline = 'top'
  const paper = layer.style === 'paper'
  if (layer.style !== 'outline') {
    ctx.fillStyle = paper ? '#ffffff' : 'rgba(0, 0, 0, 0.66)'
    ctx.fillRect(layout.x, layout.y, layout.width, layout.height)
  }
  ctx.strokeStyle = paper ? '#000000' : '#ffffff'
  ctx.lineWidth = 1
  if (layer.border) {
    ctx.lineWidth = layer.style === 'outline' ? 3 : 1
    ctx.strokeRect(layout.x, layout.y, layout.width, layout.height)
  }
  let top = layout.y + layout.padding
  for (const row of layout.rows) {
    drawCell(ctx, layer, layout, row.titleLines, layout.x, top)
    drawCell(
      ctx,
      layer,
      layout,
      row.valueLines,
      layout.x + layout.titleWidth,
      top,
    )
    ctx.strokeStyle = paper ? '#000000' : '#ffffff'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(layout.x, top + row.height)
    ctx.lineTo(layout.x + layout.width, top + row.height)
    ctx.moveTo(layout.x + layout.titleWidth, top)
    ctx.lineTo(layout.x + layout.titleWidth, top + row.height)
    ctx.stroke()
    top += row.height
  }
  ctx.restore()
  return layout
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  layer: StoredLayer,
  layout: LayerLayout,
  lines: string[],
  x: number,
  y: number,
) {
  lines.forEach((line, index) => {
    const textX = x + layout.padding
    const textY = y + layout.padding + index * layout.lineHeight
    if (layer.style === 'outline') {
      ctx.lineJoin = 'round'
      ctx.lineWidth = 3
      ctx.strokeStyle = '#000000'
      ctx.strokeText(line, textX, textY)
      ctx.fillStyle = '#ffffff'
    } else {
      ctx.fillStyle = layer.style === 'paper' ? '#000000' : '#ffffff'
    }
    ctx.fillText(line, textX, textY)
  })
}
