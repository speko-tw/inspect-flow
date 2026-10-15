import { lazy, Suspense, type ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import RouteLoadErrorBoundary from './RouteLoadErrorBoundary'

describe('RouteLoadErrorBoundary', () => {
  it.each([
    'Failed to fetch dynamically imported module',
    'ChunkLoadError: Loading chunk 7 failed',
    'Importing a module script failed',
    'Loading chunk 8 failed.',
  ])('shows the network recovery message for %s', async (message) => {
    const LazyPage = lazy(() => Promise.reject(new Error(message)))
    const reload = vi.fn()

    render(
      <RouteLoadErrorBoundary onReload={reload}>
        <Suspense fallback={<p>載入中</p>}>
          <LazyPage />
        </Suspense>
      </RouteLoadErrorBoundary>,
    )

    expect(
      await screen.findByRole('heading', { name: '無法載入頁面' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/可能是網路中斷/)).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: '回首頁' }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新載入' }))
    expect(reload).toHaveBeenCalledOnce()
  })

  it('recognizes ChunkLoadError by its error name', async () => {
    const error = new Error('Loading chunk 9 failed')
    error.name = 'ChunkLoadError'
    const LazyPage = lazy(() => Promise.reject(error))

    render(
      <RouteLoadErrorBoundary>
        <Suspense fallback={<p>載入中</p>}>
          <LazyPage />
        </Suspense>
      </RouteLoadErrorBoundary>,
    )

    expect(
      await screen.findByRole('heading', { name: '無法載入頁面' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/可能是網路中斷/)).toBeInTheDocument()
  })

  it('shows neutral recovery options for a render exception', async () => {
    function BrokenPage(): ReactNode {
      throw new TypeError('Cannot read properties of undefined')
    }
    const reload = vi.fn()

    render(
      <RouteLoadErrorBoundary onReload={reload}>
        <BrokenPage />
      </RouteLoadErrorBoundary>,
    )

    expect(
      await screen.findByRole('heading', { name: '頁面發生錯誤' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/若持續發生請聯絡管理者/)).toBeInTheDocument()
    expect(screen.queryByText(/可能是網路中斷/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '回首頁' })).toHaveAttribute(
      'href',
      '/',
    )

    fireEvent.click(screen.getByRole('button', { name: '重新載入' }))
    expect(reload).toHaveBeenCalledOnce()
  })
})
