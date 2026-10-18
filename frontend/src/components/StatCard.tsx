import type { ReactNode } from 'react'

import styles from './components.module.css'

/** 顯示單一統計值與其標籤，不暗示可互動（UDS-R05）。 */
export function StatCard({
  label,
  value,
  description,
  className,
}: {
  label: ReactNode
  value: ReactNode
  description?: ReactNode
  className?: string
}) {
  return (
    <div className={[styles.statCard, className].filter(Boolean).join(' ')}>
      <span className={styles.statLabel}>{label}</span>
      <strong className={styles.statValue}>{value}</strong>
      {description ? (
        <span className={styles.statDescription}>{description}</span>
      ) : null}
    </div>
  )
}
