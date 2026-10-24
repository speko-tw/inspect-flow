import { useEffect, useRef, type ReactNode } from 'react'

import { revealElement } from './reveal'

/** UDS-R18：成功只播報；需要修正的錯誤才聚焦，不以計時器隱藏結果。 */
export function Notice({
  children,
  variant = 'success',
  id,
}: {
  children: ReactNode
  variant?: 'success' | 'error' | 'info'
  id?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const previous = useRef<{ variant: string; text: string } | null>(null)
  useEffect(() => {
    const text = root.current?.textContent ?? ''
    if (
      previous.current?.variant === variant &&
      previous.current.text === text
    )
      return
    previous.current = { variant, text }
    revealElement(root.current)
    if (variant === 'error') root.current?.focus({ preventScroll: true })
  }, [children, variant])
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
