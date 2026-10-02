// 臨時密碼的「複製」按鈕（#284 第 7 項）。

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import TemporaryPassword from './TemporaryPassword'

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('TemporaryPassword', () => {
  it('顯示臨時密碼與「複製」按鈕', () => {
    render(<TemporaryPassword password="Tmp-PassW0rd-123" />)

    expect(screen.getByLabelText('臨時密碼')).toHaveTextContent(
      'Tmp-PassW0rd-123',
    )
    expect(screen.getByRole('button', { name: '複製' })).toBeInTheDocument()
  })

  it('按下複製後寫入剪貼簿，按鈕改為「已複製」', async () => {
    const writeText = vi.fn(async () => {})
    stubClipboard(writeText)
    render(<TemporaryPassword password="Tmp-PassW0rd-123" />)
    fireEvent.click(screen.getByRole('button', { name: '複製' }))

    expect(
      await screen.findByRole('button', { name: '已複製' }),
    ).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith('Tmp-PassW0rd-123')
  })

  it('瀏覽器不允許複製時提示自行選取，不顯示已複製', async () => {
    stubClipboard(async () => {
      throw new Error('denied')
    })
    render(<TemporaryPassword password="Tmp-PassW0rd-123" />)
    fireEvent.click(screen.getByRole('button', { name: '複製' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('無法複製')
    })
    expect(screen.queryByRole('button', { name: '已複製' })).toBeNull()
  })
})
