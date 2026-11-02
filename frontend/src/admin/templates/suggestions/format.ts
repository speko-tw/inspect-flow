/** 時間顯示：站內一律本地時區的「年/月/日 時:分」。 */
export function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '時間未記錄'
  const day = new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .replace(/-/g, '/')
  const time = new Intl.DateTimeFormat('zh-TW', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
  return `${day} ${time}`
}

/** 名稱比對：去頭尾空白並 casefold，沿用 TPL-R24 的同名判斷。 */
export function foldName(value: string): string {
  return value.trim().normalize('NFKC').toLowerCase().replaceAll('ß', 'ss')
}

/** 待審期間的限制，提出、重送與核准前的確認都要讓使用者看到。 */
export const PENDING_WARNING = '待審期間不能修改，只能撤回；撤回後不能再重送。'
