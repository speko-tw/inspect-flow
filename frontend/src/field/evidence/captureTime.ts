// 讀取照片原檔的拍攝時間（EXIF DateTimeOriginal）。
//
// 只用來填 `captured_at`（FEV-R13：手機回報、不一定可信、讀不到就空）。
// 壓縮用畫布輸出本來就不帶 EXIF，所以 EXIF 不會被上傳（FEV-R02、D2）。
// 只讀檔頭，不解碼影像，也不把原檔存到任何地方。

/** EXIF 區段最多 64 KB；多讀一些以涵蓋 JPEG 開頭的其他區段。 */
const HEADER_BYTES = 160 * 1024

const TAG_EXIF_IFD = 0x8769
const TAG_DATE_TIME_ORIGINAL = 0x9003
const TAG_OFFSET_TIME_ORIGINAL = 0x9011

function ascii(view: DataView, offset: number, length: number): string {
  let text = ''
  for (let i = 0; i < length && offset + i < view.byteLength; i++) {
    const code = view.getUint8(offset + i)
    if (code === 0) break
    text += String.fromCharCode(code)
  }
  return text
}

/** 在一個 IFD 內找指定 tag，回傳該項目的位移（沒有就 null）。 */
function findEntry(
  view: DataView,
  tiff: number,
  ifd: number,
  tag: number,
  little: boolean,
): number | null {
  const start = tiff + ifd
  if (start + 2 > view.byteLength) return null
  const count = view.getUint16(start, little)
  for (let i = 0; i < count; i++) {
    const entry = start + 2 + i * 12
    if (entry + 12 > view.byteLength) return null
    if (view.getUint16(entry, little) === tag) return entry
  }
  return null
}

function readAscii(
  view: DataView,
  tiff: number,
  entry: number,
  little: boolean,
): string | null {
  const length = view.getUint32(entry + 4, little)
  // 4 個位元組以內直接存在項目內，否則項目存的是位移。
  const offset =
    length <= 4 ? entry + 8 : tiff + view.getUint32(entry + 8, little)
  if (offset + length > view.byteLength) return null
  return ascii(view, offset, length)
}

/**
 * 解析 JPEG 檔頭的 EXIF，回傳 UTC ISO 8601 字串；讀不到、格式不對、
 * 或不是 JPEG 都回 null，由呼叫端當作「拍攝時間空白」。
 *
 * EXIF 時間沒有時區時視為裝置當地時間（手機拍照當下的時區）；
 * 有 `OffsetTimeOriginal` 時以它為準。
 */
export function parseCaptureTime(buffer: ArrayBuffer): string | null {
  const view = new DataView(buffer)
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null
  let pos = 2
  while (pos + 4 <= view.byteLength) {
    if (view.getUint8(pos) !== 0xff) return null
    const marker = view.getUint8(pos + 1)
    if (marker === 0xda || marker === 0xd9) return null
    const size = view.getUint16(pos + 2)
    if (marker === 0xe1 && ascii(view, pos + 4, 4) === 'Exif') {
      return parseExif(view, pos + 10)
    }
    pos += 2 + size
  }
  return null
}

function parseExif(view: DataView, tiff: number): string | null {
  if (tiff + 8 > view.byteLength) return null
  const order = view.getUint16(tiff)
  if (order !== 0x4949 && order !== 0x4d4d) return null
  const little = order === 0x4949
  if (view.getUint16(tiff + 2, little) !== 42) return null
  const ifd0 = view.getUint32(tiff + 4, little)
  const pointer = findEntry(view, tiff, ifd0, TAG_EXIF_IFD, little)
  if (pointer === null) return null
  const exifIfd = view.getUint32(pointer + 8, little)
  const dateEntry = findEntry(
    view,
    tiff,
    exifIfd,
    TAG_DATE_TIME_ORIGINAL,
    little,
  )
  if (dateEntry === null) return null
  const raw = readAscii(view, tiff, dateEntry, little)
  const match =
    raw && /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(raw)
  if (!match) return null
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number)
  const offsetEntry = findEntry(
    view,
    tiff,
    exifIfd,
    TAG_OFFSET_TIME_ORIGINAL,
    little,
  )
  const offsetText =
    offsetEntry === null ? null : readAscii(view, tiff, offsetEntry, little)
  const offset = offsetText && /^([+-])(\d{2}):(\d{2})$/.exec(offsetText)
  const date = offset
    ? new Date(
        Date.UTC(year, month - 1, day, hour, minute, second) -
          (offset[1] === '-' ? -1 : 1) *
            (Number(offset[2]) * 60 + Number(offset[3])) *
            60_000,
      )
    : new Date(year, month - 1, day, hour, minute, second)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** 讀檔案開頭的 EXIF 拍攝時間；任何失敗都回 null，不影響拍照流程。 */
export async function readCaptureTime(file: Blob): Promise<string | null> {
  try {
    return parseCaptureTime(await readBytes(file.slice(0, HEADER_BYTES)))
  } catch {
    return null
  }
}

/** 讀取 Blob 位元組；舊環境沒有 `Blob.arrayBuffer` 時退回 FileReader。 */
export function readBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}
