/** 以照片保存的標示時區顯示內業時間。 */
export function formatRecordedTime(
  value: string | null | undefined,
  timezone: string,
): string {
  if (!value) return '未記錄'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未記錄'
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
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
  return (
    `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:` +
    `${parts.minute}（${timezone}）`
  )
}
