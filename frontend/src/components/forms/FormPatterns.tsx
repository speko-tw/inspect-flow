import { useEffect, useId, useRef, type ReactNode } from 'react'

import { RequiredMark } from '../../ui/Form'
import '../../styles/form-patterns.css'

/** 讓表單欄位能一致傳入識別與無障礙錯誤狀態。 */
export type FormFieldControlProps = {
  id: string
  'aria-invalid'?: true
  'aria-describedby'?: string
}

/** 依用途分組欄位，讓表單標題與說明保留原生欄位群組語意。 */
export function FormGroup({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  const descriptionId = useId()

  return (
    <fieldset
      className="form-pattern-group"
      aria-describedby={description ? descriptionId : undefined}
    >
      <legend>{title}</legend>
      {description && (
        <p className="form-pattern-group-description" id={descriptionId}>
          {description}
        </p>
      )}
      <div className="form-pattern-group-fields">{children}</div>
    </fieldset>
  )
}

/** 集中欄位的 ARIA 關聯，避免個別表單漏掉錯誤說明。 */
export function FormField({
  label,
  id,
  required = false,
  description,
  error,
  children,
}: {
  label: string
  id?: string
  required?: boolean
  description?: string
  error?: string
  children: (control: FormFieldControlProps) => ReactNode
}) {
  const generatedId = useId()
  const inputId = id ?? `form-field-${generatedId}`
  const descriptionId = `${inputId}-description`
  const errorId = `${inputId}-error`
  const describedBy = [description && descriptionId, error && errorId]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="form-pattern-field">
      <label className="form-pattern-label" htmlFor={inputId}>
        {label}
        {required && (
          <>
            {' '}
            <RequiredMark />
          </>
        )}
      </label>
      {children({
        id: inputId,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy || undefined,
      })}
      {description && (
        <p className="form-pattern-description" id={descriptionId}>
          {description}
        </p>
      )}
      {error && (
        <p className="form-pattern-field-error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  )
}

/** 讓使用者先掌握錯誤，再直接跳到對應欄位修正。 */
export function FormErrorSummary({
  errors,
  focusRequest,
}: {
  errors: Array<{
    fieldId: string
    fieldLabel: string
    message: string
  }>
  focusRequest: number
}) {
  const summaryRef = useRef<HTMLElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (focusRequest > 0) summaryRef.current?.focus()
  }, [focusRequest])

  if (errors.length === 0) return null

  return (
    <section
      ref={summaryRef}
      className="form-pattern-error-summary"
      role="alert"
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <h2 id={titleId}>請修正以下問題</h2>
      <ul>
        {errors.map((error) => (
          <li key={error.fieldId}>
            <a
              href={`#${error.fieldId}`}
              onClick={(event) => {
                event.preventDefault()
                document.getElementById(error.fieldId)?.focus()
              }}
            >
              <strong>{error.fieldLabel}：</strong>
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
