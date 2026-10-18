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
  failMemberWriteOnce?: boolean
}

function permissionPage(options: FixtureOptions = {}) {
  const permissionCodes = [...(options.permissionCodes ?? [])]
  let failBundleOnce = options.failBundleOnce ?? false
  let memberRoleIds = [...(options.memberRoleIds ?? [])]
  let failMemberWriteOnce = options.failMemberWriteOnce ?? false
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
          ...(memberRoleIds.length || options.memberRoleIds
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
      if (method === 'PUT' && path.endsWith('/members/person/roles')) {
        if (failMemberWriteOnce) {
          failMemberWriteOnce = false
          return Response.json(
            { error: { code: 'project.role_not_assignable' } },
            { status: 422 },
          )
        }
        memberRoleIds = (JSON.parse(body) as { role_ids: string[] }).role_ids
        return Response.json({ user_id: 'person', role_ids: memberRoleIds })
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
        const input = JSON.parse(body) as {
          user_id: string
          role_ids: string[]
        }
        if (input.user_id === 'person') memberRoleIds = input.role_ids
        return Response.json({ id: 'member-1', ...input })
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
  if (profile === '外包顧問') {
    fireEvent.change(screen.getByLabelText('身分'), {
      target: { value: 'external' },
    })
  }
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
    ['系統管理', true, false, null],
    ['內業規劃', false, false, '專案工程師常用'],
    ['現場查核', false, false, '現場工程師常用'],
    ['外包顧問', false, true, '現場工程師常用'],
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
    await chooseProfile('內業規劃')
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
    fireEvent.click(
      screen.getByRole('button', {
        name: '補上缺少的專案角色權限',
      }),
    )
    expect(await screen.findByText(/具備此操作所需的有效權限/)).toBeVisible()
    const memberWrite = calls.find(
      (call) => call.path.endsWith('/members') && call.method === 'POST',
    )
    expect(memberWrite).toBeDefined()
    expect(JSON.parse(memberWrite?.body ?? '{}')).toEqual({
      user_id: 'person',
      role_ids: ['field-role'],
    })
  })

  it('filters job options by identity', async () => {
    const { calls } = permissionPage()
    await screen.findByRole('heading', { name: '職務起手式' })
    fireEvent.change(screen.getByLabelText('身分'), {
      target: { value: 'external' },
    })
    fireEvent.click(screen.getByRole('button', { name: /2\. 職務/ }))

    expect(screen.getByRole('radio', { name: /外包顧問/ })).toBeVisible()
    expect(screen.queryByRole('radio', { name: /系統管理/ })).toBeNull()
    expect(screen.queryByRole('radio', { name: /內業規劃/ })).toBeNull()
    expect(screen.queryByRole('radio', { name: /現場查核/ })).toBeNull()
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('previews abilities and project role in plain language', async () => {
    permissionPage()
    await screen.findByRole('heading', { name: '職務起手式' })
    await fillIdentity('preview.user')
    await chooseProfile('內業規劃')
    fireEvent.click(screen.getByRole('button', { name: /3\. 專案/ }))
    fireEvent.change(screen.getByLabelText('加入專案（可略過）'), {
      target: { value: 'project-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: /4\. 確認/ }))

    expect(screen.getByRole('region', { name: '可以做' })).toHaveTextContent(
      '建立專案',
    )
    expect(screen.getByRole('region', { name: '不能做' })).toHaveTextContent(
      '查看未授權的專案',
    )
    expect(
      screen.getByText(/預設專案角色/, { selector: 'small' }),
    ).toBeVisible()
    expect(screen.getByText(/預設專案角色「專案工程師」/)).toBeVisible()
  })

  it('assigns Admin the selected project role', async () => {
    const { calls } = permissionPage()
    await screen.findByRole('heading', { name: '職務起手式' })
    await fillIdentity('admin.new')
    await chooseProfile('系統管理')
    fireEvent.click(screen.getByRole('button', { name: /3\. 專案/ }))
    fireEvent.change(screen.getByLabelText('加入專案（可略過）'), {
      target: { value: 'project-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: /4\. 確認/ }))
    expect(screen.getByText(/預設專案角色「專案工程師」/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '建立人員' }))

    expect(
      await screen.findByText('帳號、權限組合及所選專案已完成。'),
    ).toBeVisible()
    const memberWrite = calls.find(
      (call) => call.path.endsWith('/members') && call.method === 'POST',
    )
    expect(JSON.parse(memberWrite?.body ?? '{}')).toEqual({
      user_id: 'created-person',
      role_ids: ['office-role'],
    })
    expect(calls.some((call) => call.path.includes(':apply'))).toBe(false)
  })

  it('adds a missing role and preserves existing roles', async () => {
    const { calls } = permissionPage({
      memberRoleIds: ['office-role'],
      permissionCodes: ['inspection.use'],
    })
    await screen.findByRole('heading', { name: '職務起手式' })
    fireEvent.change(screen.getByRole('combobox', { name: '選擇人員' }), {
      target: { value: 'person' },
    })
    expect(await screen.findByText('能力摘要：使用查核模組')).toBeVisible()
    fireEvent.change(screen.getByLabelText('專案'), {
      target: { value: 'project-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '檢查有效權限' }))
    expect(await screen.findByText(/缺少專案角色權限/)).toBeVisible()
    fireEvent.click(
      screen.getByRole('button', {
        name: '補上缺少的專案角色權限',
      }),
    )
    expect(await screen.findByText(/具備此操作所需的有效權限/)).toBeVisible()

    const write = calls.find(
      (call) => call.method === 'PUT' && call.path.endsWith('/roles'),
    )
    expect(write?.method).toBe('PUT')
    expect(JSON.parse(write?.body ?? '{}')).toEqual({
      role_ids: ['office-role', 'field-role'],
    })
  })

  it('keeps membership when role assignment fails', async () => {
    const { calls } = permissionPage({
      failMemberWriteOnce: true,
      memberRoleIds: ['office-role'],
      permissionCodes: ['inspection.use'],
    })
    await screen.findByRole('heading', { name: '職務起手式' })
    fireEvent.change(screen.getByRole('combobox', { name: '選擇人員' }), {
      target: { value: 'person' },
    })
    expect(await screen.findByText('能力摘要：使用查核模組')).toBeVisible()
    fireEvent.change(screen.getByLabelText('專案'), {
      target: { value: 'project-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '檢查有效權限' }))
    expect(await screen.findByText(/缺少專案角色權限/)).toBeVisible()
    fireEvent.click(
      screen.getByRole('button', {
        name: '補上缺少的專案角色權限',
      }),
    )

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(
      calls.filter(
        (call) => call.method === 'PUT' && call.path.endsWith('/roles'),
      ),
    ).toHaveLength(1)
    expect(screen.getByText('目前角色：專案工程師')).toBeVisible()
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
