import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import {
  createMemoryRouter,
  Link,
  RouterProvider,
  useLocation,
  useNavigate,
} from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { UnsavedLeaveBox } from './UnsavedLeaveBox'
import { useUnsavedNavigationGuard } from './useUnsavedNavigationGuard'

function Editor({ initialDirty }: { initialDirty: boolean }) {
  const [dirty, setDirty] = useState(initialDirty)
  const location = useLocation()
  const guard = useUnsavedNavigationGuard(dirty)
  const navigate = useNavigate()
  return (
    <>
      <p>編輯中 {location.pathname}</p>
      <button onClick={() => setDirty(false)} type="button">
        清除草稿
      </button>
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
      <Link data-testid="after-allow-link" to="/three">
        確認後再導覽
      </Link>
      <Link data-testid="same-url-link" to={location.pathname}>
        目前頁面連結
      </Link>
      <button
        onClick={() => guard.allowNavigation(() => navigate('/approved'))}
        type="button"
      >
        已確認導覽
      </button>
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

async function mountAtEditor(options: { dirty?: boolean } = {}) {
  const router = createMemoryRouter(
    [
      { path: '/zero', element: <p>第一頁</p> },
      {
        path: '/one',
        element: <Editor initialDirty={options.dirty ?? true} />,
      },
      { path: '/two', element: <p>第二頁</p> },
      { path: '/approved', element: <Editor initialDirty /> },
      { path: '/three', element: <p>第三頁</p> },
    ],
    { initialEntries: ['/zero', '/one', '/two'], initialIndex: 1 },
  )
  const view = render(<RouterProvider router={router} />)
  expect(await screen.findByText('編輯中 /one')).toBeInTheDocument()
  return { ...view, router }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('unsaved navigation guard with a data router', () => {
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
    expect(screen.getByText('編輯中 /one')).toBeInTheDocument()
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
      expect(screen.getByText('編輯中 /one')).toBeInTheDocument()
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
    expect(screen.getByText('編輯中 /one')).toBeInTheDocument()
    // ADM-R38：開啟時焦點在第一個按鈕「保留編輯」。
    // UnsavedLeaveBox 在 effect 聚焦，等 effect 完成再檢查。
    await waitFor(() =>
      expect(
        within(box).getByRole('button', { name: '保留編輯' }),
      ).toHaveFocus(),
    )
    expect(within(box).getByRole('button', { name: '捨棄變更' })).toHaveClass(
      'btn-danger',
    )
  })

  it('scrolls the visible unsaved prompt into view (ADM-R28)', async () => {
    const originalScroll = HTMLElement.prototype.scrollIntoView
    const scroll = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scroll,
    })
    try {
      await mountAtEditor()
      fireEvent.click(screen.getByTestId('self-link'))
      const box = await screen.findByRole('group', {
        name: '有尚未儲存的變更',
      })

      expect(scroll).toHaveBeenCalledWith({ block: 'center' })
      await waitFor(() =>
        expect(
          within(box).getByRole('button', { name: '保留編輯' }),
        ).toHaveFocus(),
      )
    } finally {
      if (originalScroll) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
          configurable: true,
          value: originalScroll,
        })
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
      }
    }
  })

  it('keeps the editor and the link unfollowed on Keep editing and Esc', async () => {
    await mountAtEditor()
    fireEvent.click(screen.getByTestId('plain-link'))
    const box = await screen.findByRole('group', {
      name: '有尚未儲存的變更',
    })

    fireEvent.click(within(box).getByRole('button', { name: '保留編輯' }))
    expect(screen.queryByRole('group')).toBeNull()
    expect(screen.getByText('編輯中 /one')).toBeInTheDocument()
    expect(screen.getByTestId('plain-link')).toHaveFocus()

    fireEvent.click(screen.getByTestId('plain-link'))
    fireEvent.keyDown(await screen.findByRole('group'), { key: 'Escape' })
    expect(screen.queryByRole('group')).toBeNull()
    expect(screen.getByText('編輯中 /one')).toBeInTheDocument()
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
    expect(screen.getByText('第二頁')).toBeInTheDocument()
  })

  it('blocks a dirty same-URL self-link', async () => {
    await mountAtEditor()

    fireEvent.click(screen.getByTestId('same-url-link'))

    expect(
      await screen.findByRole('group', { name: '有尚未儲存的變更' }),
    ).toBeVisible()
    expect(screen.getByText('編輯中 /one')).toBeInTheDocument()
  })

  it('uses confirmed navigation bypass once, then blocks again', async () => {
    await mountAtEditor()

    fireEvent.click(screen.getByRole('button', { name: '已確認導覽' }))
    expect(await screen.findByText('編輯中 /approved')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('after-allow-link'))
    expect(
      await screen.findByRole('group', { name: '有尚未儲存的變更' }),
    ).toBeVisible()
    expect(screen.getByText('編輯中 /approved')).toBeInTheDocument()
  })

  it('does not treat a hash-only link as leaving the page (ADM-R28)', async () => {
    await mountAtEditor()

    // jsdom 不會真的捲動；重點是沒被攔下、也沒有確認框。
    expect(fireEvent.click(screen.getByTestId('hash-link'))).toBe(true)
    expect(screen.queryByRole('group')).toBeNull()
  })

  it('cancels Back once and keeps the editor route mounted', async () => {
    const { router } = await mountAtEditor()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    router.navigate(-1)

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByText('編輯中 /one')).toBeInTheDocument(),
    )
    expect(screen.getByText('編輯中 /one')).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('cancels Forward once and keeps the editor route mounted', async () => {
    const { router } = await mountAtEditor()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    router.navigate(1)

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByText('編輯中 /one')).toBeInTheDocument(),
    )
    expect(screen.getByText('編輯中 /one')).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('accepts Back and leaves the editor route', async () => {
    const { router } = await mountAtEditor()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    router.navigate(-1)

    expect(await screen.findByText('第一頁')).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('accepts Forward and leaves the editor route', async () => {
    const { router } = await mountAtEditor()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    router.navigate(1)

    expect(await screen.findByText('第二頁')).toBeInTheDocument()
    expect(screen.getByText('第二頁')).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('cancels a Forward transition and keeps the editor mounted', async () => {
    const { router } = await mountAtEditor()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    router.navigate(1)

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(screen.getByText('編輯中 /one')).toBeInTheDocument()
    expect(screen.getByText('編輯中 /one')).toBeInTheDocument()
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
    const { router } = await mountAtEditor({ dirty: false })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    router.navigate(-1)
    expect(await screen.findByText('第一頁')).toBeInTheDocument()
    router.navigate(1)
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

  it('does not bring a stale leave box back after the changes are cleared', async () => {
    await mountAtEditor()
    fireEvent.click(screen.getByTestId('plain-link'))
    await screen.findByRole('group', { name: '有尚未儲存的變更' })

    fireEvent.click(screen.getByRole('button', { name: '清除草稿' }))
    await waitFor(() => expect(screen.queryByRole('group')).toBeNull())
    expect(screen.getByText('編輯中 /one')).toBeInTheDocument()
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

    expect(unload.defaultPrevented).toBe(false)
    expect(clickAllowed).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    outside.remove()
  })
})
