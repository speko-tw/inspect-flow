// 登入、變更密碼、收回自己的管理者權限後的導向（#284 第 1～3 項）。
// 用完整的 `App` 與路由驗證，後端以 fetch 替身模擬。

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest'

import App from './App'
import { preloadLazyRoutes } from './testing/preloadRoutes'

const ADMIN = {
  id: 'admin-1',
  username: 'boss',
  email: 'boss@example.com',
  name_en: null,
  name_zh: '主管',
  is_admin: true,
  must_change_password: false,
}

const MEMBER = { ...ADMIN, id: 'member-1', is_admin: false }

type CurrentUserBody = typeof ADMIN | null

interface Backend {
  /** 目前登入的人；`null` 代表未登入。測試中可隨時改。 */
  me: CurrentUserBody
  /** 登入成功時回傳的人。 */
  loginAs: typeof ADMIN
  fetchMock: Mock<
    (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >
}

function stubBackend(me: CurrentUserBody, loginAs = ADMIN): Backend {
  const backend = { me, loginAs } as Backend
  backend.fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.endsWith('/setup/status')) {
        return Response.json({ setup_required: false })
      }
      if (url.endsWith('/auth/me')) {
        return backend.me === null
          ? Response.json(
              { error: { code: 'auth.not_authenticated' } },
              {
                status: 401,
              },
            )
          : Response.json(backend.me)
      }
      if (url.endsWith('/auth/login') && method === 'POST') {
        backend.me = backend.loginAs
        return Response.json(backend.loginAs)
      }
      if (url.endsWith('/auth/password') && method === 'POST') {
        return new Response(null, { status: 204 })
      }
      if (url.includes('/users?') || url.endsWith('/users')) {
        return Response.json({
          items: [
            {
              id: ADMIN.id,
              username: ADMIN.username,
              email: ADMIN.email,
              name_zh: ADMIN.name_zh,
              name_en: null,
              company_id: null,
              department: null,
              location: null,
              employee_no: null,
              auth_source: 'local',
              is_active: true,
              is_admin: backend.me?.is_admin ?? false,
              is_system: false,
            },
          ],
          next_cursor: null,
        })
      }
      if (url.endsWith(`/users/${ADMIN.id}/admin`) && method === 'PUT') {
        // 收回後，列表與目前使用者 API 都不再是管理者。
        backend.me = { ...ADMIN, is_admin: false }
        return Response.json({})
      }
      return Response.json([])
    },
  )
  vi.stubGlobal('fetch', backend.fetchMock)
  return backend
}

function renderApp(path: string, state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <App />
    </MemoryRouter>,
  )
}

