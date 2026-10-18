import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DataMemoryRouter } from '../../testing/DataMemoryRouter'
import PeoplePage from './PeoplePage'

const peopleApiMock = vi.hoisted(() => ({
  listAllPages: vi.fn(),
  listProjectMembers: vi.fn(),
  request: vi.fn(),
  isAdmin: true,
}))

vi.mock('../api', () => ({
  listAllPages: peopleApiMock.listAllPages,
  request: peopleApiMock.request,
}))

vi.mock('../projects/api', () => ({
  listProjectMembers: peopleApiMock.listProjectMembers,
}))

vi.mock('../../auth/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: { is_admin: peopleApiMock.isAdmin },
    clear: vi.fn(),
  }),
}))

vi.mock('../UsersPage', () => ({
  default: ({
    onSelectUser,
    initialQuery,
    detailUserId,
  }: {
    onSelectUser: (id: string) => void
    initialQuery: string
    detailUserId?: string | null
  }) => (
    <section>
      <span>搜尋：{initialQuery}</span>
      {detailUserId && <span>詳情：{detailUserId}</span>}
      <button onClick={() => onSelectUser('person-1')}>開啟林沐青</button>
    </section>
  ),
}))

vi.mock('../module-permissions/ModulePermissionsPage', () => ({
  default: ({ selectedUserId }: { selectedUserId?: string }) => (
    <section>{selectedUserId ? '模組授權' : '能力設定'}</section>
  ),
}))

describe('PeoplePage', () => {
  beforeEach(() => {
    peopleApiMock.isAdmin = true
    peopleApiMock.request.mockReset()
  })

  it('keeps delegate access to its API-provided account and module panel only', async () => {
    peopleApiMock.isAdmin = false
    peopleApiMock.request.mockResolvedValue({
      items: [
        { id: 'delegate-person', username: 'field.member', name_zh: '林沐青' },
      ],
      next_cursor: null,
    })
    render(
      <DataMemoryRouter initialEntries={['/admin/people']}>
        <PeoplePage onTemporaryPassword={vi.fn()} />
      </DataMemoryRouter>,
    )

    expect(screen.queryByRole('button', { name: '新增帳號' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: '林沐青' }))

    expect(await screen.findByText('模組授權')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新增帳號' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '基本資料' })).toBeNull()
    expect(screen.queryByRole('button', { name: '修改資料' })).toBeNull()
    expect(screen.queryByRole('button', { name: /公司/ })).toBeNull()
    expect(screen.queryByRole('link', { name: '角色' })).toBeNull()
    expect(screen.queryByRole('link', { name: '紀錄' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '套用權限組合' })).toBeNull()
    expect(peopleApiMock.request).toHaveBeenCalledWith(
      '/module-delegate/users?limit=50',
    )
  })

  it('shows participating projects with links to member management', async () => {
    peopleApiMock.listAllPages.mockResolvedValue([
      { id: 'project-1', project_code: 'PR-1', name: '示範工程' },
    ])
    peopleApiMock.listProjectMembers.mockResolvedValue([
      { user_id: 'person-1' },
    ])
    render(
      <DataMemoryRouter initialEntries={['/admin/people/person-1']}>
        <PeoplePage onTemporaryPassword={vi.fn()} />
      </DataMemoryRouter>,
    )

    expect(
      await screen.findByRole('link', { name: /PR-1／示範工程/ }),
    ).toHaveAttribute('href', '/admin/projects/project-1/members')
  })

  it('labels a partial project summary incomplete instead of showing an empty state', async () => {
    peopleApiMock.listAllPages.mockResolvedValue([
      { id: 'project-1', project_code: 'PR-1', name: '示範工程' },
      { id: 'project-2', project_code: 'PR-2', name: '另一工程' },
    ])
    peopleApiMock.listProjectMembers.mockImplementation((projectId: string) =>
      projectId === 'project-1'
        ? Promise.resolve([])
        : Promise.reject(new Error('Forbidden')),
    )
    render(
      <DataMemoryRouter initialEntries={['/admin/people/person-1']}>
        <PeoplePage onTemporaryPassword={vi.fn()} />
      </DataMemoryRouter>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('摘要不完整')
    expect(screen.queryByText('目前沒有參與專案。')).toBeNull()
  })

  it('keeps list search in the route when opening a person', () => {
    render(
      <DataMemoryRouter initialEntries={['/admin/people?q=林沐']}>
        <PeoplePage onTemporaryPassword={vi.fn()} />
      </DataMemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: '帳號' })).toBeInTheDocument()
    expect(screen.getByText('搜尋：林沐')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '開啟林沐青' }))

    expect(screen.getByRole('link', { name: '返回帳號清單' })).toHaveAttribute(
      'href',
      '/admin/people?q=%E6%9E%97%E6%B2%90',
    )
    expect(screen.getByText('詳情：person-1')).toBeInTheDocument()
    expect(screen.getByText('搜尋：林沐')).toBeInTheDocument()
  })
})
