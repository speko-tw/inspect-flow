import {
  createContext,
  useEffect,
  useContext,
  useRef,
  useState,
  type FormEvent,
  type FormHTMLAttributes,
  type ReactNode,
  type ButtonHTMLAttributes,
  type Ref,
} from 'react'

import { blockImeEnter } from './submitGuard'
import type { SubmitGuard } from './submitGuard'
import { GENERIC_FAILURE_MESSAGE } from '../http'
import './Form.css'

type FormContextValue = { pending: boolean }

const FormContext = createContext<FormContextValue | null>(null)

export type FormProps = Omit<
  FormHTMLAttributes<HTMLFormElement>,
  'onSubmit'
> & {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<unknown>
  error?: ReactNode
  errorFocusRequest?: number
  errorTabIndex?: number
  guard?: SubmitGuard
}

/** Shared form submission, IME handling, and error presentation. */
export function Form({
  children,
  error,
  errorFocusRequest,
  errorTabIndex,
  onKeyDown,
  onSubmit,
  guard,
  ...props
}: FormProps) {
  const inFlight = useRef(false)
  const [pending, setPending] = useState(false)
  const [unexpectedError, setUnexpectedError] = useState('')

  function release() {
    inFlight.current = false
    guard?.leave()
    setPending(false)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    if (guard && !guard.enter()) return
    inFlight.current = true
    setPending(true)
    setUnexpectedError('')
    let result: void | Promise<unknown>
    try {
      result = onSubmit(event)
    } catch (error) {
      console.error('Shared form submission failed:', error)
      setUnexpectedError(GENERIC_FAILURE_MESSAGE)
      release()
      return
    }
    if (result && typeof result.then === 'function') {
      return Promise.resolve(result)
        .catch((error) => {
          console.error('Shared form submission failed:', error)
          setUnexpectedError(GENERIC_FAILURE_MESSAGE)
        })
        .finally(release)
    }
    release()
  }

  return (
    <FormContext.Provider value={{ pending }}>
      <form
        {...props}
        onKeyDown={(event) => {
          if (blockImeEnter(event)) return
          onKeyDown?.(event)
        }}
        onSubmit={handleSubmit}
      >
        {error || unexpectedError ? (
          <FormError focusRequest={errorFocusRequest} tabIndex={errorTabIndex}>
            {error || unexpectedError}
          </FormError>
        ) : null}
        {children}
      </form>
    </FormContext.Provider>
  )
}

/** A submit button disabled while its shared form is pending. */
export function FormSubmitButton({
  children,
  pendingContent,
  disabled = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  pendingContent?: ReactNode
}) {
  const context = useContext(FormContext)
  return (
    <button
      {...props}
      disabled={disabled || Boolean(context?.pending)}
      type="submit"
    >
      {context?.pending && pendingContent ? pendingContent : children}
    </button>
  )
}

/** A non-submit action disabled while its shared form is pending. */
export function FormActionButton({
  children,
  disabled = false,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const context = useContext(FormContext)
  return (
    <button
      {...props}
      disabled={disabled || Boolean(context?.pending)}
      type={type}
    >
      {children}
    </button>
  )
}

type ErrorProps = {
  children: ReactNode
  id?: string
  tabIndex?: number
  focusRequest?: number
  ref?: Ref<HTMLParagraphElement>
}

function useRequestedFocus(
  elementRef: { current: HTMLParagraphElement | null },
  focusRequest: number | undefined,
  focusTarget?: { readonly current: HTMLElement | null },
) {
  useEffect(() => {
    if (focusRequest === undefined) return
    const target = focusTarget?.current ?? elementRef.current
    if (!target) return
    if (document.activeElement === target) target.blur()
    target.focus()
  }, [elementRef, focusRequest, focusTarget])
}

export function FormError({
  children,
  id,
  tabIndex,
  focusRequest,
  ref: forwardedRef,
}: ErrorProps) {
  const localRef = useRef<HTMLParagraphElement>(null)
  useRequestedFocus(localRef, focusRequest)
  if (!children) return null
  return (
    <p
      className="shared-form-error"
      id={id}
      ref={(node) => {
        localRef.current = node
        if (typeof forwardedRef === 'function') forwardedRef(node)
        else if (forwardedRef) forwardedRef.current = node
      }}
      role="alert"
      tabIndex={tabIndex}
    >
      {children}
    </p>
  )
}

export function FieldError({
  children,
  id,
  tabIndex,
  focusRequest,
  ref: forwardedRef,
  focusTarget,
}: {
  children: ReactNode
  id?: string
  tabIndex?: number
  focusRequest?: number
  ref?: Ref<HTMLParagraphElement>
  focusTarget?: { readonly current: HTMLElement | null }
}) {
  const localRef = useRef<HTMLParagraphElement>(null)
  useRequestedFocus(localRef, focusRequest, focusTarget)
  if (!children) return null
  return (
    <p
      className="shared-field-error"
      id={id}
      ref={(node) => {
        localRef.current = node
        if (typeof forwardedRef === 'function') forwardedRef(node)
        else if (forwardedRef) forwardedRef.current = node
      }}
      role="alert"
      tabIndex={tabIndex}
    >
      {children}
    </p>
  )
}
