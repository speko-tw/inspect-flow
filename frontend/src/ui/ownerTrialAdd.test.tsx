import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import TemporaryPassword from '../admin/TemporaryPassword'
import { ConfirmBox } from './ConfirmBox'

afterEach(() => Reflect.deleteProperty(navigator, 'clipboard'))

it('hideConfirm 只保留取消與自訂操作，隱含表單送出也不確認', () => {
  const confirm = vi.fn()
  const cancel = vi.fn()
  const custom = vi.fn()
  render(
    <ConfirmBox
      asForm
      hideConfirm
      confirmLabel="不應出現的確認"
      onConfirm={confirm}
      onCancel={cancel}
      title="選擇後續操作"
    >
      <button type="button" onClick={custom}>
        改到期日
      </button>
    </ConfirmBox>,
  )
  const box = screen.getByRole('group', { name: '選擇後續操作' })
  expect(
    within(box).queryByRole('button', {
      name: '不應出現的確認',
    }),
  ).toBeNull()
  expect(within(box).getByRole('button', { name: '取消' })).toHaveFocus()
  fireEvent.submit(box)
  expect(confirm).not.toHaveBeenCalled()
  fireEvent.click(within(box).getByRole('button', { name: '改到期日' }))
  expect(custom).toHaveBeenCalledOnce()
  fireEvent.keyDown(box, { key: 'Escape' })
  expect(cancel).toHaveBeenCalledOnce()
})

it('20 碼密碼每五碼一個版面群組，DOM 與複製都維持原連續字串', async () => {
  const password = '01234567890123456789'
  const writeText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
  render(<TemporaryPassword password={password} />)
  const output = screen.getByLabelText('臨時密碼')
  expect(output.textContent).toBe(password)
  expect([...output.children].map((node) => node.textContent)).toEqual([
    '01234',
    '56789',
    '01234',
    '56789',
  ])
  fireEvent.click(screen.getByRole('button', { name: '複製' }))
  await screen.findByRole('button', { name: '已複製' })
  expect(writeText).toHaveBeenCalledExactlyOnceWith(password)
})
