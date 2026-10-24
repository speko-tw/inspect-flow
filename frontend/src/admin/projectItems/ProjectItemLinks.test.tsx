import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CurrentUserProvider } from '../../auth/useCurrentUser'
import { currentUserFixture } from '../../testing/contractFixtures'
import ProjectItemLinks from './ProjectItemLinks'

afterEach(() => vi.unstubAllGlobals())

describe('ProjectItemLinks', () => {
  it('shows shared denial for a 403 item list', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: 'permission.denied' } },
            { status: 403 },
          ),
        ),
    )

    render(
      <CurrentUserProvider
        value={{
          user: currentUserFixture({ is_admin: true }),
          clear: vi.fn(),
        }}
      >
        <MemoryRouter
          initialEntries={['/projects/project-1/inspection-items']}
        >
          <Routes>
            <Route
              element={
                <ProjectItemLinks
                  projectId="project-1"
                  viewerPermissions={[]}
                />
              }
              path="/projects/:projectId/inspection-items"
            />
          </Routes>
        </MemoryRouter>
      </CurrentUserProvider>,
    )

    expect(
      await screen.findByRole('heading', { name: '無權限', level: 2 }),
    ).toBeVisible()
    expect(
      await screen.findByText('你沒有使用這個頁面的權限', {
        selector: 'p[role="status"]',
      }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '回到我的首頁' })).toHaveAttribute(
      'href',
      '/overview',
    )
  })

  it('shows source, applied time, and new-item highlight', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          items: [
            {
              id: 'copy-1',
              project_id: 'project-1',
              sequence: 1,
              title: '管線查核',
              instruction: '確認管線安裝',
              source_template_name: '給排水',
              source_category_name: '建築設備',
              source_system_name: '給排水系統',
              applied_at: '2026-10-05T01:00:00Z',
              task_count: 0,
              inspection_points: [],
            },
          ],
          next_cursor: null,
        }),
      ),
    )

    render(
      <CurrentUserProvider
        value={{
          user: currentUserFixture({ is_admin: true }),
          clear: vi.fn(),
        }}
      >
        <MemoryRouter
          initialEntries={[
            {
              pathname: '/projects/project-1',
              state: { highlightedItemIds: ['copy-1'] },
            },
          ]}
        >
          <Routes>
            <Route
              element={
                <ProjectItemLinks
                  projectId="project-1"
                  viewerPermissions={['project_inspection_item.edit']}
                />
              }
              path="/projects/:projectId"
            />
          </Routes>
        </MemoryRouter>
      </CurrentUserProvider>,
    )

    expect(await screen.findByText('來源範本：給排水')).toBeInTheDocument()
    expect(
      screen.getByText('來源分類／系統： 建築設備 / 給排水系統'),
    ).toBeInTheDocument()
    expect(screen.getByText('剛套用')).toBeInTheDocument()
    expect(screen.getByText(/套用時間：/).closest('time')).toHaveAttribute(
      'datetime',
      '2026-10-05T01:00:00Z',
    )
    const editLinkName = '修改「管線查核」'
    const editLink = screen.getByRole('link', { name: editLinkName })
    expect(editLink).toHaveTextContent('修改')
    expect(editLink).toHaveAttribute(
      'href',
      '/projects/project-1/inspection-items/copy-1',
    )
    expect(screen.getByText('0 個查核項次')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '從範本新增查核項目' }),
    ).toHaveAttribute('href', '/projects/project-1/inspection-items/templates')
  })

  it('keeps project items read-only without edit permission', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          items: [
            {
              id: 'copy-1',
              project_id: 'project-1',
              sequence: 1,
              title: '管線查核',
              instruction: '確認管線安裝',
              source_template_name: '舊來源名稱',
              source_category_name: null,
              source_system_name: null,
              applied_at: '2026-10-05T01:00:00Z',
              task_count: 0,
              inspection_points: [],
            },
          ],
          next_cursor: null,
        }),
      ),
    )

    render(
      <CurrentUserProvider
        value={{ user: currentUserFixture(), clear: vi.fn() }}
      >
        <MemoryRouter
          initialEntries={['/projects/project-1/inspection-items']}
        >
          <Routes>
            <Route
              element={
                <ProjectItemLinks
                  projectId="project-1"
                  viewerPermissions={['inspection_plan.read']}
                />
              }
              path="/projects/:projectId/inspection-items"
            />
          </Routes>
        </MemoryRouter>
      </CurrentUserProvider>,
    )

    expect(await screen.findByText('管線查核')).toBeInTheDocument()
    expect(screen.getByText('來源範本：舊來源名稱')).toBeInTheDocument()
    expect(screen.getByText('來源分類／系統： 未記錄')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /刪除/ })).toBeNull()
    const viewLinkName = '檢視「管線查核」'
    const viewLink = screen.getByRole('link', { name: viewLinkName })
    expect(viewLink).toHaveTextContent('檢視')
    expect(viewLink).toHaveAttribute(
      'href',
      '/projects/project-1/inspection-items/copy-1',
    )
    expect(
      screen.queryByRole('link', { name: '從範本新增查核項目' }),
    ).toBeNull()
  })
})

