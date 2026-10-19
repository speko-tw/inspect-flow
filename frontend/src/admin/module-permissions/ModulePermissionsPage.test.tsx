import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { Link } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataMemoryRouter } from '../../testing/DataMemoryRouter'
import ModulePermissionsPage from './ModulePermissionsPage'

const currentUserMock = vi.hoisted(() => vi.fn())

vi.mock('../../auth/useCurrentUser', () => ({
  useCurrentUser: currentUserMock,
}))

interface FixtureOptions {
  permissionCodes?: string[]
  failBundleOnce?: boolean
  missingBundle?: boolean
  missingRole?: boolean
  openWizard?: boolean
  openWizardRequest?: number
  customOvergrantRole?: boolean
  extraFieldRead?: boolean
  renamedDefaults?: boolean
  tamperedNamedBundle?: boolean
  loseMemberResponseOnce?: boolean
  conflictMembershipState?: 'matching' | 'absent' | 'wrong-role'
  memberRoleIds?: string[]
  failMemberWriteOnce?: boolean
  embedded?: boolean
  selectedUserId?: string
  delegateMode?: boolean
  externalAccount?: boolean
  testNavigation?: boolean
  onTemporaryPassword?: (username: string, password: string) => void
  failCreate?: boolean
  participationResponse?: (path: string) => Promise<Response>
  bundleApplyResponse?: (path: string) => Promise<Response>
}

