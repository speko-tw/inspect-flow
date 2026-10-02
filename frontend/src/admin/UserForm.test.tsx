// 新增使用者表單的可用性提示（#284 第 4～6 項）。

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

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
