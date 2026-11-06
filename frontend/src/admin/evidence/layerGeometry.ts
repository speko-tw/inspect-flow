import type { OfficeEdit, OfficeLayer } from './api'

const SIZE_FACTORS = { small: 0.6, medium: 0.78, large: 0.96 } as const
const SIZE_MULTIPLIERS = { small: 0.9, medium: 1, large: 1.2 } as const

export type LayerImageSize = { width: number; height: number }
export type LayerBox = LayerImageSize & {
  left: number
  top: number
  fontSize: number
  inner: number
  fits: boolean
}
export type LayerPreviewRect = {
  left: number
  top: number
  width: number
  height: number
  fontSize: number
  inner: number
  fits: boolean
}

/** 依後端 Q(t) 四捨五入規則計算旋轉及裁切後的實際像素尺寸。 */
export function getEditedImageSize(
  width: number,
  height: number,
  edit: Pick<OfficeEdit, 'rotation' | 'crop'>,
): LayerImageSize {
  const rotated =
    edit.rotation % 180 === 0
      ? { width, height }
      : { width: height, height: width }
  const crop = edit.crop
  if (!crop) return rotated
  const left = roundPixel(crop.x * rotated.width)
  const top = roundPixel(crop.y * rotated.height)
  const right = roundPixel((crop.x + crop.width) * rotated.width)
  const bottom = roundPixel((crop.y + crop.height) * rotated.height)
  return { width: right - left, height: bottom - top }
}

/** 將後端圖層框投影到含裁切框的完整照片預覽座標。 */
export function getLayerPreviewRect(
  width: number,
  height: number,
  edit: Pick<OfficeEdit, 'rotation' | 'crop'>,
  layer: Pick<OfficeLayer, 'corner' | 'size' | 'offset_x' | 'offset_y'>,
): LayerPreviewRect {
  const rotated =
    edit.rotation % 180 === 0
      ? { width, height }
      : { width: height, height: width }
  const cropLeft = edit.crop ? roundPixel(edit.crop.x * rotated.width) : 0
  const cropTop = edit.crop ? roundPixel(edit.crop.y * rotated.height) : 0
  const outputSize = getEditedImageSize(width, height, edit)
  const box = getLayerBox(outputSize, layer)
  return {
    left: (cropLeft + box.left) / rotated.width,
    top: (cropTop + box.top) / rotated.height,
    width: box.width / rotated.width,
    height: box.height / rotated.height,
    fontSize: box.fontSize,
    inner: box.inner,
    fits: box.fits,
  }
}

/**
 * 計算後端圖層合成使用的實際框位置；offset 單位為照片寬高比例。
 */
export function getLayerBox(
  image: LayerImageSize,
  layer: Pick<OfficeLayer, 'corner' | 'size' | 'offset_x' | 'offset_y'>,
): LayerBox {
  const shortEdge = Math.min(image.width, image.height)
  const fontSize = Math.max(
    14,
    Math.floor(0.022 * shortEdge * SIZE_MULTIPLIERS[layer.size] + 0.5),
  )
  const margin = Math.max(2, Math.floor(0.02 * shortEdge + 0.5))
  const inner = Math.max(2, Math.floor(0.006 * shortEdge + 0.5))
  const width = Math.floor(shortEdge * SIZE_FACTORS[layer.size] + 0.5)
  const rowHeight = Math.ceil(fontSize * 1.2) * 2 + inner * 2
  const height = rowHeight * 5 + inner * 2
  const fits = width >= 100 && rowHeight * 5 <= shortEdge - margin * 2
  const baseLeft = layer.corner.includes('left')
    ? margin
    : image.width - width - margin
  const baseTop = layer.corner.includes('top')
    ? margin
    : image.height - height - margin
  const left = fits
    ? clamp(
        baseLeft + Math.trunc(layer.offset_x * image.width),
        0,
        image.width - width,
      )
    : 0
  const top = fits
    ? clamp(
        baseTop + Math.trunc(layer.offset_y * image.height),
        0,
        image.height - height,
      )
    : 0
  return { left, top, width, height, fontSize, inner, fits }
}

/** 以像素差換算後端使用的水平／垂直 offset，並限制框在照片內。 */
export function moveLayerOffset(
  image: LayerImageSize,
  layer: Pick<OfficeLayer, 'corner' | 'size' | 'offset_x' | 'offset_y'>,
  deltaX: number,
  deltaY: number,
): Pick<OfficeLayer, 'offset_x' | 'offset_y'> {
  return clampLayerOffset(
    image,
    layer,
    layer.offset_x + deltaX / image.width,
    layer.offset_y + deltaY / image.height,
  )
}

/** 以絕對 offset 限制標示框，符合後端每張照片的完整取代設定。 */
export function clampLayerOffset(
  image: LayerImageSize,
  layer: Pick<OfficeLayer, 'corner' | 'size' | 'offset_x' | 'offset_y'>,
  offsetX: number,
  offsetY: number,
): Pick<OfficeLayer, 'offset_x' | 'offset_y'> {
  const box = getLayerBox(image, {
    ...layer,
    offset_x: offsetX,
    offset_y: offsetY,
  })
  const base = getLayerBox(image, { ...layer, offset_x: 0, offset_y: 0 })
  return {
    offset_x: (box.left - base.left) / image.width,
    offset_y: (box.top - base.top) / image.height,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function roundPixel(value: number): number {
  return Math.floor(value + 0.5)
}
