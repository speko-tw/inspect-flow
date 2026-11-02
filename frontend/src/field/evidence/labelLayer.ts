// 工程標示圖層的前端預覽（FEV-R22、FEV-R23）。
//
// 現場編修畫面與清單縮圖都由「乾淨的現場版」加上圖層資料在前端合成；
// 不取內業版檔案、不落地第三張圖片，也不因放不下就擋上傳（FEV-R23）。
// 尺寸比例、字級與兩行省略沿用規格「工程標示內容與版面」；字型用瀏覽器
// 字型，與後端隨附字型允許有視覺差異，內業版才是下載與報告用的影像。

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
  overrides: {},
}

const WIDTH_RATIO = { small: 0.6, medium: 0.78, large: 0.96 } as const
const FONT_SCALE = { small: 0.9, medium: 1, large: 1.2 } as const
const SIZE_ORDER = ['large', 'medium', 'small'] as const
const FONT_FAMILY =
  '"Noto Sans CJK TC", "PingFang TC", "Microsoft JhengHei", sans-serif'
const MAX_LINES = 2

type LayerSize = keyof typeof WIDTH_RATIO

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
  const shortSide = Math.min(width, height)
  const fontSize = Math.max(
    14,
    Math.round(0.022 * shortSide * FONT_SCALE[size]),
  )
  const margin = Math.max(2, Math.round(0.02 * shortSide))
  const padding = Math.max(2, Math.round(0.006 * shortSide))
  const layerWidth = Math.round(WIDTH_RATIO[size] * shortSide)
  const titleWidth = Math.round(layerWidth * 0.25)
  const lineHeight = Math.round(fontSize * 1.2)
  const rows = LABEL_ROWS.map((row) => {
    const titleLines = wrapText(
      row.title,
      titleWidth - 2 * padding,
      fontSize,
      measure,
    )
    const valueLines = wrapText(
      values[row.key] ?? '',
      layerWidth - titleWidth - 2 * padding,
      fontSize,
      measure,
    )
    const lines = Math.max(titleLines.length, valueLines.length)
    return {
      titleLines,
      valueLines,
      height: lines * lineHeight + 2 * padding,
    }
  })
  const layerHeight = rows.reduce((sum, row) => sum + row.height, 0)
  if (layerWidth + 2 * margin > width || layerHeight + 2 * margin > height) {
    return null
  }
  const left = layer.corner.endsWith('left')
  const top = layer.corner.startsWith('top')
  return {
    size,
    x: left ? margin : width - margin - layerWidth,
    y: top ? margin : height - margin - layerHeight,
    width: layerWidth,
    height: layerHeight,
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
  const start = SIZE_ORDER.indexOf(layer.size)
  for (const size of SIZE_ORDER.slice(start)) {
    const layout = layoutAtSize(width, height, layer, size, values, measure)
    if (layout) return layout
  }
  return null
}

/** UTC 原值轉成顯示用的 `YYYY/MM/DD HH:mm`（預設時區 Asia/Taipei）。 */
export function formatLabelTime(value: string | null): string {
  if (!value) return '未記錄'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未記錄'
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )
  const day = `${parts.year}/${parts.month}/${parts.day}`
  return `${day} ${parts.hour}:${parts.minute}`
}

/** 把五欄內容轉成要印在圖層上的文字（時間格式化、缺值照規格顯示）。 */
export function labelValues(
  labels: LayerLabels,
  pending = false,
): Record<string, string> {
  return {
    project_name: labels.project_name || '未記錄',
    item_title: labels.item_title || '未記錄',
    location: labels.location || '未填寫',
    uploader_name: labels.uploader_name || '未記錄',
    uploaded_at: pending
      ? PENDING_TIME_TEXT
      : formatLabelTime(labels.uploaded_at),
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
): LayerLayout | null {
  const ctx = canvas.getContext('2d')
  if (!ctx || !layer.enabled) return null
  const measure: Measure = (text, fontSize) => {
    ctx.font = `${fontSize}px ${FONT_FAMILY}`
    return ctx.measureText(text).width
  }
  const layout = layoutLayer(
    canvas.width,
    canvas.height,
    layer,
    labelValues(labels, pending),
    measure,
  )
  if (!layout) return null
  ctx.save()
  ctx.font = `${layout.fontSize}px ${FONT_FAMILY}`
  ctx.textBaseline = 'top'
  const paper = layer.style === 'paper'
  if (layer.style !== 'outline') {
    ctx.fillStyle = paper ? '#ffffff' : 'rgba(0, 0, 0, 0.66)'
    ctx.fillRect(layout.x, layout.y, layout.width, layout.height)
  }
  ctx.strokeStyle = paper ? '#000000' : 'rgba(255, 255, 255, 0.6)'
  ctx.lineWidth = 1
  let top = layout.y
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
    if (layer.style !== 'outline') {
      ctx.strokeRect(layout.x, top, layout.width, row.height)
    }
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
