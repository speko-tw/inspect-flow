export type CropRect = {
  x: number
  y: number
  width: number
  height: number
}
export type CropHandle =
  'move' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

/** 後端先旋轉 90°，因此裁切使用旋轉後的來源尺寸。 */
export function orientedSize(width: number, height: number, rotation: number) {
  return rotation % 180 === 0
    ? { width, height }
    : { width: height, height: width }
}

/** 將裁切框限制在 0..1 的影像座標內，不改變指定比例。 */
export function moveCrop(crop: CropRect, dx: number, dy: number): CropRect {
  return {
    ...crop,
    x: clamp(crop.x + dx, 0, 1 - crop.width),
    y: clamp(crop.y + dy, 0, 1 - crop.height),
  }
}

/** 套用比例鎖並在影像邊界內置中保留裁切框。 */
export function fitCropRatio(
  crop: CropRect,
  ratio: number,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  let width = crop.width
  let height = width / ratio
  if (height > crop.height) {
    height = crop.height
    width = height * ratio
  }
  const maxWidth = Math.min(1, ratio)
  const maxHeight = Math.min(1, 1 / ratio)
  if (width > maxWidth || height > maxHeight) {
    width = Math.min(width, maxWidth)
    height = width / ratio
  }
  const minWidth = Math.max(64 / imageWidth, (64 / imageHeight) * ratio)
  if (width < minWidth && minWidth <= maxWidth) {
    width = minWidth
    height = width / ratio
  }
  return {
    x: clamp(crop.x + (crop.width - width) / 2, 0, 1 - width),
    y: clamp(crop.y + (crop.height - height) / 2, 0, 1 - height),
    width,
    height,
  }
}

/** 以對側邊或角為固定點調整八個把手，比例鎖定時維持其像素比例。 */
export function resizeCrop(
  crop: CropRect,
  handle: Exclude<CropHandle, 'move'>,
  dx: number,
  dy: number,
  lockedRatio: number | null,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  const horizontal = handle.includes('w') || handle.includes('e')
  const vertical = handle.includes('n') || handle.includes('s')
  let width =
    crop.width + (handle.includes('e') ? dx : handle.includes('w') ? -dx : 0)
  let height =
    crop.height + (handle.includes('s') ? dy : handle.includes('n') ? -dy : 0)

  if (lockedRatio) {
    if (horizontal && vertical) {
      if (
        Math.abs(width - crop.width) >=
        Math.abs(height - crop.height) * lockedRatio
      )
        height = width / lockedRatio
      else width = height * lockedRatio
    } else if (horizontal) height = width / lockedRatio
    else width = height * lockedRatio
  }

  const anchorX = handle.includes('w')
    ? crop.x + crop.width
    : handle.includes('e')
      ? crop.x
      : crop.x + crop.width / 2
  const anchorY = handle.includes('n')
    ? crop.y + crop.height
    : handle.includes('s')
      ? crop.y
      : crop.y + crop.height / 2
  const maxWidth = handle.includes('w')
    ? anchorX
    : handle.includes('e')
      ? 1 - anchorX
      : 2 * Math.min(anchorX, 1 - anchorX)
  const maxHeight = handle.includes('n')
    ? anchorY
    : handle.includes('s')
      ? 1 - anchorY
      : 2 * Math.min(anchorY, 1 - anchorY)
  const minWidth = Math.max(
    64 / imageWidth,
    lockedRatio ? (64 / imageHeight) * lockedRatio : 0.01,
  )
  const maxByHeight = lockedRatio ? maxHeight * lockedRatio : maxWidth
  width = clamp(
    width,
    Math.min(minWidth, Math.min(maxWidth, maxByHeight)),
    Math.min(maxWidth, maxByHeight),
  )
  height = lockedRatio
    ? width / lockedRatio
    : clamp(height, 64 / imageHeight, maxHeight)

  const x = handle.includes('w')
    ? anchorX - width
    : handle.includes('e')
      ? anchorX
      : anchorX - width / 2
  const y = handle.includes('n')
    ? anchorY - height
    : handle.includes('s')
      ? anchorY
      : anchorY - height / 2
  return {
    x: clamp(x, 0, 1 - width),
    y: clamp(y, 0, 1 - height),
    width,
    height,
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
