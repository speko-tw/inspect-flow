import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { deferred, expectImeEnterIgnored } from '../testing/submitGuard'
import { ConfirmBox } from './ConfirmBox'

function setup(props: Partial<Parameters<typeof ConfirmBox>[0]> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <ConfirmBox
      confirmLabel="確認刪除"
      label="刪除確認"
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...props}
    >
      <p>刪除「欄杆」？</p>
    </ConfirmBox>,
  )
  return { onConfirm, onCancel }
}

describe('ConfirmBox', () => {
  it('shows a generic error when onConfirm rejects', async () => {
    const onConfirm = vi.fn(() => Promise.reject(new Error('request failed')))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    setup({ onConfirm })

    fireEvent.click(screen.getByRole('button', { name: '確認刪除' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '操作失敗，請稍後再試。',
    )
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })

  it('orders the buttons [取消][確認]', () => {
    setup()
    expect(
      screen.getAllByRole('button').map((button) => button.textContent),
    ).toEqual(['取消', '確認刪除'])
  })

  it('colours the confirm button by variant and never the cancel button', () => {
    const { unmount } = render(
      <ConfirmBox
        confirmLabel="確認刪除"
        label="a"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        variant="danger"
      />,
    )
    expect(screen.getByRole('button', { name: '確認刪除' })).toHaveClass(
      'btn-danger',
    )
    expect(screen.getByRole('button', { name: '取消' })).not.toHaveClass(
      'btn-danger',
      'btn-primary',
    )
    expect(screen.getByRole('group')).toHaveClass('confirm-box-danger')
    unmount()
    render(
      <ConfirmBox
        confirmLabel="確認"
        label="b"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        variant="neutral"
      />,
    )
    expect(screen.getByRole('button', { name: '確認' })).toHaveClass(
      'btn-primary',
    )
    expect(screen.getByRole('group')).toHaveClass('confirm-box-neutral')
  })

  it('calls onCancel and onConfirm from their own buttons', () => {
    const { onConfirm, onCancel } = setup()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '確認刪除' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('puts the focus on cancel by default', () => {
    setup()
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus()
  })

  it('can focus the heading, or leave focus to the caller', () => {
    const first = render(
      <ConfirmBox
        confirmLabel="確認"
        initialFocus="heading"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        title="請確認操作"
      />,
    )
    expect(screen.getByRole('heading', { name: '請確認操作' })).toHaveFocus()
    first.unmount()
    render(
      <ConfirmBox
        confirmLabel="確認"
        initialFocus="none"
        label="x"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(document.body).toHaveFocus()
  })

  it('Esc cancels without bubbling to an outer Esc handler', () => {
    const outer = vi.fn()
    const onCancel = vi.fn()
    render(
      <div onKeyDown={outer}>
        <ConfirmBox
          confirmLabel="確認"
          label="x"
          onCancel={onCancel}
          onConfirm={vi.fn()}
        />
      </div>,
    )
    fireEvent.keyDown(screen.getByRole('button', { name: '取消' }), {
      key: 'Escape',
    })
    expect(onCancel).toHaveBeenCalledOnce()
    expect(outer).not.toHaveBeenCalled()
  })

  it('ignores Esc while busy, like the disabled cancel button', () => {
    const onCancel = vi.fn()
    render(
      <ConfirmBox
        busy
        confirmLabel="確認"
        label="x"
        onCancel={onCancel}
        onConfirm={vi.fn()}
      >
        <p role="alert">送出失敗</p>
      </ConfirmBox>,
    )
    fireEvent.keyDown(screen.getByRole('group'), { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('送出失敗')
  })

  it('names the container by its title, else by label', () => {
    const { unmount } = render(
      <ConfirmBox
        confirmLabel="確認"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        role="region"
        title="停用「甲公司」"
      />,
    )
    expect(
      screen.getByRole('region', { name: '停用「甲公司」' }),
    ).toBeInTheDocument()
    unmount()
    render(
      <ConfirmBox
        confirmLabel="確認"
        label="操作確認"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        role="alertdialog"
      />,
    )
    expect(
      screen.getByRole('alertdialog', { name: '操作確認' }),
    ).toBeInTheDocument()
  })

  it('is inline by default; modal adds aria-modal and the overlay class', () => {
    const { unmount } = render(
      <ConfirmBox
        confirmLabel="確認"
        label="a"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        role="dialog"
      />,
    )
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-modal')
    expect(screen.getByRole('dialog')).not.toHaveClass('confirm-box-modal')
    unmount()
    render(
      <ConfirmBox
        confirmLabel="確認"
        label="a"
        modal
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        role="dialog"
      />,
    )
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('dialog')).toHaveClass('confirm-box-modal')
  })

  it('disables both buttons while busy, and confirm when confirmDisabled', () => {
    const { unmount } = render(
      <ConfirmBox
        busy
        confirmLabel="確認"
        label="a"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '確認' })).toBeDisabled()
    unmount()
    render(
      <ConfirmBox
        confirmDisabled
        confirmLabel="確認"
        label="a"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: '取消' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '確認' })).toBeDisabled()
  })

  it('asForm submits through the confirm button and honours required', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmBox
        asForm
        confirmLabel="確認取消"
        label="a"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      >
        <textarea aria-label="原因" />
      </ConfirmBox>,
    )
    const confirm = screen.getByRole('button', { name: '確認取消' })
    expect(confirm).toHaveAttribute('type', 'submit')
    expect(screen.getByRole('button', { name: '取消' })).toHaveAttribute(
      'type',
      'button',
    )
    fireEvent.submit(confirm.closest('form') as HTMLFormElement)
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('uses the given cancel label for discard prompts', () => {
    setup({ cancelLabel: '保留編輯', confirmLabel: '捨棄' })
    expect(
      screen.getAllByRole('button').map((button) => button.textContent),
    ).toEqual(['保留編輯', '捨棄'])
  })
  describe('double submit and IME Enter (#507)', () => {
    it('confirms once on a double click while pending', async () => {
      const gate = deferred()
      const onConfirm = vi.fn(() => gate.promise)
      setup({ onConfirm })
      const button = screen.getByRole('button', { name: '確認刪除' })

      fireEvent.click(button)
      fireEvent.click(button)
      expect(onConfirm).toHaveBeenCalledTimes(1)

      await act(async () => gate.resolve())
      fireEvent.click(button)
      expect(onConfirm).toHaveBeenCalledTimes(2)
    })

    it('asForm confirms once when submitted twice while pending', async () => {
      const gate = deferred()
      const onConfirm = vi.fn(() => gate.promise)
      render(
        <ConfirmBox
          asForm
          confirmLabel="確認取消"
          label="a"
          onCancel={vi.fn()}
          onConfirm={onConfirm}
        >
          <input aria-label="原因" />
        </ConfirmBox>,
      )
      const form = screen.getByRole('group')

      fireEvent.submit(form)
      fireEvent.submit(form)
      expect(onConfirm).toHaveBeenCalledTimes(1)
      await act(async () => gate.resolve())
    })

    it('asForm ignores an Enter that only confirms an IME choice', () => {
      const onConfirm = vi.fn()
      render(
        <ConfirmBox
          asForm
          confirmLabel="確認取消"
          label="a"
          onCancel={vi.fn()}
          onConfirm={onConfirm}
        >
          <input aria-label="原因" />
        </ConfirmBox>,
      )

      expectImeEnterIgnored(screen.getByLabelText('原因'))
      expect(onConfirm).not.toHaveBeenCalled()
    })
  })

  it('shows an error when onConfirm throws synchronously', async () => {
    const onConfirm = vi.fn(() => {
      throw new Error('sync failure')
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    setup({ onConfirm })

    fireEvent.click(screen.getByRole('button', { name: '確認刪除' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '操作失敗，請稍後再試。',
    )
    fireEvent.click(screen.getByRole('button', { name: '確認刪除' }))
    expect(onConfirm).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenCalledWith(
      'Confirmation failed:',
      expect.objectContaining({ message: 'sync failure' }),
    )
    error.mockRestore()
  })
})
