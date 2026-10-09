// 新增使用者表單的可用性提示（#284 第 4～6 項）。

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { deferred, expectImeEnterIgnored } from '../testing/submitGuard'
import UserForm from './UserForm'

const companies = [{ id: 'company-1', name: '示範公司', is_active: true }]

function renderForm() {
  return render(<UserForm companies={companies} onCreated={() => {}} />)
}

describe('UserForm 必填標示（#284 第 4 項）', () => {
  it('帳號名稱、Email、中文姓名標示「*」，其他欄位沒有', () => {
    const { container } = renderForm()

    for (const label of [/^帳號名稱/, /^Email/, /^中文姓名/]) {
      const field = screen.getByLabelText(label)
      expect(field).toBeRequired()
      expect(field.closest('label')).toHaveTextContent('*')
    }
    for (const label of [/^英文姓名/, /^公司/, /^部門/, /^地點/, /^工號/]) {
      expect(
        screen.getByLabelText(label).closest('label'),
      ).not.toHaveTextContent('*')
    }
    // 「*」只是視覺標示，不進入無障礙名稱。
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3)
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

describe('UserForm 防連點與輸入法 Enter（#507）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const createdUser = {
    id: 'user-1',
    username: 'anna.deng',
    email: 'anna.deng@demo.example',
    name_zh: '鄧安娜',
    name_en: null,
    company_id: null,
    department: null,
    location: null,
    employee_no: null,
    is_admin: false,
    temporary_password: 'Tmp-PassW0rd-123',
  }

  function fill() {
    fireEvent.change(screen.getByLabelText(/^帳號名稱/), {
      target: { value: 'anna.deng' },
    })
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: 'anna.deng@demo.example' },
    })
    fireEvent.change(screen.getByLabelText(/^中文姓名/), {
      target: { value: '鄧安娜' },
    })
  }

  it('連按 Enter 只建立一位使用者', async () => {
    const gate = deferred<Response>()
    const fetchMock = vi.fn(async () => gate.promise)
    vi.stubGlobal('fetch', fetchMock)
    const onCreated = vi.fn()
    render(<UserForm companies={companies} onCreated={onCreated} />)
    fill()
    const form = screen
      .getByRole('button', { name: '新增使用者' })
      .closest('form') as HTMLFormElement

    fireEvent.submit(form)
    fireEvent.submit(form)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    gate.resolve(
      new Response(JSON.stringify(createdUser), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
  })

  it('失敗之後可以再送出', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    renderForm()
    fill()
    const form = screen
      .getByRole('button', { name: '新增使用者' })
      .closest('form') as HTMLFormElement

    fireEvent.submit(form)
    await screen.findByRole('alert')
    fireEvent.submit(form)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('輸入法選字的 Enter 不送出', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderForm()
    fill()

    expectImeEnterIgnored(screen.getByLabelText(/^帳號名稱/))
    expectImeEnterIgnored(screen.getByLabelText(/^中文姓名/))

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
