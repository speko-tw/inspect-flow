import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { UnsavedLeaveBox } from './UnsavedLeaveBox'
import { useUnsavedNavigationGuard } from './useUnsavedNavigationGuard'

function Editor({ dirty }: { dirty: boolean }) {
  const location = useLocation()
  const guard = useUnsavedNavigationGuard(dirty)
  return (
    <>
      <p>編輯中 {location.pathname}</p>
      <UnsavedLeaveBox guard={guard} />
      <a href="/one#section" data-testid="hash-link">
        同頁錨點
      </a>
      <Link data-testid="plain-link" to="/two">
        一般連結
      </Link>
      <Link data-testid="self-link" target="_self" to="/two">
        同頁連結
      </Link>
      <a href="/two" data-testid="blank-link" target="_blank">
        新分頁連結
      </a>
      <a href="/two" data-testid="parent-link" target="_parent">
        父頁連結
      </a>
      <a href="/two" data-testid="top-link" target="_top">
        最上層連結
      </a>
    </>
  )
}

function BrowserHistoryHarness({ dirty }: { dirty: boolean }) {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<p>第一頁</p>} path="/zero" />
        <Route element={<Editor dirty={dirty} />} path="/one" />
        <Route element={<p>第二頁</p>} path="/two" />
      </Routes>
    </BrowserRouter>
  )
}

