// 現場編修的影像處理：旋轉、亮度、壓縮與完整性雜湊。
//
// 依 FEV-R02：現場只有 90° 旋轉與亮度，且由前端直接烘進現場版後
// 才壓縮上傳；`field_edit` 只是摘要，後端不會再套用一次。
// 壓縮用畫布輸出，本來就不帶 EXIF（D2）。原檔與處理中的畫布只留在
// 記憶體，不寫入 IndexedDB、localStorage 或 Cache API（FEV-R08）。

import { readBytes } from './captureTime'
import type { FieldEditSummary } from './types'

/** 現場版壓縮後的長邊上限與 JPEG 品質（D2、FEV-R02）。 */
export const MAX_EDGE = 2560
export const JPEG_QUALITY = 0.85
/** 編修畫面預覽用的長邊；預覽允許與後端有視覺差異（FEV-R25）。 */
export const PREVIEW_EDGE = 960

export type Rotation = FieldEditSummary['rotation']

/** 正規化成 0／90／180／270，供累加旋轉時使用。 */
export function normalizeRotation(degrees: number): Rotation {
  return ((((Math.round(degrees / 90) * 90) % 360) + 360) % 360) as Rotation
}

/**
 * 亮度倍率 `1 + v/200`（FEV-R02）：−100～+100 對應 0.5～1.5，
 * 端點不會變成不可回復的全黑。
 */
export function brightnessFactor(brightness: number): number {
  return 1 + brightness / 200
}

/**
 * 旋轉後依長邊上限縮放的輸出尺寸；不放大小圖。
 *
 * @returns 輸出寬高，以及旋轉前來源要畫成的寬高（`drawWidth`、`drawHeight`）。
 */
export function outputSize(
  width: number,
  height: number,
  rotation: Rotation,
  maxEdge: number,
) {
  const swap = rotation === 90 || rotation === 270
  const rotatedWidth = swap ? height : width
  const rotatedHeight = swap ? width : height
  const scale = Math.min(1, maxEdge / Math.max(rotatedWidth, rotatedHeight))
  const outWidth = Math.max(1, Math.round(rotatedWidth * scale))
  const outHeight = Math.max(1, Math.round(rotatedHeight * scale))
  return {
    width: outWidth,
    height: outHeight,
    drawWidth: swap ? outHeight : outWidth,
    drawHeight: swap ? outWidth : outHeight,
  }
}

/**
 * 每個 RGB 色值乘亮度倍率，正數四捨五入後限制在 0～255（FEV-R02）；
 * 不動 alpha。就地修改 `data`。
 */
export function applyBrightness(
  data: Uint8ClampedArray,
  brightness: number,
): void {
  if (brightness === 0) return
  const factor = brightnessFactor(brightness)
  for (let i = 0; i < data.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const value = Math.floor(data[i + channel] * factor + 0.5)
      data[i + channel] = value > 255 ? 255 : value
    }
  }
}

/** 可畫進畫布、且知道自己尺寸的影像來源。 */
export interface ImageSource {
  image: CanvasImageSource
  width: number
  height: number
  /** 釋放解碼後的影像與物件網址。 */
  release: () => void
}

/**
 * 解碼使用者選的照片。用 `<img>` 而不是 `createImageBitmap`，因為
 * 瀏覽器對 `<img>` 一致套用 EXIF 方向，直拍的照片不會躺著。
 */
export function loadImageSource(file: Blob): Promise<ImageSource> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () =>
      resolve({
        image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        release: () => {
          URL.revokeObjectURL(url)
          image.src = ''
        },
      })
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Selected file is not a decodable image'))
    }
    image.src = url
  })
}

/** 取得 2D 畫布；環境不支援時拋錯，由呼叫端顯示白話訊息。 */
function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D is not available')
  return ctx
}

/** 旋轉並縮放到 `maxEdge` 的底圖（還沒套亮度）。 */
export function renderBase(
  source: ImageSource,
  rotation: Rotation,
  maxEdge: number,
): HTMLCanvasElement {
  const size = outputSize(source.width, source.height, rotation, maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = context2d(canvas)
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(size.width / 2, size.height / 2)
  ctx.rotate((rotation * Math.PI) / 180)
  ctx.drawImage(
    source.image,
    -size.drawWidth / 2,
    -size.drawHeight / 2,
    size.drawWidth,
    size.drawHeight,
  )
  return canvas
}

/** 複製底圖並套亮度；預覽拖動滑桿時不必重新旋轉縮放。 */
export function withBrightness(
  base: HTMLCanvasElement,
  brightness: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = base.width
  canvas.height = base.height
  const ctx = context2d(canvas)
  ctx.drawImage(base, 0, 0)
  if (brightness !== 0) {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
    applyBrightness(pixels.data, brightness)
    ctx.putImageData(pixels, 0, 0)
  }
  return canvas
}

/** 現場版成品：旋轉、縮到長邊上限並烘進亮度，不含圖層。 */
export function renderFieldVersion(
  source: ImageSource,
  edit: FieldEditSummary,
): HTMLCanvasElement {
  return withBrightness(
    renderBase(source, edit.rotation, MAX_EDGE),
    edit.brightness,
  )
}

/** 以固定品質輸出 JPEG。 */
export function canvasToJpeg(
  canvas: HTMLCanvasElement,
  quality = JPEG_QUALITY,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('JPEG encoding failed')),
      'image/jpeg',
      quality,
    )
  })
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/**
 * 純 JS 的 SHA-256。`crypto.subtle` 只在安全環境（HTTPS、localhost）
 * 可用，而試用現場可能走區網 HTTP；此時退回這個實作，照片仍能上傳。
 */
export function sha256Fallback(bytes: Uint8Array): string {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ])
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000))
  view.setUint32(padded.length - 4, (bytes.length << 3) >>> 0)
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
    }
    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + s1 + ch + K[i] + w[i]) | 0
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (s0 + maj) | 0
      hh = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    h[0] += a
    h[1] += b
    h[2] += c
    h[3] += d
    h[4] += e
    h[5] += f
    h[6] += g
    h[7] += hh
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('')
}

/** 十六進位 SHA-256（FEV-R06：後端以它核對收到的內容）。 */
export async function sha256Hex(blob: Blob): Promise<string> {
  const bytes = await readBytes(blob)
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const digest = await subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('')
  }
  return sha256Fallback(new Uint8Array(bytes))
}

/**
 * 產生冪等鍵（UUID v4，FEV-R07）。`crypto.randomUUID` 同樣只在安全環境
 * 可用，其他環境用 `getRandomValues` 組出。
 */
export function newIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10).join(''),
  ].join('-')
}
