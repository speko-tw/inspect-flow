import type { ButtonHTMLAttributes, ReactNode } from 'react'

import styles from './components.module.css'

export type ButtonVariant =
  'primary' | 'secondary' | 'tertiary' | 'destructive' | 'destructiveOutline'

/**
 * 依優先順序呈現操作，載入時阻擋重複觸發。
 * @remarks 對應 UDS-R04、R05。
 */
export function Button({
  variant = 'secondary',
  loading = false,
  loadingText = '載入中…',
  disabled = false,
  children,
  className,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  loading?: boolean
  loadingText?: ReactNode
  children: ReactNode
}) {
  const isDisabled = disabled || loading
  const handleClick: typeof onClick = (event) => {
    if (isDisabled) return
    onClick?.(event)
  }

  return (
    <button
      {...props}
      aria-busy={loading || undefined}
      className={[styles.button, styles[variant], className]
        .filter(Boolean)
        .join(' ')}
      disabled={isDisabled}
      onClick={handleClick}
    >
      {loading ? loadingText : children}
    </button>
  )
}
