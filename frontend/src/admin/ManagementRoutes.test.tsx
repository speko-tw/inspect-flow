import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Link, useLocation, useNavigate } from 'react-router'
import type { CurrentUser } from '../auth/api'
import { CurrentUserProvider } from '../auth/useCurrentUser'
import { DataMemoryRouter } from '../testing/DataMemoryRouter'
import AdminPage from './AdminPage'

const user: CurrentUser = {
  id: 'admin-id',
  username: 'admin',
  email: null,
  name_en: null,
  name_zh: null,
  is_admin: true,
  must_change_password: false,
  has_office_access: true,
  can_manage_project_planning_or_members: true,
  has_field_access: true,
  can_inspect_tasks: true,
  has_template_access: true,
  module_permissions: [],
  delegated_modules: [],
  can_create_project: true,
  has_project_access: true,
  is_external_collaborator: false,
}
const paths = [
  '/roles/new',
  '/roles/r1',
  '/roles/r1/edit',
  '/companies/new',
  '/companies/c1',
]
function Probe() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <output aria-label="目前網址">
        {location.pathname + location.search}
      </output>
      <output aria-label="路由狀態">{JSON.stringify(location.state)}</output>
      <button type="button" onClick={() => navigate(-1)}>
        測試上一頁
      </button>
      <button type="button" onClick={() => navigate(1)}>
        測試下一頁
      </button>
      <Link replace to="/roles/r2/edit">
        切換角色
      </Link>
      <Link replace to="/companies/c2">
        切換公司
      </Link>
      <Link replace to="/roles/r1">
        離開詳情
      </Link>
    </>
  )
}
function mount(path: string, admin = true, history?: string[]) {
  return render(
    <DataMemoryRouter initialEntries={history ?? [path]}>
      <CurrentUserProvider
        value={{
          user: { ...user, is_admin: admin },
          clear: vi.fn(),
        }}
      >
        <AdminPage />
        <Probe />
      </CurrentUserProvider>
    </DataMemoryRouter>,
  )
}
function backend() {
  const companies = [
    { id: 'c1', name: '甲公司', is_active: true },
    { id: 'c2', name: '乙公司', is_active: false },
  ]
  const roles = ['r1', 'r2'].map((id, i) => ({
    id,
    name: `角色${i + 1}`,
    permission_codes: ['project.read'],
    user_count: 0,
    inactive_user_count: 0,
    project_count: 0,
    is_assignable: true,
    is_external_allowed: false,
    created_at: '2026-10-01',
    updated_at: '2026-10-01',
  }))
  let failure: {
    path: string
    method: string
    status: number
    code?: string
    fields?: { path: string; code: string }[]
  } | null = null
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      const path = url.pathname.replace('/api/v1', '')
      const method = init?.method ?? 'GET'
      if (failure?.path === path && failure.method === method) {
        return Response.json(
          {
            error: {
              code: failure.code ?? 'validation.failed',
              fields: failure.fields,
            },
          },
          { status: failure.status },
        )
      }
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (path === '/roles/permission-codes')
        return Response.json({
          items: [{ code: 'project.read', description: '查看專案' }],
        })
      if (path === '/roles/creator-role') {
        return Response.json({ role_id: 'creator' })
      }
      if (path === '/roles') {
        if (method === 'POST') {
          const created = { ...roles[0], ...body, id: 'r3' }
          roles.push(created)
          return Response.json(created, { status: 201 })
        }
        return Response.json({ items: roles, next_cursor: null })
      }
      if (path.startsWith('/roles/')) {
        const role = roles.find((item) => path === `/roles/${item.id}`)
        if (role) {
          if (method === 'PATCH') Object.assign(role, body)
          return Response.json(role)
        }
      }
      if (path === '/companies:batch-status') {
        for (const item of body.items) {
          Object.assign(
            companies.find((c) => c.id === item.company_id)!,
            { is_active: item.is_active },
          )
        }
        return Response.json({ items: companies })
      }
      if (path === '/companies') {
        if (method === 'POST') {
          const created = { id: 'c3', is_active: true, ...body }
          companies.push(created)
          return Response.json(created, { status: 201 })
        }
        return Response.json({
          items: companies.filter((item) =>
            item.name.includes(url.searchParams.get('q') ?? ''),
          ),
          next_cursor: null,
        })
      }
      if (path.endsWith('/active-users')) {
        return Response.json({ users: [], count: 0 })
      }
      const company = companies.find(
        (item) =>
          path === `/companies/${item.id}` ||
          path === `/companies/${item.id}/active`,
      )
      if (company) {
        if (method !== 'GET') Object.assign(company, body)
        return Response.json(company)
      }
      return Response.json(
        { error: { code: 'resource.not_found' } },
        { status: 404 },
      )
    },
  )
  vi.stubGlobal('fetch', fetcher)
  return {
    fetcher,
    roles,
    companies,
    fail: (value: typeof failure) => {
      failure = value
    },
  }
}
afterEach(() => vi.unstubAllGlobals())

