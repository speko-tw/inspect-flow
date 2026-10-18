import type { ReactNode } from 'react'

import styles from './components.module.css'

/** 用標題與選用說明整理靜態內容區段（UDS-R05）。 */
export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header
      className={[styles.sectionHeader, className].filter(Boolean).join(' ')}
    >
      <div className={styles.sectionTitle}>
        <span aria-hidden="true" className={styles.sectionAccent} />
        <div>
          <h2>{title}</h2>
          {description ? (
            <p className={styles.sectionDescription}>{description}</p>
          ) : null}
        </div>
      </div>
      {actions}
    </header>
  )
}
