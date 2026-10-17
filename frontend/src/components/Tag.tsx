import type { ReactNode } from 'react'

import styles from './components.module.css'

/** 顯示不代表操作結果的中性靜態標籤（UDS-R05）。 */
export function Tag({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={[styles.tag, styles.neutral, className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </span>
  )
}
