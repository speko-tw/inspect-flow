import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StrictMode, useRef, useState } from 'react'

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

  it('puts the focus on cancel by default', async () => {
    setup()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '取消' })).toHaveFocus(),
    )
  })

  it('can focus the heading, or leave focus to the caller', async () => {
    const first = render(
      <ConfirmBox
        confirmLabel="確認"
        initialFocus="heading"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        title="請確認操作"
      />,
    )
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: '請確認操作' }),
      ).toHaveFocus(),
    )
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

  it('asForm without noValidate lets the native required hint block submit', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmBox
        asForm
        confirmLabel="確認"
        label="a"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      >
        <textarea aria-label="原因" required />
      </ConfirmBox>,
    )
    const form = screen.getByRole('group', { name: 'a' })
    expect(form).not.toHaveAttribute('novalidate')
    fireEvent.click(screen.getByRole('button', { name: '確認' }))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  // 呼叫端要自己顯示欄位旁的錯誤時，原生必填提示不能先擋下送出。
  it('asForm with noValidate submits an empty required field to onConfirm', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmBox
        asForm
        confirmLabel="確認"
        label="a"
        noValidate
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      >
        <textarea aria-label="原因" required />
      </ConfirmBox>,
    )
    expect(screen.getByRole('group', { name: 'a' })).toHaveAttribute(
      'novalidate',
    )
    fireEvent.click(screen.getByRole('button', { name: '確認' }))
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

/** #822：以真實的觸發焦點驗證關閉，不把程式呼叫 click 當成聚焦。 */
function FocusExample({ mode = 'normal' }: { mode?: string }) {
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState(false)
  const other = useRef<HTMLButtonElement>(null)
  return (
    <>
      {(!done || mode === 'disabled') && (
        <button disabled={done} onClick={() => setOpen(true)}>
          開啟確認
        </button>
      )}
      <button ref={other}>下一個操作</button>
      {open && (
        <ConfirmBox
          confirmLabel="確認"
          label="焦點測試"
          onCancel={() => {
            setOpen(false)
            if (mode === 'removed' || mode === 'disabled') setDone(true)
            if (mode === 'caller') other.current?.focus()
          }}
          onConfirm={() => setOpen(false)}
        />
      )}
    </>
  )
}

describe('ConfirmBox 取消焦點（#822）', () => {
  it.each(['取消', 'Escape'])(
    '%s 後回到觸發鈕，包含 StrictMode',
    async (key) => {
      render(
        <StrictMode>
          <FocusExample />
        </StrictMode>,
      )
      const trigger = screen.getByRole('button', { name: '開啟確認' })
      trigger.focus()
      fireEvent.click(trigger)
      const cancel = screen.getByRole('button', { name: '取消' })
      expect(cancel).toHaveFocus()
      if (key === 'Escape') fireEvent.keyDown(cancel, { key })
      else fireEvent.click(cancel)
      await waitFor(() => expect(trigger).toHaveFocus())
    },
  )

  it('不覆蓋呼叫端取消時明確指定的焦點', async () => {
    render(<FocusExample mode="caller" />)
    const trigger = screen.getByRole('button', { name: '開啟確認' })
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '下一個操作' })).toHaveFocus(),
    )
  })

  it.each(['removed', 'disabled'])(
    '不聚焦已失效的觸發鈕：%s',
    async (mode) => {
      render(<FocusExample mode={mode} />)
      const trigger = screen.getByRole('button', { name: '開啟確認' })
      trigger.focus()
      fireEvent.click(trigger)
      fireEvent.click(screen.getByRole('button', { name: '取消' }))
      await act(async () => {})
      if (mode === 'removed') expect(trigger.isConnected).toBe(false)
      else expect(trigger).toBeDisabled()
      expect(document.body).toHaveFocus()
    },
  )

  it('確認成功不把焦點拉回觸發鈕', async () => {
    render(<FocusExample />)
    const trigger = screen.getByRole('button', { name: '開啟確認' })
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: '確認' }))
    await act(async () => {})
    expect(document.body).toHaveFocus()
  })
})
