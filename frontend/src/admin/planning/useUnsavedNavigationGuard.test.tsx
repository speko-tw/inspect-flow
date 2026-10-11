import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useUnsavedNavigationGuard } from './useUnsavedNavigationGuard'

function Editor() {
  const location = useLocation()
  useUnsavedNavigationGuard(true)
  return (
    <>
      <p>編輯中 {location.pathname}</p>
      <a href="/two" data-testid="plain-link">
        一般連結
      </a>
      <a href="/two" data-testid="self-link" target="_self">
        同頁連結
      </a>
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

function BrowserHistoryHarness() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<p>第一頁</p>} path="/zero" />
        <Route element={<Editor />} path="/one" />
        <Route element={<p>第二頁</p>} path="/two" />
      </Routes>
    </BrowserRouter>
  )
}

async function mountAtEditor(options: { missingForwardIndex?: boolean } = {}) {
  window.history.replaceState({ idx: 0, key: 'zero' }, '', '/zero')
  window.history.pushState({ idx: 1, key: 'one' }, '', '/one')
  window.history.pushState({ idx: 2, key: 'two' }, '', '/two')
  if (options.missingForwardIndex) {
    window.history.replaceState({ key: 'external-entry' }, '', '/two')
  }
  window.history.back()
  await waitFor(() => expect(window.location.pathname).toBe('/one'))
  render(<BrowserHistoryHarness />)
  expect(await screen.findByText('編輯中 /one')).toBeInTheDocument()
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

  it('still guards an unmodified primary click targeting the same tab', async () => {
    await mountAtEditor()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    expect(fireEvent.click(screen.getByTestId('self-link'))).toBe(false)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(window.location.pathname).toBe('/one')
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
