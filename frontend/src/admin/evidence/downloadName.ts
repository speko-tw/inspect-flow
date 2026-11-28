import type { OfficePhoto } from './api'
import { formatRecordedTime } from './labelTime'

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

// 過長時保留完整序號並明示總數，不把截斷的數字誤認為項次。
function pointLabel(photo: OfficePhoto): string {
  if (photo.is_overview) return '總覽'
  if (!photo.point_sequences.length)
    return photo.point_ids.length ? '項次未記錄' : '未對應項次'
  const values = [...photo.point_sequences].sort((a, b) => a - b)
  const full = `項次${values.join('+')}`
  if (new TextEncoder().encode(full).length <= 64) return full
  const suffix = `等${values.length}項`
  let result = '項次'
  for (const value of values) {
    const next = `${result}${result === '項次' ? '' : '+'}${value}`
    if (new TextEncoder().encode(next + suffix).length > 64) break
    result = next
  }
  return result + suffix
}

/** 以 FEV-R16 的照片來源產生安全檔名，不帶儲存路徑或人員資料。 */
export function photoDownloadName(
  photo: OfficePhoto,
  variant: 'field' | 'office',
): string {
  // FEV-R16：序號由後端解析照片保存快照，不使用 UUID 或清單順序。
  const points = pointLabel(photo)
  // FEV-Q16：檔名時間與內業標示相同，不用裝置回報的 captured_at。
  const recorded = formatRecordedTime(
    photo.labels.uploaded_at,
    photo.label_timezone,
  ).replace(/（[^（）]*）$/u, '')
  const timestamp = recorded
    .replaceAll('/', '')
    .replace(' ', '-')
    .replace(':', '')
  return [
    segment(photo.labels.project_name ?? '', '未記錄工程', 48),
    segment(photo.labels.item_title ?? '', '未記錄項目', 48),
    segment(points, '未對應項次', 64),
    segment(timestamp, '未記錄', 24),
    segment(photo.id.slice(0, 8), '未記錄', 8),
    variant === 'office' ? '內業版.jpg' : '現場版.jpg',
  ].join('_')
}
