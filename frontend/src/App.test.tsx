import { act, render, screen } from '@testing-library/react'
import { DataMemoryRouter } from './testing/DataMemoryRouter'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import App from './App'
import type { FieldTask } from './field/api'
import { preloadLazyRoutes } from './testing/preloadRoutes'

// 有指派資料，任務頁才會依 FUI-R02 停在「我的任務」；沒有指派時
// 預設改成「全部」並重掛清單，先抓到的標題節點會被換掉。
const ASSIGNED_TASK: FieldTask = {
  id: 'assigned-task',
  name: '路由測試的指派任務',
  project_id: 'project-1',
  project_name: '示範工程',
  status: 'PENDING',
  dispatched_at: '2026-10-05T08:00:00Z',
  location: { zone_name: '一樓', location_text: '東側' },
  suggested_assignee: { name_zh: '測試使用者' },
  item_summary: { first_title: '外牆鋼筋查核', item_count: 1 },
}

// 加上 RequireAuth 之後，/admin、/field 會先呼叫目前使用者 API
// （AUT-R08）。這裡只驗證路由本身接得到正確的畫面，所以提供一個
// 一律回傳「已登入」的替身，讓兩個測試維持原本只測路由的範圍；
// 未登入時的導向行為由 RequireAuth.test.tsx 驗證。
function stubAuthenticatedFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/auth/me')) {
        return Response.json({
          id: 'u1',
          username: 'user',
          email: 'user@example.com',
          name_en: 'Test User',
          name_zh: '測試使用者',
          is_admin: true,
          must_change_password: false,
          has_office_access: true,
          has_field_access: true,
          can_inspect_tasks: true,
          has_template_access: true,
        })
      }
      if (/\/(users|companies|projects)\?/.test(url)) {
        return Response.json({ items: [], next_cursor: null })
      }
      if (url.includes('/field/inspection-tasks?')) {
        return Response.json({ items: [ASSIGNED_TASK], next_cursor: null })
      }
      return Response.json([])
    }),
  )
}

// 拆包模組的首次載入成本放在 hook，不佔各測試斷言的 1 秒（#295）。
beforeAll(preloadLazyRoutes)

describe('App routing', () => {
  beforeEach(() => {
    stubAuthenticatedFetch()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the admin user management page on /admin', async () => {
    await act(async () => {
      render(
        <DataMemoryRouter initialEntries={['/accounts']}>
          <App />
        </DataMemoryRouter>,
      )
    })

    expect(
      await screen.findByRole('heading', { name: '帳號' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText(`InspectFlow v${__INSPECTFLOW_VERSION__}`),
    ).toBeInTheDocument()
    expect(screen.queryByText('今日任務')).not.toBeInTheDocument()
  })

  it('renders Field tasks on /field', async () => {
    render(
      <DataMemoryRouter initialEntries={['/tasks']}>
        <App />
      </DataMemoryRouter>,
    )

    // 等指派資料出現代表預設範圍已定，標題才是穩定狀態。
    await screen.findByText(ASSIGNED_TASK.name)
    expect(
      screen.getByRole('heading', { name: '我的任務' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText(`InspectFlow v${__INSPECTFLOW_VERSION__}`),
    ).toBeInTheDocument()
    expect(screen.queryByText('帳號')).not.toBeInTheDocument()
  })

  it('returns not found for the removed Field project URL', async () => {
    render(
      <DataMemoryRouter initialEntries={['/field/projects/project-1']}>
        <App />
      </DataMemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: '找不到這個頁面' }),
    ).toBeVisible()
  })

  it('shows the release version on the login page', async () => {
    render(
      <DataMemoryRouter initialEntries={['/login']}>
        <App />
      </DataMemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: '登入' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText(`InspectFlow v${__INSPECTFLOW_VERSION__}`),
    ).toBeInTheDocument()
  })

  it('shows the release version on the first setup page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ setup_required: true })),
    )
    render(
      <DataMemoryRouter initialEntries={['/setup']}>
        <App />
      </DataMemoryRouter>,
    )

    expect(await screen.findByLabelText('首次登入碼')).toBeInTheDocument()
    expect(
      await screen.findByText(`InspectFlow v${__INSPECTFLOW_VERSION__}`),
    ).toBeInTheDocument()
  })
})
