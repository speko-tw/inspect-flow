// 依 ADM-R37、ADM-R38 共用確認框，避免各頁的危險色與焦點規則分歧。
//
// 取代原本 9 種確認框容器。外觀與行為只有一套：
//   - 按鈕固定 [取消][確認]，取消在前；確認鈕顏色由 `variant` 決定：
//     `danger` 會立刻剝奪他人存取或無法復原（btn-danger），`neutral`
//     是授予、恢復或一般確認（btn-primary）。
//   - 預設把焦點放在取消（`initialFocus`），按 Esc 等同取消。
//   - 預設是原地展開的非 modal 區塊；只有真的要蓋住整頁的地方
//     （計畫頁，背景要 inert）才傳 `modal`。
// 送出邏輯留在各頁，這裡只負責外觀、焦點與鍵盤；另擋兩種誤送出：
//   - 確認進行中（`onConfirm` 回傳的 Promise 還沒完成）不接受第二次確認。
//   - 輸入法選字時按的 Enter 不會送出 asForm 的表單。

import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

import { blockImeEnter, useSubmitGuard } from './submitGuard'
import { FormError } from './Form'
import { GENERIC_FAILURE_MESSAGE } from '../http'

/**
 * 依 ADM-R37，danger 用於立即收回他人權限、讓他人工作失效或
 * 無法復原的最終確認；neutral 用於授予、恢復與一般確認。
 */
export type ConfirmVariant = 'danger' | 'neutral'

/**
 * 依確認框是否蓋住頁面選擇 ARIA 角色；原地展開的 dialog
 * 不加 aria-modal（ADM-R38）。
 */
export type ConfirmRole = 'group' | 'region' | 'dialog' | 'alertdialog'

/** ADM-R38 的共用確認框選項；送出與拒絕原因仍由呼叫頁處理。 */
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
  /**
   * 關掉瀏覽器原生的必填提示（只在 `asForm` 時有效）。呼叫端要自己
   * 驗證並把錯誤放在欄位旁、設 aria-invalid、聚焦（ADM-R28）時使用；
   * 否則原生提示會先擋下送出，自訂錯誤永遠顯示不出來。
   */
  noValidate?: boolean
  cancelLabel?: string
  confirmLabel: string
  busy?: boolean
  confirmDisabled?: boolean
  onCancel: () => void
  /** 回傳 Promise 時，到它完成為止都不接受第二次確認。 */
  onConfirm: () => void | Promise<unknown>
  children?: ReactNode
}

/**
 * 依 ADM-R37、ADM-R38 提供一致的按鈕、焦點與 Esc 行為。
 * 確認進行中拒絕第二次確認，避免寫入操作重複執行。
 */
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
  noValidate = false,
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
  const guard = useSubmitGuard()
  const [confirmError, setConfirmError] = useState('')

  useEffect(() => {
    if (initialFocus === 'cancel') localCancel.current?.focus()
    else if (initialFocus === 'heading') localHeading.current?.focus()
    // 只在掛載時決定一次焦點；之後的焦點交給使用者與呼叫端。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function confirm() {
    setConfirmError('')
    try {
      await guard.run(onConfirm)
    } catch (error) {
      console.error('Confirmation failed:', error)
      setConfirmError(GENERIC_FAILURE_MESSAGE)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    // 選字中的 Enter 只是確認選字；取消預設動作，避免瀏覽器隱含送出。
    if (blockImeEnter(event)) return
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
      <div className="confirm-box-body">
        {children}
        {confirmError ? <FormError>{confirmError}</FormError> : null}
      </div>
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
          onClick={asForm ? undefined : confirm}
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
        noValidate={noValidate}
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          void confirm()
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