async function mountAtEditor(
  options: { missingForwardIndex?: boolean; dirty?: boolean } = {},
) {
  window.history.replaceState({ idx: 0, key: 'zero' }, '', '/zero')
  window.history.pushState({ idx: 1, key: 'one' }, '', '/one')
  window.history.pushState({ idx: 2, key: 'two' }, '', '/two')
  if (options.missingForwardIndex) {
    window.history.replaceState({ key: 'external-entry' }, '', '/two')
  }
  window.history.back()
  await waitFor(() => expect(window.location.pathname).toBe('/one'))
  const view = render(<BrowserHistoryHarness dirty={options.dirty ?? true} />)
  expect(await screen.findByText('編輯中 /one')).toBeInTheDocument()
  return view
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('unsaved navigation guard with BrowserRouter history', () => {
  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Command', { metaKey: true }],
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
    ['middle button', { button: 1 }],
    ['right button', { button: 2 }],
  ])('does not intercept a %s link click', async (_label, options) => {
    await mountAtEditor()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const link = screen.getByTestId('plain-link')

    expect(fireEvent.click(link, options)).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/one')
  })

  it.each(['_blank', '_parent', '_top'])(
    'does not intercept a link targeting %s',
    async (target) => {
      await mountAtEditor()
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      const link = screen.getByTestId(
        target === '_blank'
          ? 'blank-link'
          : target === '_parent'
            ? 'parent-link'
            : 'top-link',
      )

      expect(fireEvent.click(link)).toBe(true)
      expect(confirm).not.toHaveBeenCalled()
      expect(window.location.pathname).toBe('/one')
    },
  )

  it('asks in the page, not with a native dialog, before following a link', async () => {
    await mountAtEditor()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    expect(fireEvent.click(screen.getByTestId('self-link'))).toBe(false)

    const box = await screen.findByRole('group', {
      name: '有尚未儲存的變更',
    })
    expect(confirm).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/one')
    // ADM-R38：開啟時焦點在第一個按鈕「保留編輯」。
    expect(within(box).getByRole('button', { name: '保留編輯' })).toHaveFocus()
    expect(within(box).getByRole('button', { name: '捨棄變更' })).toHaveClass(
      'btn-danger',
    )
  })

  it('keeps the editor and the link unfollowed on Keep editing and Esc', async () => {
    await mountAtEditor()
    fireEvent.click(screen.getByTestId('plain-link'))
    const box = await screen.findByRole('group', {
      name: '有尚未儲存的變更',
    })

    fireEvent.click(within(box).getByRole('button', { name: '保留編輯' }))
    expect(screen.queryByRole('group')).toBeNull()
    expect(window.location.pathname).toBe('/one')

    fireEvent.click(screen.getByTestId('plain-link'))
    fireEvent.keyDown(await screen.findByRole('group'), { key: 'Escape' })
    expect(screen.queryByRole('group')).toBeNull()
    expect(window.location.pathname).toBe('/one')
    expect(screen.getByText('編輯中 /one')).toBeInTheDocument()
  })

  it('follows the blocked link only after Discard changes', async () => {
    await mountAtEditor()
    fireEvent.click(screen.getByTestId('plain-link'))
    const box = await screen.findByRole('group', {
      name: '有尚未儲存的變更',
    })

    fireEvent.click(within(box).getByRole('button', { name: '捨棄變更' }))

    expect(await screen.findByText('第二頁')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/two')
  })

  it('does not treat a hash-only link as leaving the page (R4)', async () => {
    await mountAtEditor()

    // jsdom 不會真的捲動；重點是沒被攔下、也沒有確認框。
    expect(fireEvent.click(screen.getByTestId('hash-link'))).toBe(true)
    expect(screen.queryByRole('group')).toBeNull()
  })

  it('cancels Back once and keeps the editor route mounted', async () => {
    await mountAtEditor()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    window.history.back()

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(window.location.pathname).toBe('/one'))
    expect(screen.getByText('編輯中 /one')).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('cancels Forward once and keeps the editor route mounted', async () => {
    await mountAtEditor()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    window.history.forward()

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(window.location.pathname).toBe('/one'))
    expect(screen.getByText('編輯中 /one')).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('accepts Back and leaves the editor route', async () => {
    await mountAtEditor()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    window.history.back()

    expect(await screen.findByText('第一頁')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/zero')
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('accepts Forward and leaves the editor route', async () => {
    await mountAtEditor()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    window.history.forward()

    expect(await screen.findByText('第二頁')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/two')
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('restores the editor without guessing when a history entry lacks idx', async () => {
    await mountAtEditor({ missingForwardIndex: true })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    window.history.forward()

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(window.location.pathname).toBe('/one')
    expect(screen.getByText('編輯中 /one')).toBeInTheDocument()
    expect(window.history.state.idx).toEqual(expect.any(Number))
    expect(confirm).toHaveBeenCalledTimes(1)
  })
})

describe('unsaved navigation guard without unsaved changes', () => {
  it('lets a link click through without any confirmation', async () => {
    await mountAtEditor({ dirty: false })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    fireEvent.click(screen.getByTestId('plain-link'))

    // 沒有確認框，Router 直接導向第二頁。
    expect(await screen.findByText('第二頁')).toBeInTheDocument()
    expect(screen.queryByRole('group')).toBeNull()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('lets Back and Forward through without a native confirm', async () => {
    await mountAtEditor({ dirty: false })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    window.history.back()
    expect(await screen.findByText('第一頁')).toBeInTheDocument()
    window.history.forward()
    expect(await screen.findByText('編輯中 /one')).toBeInTheDocument()

    expect(confirm).not.toHaveBeenCalled()
  })

  it('does not block reload or tab close', async () => {
    await mountAtEditor({ dirty: false })
    const unload = new Event('beforeunload', {
      cancelable: true,
    }) as BeforeUnloadEvent

    window.dispatchEvent(unload)

    expect(unload.defaultPrevented).toBe(false)
  })
})

describe('unsaved navigation guard lifecycle', () => {
  it('blocks reload and tab close while there are unsaved changes', async () => {
    await mountAtEditor()
    const unload = new Event('beforeunload', {
      cancelable: true,
    }) as BeforeUnloadEvent

    window.dispatchEvent(unload)

    expect(unload.defaultPrevented).toBe(true)
  })

  it('removes every listener when the page unmounts', async () => {
    const view = await mountAtEditor()
    view.unmount()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const outside = document.createElement('a')
    outside.href = '/two'
    document.body.append(outside)
    const unload = new Event('beforeunload', {
      cancelable: true,
    }) as BeforeUnloadEvent

    window.dispatchEvent(unload)
    const clickAllowed = fireEvent.click(outside)
    window.history.back()
    await waitFor(() => expect(window.location.pathname).toBe('/zero'))

    expect(unload.defaultPrevented).toBe(false)
    expect(clickAllowed).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    outside.remove()
  })
})
