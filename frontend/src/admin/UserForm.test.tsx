// 新增使用者表單的可用性提示（#284 第 4～6 項）。

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import UserForm from './UserForm'

const companies = [{ id: 'company-1', name: '示範公司', is_active: true }]

function renderForm() {
  return render(
    <UserForm
      companies={companies}
      onCreated={() => {}}
      onDirtyChange={() => {}}
    />,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('UserForm 必填標示（#284 第 4 項）', () => {
  it('帳號名稱、Email、中文姓名顯示共用必填標記，其他欄位沒有', () => {
    const { container } = renderForm()

    for (const label of [/^帳號名稱/, /^Email/, /^中文姓名/]) {
      const field = screen.getByLabelText(label)
      expect(field).toBeRequired()
      const id = field.getAttribute('id')
      expect(
        document.querySelector(`label[for="${id}"] .required-mark`),
      ).toBeInTheDocument()
    }
    expect(
      screen.getByRole('radiogroup', { name: /帳號類型/ }),
    ).toHaveAttribute('aria-required', 'true')
    expect(screen.getByRole('radio', { name: '內部帳號' })).not.toBeChecked()
    expect(
      screen.getByRole('radio', { name: '外部協作人員' }),
    ).not.toBeChecked()
    for (const label of [/^英文姓名/, /^公司/, /^部門/, /^地點/, /^工號/]) {
      expect(
        document.querySelector(
          `label[for="${screen.getByLabelText(label).getAttribute('id')}"] ` +
            '.required-mark',
        ),
      ).not.toBeInTheDocument()
    }
    // 「*」只是視覺標示，不進入無障礙名稱。
    expect(
      container.querySelectorAll('.required-mark[aria-hidden="true"]'),
    ).toHaveLength(4)
    expect(
      screen.getByRole('textbox', { name: '帳號名稱' }),
    ).toBeInTheDocument()
  })
})

describe('UserForm 反灰欄位說明（#284 第 5 項）', () => {
  it('未連結公司時，部門、地點、工號反灰並各自說明原因', () => {
    renderForm()

    expect(screen.getAllByText('連結公司後才能填寫')).toHaveLength(3)
    for (const label of [/^部門/, /^地點/, /^工號/]) {
      const input = screen.getByLabelText(label)
      expect(input).toBeDisabled()
      expect(input).toHaveAccessibleDescription('連結公司後才能填寫')
    }
  })

  it('選了公司後欄位可填寫，說明消失', () => {
    renderForm()
    fireEvent.change(screen.getByLabelText(/^公司/), {
      target: { value: 'company-1' },
    })

    expect(screen.queryByText('連結公司後才能填寫')).toBeNull()
    for (const label of [/^部門/, /^地點/, /^工號/]) {
      const input = screen.getByLabelText(label)
      expect(input).toBeEnabled()
      expect(input).toHaveAccessibleDescription('')
    }
  })
})

describe('UserForm 帳號名稱規則說明（#284 第 6 項）', () => {
  it('欄位附上規則說明', () => {
    renderForm()

    expect(screen.getByLabelText(/^帳號名稱/)).toHaveAccessibleDescription(
      '3～32 字元，英文字母開頭，可用英數與 . _ -',
    )
    expect(
      screen.getByText('3～32 字元，英文字母開頭，可用英數與 . _ -'),
    ).toBeVisible()
  })
})

describe('UserForm 帳號類型（DOM-R71）', () => {
  it('未選帳號類型時顯示欄位錯誤並聚焦第一個選項', () => {
    renderForm()
    fireEvent.change(screen.getByLabelText(/^帳號名稱/), {
      target: { value: 'ben.lin' },
    })
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: 'ben@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/^中文姓名/), {
      target: { value: '林本' },
    })
    const submit = screen.getByRole('button', { name: '新增帳號' })
    fireEvent.submit(submit.closest('form')!)

    expect(screen.getByRole('alert')).toHaveTextContent(
      '帳號類型尚未選擇。請選擇內部帳號或外部協作人員。',
    )
    expect(screen.getByRole('radio', { name: '內部帳號' })).toHaveFocus()
  })

  it('中文姓名錯誤以帳號用語說明欄位需求', () => {
    renderForm()
    fireEvent.change(screen.getByLabelText(/^帳號名稱/), {
      target: { value: 'ben.lin' },
    })
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: 'ben@example.com' },
    })
    fireEvent.click(screen.getByRole('radio', { name: '內部帳號' }))
    fireEvent.click(screen.getByRole('button', { name: '新增帳號' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      '中文姓名尚未填寫。請輸入帳號持有人的姓名。',
    )
  })

  it('外部協作人員不可為 Admin，切回內部後可重新指派', () => {
    renderForm()
    const adminCheckbox = screen.getByRole('checkbox', {
      name: '指派系統管理者權限',
    })
    fireEvent.click(adminCheckbox)
    expect(adminCheckbox).toBeChecked()

    fireEvent.click(screen.getByRole('radio', { name: '外部協作人員' }))
    expect(adminCheckbox).not.toBeChecked()
    expect(adminCheckbox).toBeDisabled()

    fireEvent.click(screen.getByRole('radio', { name: '內部帳號' }))
    expect(adminCheckbox).toBeEnabled()
    expect(adminCheckbox).not.toBeChecked()
    fireEvent.click(adminCheckbox)
    expect(adminCheckbox).toBeChecked()
  })

  it.each([
    ['內部帳號', false],
    ['外部協作人員', true],
  ])('送出 %s 時傳送外部協作人員標記 %s', async (label, expected) => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toMatch(/\/users$/)
        expect(init?.method).toBe('POST')
        return new Response('{}', {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    )
    vi.stubGlobal('fetch', fetchMock)
    renderForm()

    fireEvent.change(screen.getByLabelText(/^帳號名稱/), {
      target: { value: 'ben.lin' },
    })
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: 'ben@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/^中文姓名/), {
      target: { value: '林本' },
    })
    fireEvent.click(screen.getByRole('radio', { name: label }))
    const submit = screen.getByRole('button', { name: '新增帳號' })
    fireEvent.submit(submit.closest('form')!)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const init = fetchMock.mock.calls[0]?.[1]
    expect(init?.body).toBeDefined()
    expect(JSON.parse(init?.body as string)).toMatchObject({
      is_external_collaborator: expected,
    })
  })

  it('必填錯誤顯示在欄旁與摘要，聚焦第一個欄位並保留已輸入內容', () => {
    renderForm()
    const username = screen.getByLabelText(/^帳號名稱/)
    fireEvent.change(username, { target: { value: 'ab' } })
    fireEvent.click(screen.getByRole('button', { name: '新增帳號' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      '帳號名稱格式不符。請依欄位說明修正後再試一次。',
    )
    expect(username).toHaveAttribute('aria-invalid', 'true')
    expect(username).toHaveFocus()
    expect(username).toHaveValue('ab')
    fireEvent.click(screen.getByRole('link', { name: /帳號名稱/ }))
    expect(username).toHaveFocus()
  })
})
