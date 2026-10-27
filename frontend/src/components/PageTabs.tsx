import { useId, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

import styles from './PageTabs.module.css'

/**
 * 共用頁內分頁：方向鍵、Home／End 循環切換，只有目前分頁在 tab 順序內。
 * @remarks 對應 UDS-R05（selected、focus-visible 與鍵盤狀態）。
 */
export function PageTabs({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: string; label: ReactNode; panelId: string }[]
  value: string
  onChange: (value: string) => void
  label: string
}) {
  const instanceId = useId()
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())

  function move(event: KeyboardEvent<HTMLButtonElement>) {
    // Alt+←／→ 是瀏覽器的上一頁／下一頁，Ctrl／Cmd／Shift 組合也屬於
    // 瀏覽器或輔助科技；攔下來會讓使用者無法離開頁面。
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return
    const current = tabs.findIndex((tab) => tab.id === value)
    let next: number
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length
    else if (event.key === 'ArrowLeft')
      next = (current - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    const tab = tabs[next]
    onChange(tab.id)
    tabRefs.current.get(tab.id)?.focus()
  }

  return (
    <div aria-label={label} className={styles.tabs} role="tablist">
      {tabs.map((tab) => (
        <button
          aria-controls={tab.panelId}
          aria-selected={value === tab.id}
          className={styles.tab}
          id={`${instanceId}-page-tab-${tab.id}`}
          key={tab.id}
          onClick={() => onChange(tab.id)}
          onKeyDown={move}
          ref={(node) => {
            if (node) tabRefs.current.set(tab.id, node)
            else tabRefs.current.delete(tab.id)
          }}
          role="tab"
          tabIndex={value === tab.id ? 0 : -1}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
