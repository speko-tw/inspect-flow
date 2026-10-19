// 網址裡的 id 無效或不存在、子路徑不存在時顯示找不到頁面（#493）。
// 用完整的 `App` 與路由驗證，後端以 fetch 替身模擬：格式不對的 id 回 422、
// 不存在的回 404、無權限的回 403（無權限頁維持原樣）。

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
  can_inspect_tasks: false,
  has_template_access: false,
})
const ADMIN = {
  ...BASE,
  is_admin: true,
  has_office_access: true,
  has_field_access: true,
  can_inspect_tasks: true,
  has_template_access: true,
}
const OFFICE = {
  ...BASE,
  has_office_access: true,
  has_project_access: true,
}
const FIELD = { ...BASE, has_field_access: true, can_inspect_tasks: true }
const BOTH = {
  ...BASE,
  has_office_access: true,
  has_project_access: true,
  has_field_access: true,
  can_inspect_tasks: true,
}

const SUMMARY = {
  project: {
    id: 'project-a',
    project_code: 'DEMO-A',
    name: '示範工程甲',
    company_role: 'contractor',
  },
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
let requests: string[] = []

function stubBackend(me: typeof BASE | null) {
  requests = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const { pathname } = new URL(String(input), 'http://testserver')
      requests.push(pathname)
      if (pathname.endsWith('/setup/status')) {
        return Response.json({ setup_required: false })
      }
      if (pathname.endsWith('/auth/me')) {
        return me ? Response.json(me) : new Response(null, { status: 401 })
      }
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

async function renderApp(path: string) {
  let result: ReturnType<typeof render>
  await act(async () => {
    result = render(
      <DataMemoryRouter initialEntries={[path]}>
        <App />
      </DataMemoryRouter>,
    )
  })
  return result!
}

function expectNoLegacyMessage() {
  expect(screen.queryByText('資料格式不正確，請檢查輸入內容。')).toBeNull()
}

beforeAll(preloadLazyRoutes)
beforeEach(resetSessionMemory)
afterEach(() => vi.unstubAllGlobals())

describe('專案網址的 id 無效或不存在', () => {
  it.each([
    ['系統管理者', ADMIN, '/overview'],
    ['內業', OFFICE, '/projects'],
  ] as const)(
    '%s：專案首頁 id 格式不對（422）顯示找不到並可回首頁',
    async (_name, user, home) => {
      stubBackend(user)
      await renderApp('/projects/bad')

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
      expect(screen.queryByRole('link', { name: '返回專案清單' })).toBeNull()
    },
  )

  it('專案首頁 id 不存在（404）顯示找不到並可回首頁', async () => {
    stubBackend(OFFICE)
    await renderApp('/projects/gone')

    expect(
      await screen.findByRole('heading', { name: '找不到這個專案' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '回首頁' })).toHaveAttribute(
      'href',
      '/projects',
    )
  })

  it.each(['members', 'inspection-items', 'planning'])(
    '專案的 %s 頁：id 無效或不存在時顯示找不到',
    async (section) => {
      stubBackend(OFFICE)
      const first = await renderApp(`/projects/bad/${section}`)
      expect(
        await screen.findByRole('heading', { name: '找不到這個專案' }),
      ).toBeVisible()
      expectNoLegacyMessage()
      first.unmount()

      await renderApp(`/projects/gone/${section}`)
      expect(
        await screen.findByRole('heading', { name: '找不到這個專案' }),
      ).toBeVisible()
      expect(screen.getByRole('link', { name: '回首頁' })).toBeVisible()
    },
  )

  it('套用範本頁：專案 id 無效時顯示找不到', async () => {
    stubBackend(ADMIN)
    await renderApp('/projects/bad/inspection-items/templates')

    expect(
      await screen.findByRole('heading', { name: '找不到這個專案' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '回首頁' })).toHaveAttribute(
      'href',
      '/overview',
    )
  })

  it('查核項目 id 不存在時顯示找不到，專案頁框仍在', async () => {
    stubBackend(OFFICE)
    await renderApp('/projects/project-a/inspection-items/abc123')

    expect(
      await screen.findByRole('heading', { name: '找不到這個查核項目' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '回首頁' })).toHaveAttribute(
      'href',
      '/projects',
    )
    expect(
      screen.getByRole('heading', { name: 'DEMO-A｜示範工程甲' }),
    ).toBeVisible()
  })

  it('無權限（403）仍顯示無權限頁，不改成找不到', async () => {
    stubBackend(OFFICE)
    await renderApp('/projects/nope')

    expect(
      await screen.findByRole('heading', { name: '無權限' }),
    ).toBeVisible()
    expect(screen.queryByRole('heading', { name: /^找不到/ })).toBeNull()
  })
})

describe('不存在的子路徑', () => {
  it.each([
    ['系統管理者', ADMIN, '/overview'],
    ['內業', OFFICE, '/projects'],
  ] as const)(
    '%s：專案底下不存在的子路徑顯示找不到並可回首頁',
    async (_name, user, home) => {
      stubBackend(user)
      await renderApp('/projects/project-a/abc123')

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
    await renderApp('/projects/project-a/members/abc123')

    expect(
      await screen.findByRole('heading', { name: '找不到這個頁面' }),
    ).toBeVisible()
  })

  it('管理頁不存在的路徑顯示找不到', async () => {
    stubBackend(ADMIN)
    await renderApp('/admin/abc123')

    expect(
      await screen.findByRole('heading', { name: '找不到這個頁面' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '回首頁' })).toBeVisible()
  })

  it.each(['/accounts', '/accounts/user-1'])(
    '非管理者開帳號頁仍顯示無權限：%s',
    async (path) => {
      stubBackend(OFFICE)
      await renderApp(path)

      expect(
        await screen.findByRole('heading', { name: '無權限' }),
      ).toBeVisible()
    },
  )

  it('尚未正式發布的舊管理路徑顯示找不到，不導向新頁', async () => {
    stubBackend(ADMIN)
    await renderApp('/admin/users')

    expect(
      await screen.findByRole('heading', { name: '找不到這個頁面' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: '帳號', level: 1 }),
    ).toBeNull()
  })

  it('舊的 /field 底下路徑顯示找不到', async () => {
    stubBackend(FIELD)
    await renderApp('/field/abc123')

    expect(
      await screen.findByRole('heading', { name: '找不到這個頁面' }),
    ).toBeVisible()
  })
})

describe('任務 id 無效或不存在', () => {
  it.each([
    ['格式不對（422）', 'bad'],
    ['不存在（404）', 'gone'],
  ])('現場帳號：任務 id %s 顯示找不到，可回首頁', async (_n, id) => {
    stubBackend(FIELD)
    await renderApp(`/tasks/${id}`)

    expect(
      await screen.findByRole('heading', { name: '找不到這筆任務' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '回首頁' })).toHaveAttribute(
      'href',
      '/tasks',
    )
  })

  it('同時有內業權限的帳號：找不到任務時回首頁連到落點', async () => {
    stubBackend(BOTH)
    await renderApp('/tasks/bad')

    expect(
      await screen.findByRole('heading', { name: '找不到這筆任務' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '回首頁' })).toHaveAttribute(
      'href',
      '/projects',
    )
  })
})

describe('舊產品網址不再轉址', () => {
  it.each([
    '/admin',
    '/admin/projects',
    '/admin/projects/project-1/templates',
    '/field',
    '/field/tasks',
    '/field/projects/project-1',
    '/change-password',
    '/change-password/reset',
  ])('%s 顯示找不到頁面', async (path) => {
    stubBackend(ADMIN)
    await renderApp(path)

    expect(
      await screen.findByRole('heading', { name: '找不到這個頁面' }),
    ).toBeVisible()
  })

  it.each([
    '/admin',
    '/admin/projects',
    '/field',
    '/field/tasks',
    '/change-password',
  ])('未登入：%s 回 404，不呼叫資料 API', async (path) => {
    stubBackend(null)
    await renderApp(path)

    expect(
      await screen.findByRole('heading', { name: '找不到這個頁面' }),
    ).toBeVisible()
    expect(screen.queryByRole('heading', { name: '登入' })).toBeNull()
    expect(
      requests.filter(
        (request) =>
          !request.endsWith('/setup/status') && !request.endsWith('/auth/me'),
      ),
    ).toEqual([])
  })
})
