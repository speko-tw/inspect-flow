import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { CurrentUserProvider } from '../../auth/useCurrentUser'
import { currentUserFixture } from '../../testing/contractFixtures'
import { listProjectItems } from '../projectItems/api'
import {
  listAllProjects,
  saveProjectItemAsTemplate,
} from '../projects/projectTemplatesApi'
import { listTemplateCategories, listTemplateSystems } from './api'
import SaveTemplateFromProjectPage from './SaveTemplateFromProjectPage'

vi.mock('../projectItems/api', () => ({ listProjectItems: vi.fn() }))
vi.mock('../projects/projectTemplatesApi', () => ({
  listAllProjects: vi.fn(),
  saveProjectItemAsTemplate: vi.fn(),
  templateErrorMessage: (error: Error) => error.message,
}))
vi.mock('./api', () => ({
  listTemplateCategories: vi.fn(),
  listTemplateSystems: vi.fn(),
}))

function LocationState() {
  const location = useLocation()
  return (
    <output data-testid="location-state">
      {JSON.stringify(location.state)}
    </output>
  )
}

function renderPage(canManage: boolean) {
  return render(
    <CurrentUserProvider
      value={{
        user: currentUserFixture({ can_manage_template_library: canManage }),
        clear: vi.fn(),
      }}
    >
      <MemoryRouter initialEntries={['/templates/from-project']}>
        <LocationState />
        <Routes>
          <Route
            element={<SaveTemplateFromProjectPage />}
            path="/templates/from-project"
          />
          <Route element={<p>範本管理</p>} path="/templates" />
        </Routes>
      </MemoryRouter>
    </CurrentUserProvider>,
  )
}

