import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FormErrorSummary, FormField, FormGroup } from './FormPatterns'

describe('FormPatterns', () => {
  it('把必填、說明和錯誤關聯到控制項', () => {
    render(
      <FormGroup title="帳號資料" description="供登入與通知使用。">
        <FormField
          label="帳號名稱"
          required
          description="3～32 字元。"
          error="帳號名稱尚未填寫。請輸入有效帳號名稱。"
        >
          {(control) => <input {...control} required />}
        </FormField>
      </FormGroup>,
    )

    const input = screen.getByRole('textbox', { name: /帳號名稱/ })
    expect(input).toBeRequired()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(
      '3～32 字元。 帳號名稱尚未填寫。請輸入有效帳號名稱。',
    )
    expect(
      screen.getByRole('group', { name: /帳號資料/ }),
    ).toHaveAccessibleDescription('供登入與通知使用。')
  })

  it('錯誤摘要聚焦自身並可導向欄位', () => {
    render(
      <>
        <input id="email-input" />
        <FormErrorSummary
          focusRequest={1}
          errors={[
            {
              fieldId: 'email-input',
              fieldLabel: 'Email',
              message: 'Email 格式不完整。請輸入有效地址。',
            },
          ]}
        />
      </>,
    )

    const summary = screen.getByRole('alert')
    expect(summary).toHaveFocus()
    fireEvent.click(screen.getByRole('link', { name: /Email/ }))
    expect(screen.getByRole('textbox')).toHaveFocus()
  })
})
