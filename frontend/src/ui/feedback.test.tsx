import { act, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BatchActionBar } from './BatchActionBar'
import { ConfirmBox } from './ConfirmBox'
import { FormError } from './Form'
import { Notice } from './Notice'

const originalScroll = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView',
)
const scroll = vi.fn()

beforeEach(() => {
  scroll.mockReset()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scroll,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  if (originalScroll) {
    Object.defineProperty(
      HTMLElement.prototype,
      'scrollIntoView',
      originalScroll,
    )
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  }
})

function confirmation(reveal: false | 'nearest' = 'nearest') {
  return (
    <ConfirmBox
      confirmLabel="確認停用"
      onCancel={() => undefined}
      onConfirm={() => undefined}
      reveal={reveal}
      modal={reveal === false}
      role={reveal === false ? 'dialog' : 'group'}
      title="停用帳號"
    />
  )
}

describe('UDS-R18 回饋的可見性與焦點', () => {
  it('先就近捲入確認框，再聚焦取消，避免焦點把頁面捲回別處', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    render(confirmation())
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(scroll.mock.invocationCallOrder[0]).toBeLessThan(
      focus.mock.invocationCallOrder[0],
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '取消' })).toHaveFocus(),
    )
  })

  it('高於視窗八成的確認框從開頭閱讀', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: 900,
      width: 100,
      height: window.innerHeight,
      toJSON: () => ({}),
    })
    render(confirmation())
    expect(scroll).toHaveBeenCalledWith({ block: 'start' })
  })

  it('modal 可關掉捲動，焦點仍由確認框管理', async () => {
    render(confirmation(false))
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    expect(scroll).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '取消' })).toHaveFocus(),
    )
  })

  it('成功會捲入視窗、持續顯示，且不搶目前焦點', () => {
    vi.useFakeTimers()
    const first = render(<button>目前操作</button>)
    const trigger = screen.getByRole('button')
    trigger.focus()
    const result = render(<Notice>已儲存。</Notice>)
    expect(screen.getByRole('status')).toHaveTextContent('已儲存。')
    expect(trigger).toHaveFocus()
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
    act(() => vi.advanceTimersByTime(60000))
    expect(screen.getByRole('status')).toBeVisible()
    result.unmount()
    first.unmount()
  })

  it('錯誤會捲入並聚焦，資訊結果保持 status', async () => {
    const first = render(<Notice variant="error">儲存失敗。</Notice>)
    expect(screen.getByRole('alert')).toHaveAttribute('tabindex', '-1')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
    first.unmount()
    render(<Notice variant="info">他還不是專案成員。</Notice>)
    expect(screen.getByRole('status')).toHaveTextContent('還不是專案成員')
    expect(screen.getByRole('status')).not.toHaveFocus()
  })

  it('每次表單錯誤要求都捲動，再以 preventScroll 聚焦', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const view = render(
      <FormError focusRequest={1} tabIndex={-1}>
        請檢查資料。
      </FormError>,
    )
    expect(scroll).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    view.rerender(
      <FormError focusRequest={2} tabIndex={-1}>
        請檢查資料。
      </FormError>,
    )
    expect(scroll).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
  })

  it('批次操作、結果與確認留在同一容器且依閱讀順序排列', () => {
    render(
      <BatchActionBar
        actions={<button>批次停用</button>}
        confirmation={confirmation()}
        feedback={<Notice>已檢查。</Notice>}
        label="批次帳號操作"
      />,
    )
    const bar = screen.getByRole('region', { name: '批次帳號操作' })
    const action = within(bar).getByRole('button', { name: '批次停用' })
    const status = within(bar).getByRole('status')
    const confirm = within(bar).getByRole('group', { name: '停用帳號' })
    expect(action.compareDocumentPosition(status)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(status.compareDocumentPosition(confirm)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })
})

it('同一錯誤重繪不搶回使用者正在操作的焦點', () => {
  const view = render(
    <>
      <button>繼續修正</button>
      <Notice variant="error">
        <span>請修正資料。</span>
      </Notice>
    </>,
  )
  const trigger = screen.getByRole('button')
  trigger.focus()
  scroll.mockClear()
  view.rerender(
    <>
      <button>繼續修正</button>
      <Notice variant="error">
        <span>請修正資料。</span>
      </Notice>
    </>,
  )
  expect(trigger).toHaveFocus()
  expect(scroll).not.toHaveBeenCalled()
})

it('非同步影響範圍就緒後再捲入確認框並聚焦取消，普通重繪不重設', async () => {
  const focus = vi.spyOn(HTMLElement.prototype, 'focus')
  const box = (request: number) => (
    <ConfirmBox
      title="停用確認"
      revealRequest={request}
      confirmLabel="確認停用帳號"
      onConfirm={() => undefined}
      onCancel={() => undefined}
    >
      {request ? '停用後此專案沒有管理者。' : '正在檢查影響。'}
    </ConfirmBox>
  )
  const view = render(box(0))
  scroll.mockClear()
  focus.mockClear()
  view.rerender(box(1))
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' })
  expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  expect(scroll.mock.invocationCallOrder[0]).toBeLessThan(
    focus.mock.invocationCallOrder[0],
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus(),
  )
  scroll.mockClear()
  view.rerender(box(1))
  expect(scroll).not.toHaveBeenCalled()
})

it('modal 未指定 reveal 也不捲動，仍聚焦取消', async () => {
  render(
    <ConfirmBox
      modal
      role="dialog"
      title="修改計畫"
      confirmLabel="確認"
      onConfirm={() => undefined}
      onCancel={() => undefined}
    />,
  )
  expect(scroll).not.toHaveBeenCalled()
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus(),
  )
})

it('背景錯誤不捲動或聚焦；切為主動操作才處理同一錯誤', async () => {
  const view = render(
    <>
      <input aria-label="搜尋" />
      <Notice variant="error" autoReveal={false}>
        載入失敗。
      </Notice>
    </>,
  )
  const input = screen.getByRole('textbox')
  input.focus()
  expect(scroll).not.toHaveBeenCalled()
  expect(input).toHaveFocus()
  view.rerender(
    <>
      <input aria-label="搜尋" />
      <Notice variant="error">載入失敗。</Notice>
    </>,
  )
  expect(scroll).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
})
