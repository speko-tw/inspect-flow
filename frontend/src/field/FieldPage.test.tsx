import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
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
const DETAIL = {
  ...TASK,
  item_summary: undefined,
  suggested_assignee: { name_zh: '示範查核員', is_me: true },
  started_by: null,
  cancellation_reason: null,
  items: [
    {
      title: '外牆鋼筋查核',
      instruction: '依圖面查核',
      inspection_points: [],
    },
  ],
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{JSON.stringify(location)}</div>
}

function renderPage(
  options: { user?: Partial<CurrentUser>; state?: unknown } = {},
) {
  nextUser += 1
  const user: CurrentUser = {
    id: `user-${nextUser}`,
    username: 'inspector',
    name_zh: '示範查核員',
    name_en: null,
    email: null,
    is_admin: false,
    must_change_password: false,
    has_office_access: false,
    has_field_access: true,
    has_template_access: false,
  }
  const clear = vi.fn()
  const currentUser = { ...user, ...options.user }
  const view = render(
    <MemoryRouter
      initialEntries={[{ pathname: '/field/', state: options.state }]}
    >
      <CurrentUserProvider value={{ user: currentUser, clear }}>
        <LocationProbe />
        <Routes>
          <Route path="/field/*" element={<FieldPage />} />
          <Route path="/change-password" element={<p>密碼頁</p>} />
        </Routes>
      </CurrentUserProvider>
    </MemoryRouter>,
  )
  return { ...view, clear }
}

afterEach(() => vi.unstubAllGlobals())

