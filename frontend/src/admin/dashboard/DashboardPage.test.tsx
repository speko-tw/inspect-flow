import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { currentUserFixture } from '../../testing/contractFixtures'
import DashboardPage from './DashboardPage'

const navigateMock = vi.hoisted(() => vi.fn())

vi.mock('react-router', async (importOriginal) => {
  const router = await importOriginal<typeof import('react-router')>()
  return { ...router, useNavigate: () => navigateMock }
})

const api = vi.hoisted(() => ({
  getDashboardSummary: vi.fn(),
  hasGlobalDashboardAccess: vi.fn(
    (user: { is_admin: boolean; module_permissions: string[] }) =>
      user.is_admin ||
      user.module_permissions.includes('all_project_progress.read'),
  ),
  listAllDashboardProjects: vi.fn(),
  listDashboardEngineers: vi.fn(),
  listDashboardProjects: vi.fn(),
}))

vi.mock('./api', () => api)

const projectOne = {
  project_id: 'project-1',
  name: '東區工程',
  pending_count: 2,
  in_progress_count: 1,
  completed_count: 3,
  completion_denominator_count: 6,
  completion_rate: 0.5,
}

const projectTwo = {
  ...projectOne,
  project_id: 'project-2',
  name: '西側工程',
}

const summary = {
  pending_count: 7,
  in_progress_count: 4,
  completed_count: 9,
  completion_rate: 0.45,
}

