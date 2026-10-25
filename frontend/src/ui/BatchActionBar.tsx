import type { ReactNode } from 'react'

/** UDS-R18：清單旁依操作、回饋、確認排序，避免批次結果漂到頁首。 */
export function BatchActionBar({
  label = '批次操作',
  actions,
  feedback,
  confirmation,
}: {
  label?: string
  actions: ReactNode
  feedback?: ReactNode
  confirmation?: ReactNode
}) {
  return (
    <section aria-label={label} className="batch-action-bar">
      <div className="batch-action-bar-actions">{actions}</div>
      {feedback}
      {confirmation}
    </section>
  )
}
