import { cloneElement, type ReactElement, type ReactNode } from 'react'

import { Input, type InputProps } from './Input'
import styles from './components.module.css'

/**
 * 將標籤、必填、提示與錯誤關聯到輸入控制項。
 * @remarks 對應 UDS-R03、R05。
 */
export function Field({
  id,
  label,
  required = false,
  hint,
  error,
  children,
}: {
  id: string
  label: ReactNode
  required?: boolean
  hint?: ReactNode
  error?: ReactNode
  children?: ReactElement<InputProps>
}) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [children?.props['aria-describedby'], hintId, errorId]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
        {required ? (
          <>
            <span aria-hidden="true" className={styles.required}>
              *
            </span>
            <span className="visually-hidden">（必填）</span>
          </>
        ) : null}
      </label>
      {children ? (
        cloneElement(children, {
          id,
          required,
          'aria-describedby': describedBy || undefined,
          'aria-invalid': error ? true : undefined,
        })
      ) : (
        <Input
          aria-describedby={describedBy || undefined}
          aria-invalid={error ? true : undefined}
          id={id}
          required={required}
        />
      )}
      {hint ? (
        <span className={styles.fieldHint} id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className={styles.fieldError} id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}