describe('SaveTemplateFromProjectPage', () => {
  it('拒絕唯讀範本使用者且不讀取任何跨專案資料', () => {
    renderPage(false)

    expect(screen.getByRole('heading', { name: '無權限' })).toBeTruthy()
    expect(listAllProjects).not.toHaveBeenCalled()
    expect(listProjectItems).not.toHaveBeenCalled()
    expect(listTemplateCategories).not.toHaveBeenCalled()
    expect(saveProjectItemAsTemplate).not.toHaveBeenCalled()
  })

  it('讓非成員範本管理員完成專案項目複製並保留選取結果', async () => {
    vi.mocked(listAllProjects).mockResolvedValue([
      { id: 'p1', project_code: 'P-1', name: '工程一' },
    ])
    vi.mocked(listTemplateCategories).mockResolvedValue([
      { id: 'c1', name: '土木' },
    ])
    vi.mocked(listTemplateSystems).mockResolvedValue([
      { id: 's1', category_id: 'c1', name: '結構' },
    ])
    vi.mocked(listProjectItems).mockResolvedValue([
      {
        id: 'i1',
        project_id: 'p1',
        sequence: 1,
        title: '鋼筋查核',
        instruction: '',
        source_template_name: '原範本',
        applied_at: '2026-10-01T00:00:00Z',
        task_count: 0,
        inspection_points: [{ sequence: 1 } as never],
      },
    ])
    vi.mocked(saveProjectItemAsTemplate).mockResolvedValue({
      id: 'new-template',
      title: '鋼筋查核',
    })

    renderPage(true)
    expect(
      await screen.findByRole('heading', { name: '選擇專案' }),
    ).toBeVisible()
    const projectButton = await screen.findByRole('button', {
      name: 'P-1 · 工程一',
    })
    fireEvent.click(projectButton)
    expect(await screen.findByText('步驟 2／3')).toBeVisible()
    fireEvent.click(await screen.findByRole('button', { name: /鋼筋查核/ }))
    expect(await screen.findByText('步驟 3／3')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '土木' }))
    fireEvent.click(await screen.findByRole('button', { name: '結構' }))
    fireEvent.click(screen.getByRole('button', { name: '存入這個系統' }))

    await waitFor(() =>
      expect(saveProjectItemAsTemplate).toHaveBeenCalledWith(
        'p1',
        'i1',
        's1',
        '鋼筋查核',
      ),
    )
    await waitFor(() => expect(screen.getByText('範本管理')).toBeTruthy())
    expect(screen.getByTestId('location-state').textContent).toContain(
      'new-template',
    )
    expect(screen.getByTestId('location-state').textContent).toContain(
      '土木 / 結構',
    )
  })

  it('搜尋後單選來源，409 時保留來源、名稱和目標系統供重試', async () => {
    vi.mocked(listAllProjects).mockResolvedValue([
      { id: 'p1', project_code: 'P-1', name: '工程一' },
      { id: 'p2', project_code: 'P-2', name: '工程二' },
    ])
    vi.mocked(listTemplateCategories).mockResolvedValue([
      { id: 'c1', name: '土木' },
    ])
    vi.mocked(listTemplateSystems).mockResolvedValue([
      { id: 's1', category_id: 'c1', name: '結構' },
    ])
    vi.mocked(listProjectItems).mockResolvedValue([
      {
        id: 'i1',
        project_id: 'p1',
        sequence: 1,
        title: '鋼筋查核',
        instruction: '',
        source_template_name: '原範本',
        applied_at: '2026-10-01T00:00:00Z',
        task_count: 0,
        inspection_points: [{ sequence: 1 } as never],
      },
    ])
    vi.mocked(saveProjectItemAsTemplate)
      .mockRejectedValueOnce(new Error('名稱衝突'))
      .mockResolvedValueOnce({ id: 'new-template', title: '修訂範本名' })

    renderPage(true)
    fireEvent.change(await screen.findByLabelText('搜尋專案'), {
      target: { value: 'P-2' },
    })
    expect(screen.queryByRole('button', { name: 'P-1 · 工程一' })).toBeNull()
    fireEvent.change(screen.getByLabelText('搜尋專案'), {
      target: { value: 'P-1' },
    })
    fireEvent.click(
      await screen.findByRole('button', { name: 'P-1 · 工程一' }),
    )
    fireEvent.click(await screen.findByRole('button', { name: /鋼筋查核/ }))
    fireEvent.click(screen.getByRole('button', { name: '土木' }))
    fireEvent.click(await screen.findByRole('button', { name: '結構' }))
    fireEvent.change(screen.getByLabelText('範本名稱'), {
      target: { value: '修訂範本名' },
    })
    fireEvent.click(screen.getByRole('button', { name: '存入這個系統' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('名稱衝突')
    expect(screen.getByLabelText('範本名稱')).toHaveValue('修訂範本名')
    expect(screen.getByRole('button', { name: '結構' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByRole('button', { name: /鋼筋查核/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: '存入這個系統' }))
    await waitFor(() =>
      expect(saveProjectItemAsTemplate).toHaveBeenCalledTimes(2),
    )
    expect(saveProjectItemAsTemplate).toHaveBeenLastCalledWith(
      'p1',
      'i1',
      's1',
      '修訂範本名',
    )
    await screen.findByText('範本管理')
    expect(screen.getByTestId('location-state').textContent).toContain(
      'new-template',
    )
  })

  it('切換專案時清除舊項目並忽略較慢的舊請求', async () => {
    type ProjectItems = Awaited<ReturnType<typeof listProjectItems>>
    let resolveA: ((items: ProjectItems) => void) | null = null
    vi.mocked(listAllProjects).mockResolvedValue([
      { id: 'p-a', project_code: 'A', name: '慢專案' },
      { id: 'p-b', project_code: 'B', name: '快專案' },
    ])
    vi.mocked(listTemplateCategories).mockResolvedValue([])
    vi.mocked(listProjectItems).mockImplementation((projectId) => {
      if (projectId === 'p-a') {
        return new Promise((resolve) => {
          resolveA = resolve
        })
      }
      return Promise.resolve([
        {
          id: 'item-b',
          project_id: 'p-b',
          sequence: 1,
          title: 'B 的項目',
          instruction: '',
          source_template_name: 'B 來源',
          applied_at: '2026-10-01T00:00:00Z',
          task_count: 0,
          inspection_points: [],
        },
      ])
    })

    renderPage(true)
    fireEvent.click(await screen.findByRole('button', { name: 'A · 慢專案' }))
    await screen.findByText('載入中…')
    fireEvent.click(screen.getByRole('button', { name: 'B · 快專案' }))
    expect(
      await screen.findByRole('button', { name: /B 的項目/ }),
    ).toBeVisible()
    expect(resolveA).not.toBeNull()
    await act(async () => {
      resolveA?.([
        {
          id: 'item-a',
          project_id: 'p-a',
          sequence: 1,
          title: 'A 的舊項目',
          instruction: '',
          source_template_name: 'A 來源',
          applied_at: '2026-10-01T00:00:00Z',
          task_count: 0,
          inspection_points: [],
        },
      ])
    })
    expect(screen.getByRole('button', { name: /B 的項目/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /A 的舊項目/ })).toBeNull()
  })

  it('存入失敗時將錯誤放在目標步驟並聚焦', async () => {
    vi.mocked(listAllProjects).mockResolvedValue([
      { id: 'p1', project_code: 'P-1', name: '工程一' },
    ])
    vi.mocked(listTemplateCategories).mockResolvedValue([
      { id: 'c1', name: '土木' },
    ])
    vi.mocked(listTemplateSystems).mockResolvedValue([
      { id: 's1', category_id: 'c1', name: '結構' },
    ])
    vi.mocked(listProjectItems).mockResolvedValue([
      {
        id: 'i1',
        project_id: 'p1',
        sequence: 1,
        title: '鋼筋查核',
        instruction: '',
        source_template_name: '原範本',
        applied_at: '2026-10-01T00:00:00Z',
        task_count: 0,
        inspection_points: [],
      },
    ])
    vi.mocked(saveProjectItemAsTemplate).mockRejectedValueOnce(
      new Error('儲存失敗，請稍後重試。'),
    )

    renderPage(true)
    fireEvent.click(
      await screen.findByRole('button', { name: 'P-1 · 工程一' }),
    )
    fireEvent.click(await screen.findByRole('button', { name: /鋼筋查核/ }))
    fireEvent.click(screen.getByRole('button', { name: '土木' }))
    fireEvent.click(await screen.findByRole('button', { name: '結構' }))
    fireEvent.click(screen.getByRole('button', { name: '存入這個系統' }))

    const targetStep = screen
      .getByRole('heading', {
        name: '選擇範本庫位置',
      })
      .closest('li')
    expect(targetStep).not.toBeNull()
    const alert = await within(targetStep!).findByRole('alert')
    expect(alert).toHaveTextContent('儲存失敗，請稍後重試。')
    await waitFor(() => expect(alert).toHaveFocus())
    expect(
      document.querySelector('.save-template-page > [role="alert"]'),
    ).toBeNull()
    fireEvent.change(screen.getByLabelText('範本名稱'), {
      target: { value: '修正後名稱' },
    })
    expect(within(targetStep!).queryByRole('alert')).toBeNull()
  })
})

it('R2：跨專案存為範本不列停用來源', async () => {
  vi.mocked(listAllProjects).mockResolvedValue([
    { id: 'p1', project_code: 'P-1', name: '工程一' },
  ])
  vi.mocked(listTemplateCategories).mockResolvedValue([])
  const source = {
    id: 'active',
    project_id: 'p1',
    sequence: 1,
    title: '啟用來源',
    instruction: '',
    source_template_name: '範本',
    applied_at: '2026-10-01T00:00:00Z',
    task_count: 0,
    inspection_points: [],
  }
  vi.mocked(listProjectItems).mockResolvedValue([
    source,
    { ...source, id: 'inactive', title: '停用來源', is_active: false },
  ])
  renderPage(true)
  fireEvent.click(await screen.findByRole('button', { name: 'P-1 · 工程一' }))
  expect(await screen.findByRole('button', { name: /啟用來源/ })).toBeVisible()
  expect(screen.queryByRole('button', { name: /停用來源/ })).toBeNull()
  expect(screen.getByText('停用項目須先恢復，才能存為範本。')).toBeVisible()
})
