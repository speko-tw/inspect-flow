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
  candidateRoleComparison?: boolean
  externalAccount?: boolean
  permissionOptions?: Array<{
    code: string
    module: string
    description: string
  }>
  testNavigation?: boolean
  onTemporaryPassword?: (username: string, password: string) => void
  onTemporaryPasswordVisible?: (visible: boolean) => void
  onRequestTemporaryPasswordLeave?: (action: () => void) => void
  onWizardBackToList?: () => void
  onWizardViewUser?: (id: string) => void
  failCreate?: boolean
  createUserResponse?: Promise<Response>
  failUserAccess?: boolean
  failUserAccessOnce?: boolean
  failUserCatalogOnce?: boolean
  failPermissionCatalogOnce?: boolean
  userCatalogResponse?: () => Promise<Response>
  permissionCatalogResponse?: () => Promise<Response>
  failCreatorWrite?: boolean
  diagnosticResponse?: () => Promise<Response>
  accessResponse?: (userId: string) => Promise<Response>
  participationResponse?: (path: string) => Promise<Response>
  bundleApplyResponse?: (path: string) => Promise<Response>
  projectCatalogResponse?: () => Promise<Response>
  bundleCatalogResponse?: () => Promise<Response>
}

function permissionPage(options: FixtureOptions = {}) {
  currentUserMock.mockReturnValue({
    user: { id: 'person', is_admin: !options.delegateMode },
    clear: vi.fn(),
  })
  const permissionCodes = [...(options.permissionCodes ?? [])]
  let failBundleOnce = options.failBundleOnce ?? false
  let loseMemberResponseOnce = options.loseMemberResponseOnce ?? false
  let memberRoleIds = [...(options.memberRoleIds ?? [])]
  let createdMemberRoleIds: string[] | null = null
  let failMemberWriteOnce = options.failMemberWriteOnce ?? false
  let failUserAccessOnce = options.failUserAccessOnce ?? false
  let failUserCatalogOnce = options.failUserCatalogOnce ?? false
  let failPermissionCatalogOnce = options.failPermissionCatalogOnce ?? false
  const member = {
    id: 'person',
    username: 'person.one',
    email: 'person@example.test',
    name_zh: '林沐青',
    name_en: null,
    company_id: null,
    company_name: null,
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
      id: 'current-role',
      name: '目前角色',
      permission_codes: ['project.read', 'project_member.manage'],
      user_count: 0,
      project_count: 0,
      created_at: '',
      updated_at: '',
      is_assignable: true,
      is_external_allowed: false,
    },
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
  if (options.candidateRoleComparison) {
    roles[0].permission_codes = ['project.read']
    roles[2].permission_codes.push('project_member.manage')
  }
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
        if (failUserCatalogOnce) {
          failUserCatalogOnce = false
          return Response.json(
            { detail: 'users unavailable' },
            { status: 500 },
          )
        }
        return Response.json({ items: [member], next_cursor: null })
      }
      if (method === 'GET' && path === `/users/${member.id}`) {
        return Response.json(member)
      }
      if (method === 'GET' && path === '/users/other') {
        return Response.json({
          ...member,
          id: 'other',
          username: 'other.user',
          name_zh: '另一帳號',
        })
      }
      if (method === 'GET' && path === '/module-delegate/users') {
        if (failUserCatalogOnce) {
          failUserCatalogOnce = false
          return Response.json(
            { detail: 'users unavailable' },
            { status: 500 },
          )
        }
        if (options.userCatalogResponse) {
          return options.userCatalogResponse()
        }
        return Response.json({
          items: [
            {
              id: member.id,
              username: member.username,
              name_zh: member.name_zh,
              is_external_collaborator: member.is_external_collaborator,
            },
            ...(options.delegateMode
              ? [
                  {
                    id: 'candidate',
                    username: 'candidate',
                    name_zh: '候選人',
                    is_external_collaborator: false,
                  },
                ]
              : []),
          ],
          next_cursor: null,
        })
      }
      if (method === 'GET' && path === '/companies') {
        return Response.json({ items: [], next_cursor: null })
      }
      if (method === 'GET' && path === '/module-permissions') {
        if (failPermissionCatalogOnce) {
          failPermissionCatalogOnce = false
          return Response.json(
            { detail: 'permissions unavailable' },
            { status: 500 },
          )
        }
        if (options.permissionCatalogResponse) {
          return options.permissionCatalogResponse()
        }
        return Response.json({
          items:
            options.permissionOptions ??
            (options.delegateMode
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
                ]),
        })
      }
      if (method === 'GET' && path === '/permission-bundles') {
        if (options.bundleCatalogResponse)
          return options.bundleCatalogResponse()
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
      if (
        method === 'PATCH' &&
        path === '/roles/creator-role' &&
        options.failCreatorWrite
      ) {
        return Response.json(
          { error: { code: 'server.internal_error' } },
          { status: 500 },
        )
      }
      if (method === 'GET' && path === '/roles/creator-role') {
        return Response.json({ role_id: 'office-role' })
      }
      if (method === 'GET' && path === '/projects') {
        if (options.projectCatalogResponse)
          return options.projectCatalogResponse()
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
        const userId = path.split('/')[2]
        if (options.accessResponse) return options.accessResponse(userId)
        if (options.failUserAccess || failUserAccessOnce) {
          failUserAccessOnce = false
          return Response.json({ detail: 'boom' }, { status: 500 })
        }
        return Response.json({
          permission_codes: permissionCodes,
          delegated_modules: [],
        })
      }
      if (
        method === 'GET' &&
        /^\/users\/[^/]+\/effective-access$/.test(path)
      ) {
        if (options.diagnosticResponse && url.searchParams.has('project_id'))
          return options.diagnosticResponse()
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
        if (options.createUserResponse) return options.createUserResponse
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
          onTemporaryPasswordVisible={options.onTemporaryPasswordVisible}
          onRequestTemporaryPasswordLeave={
            options.onRequestTemporaryPasswordLeave
          }
          onWizardBackToList={options.onWizardBackToList}
          onWizardViewUser={options.onWizardViewUser}
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
    const projectSelect = screen.getByLabelText('加入專案（可略過）')
    await within(projectSelect).findByRole('option', { name: '示範工程' })
    fireEvent.change(projectSelect, {
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
  it('帳號能力頁只載入該帳號，診斷出現即載入專案選項', async () => {
    const { calls } = permissionPage({
      embedded: true,
      openWizard: false,
      selectedUserId: 'person',
    })
    await screen.findByRole('heading', { name: '能做什麼' })

    expect(calls.some((call) => call.path === '/users/person')).toBe(true)
    expect(calls.some((call) => call.path === '/users')).toBe(false)
    expect(calls.some((call) => call.path === '/companies')).toBe(false)
    expect(calls.some((call) => call.path === '/roles')).toBe(false)
    await waitFor(() =>
      expect(calls.filter((call) => call.path === '/projects')).toHaveLength(
        1,
      ),
    )
  })

  it('新增精靈依步驟載入公司、專案與職務選項', async () => {
    const { calls } = permissionPage({
      embedded: true,
      openWizard: false,
      openWizardRequest: 1,
    })
    await screen.findByRole('heading', { name: '設定帳號' })
    await waitFor(() =>
      expect(calls.some((call) => call.path === '/companies')).toBe(true),
    )
    expect(calls.some((call) => call.path === '/users')).toBe(false)
    expect(calls.some((call) => call.path === '/roles')).toBe(false)
    expect(calls.some((call) => call.path === '/projects')).toBe(false)
    expect(calls.some((call) => call.path === '/permission-bundles')).toBe(
      false,
    )

    await fillIdentity('lazy.options')
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    fireEvent.click(screen.getByRole('radio', { name: /內業規劃/ }))
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    await waitFor(() =>
      expect(calls.some((call) => call.path === '/projects')).toBe(true),
    )
    expect(calls.some((call) => call.path === '/roles')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    await waitFor(() =>
      expect(calls.some((call) => call.path === '/roles')).toBe(true),
    )
    expect(calls.some((call) => call.path === '/roles/creator-role')).toBe(
      true,
    )
    expect(calls.some((call) => call.path === '/permission-bundles')).toBe(
      true,
    )
    expect(calls.some((call) => call.path === '/users')).toBe(false)
  })

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

  it('hides module permissions disallowed for external accounts', async () => {
    permissionPage({
      openWizard: false,
      embedded: true,
      selectedUserId: 'person',
      delegateMode: true,
      externalAccount: true,
      permissionOptions: [
        {
          code: 'project.use',
          module: 'project',
          description: '使用專案功能',
        },
        {
          code: 'project.create',
          module: 'project',
          description: '建立專案',
        },
        {
          code: 'template.use',
          module: 'template',
          description: '使用範本功能',
        },
        {
          code: 'template.manage',
          module: 'template',
          description: '管理範本庫',
        },
      ],
    })

    await screen.findByRole('heading', { name: '權限' })

    expect(screen.getByLabelText('使用專案功能')).toBeInTheDocument()
    expect(screen.getByLabelText('使用範本功能')).toBeInTheDocument()
    expect(screen.queryByLabelText('建立專案')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('管理範本庫')).not.toBeInTheDocument()
  })

  it('hides internal permissions until delegated account identity loads', async () => {
    const catalog = deferred<Response>()
    permissionPage({
      openWizard: false,
      embedded: true,
      selectedUserId: 'person',
      delegateMode: true,
      externalAccount: true,
      userCatalogResponse: () => catalog.promise,
      permissionOptions: [
        {
          code: 'template.use',
          module: 'template',
          description: '使用範本功能',
        },
        {
          code: 'template.manage',
          module: 'template',
          description: '管理範本庫',
        },
      ],
    })

    await screen.findByRole('heading', { name: '權限' })
    expect(screen.queryByLabelText('管理範本庫')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('使用範本功能')).not.toBeInTheDocument()

    await act(async () => {
      catalog.resolve(
        Response.json({
          items: [
            {
              id: 'person',
              username: 'person.one',
              name_zh: '林沐青',
              is_external_collaborator: true,
            },
          ],
          next_cursor: null,
        }),
      )
    })

    expect(await screen.findByLabelText('使用範本功能')).toBeInTheDocument()
    expect(screen.queryByLabelText('管理範本庫')).not.toBeInTheDocument()
  })

  it('retries a failed delegated account catalog before showing permissions', async () => {
    permissionPage({
      openWizard: false,
      embedded: true,
      selectedUserId: 'person',
      delegateMode: true,
      externalAccount: true,
      failUserCatalogOnce: true,
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '伺服器暫時無法處理，請稍後再試。',
    )
    expect(
      screen.getByRole('button', { name: '重新載入帳號目錄' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('管理範本庫')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新載入帳號目錄' }))

    expect(await screen.findByLabelText('使用專案功能')).toBeInTheDocument()
    expect(screen.queryByLabelText('管理範本庫')).not.toBeInTheDocument()
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

  it('keeps delegate grant controls disabled when access fails to load', async () => {
    const retryAccess = deferred<Response>()
    let accessRequests = 0
    const { calls } = permissionPage({
      openWizard: false,
      embedded: true,
      selectedUserId: 'person',
      delegateMode: true,
      accessResponse: () => {
        accessRequests += 1
        return accessRequests === 1
          ? Promise.resolve(Response.json({ detail: 'boom' }, { status: 500 }))
          : retryAccess.promise
      },
    })
    const delegateCard = screen.getByRole('heading', {
      name: '權限',
    }).parentElement
    expect(delegateCard).not.toBeNull()
    expect(await within(delegateCard!).findByRole('alert')).toBeVisible()
    expect(delegateCard).toHaveTextContent('目前無法載入')
    expect(delegateCard).not.toHaveTextContent('載入中')
    expect(
      within(delegateCard!).getByRole('button', {
        name: '重新載入權限',
      }),
    ).toBeVisible()
    expect(screen.getByLabelText('使用專案功能')).toBeDisabled()
    // 沒有可改的草稿，「開通」按鈕不會出現。
    expect(screen.queryByRole('button', { name: '開通' })).toBeNull()
    expect(
      calls.filter((call) => call.path === '/users/person/module-permissions'),
    ).toHaveLength(1)
    fireEvent.click(
      within(delegateCard!).getByRole('button', {
        name: '重新載入權限',
      }),
    )
    await waitFor(() => {
      expect(
        calls.filter(
          (call) => call.path === '/users/person/module-permissions',
        ),
      ).toHaveLength(2)
    })
    await act(async () => {
      retryAccess.resolve(
        Response.json({ permission_codes: [], delegated_modules: [] }),
      )
    })
    await waitFor(() => {
      expect(within(delegateCard!).queryByRole('alert')).toBeNull()
      expect(screen.getByLabelText('使用專案功能')).toBeEnabled()
    })
  })

  it('shows a retry state in the admin account capability summary', async () => {
    permissionPage({
      openWizard: false,
      embedded: true,
      selectedUserId: 'person',
      failUserAccess: true,
    })
    const summary = await screen.findByRole('region', {
      name: '帳號能力摘要',
    })
    expect(await within(summary).findByRole('alert')).toBeVisible()
    expect(summary).toHaveTextContent('目前無法載入')
    expect(summary).not.toHaveTextContent('載入中')
    expect(summary).not.toHaveTextContent('尚未開通功能')
    expect(
      within(summary).getByRole('button', {
        name: '重新載入權限',
      }),
    ).toBeVisible()
  })

  it('waits for permission descriptions before rendering an empty summary', async () => {
    const catalog = deferred<Response>()
    permissionPage({
      openWizard: false,
      embedded: true,
      selectedUserId: 'person',
      permissionCodes: ['inspection.use'],
      permissionCatalogResponse: () => catalog.promise,
    })

    const summary = screen.getByRole('region', { name: '帳號能力摘要' })
    expect(summary).toHaveTextContent('載入中')
    expect(summary).not.toHaveTextContent('尚未開通功能')
    await act(async () => {
      catalog.resolve(
        Response.json({
          items: [
            {
              code: 'inspection.use',
              module: 'inspection',
              description: '使用查核功能',
            },
          ],
        }),
      )
    })
    expect(await within(summary).findByText(/使用查核功能/)).toBeVisible()
  })

  it('retries only the failed permission catalog and clears its error', async () => {
    const { calls } = permissionPage({
      openWizard: false,
      embedded: true,
      selectedUserId: 'person',
      failPermissionCatalogOnce: true,
    })
    const summary = screen.getByRole('region', { name: '帳號能力摘要' })
    expect(await within(summary).findByRole('alert')).toBeVisible()
    expect(summary).not.toHaveTextContent('尚未開通功能')
    const userAccessCalls = calls.filter((call) =>
      /\/users\/[^/]+\/module-permissions$/.test(call.path),
    ).length
    const userCatalogCalls = calls.filter(
      (call) => call.path === '/users',
    ).length
    fireEvent.click(
      within(summary).getByRole('button', { name: '重新載入權限目錄' }),
    )
    expect(await within(summary).findByText(/尚未開通功能/)).toBeVisible()
    expect(
      calls.filter((call) =>
        /\/users\/[^/]+\/module-permissions$/.test(call.path),
      ),
    ).toHaveLength(userAccessCalls)
    expect(calls.filter((call) => call.path === '/users')).toHaveLength(
      userCatalogCalls,
    )
    expect(within(summary).queryByRole('alert')).toBeNull()
  })

  it('ignores a late permission response after switching accounts', async () => {
    const first = deferred<Response>()
    const { calls, rerenderSelectedUser } = permissionPage({
      openWizard: false,
      embedded: true,
      selectedUserId: 'person',
      accessResponse: (userId) =>
        userId === 'person'
          ? first.promise
          : Promise.resolve(
              Response.json({
                permission_codes: ['project.use'],
                delegated_modules: [],
              }),
            ),
    })
    const summary = screen.getByRole('region', { name: '帳號能力摘要' })
    expect(summary).toHaveTextContent('載入中')
    await waitFor(() => {
      expect(
        calls.some((call) => call.path === '/users/person/module-permissions'),
      ).toBe(true)
    })
    rerenderSelectedUser('other')
    await waitFor(() => {
      expect(
        calls.some((call) => call.path === '/users/other/module-permissions'),
      ).toBe(true)
    })
    expect(summary).not.toBeInTheDocument()
    const summaryForB = await screen.findByRole('region', {
      name: '帳號能力摘要',
    })
    expect(
      await within(summaryForB).findByText(/能使用：使用專案功能/),
    ).toBeVisible()
    await act(async () => {
      first.resolve(
        Response.json({
          permission_codes: ['inspection.use'],
          delegated_modules: [],
        }),
      )
    })
    const currentSummary = screen.getByRole('region', {
      name: '帳號能力摘要',
    })
    expect(currentSummary).toHaveTextContent('能使用：使用專案功能')
    expect(currentSummary).not.toHaveTextContent('使用查核功能')
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
    const projectSelect = screen.getByLabelText('加入專案（可略過）')
    await within(projectSelect).findByRole('option', { name: '示範工程' })
    fireEvent.change(projectSelect, {
      target: { value: 'project-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    const applyButtons = screen.getAllByRole('button', { name: '套用職務' })
    fireEvent.click(applyButtons[applyButtons.length - 1])

    expect(
      await screen.findByText('林沐青 的職務與權限設定已完成。'),
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
      '帳號外部身分與所選職務不符，未變更權限。',
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
      await screen.findByText('林沐青 的職務與權限設定已完成。'),
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
    await fillIdentity('plain.jobs')
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
    await fillIdentity('previous.nav')

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

    expect(await screen.findByText(/帳號已建立；後續權限/)).toBeVisible()
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
    expect(screen.queryByText(/後續權限或專案加入未完成/)).toBeNull()
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
    const onTemporaryPasswordVisible = vi.fn()
    const { calls } = permissionPage({
      failBundleOnce: true,
      onTemporaryPasswordVisible,
    })
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('retry.only')
    await chooseProfile('內業規劃')
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))

    expect(
      await screen.findByRole('button', { name: '重試未完成的步驟' }),
    ).toBeVisible()
    expect(onTemporaryPasswordVisible).toHaveBeenLastCalledWith(true)
    expect(await screen.findByLabelText('臨時密碼')).toHaveTextContent(
      'temporary-secret',
    )
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

  it('新增另一個帳號要先確認，取消保留密碼，確認後才重設精靈', async () => {
    let confirmedAction: (() => void) | undefined
    const requestLeave = vi.fn((action: () => void) => {
      confirmedAction = action
    })
    permissionPage({ onRequestTemporaryPasswordLeave: requestLeave })
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('another.staff')
    await chooseProfile('內業規劃')
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))
    expect(
      await screen.findByRole('heading', { name: '帳號已建立' }),
    ).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '新增另一個帳號' }))
    expect(requestLeave).toHaveBeenCalledOnce()
    expect(await screen.findByLabelText('臨時密碼')).toHaveTextContent(
      'temporary-secret',
    )
    expect(screen.getByRole('heading', { name: '帳號已建立' })).toBeVisible()

    confirmedAction?.()
    expect(
      await screen.findByRole('heading', { name: '新增帳號' }),
    ).toBeVisible()
    expect(screen.queryByLabelText('臨時密碼')).toBeNull()
  })

  it('回清單要先確認，取消保留密碼，確認後才離開精靈', async () => {
    let confirmedAction: (() => void) | undefined
    const requestLeave = vi.fn((action: () => void) => {
      confirmedAction = action
    })
    const onWizardBackToList = vi.fn()
    permissionPage({
      onRequestTemporaryPasswordLeave: requestLeave,
      onWizardBackToList,
    })
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('back.to.list')
    await chooseProfile('內業規劃')
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))
    expect(
      await screen.findByRole('heading', { name: '帳號已建立' }),
    ).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '回清單' }))
    expect(requestLeave).toHaveBeenCalledOnce()
    expect(onWizardBackToList).not.toHaveBeenCalled()
    expect(await screen.findByLabelText('臨時密碼')).toHaveTextContent(
      'temporary-secret',
    )

    confirmedAction?.()
    expect(onWizardBackToList).toHaveBeenCalledOnce()
  })

  it('查看能力要先確認，取消保留密碼，確認後才導向帳號能力', async () => {
    let confirmedAction: (() => void) | undefined
    const requestLeave = vi.fn((action: () => void) => {
      confirmedAction = action
    })
    const onWizardViewUser = vi.fn()
    permissionPage({
      onRequestTemporaryPasswordLeave: requestLeave,
      onWizardViewUser,
    })
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('view.account')
    await chooseProfile('內業規劃')
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))
    expect(
      await screen.findByRole('heading', { name: '帳號已建立' }),
    ).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '查看這個帳號的能力' }))
    expect(requestLeave).toHaveBeenCalledOnce()
    expect(onWizardViewUser).not.toHaveBeenCalled()
    expect(await screen.findByLabelText('臨時密碼')).toHaveTextContent(
      'temporary-secret',
    )

    confirmedAction?.()
    expect(onWizardViewUser).toHaveBeenCalledOnce()
    expect(onWizardViewUser).toHaveBeenCalledWith('created-person')
  })

  it('reconciles a member conflict after the add response is lost', async () => {
    const { calls } = permissionPage({ loseMemberResponseOnce: true })
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('member.retry')
    await chooseProfile('內業規劃', 'project-1')
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))

    expect(
      await screen.findByText(/帳號已建立；後續權限或專案加入未完成/),
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
      await screen.findByText(/帳號已建立；後續權限或專案加入未完成/)
      fireEvent.click(screen.getByRole('button', { name: '重試未完成的步驟' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        '這個帳號已經是此專案的成員。',
      )
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

  // #713：第一步缺欄位就按「下一步」，要停在第一步並在欄位旁說明。
  it('stops on step one and marks each missing required field', async () => {
    permissionPage()
    await screen.findByRole('heading', { name: '新增帳號' })

    fireEvent.click(screen.getByRole('button', { name: '下一步' }))

    expect(screen.getByText('步驟 1／4：帳號資料')).toBeVisible()
    const summary = screen.getByRole('alert', { name: '請修正以下問題' })
    for (const label of ['帳號名稱', '姓名', '電子郵件']) {
      expect(
        within(summary).getByRole('link', { name: new RegExp(label) }),
      ).toBeVisible()
      const field = screen.getByLabelText(label)
      expect(field).toBeInvalid()
      expect(field).toHaveAccessibleDescription(`請填寫${label}。`)
    }
    expect(summary).toHaveFocus()

    fireEvent.change(screen.getByLabelText('姓名'), {
      target: { value: '林沐青' },
    })
    expect(screen.getByLabelText('姓名')).toBeValid()
    // 補好的欄位要從錯誤摘要消失。
    expect(within(screen.getByRole('alert')).queryByText(/姓名/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByText('步驟 1／4：帳號資料')).toBeVisible()
    expect(screen.getByLabelText('姓名')).toBeValid()
    expect(screen.getByLabelText('帳號名稱')).toBeInvalid()
  })

  it('treats whitespace-only required fields as missing', async () => {
    permissionPage()
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('blank.email')
    fireEvent.change(screen.getByLabelText('電子郵件'), {
      target: { value: '   ' },
    })

    fireEvent.click(screen.getByRole('button', { name: '下一步' }))

    expect(screen.getByText('步驟 1／4：帳號資料')).toBeVisible()
    expect(screen.getByLabelText('電子郵件')).toBeInvalid()
    expect(screen.getByLabelText('帳號名稱')).toBeValid()
  })

  it('places the email field above the optional details', async () => {
    permissionPage()
    await screen.findByRole('heading', { name: '新增帳號' })

    const email = screen.getByLabelText('電子郵件')
    const details = screen.getByText('更多資料（選填）')
    expect(
      email.compareDocumentPosition(details) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('explains beside the create button why it cannot be pressed', async () => {
    const pending = deferred<Response>()
    const { calls } = permissionPage({ createUserResponse: pending.promise })
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('busy.create')
    await chooseProfile('內業規劃')

    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))

    const button = await screen.findByRole('button', { name: '建立帳號' })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription('正在建立帳號，請稍候。')
    expect(screen.getByText('正在建立帳號，請稍候。')).toBeVisible()
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1)
  })

  it('shows the temporary password first and only completion actions', async () => {
    permissionPage()
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('done.page')
    await chooseProfile('內業規劃')
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))

    const password = await screen.findByLabelText('臨時密碼')
    const done = screen.getByRole('region', { name: '建立完成' })
    expect(
      screen.queryByRole('heading', { name: '能做什麼' }),
    ).not.toBeInTheDocument()
    const doneText = done.textContent ?? ''
    expect(doneText.indexOf('臨時密碼')).toBeLessThan(
      doneText.indexOf('的帳號與權限設定已完成'),
    )
    expect(done).toContainElement(password)
    expect(doneText).not.toContain('授權')
    expect(screen.queryByText('進階設定')).not.toBeInTheDocument()
  })

  it('hides advanced settings on the account completion page', async () => {
    permissionPage()
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('done.advanced')
    await chooseProfile('內業規劃')
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))

    await screen.findByRole('region', { name: '建立完成' })
    expect(screen.queryByText('進階設定')).not.toBeInTheDocument()
  })

  it.each(['現場查核', '外部協作'])(
    'warns on the confirm step when %s has no project yet',
    async (job) => {
      permissionPage()
      await screen.findByRole('heading', { name: '新增帳號' })
      await fillIdentity('no.project')
      await chooseProfile(job)

      expect(screen.getByText('加入專案前看不到任何任務。')).toBeVisible()
    },
  )

  it('omits the no-project warning once a project is chosen or for office jobs', async () => {
    permissionPage()
    await screen.findByRole('heading', { name: '新增帳號' })
    await fillIdentity('with.project')
    await chooseProfile('現場查核', 'project-1')

    expect(
      screen.queryByText('加入專案前看不到任何任務。'),
    ).not.toBeInTheDocument()
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
    expect(
      screen.getByText('步驟 1／4：帳號資料', {
        selector: 'p[role="status"]',
      }),
    ).toBeVisible()
    expect(screen.queryByText('帳號清單')).toBeNull()
  })

  it('marks the active step for assistive technology', async () => {
    permissionPage()
    await screen.findByRole('heading', { name: '新增帳號' })

    expect(
      screen.getByText('步驟 1／4：帳號資料', {
        selector: 'p[role="status"]',
      }),
    ).toBeVisible()
    expect(screen.queryByText('尚未開始')).toBeNull()
  })

  it('orders advanced permission groups before delegation', async () => {
    permissionPage({
      openWizard: false,
      embedded: true,
      selectedUserId: 'person',
    })
    fireEvent.click(await screen.findByText('進階設定'))
    const bundle = await screen.findByRole('heading', {
      name: '套用權限組合',
    })
    const delegation = screen.getByRole('heading', { name: '委派管理' })
    expect(
      Boolean(
        bundle.compareDocumentPosition(delegation) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true)
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
    expect(permissionsPanel).toHaveTextContent(
      '專案內能力請查看「參與專案與角色」。',
    )
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

  it('shows the diagnosis result after the check button', async () => {
    permissionPage({ openWizard: false })
    await screen.findByRole('heading', { name: '帳號權限' })
    fireEvent.click(screen.getByRole('button', { name: '林沐青' }))
    expect(await screen.findByText(/能使用：/)).toBeVisible()
    fireEvent.change(screen.getByLabelText('專案'), {
      target: { value: 'project-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '檢查' }))

    const result = await screen.findByText(/缺少查核功能的權限/)
    const heading = screen.getByRole('heading', {
      name: '為什麼他不能做這件事？',
    })
    const check = screen.getByRole('button', { name: '檢查' })
    const follows = (earlier: Element, later: Element) =>
      Boolean(
        earlier.compareDocumentPosition(later) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      )
    expect(follows(heading, check)).toBe(true)
    expect(follows(check, result)).toBe(true)
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
    expect(
      within(candidateChooser).getAllByText(/管理專案成員/).length,
    ).toBeGreaterThan(0)
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
    await fillIdentity('five.jobs')
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

  it('reloads participation after adding a missing role to a member', async () => {
    permissionPage({
      openWizard: false,
      memberRoleIds: ['office-role'],
      permissionCodes: ['inspection.use'],
    })
    await screen.findByRole('heading', { name: '帳號權限' })
    fireEvent.click(screen.getByRole('button', { name: '林沐青' }))
    const link = await screen.findByRole('link', { name: 'PR-1／示範工程' })
    expect(link.closest('li')).toHaveTextContent('：專案工程師')
    expect(link.closest('li')).not.toHaveTextContent('現場工程師')
    fireEvent.change(screen.getByLabelText('專案'), {
      target: { value: 'project-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '檢查' }))
    expect(
      await screen.findByText(/沒有可以查看或執行任務的角色/),
    ).toBeVisible()
    assignCandidateRole('現場工程師')
    expect(await screen.findByText(/具備此操作所需的有效權限/)).toBeVisible()

    await waitFor(() => {
      const refreshed = screen.getByRole('link', { name: 'PR-1／示範工程' })
      expect(refreshed.closest('li')).toHaveTextContent(
        '：專案工程師、現場工程師',
      )
    })
  })

  it('reloads participation after a first role creates the membership', async () => {
    permissionPage({
      openWizard: false,
      permissionCodes: ['inspection.use'],
    })
    await screen.findByRole('heading', { name: '帳號權限' })
    fireEvent.click(screen.getByRole('button', { name: '林沐青' }))
    expect(await screen.findByText('目前沒有參與專案。')).toBeVisible()
    fireEvent.change(screen.getByLabelText('專案'), {
      target: { value: 'project-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '檢查' }))
    expect(
      await screen.findByText(/沒有可以查看或執行任務的角色/),
    ).toBeVisible()
    assignCandidateRole('現場工程師')
    expect(await screen.findByText(/具備此操作所需的有效權限/)).toBeVisible()

    const refreshed = await screen.findByRole('link', {
      name: 'PR-1／示範工程',
    })
    expect(refreshed.closest('li')).toHaveTextContent('：現場工程師')
    expect(screen.queryByText('目前沒有參與專案。')).toBeNull()
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
    expect(
      screen.getByText('步驟 1／4：帳號資料', {
        selector: 'p[role="status"]',
      }),
    ).toBeVisible()
  })

  it('compares candidate and current project permissions', async () => {
    permissionPage({
      openWizard: false,
      embedded: true,
      selectedUserId: 'person',
      permissionCodes: ['inspection.use'],
      memberRoleIds: ['current-role'],
      candidateRoleComparison: true,
    })
    fireEvent.change(screen.getByLabelText('要檢查的操作'), {
      target: { value: 'members' },
    })
    const projectSelect = await screen.findByLabelText('專案')
    fireEvent.focus(projectSelect)
    await within(projectSelect).findByRole('option', { name: '示範工程' })
    fireEvent.change(projectSelect, {
      target: { value: 'project-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '檢查' }))

    const chooser = await screen.findByRole('region', {
      name: '可選專案角色',
    })
    const candidate = within(chooser)
      .getByRole('radio', { name: /現場工程師/ })
      .closest('.role-candidate')! as HTMLElement
    expect(candidate).toHaveTextContent('角色可用權限（7 項）')
    expect(
      within(candidate).getByRole('button', {
        name: '「現場工程師」完整權限',
      }),
    ).toBeVisible()
    const summaries = candidate.querySelectorAll('.role-permission-summary')
    expect(summaries).toHaveLength(2)
    expect(summaries[1]).not.toHaveTextContent('檢視專案基本資料')
  })

  it('orders advanced settings before the capability summary', async () => {
    permissionPage({
      openWizard: false,
      embedded: true,
      selectedUserId: 'person',
    })

    await screen.findByRole('region', { name: '帳號能力摘要' })
    const root = document.querySelector('.permission-management')!
    const advanced = root.querySelector('.permission-advanced-settings')
    const capabilities = root.querySelector('.permission-capabilities')
    expect(advanced).not.toBeNull()
    expect(capabilities).not.toBeNull()
    expect(advanced!.compareDocumentPosition(capabilities!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('aligns each permission-bundle apply button in a list row', async () => {
    permissionPage({
      openWizard: false,
      embedded: true,
      selectedUserId: 'person',
    })
    fireEvent.click(screen.getByText('進階設定', { exact: true }))
    await screen.findAllByRole('button', { name: '套用' })

    const bundleButton = screen.getAllByRole('button', { name: '套用' })[0]
    expect(bundleButton.closest('li')).toHaveClass('permission-bundle-row')
  })

  it('hides the delegate from their own account list', async () => {
    permissionPage({ delegateMode: true, openWizard: false })

    await screen.findByRole('heading', { name: '帳號權限' })
    expect(screen.queryByRole('button', { name: '林沐青' })).toBeNull()
    expect(screen.getByRole('button', { name: '候選人' })).toBeVisible()
  })
})

describe('帳號審查修正（#414）', () => {
  it('同一帳號重新套用職務後查看能力會重新載入並可檢查', async () => {
    const { calls } = permissionPage({
      embedded: true,
      openWizard: false,
      selectedUserId: 'person',
      permissionCodes: ['project.use'],
    })
    await screen.findByText(/能使用：使用專案功能/)
    const accessCalls = () =>
      calls.filter((c) => c.path === '/users/person/module-permissions').length
    const beforeApply = accessCalls()
    fireEvent.click(screen.getByRole('button', { name: '重新套用職務' }))
    fireEvent.click(screen.getByRole('radio', { name: /內業規劃/ }))
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    fireEvent.click(
      screen.getAllByRole('button', { name: '套用職務' }).at(-1)!,
    )
    await screen.findByText('林沐青 的職務與權限設定已完成。')
    await waitFor(() => expect(accessCalls()).toBe(beforeApply + 1))
    const beforeView = accessCalls()
    fireEvent.click(screen.getByRole('button', { name: '查看這個帳號的能力' }))
    const summary = await screen.findByRole('region', { name: '帳號能力摘要' })
    await waitFor(() => expect(summary).not.toHaveTextContent('載入中'))
    expect(summary).toHaveTextContent('使用專案功能')
    const select = within(summary).getByLabelText('專案')
    await within(select).findByRole('option', { name: '示範工程' })
    fireEvent.change(select, { target: { value: 'project-1' } })
    expect(within(summary).getByRole('button', { name: '檢查' })).toBeEnabled()
    expect(accessCalls()).toBe(beforeView + 1)
  })

  it('建立成功但組合失敗時以已知帳號顯示能力，不無限載入', async () => {
    permissionPage({
      embedded: true,
      openWizard: false,
      openWizardRequest: 1,
      failBundleOnce: true,
    })
    await screen.findByRole('heading', { name: '設定帳號' })
    await fillIdentity('partial.summary')
    await chooseProfile('內業規劃')
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))
    await screen.findByText(/帳號已建立；後續權限/)
    const summary = screen.getByRole('region', { name: '帳號能力摘要' })
    expect(await within(summary).findByText(/尚未開通功能/)).toBeVisible()
    expect(summary).not.toHaveTextContent('載入中')
    expect(
      screen.getByRole('button', { name: '重試未完成的步驟' }),
    ).toBeVisible()
  })

  it('診斷出現即載入一次專案，等候時有停用的載入選項', async () => {
    const projects = deferred<Response>()
    const { calls } = permissionPage({
      embedded: true,
      openWizard: false,
      selectedUserId: 'person',
      projectCatalogResponse: () => projects.promise,
    })
    const select = screen.getByLabelText('專案')
    expect(
      await within(select).findByRole('option', { name: '載入專案中…' }),
    ).toBeDisabled()
    expect(select).toBeDisabled()
    await act(async () =>
      projects.resolve(
        Response.json({
          items: [{ id: 'project-1', name: '示範工程' }],
          next_cursor: null,
        }),
      ),
    )
    expect(
      await within(select).findByRole('option', { name: '示範工程' }),
    ).toBeVisible()
    expect(select).toBeEnabled()
    fireEvent.focus(select)
    fireEvent.blur(select)
    fireEvent.focus(select)
    expect(calls.filter((c) => c.path === '/projects')).toHaveLength(1)
  })

  it('進階設定載入時有提示，重新展開沿用第一次的資料', async () => {
    const bundles = deferred<Response>()
    const { calls } = permissionPage({
      embedded: true,
      openWizard: false,
      selectedUserId: 'person',
      bundleCatalogResponse: () => bundles.promise,
    })
    const toggle = screen.getByText('進階設定', { exact: true })
    const details = toggle.closest('details')!
    fireEvent.click(toggle)
    expect(
      await within(details).findByText('載入中…', {
        selector: 'p[role="status"]',
      }),
    ).toBeVisible()
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    await act(async () =>
      bundles.resolve(
        Response.json({
          items: [
            {
              id: 'cached',
              name: '快取組合',
              permission_codes: ['project.use'],
            },
          ],
          next_cursor: null,
        }),
      ),
    )
    expect(await within(details).findByText('快取組合')).toBeVisible()
    await waitFor(() =>
      expect(within(details).queryByText('載入中…')).toBeNull(),
    )
    fireEvent.click(toggle)
    await waitFor(() => expect(details).not.toHaveAttribute('open'))
    fireEvent.click(toggle)
    await waitFor(() => expect(details).toHaveAttribute('open'))
    expect(within(details).queryByText('載入中…')).toBeNull()
    expect(calls.filter((c) => c.path === '/permission-bundles')).toHaveLength(
      1,
    )
  })
})

describe('第二輪審查的區塊錯誤恢復（#414）', () => {
  it.each([1, 2])(
    '專案選項失敗 %i 次後重試成功會清除區塊錯誤',
    async (failures) => {
      let attempts = 0
      permissionPage({
        embedded: true,
        openWizard: false,
        selectedUserId: 'person',
        projectCatalogResponse: async () => {
          attempts += 1
          return attempts <= failures
            ? Response.json({ error: { code: 'x' } }, { status: 500 })
            : Response.json({
                items: [{ id: 'project-1', name: '示範工程' }],
                next_cursor: null,
              })
        },
      })
      const summary = await screen.findByRole('region', {
        name: '帳號能力摘要',
      })
      for (let attempt = 0; attempt < failures; attempt += 1) {
        expect(await within(summary).findByRole('alert')).toHaveTextContent(
          '專案選項載入失敗',
        )
        expect(screen.getAllByRole('alert')).toHaveLength(1)
        fireEvent.click(
          within(summary).getByRole('button', {
            name: '重新載入專案選項',
          }),
        )
      }
      expect(
        await within(summary).findByRole('option', {
          name: '示範工程',
        }),
      ).toBeVisible()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(attempts).toBe(failures + 1)
    },
  )

  it('進階設定失敗後可在區塊內重試，成功清除錯誤', async () => {
    let attempts = 0
    permissionPage({
      embedded: true,
      openWizard: false,
      selectedUserId: 'person',
      bundleCatalogResponse: async () => {
        attempts += 1
        return attempts === 1
          ? Response.json({ error: { code: 'x' } }, { status: 500 })
          : Response.json({ items: [], next_cursor: null })
      },
    })
    const toggle = screen.getByText('進階設定', { exact: true })
    const details = toggle.closest('details')!
    fireEvent.click(toggle)
    expect(await within(details).findByRole('alert')).toHaveTextContent(
      '進階設定載入失敗',
    )
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    fireEvent.click(
      within(details).getByRole('button', {
        name: '重新載入進階設定',
      }),
    )
    await waitFor(() => {
      expect(within(details).queryByRole('alert')).toBeNull()
      expect(within(details).queryByText('載入中…')).toBeNull()
    })
    expect(attempts).toBe(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('專案選項失敗不會阻止 embedded 進階設定載入', async () => {
    const { calls } = permissionPage({
      embedded: true,
      openWizard: false,
      selectedUserId: 'person',
      projectCatalogResponse: async () =>
        Response.json({ error: { code: 'x' } }, { status: 500 }),
    })
    const summary = await screen.findByRole('region', { name: '帳號能力摘要' })
    await within(summary).findByRole('alert')
    const toggle = screen.getByText('進階設定', { exact: true })
    const details = toggle.closest('details')!
    fireEvent.click(toggle)
    expect(await within(details).findByText('專案工程師常用')).toBeVisible()
    expect(within(details).queryByRole('alert')).toBeNull()
    expect(within(details).queryByText('載入中…')).toBeNull()
    fireEvent.click(toggle)
    await waitFor(() => expect(details).not.toHaveAttribute('open'))
    fireEvent.click(toggle)
    await waitFor(() => expect(details).toHaveAttribute('open'))
    expect(calls.filter((c) => c.path === '/permission-bundles')).toHaveLength(
      1,
    )
    expect(calls.filter((c) => c.path === '/projects')).toHaveLength(1)
  })
})

describe('#727 診斷錯誤白話', () => {
  it.each([404, 'network'])('診斷 %s 保留修正方向', async (failure) => {
    permissionPage({
      openWizard: false,
      diagnosticResponse: async () => {
        if (failure === 'network') throw new TypeError('Failed to fetch')
        return Response.json(
          { error: { code: 'resource.not_found' } },
          { status: 404 },
        )
      },
    })
    fireEvent.click(await screen.findByRole('button', { name: '林沐青' }))
    await screen.findByText(/能使用：/)
    fireEvent.change(await screen.findByLabelText('專案'), {
      target: { value: 'project-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '檢查' }))
    const alert = await screen.findByText(
      failure === 404
        ? '他還不是這個專案的成員，請先到專案成員頁加入。'
        : '無法連線到伺服器，請稍後再試。',
      { exact: false },
    )
    expect(alert).not.toHaveTextContent(/API 錯誤|Failed to fetch/)
    if (failure === 404) {
      expect(alert).toHaveTextContent(
        '他還不是這個專案的成員，請先到專案成員頁加入。',
      )
      expect(within(alert).getByRole('link')).toHaveAttribute(
        'href',
        '/projects/project-1/members',
      )
    } else {
      expect(alert).toHaveTextContent(/連線|網路/)
    }
  })
})

describe('#727c 非成員連結隔離', () => {
  it('非成員診斷後的其他流程錯誤不得沿用成員連結', async () => {
    permissionPage({
      openWizard: false,
      failCreatorWrite: true,
      diagnosticResponse: async () =>
        Response.json(
          { error: { code: 'resource.not_found' } },
          { status: 404 },
        ),
    })
    fireEvent.click(await screen.findByRole('button', { name: '林沐青' }))
    await screen.findByText(/能使用：/)
    fireEvent.change(await screen.findByLabelText('專案'), {
      target: { value: 'project-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '檢查' }))
    expect(
      await screen.findByRole('link', { name: '前往專案成員頁' }),
    ).toBeVisible()
    fireEvent.change(screen.getByLabelText('專案建立者角色'), {
      target: { value: 'field-role' },
    })
    await screen.findByText('伺服器暫時無法處理，請稍後再試。')
    expect(screen.queryByRole('link', { name: '前往專案成員頁' })).toBeNull()
  })
})
