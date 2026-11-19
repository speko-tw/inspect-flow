const recordedTimeFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** FEV-R22：固定來源的檢驗時間沿用標示格式，不隨瀏覽器時區變動。 */
export function formatRecordedTime(value: string | null | undefined): string {
  if (!value) return '未記錄'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未記錄'
  const parts = Object.fromEntries(
    recordedTimeFormat
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )
  return (
    `${parts.year}/${parts.month}/${parts.day} ` +
    `${parts.hour}:${parts.minute}`
  )
}
