import type { ReactNode } from 'react'

import styles from './components.module.css'

export type BadgeVariant =
  'neutral' | 'success' | 'warning' | 'danger' | 'info'

/** 顯示帶文字線索的靜態狀態分類（UDS-R05）。 */
export function Badge({
  variant = 'neutral',
  children,
  className,
}: {
  variant?: BadgeVariant
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={[styles.badge, styles[variant], className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </span>
  )
}
