import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CurrentUser } from '../../auth/api'
import { CurrentUserProvider } from '../../auth/useCurrentUser'
import { DataMemoryRouter } from '../../testing/DataMemoryRouter'
import ProjectDetailPage from './ProjectDetailPage'
import { deferred, type Deferred } from '../../testing/submitGuard'

const currentUser: CurrentUser = {
  id: 'user-1',
  username: 'anna.deng',
  email: null,
  name_en: null,
  name_zh: '鄧安娜',
  is_admin: false,
  must_change_password: false,
  has_office_access: true,
  can_manage_project_planning_or_members: true,
  has_field_access: false,
  can_inspect_tasks: false,
  has_template_access: false,
  module_permissions: [],
  delegated_modules: [],
  can_create_project: false,
  has_project_access: true,
  is_external_collaborator: false,
}

const roleA = {
  id: 'role-a',
  name: '檢視者',
  permission_codes: ['project.read'],
  is_external_allowed: true,
}
const roleB = {
  id: 'role-b',
  name: '管理者',
  permission_codes: ['project.update'],
  is_external_allowed: true,
}

function createMember(id: string, username: string, roleIds: string[]) {
  return {
    id: `membership-${id}`,
    user_id: id,
    username,
    role_ids: roleIds,
    role_names: roleIds.map(
      (roleId) =>
        [roleA, roleB].find((role) => role.id === roleId)?.name ?? '',
    ),
    name_zh: id === 'user-1' ? '鄧安娜' : '林鮑伯',
    email: null,
    company_id: null,
    company_name: null,
    is_active: true,
    is_external_collaborator: false,
    module_status: { project_use: true, inspection_use: true },
  }
}

