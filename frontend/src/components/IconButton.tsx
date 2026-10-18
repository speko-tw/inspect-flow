import type { ButtonHTMLAttributes, ReactNode } from 'react'

import styles from './components.module.css'

/**
 * 為圖示操作提供原生按鈕及必要的可及名稱。
 * @remarks 對應 UDS-R05。
 */
export function IconButton({
  'aria-label': ariaLabel,
  children,
  className,
  disabled = false,
  loading = false,
  onClick,
  type = 'button',
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  'aria-label': string
  children: ReactNode
  loading?: boolean
}) {
  const isDisabled = disabled || loading
  const handleClick: typeof onClick = (event) => {
    if (isDisabled) return
    onClick?.(event)
  }

  return (
    <button
      {...props}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      className={[styles.iconButton, className].filter(Boolean).join(' ')}
      disabled={isDisabled}
      onClick={handleClick}
      type={type}
    >
      {children}
    </button>
  )
}