function permissionPage(options: FixtureOptions = {}) {
  currentUserMock.mockReturnValue({
    user: { is_admin: !options.delegateMode },
    clear: vi.fn(),
  })
  const permissionCodes = [...(options.permissionCodes ?? [])]
  let failBundleOnce = options.failBundleOnce ?? false
  let loseMemberResponseOnce = options.loseMemberResponseOnce ?? false
  let memberRoleIds = [...(options.memberRoleIds ?? [])]
  let createdMemberRoleIds: string[] | null = null
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
  if (options.externalAccount) member.is_external_collaborator = true
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
      permission_codes: [
        'project.read',
        'project_inspection_item.read',
        'project_zone.read',
        'inspection_plan.read',
        'inspection_task.read',
        'inspection_task.inspect',
      ],
      user_count: 0,
      project_count: 0,
      created_at: '',
      updated_at: '',
      is_assignable: true,
      is_external_allowed: false,
    },
    {
      id: 'viewer-role',
      name: '專案查閱人員',
      permission_codes: [
        'project.read',
        'project_inspection_item.read',
        'project_zone.read',
        'inspection_plan.read',
        'inspection_task.read',
      ],
      user_count: 0,
      project_count: 0,
      created_at: '',
      updated_at: '',
      is_assignable: true,
      is_external_allowed: true,
    },
  ]
  if (options.customOvergrantRole) {
    roles.push({
      id: 'custom-overgrant',
      name: '自訂查核管理',
      permission_codes: ['inspection_task.read', 'project_member.manage'],
      user_count: 0,
      project_count: 0,
      created_at: '',
      updated_at: '',
      is_assignable: true,
      is_external_allowed: false,
    })
  }
  if (options.extraFieldRead) {
    const fieldRole = roles.find((role) => role.id === 'field-role')
    fieldRole?.permission_codes.push('unrelated.read')
  }
  const bundles = [
    {
      id: 'manager-bundle',
      name: '公司主管',
      permission_codes: ['project.use', 'all_project_progress.read'],
      created_at: '',
      updated_at: '',
    },
    {
      id: 'office-bundle',
      name: '專案工程師常用',
      permission_codes: [
        'project.use',
        'project.create',
        'inspection.use',
        'template.use',
      ],
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
  if (options.tamperedNamedBundle) {
    bundles
      .find((bundle) => bundle.id === 'office-bundle')
      ?.permission_codes.push('template.manage')
  }
  if (options.renamedDefaults) {
    const officeBundle = bundles.find(
      (bundle) => bundle.id === 'office-bundle',
    )
    if (officeBundle) officeBundle.name = '內業預設授權組'
    const officeRole = roles.find((role) => role.id === 'office-role')
    if (officeRole) officeRole.name = '專案負責角色'
  }
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
      if (method === 'GET' && path === '/module-delegate/users') {
        return Response.json({
          items: [
            {
              id: member.id,
              username: member.username,
              name_zh: member.name_zh,
            },
          ],
          next_cursor: null,
        })
      }
      if (method === 'GET' && path === '/companies') {
        return Response.json({ items: [], next_cursor: null })
      }
      if (method === 'GET' && path === '/module-permissions') {
        return Response.json({
          items: options.delegateMode
            ? [
                {
                  code: 'project.use',
                  module: 'project',
                  description: '使用專案功能',
                },
              ]
            : [
                {
                  code: 'project.use',
                  module: 'project',
                  description: '使用專案功能',
                },
                {
                  code: 'inspection.use',
                  module: 'inspection',
                  description: '使用查核功能',
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
        return Response.json({
          items: options.missingBundle ? [] : bundles,
          next_cursor: null,
        })
      }
      if (method === 'GET' && path === '/roles') {
        return Response.json({
          items: options.missingRole
            ? roles.filter((role) => role.name !== '專案工程師')
            : roles,
          next_cursor: null,
        })
      }
      if (method === 'GET' && path === '/roles/creator-role') {
        return Response.json({ role_id: 'office-role' })
      }
      if (method === 'GET' && path === '/projects') {
        return Response.json({
          items: [{ id: 'project-1', name: '示範工程' }],
          next_cursor: null,
        })
      }
      if (method === 'GET' && /\/participating-projects$/.test(path)) {
        if (options.participationResponse) {
          return options.participationResponse(path)
        }
        const projectRoles = roles.filter((role) =>
          memberRoleIds.includes(role.id),
        )
        return Response.json({
          items: memberRoleIds.length
            ? [
                {
                  id: 'project-1',
                  project_code: 'PR-1',
                  name: '示範工程',
                  roles: projectRoles.map(({ id, name }) => ({ id, name })),
                },
              ]
            : [],
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
      if (
        method === 'GET' &&
        /^\/users\/[^/]+\/effective-access$/.test(path)
      ) {
        const projectRoles = roles.filter((role) =>
          memberRoleIds.includes(role.id),
        )
        const roleCodes = projectRoles.flatMap((role) => role.permission_codes)
        const rules = [
          {
            action: 'task_list',
            module: 'inspection',
            required_module_codes: ['inspection.use'],
            required_project_codes: ['inspection_task.read'],
          },
          {
            action: 'create_project',
            module: 'project',
            required_module_codes: ['project.create'],
            required_project_codes: [],
          },
          {
            action: 'manage_template_library',
            module: 'template',
            required_module_codes: ['template.manage'],
            required_project_codes: [],
          },
          {
            action: 'manage_project_members',
            module: 'project',
            required_module_codes: ['project.use'],
            required_project_codes: ['project_member.manage'],
          },
        ]
        return Response.json({
          user: { id: 'person', is_active: true, is_admin: false },
          module_permissions: permissionCodes.map((code) => ({
            code,
            module: code.startsWith('inspection')
              ? 'inspection'
              : code.startsWith('template')
                ? 'template'
                : 'project',
            source: 'manual',
          })),
          project_roles: projectRoles.map((role) => ({
            id: role.id,
            name: role.name,
            permission_codes: role.permission_codes,
          })),
          diagnostics: rules.map((rule) => {
            const missingModule = rule.required_module_codes.filter(
              (code) => !permissionCodes.includes(code),
            )
            const missingProject = rule.required_project_codes.filter(
              (code) => !roleCodes.includes(code),
            )
            const missingLayers = [
              ...(missingModule.length ? ['module'] : []),
              ...(missingProject.length ? ['project_role'] : []),
            ]
            return {
              ...rule,
              allowed: missingLayers.length === 0,
              missing_layers: missingLayers,
              missing_codes: [...missingModule, ...missingProject],
            }
          }),
        })
      }
      if (method === 'GET' && path === '/projects/project-1/members') {
        return Response.json([
          ...(memberRoleIds.length || options.memberRoleIds
            ? [{ user_id: 'person', role_ids: memberRoleIds }]
            : []),
          ...(createdMemberRoleIds !== null &&
          options.conflictMembershipState !== 'absent'
            ? [
                {
                  user_id: 'created-person',
                  role_ids:
                    options.conflictMembershipState === 'wrong-role'
                      ? ['different-role']
                      : createdMemberRoleIds,
                },
              ]
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
        if (options.failCreate) {
          return Response.json(
            { error: { code: 'user.email_conflict' } },
            { status: 409 },
          )
        }
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
        if (options.bundleApplyResponse) {
          return options.bundleApplyResponse(path)
        }
        if (failBundleOnce) {
          failBundleOnce = false
          return Response.json(
            { error: { code: 'permission.bundle_invalid' } },
            { status: 422 },
          )
        }
        const bundleCodes = path.includes('manager-bundle')
          ? ['project.use', 'all_project_progress.read']
          : path.includes('office-bundle')
            ? [
                'project.use',
                'project.create',
                'inspection.use',
                'template.use',
              ]
            : ['project.use', 'inspection.use']
        for (const code of bundleCodes) {
          if (!permissionCodes.includes(code)) permissionCodes.push(code)
        }
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
        if (
          input.user_id === 'created-person' &&
          options.loseMemberResponseOnce
        ) {
          if (loseMemberResponseOnce) {
            loseMemberResponseOnce = false
            createdMemberRoleIds = input.role_ids
            throw new TypeError('Failed to fetch')
          }
          return Response.json(
            { error: { code: 'project.member_conflict' } },
            { status: 409 },
          )
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
  const renderPage = (selectedUserId = options.selectedUserId) => (
    <DataMemoryRouter>
      <>
        <ModulePermissionsPage
          embedded={options.embedded}
          openWizardRequest={options.openWizardRequest}
          selectedUserId={selectedUserId}
          onTemporaryPassword={options.onTemporaryPassword}
        />
        {options.testNavigation && <Link to="/other">離開精靈</Link>}
      </>
    </DataMemoryRouter>
  )
  const view = render(renderPage())
  if (options.openWizard !== false) {
    fireEvent.click(screen.getByRole('button', { name: '新增帳號' }))
  }
  return {
    calls,
    fetchMock,
    getPermissionCodes: () => [...permissionCodes],
    rerender: view.rerender,
    rerenderSelectedUser: (userId: string) =>
      view.rerender(renderPage(userId)),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

async function chooseProfile(profile: string, projectId?: string) {
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  fireEvent.click(screen.getByRole('radio', { name: new RegExp(profile) }))
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  if (projectId) {
    fireEvent.change(screen.getByLabelText('加入專案（可略過）'), {
      target: { value: projectId },
    })
  }
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
}

async function fillIdentity(username: string) {
  fireEvent.change(screen.getByLabelText('帳號名稱'), {
    target: { value: username },
  })
  fireEvent.change(screen.getByLabelText('姓名'), {
    target: { value: '林沐青' },
  })
  fireEvent.change(screen.getByLabelText('電子郵件'), {
    target: { value: `${username}@example.test` },
  })
}

function assignCandidateRole(roleName: string) {
  const chooser = screen.getByRole('region', { name: '可選專案角色' })
  const quickAction = within(chooser).queryByRole('button', {
    name: `補上「${roleName}」角色`,
  })
  if (quickAction) {
    fireEvent.click(quickAction)
    return
  }
  fireEvent.click(
    within(chooser).getByRole('radio', {
      name: new RegExp(roleName),
    }),
  )
  fireEvent.click(
    within(chooser).getByRole('button', { name: '指派所選角色' }),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('ModulePermissionsPage', () => {
  it('resets and opens the wizard for each external add-account request', async () => {
    const page = (request: number) => (
      <DataMemoryRouter>
        <ModulePermissionsPage embedded openWizardRequest={request} />
      </DataMemoryRouter>
    )
    const { rerender } = permissionPage({
      openWizard: false,
      embedded: true,
      openWizardRequest: 0,
    })
    expect(screen.queryByRole('heading', { name: '新增帳號' })).toBeNull()

    rerender(page(1))
    await screen.findByRole('heading', { name: '設定帳號' })
    fireEvent.change(screen.getByLabelText('帳號名稱'), {
      target: { value: 'first.draft' },
    })

    rerender(page(2))
    expect(await screen.findByLabelText('帳號名稱')).toHaveValue('')
  })

  it('shows the localized account conflict after a rejected create request', async () => {
    permissionPage({ failCreate: true })
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('conflict.account')
    await chooseProfile('系統管理')
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Email 已被使用。',
    )
  })

  it('hands a created account password to the containing admin page', async () => {
    const onTemporaryPassword = vi.fn()
    permissionPage({ onTemporaryPassword })
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('handoff.account')
    await chooseProfile('系統管理')
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))

    await waitFor(() =>
      expect(onTemporaryPassword).toHaveBeenCalledWith(
        'handoff.account',
        'temporary-secret',
      ),
    )
  })

  it('guards an unfinished account wizard from SPA navigation and beforeunload', async () => {
    permissionPage({ testNavigation: true })
    await screen.findByRole('heading', { name: '新增帳號' })
    fireEvent.change(screen.getByLabelText('帳號名稱'), {
      target: { value: 'draft.account' },
    })

    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)

    fireEvent.click(screen.getByRole('link', { name: '離開精靈' }))
    expect(
      await screen.findByRole('heading', { name: '有尚未儲存的變更' }),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '保留編輯' }))
    expect(screen.getByRole('heading', { name: '新增帳號' })).toBeVisible()
  })

  it('loads only delegated people and permission options for a delegate', async () => {
    const { calls } = permissionPage({
      openWizard: false,
      embedded: true,
      selectedUserId: 'person',
      delegateMode: true,
    })

    await screen.findByRole('heading', { name: '權限' })

    expect(calls.some((call) => call.path === '/module-delegate/users')).toBe(
      true,
    )
    expect(calls.some((call) => call.path === '/users')).toBe(false)
    expect(calls.some((call) => call.path === '/roles')).toBe(false)
    expect(calls.some((call) => call.path === '/permission-bundles')).toBe(
      false,
    )
    expect(
      screen.getByLabelText('使用專案功能').closest('label'),
    ).toBeInTheDocument()
    expect(screen.queryByText('管理查核模組')).toBeNull()
    expect(screen.queryByRole('heading', { name: '能做什麼' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '套用權限組合' })).toBeNull()
    expect(screen.queryByText('角色治理')).toBeNull()
    expect(screen.queryByRole('heading', { name: '角色治理' })).toBeNull()
    expect(screen.queryByLabelText('使用查核功能')).toBeNull()
    expect(screen.queryByRole('heading', { name: '基本資料' })).toBeNull()
    expect(screen.queryByRole('button', { name: '修改資料' })).toBeNull()
    expect(screen.queryByRole('button', { name: '新增帳號' })).toBeNull()
    expect(screen.queryByText('操作紀錄')).toBeNull()
  })

  it('shows the named success notice after a delegate explicitly opens access', async () => {
    const { calls } = permissionPage({
      openWizard: false,
      embedded: true,
      selectedUserId: 'person',
      delegateMode: true,
    })
    await screen.findByRole('heading', { name: '權限' })
    const checkbox = await screen.findByLabelText('使用專案功能')
    fireEvent.click(checkbox)
    expect(
      calls.filter(
        (call) =>
          call.method === 'PUT' && call.path.includes('/module-permissions/'),
      ),
    ).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: '開通' }))

    expect(
      await screen.findByText('已為林沐青開通使用專案功能。', {
        selector: 'p[role="status"]',
      }),
    ).toBeVisible()
    expect(
      calls.filter(
        (call) =>
          call.method === 'PUT' &&
          call.path === '/users/person/module-permissions/project.use',
      ),
    ).toHaveLength(1)
    expect(
      calls.filter(
        (call) =>
          call.method === 'GET' &&
          call.path === '/users/person/module-permissions',
      ),
    ).toHaveLength(2)
  })

  it('applies a job to an existing person without creating an account', async () => {
    const { calls, getPermissionCodes } = permissionPage({
      openWizard: false,
      embedded: true,
      selectedUserId: 'person',
      permissionCodes: ['template.manage'],
      memberRoleIds: ['viewer-role'],
    })

    fireEvent.click(
      await screen.findByRole('button', { name: '重新套用職務' }),
    )
    expect(screen.getByText(/依職務補上功能/)).toBeVisible()
    expect(screen.getByText(/依職務補上功能/)).toHaveTextContent(
      '職務含專案角色',
    )
    expect(screen.getByText(/依職務補上功能/)).toHaveTextContent(
      '不移除既有功能或角色',
    )
    fireEvent.click(screen.getByRole('radio', { name: /內業規劃/ }))
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    fireEvent.change(screen.getByLabelText('加入專案（可略過）'), {
      target: { value: 'project-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    const applyButtons = screen.getAllByRole('button', { name: '套用職務' })
    fireEvent.click(applyButtons[applyButtons.length - 1])

    expect(
      await screen.findByText('林沐青 的職務與授權設定已完成。'),
    ).toBeInTheDocument()
    expect(
      calls.some((call) => call.method === 'POST' && call.path === '/users'),
    ).toBe(false)
    const membershipUpdate = calls.find(
      (call) =>
        call.method === 'PUT' &&
        call.path === '/projects/project-1/members/person/roles',
    )
    expect(membershipUpdate?.body).toContain('viewer-role')
    expect(membershipUpdate?.body).toContain('office-role')
    expect(getPermissionCodes()).toEqual(
      expect.arrayContaining([
        'template.manage',
        'project.use',
        'project.create',
        'inspection.use',
        'template.use',
      ]),
    )
    expect(
      calls.some(
        (call) =>
          call.method === 'DELETE' &&
          call.path.includes('/module-permissions/'),
      ),
    ).toBe(false)
  })

  it('rejects an external job for an internal account before any writes', async () => {
    const { calls } = permissionPage({
      openWizard: false,
      embedded: true,
      selectedUserId: 'person',
    })

    fireEvent.click(
      await screen.findByRole('button', { name: '重新套用職務' }),
    )
    fireEvent.click(screen.getByRole('radio', { name: /外部協作/ }))
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    fireEvent.click(
      screen.getAllByRole('button', { name: '套用職務' }).at(-1)!,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '帳號外部身分與所選職務不符，未變更授權。',
    )
    expect(calls.some((call) => call.method !== 'GET')).toBe(false)
  })

  it('applies the external job to an imported zero-permission account', async () => {
    const { calls } = permissionPage({
      openWizard: false,
      embedded: true,
      selectedUserId: 'person',
      externalAccount: true,
    })

    fireEvent.click(
      await screen.findByRole('button', { name: '重新套用職務' }),
    )
    fireEvent.click(screen.getByRole('radio', { name: /外部協作/ }))
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    fireEvent.click(
      screen.getAllByRole('button', { name: '套用職務' }).at(-1)!,
    )

    expect(
      await screen.findByText('林沐青 的職務與授權設定已完成。'),
    ).toBeInTheDocument()
    expect(
      calls.some((call) => call.method === 'POST' && call.path === '/users'),
    ).toBe(false)
    expect(
      calls.some((call) =>
        call.path.endsWith('/permission-bundles/field-bundle:apply'),
      ),
    ).toBe(true)
  })

  it('links participation in the account ability summary', async () => {
    permissionPage({
      openWizard: false,
      embedded: true,
      selectedUserId: 'person',
      memberRoleIds: ['viewer-role'],
    })

    const summary = await screen.findByRole('region', {
      name: '帳號能力摘要',
    })
    expect(
      within(summary).getByRole('heading', { name: '參與專案與角色' }),
    ).toBeVisible()
    expect(
      within(summary).queryByRole('heading', { name: '參與專案' }),
    ).toBeNull()
    expect(
      await within(summary).findByRole('link', {
        name: 'PR-1／示範工程',
      }),
    ).toHaveAttribute('href', '/projects/project-1/members')
  })

  it('can retry loading projects in the ability summary', async () => {
    let attempts = 0
    permissionPage({
      openWizard: false,
      embedded: true,
      selectedUserId: 'person',
      participationResponse: async () => {
        attempts += 1
        return attempts === 1
          ? Response.json({ error: { code: 'forbidden' } }, { status: 403 })
          : Response.json({
              items: [
                {
                  id: 'project-1',
                  project_code: 'PR-1',
                  name: '示範工程',
                  roles: [],
                },
              ],
            })
      },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '目前無法載入參與專案。',
    )
    const retryButton = screen.getByRole('button', {
      name: '重新載入參與專案',
    })
    fireEvent.click(retryButton)
    expect(
      await screen.findByRole('link', { name: 'PR-1／示範工程' }),
    ).toBeVisible()
    expect(attempts).toBe(2)
  })

  it.each([
    ['task-list', true],
    ['create-project', false],
    ['template', false],
    ['members', true],
  ])(
    'shows a project selector for %s only when the check needs a project',
    async (action, needsProject) => {
      permissionPage({
        openWizard: false,
        embedded: true,
        selectedUserId: 'person',
      })
      const summary = await screen.findByRole('region', {
        name: '帳號能力摘要',
      })
      const heading = within(summary).getByRole('heading', {
        name: '為什麼他不能做這件事？',
      })
      const actionSelect = within(summary).getByLabelText('要檢查的操作')
      fireEvent.change(actionSelect, { target: { value: action } })

      expect(
        Boolean(
          heading.compareDocumentPosition(actionSelect) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ).toBe(true)
      if (needsProject) {
        expect(within(summary).getByLabelText('專案')).toBeVisible()
      } else {
        expect(within(summary).queryByLabelText('專案')).toBeNull()
      }
      const checkButton = within(summary).getByRole('button', {
        name: '檢查',
      })
      expect(
        Boolean(
          heading.compareDocumentPosition(checkButton) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ).toBe(true)
    },
  )

  it('uses plain manager and external job descriptions', async () => {
    permissionPage()
    await screen.findByRole('heading', { name: '新增帳號' })
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))

    const managerOption = screen
      .getByRole('radio', { name: /主管/ })
      .closest('label')
    const externalOption = screen
      .getByRole('radio', { name: /外部協作/ })
      .closest('label')
    expect(managerOption).toHaveTextContent('查看全公司專案進度')
    expect(managerOption).not.toHaveTextContent('權限組合')
    expect(managerOption).not.toHaveTextContent('外部可用功能')
    expect(externalOption).toHaveTextContent('只看被加入的專案')
    expect(externalOption).not.toHaveTextContent('權限組合')
    expect(externalOption).not.toHaveTextContent('外部可用功能')
    expect(screen.queryByText(/系統管理者不套用/)).toBeNull()
  })

  it('avoids repeating the account title in the embedded wizard', async () => {
    permissionPage({
      openWizard: false,
      embedded: true,
      openWizardRequest: 1,
    })

    expect(
      await screen.findByRole('heading', { name: '設定帳號' }),
    ).toBeVisible()
    expect(screen.queryByRole('heading', { name: '新增帳號' })).toBeNull()
  })

  it('allows previous navigation on steps two through four', async () => {
    permissionPage()
    await screen.findByRole('heading', { name: '新增帳號' })

    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByText('步驟 2／4：職務')).toBeVisible()
    const stepTwoPrevious = screen.getByRole('button', { name: '上一步' })
    expect(stepTwoPrevious).toBeEnabled()
    fireEvent.click(stepTwoPrevious)
    expect(screen.getByText('步驟 1／4：帳號資料')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    fireEvent.click(screen.getByRole('radio', { name: /內業規劃/ }))
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByText('步驟 3／4：專案')).toBeVisible()
    const stepThreePrevious = screen.getByRole('button', { name: '上一步' })
    expect(stepThreePrevious).toBeEnabled()
    fireEvent.click(stepThreePrevious)
    expect(screen.getByText('步驟 2／4：職務')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByText('步驟 4／4：確認')).toBeVisible()
    const stepFourPrevious = screen.getByRole('button', { name: '上一步' })
    expect(stepFourPrevious).toBeEnabled()
    fireEvent.click(stepFourPrevious)
    expect(screen.getByText('步驟 3／4：專案')).toBeVisible()
  })

  it.each([
    ['系統管理', true, false, null],
    ['主管', false, false, '公司主管'],
    ['內業規劃', false, false, '專案工程師常用'],
    ['現場查核', false, false, '現場工程師常用'],
    ['外部協作', false, true, '現場工程師常用'],
  ])(
    'creates the %s profile with its approved access bundle',
    async (label, isAdmin, isExternal, bundleName) => {
      const { calls } = permissionPage()
      await screen.findByRole('heading', { name: '新增帳號' })
      await fillIdentity(`new.${String(label)}`)
      await chooseProfile(String(label))

      expect(
        screen.getByText(
          (_, element) =>
            element?.textContent === `林沐青將以「${String(label)}」加入。`,
        ),
      ).toBeVisible()
      fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))

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
        const bundleId = {
          公司主管: 'manager-bundle',
          專案工程師常用: 'office-bundle',
          現場工程師常用: 'field-bundle',
        }[String(bundleName)]
        expect(applyCall?.path).toContain(bundleId)
      }
    },
  )

  it('keeps account setup incomplete when the first bundle application fails', async () => {
    const { calls } = permissionPage({ failBundleOnce: true })
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('retry.user')
    await chooseProfile('內業規劃')
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))

    expect(await screen.findByText(/帳號已建立；後續授權/)).toBeVisible()
    expect(
      await screen.findByRole('heading', { name: '新增帳號' }),
    ).toBeVisible()
    expect(
      calls.filter((call) => call.path === '/users' && call.method === 'POST'),
    ).toHaveLength(1)
  })

  it('shows progress without partial failure actions while provisioning is pending', async () => {
    const applyStarted = deferred<void>()
    const applyResponse = deferred<Response>()
    permissionPage({
      bundleApplyResponse: async () => {
        applyStarted.resolve()
        return applyResponse.promise
      },
    })
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('pending.user')
    await chooseProfile('內業規劃')
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))

    await applyStarted.promise
    expect(
      await screen.findByText('正在完成…', { selector: 'p[role="status"]' }),
    ).toBeVisible()
    expect(screen.queryByText(/後續授權或專案加入未完成/)).toBeNull()
    expect(
      screen.queryByRole('button', { name: '重試未完成的步驟' }),
    ).toBeNull()

    await act(async () => {
      applyResponse.resolve(Response.json({ granted_codes: ['project.use'] }))
      await applyResponse.promise
    })
    expect(await screen.findByRole('heading', { name: '帳號已建立' }))
  })

  it('retries only unfinished setup steps after account creation', async () => {
    const { calls } = permissionPage({ failBundleOnce: true })
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('retry.only')
    await chooseProfile('內業規劃')
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))

    expect(
      await screen.findByRole('button', { name: '重試未完成的步驟' }),
    ).toBeVisible()
    expect(
      calls.filter((call) => call.path === '/users' && call.method === 'POST'),
    ).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '重試未完成的步驟' }))

    expect(
      await screen.findByRole('heading', { name: '帳號已建立' }),
    ).toBeVisible()
    expect(
      calls.filter((call) => call.path === '/users' && call.method === 'POST'),
    ).toHaveLength(1)
    expect(calls.filter((call) => call.path.includes(':apply'))).toHaveLength(
      2,
    )
  })

  it('reconciles a member conflict after the add response is lost', async () => {
    const { calls } = permissionPage({ loseMemberResponseOnce: true })
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('member.retry')
    await chooseProfile('內業規劃', 'project-1')
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))

    expect(
      await screen.findByText(/帳號已建立；後續授權或專案加入未完成/),
    ).toBeVisible()
    expect(
      calls.filter((call) => call.method === 'POST' && call.path === '/users'),
    ).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '重試未完成的步驟' }))

    expect(
      await screen.findByRole('heading', { name: '帳號已建立' }),
    ).toBeVisible()
    expect(
      calls.filter((call) => call.method === 'POST' && call.path === '/users'),
    ).toHaveLength(1)
    expect(
      calls.filter(
        (call) =>
          call.method === 'POST' &&
          call.path === '/projects/project-1/members',
      ),
    ).toHaveLength(2)
    expect(
      calls.some(
        (call) =>
          call.method === 'GET' && call.path === '/projects/project-1/members',
      ),
    ).toBe(true)
  })

  it.each(['absent', 'wrong-role'] as const)(
    'keeps a member conflict incomplete when membership is %s',
    async (conflictMembershipState) => {
      const { calls } = permissionPage({
        loseMemberResponseOnce: true,
        conflictMembershipState,
      })
      await screen.findByRole('heading', { name: '新增帳號' })
      await fillIdentity(`member.${conflictMembershipState}`)
      await chooseProfile('內業規劃', 'project-1')
      fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))
      await screen.findByText(/帳號已建立；後續授權或專案加入未完成/)
      fireEvent.click(screen.getByRole('button', { name: '重試未完成的步驟' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(/409/)
      expect(screen.queryByRole('heading', { name: '帳號已建立' })).toBeNull()
      expect(
        calls.filter(
          (call) => call.method === 'POST' && call.path === '/users',
        ),
      ).toHaveLength(1)
    },
  )

  it.each([
    ['權限組合', { missingBundle: true }],
    ['預設專案角色', { missingRole: true }],
  ])('preflights the %s before creating an account', async (_, options) => {
    const { calls } = permissionPage(options)
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('preflight.user')
    await chooseProfile('內業規劃')
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/無法建立/)
    expect(
      calls.filter((call) => call.path === '/users' && call.method === 'POST'),
    ).toHaveLength(0)
  })

  it('resolves renamed defaults from API identity and permission signature', async () => {
    const { calls } = permissionPage({ renamedDefaults: true })
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('renamed.defaults')
    await chooseProfile('內業規劃', 'project-1')
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))

    expect(
      await screen.findByRole('heading', { name: '帳號已建立' }),
    ).toBeVisible()
    expect(
      calls.some(
        (call) =>
          call.path ===
          '/users/created-person/permission-bundles/office-bundle:apply',
      ),
    ).toBe(true)
    expect(
      calls.some(
        (call) =>
          call.path === '/projects/project-1/members' &&
          call.method === 'POST' &&
          JSON.parse(call.body).role_ids[0] === 'office-role',
      ),
    ).toBe(true)
  })

  it('rejects a named default bundle with a changed permission signature', async () => {
    const { calls } = permissionPage({ tamperedNamedBundle: true })
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('tampered.bundle')
    await chooseProfile('內業規劃')
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/無法建立/)
    expect(
      calls.filter((call) => call.path === '/users' && call.method === 'POST'),
    ).toHaveLength(0)
  })

  it('shows the temporary password on the completion screen', async () => {
    permissionPage()
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('password.user')
    await chooseProfile('內業規劃')
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))

    expect(await screen.findByLabelText('臨時密碼')).toHaveTextContent(
      'temporary-secret',
    )
    expect(screen.getByText(/離開此畫面後就無法再查看/)).toBeVisible()
  })

  it('creates a field account, adds it to a project, and shows its password', async () => {
    const { calls } = permissionPage()
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('field.account')
    await chooseProfile('現場查核', 'project-1')
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))

    expect(await screen.findByLabelText('臨時密碼')).toHaveTextContent(
      'temporary-secret',
    )
    expect(
      calls.some(
        (call) =>
          call.method === 'POST' &&
          call.path === '/projects/project-1/members' &&
          JSON.parse(call.body).role_ids[0] === 'field-role',
      ),
    ).toBe(true)
  })

  it('submits all supported account profile fields from the wizard', async () => {
    const { calls } = permissionPage()
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('profile.fields')
    fireEvent.change(screen.getByLabelText('英文姓名'), {
      target: { value: 'Muqing Lin' },
    })
    fireEvent.change(screen.getByLabelText('部門'), {
      target: { value: '工程部' },
    })
    fireEvent.change(screen.getByLabelText('地點'), {
      target: { value: '台北' },
    })
    fireEvent.change(screen.getByLabelText('工號'), {
      target: { value: 'E-123' },
    })
    await chooseProfile('內業規劃')
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))

    await waitFor(() => {
      const create = calls.find(
        (call) => call.path === '/users' && call.method === 'POST',
      )
      expect(JSON.parse(create?.body ?? '{}')).toMatchObject({
        name_en: 'Muqing Lin',
        department: '工程部',
        location: '台北',
        employee_no: 'E-123',
      })
    })
  })

  it('opens a focused wizard with a single-line current-step label', async () => {
    permissionPage({ openWizard: false })
    await screen.findByRole('heading', { name: '帳號權限' })

    expect(screen.getByRole('button', { name: '新增帳號' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: '新增帳號' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '新增帳號' }))
    expect(
      await screen.findByRole('heading', { name: '新增帳號' }),
    ).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('步驟 1／4：帳號資料')
    expect(screen.queryByText('帳號清單')).toBeNull()
  })

  it('marks the active step for assistive technology', async () => {
    permissionPage()
    await screen.findByRole('heading', { name: '新增帳號' })

    expect(screen.getByRole('status')).toHaveTextContent('步驟 1／4：帳號資料')
    expect(screen.queryByText('尚未開始')).toBeNull()
  })

  it('keeps summary visible and grants advanced', async () => {
    const { calls } = permissionPage({
      openWizard: false,
      permissionCodes: ['project.use'],
    })
    await screen.findByRole('heading', { name: '帳號權限' })
    fireEvent.click(screen.getByRole('button', { name: '林沐青' }))
    const summaryText = /能使用：/
    const capabilitySummary = await screen.findByText(summaryText)
    expect(capabilitySummary).toBeVisible()
    const advancedSummary = screen.getByText('進階設定')
    expect(advancedSummary.closest('details')).not.toHaveAttribute('open')
    const permissionsPanel = screen.getByRole('heading', {
      name: '已設定的權限',
    }).parentElement!
    expect(permissionsPanel.closest('details')).not.toHaveAttribute('open')

    fireEvent.click(advancedSummary)
    const grant = within(permissionsPanel).getByRole('checkbox', {
      name: '使用查核功能',
    })
    expect(grant).toBeVisible()
    fireEvent.click(grant)
    await waitFor(() => expect(grant).toBeChecked())
    expect(
      calls.some(
        (call) =>
          call.method === 'PUT' && call.path.endsWith('/inspection.use'),
      ),
    ).toBe(false)
    fireEvent.click(screen.getAllByRole('button', { name: '開通' })[0])
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === 'PUT' && call.path.endsWith('/inspection.use'),
        ),
      ).toBe(true),
    )

    const permission = within(permissionsPanel).getByRole('checkbox', {
      name: '使用專案功能',
    })
    fireEvent.click(permission)
    expect(permission).not.toBeChecked()
    expect(
      calls.some(
        (call) =>
          call.method === 'DELETE' && call.path.endsWith('/project.use'),
      ),
    ).toBe(false)
    fireEvent.click(
      within(permissionsPanel).getByRole('button', { name: '開通' }),
    )
    expect(
      await screen.findByRole('heading', {
        name: '確認收回權限',
      }),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    await waitFor(() => {
      expect(
        screen.queryByRole('heading', {
          name: '確認收回權限',
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
    const { calls } = permissionPage({ openWizard: false })
    await screen.findByRole('heading', { name: '帳號權限' })
    fireEvent.click(screen.getByRole('button', { name: '林沐青' }))
    expect(await screen.findByText(/能使用：/)).toBeVisible()
    fireEvent.change(screen.getByLabelText('專案'), {
      target: { value: 'project-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '檢查' }))
    expect(await screen.findByText(/缺少查核功能的權限/)).toBeVisible()
    const summary = screen.getByRole('region', { name: '帳號能力摘要' })
    fireEvent.click(
      within(summary).getByRole('button', {
        name: '選取要開通的權限',
      }),
    )
    expect(
      screen
        .getAllByLabelText('使用查核功能')
        .some((input) => (input as HTMLInputElement).checked),
    ).toBe(true)
    expect(
      calls.some(
        (call) =>
          call.method === 'PUT' && call.path.endsWith('/inspection.use'),
      ),
    ).toBe(false)
    fireEvent.click(within(summary).getByRole('button', { name: '開通' }))
    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.method === 'PUT' && call.path.endsWith('/inspection.use'),
        ),
      ).toBe(true)
    })
    fireEvent.click(screen.getByRole('button', { name: '檢查' }))
    expect(
      await screen.findByText(/沒有可以查看或執行任務的角色/),
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: '前往專案成員設定' }),
    ).toHaveAttribute('href', '/projects/project-1/members')
    assignCandidateRole('現場工程師')
    expect(await screen.findByText(/具備此操作所需的有效權限/)).toBeVisible()
    expect(
      calls.filter((call) => call.path.endsWith('/effective-access')),
    ).toHaveLength(3)
    const memberWrite = calls.find(
      (call) => call.path.endsWith('/members') && call.method === 'POST',
    )
    expect(memberWrite).toBeDefined()
    expect(JSON.parse(memberWrite?.body ?? '{}')).toEqual({
      user_id: 'person',
      role_ids: ['field-role'],
    })
  })

  it('never auto-selects a custom role that adds member management', async () => {
    const { calls } = permissionPage({
      openWizard: false,
      customOvergrantRole: true,
      extraFieldRead: true,
      permissionCodes: ['inspection.use'],
    })
    await screen.findByRole('heading', { name: '帳號權限' })
    fireEvent.click(screen.getByRole('button', { name: '林沐青' }))
    expect(await screen.findByText(/能使用：/)).toBeVisible()
    fireEvent.change(screen.getByLabelText('專案'), {
      target: { value: 'project-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '檢查' }))

    expect(
      await screen.findByText(/沒有可以查看或執行任務的角色/),
    ).toBeVisible()
    expect(
      screen.getByRole('region', { name: '帳號能力摘要' }),
    ).toHaveTextContent('能使用：使用查核功能')
    const candidateChooser = screen.getByRole('region', {
      name: '可選專案角色',
    })
    expect(
      within(candidateChooser).getByRole('radio', { name: /現場工程師/ }),
    ).toBeVisible()
    expect(within(candidateChooser).getByText(/管理專案成員/)).toBeVisible()
    expect(
      within(candidateChooser).queryByRole('button', {
        name: '補上「現場工程師」角色',
      }),
    ).toBeNull()
    fireEvent.click(
      within(candidateChooser).getByRole('radio', { name: /現場工程師/ }),
    )
    fireEvent.click(
      within(candidateChooser).getByRole('button', { name: '指派所選角色' }),
    )
    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.method === 'POST' &&
            call.path.endsWith('/members') &&
            JSON.parse(call.body).role_ids[0] === 'field-role',
        ),
      ).toBe(true)
    })
    expect(
      calls.some(
        (call) =>
          call.method === 'POST' &&
          call.path.endsWith('/members') &&
          JSON.parse(call.body).role_ids.includes('custom-overgrant'),
      ),
    ).toBe(false)
  })

  it('auto-selects only a unique exact task-list permission role', async () => {
    permissionPage({
      openWizard: false,
      permissionCodes: ['inspection.use'],
    })
    await screen.findByRole('heading', { name: '帳號權限' })
    fireEvent.click(screen.getByRole('button', { name: '林沐青' }))
    expect(await screen.findByText(/能使用：/)).toBeVisible()
    fireEvent.change(screen.getByLabelText('專案'), {
      target: { value: 'project-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '檢查' }))

    expect(
      await screen.findByRole('button', { name: '補上「現場工程師」角色' }),
    ).toBeVisible()
    expect(
      screen.getByRole('region', { name: '帳號能力摘要' }),
    ).toHaveTextContent('能使用：使用查核功能')
    expect(screen.queryByRole('button', { name: '指派所選角色' })).toBeNull()
  })

  it('offers all five jobs without a separate identity step', async () => {
    const { calls } = permissionPage()
    await screen.findByRole('heading', { name: '新增帳號' })
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))

    for (const job of [
      '系統管理',
      '主管',
      '內業規劃',
      '現場查核',
      '外部協作',
    ]) {
      const option = screen.getByRole('radio', { name: new RegExp(job) })
      expect(option).toBeVisible()
      expect(option).not.toBeChecked()
    }
    expect(screen.queryByLabelText('身分')).toBeNull()
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('previews abilities and project role in plain language', async () => {
    permissionPage()
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('preview.user')
    await chooseProfile('內業規劃', 'project-1')

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
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('admin.new')
    await chooseProfile('系統管理', 'project-1')
    expect(screen.getByText(/預設專案角色「專案工程師」/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))

    expect(
      await screen.findByRole('heading', { name: '帳號已建立' }),
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
      openWizard: false,
      memberRoleIds: ['office-role'],
      permissionCodes: ['inspection.use'],
    })
    await screen.findByRole('heading', { name: '帳號權限' })
    fireEvent.click(screen.getByRole('button', { name: '林沐青' }))
    expect(await screen.findByText(/能使用：/)).toBeVisible()
    fireEvent.change(screen.getByLabelText('專案'), {
      target: { value: 'project-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '檢查' }))
    expect(
      await screen.findByText(/沒有可以查看或執行任務的角色/),
    ).toBeVisible()
    assignCandidateRole('現場工程師')
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
      openWizard: false,
      failMemberWriteOnce: true,
      memberRoleIds: ['office-role'],
      permissionCodes: ['inspection.use'],
    })
    await screen.findByRole('heading', { name: '帳號權限' })
    fireEvent.click(screen.getByRole('button', { name: '林沐青' }))
    expect(await screen.findByText(/能使用：/)).toBeVisible()
    fireEvent.change(screen.getByLabelText('專案'), {
      target: { value: 'project-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '檢查' }))
    expect(
      await screen.findByText(/沒有可以查看或執行任務的角色/),
    ).toBeVisible()
    assignCandidateRole('現場工程師')

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(
      calls.filter(
        (call) => call.method === 'PUT' && call.path.endsWith('/roles'),
      ),
    ).toHaveLength(1)
    expect(
      screen.getByRole('region', { name: '帳號能力摘要' }),
    ).toHaveTextContent('PR-1／示範工程：專案工程師')
  })

  it('retains direct grants when delegated authority is removed', async () => {
    const { calls } = permissionPage({
      embedded: false,
      openWizard: false,
      selectedUserId: 'person',
      delegateMode: false,
      permissionCodes: ['inspection.use'],
    })
    await screen.findByRole('heading', {
      name: '帳號能力與快速檢查',
    })
    fireEvent.click(screen.getByText('進階設定'))
    const delegation = screen.getByLabelText('可管理專案權限')
    fireEvent.click(delegation)
    await waitFor(() => {
      expect(screen.getByLabelText('可管理專案權限')).toBeChecked()
    })
    fireEvent.click(delegation)
    await waitFor(() => {
      expect(screen.getByLabelText('可管理專案權限')).not.toBeChecked()
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

  it('hides prior participation while the selected account loads', async () => {
    const firstResponse = deferred<Response>()
    const secondResponse = deferred<Response>()
    const { calls, rerenderSelectedUser } = permissionPage({
      embedded: true,
      openWizard: false,
      selectedUserId: 'person-one',
      participationResponse: (path) =>
        path.includes('person-one')
          ? firstResponse.promise
          : secondResponse.promise,
    })

    await waitFor(() => {
      expect(
        calls.some((call) => call.path.includes('person-one/participating')),
      ).toBe(true)
    })
    rerenderSelectedUser('person-two')

    expect(await screen.findByText('載入參與專案…')).toBeVisible()
    expect(screen.queryByText(/PR-1／示範工程/)).toBeNull()
    await act(async () => {
      secondResponse.resolve(
        Response.json({
          items: [
            {
              id: 'project-two',
              project_code: 'PR-2',
              name: '第二個工程',
              roles: [],
            },
          ],
        }),
      )
    })
    expect(await screen.findByText(/PR-2／第二個工程/)).toBeVisible()

    await act(async () => {
      firstResponse.resolve(
        Response.json({
          items: [
            {
              id: 'project-one',
              project_code: 'PR-1',
              name: '第一個工程',
              roles: [],
            },
          ],
        }),
      )
    })
    expect(screen.queryByText(/PR-1／第一個工程/)).toBeNull()
  })

  it('shows the role-first wizard and plain-language access help', async () => {
    permissionPage()

    expect(
      await screen.findByRole('heading', { name: '新增帳號' }),
    ).toBeVisible()
    expect(screen.queryByText('帳號清單')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('步驟 1／4：帳號資料')
  })
})
