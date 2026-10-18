import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataMemoryRouter } from '../../testing/DataMemoryRouter'
import ModulePermissionsPage from './ModulePermissionsPage'

interface FixtureOptions {
  permissionCodes?: string[]
  failBundleOnce?: boolean
  memberRoleIds?: string[]
}

function permissionPage(options: FixtureOptions = {}) {
  const permissionCodes = [...(options.permissionCodes ?? [])]
  let failBundleOnce = options.failBundleOnce ?? false
  const memberRoleIds = options.memberRoleIds ?? []
  const member = {
    id: 'person',
    username: 'person.one',
    email: 'person@example.test',
    name_zh: '林沐青',
    name_en: null,
    company_id: null,
    department: null,
    location: null,
    employee_no: null,
    extension_1: null,
    extension_2: null,
    mobile: null,
    line_id: null,
    wechat_id: null,
    responsibilities: null,
    auth_source: 'local',
    is_active: true,
    is_admin: false,
    is_system: false,
    is_external_collaborator: false,
    account_expires_on: null,
  }
  const roles = [
    {
      id: 'office-role',
      name: '專案工程師',
      permission_codes: ['project_member.manage'],
      user_count: 0,
      project_count: 0,
      created_at: '',
      updated_at: '',
      is_assignable: true,
      is_external_allowed: false,
    },
    {
      id: 'field-role',
      name: '現場工程師',
      permission_codes: ['inspection_task.inspect'],
      user_count: 0,
      project_count: 0,
      created_at: '',
      updated_at: '',
      is_assignable: true,
      is_external_allowed: true,
    },
    {
      id: 'viewer-role',
      name: '專案查閱人員',
      permission_codes: ['project.read'],
      user_count: 0,
      project_count: 0,
      created_at: '',
      updated_at: '',
      is_assignable: true,
      is_external_allowed: true,
    },
  ]
  const bundles = [
    {
      id: 'office-bundle',
      name: '專案工程師常用',
      permission_codes: ['project.use', 'inspection.use'],
      created_at: '',
      updated_at: '',
    },
    {
      id: 'field-bundle',
      name: '現場工程師常用',
      permission_codes: ['project.use', 'inspection.use'],
      created_at: '',
      updated_at: '',
    },
  ]
  const calls: Array<{ path: string; method: string; body: string }> = []
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://test.local')
      const path = url.pathname.replace('/api/v1', '')
      const method = init?.method ?? 'GET'
      const body = String(init?.body ?? '')
      calls.push({ path, method, body })
      if (method === 'GET' && path === '/users') {
        return Response.json({ items: [member], next_cursor: null })
      }
      if (method === 'GET' && path === '/companies') {
        return Response.json({ items: [], next_cursor: null })
      }
      if (method === 'GET' && path === '/module-permissions') {
        return Response.json({
          items: [
            {
              code: 'project.use',
              module: 'project',
              description: '使用專案模組',
            },
            {
              code: 'inspection.use',
              module: 'inspection',
              description: '使用查核模組',
            },
            {
              code: 'project.create',
              module: 'project',
              description: '建立專案',
            },
            {
              code: 'template.manage',
              module: 'template',
              description: '管理範本庫',
            },
          ],
        })
      }
      if (method === 'GET' && path === '/permission-bundles') {
        return Response.json({ items: bundles, next_cursor: null })
      }
      if (method === 'GET' && path === '/roles') {
        return Response.json({ items: roles, next_cursor: null })
      }
      if (method === 'GET' && path === '/projects') {
        return Response.json({
          items: [{ id: 'project-1', name: '示範工程' }],
          next_cursor: null,
        })
      }
      if (
        method === 'GET' &&
        /^\/users\/[^/]+\/module-permissions$/.test(path)
      ) {
        return Response.json({
          permission_codes: permissionCodes,
          delegated_modules: [],
        })
      }
      if (method === 'GET' && path === '/projects/project-1/members') {
        return Response.json([
          ...(memberRoleIds.length
            ? [{ user_id: 'person', role_ids: memberRoleIds }]
            : []),
        ])
      }
      if (method === 'GET' && path.endsWith('/revoke-impact')) {
        return Response.json({
          membership_count: 1,
          projects: [{ id: 'project-1', name: '示範工程' }],
          projects_becoming_unmanaged: [],
        })
      }
      if (method === 'POST' && path === '/users') {
        const input = JSON.parse(body) as Record<string, unknown>
        return Response.json({
          ...member,
          id: 'created-person',
          username: input.username,
          email: input.email,
          name_zh: input.name_zh,
          is_external_collaborator: input.is_external_collaborator,
          is_admin: input.is_admin,
          temporary_password: 'temporary-secret',
        })
      }
      if (method === 'POST' && path.includes(':apply')) {
        if (failBundleOnce) {
          failBundleOnce = false
          return Response.json(
            { error: { code: 'permission.bundle_invalid' } },
            { status: 422 },
          )
        }
        permissionCodes.splice(
          0,
          permissionCodes.length,
          'project.use',
          'inspection.use',
        )
        return Response.json({
          user_id: path.split('/')[2],
          granted_codes: permissionCodes,
        })
      }
      if (method === 'PUT' && path.includes('/module-permissions/')) {
        const code = path.split('/').at(-1) ?? ''
        if (!permissionCodes.includes(code)) permissionCodes.push(code)
        return new Response(null, { status: 204 })
      }
      if (method === 'DELETE' && path.includes('/module-permissions/')) {
        const code = path.split('/').at(-1) ?? ''
        const index = permissionCodes.indexOf(code)
        if (index >= 0) permissionCodes.splice(index, 1)
        return new Response(null, { status: 204 })
      }
      if (method === 'PUT' || method === 'DELETE') {
        return new Response(null, { status: 204 })
      }
      if (method === 'POST' && path.endsWith('/members')) {
        return Response.json({ id: 'member-1' })
      }
      return Response.json(
        { error: { code: 'unexpected_request' } },
        { status: 404 },
      )
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  render(
    <DataMemoryRouter>
      <ModulePermissionsPage />
    </DataMemoryRouter>,
  )
  return { calls, fetchMock }
}

