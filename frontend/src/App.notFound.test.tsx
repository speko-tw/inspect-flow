// 網址裡的 id 無效或不存在、子路徑不存在時顯示找不到頁面（#493）。
// 用完整的 `App` 與路由驗證，後端以 fetch 替身模擬：格式不對的 id 回 422、
// 不存在的回 404、無權限的回 403（無權限頁維持原樣）。

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
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
import { resetSessionMemory } from './auth/sessionMemory'
import { currentUserFixture } from './testing/contractFixtures'
import { preloadLazyRoutes } from './testing/preloadRoutes'

const BASE = currentUserFixture({
  id: 'user-1',
  username: 'demo',
  name_zh: '示範使用者',
  is_admin: false,
  has_office_access: false,
  has_field_access: false,
  has_template_access: false,
})
const ADMIN = {
  ...BASE,
  is_admin: true,
  has_office_access: true,
  has_field_access: true,
  has_template_access: true,
}
const OFFICE = { ...BASE, has_office_access: true }
const FIELD = { ...BASE, has_field_access: true }
const BOTH = { ...BASE, has_office_access: true, has_field_access: true }

const SUMMARY = {
  project: { id: 'project-a', project_code: 'DEMO-A', name: '示範工程甲' },
  viewer_permission_codes: [
    'project_member.manage',
    'project_inspection_item.edit',
    'inspection_plan.read',
  ],
  member_count: 1,
  inspection_item_count: 0,
  zone_count: 0,
  plan_count: 0,
  task_counts: {
    DRAFT: 0,
    PENDING: 0,
    IN_PROGRESS: 0,
    COMPLETED: 0,
    CANCELLED: 0,
  },
  task_counts_visible: true,
  pending_reinspection_task_count: 0,
  draft_tasks_missing_assignee: 0,
  primary_step: null,
  next_steps: [],
}

const VALIDATION_FAILED = { error: { code: 'request.validation_failed' } }
const NOT_FOUND = { error: { code: 'resource.not_found' } }
const DENIED = { error: { code: 'permission.denied' } }

/** 依 id 決定專案與任務的回應：bad＝格式不對、gone＝不存在、nope＝無權限。 */
function stubBackend(me: typeof BASE) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const { pathname } = new URL(String(input), 'http://testserver')
      if (pathname.endsWith('/setup/status')) {
        return Response.json({ setup_required: false })
      }
      if (pathname.endsWith('/auth/me')) return Response.json(me)
      const project = pathname.match(/\/projects\/([^/]+)\//)?.[1]
      if (project === 'bad') {
        return Response.json(VALIDATION_FAILED, { status: 422 })
      }
      if (project === 'gone') return Response.json(NOT_FOUND, { status: 404 })
      if (project === 'nope') return Response.json(DENIED, { status: 403 })
      const task = pathname.match(/\/field\/inspection-tasks\/([^/]+)$/)?.[1]
      if (task === 'bad') {
        return Response.json(VALIDATION_FAILED, { status: 422 })
      }
      if (task === 'gone') return Response.json(NOT_FOUND, { status: 404 })
      if (pathname.endsWith('/workflow-summary')) {
        return Response.json(SUMMARY)
      }
      if (pathname.includes('/field/inspection-tasks')) {
        return Response.json({ items: [], next_cursor: null })
      }
      if (pathname.endsWith('/inspection-items')) {
        return Response.json({ items: [], next_cursor: null })
      }
      return Response.json([])
    }),
  )
}

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

function expectNoLegacyMessage() {
  expect(screen.queryByText('資料格式不正確，請檢查輸入內容。')).toBeNull()
}

beforeAll(preloadLazyRoutes)
beforeEach(resetSessionMemory)
afterEach(() => vi.unstubAllGlobals())

