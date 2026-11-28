/** FEV-R22：空字串與 null 均採用後端合成的缺值字樣。 */
export function labelText(
  value: string | null | undefined,
  location = false,
): string {
  return value || (location ? '未填寫' : '未記錄')
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function getFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone)
  if (cached) return cached

  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('en-GB', {
      ...options,
      timeZone: timezone,
    })
  } catch {
    try {
      formatter = new Intl.DateTimeFormat('en-GB', {
        ...options,
        timeZone: 'Asia/Taipei',
      })
    } catch {
      formatter = new Intl.DateTimeFormat('en-GB', options)
    }
  }
  formatterCache.set(timezone, formatter)
  return formatter
}

/**
 * FEV-R22：依 API 時區顯示 UTC 來源時間；無效設定會逐級回退。
 * @param value API UTC 時間或缺值。
 * @param timezone API 提供的時區。
 */
export function formatRecordedTime(
  value: string | null | undefined,
  timezone = 'Asia/Taipei',
): string {
  if (!value) return '未記錄'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未記錄'
  const parts = Object.fromEntries(
    getFormatter(timezone)
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )
  return (
    `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:` +
    `${parts.minute}`
  )
}