describe('#435 刪除專案查核項目', () => {
  function LocationProbe() {
    const location = useLocation()
    return (
      <span data-testid="route-state">{JSON.stringify(location.state)}</span>
    )
  }

  function renderItems(
    fetchMock: ReturnType<typeof vi.fn>,
    user = currentUserFixture(),
    permissions = ['project_inspection_item.edit'],
  ) {
    vi.stubGlobal('fetch', fetchMock)
    render(
      <CurrentUserProvider value={{ user, clear: vi.fn() }}>
        <MemoryRouter>
          <LocationProbe />
          <ProjectItemLinks projectId="p1" viewerPermissions={permissions} />
        </MemoryRouter>
      </CurrentUserProvider>,
    )
  }

  function itemList(taskCount = 0) {
    return Response.json({
      items: [
        {
          id: 'i1',
          title: '未使用項目',
          task_count: taskCount,
          inspection_points: [],
          source_template_name: '示範',
          applied_at: '2026-10-22T00:00:00Z',
        },
      ],
      next_cursor: null,
    })
  }

  it('確認後刪除未使用項目並更新清單', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(itemList())
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    renderItems(fetchMock)
    fireEvent.click(
      await screen.findByRole('button', {
        name: '刪除「未使用項目」',
      }),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const box = screen.getByRole('group', { name: '刪除查核項目' })
    expect(box).toHaveTextContent('刪除後無法復原')
    expect(
      within(box).getByText(
        '只有沒有任務引用的項目可以刪除，草稿與已取消任務也算引用。',
      ),
    ).toBeVisible()
    fireEvent.click(within(box).getByRole('button', { name: '確認刪除' }))
    await waitFor(() => expect(screen.queryByText('未使用項目')).toBeNull())
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/projects/p1/inspection-items/i1',
      expect.objectContaining({ method: 'DELETE' }),
    )
    const success = screen.getByRole('status')
    expect(success).toHaveTextContent('已刪除「未使用項目」')
    expect(success.parentElement).toHaveAttribute(
      'aria-labelledby',
      'project-items-heading',
    )
  })

  it('已使用項目被拒時保留項目並提示任務數', async () => {
    renderItems(
      vi
        .fn()
        .mockResolvedValueOnce(itemList(0))
        .mockResolvedValueOnce(
          Response.json(
            {
              error: {
                code: 'project_inspection_item.in_use',
                details: ['2'],
              },
            },
            { status: 409 },
          ),
        ),
    )
    fireEvent.click(
      await screen.findByRole('button', {
        name: '刪除「未使用項目」',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: '確認刪除' }))
    const panel = await screen.findByRole('group', {
      name: '無法刪除查核項目',
    })
    expect(within(panel).getByRole('alert')).toHaveTextContent(
      '已有 2 個任務使用這個項目，為保留查核紀錄不能刪除；草稿與已取消的任務也算。若只是寫錯名稱或標準，請改用『修改』。若都是草稿，到計畫與任務刪除草稿後即可刪除。',
    )
    expect(
      within(panel).queryByRole('button', { name: '確認刪除' }),
    ).toBeNull()
    expect(screen.getByText('使用中（2 個任務）')).toBeInTheDocument()
    expect(screen.getByText('未使用項目')).toBeInTheDocument()
  })

  it('已知使用中的項目直接顯示列內說明而不詢問確認刪除', async () => {
    renderItems(vi.fn().mockResolvedValueOnce(itemList(2)))
    const item = await screen
      .findByText('未使用項目')
      .then((title) => title.closest('li'))
    expect(item).not.toBeNull()
    expect(
      await within(item!).findByText('使用中（2 個任務）'),
    ).toBeInTheDocument()
    fireEvent.click(
      within(item!).getByRole('button', { name: '刪除「未使用項目」' }),
    )

    const panel = within(item!).getByRole('group', {
      name: '無法刪除查核項目',
    })
    expect(within(panel).getByRole('alert')).toHaveTextContent(
      '已有 2 個任務使用這個項目，為保留查核紀錄不能刪除；草稿與已取消的任務也算。若只是寫錯名稱或標準，請改用『修改』。若都是草稿，到計畫與任務刪除草稿後即可刪除。',
    )
    expect(within(panel).getByRole('button', { name: '知道了' })).toBeVisible()
    expect(
      within(panel).getByRole('link', { name: '前往修改' }),
    ).toHaveAttribute('href', '/projects/p1/inspection-items/i1')
    expect(
      within(panel).queryByRole('button', { name: '確認刪除' }),
    ).toBeNull()
    expect(panel.querySelector('[role="alert"]')).toHaveFocus()
    fireEvent.click(within(panel).getByRole('button', { name: '知道了' }))
    expect(within(item!).queryByRole('group')).toBeNull()
    expect(within(item!).getByText('未使用項目')).toBeInTheDocument()
  })

  it('顯示一次範本管理提示，並將修改、刪除放同列次要小按鈕且不顯示秒', async () => {
    renderItems(vi.fn().mockResolvedValueOnce(itemList()))
    const item = await screen
      .findByText('未使用項目')
      .then((title) => title.closest('li'))
    expect(
      screen.getByText(
        '要把項目存回範本庫，需要「管理範本庫」功能，請找系統管理者開通。',
      ),
    ).toBeInTheDocument()
    const actions = within(item!).getByRole('link', {
      name: '修改「未使用項目」',
    }).parentElement
    expect(actions).toHaveClass('project-item-actions')
    expect(
      within(actions!).getByRole('button', { name: '刪除「未使用項目」' }),
    ).toHaveClass('btn-sm')
    expect(
      within(actions!).getByRole('button', { name: '刪除「未使用項目」' }),
    ).not.toHaveClass('btn-danger')
    expect(within(item!).getByText(/套用時間：/)).toHaveTextContent(
      /\d{2}:\d{2}$/,
    )
  })

  it('唯讀清單不顯示編輯者專用的使用中任務數', async () => {
    renderItems(
      vi.fn().mockResolvedValueOnce(itemList(2)),
      currentUserFixture(),
      ['inspection_plan.read'],
    )
    await screen.findByText('未使用項目')
    expect(screen.queryByText('使用中（2 個任務）')).toBeNull()
  })

  it('範本管理員可從項目卡片進入來源已指定的存為範本流程', async () => {
    renderItems(
      vi.fn().mockResolvedValueOnce(itemList()),
      currentUserFixture({ can_manage_template_library: true }),
    )
    const item = await screen
      .findByText('未使用項目')
      .then((title) => title.closest('li'))
    const saveLink = within(item!).getByRole('link', {
      name: '將「未使用項目」存為範本',
    })
    expect(saveLink).toHaveAttribute(
      'href',
      '/projects/p1/inspection-items/templates',
    )
    fireEvent.click(saveLink)
    await waitFor(() =>
      expect(screen.getByTestId('route-state')).toHaveTextContent(
        '"saveItemId":"i1"',
      ),
    )
  })

  it('刪除收到 403 時在確認框提示權限不足並保留項目', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(itemList())
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: 'permission.denied' } },
          { status: 403 },
        ),
      )
    renderItems(fetchMock)
    fireEvent.click(
      await screen.findByRole('button', {
        name: '刪除「未使用項目」',
      }),
    )
    const box = screen.getByRole('group', { name: '刪除查核項目' })
    fireEvent.click(within(box).getByRole('button', { name: '確認刪除' }))

    expect(await within(box).findByRole('alert')).toHaveTextContent(
      '你沒有權限刪除此查核項目。',
    )
    await waitFor(() => expect(within(box).getByRole('alert')).toHaveFocus())
    expect(screen.queryByRole('heading', { name: '無權限' })).toBeNull()
    expect(screen.getByText('未使用項目')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/projects/p1/inspection-items/i1',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('取消刪除不送出請求', async () => {
    const fetchMock = vi.fn().mockResolvedValue(itemList())
    renderItems(fetchMock)
    fireEvent.click(
      await screen.findByRole('button', {
        name: '刪除「未使用項目」',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('group')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
