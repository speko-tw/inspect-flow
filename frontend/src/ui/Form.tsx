import {
  createContext,
  useContext,
  useRef,
  useState,
  type FormEvent,
  type FormHTMLAttributes,
  type ReactNode,
  type ButtonHTMLAttributes,
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
  guard?: SubmitGuard
}

/** Shared form submission, IME handling, and error presentation. */
export function Form({
  children,
  error,
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
          <FormError>{error || unexpectedError}</FormError>
        ) : null}
        {children}
      </form>
    </FormContext.Provider>
  )
}

/** A submit button disabled automatically while its shared form is pending. */
export function FormSubmitButton({
  children,
  disabled = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const context = useContext(FormContext)
  return (
    <button
      {...props}
      disabled={disabled || Boolean(context?.pending)}
      type="submit"
    >
      {children}
    </button>
  )
}

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <p className="shared-form-error" role="alert">
      {children}
    </p>
  )
}

export function FieldError({
  children,
  id,
}: {
  children: ReactNode
  id?: string
}) {
  if (!children) return null
  return (
    <p className="shared-field-error" id={id} role="alert">
      {children}
    </p>
  )
}
