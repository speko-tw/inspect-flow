import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { deferred } from '../testing/submitGuard'
import type { SubmitGuard } from './submitGuard'
import { FieldError, Form, FormSubmitButton } from './Form'

function createGuard(enterResult: boolean): SubmitGuard {
  const run: SubmitGuard['run'] = async <T,>(
    task: () => T | Promise<T>,
  ): Promise<T | undefined> => task()
  return {
    enter: vi.fn(() => enterResult),
    leave: vi.fn(),
    run,
  }
}

describe('Form primitive guard', () => {
  it('only submits once while a request is pending', async () => {
    const gate = deferred<void>()
    const onSubmit = vi.fn(() => gate.promise)
    render(
      <Form onSubmit={onSubmit}>
        <FormSubmitButton>儲存</FormSubmitButton>
      </Form>,
    )
    const button = screen.getByRole('button', { name: '儲存' })
    const form = button.closest('form')!

    fireEvent.click(button)
    fireEvent.submit(form)

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(button).toBeDisabled()
    await act(async () => gate.resolve())
    expect(button).toBeEnabled()
  })

  it('ignores an Enter used to confirm an IME candidate', () => {
    const onSubmit = vi.fn()
    render(
      <Form onSubmit={onSubmit}>
        <input aria-label="輸入" />
        <FormSubmitButton>儲存</FormSubmitButton>
      </Form>,
    )

    expect(
      fireEvent.keyDown(screen.getByLabelText('輸入'), {
        key: 'Enter',
        isComposing: true,
      }),
    ).toBe(false)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('shared form errors', () => {
  it('presents form and field errors with the shared error classes', () => {
    render(
      <Form error="表單錯誤" onSubmit={vi.fn()}>
        <FieldError id="name-error">欄位錯誤</FieldError>
        <FormSubmitButton>儲存</FormSubmitButton>
      </Form>,
    )

    expect(screen.getByText('表單錯誤')).toHaveClass('shared-form-error')
    expect(screen.getByText('欄位錯誤')).toHaveClass('shared-field-error')
  })
})

describe('Form submission failures and guards', () => {
  it('shows the generic error and releases after a synchronous throw', () => {
    const guard = createGuard(true)
    const onSubmit = vi.fn(() => {
      throw new Error('sync failure')
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <Form guard={guard} onSubmit={onSubmit}>
        <FormSubmitButton>儲存</FormSubmitButton>
      </Form>,
    )

    fireEvent.click(screen.getByRole('button', { name: '儲存' }))

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(screen.getByRole('alert')).toHaveTextContent(
      '操作失敗，請稍後再試。',
    )
    expect(guard.leave).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })

  it('releases after a rejected Promise', async () => {
    const guard = createGuard(true)
    const onSubmit = vi.fn(() => Promise.reject(new Error('async failure')))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <Form guard={guard} onSubmit={onSubmit}>
        <FormSubmitButton>儲存</FormSubmitButton>
      </Form>,
    )

    fireEvent.click(screen.getByRole('button', { name: '儲存' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '操作失敗，請稍後再試。',
    )
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(guard.leave).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })

  it('does not call onSubmit when the supplied guard is occupied', () => {
    const guard = createGuard(false)
    const onSubmit = vi.fn()
    render(
      <Form guard={guard} onSubmit={onSubmit}>
        <FormSubmitButton>儲存</FormSubmitButton>
      </Form>,
    )

    fireEvent.click(screen.getByRole('button', { name: '儲存' }))

    expect(guard.enter).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(guard.leave).not.toHaveBeenCalled()
  })

  it('releases the supplied guard after a successful request', async () => {
    const guard = createGuard(true)
    const gate = deferred<void>()
    render(
      <Form guard={guard} onSubmit={() => gate.promise}>
        <FormSubmitButton>儲存</FormSubmitButton>
      </Form>,
    )

    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    expect(guard.leave).not.toHaveBeenCalled()
    await act(async () => gate.resolve())
    expect(guard.leave).toHaveBeenCalledOnce()
  })
})
