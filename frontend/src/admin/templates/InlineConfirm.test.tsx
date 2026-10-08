import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { InlineConfirm } from './InlineConfirm'

describe('InlineConfirm', () => {
  it('orders the buttons [取消][確認] and only the confirm is danger', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <InlineConfirm onCancel={onCancel} onConfirm={onConfirm}>
        刪除「欄杆」？
      </InlineConfirm>,
    )
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual([
      '取消',
      '確認刪除',
    ])
    expect(buttons[0]).not.toHaveClass('btn-danger')
    expect(buttons[1]).toHaveClass('btn-danger')
    fireEvent.click(buttons[0])
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
