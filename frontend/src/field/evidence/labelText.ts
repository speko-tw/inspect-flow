/** FEV-R22：空字串與 null 均採用後端合成的缺值字樣。 */
export function labelText(
  value: string | null | undefined,
  location = false,
): string {
  return value || (location ? '未填寫' : '未記錄')
}

/** FEV-R22：依 API 提供的時區顯示 UTC 來源時間。 */
export function formatRecordedTime(
  value: string | null | undefined,
  timezone = 'Asia/Taipei',
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
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`
}