describe('今日任務首頁', () => {
  it('顯示任務入口與個人資料，且沒有範本入口', async () => {
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

    expect(
      await screen.findByRole('heading', { name: '今日任務' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '變更密碼' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '登出' })).toBeInTheDocument()
    expect(screen.getByText('我的資料')).toBeInTheDocument()
    expect(screen.queryByText(/範本/)).not.toBeInTheDocument()
  })

  it('兩種權限都有的帳號可從現場頁回我的專案；純現場沒有（#480）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ items: [], next_cursor: null })),
    )
    const mixed = renderPage({ user: { has_office_access: true } })
    expect(
      await screen.findByRole('link', { name: '我的專案' }),
    ).toHaveAttribute('href', '/admin/projects')
    mixed.unmount()
    renderPage()
    await screen.findByRole('heading', { name: '今日任務' })
    expect(screen.queryByRole('link', { name: '我的專案' })).toBeNull()
  })

  it('範本管理權限在頂端列與無權限區塊各有入口，兩種權限都有就都顯示（#480）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { code: 'permission.denied' } },
          { status: 403 },
        ),
      ),
    )
    renderPage({
      user: {
        has_field_access: false,
        has_office_access: true,
        has_template_access: true,
      },
    })

    expect(
      await screen.findByRole('link', { name: '前往我的專案' }),
    ).toHaveAttribute('href', '/admin/projects')
    expect(screen.getByRole('link', { name: '前往範本管理' })).toHaveAttribute(
      'href',
      '/admin/templates',
    )
    expect(screen.getByRole('link', { name: '我的專案' })).toBeVisible()
    expect(screen.getByRole('link', { name: '範本管理' })).toBeVisible()
  })

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
      if (url.includes('/field/inspection-tasks/task-1')) {
        return Response.json(DETAIL)
      }
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
    expect(await screen.findByText('依圖面查核')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: /返回任務/ }))
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
    expect(fetcher).toHaveBeenCalledTimes(5)
  })

  it('切回曾看過的篩選組合會重抓第一頁', async () => {
    let currentStatus: FieldTask['status'] = 'PENDING'
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      return Response.json({
        items:
          url.includes('status=PENDING') && currentStatus !== 'PENDING'
            ? []
            : [{ ...TASK, status: currentStatus }],
        next_cursor: null,
      })
    })
    vi.stubGlobal('fetch', fetcher)
    renderPage()
    await screen.findByText('外牆鋼筋查核 等 2 項')
    fireEvent.click(screen.getByRole('button', { name: '待開始' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    currentStatus = 'IN_PROGRESS'
    fireEvent.click(screen.getByRole('button', { name: '所有狀態' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    expect(screen.getByText('外牆鋼筋查核 等 2 項').closest('a')).toHaveClass(
      'progress',
    )
    fireEvent.click(screen.getByRole('button', { name: '待開始' }))
    expect(await screen.findByText('目前沒有符合的任務')).toBeInTheDocument()
    expect(screen.queryByText('外牆鋼筋查核 等 2 項')).not.toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(String(fetcher.mock.calls[3][0])).toContain('status=PENDING')
    expect(String(fetcher.mock.calls[3][0])).not.toContain('cursor=')
  })

  it('下一頁失敗只重試該 cursor，保留已載入卡片', async () => {
    let nextPageAttempts = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).includes('cursor=next')) {
        return Response.json({ items: [TASK], next_cursor: 'next' })
      }
      nextPageAttempts += 1
      return nextPageAttempts === 1
        ? Response.json({ error: { code: 'server.error' } }, { status: 500 })
        : Response.json({
            items: [
              {
                ...TASK,
                id: 'task-2',
                item_summary: { first_title: '第二項目', item_count: 1 },
              },
            ],
            next_cursor: null,
          })
    })
    vi.stubGlobal('fetch', fetcher)
    renderPage()
    await screen.findByText('外牆鋼筋查核 等 2 項')
    fireEvent.click(screen.getByRole('button', { name: '載入更多' }))
    expect(await screen.findByText('無法載入任務')).toBeInTheDocument()
    expect(screen.getByText('外牆鋼筋查核 等 2 項')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重試' }))
    expect(await screen.findByText('第二項目')).toBeInTheDocument()
    expect(screen.getByText('外牆鋼筋查核 等 2 項')).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(String(fetcher.mock.calls[1][0])).toContain('cursor=next')
    expect(String(fetcher.mock.calls[2][0])).toContain('cursor=next')
  })

  it('卡片正確處理空標題、單項、無分區與進行中', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          items: [
            {
              ...TASK,
              item_summary: { first_title: null, item_count: 0 },
              location: { zone_name: null, location_text: '東側' },
            },
            {
              ...TASK,
              id: 'task-2',
              status: 'IN_PROGRESS',
              item_summary: { first_title: '單一查核項目', item_count: 1 },
            },
          ],
          next_cursor: null,
        }),
      ),
    )
    renderPage()
    const fallback = await screen.findByText('查核任務')
    const firstCard = fallback.closest('a')
    expect(firstCard).not.toBeNull()
    expect(within(firstCard!).queryByText(/分區：/)).not.toBeInTheDocument()
    const secondCard = screen.getByText('單一查核項目').closest('a')
    expect(secondCard).toHaveClass('progress')
    expect(within(secondCard!).getByText('進行中')).toBeInTheDocument()
    expect(screen.queryByText('單一查核項目 等 1 項')).not.toBeInTheDocument()
  })

  it('保留密碼入口、來源 state 提示、登出與個人資料空值', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/auth/logout')
        ? Response.json({})
        : Response.json({ items: [], next_cursor: null }),
    )
    vi.stubGlobal('fetch', fetcher)
    const { clear } = renderPage({
      user: { name_zh: null, name_en: null, email: null },
      state: { notice: '密碼已更新。' },
    })
    expect(await screen.findByText('目前沒有符合的任務')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('密碼已更新。')
    expect(screen.getByRole('link', { name: '變更密碼' })).toHaveAttribute(
      'href',
      '/change-password',
    )
    const profile = screen.getByText('我的資料').closest('details')
    expect(profile).not.toBeNull()
    expect(within(profile!).getByText('中文姓名：—')).toBeInTheDocument()
    expect(within(profile!).getByText('英文姓名：—')).toBeInTheDocument()
    expect(within(profile!).getByText('Email：—')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '登出' }))
    await waitFor(() => expect(clear).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('link', { name: '變更密碼' }))
    expect(screen.getByTestId('location')).toHaveTextContent(
      '"from":"/field/"',
    )
    expect(screen.getByText('密碼頁')).toBeInTheDocument()
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

  it('沒有現場權限但有內業權限時，提供前往我的專案（#480）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { code: 'permission.denied' } },
          { status: 403 },
        ),
      ),
    )
    renderPage({
      user: { has_office_access: true, has_field_access: false },
    })

    const link = await screen.findByRole('link', { name: '前往我的專案' })
    expect(link).toHaveAttribute('href', '/admin/projects')
    expect(link).toHaveClass('button-link')
  })

  it('沒有現場權限也沒有內業權限時，只有說明沒有入口（#480）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { code: 'permission.denied' } },
          { status: 403 },
        ),
      ),
    )
    renderPage({ user: { has_field_access: false } })

    expect(await screen.findByText('目前無法查看現場任務')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: '前往我的專案' }),
    ).not.toBeInTheDocument()
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