describe('ADM-AC55 角色與公司網址', () => {
  it.each(paths)('非 Admin 直接開 %s 不讀取管理資料', async (path) => {
    const api = backend()
    mount(path, false)
    expect(
      await screen.findByRole('heading', { name: '無權限' }),
    ).toBeVisible()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(api.fetcher).not.toHaveBeenCalled()
    expect(screen.getByLabelText('目前網址')).toHaveTextContent(path)
  })
  it.each([
    '/roles/a%2Fb',
    '/roles/NEW/edit',
    '/roles/new/edit',
    '/roles/creator-role',
    '/roles/permission-codes',
    '/roles/r1/unknown',
    '/companies/a%2Fb',
    '/companies/c1/edit',
    '/companies/c1/unknown',
  ])('壞網址 %s 不打 API', async (path) => {
    const api = backend()
    mount(path)
    expect(
      await screen.findByRole('heading', { name: '找不到這個頁面' }),
    ).toBeVisible()
    expect(api.fetcher).not.toHaveBeenCalled()
  })
  it.each(paths)('直接載入及重新掛載 %s 保持原頁', async (path) => {
    backend()
    const view = mount(path)
    const title =
      path === '/roles/new'
        ? '新增角色'
        : path.endsWith('/edit')
          ? '修改角色「角色1」'
          : path === '/roles/r1'
            ? '角色1'
            : path === '/companies/new'
              ? '新增公司'
              : '甲公司'
    await screen.findByRole('heading', { name: title, level: 1 })
    view.unmount()
    mount(path)
    expect(
      await screen.findByRole('heading', {
        name: title,
        level: 1,
      }),
    ).toBeVisible()
    expect(screen.getByLabelText('目前網址')).toHaveTextContent(path)
  })
  it.each(['/roles/r1', '/companies/c1'])(
    '讀取 %s 失敗可重試；403 走無權限頁',
    async (path) => {
      const api = backend()
      api.fail({ path, method: 'GET', status: 500 })
      mount(path)
      const retry = await screen.findByRole('button', { name: '重新載入' })
      api.fail(null)
      fireEvent.click(retry)
      await screen.findByRole('heading', {
        name: path.startsWith('/roles') ? '角色1' : '甲公司',
        level: 1,
      })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    },
  )
  it.each(['/roles/r1', '/companies/c1'])(
    '後端拒絕 %s 不顯示詳情',
    async (path) => {
      const api = backend()
      api.fail({ path, method: 'GET', status: 403 })
      mount(path)
      expect(
        await screen.findByRole('heading', { name: '無權限' }),
      ).toBeVisible()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    },
  )
  it.each(['roles', 'companies'])(
    '%s 新增 replace 到詳情，訊息一次消費且上一頁不回表單',
    async (kind) => {
      backend()
      const path = `/${kind}/new`
      const previous = kind === 'roles' ? '/companies' : '/roles'
      mount(path, true, [previous, path])
      const label = kind === 'roles' ? '角色名稱' : '公司名稱'
      fireEvent.change(await screen.findByLabelText(label), {
        target: { value: '新資料' },
      })
      fireEvent.click(
        screen.getByRole('button', {
          name: kind === 'roles' ? '建立角色' : '新增公司',
        }),
      )
      await screen.findByRole('heading', { name: '新資料', level: 1 })
      expect(
        screen.getByText(/已(?:建立角色|新增公司)「新資料」。/, {
          selector: '.notice',
        }),
      ).toBeVisible()
      await waitFor(() =>
        expect(screen.getByLabelText('路由狀態')).toHaveTextContent('null'),
      )
      fireEvent.click(screen.getByRole('button', { name: '測試上一頁' }))
      await waitFor(() =>
        expect(screen.getByLabelText('目前網址')).toHaveTextContent(previous),
      )
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '測試下一頁' }))
      await screen.findByRole('heading', { name: '新資料', level: 1 })
      expect(
        screen.queryByText(/已(?:建立角色|新增公司)「新資料」。/, {
          selector: '.notice',
        }),
      ).not.toBeInTheDocument()
    },
  )
  it('公司返回清單保留搜尋；切換公司沒有改名殘留', async () => {
    backend()
    mount('/companies?q=甲')
    const input = await screen.findByLabelText('搜尋公司')
    expect(input).toHaveValue('甲')
    fireEvent.click(await screen.findByRole('link', { name: '甲公司' }))
    await screen.findByRole('heading', { name: '甲公司', level: 1 })
    fireEvent.click(screen.getByRole('link', { name: '返回公司清單' }))
    expect(await screen.findByLabelText('搜尋公司')).toHaveValue('甲')
    await screen.findByRole('link', { name: '甲公司' })
    expect(
      screen.queryByRole('link', { name: '乙公司' }),
    ).not.toBeInTheDocument()
  })
  it('公司無人也先確認停用；啟用同樣先確認', async () => {
    const api = backend()
    mount('/companies/c1')
    fireEvent.click(await screen.findByRole('button', { name: '停用公司' }))
    const confirm = await screen.findByRole('button', {
      name: '確認停用公司',
    })
    expect(
      api.fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT'),
    ).toHaveLength(0)
    fireEvent.click(confirm)
    fireEvent.click(await screen.findByRole('button', { name: '啟用公司' }))
    expect(
      await screen.findByRole('button', {
        name: '確認啟用公司',
      }),
    ).toBeVisible()
    expect(
      api.fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT'),
    ).toHaveLength(1)
  })
  it.each(['roles', 'companies'])(
    '%s 422 欄位錯誤聚焦名稱且保留草稿',
    async (kind) => {
      const api = backend()
      api.fail({
        path: `/${kind}`,
        method: 'POST',
        status: 422,
        fields: [{ path: '/name', code: 'field.invalid' }],
      })
      mount(`/${kind}/new`)
      const field = await screen.findByLabelText(
        kind === 'roles' ? '角色名稱' : '公司名稱',
      )
      fireEvent.change(field, { target: { value: '保留草稿' } })
      fireEvent.click(
        screen.getByRole('button', {
          name: kind === 'roles' ? '建立角色' : '新增公司',
        }),
      )
      await waitFor(() => expect(field).toHaveFocus())
      expect(field).toHaveAttribute('aria-invalid', 'true')
      expect(field).toHaveValue('保留草稿')
      expect(
        screen.queryByRole('heading', { name: '找不到這個頁面' }),
      ).not.toBeInTheDocument()
    },
  )
})