describe('專案網址的 id 無效或不存在', () => {
  it.each([
    ['系統管理者', ADMIN, '/admin'],
    ['內業', OFFICE, '/admin/projects'],
  ] as const)(
    '%s：專案首頁 id 格式不對（422）顯示找不到並可回首頁',
    async (_name, user, home) => {
      stubBackend(user)
      renderApp('/admin/projects/bad')

      expect(
        await screen.findByRole('heading', { name: '找不到這個專案' }),
      ).toBeVisible()
      expect(screen.getByRole('link', { name: '回首頁' })).toHaveAttribute(
        'href',
        home,
      )
      expectNoLegacyMessage()
      // 不留空的專案頁框。
      expect(screen.queryByRole('navigation', { name: '專案區段' })).toBeNull()
      expect(screen.queryByRole('link', { name: '回專案清單' })).toBeNull()
    },
  )

  it('專案首頁 id 不存在（404）顯示找不到並可回首頁', async () => {
    stubBackend(OFFICE)
    renderApp('/admin/projects/gone')

    expect(
      await screen.findByRole('heading', { name: '找不到這個專案' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '回首頁' })).toHaveAttribute(
      'href',
      '/admin/projects',
    )
  })

  it.each(['members', 'inspection-items', 'planning'])(
    '專案的 %s 頁：id 無效或不存在時顯示找不到',
    async (section) => {
      stubBackend(OFFICE)
      const first = renderApp(`/admin/projects/bad/${section}`)
      expect(
        await screen.findByRole('heading', { name: '找不到這個專案' }),
      ).toBeVisible()
      expectNoLegacyMessage()
      first.unmount()

      renderApp(`/admin/projects/gone/${section}`)
      expect(
        await screen.findByRole('heading', { name: '找不到這個專案' }),
      ).toBeVisible()
      expect(screen.getByRole('link', { name: '回首頁' })).toBeVisible()
    },
  )

  it('套用範本頁：專案 id 無效時顯示找不到', async () => {
    stubBackend(ADMIN)
    renderApp('/admin/projects/bad/templates')

    expect(
      await screen.findByRole('heading', { name: '找不到這個專案' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '回首頁' })).toHaveAttribute(
      'href',
      '/admin',
    )
  })

  it('查核項目 id 不存在時顯示找不到，專案頁框仍在', async () => {
    stubBackend(OFFICE)
    renderApp('/admin/projects/project-a/inspection-items/abc123')

    expect(
      await screen.findByRole('heading', { name: '找不到這個查核項目' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '回首頁' })).toHaveAttribute(
      'href',
      '/admin/projects',
    )
    expect(
      screen.getByRole('heading', { name: 'DEMO-A｜示範工程甲' }),
    ).toBeVisible()
  })

  it('無權限（403）仍顯示無權限頁，不改成找不到', async () => {
    stubBackend(OFFICE)
    renderApp('/admin/projects/nope')

    expect(
      await screen.findByRole('heading', { name: '無權限' }),
    ).toBeVisible()
    expect(screen.queryByRole('heading', { name: /^找不到/ })).toBeNull()
  })
})

describe('不存在的子路徑', () => {
  it.each([
    ['系統管理者', ADMIN, '/admin'],
    ['內業', OFFICE, '/admin/projects'],
  ] as const)(
    '%s：專案底下不存在的子路徑顯示找不到並可回首頁',
    async (_name, user, home) => {
      stubBackend(user)
      renderApp('/admin/projects/project-a/abc123')

      expect(
        await screen.findByRole('heading', { name: '找不到這個頁面' }),
      ).toBeVisible()
      expect(screen.getByRole('link', { name: '回首頁' })).toHaveAttribute(
        'href',
        home,
      )
    },
  )

  it('專案已有的區段再往下接亂碼也顯示找不到', async () => {
    stubBackend(OFFICE)
    renderApp('/admin/projects/project-a/members/abc123')

    expect(
      await screen.findByRole('heading', { name: '找不到這個頁面' }),
    ).toBeVisible()
  })

  it('管理頁不存在的路徑顯示找不到', async () => {
    stubBackend(ADMIN)
    renderApp('/admin/abc123')

    expect(
      await screen.findByRole('heading', { name: '找不到這個頁面' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '回首頁' })).toBeVisible()
  })

  it('非管理者開管理者專用頁仍顯示無權限', async () => {
    stubBackend(OFFICE)
    renderApp('/admin/users')

    expect(
      await screen.findByRole('heading', { name: '無權限' }),
    ).toBeVisible()
  })

  it('現場帳號：/field 底下不存在的路徑顯示找不到，回首頁回任務清單', async () => {
    stubBackend(FIELD)
    renderApp('/field/abc123')

    expect(
      await screen.findByRole('heading', { name: '找不到這個頁面' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '回首頁' })).toHaveAttribute(
      'href',
      '/field',
    )
  })
})

describe('任務 id 無效或不存在', () => {
  it.each([
    ['格式不對（422）', 'bad'],
    ['不存在（404）', 'gone'],
  ])('現場帳號：任務 id %s 顯示找不到，可回首頁', async (_n, id) => {
    stubBackend(FIELD)
    renderApp(`/field/tasks/${id}`)

    expect(
      await screen.findByRole('heading', { name: '找不到這筆任務' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '回首頁' })).toHaveAttribute(
      'href',
      '/field',
    )
  })

  it('同時有內業權限的帳號：找不到任務時回首頁連到落點', async () => {
    stubBackend(BOTH)
    renderApp('/field/tasks/bad')

    expect(
      await screen.findByRole('heading', { name: '找不到這筆任務' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '回首頁' })).toHaveAttribute(
      'href',
      '/admin/projects',
    )
  })
})
