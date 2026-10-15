import { lazy, Suspense } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import RouteLoadErrorBoundary from './RouteLoadErrorBoundary'

describe('RouteLoadErrorBoundary', () => {
  it('shows a recovery message when a lazy page import rejects', async () => {
    const LazyPage = lazy(() =>
      Promise.reject(new Error('Chunk download failed')),
    )
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

    fireEvent.click(screen.getByRole('button', { name: '重新載入' }))
    expect(reload).toHaveBeenCalledOnce()
  })
})
