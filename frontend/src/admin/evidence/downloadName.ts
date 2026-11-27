import type { OfficePhoto } from './api'

// 各段按 UTF-8 位元組截斷，讓中文檔名也保留跨平台的長度餘裕。
function segment(value: string, fallback: string, budget: number): string {
  const cleaned = value
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\p{Cc}\p{Cf}]/gu, '-')
    .replace(/\s+/gu, ' ')
    .replace(/^[ .]+|[ .]+$/gu, '')
  let result = ''
  let bytes = 0
  for (const char of cleaned || fallback) {
    const size = new TextEncoder().encode(char).length
    if (bytes + size > budget) break
    result += char
    bytes += size
  }
  return result.replace(/[ .]+$/gu, '') || fallback
}

/** 以 FEV-R16 的照片來源產生安全檔名，不帶儲存路徑或人員資料。 */
export function photoDownloadName(
  photo: OfficePhoto,
  variant: 'field' | 'office',
): string {
  // 內業回應沒有項次序號；沿用穩定識別，避免推測重排後的項次。
  const points = photo.is_overview
    ? '總覽'
    : photo.point_ids.length
      ? `項次-${[...photo.point_ids].sort().join('+')}`
      : '未對應項次'
  return [
    segment(photo.labels.project_name ?? '', '未記錄工程', 48),
    segment(photo.labels.item_title ?? '', '未記錄項目', 48),
    segment(points, '未對應項次', 64),
    `照片-${segment(photo.id, '未記錄', 40)}`,
    variant === 'office' ? '內業版.jpg' : '現場版.jpg',
  ].join('_')
}