const engineer = {
  user_id: 'user-1',
  username: 'engineer-1',
  name_zh: '陳工程師',
  assigned_pending_count: 2,
  assigned_in_progress_count: 3,
  started_in_progress_count: 4,
  completed_by_count: 5,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setup(global = true) {
  api.listAllDashboardProjects.mockResolvedValue([projectOne, projectTwo])
  api.getDashboardSummary.mockResolvedValue(summary)
  api.listDashboardProjects.mockResolvedValue({
    items: [projectOne],
    next_cursor: 'next-project',
  })
  api.listDashboardEngineers.mockResolvedValue({
    items: [engineer],
    next_cursor: 'next-engineer',
  })
  const user = currentUserFixture({
    has_office_access: true,
    is_admin: false,
    module_permissions: global ? ['all_project_progress.read'] : [],
  })
  render(<DashboardPage user={user} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  api.hasGlobalDashboardAccess.mockImplementation(
    (user: { is_admin: boolean; module_permissions: string[] }) =>
      user.is_admin ||
      user.module_permissions.includes('all_project_progress.read'),
  )
})
afterEach(() => vi.useRealTimers())

describe('Dashboard 頁面', () => {
  it('全專案進度主管可從專案清單開啟任務清單', async () => {
    setup()

    fireEvent.click(await screen.findByRole('button', { name: '東區工程' }))

    expect(navigateMock).toHaveBeenCalledWith(
      '/overview/projects/project-1/tasks',
    )
  })

  it('顯示 API 摘要並切換至單一專案範圍', async () => {
    setup()

    await act(async () => {
      await api.listAllDashboardProjects.mock.results[0]?.value
    })
    await act(async () => {
      await api.getDashboardSummary.mock.results[0]?.value
    })

    expect(await screen.findByText('45%')).toBeInTheDocument()
    expect(api.getDashboardSummary).toHaveBeenCalledWith(undefined)

    expect(
      screen.getByRole('heading', { name: '專案進度總覽' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('管理後台')).not.toBeInTheDocument()
    expect(
      screen.getByText('只顯示進度，不含照片與查核結果。'),
    ).toBeInTheDocument()
    expect(await screen.findByLabelText('派出總數：6')).toHaveTextContent('6')
    expect(
      screen.getAllByRole('columnheader').map((node) => node.textContent),
    ).toEqual(['專案', '待開始', '進行中', '已完成', '派出總數', '完成率'])
    expect(
      within(screen.getByLabelText('進度摘要')).queryByText(
        '狀態為完成的任務',
      ),
    ).not.toBeInTheDocument()
    expect(document.querySelector('.dashboard-project-name small')).toBeNull()

    fireEvent.change(screen.getByLabelText('檢視範圍'), {
      target: { value: 'project-1' },
    })

    await waitFor(() =>
      expect(api.getDashboardSummary).toHaveBeenLastCalledWith('project-1'),
    )
    expect(
      screen.getByRole('button', { name: '東區工程' }),
    ).toBeInTheDocument()
  })

  it('以 API 搜尋專案並載入下一頁', async () => {
    setup()
    await screen.findByText('東區工程')
    fireEvent.change(screen.getByLabelText('搜尋專案'), {
      target: { value: '西側' },
    })

    await waitFor(() =>
      expect(api.listDashboardProjects).toHaveBeenLastCalledWith({
        q: '西側',
        limit: 10,
      }),
    )

    fireEvent.change(screen.getByLabelText('搜尋專案'), {
      target: { value: '' },
    })
    const more = await screen.findByRole('button', {
      name: '載入更多專案',
    })
    fireEvent.click(more)
    await waitFor(() =>
      expect(api.listDashboardProjects).toHaveBeenLastCalledWith({
        q: '',
        cursor: 'next-project',
        limit: 10,
      }),
    )
  })

  it('搜尋改變後忽略較晚回來的舊專案分頁', async () => {
    setup()
    await screen.findByRole('button', { name: '東區工程' })
    const stalePage = deferred<{
      items: (typeof projectOne)[]
      next_cursor: string | null
    }>()
    api.listDashboardProjects
      .mockImplementationOnce(() => stalePage.promise)
      .mockResolvedValueOnce({ items: [projectTwo], next_cursor: null })

    fireEvent.click(
      await screen.findByRole('button', { name: '載入更多專案' }),
    )
    fireEvent.change(screen.getByLabelText('搜尋專案'), {
      target: { value: '西側' },
    })
    expect(
      await screen.findByRole('button', { name: '西側工程' }),
    ).toBeInTheDocument()

    await act(async () => {
      stalePage.resolve({ items: [projectOne], next_cursor: null })
    })
    expect(
      screen.queryByRole('button', { name: '東區工程' }),
    ).not.toBeInTheDocument()
  })

  it('專案搜尋在 debounce 期間隱藏舊列與舊分頁', async () => {
    setup()
    await screen.findByRole('button', { name: '載入更多專案' })
    vi.useFakeTimers()

    fireEvent.change(screen.getByLabelText('搜尋專案'), {
      target: { value: '西側' },
    })

    expect(
      screen.queryByRole('button', { name: '東區工程' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '載入更多專案' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在載入專案進度')
  })

  it('保留四種工程師歸屬且以目前專案查詢', async () => {
    setup(false)
    await screen.findByText('45%')
    expect(api.getDashboardSummary).toHaveBeenCalledWith('project-1')
    fireEvent.click(screen.getByRole('tab', { name: '工程師工作量' }))
    expect(
      screen.getByRole('heading', { level: 1, name: '工程師工作量' }),
    ).toBeInTheDocument()

    expect(
      await screen.findByText('陳工程師（engineer-1）'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: '待開始' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: '進行中' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: '實際進行' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: '累計完成' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '待開始：2' })).toHaveAttribute(
      'data-label',
      '待開始',
    )
    expect(screen.getByRole('cell', { name: '實際進行：4' })).toHaveAttribute(
      'data-label',
      '實際進行',
    )
    expect(screen.getByRole('cell', { name: '累計完成：5' })).toHaveAttribute(
      'data-label',
      '累計完成',
    )
    const workloadGuidance = screen.getByText(
      '前兩欄依建議指派人計，第三欄依實際開始的人計，最後一欄是實際完成的累計件數；同一件任務可能重複計入，不能加總。',
    )
    expect(workloadGuidance).toHaveTextContent(
      '前兩欄依建議指派人計，第三欄依實際開始的人計，最後一欄是實際完成的累計件數；同一件任務可能重複計入，不能加總。',
    )
    const workloadTable = screen.getByRole('table', {
      name: '工程師工作量清單',
    })
    // 說明句同時是表格的描述，輔助科技進表格時會一併讀出。
    expect(workloadTable).toHaveAccessibleDescription(
      workloadGuidance.textContent ?? '',
    )
    expect(
      workloadTable.compareDocumentPosition(workloadGuidance) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(api.listDashboardEngineers).toHaveBeenCalledWith({
      projectId: 'project-1',
      q: '',
      limit: 10,
    })

    fireEvent.change(screen.getByLabelText('搜尋工程師'), {
      target: { value: '陳' },
    })
    await waitFor(() =>
      expect(api.listDashboardEngineers).toHaveBeenLastCalledWith({
        projectId: 'project-1',
        q: '陳',
        limit: 10,
      }),
    )
  })

  it('專案切換後忽略較晚回來的舊工程師分頁', async () => {
    setup(false)
    fireEvent.click(screen.getByRole('tab', { name: '工程師工作量' }))
    await screen.findByText('陳工程師（engineer-1）')
    const stalePage = deferred<{
      items: (typeof engineer)[]
      next_cursor: string | null
    }>()
    const projectTwoEngineer = {
      ...engineer,
      user_id: 'user-2',
      username: 'engineer-2',
      name_zh: '西側工程師',
    }
    api.listDashboardEngineers
      .mockImplementationOnce(() => stalePage.promise)
      .mockResolvedValueOnce({
        items: [projectTwoEngineer],
        next_cursor: null,
      })

    fireEvent.click(
      await screen.findByRole('button', { name: '載入更多工程師' }),
    )
    fireEvent.change(screen.getByLabelText('檢視範圍'), {
      target: { value: 'project-2' },
    })
    expect(
      await screen.findByText('西側工程師（engineer-2）'),
    ).toBeInTheDocument()

    await act(async () => {
      stalePage.resolve({
        items: [
          {
            ...engineer,
            user_id: 'stale-user',
            username: 'stale-engineer',
            name_zh: '舊專案工程師',
          },
        ],
        next_cursor: null,
      })
    })
    expect(
      screen.queryByText('舊專案工程師（stale-engineer）'),
    ).not.toBeInTheDocument()
  })

  it('工程師搜尋與範圍切換在 debounce 期間隱藏舊列與分頁', async () => {
    setup(false)
    fireEvent.click(screen.getByRole('tab', { name: '工程師工作量' }))
    await screen.findByRole('button', { name: '載入更多工程師' })
    vi.useFakeTimers()

    fireEvent.change(screen.getByLabelText('搜尋工程師'), {
      target: { value: '新名字' },
    })

    expect(
      screen.queryByText('陳工程師（engineer-1）'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '載入更多工程師' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      '正在載入工程師工作量',
    )

    fireEvent.change(screen.getByLabelText('檢視範圍'), {
      target: { value: 'project-2' },
    })
    expect(
      screen.queryByText('陳工程師（engineer-1）'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '載入更多工程師' }),
    ).not.toBeInTheDocument()
  })

  it('以空狀態呈現無資料範圍', async () => {
    api.listAllDashboardProjects.mockResolvedValue([])
    api.getDashboardSummary.mockResolvedValue(summary)
    api.listDashboardProjects.mockResolvedValue({
      items: [],
      next_cursor: null,
    })
    render(
      <DashboardPage
        user={currentUserFixture({
          is_admin: false,
          module_permissions: ['all_project_progress.read'],
        })}
      />,
    )

    expect(
      await screen.findByText('目前沒有可查看的專案進度。'),
    ).toBeInTheDocument()
  })

  it('錯誤後可重新載入摘要與清單', async () => {
    api.listAllDashboardProjects.mockResolvedValue([projectOne])
    api.getDashboardSummary
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(summary)
    api.listDashboardProjects.mockRejectedValueOnce(new Error('network'))
    render(
      <DashboardPage
        user={currentUserFixture({
          is_admin: false,
          module_permissions: ['all_project_progress.read'],
        })}
      />,
    )

    const retry = await screen.findAllByRole('button', { name: '重新載入' })
    fireEvent.click(retry[0])

    await waitFor(() =>
      expect(api.getDashboardSummary).toHaveBeenCalledTimes(2),
    )
    expect(await screen.findByText('45%')).toBeInTheDocument()
  })
})