async function signIn() {
  fireEvent.change(await screen.findByLabelText('帳號名稱或 Email'), {
    target: { value: 'boss' },
  })
  fireEvent.change(screen.getByLabelText('密碼'), {
    target: { value: 'secret-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: '登入' }))
}

// 拆包模組的首次載入成本放在 hook，不佔各測試斷言的 1 秒（#295）。
beforeAll(preloadLazyRoutes)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('登入後依身分導向（#284 第 1 項）', () => {
  it('admin 登入後進管理頁', async () => {
    stubBackend(null, ADMIN)
    renderApp('/login')
    await signIn()

    expect(
      await screen.findByRole('heading', { name: '使用者管理' }),
    ).toBeInTheDocument()
  })

  it('一般使用者登入後進現場頁', async () => {
    stubBackend(null, MEMBER)
    renderApp('/login')
    await signIn()

    expect(
      await screen.findByRole('heading', { name: '我的工作台' }),
    ).toBeInTheDocument()
  })

  it('安全的 from 優先於身分預設落點', async () => {
    stubBackend(null, ADMIN)
    renderApp('/login', { from: '/field' })
    await signIn()

    expect(
      await screen.findByRole('heading', { name: '我的工作台' }),
    ).toBeInTheDocument()
  })

  it('不安全的 from 被忽略，仍依身分導向', async () => {
    stubBackend(null, ADMIN)
    renderApp('/login', { from: '//evil.example' })
    await signIn()

    expect(
      await screen.findByRole('heading', { name: '使用者管理' }),
    ).toBeInTheDocument()
  })

  it('變更密碼完成後（沒有 from）依身分導向：admin 進管理頁', async () => {
    stubBackend(ADMIN)
    renderApp('/change-password')
    await screen.findByRole('heading', { name: '變更密碼' })

    fireEvent.change(screen.getByLabelText('目前密碼'), {
      target: { value: 'old-password' },
    })
    fireEvent.change(screen.getByLabelText('新密碼'), {
      target: { value: 'new-password-1' },
    })
    fireEvent.change(screen.getByLabelText('再輸入一次新密碼'), {
      target: { value: 'new-password-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '變更密碼' }))

    expect(
      await screen.findByRole('heading', { name: '使用者管理' }),
    ).toBeInTheDocument()
  })

  it('變更密碼完成後（沒有 from）依身分導向：一般使用者進現場頁', async () => {
    stubBackend(MEMBER)
    renderApp('/change-password')
    await screen.findByRole('heading', { name: '變更密碼' })

    fireEvent.change(screen.getByLabelText('目前密碼'), {
      target: { value: 'old-password' },
    })
    fireEvent.change(screen.getByLabelText('新密碼'), {
      target: { value: 'new-password-1' },
    })
    fireEvent.change(screen.getByLabelText('再輸入一次新密碼'), {
      target: { value: 'new-password-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '變更密碼' }))

    expect(
      await screen.findByRole('heading', { name: '我的工作台' }),
    ).toBeInTheDocument()
  })

  it('已登入者開 / 直接導向：admin 進管理頁', async () => {
    stubBackend(ADMIN)
    renderApp('/')

    expect(
      await screen.findByRole('heading', { name: '使用者管理' }),
    ).toBeInTheDocument()
  })

  it('已登入者開 / 直接導向：一般使用者進現場頁', async () => {
    stubBackend(MEMBER)
    renderApp('/')

    expect(
      await screen.findByRole('heading', { name: '我的工作台' }),
    ).toBeInTheDocument()
  })

  it('未登入者開 / 導向登入頁，不再顯示公開首頁', async () => {
    stubBackend(null)
    renderApp('/')

    expect(
      await screen.findByRole('heading', { name: '登入' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull()
  })

  it('目前使用者 API 失敗（非 401）時 / 顯示錯誤而不是導向登入頁', async () => {
    const backend = stubBackend(ADMIN)
    backend.fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/setup/status')) {
        return Response.json({ setup_required: false })
      }
      return new Response(null, { status: 500 })
    })
    renderApp('/')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '無法確認登入狀態',
    )
    expect(screen.queryByRole('heading', { name: '登入' })).toBeNull()
  })
})

describe('收回自己的管理者權限（#284 第 2、3 項）', () => {
  it('先確認；取消時不送出請求', async () => {
    const backend = stubBackend(ADMIN)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderApp('/admin/users')
    fireEvent.click(await screen.findByRole('button', { name: '收回管理者' }))

    expect(confirm).toHaveBeenCalledWith(
      '你將收回自己的管理者權限，之後無法再進入管理頁，確定嗎？',
    )
    expect(
      backend.fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith(`/users/${ADMIN.id}/admin`),
      ),
    ).toBe(false)
    expect(
      screen.getByRole('heading', { name: '使用者管理' }),
    ).toBeInTheDocument()
  })

  it('確認後收回成功：提示並導離管理頁，不顯示權限錯誤', async () => {
    const backend = stubBackend(ADMIN)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderApp('/admin/users')
    fireEvent.click(await screen.findByRole('button', { name: '收回管理者' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      '已收回你的管理者權限',
    )
    expect(
      screen.getByRole('heading', { name: '我的工作台' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('你沒有權限執行這項操作')).toBeNull()
    expect(screen.queryByRole('heading', { name: '使用者管理' })).toBeNull()

    // 導離後有重新取得目前使用者，且收回後沒有再呼叫列表 API。
    const calls = backend.fetchMock.mock.calls.map(([url]) => String(url))
    const revokeIndex = calls.findIndex((url) =>
      url.endsWith(`/users/${ADMIN.id}/admin`),
    )
    expect(revokeIndex).toBeGreaterThan(-1)
    expect(
      calls.slice(revokeIndex + 1).some((url) => url.endsWith('/users')),
    ).toBe(false)
    expect(
      calls.slice(revokeIndex + 1).some((url) => url.endsWith('/auth/me')),
    ).toBe(true)
  })

  it('收回自己失敗時留在管理頁並顯示錯誤', async () => {
    const backend = stubBackend(ADMIN)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const original = backend.fetchMock.getMockImplementation()!
    backend.fetchMock.mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith(`/users/${ADMIN.id}/admin`)) {
          return Response.json(
            { error: { code: 'permission.denied' } },
            { status: 403 },
          )
        }
        return original(input, init)
      },
    )
    renderApp('/admin/users')
    fireEvent.click(await screen.findByRole('button', { name: '收回管理者' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    expect(
      screen.getByRole('heading', { name: '使用者管理' }),
    ).toBeInTheDocument()
  })
})