function renderMembers(
  failBatch = false,
  bobRoleIds = ['role-a'],
  active = true,
  reloadGate?: Deferred<void>,
) {
  const members = [
    createMember('user-1', 'anna.deng', ['role-a']),
    createMember('user-2', 'bob.lin', bobRoleIds),
  ]
  members[1].is_active = active
  const calls: Array<{ method: string; path: string; body: string }> = []
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://testserver')
      const call = {
        method: init?.method ?? 'GET',
        path: url.pathname,
        body: String(init?.body ?? ''),
      }
      calls.push(call)
      if (call.method === 'GET' && call.path.endsWith('/members')) {
        if (
          calls.filter((item) => item.path.endsWith('/members')).length > 1
        ) {
          await reloadGate?.promise
        }
        return Response.json(members)
      }
      if (call.method === 'DELETE') {
        const index = members.findIndex((member) =>
          call.path.endsWith(`/members/${member.user_id}`),
        )
        if (index !== -1) members.splice(index, 1)
        return new Response(null, { status: 204 })
      }
      if (call.method === 'GET' && call.path.endsWith('/member-candidates')) {
        return Response.json({ items: [], next_cursor: null })
      }
      if (call.method === 'GET' && call.path.endsWith('/assignable-roles'))
        return Response.json({ items: [roleA, roleB], next_cursor: null })
      if (call.path.endsWith('/members:batch-roles')) {
        if (failBatch)
          return Response.json(
            { error: { code: 'request.validation_failed' } },
            { status: 422 },
          )
        const body = JSON.parse(call.body) as {
          items: Array<{ user_id: string; role_ids: string[] }>
        }
        for (const item of body.items) {
          const member = members.find(
            (entry) => entry.user_id === item.user_id,
          )
          if (member) {
            Object.assign(
              member,
              createMember(member.user_id, member.username, item.role_ids),
            )
          }
        }
        return Response.json({ items: [] })
      }
      return Response.json({})
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  render(
    <DataMemoryRouter initialEntries={['/projects/project-1/members']}>
      <CurrentUserProvider value={{ user: currentUser, clear: vi.fn() }}>
        <Routes>
          <Route
            path="/projects/:projectId/members"
            element={<ProjectDetailPage />}
          />
        </Routes>
      </CurrentUserProvider>
    </DataMemoryRouter>,
  )
  return { calls, members }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('專案成員批次角色（#414）', () => {
  it.each(['批次改角色', '移出'] as const)(
    '%s 成功後等待重查期間保留成員清單，完成後顯示新資料',
    async (action) => {
      const gate = deferred()
      const { calls } = renderMembers(false, ['role-a'], true, gate)
      const name = await screen.findByText('林鮑伯')
      const card = name.closest('li')!
      const list = card.parentElement!
      if (action === '批次改角色') {
        fireEvent.click(screen.getByRole('checkbox', { name: /林鮑伯/ }))
        fireEvent.change(screen.getByLabelText('批次角色'), {
          target: { value: 'role-b' },
        })
        fireEvent.click(screen.getByRole('button', { name: '批次指派角色' }))
      } else {
        fireEvent.click(within(card).getByRole('button', { name: /移出專案/ }))
        fireEvent.click(
          await screen.findByRole('button', { name: '確認移出' }),
        )
      }
      await waitFor(() =>
        expect(
          calls.filter((call) => call.path.endsWith('/members')),
        ).toHaveLength(2),
      )
      expect(screen.queryByText('載入中…')).toBeNull()
      expect(list).toBeVisible()
      expect(name).toBeVisible()
      expect(within(card).getByText('檢視者')).toBeVisible()

      await act(async () => gate.resolve())
      if (action === '批次改角色') {
        expect(await within(card).findByText('檢視者、管理者')).toBeVisible()
        expect(card.parentElement).toBe(list)
      } else {
        await waitFor(() => expect(screen.queryByText('林鮑伯')).toBeNull())
        expect(screen.getByText('鄧安娜')).toBeVisible()
        expect(list).toBeVisible()
      }
    },
  )

  it('不能勾選停用成員的角色，並說明原因', async () => {
    renderMembers(false, ['role-a'], false)
    expect(
      await screen.findByRole('checkbox', {
        name: /選取 林鮑伯/,
      }),
    ).toBeDisabled()
    expect(screen.getByText('此帳號已停用，不能批次修改角色。')).toBeVisible()
  })

  it('不能選取自己的角色，其他成員可批次指派白名單角色', async () => {
    const { calls } = renderMembers()
    await screen.findByText('林鮑伯')

    expect(screen.getByRole('checkbox', { name: /鄧安娜/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /林鮑伯/ }))
    fireEvent.change(await screen.findByLabelText('批次角色'), {
      target: { value: 'role-b' },
    })
    fireEvent.click(
      await screen.findByRole('button', { name: '批次指派角色' }),
    )

    await waitFor(() =>
      expect(
        calls.find((call) => call.path.endsWith('/members:batch-roles')),
      ).toMatchObject({
        method: 'POST',
        body: JSON.stringify({
          items: [{ user_id: 'user-2', role_ids: ['role-a', 'role-b'] }],
        }),
      }),
    )
  })

  it('批次角色端點失敗時不改畫面角色且保留操作以便重試', async () => {
    const { calls } = renderMembers(true)
    await screen.findByText('林鮑伯')
    fireEvent.click(screen.getByRole('checkbox', { name: /林鮑伯/ }))
    fireEvent.change(await screen.findByLabelText('批次角色'), {
      target: { value: 'role-b' },
    })
    fireEvent.click(
      await screen.findByRole('button', { name: '批次指派角色' }),
    )

    const section = screen.getByRole('region', { name: '批次角色操作' })
    const alert = await within(section).findByRole('alert')
    expect(alert).toBeVisible()
    await waitFor(() => expect(alert).toHaveFocus())
    expect(screen.getAllByText('檢視者').length).toBe(3)
    expect(screen.getByRole('checkbox', { name: /林鮑伯/ })).toBeChecked()
    expect(
      calls.filter((call) => call.path.endsWith('/members:batch-roles')),
    ).toHaveLength(1)
  })

  it('收回成員最後一個角色時在前端拒絕，不送請求', async () => {
    const { calls } = renderMembers()
    await screen.findByText('林鮑伯')
    fireEvent.click(screen.getByRole('checkbox', { name: /林鮑伯/ }))
    fireEvent.change(await screen.findByLabelText('批次角色'), {
      target: { value: 'role-a' },
    })
    fireEvent.click(
      await screen.findByRole('button', { name: '批次收回角色' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '至少保留一個角色',
    )
    expect(
      calls.some((call) => call.path.endsWith('/members:batch-roles')),
    ).toBe(false)
  })

  it('批次收回角色以完整剩餘角色集合呼叫端點', async () => {
    const { calls } = renderMembers(false, ['role-a', 'role-b'])
    await screen.findByText('林鮑伯')
    fireEvent.click(screen.getByRole('checkbox', { name: /林鮑伯/ }))
    fireEvent.change(await screen.findByLabelText('批次角色'), {
      target: { value: 'role-a' },
    })
    fireEvent.click(
      await screen.findByRole('button', { name: '批次收回角色' }),
    )

    await waitFor(() =>
      expect(
        calls.find((call) => call.path.endsWith('/members:batch-roles')),
      ).toMatchObject({
        method: 'POST',
        body: JSON.stringify({
          items: [{ user_id: 'user-2', role_ids: ['role-b'] }],
        }),
      }),
    )
  })
})
