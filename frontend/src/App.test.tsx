import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'

// 加上 RequireAuth 之後，/admin、/field 會先呼叫目前使用者 API
// （AUT-R08）。這裡只驗證路由本身接得到正確的畫面，所以提供一個
// 一律回傳「已登入」的替身，讓兩個測試維持原本只測路由的範圍；
// 未登入時的導向行為由 RequireAuth.test.tsx 驗證。
function stubAuthenticatedFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        id: 'u1',
        email: 'user@example.com',
        name_en: 'Test User',
        name_zh: '測試使用者',
        is_admin: true,
      }),
    ),
  )
}

describe('App routing', () => {
  beforeEach(() => {
    stubAuthenticatedFetch()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the Admin placeholder on /admin', async () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <App />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: 'Admin' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Field')).not.toBeInTheDocument()
  })

  it('renders the Field placeholder on /field', async () => {
    render(
      <MemoryRouter initialEntries={['/field']}>
        <App />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: 'Field' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
  })
})
