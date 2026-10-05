import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CurrentUser } from '../auth/api'
import { CurrentUserProvider } from '../auth/useCurrentUser'
import FieldPage from './FieldPage'
import type { FieldTask } from './api'

let nextUser = 0
const TASK: FieldTask = {
  id: 'task-1',
  project_id: 'project-1',
  project_name: '示範工程甲',
  status: 'PENDING',
  dispatched_at: '2026-10-05T08:00:00Z',
  location: { zone_name: '一樓', location_text: '東側' },
  suggested_assignee: { name_zh: '示範查核員' },
  item_summary: { first_title: '外牆鋼筋查核', item_count: 2 },
}

function renderPage() {
  nextUser += 1
  const user: CurrentUser = {
    id: `user-${nextUser}`,
    username: 'inspector',
    name_zh: '示範查核員',
    name_en: null,
    email: null,
    is_admin: false,
    must_change_password: false,
  }
  return render(
    <MemoryRouter initialEntries={['/field/']}>
      <CurrentUserProvider value={{ user, clear: vi.fn() }}>
        <Routes>
          <Route path="/field/*" element={<FieldPage />} />
        </Routes>
      </CurrentUserProvider>
    </MemoryRouter>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('今日任務首頁', () => {
  it('預設查本人，切換範圍與狀態會傳後端參數', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('/api/v1/field/inspection-tasks')
      return Response.json({
        items: [TASK],
        next_cursor: null,
      })
    })
    vi.stubGlobal('fetch', fetcher)
    renderPage()
    expect(await screen.findByText('外牆鋼筋查核 等 2 項')).toBeInTheDocument()
    expect(screen.getByText('分區：一樓')).toBeInTheDocument()
    expect(String(fetcher.mock.calls[0][0])).toContain('assigned_to_me=true')
    fireEvent.click(screen.getByRole('button', { name: '全部' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(String(fetcher.mock.calls[1][0])).toContain('assigned_to_me=false')
    fireEvent.click(screen.getByRole('button', { name: '待開始' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    expect(String(fetcher.mock.calls[2][0])).toContain('status=PENDING')
  })

  it('載入更多使用 cursor，返回保留篩選、頁數與卡片', async () => {
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollY', 240)
    vi.stubGlobal('scrollTo', scrollTo)
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      return Response.json(
        url.includes('cursor=next')
          ? {
              items: [
                {
                  ...TASK,
                  id: 'task-2',
                  item_summary: { first_title: '第二查核項目', item_count: 1 },
                },
              ],
              next_cursor: null,
            }
          : { items: [TASK], next_cursor: 'next' },
      )
    })
    vi.stubGlobal('fetch', fetcher)
    renderPage()
    await screen.findByText('外牆鋼筋查核 等 2 項')
    fireEvent.click(screen.getByRole('button', { name: '全部' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: '待開始' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    fireEvent.click(screen.getByRole('button', { name: '載入更多' }))
    expect(await screen.findByText('第二查核項目')).toBeInTheDocument()
    expect(String(fetcher.mock.calls[3][0])).toContain('cursor=next')
    fireEvent.click(screen.getAllByRole('link', { name: /查看任務/ })[0])
    expect(
      await screen.findByText('任務詳情頁建置中，請返回任務清單。'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: '返回任務' }))
    expect(await screen.findByText('第二查核項目')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: '待開始' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 240))
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('有權限但無任務時顯示空狀態', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          items: [],
          next_cursor: null,
        }),
      ),
    )
    renderPage()
    expect(await screen.findByText('目前沒有符合的任務')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '查看全部任務' }),
    ).toBeInTheDocument()
  })

  it('403 與一般錯誤分開顯示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          {
            error: { code: 'permission.denied' },
          },
          { status: 403 },
        ),
      ),
    )
    const page = renderPage()
    expect(await screen.findByText('目前無法查看現場任務')).toBeInTheDocument()
    expect(screen.queryByText('目前沒有符合的任務')).not.toBeInTheDocument()
    page.unmount()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          {
            error: { code: 'server.internal_error' },
          },
          { status: 500 },
        ),
      ),
    )
    renderPage()
    expect(await screen.findByText('無法載入任務')).toBeInTheDocument()
  })

  it('拒絕不符合 Field 列表契約的回應', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json([{ id: 'old-workspace' }])),
    )
    renderPage()
    expect(await screen.findByText('無法載入任務')).toBeInTheDocument()
    expect(screen.queryByText('目前沒有符合的任務')).not.toBeInTheDocument()
  })
})
