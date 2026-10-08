// 共用的確認框（#501）。
//
// 取代原本 9 種確認框容器。外觀與行為只有一套：
//   - 按鈕固定 [取消][確認]，取消在前；確認鈕顏色由 `variant` 決定：
//     `danger` 會立刻剝奪他人存取或無法復原（btn-danger），`neutral`
//     是授予、恢復或一般確認（btn-primary）。
//   - 預設把焦點放在取消（`initialFocus`），按 Esc 等同取消。
//   - 預設是原地展開的非 modal 區塊；只有真的要蓋住整頁的地方
//     （計畫頁，背景要 inert）才傳 `modal`。
// 送出邏輯留在各頁，這裡只負責外觀、焦點與鍵盤。

import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useRef,
} from 'react'

export type ConfirmVariant = 'danger' | 'neutral'

export type ConfirmRole = 'group' | 'region' | 'dialog' | 'alertdialog'

export type ConfirmBoxProps = {
  variant?: ConfirmVariant
  /** 容器的 ARIA 角色；原地確認用 group，要蓋住整頁用 dialog。 */
  role?: ConfirmRole
  /** 沒有標題時，用這個當容器的可存取名稱。 */
  label?: string
  /** 有標題就用標題當可存取名稱。 */
  title?: ReactNode
  headingLevel?: 2 | 3
  headingRef?: Ref<HTMLHeadingElement>
  rootRef?: Ref<HTMLDivElement>
  cancelRef?: Ref<HTMLButtonElement>
  /** 掛載時把焦點放哪；預設取消。呼叫端自己管理焦點時傳 `none`。 */
  initialFocus?: 'cancel' | 'heading' | 'none'
  /** 蓋住整頁的 modal（計畫頁專用）；其餘一律原地展開。 */
  modal?: boolean
  /** 內容含必填欄位時，用 form 包起來，確認鈕改成 submit。 */
  asForm?: boolean
  cancelLabel?: string
  confirmLabel: string
  busy?: boolean
  confirmDisabled?: boolean
  onCancel: () => void
  onConfirm: () => void
  children?: ReactNode
}

export function ConfirmBox({
  variant = 'neutral',
  role = 'group',
  label,
  title,
  headingLevel = 2,
  headingRef,
  rootRef,
  cancelRef,
  initialFocus = 'cancel',
  modal = false,
  asForm = false,
  cancelLabel = '取消',
  confirmLabel,
  busy = false,
  confirmDisabled = false,
  onCancel,
  onConfirm,
  children,
}: ConfirmBoxProps) {
  const headingId = useId()
  const localCancel = useRef<HTMLButtonElement | null>(null)
  const localHeading = useRef<HTMLHeadingElement | null>(null)

  useEffect(() => {
    if (initialFocus === 'cancel') localCancel.current?.focus()
    else if (initialFocus === 'heading') localHeading.current?.focus()
    // 只在掛載時決定一次焦點；之後的焦點交給使用者與呼叫端。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      // 送出中取消鈕是停用的，Esc 要一致；否則錯誤訊息會跟著確認框消失。
      if (!busy) onCancel()
    }
  }

  const Heading = `h${headingLevel}` as 'h2' | 'h3'
  const className = [
    'confirm-box',
    `confirm-box-${variant}`,
    modal ? 'confirm-box-modal' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const body = (
    <>
      {title ? (
        <Heading
          className="confirm-box-title"
          id={headingId}
          ref={(node) => {
            localHeading.current = node
            assignRef(headingRef, node)
          }}
          tabIndex={-1}
        >
          {title}
        </Heading>
      ) : null}
      <div className="confirm-box-body">{children}</div>
      <div className="confirm-box-actions">
        <button
          disabled={busy}
          onClick={onCancel}
          ref={(node) => {
            localCancel.current = node
            assignRef(cancelRef, node)
          }}
          type="button"
        >
          {cancelLabel}
        </button>
        <button
          className={variant === 'danger' ? 'btn-danger' : 'btn-primary'}
          disabled={busy || confirmDisabled}
          onClick={asForm ? undefined : onConfirm}
          type={asForm ? 'submit' : 'button'}
        >
          {confirmLabel}
        </button>
      </div>
    </>
  )

  const common = {
    'aria-label': title ? undefined : label,
    'aria-labelledby': title ? headingId : undefined,
    'aria-modal': modal ? (true as const) : undefined,
    className,
    onKeyDown: handleKeyDown,
    role,
  }

  if (asForm) {
    return (
      <form
        {...common}
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          onConfirm()
        }}
        ref={rootRef as Ref<HTMLFormElement>}
      >
        {body}
      </form>
    )
  }
  return (
    <div {...common} ref={rootRef}>
      {body}
    </div>
  )
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value)
  else if (ref) (ref as { current: T | null }).current = value
}