describe('ADM-AC55 表單狀態隔離', () => {
  it('切換角色捨棄舊草稿，改名成功 replace 且上一頁不回編輯', async () => {
    backend()
    mount('/roles/r1/edit', true, ['/companies', '/roles/r1/edit'])
    fireEvent.change(await screen.findByLabelText('角色名稱'), {
      target: { value: '舊草稿' },
    })
    fireEvent.click(screen.getByRole('link', { name: '切換角色' }))
    fireEvent.click(await screen.findByRole('button', { name: '捨棄變更' }))
    await waitFor(() =>
      expect(screen.getByLabelText('角色名稱')).toHaveValue('角色2'),
    )
    fireEvent.change(screen.getByLabelText('角色名稱'), {
      target: { value: '新角色2' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存角色' }))
    fireEvent.click(
      await screen.findByRole('button', {
        name: '確認修改角色',
      }),
    )
    await screen.findByRole('heading', { name: '新角色2', level: 1 })
    await waitFor(() =>
      expect(screen.getByLabelText('路由狀態')).toHaveTextContent('null'),
    )
    fireEvent.click(screen.getByRole('button', { name: '測試上一頁' }))
    await waitFor(() =>
      expect(screen.getByLabelText('目前網址')).toHaveTextContent(
        '/companies',
      ),
    )
    expect(screen.queryByLabelText('角色名稱')).not.toBeInTheDocument()
  })
  it.each(['roles', 'companies'])('%s 寫入 403 移除表單', async (kind) => {
    const api = backend()
    api.fail({ path: `/${kind}`, method: 'POST', status: 403 })
    mount(`/${kind}/new`)
    fireEvent.change(
      await screen.findByLabelText(kind === 'roles' ? '角色名稱' : '公司名稱'),
      { target: { value: '新資料' } },
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: kind === 'roles' ? '建立角色' : '新增公司',
      }),
    )
    await screen.findByRole('heading', { name: '無權限' })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
  it.each([
    ['/permission_codes/0', '權限', 'group'],
    ['/is_assignable', '非管理者可指派', 'checkbox'],
    ['/is_external_allowed', '外部協作帳號可用', 'checkbox'],
  ])('角色欄位 %s 的 422 定位正確', async (path, name, role) => {
    const api = backend()
    api.fail({
      path: '/roles/r1',
      method: 'PATCH',
      status: 422,
      fields: [{ path, code: 'field.invalid' }],
    })
    mount('/roles/r1/edit')
    fireEvent.change(await screen.findByLabelText('角色名稱'), {
      target: { value: '保留名稱' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存角色' }))
    fireEvent.click(
      await screen.findByRole('button', {
        name: '確認修改角色',
      }),
    )
    const field = screen.getByRole(role, { name })
    await waitFor(() => expect(field).toHaveFocus())
    if (role === 'group') {
      expect(field).toHaveAttribute(
        'aria-describedby',
        'role-permissions-error',
      )
      expect(field).not.toHaveAttribute('aria-invalid')
    } else expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('角色名稱')).toHaveValue('保留名稱')
  })
})

describe('ADM-AC55 領域保護與批次確認', () => {
  it.each([
    [
      'role.creator_role_requires_permissions',
      '權限',
      'group',
      '這是新專案預設角色，必須保留「檢視專案」「調整專案」「管理專案成員與其角色」三項權限。',
    ],
    [
      'role.external_allowed_invalid',
      '外部協作帳號可用',
      'checkbox',
      '這個角色含有外部協作人員不能使用的權限，或它是新專案預設角色，不能設成「外部協作帳號可用」。',
    ],
    [
      'role.external_in_use',
      '外部協作帳號可用',
      'checkbox',
      '目前有外部協作人員持有這個角色，不能取消「外部協作帳號可用」。請先移除他們的這個角色。',
    ],
  ])('%s 無 fields 時仍定位到對應欄位', async (code, name, role, message) => {
    const api = backend()
    api.fail({ path: '/roles/r1', method: 'PATCH', status: 422, code })
    mount('/roles/r1/edit')
    fireEvent.change(await screen.findByLabelText('角色名稱'), {
      target: { value: '保留草稿' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存角色' }))
    fireEvent.click(
      await screen.findByRole('button', {
        name: '確認修改角色',
      }),
    )
    await waitFor(() => expect(screen.getByRole(role, { name })).toHaveFocus())
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(screen.getByLabelText('角色名稱')).toHaveValue('保留草稿')
  })
  it('批次啟用公司須確認，取消不送出，確認只送一次', async () => {
    const api = backend()
    mount('/companies')
    fireEvent.click(
      await screen.findByRole('checkbox', {
        name: '選取公司 乙公司',
      }),
    )
    const activate = screen.getByRole('button', { name: '批次啟用公司' })
    expect(activate).toHaveClass('btn')
    expect(activate).not.toHaveClass('btn-danger-outline')
    fireEvent.click(activate)
    const confirm = await screen.findByRole('button', {
      name: '確認批次啟用公司',
    })
    expect(confirm).not.toHaveClass('btn-danger')
    const writes = () =>
      api.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(writes()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(writes()).toHaveLength(0)
    fireEvent.click(activate)
    fireEvent.click(
      await screen.findByRole('button', {
        name: '確認批次啟用公司',
      }),
    )
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({
      items: [{ company_id: 'c2', is_active: true, disable_user_ids: [] }],
    })
  })
})

describe('ADM-AC55 返回與資源消失', () => {
  it.each([
    ['/roles/missing', '找不到這個角色', '返回角色清單'],
    ['/companies/missing', '找不到這家公司', '返回公司清單'],
  ])('%s 回 404 顯示資源不存在及返回入口', async (url, title, back) => {
    const api = backend()
    mount(url)
    expect(await screen.findByRole('heading', { name: title })).toBeVisible()
    expect(screen.getByRole('link', { name: back })).toBeVisible()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(api.fetcher).toHaveBeenCalled()
  })
  it('公司改名切換資源不帶出草稿', async () => {
    backend()
    mount('/companies/c1?q=甲')
    fireEvent.click(
      await screen.findByRole('button', { name: '修改公司名稱' }),
    )
    fireEvent.change(screen.getByRole('textbox', { name: '公司名稱' }), {
      target: { value: '尚未儲存' },
    })
    fireEvent.click(screen.getByRole('link', { name: '切換公司' }))
    fireEvent.click(await screen.findByRole('button', { name: '捨棄變更' }))
    await screen.findByRole('heading', { name: '乙公司', level: 1 })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText('尚未儲存')).not.toBeInTheDocument()
  })
})

it('新增公司取消後返回保留搜尋的清單', async () => {
  backend()
  mount('/companies/new?q=甲')
  fireEvent.change(await screen.findByRole('textbox', { name: '公司名稱' }), {
    target: { value: '尚未儲存' },
  })
  fireEvent.click(screen.getByRole('link', { name: '取消' }))
  fireEvent.click(await screen.findByRole('button', { name: '捨棄變更' }))
  expect(await screen.findByLabelText('搜尋公司')).toHaveValue('甲')
  expect(await screen.findByRole('link', { name: '甲公司' })).toBeVisible()
  expect(
    screen.queryByRole('textbox', { name: '公司名稱' }),
  ).not.toBeInTheDocument()
})

it.each(['roles', 'companies'])('清單到 %s 詳情保留瀏覽歷史', async (kind) => {
  backend()
  mount(`/${kind}`)
  fireEvent.click(
    await screen.findByRole('link', {
      name: kind === 'roles' ? '角色1' : '查看公司 甲公司',
    }),
  )
  await screen.findByRole('heading', {
    name: kind === 'roles' ? '角色1' : '甲公司',
    level: 1,
  })
  fireEvent.click(screen.getByRole('button', { name: '測試上一頁' }))
  await waitFor(() =>
    expect(screen.getByLabelText('目前網址').textContent).toBe(`/${kind}`),
  )
})

it('角色名稱連結強調進入詳情，完整權限使用一般次按鈕', async () => {
  backend()
  mount('/roles')
  expect(await screen.findByRole('link', { name: '角色1' })).toHaveAttribute(
    'href',
    '/roles/r1',
  )
  const summary = screen.getByRole('button', {
    name: '查看完整權限（角色1）',
  })
  expect(summary).toHaveClass('btn')
  expect(summary).not.toHaveClass('btn-emphasis')
})

it('大寫 UUID 單筆回應可以正常顯示', async () => {
  const api = backend()
  const id = 'abcdefab-1234-4234-8234-abcdefabcdef'
  api.roles[0].id = id
  const original = api.fetcher.getMockImplementation()!
  api.fetcher.mockImplementation((input, init) =>
    original(String(input).replace(id.toUpperCase(), id), init),
  )
  mount(`/roles/${id.toUpperCase()}`)
  expect(
    await screen.findByRole('heading', { name: '角色1', level: 1 }),
  ).toBeVisible()
})

it.each(['/roles/permission-codes', '/roles/creator-role'])(
  '輔助 API %s 失敗不誤判角色不存在',
  async (path) => {
    const api = backend()
    api.fail({ path, method: 'GET', status: 404 })
    mount('/roles/r1/edit')
    expect(
      await screen.findByRole('button', { name: '重新載入' }),
    ).toBeVisible()
    expect(
      screen.getByRole('heading', { name: '修改角色', level: 1 }),
    ).toBeVisible()
    expect(screen.queryByText('找不到這個角色')).not.toBeInTheDocument()
  },
)

it('新增角色只讀權限登記表，不讀預設角色', async () => {
  const api = backend()
  mount('/roles/new')
  await screen.findByLabelText('角色名稱')
  expect(api.fetcher.mock.calls.map(([input]) => String(input))).toEqual([
    '/api/v1/roles/permission-codes',
  ])
})

it('公司改名鎖住狀態按鈕，取消與儲存都回復焦點', async () => {
  backend()
  mount('/companies/c1')
  const rename = await screen.findByRole('button', { name: '修改公司名稱' })
  fireEvent.click(rename)
  expect(screen.getByRole('button', { name: '停用公司' })).toBeDisabled()
  expect(rename).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  await waitFor(() => expect(rename).toHaveFocus())
  fireEvent.click(rename)
  fireEvent.change(screen.getByLabelText('公司名稱'), {
    target: { value: '新公司' },
  })
  fireEvent.click(screen.getByRole('button', { name: '儲存公司名稱' }))
  await screen.findByText('已將公司名稱更新為「新公司」。')
  await waitFor(() => expect(rename).toHaveFocus())
})

it('公司狀態以操作時最新回應決定，避免舊畫面反向操作', async () => {
  const api = backend()
  mount('/companies/c1')
  const deactivate = await screen.findByRole('button', { name: '停用公司' })
  api.companies[0].is_active = false
  fireEvent.click(deactivate)
  expect(
    await screen.findByRole('button', { name: '確認啟用公司' }),
  ).toBeVisible()
  expect(
    api.fetcher.mock.calls.some(([url]) =>
      String(url).endsWith('/active-users'),
    ),
  ).toBe(false)
})

it('刪除失敗保留確認框及錯誤，可以重試', async () => {
  const api = backend()
  api.fail({ path: '/roles/r1', method: 'DELETE', status: 500 })
  mount('/roles/r1')
  fireEvent.click(await screen.findByRole('button', { name: '刪除角色' }))
  fireEvent.click(await screen.findByRole('button', { name: '確認刪除角色' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('button', { name: '確認刪除角色' })).toBeVisible()
})

it.each(['roles', 'companies'])(
  '%s 建立成功後立即返回清單，不被訊息清理拉回詳情',
  async (kind) => {
    backend()
    mount(`/${kind}/new`)
    fireEvent.change(
      await screen.findByLabelText(kind === 'roles' ? '角色名稱' : '公司名稱'),
      { target: { value: '立即返回驗收' } },
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: kind === 'roles' ? '建立角色' : '新增公司',
      }),
    )
    await screen.findByRole('heading', { name: '立即返回驗收', level: 1 })
    // 不等路由 state 清空；使用者看到完成頁就可以直接返回。
    fireEvent.click(
      screen.getByRole('link', {
        name: kind === 'roles' ? '返回角色清單' : '返回公司清單',
      }),
    )
    expect(
      await screen.findByRole('heading', {
        name: kind === 'roles' ? '專案角色' : '公司管理',
        level: 1,
      }),
    ).toBeVisible()
    expect(screen.getByLabelText('目前網址').textContent).toBe(`/${kind}`)
  },
)
