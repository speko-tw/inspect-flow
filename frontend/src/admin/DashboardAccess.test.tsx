import { render, screen } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { currentUserFixture } from '../testing/contractFixtures'
import { DataMemoryRouter } from '../testing/DataMemoryRouter'
import { CurrentUserProvider } from '../auth/useCurrentUser'
import AdminPage from './AdminPage'

const mocks = vi.hoisted(() => ({
  hasGlobalDashboardAccess: vi.fn(),
}))

vi.mock('./dashboard/api', () => mocks)
vi.mock('./dashboard/DashboardPage', () => ({
  default: () => <h1>Dashboard 測試頁</h1>,
}))
vi.mock('./dashboard/DashboardTaskPage', () => ({
  default: () => <h1>任務明細測試頁</h1>,
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
          path="/*"
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

describe('Dashboard 導覽與路由權限', () => {
  it('專案範圍權限不能開啟總覽或顯示總覽導覽', async () => {
    const user = currentUserFixture({
      has_office_access: false,
      module_permissions: ['inspection.use'],
    })
    renderAdmin('/overview', user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '你目前沒有可查看的專案進度。',
    )
    expect(
      screen.queryByRole('link', { name: '總覽' }),
    ).not.toBeInTheDocument()
  })

  it('無效專案網址由 route guard 擋下', async () => {
    renderAdmin(
      '/projects/..%2Fcompanies%3F/planning',
      currentUserFixture({
        has_office_access: false,
        module_permissions: ['inspection.use'],
      }),
    )

    expect(
      await screen.findByRole('heading', { name: '找不到這個專案' }),
    ).toBeInTheDocument()
  })

  it('全域讀取權限不需 inspection.use 即顯示入口', async () => {
    mocks.hasGlobalDashboardAccess.mockReturnValue(true)
    const user = currentUserFixture({
      has_office_access: false,
      module_permissions: ['all_project_progress.read'],
    })
    renderAdmin('/overview', user)

    expect(
      await screen.findByRole('heading', { name: 'Dashboard 測試頁' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '總覽' })).toBeInTheDocument()
  })

  it('專案範圍權限不能直開全部任務明細', async () => {
    const user = currentUserFixture({
      has_office_access: false,
      module_permissions: ['inspection.use'],
    })
    renderAdmin('/overview/projects/project-1/tasks/task-1', user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '你目前沒有可查看的專案進度。',
    )
    expect(
      screen.queryByRole('heading', { name: '任務明細測試頁' }),
    ).not.toBeInTheDocument()
  })

  it('全部專案進度權限可直接開啟任務明細路由', async () => {
    mocks.hasGlobalDashboardAccess.mockReturnValue(true)
    const user = currentUserFixture({
      has_office_access: false,
      module_permissions: ['all_project_progress.read'],
    })
    renderAdmin('/overview/projects/project-1/tasks/task-1', user)

    expect(
      await screen.findByRole('heading', { name: '任務明細測試頁' }),
    ).toBeInTheDocument()
  })
})
