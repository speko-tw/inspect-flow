// 路由參數格式守衛（#618 F-S01）：特製網址不能讓請求打到別的端點。
// 用完整的 `App` 與路由驗證，fetch 替身記錄所有請求。

import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
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
import { CurrentUserProvider } from './auth/useCurrentUser'
import RequireValidRouteIds from './RequireValidRouteIds'
import { isResourceId } from './resourceId'
import { currentUserFixture } from './testing/contractFixtures'
import { preloadLazyRoutes } from './testing/preloadRoutes'

const ADMIN = currentUserFixture({
  id: 'user-1',
  username: 'demo',
  name_zh: '示範使用者',
  is_admin: true,
  has_office_access: true,
  has_field_access: true,
  has_template_access: true,
})
const OFFICE = { ...ADMIN, is_admin: false, has_template_access: false }

// 解碼後是 `../companies?`：若原樣拼進 API 路徑，會打到公司端點。
const EVIL = '..%2Fcompanies%3F'

let requests: string[] = []

function stubBackend(me: typeof ADMIN) {
  requests = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const { pathname } = new URL(String(input), 'http://testserver')
      requests.push(pathname)
      if (pathname.endsWith('/setup/status')) {
        return Response.json({ setup_required: false })
      }
      if (pathname.endsWith('/auth/me')) return Response.json(me)
      return Response.json([])
    }),
  )
}

async function renderApp(path: string) {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    )
  })
}

/** 登入檢查之外的 API 請求；守衛生效時應為空。 */
function dataRequests() {
  return requests.filter(
    (path) => !path.endsWith('/setup/status') && !path.endsWith('/auth/me'),
  )
}

beforeAll(preloadLazyRoutes)
beforeEach(resetSessionMemory)
afterEach(() => vi.unstubAllGlobals())

describe('isResourceId', () => {
  it.each([
    'project-1',
    '3f2b8c1e-5d4a-4f6b-9c7d-1a2b3c4d5e6f',
    'a',
    '7',
    'a'.repeat(64),
  ])('接受 %s', (value) => {
    expect(isResourceId(value)).toBe(true)
  })

  it.each([
    '',
    '../companies?',
    'a/b',
    'a?b',
    'a#b',
    '..',
    'a b',
    '-a',
    '_a',
    'a'.repeat(65),
    undefined,
  ])('拒絕 %s', (value) => {
    expect(isResourceId(value)).toBe(false)
  })
})

describe('特製網址的路由參數', () => {
  it.each([
    ['系統管理者', ADMIN],
    ['內業', OFFICE],
  ] as const)(
    '%s：專案頁的 id 格式不符時顯示找不到且不發出 API 請求',
    async (_name, user) => {
      for (const section of [
        '',
        '/members',
        '/inspection-items',
        '/inspection-items/templates',
        '/planning',
      ]) {
        stubBackend(user)
        await renderApp(`/admin/projects/${EVIL}${section}`)

        expect(
          await screen.findByRole('heading', { name: '找不到這個專案' }),
        ).toBeVisible()
        expect(dataRequests()).toEqual([])
        document.body.innerHTML = ''
      }
    },
  )

  it('專案範本頁的轉址也不帶特製 id', async () => {
    stubBackend(ADMIN)
    await renderApp(`/admin/projects/${EVIL}/templates`)

    expect(
      await screen.findByRole('heading', { name: '找不到這個專案' }),
    ).toBeVisible()
    expect(dataRequests()).toEqual([])
  })

  it('舊的現場專案網址：id 格式不符顯示找不到，不轉址', async () => {
    stubBackend(ADMIN)
    await renderApp(`/field/projects/${EVIL}`)

    expect(
      await screen.findByRole('heading', { name: '找不到這個專案' }),
    ).toBeVisible()
    expect(dataRequests()).toEqual([])
  })

  it('查核項目 id 格式不符：顯示找不到，不發出 API 請求', async () => {
    stubBackend(ADMIN)
    await renderApp(`/admin/projects/project-a/inspection-items/${EVIL}`)

    expect(
      await screen.findByRole('heading', { name: '找不到這個查核項目' }),
    ).toBeVisible()
    expect(dataRequests()).toEqual([])
  })
})

describe('RequireValidRouteIds 的參數驗證', () => {
  function renderGuard(path: string, pattern: string) {
    render(
      <MemoryRouter initialEntries={[path]}>
        <CurrentUserProvider value={{ user: ADMIN, clear: vi.fn() }}>
          <Routes>
            <Route element={<RequireValidRouteIds />}>
              <Route element={<p>頁面內容</p>} path={pattern} />
            </Route>
          </Routes>
        </CurrentUserProvider>
      </MemoryRouter>,
    )
  }

  it('其他具名參數無效：顯示通用找不到', () => {
    renderGuard(`/tasks/${EVIL}`, '/tasks/:taskId')

    expect(
      screen.getByRole('heading', { name: '找不到這個頁面' }),
    ).toBeVisible()
    expect(screen.queryByText('頁面內容')).toBeNull()
  })

  it('專案 id 與其他參數都無效：專案文案優先', () => {
    renderGuard(`/p/${EVIL}/tasks/${EVIL}`, '/p/:projectId/tasks/:taskId')

    expect(
      screen.getByRole('heading', { name: '找不到這個專案' }),
    ).toBeVisible()
  })

  it('splat 剩餘路徑不當作 id 驗證', () => {
    renderGuard('/files/a/b/..%2Fc', '/files/*')

    expect(screen.getByText('頁面內容')).toBeVisible()
  })

  it('所有具名參數都有效：渲染子路由', () => {
    renderGuard('/p/project-1/tasks/task-9', '/p/:projectId/tasks/:taskId')

    expect(screen.getByText('頁面內容')).toBeVisible()
  })
})
