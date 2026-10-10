import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { deferred } from '../testing/submitGuard'
import { FieldError, Form, FormSubmitButton } from './Form'

const formCases = [
  ['登入', '登入'],
  ['變更密碼', '變更密碼'],
  ['首次設定：登入碼', '下一步'],
  ['首次設定：admin 密碼', '設定密碼'],
  ['使用者管理：搜尋', '搜尋'],
  ['使用者管理：修改資料', '儲存資料'],
  ['使用者管理：公司連結', '儲存公司連結'],
  ['使用者管理：新增使用者', '新增使用者'],
  ['公司管理：搜尋', '搜尋'],
  ['公司管理：新增或改名', '新增公司'],
  ['角色管理：新增或編輯', '新增角色'],
  ['專案管理：搜尋', '搜尋'],
  ['專案管理：新增或編輯', '儲存專案'],
] as const

describe.each(formCases)('%s 共用表單防護', (_name, buttonLabel) => {
  it('only submits once while a request is pending and disables the button', async () => {
    const gate = deferred<void>()
    const onSubmit = vi.fn(() => gate.promise)
    render(
      <Form onSubmit={onSubmit}>
        <FormSubmitButton>{buttonLabel}</FormSubmitButton>
      </Form>,
    )
    const button = screen.getByRole('button', { name: buttonLabel })
    const form = button.closest('form')!

    fireEvent.submit(form)
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
        <FormSubmitButton>{buttonLabel}</FormSubmitButton>
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

  it('allows another submit after a failed request', async () => {
    const gate = deferred<void>()
    const onSubmit = vi.fn(async () => {
      try {
        await gate.promise
      } catch {
        // The page handles request errors before the shared form releases.
      }
    })
    render(
      <Form onSubmit={onSubmit}>
        <FormSubmitButton>{buttonLabel}</FormSubmitButton>
      </Form>,
    )
    const button = screen.getByRole('button', { name: buttonLabel })
    const form = button.closest('form')!

    fireEvent.submit(form)
    await act(async () => gate.reject(new Error('request failed')))
    expect(button).toBeEnabled()
    fireEvent.submit(form)
    expect(onSubmit).toHaveBeenCalledTimes(2)
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
