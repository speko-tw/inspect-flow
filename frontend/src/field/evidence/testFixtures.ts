// 照片區測試共用的假資料；欄位形狀依 FEV 規格的現場視圖。

import type { Coverage, FieldPhoto, UploadRequest } from './types'

export const COVERAGE: Coverage = {
  all_points_satisfied: false,
  items: [
    {
      item_id: 'item-a',
      title: '鋼筋工程',
      overview_count: 1,
      points: [
        {
          point_id: 'point-1',
          sequence: 1,
          title: '鋼筋間距',
          min_count: 1,
          covered_count: 0,
          satisfied: false,
        },
        {
          point_id: 'point-2',
          sequence: 2,
          title: '續接器鎖固',
          min_count: 2,
          covered_count: 1,
          satisfied: false,
        },
      ],
    },
  ],
}

export function photo(overrides: Partial<FieldPhoto> = {}): FieldPhoto {
  return {
    id: 'photo-1',
    item_id: 'item-a',
    is_overview: false,
    point_ids: ['point-2'],
    caption: '接頭近照',
    captured_at: null,
    uploaded_at: '2026-10-31T02:24:00Z',
    uploaded_by: { name_zh: '張先生', is_me: true },
    width: 1200,
    height: 800,
    layer: {
      enabled: true,
      corner: 'bottom_left',
      offset_x: 0,
      offset_y: 0,
      size: 'medium',
      style: 'dark',
      overrides: {},
    },
    labels: {
      project_name: '示範工程甲',
      item_title: '鋼筋工程',
      location: '一樓／東側',
      uploader_name: '張先生',
      uploaded_at: '2026-10-31T02:24:00Z',
    },
    ...overrides,
  }
}

export const OVERVIEW = photo({
  id: 'photo-overview',
  is_overview: true,
  point_ids: [],
  caption: '整體配置',
  uploaded_by: { name_zh: '林小姐', is_me: false },
})

export function uploadRequest(
  overrides: Partial<UploadRequest> = {},
): UploadRequest {
  return {
    key: '11111111-1111-4111-8111-111111111111',
    file: new Blob(['jpeg'], { type: 'image/jpeg' }),
    sha256: 'a'.repeat(64),
    itemId: 'item-a',
    isOverview: false,
    pointIds: ['point-1'],
    caption: '近照',
    capturedAt: '2026-10-31T02:24:00.000Z',
    fieldEdit: { rotation: 90, brightness: 20 },
    layer: { enabled: true, corner: 'top_right' },
    captureSource: 'camera',
    ...overrides,
  }
}

/** 組出只含 EXIF 區段的最小 JPEG；用來驗證拍攝時間的解析。 */
export function jpegWithExif(options: {
  little?: boolean
  date?: string
  offset?: string
}): Uint8Array<ArrayBuffer> {
  const little = options.little ?? true
  const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))
  const u16 = (n: number) => (little ? [n & 255, n >> 8] : [n >> 8, n & 255])
  const u32 = (n: number) =>
    little
      ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]
      : [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]
  const entries: number[][] = []
  const data: number[] = []
  // 版面：TIFF 標頭 8 位元組、IFD0（1 項）、Exif IFD、資料區。
  const ifd0 = 8
  const exifIfd = ifd0 + 2 + 12 + 4
  const exifEntryCount = options.offset ? 2 : 1
  const dataStart = exifIfd + 2 + exifEntryCount * 12 + 4
  if (options.date) {
    const bytes = [...ascii(options.date), 0]
    entries.push([
      ...u16(0x9003),
      ...u16(2),
      ...u32(bytes.length),
      ...u32(dataStart + data.length),
    ])
    data.push(...bytes)
  }
  if (options.offset) {
    const bytes = [...ascii(options.offset), 0]
    entries.push([
      ...u16(0x9011),
      ...u16(2),
      ...u32(bytes.length),
      ...u32(dataStart + data.length),
    ])
    data.push(...bytes)
  }
  const tiff = [
    ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(ifd0),
    ...u16(1),
    ...u16(0x8769),
    ...u16(4),
    ...u32(1),
    ...u32(exifIfd),
    ...u32(0),
    ...u16(entries.length),
    ...entries.flat(),
    ...u32(0),
    ...data,
  ]
  const payload = [...ascii('Exif'), 0, 0, ...tiff]
  const length = payload.length + 2
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe1,
    length >> 8,
    length & 255,
    ...payload,
    0xff,
    0xd9,
  ])
}
