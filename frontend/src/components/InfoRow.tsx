import type { ReactNode } from 'react'

import styles from './components.module.css'

/** 以描述清單呈現一組靜態名稱與值（UDS-R05）。 */
export function InfoRow({
  label,
  value,
  className,
}: {
  label: ReactNode
  value: ReactNode
  className?: string
}) {
  return (
    <dl className={className}>
      <div className={styles.infoRow}>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    </dl>
  )
}
