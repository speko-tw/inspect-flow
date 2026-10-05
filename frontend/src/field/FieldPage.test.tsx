import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CurrentUser } from '../auth/api'
import { CurrentUserProvider } from '../auth/useCurrentUser'
import FieldPage from './FieldPage'
import type { MyCompanyProfile, MyProject } from './api'

const MEMBER: CurrentUser = {
  id: 'u1',
  username: 'anna.deng',
  email: 'anna@demo.example',
  name_en: 'Anna Deng',
  name_zh: '鄧安娜',
  is_admin: false,
  must_change_password: false,
}

const ADMIN: CurrentUser = {
  ...MEMBER,
  id: 'a1',
  username: 'boss',
  is_admin: true,
}

const PROFILE: MyCompanyProfile = {
  company: { id: 'c1', name: '示範公司' },
  department: '機電部',
  location: '台北',
  employee_no: 'E001',
}

const PROJECTS: MyProject[] = [
  {
    id: 'p1',
    project_code: 'DEMO-001',
    name: '示範工程甲',
    client_name: '示範業主',
    site_location: '示範工地',
    planned_start_date: '2026-10-01',
    planned_completion_date: null,
    role_names: ['查核員', '審核員'],
  },
  {
    id: 'p2',
    project_code: 'DEMO-002',
    name: '示範工程乙',
    client_name: '示範業主',
    site_location: '另一工地',
    planned_start_date: null,
    planned_completion_date: null,
    role_names: [],
  },
]

function stubBackend({
  profile = PROFILE,
  projects = PROJECTS,
  failProjects = false,
  allProjects = null,
}: {
  profile?: Partial<MyCompanyProfile> | MyCompanyProfile
  projects?: MyProject[]
  failProjects?: boolean
  allProjects?: Array<{ id: string; name: string }> | null
} = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/auth/me')) {
        return Response.json({ ...MEMBER, ...profile })
      }
      if (url.endsWith('/me/projects')) {
        return failProjects
          ? Response.json({ error: { code: 'x' } }, { status: 500 })
          : Response.json(projects)
      }
      if (url.includes('/projects?limit=100')) {
        return allProjects === null
          ? Response.json(
              { error: { code: 'permission.denied' } },
              { status: 403 },
            )
          : Response.json({ items: allProjects, next_cursor: null })
      }
      return Response.json([])
    }),
  )
}

function renderPage(user: CurrentUser = MEMBER, state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/field', state }]}>
      <CurrentUserProvider value={{ user, clear: vi.fn() }}>
        <FieldPage />
      </CurrentUserProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('我的工作台', () => {
  it('顯示我的資料、公司與參與的專案和角色', async () => {
    stubBackend()
    renderPage()

    expect(
      screen.getByRole('heading', { name: '我的工作台' }),
    ).toBeInTheDocument()
    const profile = screen.getByRole('region', { name: '我的資料' })
    expect(within(profile).getByText('anna.deng')).toBeInTheDocument()
    expect(within(profile).getByText('鄧安娜')).toBeInTheDocument()
    expect(within(profile).getByText('Anna Deng')).toBeInTheDocument()
    expect(within(profile).getByText('anna@demo.example')).toBeInTheDocument()
    expect(within(profile).getByText('一般使用者')).toBeInTheDocument()

    const company = await screen.findByRole('region', { name: '我的公司' })
    expect(await within(company).findByText('示範公司')).toBeInTheDocument()
    expect(within(company).getByText('機電部')).toBeInTheDocument()
    expect(within(company).getByText('台北')).toBeInTheDocument()
    expect(within(company).getByText('E001')).toBeInTheDocument()

    const projects = screen.getByRole('region', { name: '我參與的專案' })
    expect(await within(projects).findByText('示範工程甲')).toBeInTheDocument()
    const rows = within(projects).getAllByRole('row')
    expect(within(rows[1]).getByText('查核員、審核員')).toBeInTheDocument()
    expect(within(rows[1]).getByText('2026-10-01')).toBeInTheDocument()
    expect(within(rows[2]).getByText('未指派角色')).toBeInTheDocument()
  })

  it('沒有公司時顯示未連結公司', async () => {
    stubBackend({
      profile: {
        company: null,
        department: null,
        location: null,
        employee_no: null,
      },
    })
    renderPage()

    const company = screen.getByRole('region', { name: '我的公司' })
    expect(await within(company).findByText('未連結公司')).toBeInTheDocument()
    expect(within(company).queryByText('部門')).not.toBeInTheDocument()
  })

  it('沒有專案時顯示目前沒有參與的專案', async () => {
    stubBackend({ projects: [] })
    renderPage()

    expect(await screen.findByText('目前沒有參與的專案')).toBeInTheDocument()
    expect(screen.queryByText('專案代號')).not.toBeInTheDocument()
  })

  it('專案載入失敗時顯示錯誤，其他區塊照常顯示', async () => {
    stubBackend({ failProjects: true })
    renderPage()

    expect(
      await screen.findByText('無法載入參與的專案，請稍後再試。'),
    ).toBeInTheDocument()
    expect(await screen.findByText('示範公司')).toBeInTheDocument()
  })

  it('一般使用者沒有進入管理頁連結，admin 有', async () => {
    stubBackend()
    const { unmount } = renderPage(MEMBER)
    await screen.findByText('示範公司')
    expect(
      screen.queryByRole('link', { name: '進入管理頁' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '瀏覽範本庫' })).toHaveAttribute(
      'href',
      '/admin/templates',
    )
    expect(screen.getByText('一般使用者')).toBeInTheDocument()
    unmount()

    stubBackend()
    renderPage(ADMIN)
    await screen.findByText('示範公司')
    expect(screen.getByRole('link', { name: '進入管理頁' })).toHaveAttribute(
      'href',
      '/admin',
    )
    expect(screen.getByText('系統管理者')).toBeInTheDocument()
  })

  it('有變更密碼連結與登出按鈕，並顯示 router state 的提示', async () => {
    stubBackend()
    renderPage(MEMBER, { notice: '已收回你的管理者權限。' })

    expect(screen.getByRole('status')).toHaveTextContent(
      '已收回你的管理者權限。',
    )
    expect(screen.getByRole('link', { name: '變更密碼' })).toHaveAttribute(
      'href',
      '/change-password',
    )
    expect(screen.getByRole('button', { name: '登出' })).toBeInTheDocument()
    await screen.findByText('示範公司')
  })

  it('沒有姓名與 email（內建 admin）時顯示破折號', async () => {
    stubBackend({ projects: [] })
    renderPage({
      ...ADMIN,
      username: 'admin',
      name_zh: null,
      name_en: null,
      email: null,
    })

    const profile = screen.getByRole('region', { name: '我的資料' })
    expect(within(profile).getAllByText('—')).toHaveLength(3)
    await screen.findByText('目前沒有參與的專案')
  })

  it('GET projects 為 403 時不顯示跨專案入口', async () => {
    stubBackend()
    renderPage()
    await screen.findByText('示範工程甲')
    expect(
      screen.queryByRole('heading', { name: '所有專案' }),
    ).not.toBeInTheDocument()
  })

  it('範本管理員能看全部專案的入口', async () => {
    stubBackend({ allProjects: [{ id: 'p3', name: '示範工程丙' }] })
    renderPage()
    const section = await screen.findByRole('region', {
      name: '所有專案',
    })
    expect(
      within(section).getByRole('link', {
        name: '示範工程丙',
      }),
    ).toHaveAttribute('href', '/field/projects/p3')
  })
})