describe('開始查核後返回清單', () => {
  const STARTED = {
    ...DETAIL,
    status: 'IN_PROGRESS',
    started_by: { name_zh: '示範查核員', is_me: true },
  }

  /** 詳情依序回傳 `details`（先看到待開始，開始後才是最新狀態）。 */
  function listFetcher(
    onStart: () => Response,
    details: Array<Record<string, unknown>>,
  ) {
    let detailCalls = 0
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') return onStart()
      if (url.includes('/field/inspection-tasks/task-1')) {
        const next = details[Math.min(detailCalls, details.length - 1)]
        detailCalls += 1
        return Response.json(next)
      }
      const second = {
        ...TASK,
        id: 'task-2',
        item_summary: { first_title: '第二查核項目', item_count: 1 },
      }
      return Response.json({
        items: url.includes('status=PENDING') ? [TASK] : [TASK, second],
        next_cursor: null,
      })
    })
  }

  async function startFirstCard() {
    fireEvent.click(screen.getAllByRole('link', { name: /查看任務/ })[0])
    fireEvent.click(await screen.findByRole('button', { name: '開始查核' }))
    fireEvent.click(screen.getByRole('button', { name: '確認開始查核' }))
  }

  it('成功開始：所有狀態的卡片改為進行中，保留篩選與捲動', async () => {
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollY', 120)
    vi.stubGlobal('scrollTo', scrollTo)
    const fetcher = listFetcher(
      () => Response.json({ id: 'task-1', status: 'IN_PROGRESS' }),
      [DETAIL, STARTED],
    )
    vi.stubGlobal('fetch', fetcher)
    renderPage()
    await screen.findByText('外牆鋼筋查核 等 2 項')
    fireEvent.click(screen.getByRole('button', { name: '全部' }))
    await screen.findByText('第二查核項目')
    await startFirstCard()
    expect(await screen.findByText('查核進行中')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: /返回任務/ }))
    const cards = await screen.findAllByRole('link', { name: /查看任務/ })
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveClass('progress')
    expect(within(cards[0]).getByText('進行中')).toBeInTheDocument()
    expect(cards[1]).not.toHaveClass('progress')
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 120))
    // 列表來自記憶，沒有重抓：只有兩次列表請求。
    const listCalls = fetcher.mock.calls.filter(
      ([input, init]) =>
        !init?.method && !String(input).includes('inspection-tasks/task-1'),
    )
    expect(listCalls).toHaveLength(2)
  })

  it('待開始篩選：開始成功後該筆不再出現在待開始清單', async () => {
    vi.stubGlobal('scrollTo', vi.fn())
    vi.stubGlobal(
      'fetch',
      listFetcher(
        () => Response.json({ id: 'task-1', status: 'IN_PROGRESS' }),
        [DETAIL, STARTED],
      ),
    )
    renderPage()
    await screen.findByText('外牆鋼筋查核 等 2 項')
    fireEvent.click(screen.getByRole('button', { name: '待開始' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '待開始' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
    await startFirstCard()
    await screen.findByText('查核進行中')
    fireEvent.click(screen.getByRole('link', { name: /返回任務/ }))
    expect(await screen.findByText('目前沒有符合的任務')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '待開始' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('取消競態失敗：返回後清單不再出現該筆，其他卡片保留', async () => {
    vi.stubGlobal('scrollTo', vi.fn())
    vi.stubGlobal(
      'fetch',
      listFetcher(
        () =>
          Response.json(
            { error: { code: 'inspection_task.invalid_transition' } },
            { status: 409 },
          ),
        [
          DETAIL,
          {
            ...DETAIL,
            status: 'CANCELLED',
            cancellation_reason: '施工順序調整',
          },
        ],
      ),
    )
    renderPage()
    await screen.findByText('外牆鋼筋查核 等 2 項')
    fireEvent.click(screen.getByRole('button', { name: '全部' }))
    await screen.findByText('第二查核項目')
    await startFirstCard()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '取消原因：施工順序調整。',
    )
    fireEvent.click(screen.getAllByRole('link', { name: /返回任務/ })[0])
    expect(await screen.findByText('第二查核項目')).toBeInTheDocument()
    expect(screen.queryByText('外牆鋼筋查核 等 2 項')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
