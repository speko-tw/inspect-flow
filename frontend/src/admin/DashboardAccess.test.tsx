import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { currentUserFixture } from '../testing/contractFixtures'
import { DataMemoryRouter } from '../testing/DataMemoryRouter'
import { CurrentUserProvider } from '../auth/useCurrentUser'
import AdminPage from './AdminPage'

const mocks = vi.hoisted(() => ({
  canOpenDashboard: vi.fn(),
  hasGlobalDashboardAccess: vi.fn(),
}))

vi.mock('./dashboard/api', () => mocks)
vi.mock('./dashboard/DashboardPage', () => ({
  default: () => <h1>Dashboard 測試頁</h1>,
}))

function renderAdmin(
  path: string,
  user: ReturnType<typeof currentUserFixture>,
) {
  return render(
    <DataMemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          element={
            <CurrentUserProvider value={{ user, clear: vi.fn() }}>
              <AdminPage />
            </CurrentUserProvider>
          }
          path="/admin/*"
        />
      </Routes>
    </DataMemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.hasGlobalDashboardAccess.mockImplementation(
    (user) =>
      user.is_admin ||
      user.module_permissions.includes('all_project_progress.read'),
  )
})

afterEach(() => vi.unstubAllGlobals())

describe('Dashboard 導覽與路由權限', () => {
  it('允許有專案範圍權限者進入且導覽依探針結果顯示', async () => {
    mocks.canOpenDashboard.mockResolvedValue(true)
    const user = currentUserFixture({
      has_office_access: false,
      module_permissions: ['inspection.use'],
    })
    renderAdmin('/admin/dashboard', user)

    expect(
      await screen.findByRole('heading', { name: 'Dashboard 測試頁' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'href',
      '/admin/dashboard',
    )
    expect(mocks.canOpenDashboard).toHaveBeenCalledWith(user)
  })

  it('無效專案網址先由 route guard 擋下且不啟動 Dashboard 探針', async () => {
    renderAdmin(
      '/admin/projects/..%2Fcompanies%3F/planning',
      currentUserFixture({
        has_office_access: false,
        module_permissions: ['inspection.use'],
      }),
    )

    expect(
      await screen.findByRole('heading', { name: '找不到這個專案' }),
    ).toBeInTheDocument()
    expect(mocks.canOpenDashboard).not.toHaveBeenCalled()
  })

  it('全域讀取權限不需 inspection.use 或探針即顯示入口', async () => {
    mocks.hasGlobalDashboardAccess.mockReturnValue(true)
    const user = currentUserFixture({
      has_office_access: false,
      module_permissions: ['all_project_progress.read'],
    })
    renderAdmin('/admin/dashboard', user)

    expect(
      await screen.findByRole('heading', { name: 'Dashboard 測試頁' }),
    ).toBeInTheDocument()
    expect(mocks.canOpenDashboard).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('403 探針不顯示入口且直達路由顯示無權限', async () => {
    mocks.canOpenDashboard.mockResolvedValue(false)
    renderAdmin(
      '/admin/dashboard',
      currentUserFixture({
        has_office_access: false,
        module_permissions: ['inspection.use'],
      }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '你目前沒有可查看的專案進度。',
    )
    expect(
      screen.queryByRole('link', { name: 'Dashboard' }),
    ).not.toBeInTheDocument()
  })

  it('權限探針暫時失敗時可重試，不把錯誤當成拒絕', async () => {
    mocks.canOpenDashboard
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(true)
    renderAdmin(
      '/admin/dashboard',
      currentUserFixture({
        has_office_access: false,
        module_permissions: ['inspection.use'],
      }),
    )

    fireEvent.click(await screen.findByRole('button', { name: '重新確認' }))
    await waitFor(() =>
      expect(mocks.canOpenDashboard).toHaveBeenCalledTimes(2),
    )
    expect(
      await screen.findByRole('heading', { name: 'Dashboard 測試頁' }),
    ).toBeInTheDocument()
  })

  it('無權使用者遇到 5xx 時隱藏入口並保留直達路由重試', async () => {
    mocks.canOpenDashboard.mockRejectedValueOnce(new Error('HTTP 503'))
    const user = currentUserFixture({
      has_office_access: false,
      module_permissions: ['inspection.use'],
    })
    renderAdmin('/admin/dashboard', user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '目前無法確認 Dashboard 權限，請重試。',
    )
    expect(
      screen.queryByRole('link', { name: 'Dashboard' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '重新確認' }),
    ).toBeInTheDocument()
  })
})
