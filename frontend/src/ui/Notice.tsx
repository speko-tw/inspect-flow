import { useEffect, useRef, type ReactNode } from 'react'

import { revealElement } from './reveal'

/** UDS-R18：成功只播報；需要修正的錯誤才聚焦，不以計時器隱藏結果。 */
export function Notice({
  children,
  variant = 'success',
  id,
  autoReveal = true,
}: {
  children: ReactNode
  variant?: 'success' | 'error' | 'info'
  id?: string
  /** 背景載入可關掉捲動與聚焦；使用者主動操作維持預設。 */
  autoReveal?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const previous = useRef<{
    variant: string
    text: string
    autoReveal: boolean
  } | null>(null)
  useEffect(() => {
    const text = root.current?.textContent ?? ''
    if (
      previous.current?.variant === variant &&
      previous.current.text === text &&
      previous.current.autoReveal === autoReveal
    )
      return
    previous.current = { variant, text, autoReveal }
    if (!autoReveal) return
    revealElement(root.current)
    if (variant === 'error') root.current?.focus({ preventScroll: true })
  }, [children, variant, autoReveal])
  return (
    <div
      className={`notice notice-${variant}`}
      id={id}
      ref={root}
      role={variant === 'error' ? 'alert' : 'status'}
      tabIndex={variant === 'error' ? -1 : undefined}
    >
      {children}
    </div>
  )
}
