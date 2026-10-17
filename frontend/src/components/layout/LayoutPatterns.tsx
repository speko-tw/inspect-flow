import { useId, type ReactNode } from 'react'

import '../../styles/layout-patterns.css'

/**
 * 桌機並列顯示清單與詳情，窄螢幕逐層瀏覽並可返回清單。
 */
export function ListDetailLayout({
  listTitle,
  detailTitle,
  list,
  detail,
  onBack,
}: {
  listTitle: string
  detailTitle: string
  list: ReactNode
  detail?: ReactNode
  onBack: () => void
}) {
  const hasDetail = detail !== undefined && detail !== null

  return (
    <div
      className="layout-list-detail"
      data-active-pane={hasDetail ? 'detail' : 'list'}
    >
      <section className="layout-list-pane" aria-label={listTitle}>
        {list}
      </section>
      {hasDetail && (
        <section className="layout-detail-pane" aria-label={detailTitle}>
          <button
            className="layout-mobile-back"
            type="button"
            onClick={onBack}
          >
            返回{listTitle}
          </button>
          {detail}
        </section>
      )}
    </div>
  )
}

/**
 * 以明確的新增或修改標題呈現獨立表單內容。
 */
export function RecordFormLayout({
  mode,
  recordName,
  description,
  children,
}: {
  mode: 'create' | 'edit'
  recordName: string
  description?: string
  children: ReactNode
}) {
  const action = mode === 'create' ? '新增' : '修改'

  return (
    <main className="layout-form-page">
      <header className="layout-form-heading">
        <p className="layout-form-mode">{action}</p>
        <h1 className="layout-keep-words">
          {action}
          {recordName}
        </h1>
        {description && <p className="layout-prose">{description}</p>}
      </header>
      <div className="layout-form-content">{children}</div>
    </main>
  )
}

/**
 * 顯示非同步資源的載入、空資料或失敗狀態。
 */
export function ResourceState({
  state,
  title,
  message,
  actionLabel,
  onAction,
}: {
  state: 'loading' | 'empty' | 'error'
  title: string
  message: string
  actionLabel?: string
  onAction?: () => void
}) {
  const isLoading = state === 'loading'

  return (
    <section
      className={`layout-resource-state layout-${state}`}
      role={isLoading || state === 'empty' ? 'status' : 'alert'}
      aria-busy={isLoading ? true : undefined}
      aria-live={isLoading ? 'polite' : undefined}
    >
      <h2 className="layout-keep-words">{title}</h2>
      <p className="layout-prose">{message}</p>
      {actionLabel && onAction && !isLoading && (
        <button
          className="layout-state-action"
          type="button"
          onClick={onAction}
        >
          {actionLabel}
        </button>
      )}
    </section>
  )
}

/**
 * 用服務端筆數呈現清單等待狀態或已載入完成的回饋。
 */
export function ListStatus(
  props:
    | {
        state: 'loading'
      }
    | {
        state: 'complete'
        count: number
      },
) {
  const message =
    props.state === 'loading' ? '載入中…' : `已顯示全部 ${props.count} 筆。`

  return (
    <p
      className={`layout-list-status layout-list-status-${props.state}`}
      role="status"
      aria-busy={props.state === 'loading' ? true : undefined}
    >
      {message}
    </p>
  )
}

/**
 * 在頁面內說明確認對象與影響，並分開取消和執行動作。
 */
export function ConfirmationPanel({
  tone,
  title,
  subject,
  impact,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  tone: 'neutral' | 'danger'
  title: string
  subject: string
  impact: string
  cancelLabel: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const titleId = useId()

  return (
    <section
      className={`layout-confirmation layout-confirmation-${tone}`}
      role="alertdialog"
      aria-labelledby={titleId}
    >
      <h2 id={titleId}>{title}</h2>
      <p>
        <strong>對象：</strong>
        {subject}
      </p>
      <p>
        <strong>影響：</strong>
        {impact}
      </p>
      <div className="layout-confirmation-actions">
        <button type="button" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </section>
  )
}

/**
 * 提供可聚焦欄位的錯誤連結，並保留原因與修正說明。
 */
export function FormErrorSummary({
  errors,
}: {
  errors: Array<{
    fieldId: string
    fieldLabel: string
    message: string
  }>
}) {
  if (errors.length === 0) return null
  return <FormErrorSummaryContent errors={errors} />
}

function FormErrorSummaryContent({
  errors,
}: {
  errors: Array<{
    fieldId: string
    fieldLabel: string
    message: string
  }>
}) {
  const titleId = useId()

  return (
    <section
      className="layout-form-error-summary"
      role="alert"
      aria-labelledby={titleId}
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

/**
 * 以形狀、文字與目前步驟語意呈現不具互動性的進度列。
 */
export function SetupSteps({
  steps,
}: {
  steps: Array<{
    label: string
    status: 'complete' | 'current' | 'upcoming'
  }>
}) {
  const statusText = {
    complete: '已完成',
    current: '目前步驟',
    upcoming: '未開始',
  }

  return (
    <ol className="layout-setup-steps">
      {steps.map((step, index) => (
        <li
          className={`layout-step layout-step-${step.status}`}
          key={`${step.label}-${index}`}
          aria-current={step.status === 'current' ? 'step' : undefined}
        >
          <span className="layout-step-marker" aria-hidden="true">
            {step.status === 'complete' ? '✓' : index + 1}
          </span>
          <span className="layout-step-copy">
            <span className="layout-step-label layout-keep-words">
              {step.label}
            </span>
            <span className="layout-step-status">
              {statusText[step.status]}
            </span>
          </span>
        </li>
      ))}
    </ol>
  )
}
