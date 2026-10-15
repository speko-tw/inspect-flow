import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from './App'

describe('App Vite preload error handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prevents Vite auto reload and guides the user to reload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ setup_required: false })),
    )
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    )

    const preloadError = new Event('vite:preloadError', {
      cancelable: true,
    })
    await act(async () => {
      window.dispatchEvent(preloadError)
    })

    expect(preloadError.defaultPrevented).toBe(true)
    expect(
      screen.getByRole('heading', { name: '系統內容已更新' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '重新載入' }),
    ).toBeInTheDocument()
  })

  it('removes the Vite preload error listener when App unmounts', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ setup_required: false })),
    )
    const addListener = vi.spyOn(window, 'addEventListener')
    const removeListener = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    )
    const registered = addListener.mock.calls.find(
      ([type]) => type === 'vite:preloadError',
    )

    expect(registered).toBeDefined()
    unmount()

    expect(removeListener).toHaveBeenCalledWith(...registered!)
  })
})
