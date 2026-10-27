import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createProject,
  listCompanyRoles,
  listMyProjects,
  type MyProject,
  type Project,
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
  has_office_access: true,
  can_apply_templates: true,
}

const CREATED_PROJECT: Project = {
  id: 'project-2',
  project_code: 'DEMO-002',
  name: '新建工程',
  client_name: '示範業主',
  site_location: '新建工地',
  company_role: 'contractor',
  planned_start_date: null,
  planned_completion_date: null,
  warnings: [],
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
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
    expect(
      await screen.findByRole('heading', { name: '示範工程甲' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '套用範本' })).toHaveAttribute(
      'href',
      '/projects/project-1/inspection-items/templates',
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

  it('沒有專案或開案權限者看到空清單說明且沒有新增入口', async () => {
    vi.mocked(listMyProjects).mockResolvedValue([])
    render(
      <MemoryRouter>
        <MyProjectsPage />
      </MemoryRouter>,
    )

    expect(
      await screen.findByText(
        '目前沒有可檢視的專案。請聯絡系統管理者，將你加入專案。',
      ),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: '新增專案' })).toBeNull()
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

  it('非 Admin 建立成功後導向新專案首頁', async () => {
    vi.mocked(listMyProjects).mockResolvedValue([])
    vi.mocked(listCompanyRoles).mockResolvedValue([
      {
        value: 'contractor',
        label: '承攬施工方',
        inspection_level: 'self_inspection',
      },
    ])
    vi.mocked(createProject).mockResolvedValue(CREATED_PROJECT)
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <MyProjectsPage canCreateProject />
        <LocationProbe />
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: '新增專案' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '新增專案' })).toBeEnabled(),
    )

    fireEvent.change(screen.getByLabelText(/專案代號/), {
      target: { value: 'DEMO-002' },
    })
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: '新建工程' },
    })
    fireEvent.change(screen.getByLabelText(/業主／委託單位/), {
      target: { value: '示範業主' },
    })
    fireEvent.change(screen.getByLabelText(/整體工程地點/), {
      target: { value: '新建工地' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/projects/project-2',
      ),
    )
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        project_code: 'DEMO-002',
        company_role: 'contractor',
      }),
    )
  })

  it('舊建立請求不導向或覆蓋新草稿，完成項目仍回到清單', async () => {
    vi.mocked(listMyProjects)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { ...PROJECT, id: CREATED_PROJECT.id, name: CREATED_PROJECT.name },
      ])
    vi.mocked(listCompanyRoles).mockResolvedValue([
      {
        value: 'contractor',
        label: '承攬施工方',
        inspection_level: 'self_inspection',
      },
    ])
    let finishCreate!: (project: Project) => void
    vi.mocked(createProject).mockReturnValue(
      new Promise((resolve) => {
        finishCreate = resolve
      }),
    )
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <MyProjectsPage canCreateProject />
        <LocationProbe />
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: '新增專案' }))
    await screen.findByRole('heading', { name: '新增專案' })
    fireEvent.change(screen.getByLabelText(/專案代號/), {
      target: { value: 'DEMO-002' },
    })
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: '新建工程' },
    })
    fireEvent.change(screen.getByLabelText(/業主／委託單位/), {
      target: { value: '示範業主' },
    })
    fireEvent.change(screen.getByLabelText(/整體工程地點/), {
      target: { value: '新建工地' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))
    fireEvent.click(await screen.findByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '捨棄' }))
    fireEvent.click(await screen.findByRole('button', { name: '新增專案' }))
    fireEvent.change(await screen.findByLabelText(/專案代號/), {
      target: { value: 'DRAFT-NEW' },
    })

    finishCreate(CREATED_PROJECT)

    await waitFor(() =>
      expect(screen.getByLabelText(/專案代號/)).toHaveValue('DRAFT-NEW'),
    )
    expect(screen.getByTestId('location')).toHaveTextContent('/projects')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '捨棄' }))
    expect(
      await screen.findByRole('heading', { name: '新建工程' }),
    ).toBeVisible()
  })

  it('捨棄表單後舊請求完成只更新清單', async () => {
    vi.mocked(listMyProjects)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { ...PROJECT, id: CREATED_PROJECT.id, name: CREATED_PROJECT.name },
      ])
    vi.mocked(listCompanyRoles).mockResolvedValue([
      {
        value: 'contractor',
        label: '承攬施工方',
        inspection_level: 'self_inspection',
      },
    ])
    let finishCreate!: (project: Project) => void
    vi.mocked(createProject).mockReturnValue(
      new Promise((resolve) => {
        finishCreate = resolve
      }),
    )
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <MyProjectsPage canCreateProject />
        <LocationProbe />
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: '新增專案' }))
    await screen.findByRole('heading', { name: '新增專案' })
    fireEvent.change(screen.getByLabelText(/專案代號/), {
      target: { value: 'DEMO-002' },
    })
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: '新建工程' },
    })
    fireEvent.change(screen.getByLabelText(/業主／委託單位/), {
      target: { value: '示範業主' },
    })
    fireEvent.change(screen.getByLabelText(/整體工程地點/), {
      target: { value: '新建工地' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))
    fireEvent.click(await screen.findByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '捨棄' }))

    finishCreate(CREATED_PROJECT)

    expect(screen.getByTestId('location')).toHaveTextContent('/projects')
    expect(
      await screen.findByRole('heading', { name: '新建工程' }),
    ).toBeVisible()
  })

  it('列出唯讀專案，但不提供範本套用入口', async () => {
    vi.mocked(listMyProjects).mockResolvedValue([
      { ...PROJECT, has_office_access: false, can_apply_templates: true },
    ])
    render(
      <MemoryRouter>
        <MyProjectsPage />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: '示範工程甲' }),
    ).toBeVisible()
    const open = screen.getByRole('link', { name: '開啟專案' })
    expect(open).toHaveAttribute('href', '/projects/project-1')
    // 卡片內的開啟用外框強調，實心主要按鈕留給頁級的新增專案。
    expect(open).toHaveClass('btn-emphasis')
    expect(open).not.toHaveClass('btn-primary')
    expect(screen.queryByRole('link', { name: '套用範本' })).toBeNull()
  })
})
