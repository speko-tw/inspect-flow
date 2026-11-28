type CachedFormatter = {
  formatter: Intl.DateTimeFormat
  timezone?: string
}

const formatterCache = new Map<string, CachedFormatter>()

function getFormatter(timezone: string): CachedFormatter {
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
  let result: CachedFormatter
  try {
    result = {
      formatter: new Intl.DateTimeFormat('en-GB', {
        ...options,
        timeZone: timezone,
      }),
      timezone,
    }
  } catch {
    try {
      result = {
        formatter: new Intl.DateTimeFormat('en-GB', {
          ...options,
          timeZone: 'Asia/Taipei',
        }),
        timezone: 'Asia/Taipei',
      }
    } catch {
      result = { formatter: new Intl.DateTimeFormat('en-GB', options) }
    }
  }
  formatterCache.set(timezone, result)
  return result
}

/**
 * 以照片保存的標示時區顯示內業時間；無效設定會安全回退。
 * @param value API UTC 時間或缺值。
 * @param timezone API 提供的有效時區。
 * @param includeTimezone 是否在文字後附上實際採用的時區。
 */
export function formatRecordedTime(
  value: string | null | undefined,
  timezone = 'Asia/Taipei',
  includeTimezone = true,
): string {
  if (!value) return '未記錄'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未記錄'
  const { formatter, timezone: effectiveTimezone } = getFormatter(timezone)
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  )
  const suffix =
    includeTimezone && effectiveTimezone ? `（${effectiveTimezone}）` : ''
  return (
    `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:` +
    `${parts.minute}${suffix}`
  )
}
