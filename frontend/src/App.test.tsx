import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
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
          has_office_access: true,
          has_field_access: true,
          has_template_access: true,
        })
      }
      if (/\/(users|companies|projects)\?/.test(url)) {
        return Response.json({ items: [], next_cursor: null })
      }
      if (url.includes('/field/inspection-tasks?')) {
        return Response.json({ items: [], next_cursor: null })
      }
      return Response.json([])
    }),
  )
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="pathname">{location.pathname}</output>
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
    expect(screen.queryByText('今日任務')).not.toBeInTheDocument()
  })

  it('renders Field tasks on /field', async () => {
    render(
      <MemoryRouter initialEntries={['/field']}>
        <App />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: '今日任務' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText(`InspectFlow v${__INSPECTFLOW_VERSION__}`),
    ).toBeInTheDocument()
    expect(screen.queryByText('使用者管理')).not.toBeInTheDocument()
  })

  it('redirects the legacy Field project URL to the current Admin path', async () => {
    render(
      <MemoryRouter initialEntries={['/field/projects/project-1']}>
        <LocationProbe />
        <App />
      </MemoryRouter>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('pathname')).toHaveTextContent(
        '/admin/projects/project-1/inspection-items/templates',
      ),
    )
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