async function chooseProfile(profile: string) {
  fireEvent.click(screen.getByRole('button', { name: /2\. 職務/ }))
  fireEvent.click(screen.getByRole('radio', { name: new RegExp(profile) }))
  fireEvent.click(screen.getByRole('button', { name: /4\. 確認/ }))
}

async function fillIdentity(username: string) {
  fireEvent.change(screen.getByLabelText('帳號'), {
    target: { value: username },
  })
  fireEvent.change(screen.getByLabelText('姓名'), {
    target: { value: '林沐青' },
  })
  fireEvent.change(screen.getByLabelText('電子郵件'), {
    target: { value: `${username}@example.test` },
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('ModulePermissionsPage', () => {
  it.each([
    ['系統管理者', true, false, null],
    ['專案工程師', false, false, '專案工程師常用'],
    ['現場工程師', false, false, '現場工程師常用'],
    ['外部協作者', false, true, '現場工程師常用'],
  ])(
    'creates the %s profile with its approved access bundle',
    async (label, isAdmin, isExternal, bundleName) => {
      const { calls } = permissionPage()
      await screen.findByRole('heading', { name: '職務起手式' })
      await fillIdentity(`new.${String(label)}`)
      await chooseProfile(String(label))

      expect(
        screen.getByText(
          (_, element) =>
            element?.textContent === `林沐青將以「${String(label)}」加入。`,
        ),
      ).toBeVisible()
      fireEvent.click(screen.getByRole('button', { name: '建立人員' }))

      await waitFor(() => {
        expect(
          calls.some(
            (call) => call.method === 'POST' && call.path === '/users',
          ),
        ).toBe(true)
      })
      const createBody = JSON.parse(
        calls.find((call) => call.path === '/users' && call.method === 'POST')
          ?.body ?? '{}',
      ) as Record<string, unknown>
      expect(createBody.is_admin).toBe(isAdmin)
      expect(createBody.is_external_collaborator).toBe(isExternal)
      const applyCall = calls.find((call) => call.path.includes(':apply'))
      if (bundleName === null) {
        expect(applyCall).toBeUndefined()
      } else {
        expect(applyCall?.path).toContain(
          bundleName === '專案工程師常用' ? 'office-bundle' : 'field-bundle',
        )
      }
    },
  )

  it('keeps a newly created account visible and allows retry after bundle failure', async () => {
    const { calls } = permissionPage({ failBundleOnce: true })
    await screen.findByRole('heading', { name: '職務起手式' })
    await fillIdentity('retry.user')
    await chooseProfile('專案工程師')
    fireEvent.click(screen.getByRole('button', { name: '建立人員' }))

    expect(await screen.findByText(/帳號已建立；後續授權/)).toBeVisible()
    expect(screen.getByRole('combobox', { name: '選擇人員' })).toHaveValue(
      'created-person',
    )
    expect(
      calls.filter((call) => call.path === '/users' && call.method === 'POST'),
    ).toHaveLength(1)

    fireEvent.click(screen.getByText('進階設定：委派、權限組合與逐項授權'))
    const bundleRow = screen
      .getAllByRole('listitem')
      .find((item) => item.textContent?.includes('專案工程師常用'))
    expect(bundleRow).toBeDefined()
    fireEvent.click(
      within(bundleRow!).getByRole('button', { name: '套用至所選人員' }),
    )
    await waitFor(() => {
      expect(screen.getByText('權限組合已完整套用。')).toBeVisible()
    })
    expect(calls.filter((call) => call.path.includes(':apply'))).toHaveLength(
      2,
    )
    expect(
      calls.some(
        (call) => call.path.endsWith('/members') && call.method === 'POST',
      ),
    ).toBe(false)
  })

  it('cancels a revoke preview without sending a permission write', async () => {
    const { calls } = permissionPage({ permissionCodes: ['project.use'] })
    await screen.findByRole('heading', { name: '職務起手式' })
    fireEvent.change(screen.getByRole('combobox', { name: '選擇人員' }), {
      target: { value: 'person' },
    })
    const permission = await screen.findByLabelText(/project.use/)
    fireEvent.click(permission)
    expect(
      await screen.findByRole('heading', {
        name: '確認收回模組權限',
      }),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    await waitFor(() => {
      expect(
        screen.queryByRole('heading', {
          name: '確認收回模組權限',
        }),
      ).not.toBeInTheDocument()
    })
    expect(calls.some((call) => call.path.endsWith('/revoke-impact'))).toBe(
      true,
    )
    expect(
      calls.some(
        (call) =>
          call.method === 'DELETE' && call.path.endsWith('/project.use'),
      ),
    ).toBe(false)
  })

  it('diagnoses module and project-role layers before allowing task access', async () => {
    const { calls } = permissionPage()
    await screen.findByRole('heading', { name: '職務起手式' })
    fireEvent.change(screen.getByRole('combobox', { name: '選擇人員' }), {
      target: { value: 'person' },
    })
    fireEvent.change(screen.getByLabelText('專案'), {
      target: { value: 'project-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '檢查有效權限' }))
    expect(await screen.findByText(/缺少「inspection.use」/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '補上缺少的模組權限' }))
    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.method === 'PUT' && call.path.endsWith('/inspection.use'),
        ),
      ).toBe(true)
    })
    fireEvent.click(screen.getByRole('button', { name: '檢查有效權限' }))
    expect(await screen.findByText(/缺少專案角色權限/)).toBeVisible()
    expect(
      screen.getByRole('link', { name: '前往指派專案角色' }),
    ).toHaveAttribute('href', '/admin/projects/project-1/members')
  })

  it('retains direct grants when delegated authority is removed', async () => {
    const { calls } = permissionPage({ permissionCodes: ['inspection.use'] })
    await screen.findByRole('heading', { name: '職務起手式' })
    fireEvent.change(screen.getByRole('combobox', { name: '選擇人員' }), {
      target: { value: 'person' },
    })
    expect(await screen.findByText('能力摘要：使用查核模組')).toBeVisible()
    fireEvent.click(screen.getByText('進階設定：委派、權限組合與逐項授權'))
    const delegation = screen.getByLabelText('可管理 project 模組授權')
    fireEvent.click(delegation)
    await waitFor(() => {
      expect(screen.getByLabelText('可管理 project 模組授權')).toBeChecked()
    })
    fireEvent.click(delegation)
    await waitFor(() => {
      expect(
        screen.getByLabelText('可管理 project 模組授權'),
      ).not.toBeChecked()
    })

    expect(
      calls.some(
        (call) =>
          call.method === 'DELETE' &&
          call.path.includes('/module-delegations/project'),
      ),
    ).toBe(true)
    expect(
      calls.some(
        (call) =>
          call.method === 'DELETE' && call.path.endsWith('/inspection.use'),
      ),
    ).toBe(false)
  })

  it('shows the role-first wizard and plain-language access help', async () => {
    permissionPage()

    expect(
      await screen.findByRole('heading', { name: '職務起手式' }),
    ).toBeVisible()
    expect(screen.getByText('人員能力與快速檢查')).toBeVisible()
    expect(screen.getByText(/任務清單需 inspection\.use/)).toBeVisible()
  })
})
