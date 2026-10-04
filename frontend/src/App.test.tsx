import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import App from './App'
import { preloadLazyRoutes } from './testing/preloadRoutes'

// 加上 RequireAuth 之後，/admin、/field 會先呼叫目前使用者 API
// （AUT-R08）。這裡只驗證路由本身接得到正確的畫面，所以提供一個
// 一律回傳「已登入」的替身，讓兩個測試維持原本只測路由的範圍；
// 未登入時的導向行為由 RequireAuth.test.tsx 驗證。
function stubAuthenticatedFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/auth/me')) {
        return Response.json({
          id: 'u1',
          username: 'user',
          email: 'user@example.com',
          name_en: 'Test User',
          name_zh: '測試使用者',
          is_admin: true,
          must_change_password: false,
        })
      }
      if (/\/(users|companies|projects)\?/.test(url)) {
        return Response.json({ items: [], next_cursor: null })
      }
      return Response.json([])
    }),
  )
}

// 拆包模組的首次載入成本放在 hook，不佔各測試斷言的 1 秒（#295）。
beforeAll(preloadLazyRoutes)

describe('App routing', () => {
  beforeEach(() => {
    stubAuthenticatedFetch()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the admin user management page on /admin', async () => {
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/admin']}>
          <App />
        </MemoryRouter>,
      )
    })

    expect(
      await screen.findByRole('heading', { name: '使用者管理' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText(`InspectFlow v${__INSPECTFLOW_VERSION__}`),
    ).toBeInTheDocument()
    expect(screen.queryByText('我的工作台')).not.toBeInTheDocument()
  })

  it('renders the personal workspace on /field', async () => {
    render(
      <MemoryRouter initialEntries={['/field']}>
        <App />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: '我的工作台' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText(`InspectFlow v${__INSPECTFLOW_VERSION__}`),
    ).toBeInTheDocument()
    expect(screen.queryByText('使用者管理')).not.toBeInTheDocument()
  })

  it('shows the release version on the login page', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: '登入' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText(`InspectFlow v${__INSPECTFLOW_VERSION__}`),
    ).toBeInTheDocument()
  })

  it('shows the release version on the first setup page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ setup_required: true })),
    )
    render(
      <MemoryRouter initialEntries={['/setup']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByLabelText('首次登入碼')).toBeInTheDocument()
    expect(
      await screen.findByText(`InspectFlow v${__INSPECTFLOW_VERSION__}`),
    ).toBeInTheDocument()
  })
})
