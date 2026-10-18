import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createProject,
  listCompanyRoles,
  listMyProjects,
  type MyProject,
} from './api'
import MyProjectsPage from './MyProjectsPage'

vi.mock('./api', () => ({
  createProject: vi.fn(),
  DEFAULT_COMPANY_ROLE: 'contractor',
  hasDuplicateCodeWarning: vi.fn(() => false),
  listCompanyRoles: vi.fn(),
  listMyProjects: vi.fn(),
}))

const PROJECT: MyProject = {
  id: 'project-1',
  project_code: 'DEMO-001',
  name: '示範工程甲',
  client_name: '示範業主',
  site_location: '示範地點',
  planned_start_date: null,
  planned_completion_date: null,
  role_names: ['現場工程師'],
  has_office_access: false,
  can_apply_templates: true,
}

beforeEach(() => {
  vi.mocked(listMyProjects).mockReset()
  vi.mocked(listCompanyRoles).mockResolvedValue([])
  vi.mocked(createProject).mockReset()
})

describe('我的專案頁', () => {
  it('包含唯讀專案並以中性文字說明清單', async () => {
    vi.mocked(listMyProjects).mockResolvedValue([PROJECT])
    render(
      <MemoryRouter>
        <MyProjectsPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('你參與的專案會列在這裡。')).toBeVisible()
    expect(screen.queryByText(/有內業權限的專案/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '示範工程甲' })).toBeVisible()
    expect(screen.getByRole('link', { name: '套用範本' })).toHaveAttribute(
      'href',
      '/admin/projects/project-1/inspection-items/templates',
    )
  })

  it('沒有套用能力時不顯示範本入口', async () => {
    vi.mocked(listMyProjects).mockResolvedValue([
      { ...PROJECT, can_apply_templates: false },
    ])
    render(
      <MemoryRouter>
        <MyProjectsPage />
      </MemoryRouter>,
    )

    await screen.findByRole('heading', { name: '示範工程甲' })
    expect(screen.queryByRole('link', { name: '套用範本' })).toBeNull()
  })

  it('可開設專案但尚未加入者看得到新增入口與下一步說明', async () => {
    vi.mocked(listMyProjects).mockResolvedValue([])
    render(
      <MemoryRouter>
        <MyProjectsPage canCreateProject />
      </MemoryRouter>,
    )

    expect(
      await screen.findByText('你還沒有參與的專案，可新增專案。'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: '新增專案' })).toBeVisible()
  })

  it('非 Admin 的建立表單不顯示 Admin 專用建立者人選', async () => {
    vi.mocked(listMyProjects).mockResolvedValue([])
    render(
      <MemoryRouter>
        <MyProjectsPage canCreateProject />
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: '新增專案' }))

    expect(
      await screen.findByRole('heading', { name: '新增專案' }),
    ).toBeVisible()
    expect(screen.queryByLabelText(/建立者角色人選/)).toBeNull()
  })
})
