import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CurrentUserProvider } from '../../auth/useCurrentUser'
import { currentUserFixture } from '../../testing/contractFixtures'
import ProjectItemLinks from './ProjectItemLinks'
import { setProjectItemActive } from './api'

const item = {
  id: 'item-717',
  project_id: 'p',
  title: '停用測試項目',
  sequence: 1,
  instruction: '舊任務保留',
  source_template_name: '來源',
  applied_at: '2026-10-25T00:00:00Z',
  inspection_points: [],
  task_count: 2,
  is_active: true,
}

afterEach(() => vi.unstubAllGlobals())

function renderItems(canEdit = true, state?: Record<string, unknown>) {
  return render(
    <CurrentUserProvider
      value={{
        user: currentUserFixture({ is_admin: canEdit }),
        clear: vi.fn(),
      }}
    >
      <MemoryRouter initialEntries={[{ pathname: '/', state }]}>
        <ProjectItemLinks
          projectId="p"
          viewerPermissions={canEdit ? ['project_inspection_item.edit'] : []}
        />
      </MemoryRouter>
    </CurrentUserProvider>,
  )
}

describe('IP-AC23：停用與恢復', () => {
  it('在使用中說明面板就近確認，收合區恢復後重回啟用清單', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          calls.push(url)
          return Response.json({
            ...item,
            is_active: url.endsWith(':activate'),
          })
        }
        return Response.json({ items: [item], next_cursor: null })
      }),
    )
    renderItems()
    fireEvent.click(
      await screen.findByRole('button', { name: `刪除「${item.title}」` }),
    )
    const panel = await screen.findByRole('group', {
      name: '無法刪除查核項目',
    })
    expect(
      within(panel).queryByRole('button', { name: '確認刪除' }),
    ).toBeNull()
    fireEvent.click(
      within(panel).getByRole('button', { name: '停用這個項目' }),
    )
    const confirm = screen.getByRole('group', { name: '停用查核項目' })
    expect(confirm.closest('li')).toHaveTextContent(item.title)
    expect(confirm).toHaveTextContent('既有任務與查核紀錄不受影響')
    expect(calls).toEqual([])
    fireEvent.click(within(confirm).getByRole('button', { name: '取消' }))
    expect(calls).toEqual([])
    expect(
      screen.getByRole('button', { name: `刪除「${item.title}」` }),
    ).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: '停用這個項目' }))
    fireEvent.click(screen.getByRole('button', { name: '確認停用' }))
    const summary = await screen.findByText('已停用（1）')
    const inactive = summary.closest('details')!
    expect(inactive).not.toHaveAttribute('open')
    expect(
      screen.queryByRole('link', { name: `修改「${item.title}」` }),
    ).toBeNull()
    fireEvent.click(summary)
    expect(screen.getByRole('status')).toHaveTextContent(
      `已停用「${item.title}」。`,
    )
    fireEvent.click(
      within(inactive).getByRole('button', { name: `恢復「${item.title}」` }),
    )
    // UDS-R18：開始新的操作就清掉前一次的結果。
    expect(screen.queryByRole('status')).toBeNull()
    expect(calls).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '確認恢復' }))
    expect(
      await screen.findByRole('link', { name: `修改「${item.title}」` }),
    ).toBeVisible()
    await waitFor(() => expect(screen.queryByText('已停用（1）')).toBeNull())
    expect(calls).toEqual([
      '/api/v1/projects/p/inspection-items/item-717:deactivate',
      '/api/v1/projects/p/inspection-items/item-717:activate',
    ])
  })

  it('恢復失敗留在原確認區，唯讀者看不到恢復按鈕', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? Response.json(
              { error: { code: 'permission.denied' } },
              { status: 403 },
            )
          : Response.json({
              items: [{ ...item, is_active: false }],
              next_cursor: null,
            }),
      ),
    )
    const scroll = vi.fn()
    const originalScroll = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scroll
    const view = renderItems()
    const summary = await screen.findByText('已停用（1）')
    fireEvent.click(summary)
    fireEvent.click(
      screen.getByRole('button', { name: `恢復「${item.title}」` }),
    )
    fireEvent.click(screen.getByRole('button', { name: '確認恢復' }))
    const confirm = screen.getByRole('group', { name: '恢復查核項目' })
    expect(await within(confirm).findByRole('alert')).toHaveTextContent(
      '你沒有權限停用或恢復',
    )
    const alert = within(confirm).getByRole('alert')
    await waitFor(() => expect(alert).toHaveFocus())
    expect(scroll).toHaveBeenCalled()
    HTMLElement.prototype.scrollIntoView = originalScroll
    view.unmount()
    renderItems(false)
    fireEvent.click(await screen.findByText('已停用（1）'))
    expect(
      screen.queryByRole('button', { name: `恢復「${item.title}」` }),
    ).toBeNull()
  })

  it('動作 client 沿用 POST 冒號端點，不以 PATCH 任意寫旗標', async () => {
    const fetchMock = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(Response.json(item))
      .mockResolvedValueOnce(Response.json(item))
    vi.stubGlobal('fetch', fetchMock)
    await setProjectItemActive('p', 'item-717', false)
    await setProjectItemActive('p', 'item-717', true)
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([
      'POST',
      'POST',
    ])
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/projects/p/inspection-items/item-717:deactivate',
      '/api/v1/projects/p/inspection-items/item-717:activate',
    ])
  })

  it('停用失敗留在確認區顯示錯誤，項目仍在啟用清單', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? Response.json(
              { error: { code: 'resource.not_found' } },
              { status: 404 },
            )
          : Response.json({ items: [item], next_cursor: null }),
      ),
    )
    renderItems()
    fireEvent.click(
      await screen.findByRole('button', { name: `刪除「${item.title}」` }),
    )
    fireEvent.click(screen.getByRole('button', { name: '停用這個項目' }))
    fireEvent.click(screen.getByRole('button', { name: '確認停用' }))
    const confirm = screen.getByRole('group', { name: '停用查核項目' })
    const alert = await within(confirm).findByRole('alert')
    expect(alert).toHaveTextContent('找不到此查核項目')
    await waitFor(() => expect(alert).toHaveFocus())
    expect(screen.queryByText('已停用（1）')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(
      screen.getByRole('link', { name: `修改「${item.title}」` }),
    ).toBeVisible()
  })

  it('點恢復時清掉前一次的成功提示與存為範本提示（UDS-R18）', async () => {
    const other = { ...item, id: 'item-b', title: '另一個項目', task_count: 0 }
    const inactive = { ...item, is_active: false }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ items: [inactive, other], next_cursor: null }),
      ),
    )
    renderItems(true, {
      savedFromItemId: other.id,
      savedTemplateTitle: '剛存的範本',
      savedTemplateId: 't1',
    })
    expect(await screen.findByText(/已將「剛存的範本」存為範本/)).toBeVisible()
    fireEvent.click(await screen.findByText('已停用（1）'))
    fireEvent.click(
      screen.getByRole('button', { name: `恢復「${item.title}」` }),
    )
    expect(screen.queryByText(/已將「剛存的範本」存為範本/)).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
