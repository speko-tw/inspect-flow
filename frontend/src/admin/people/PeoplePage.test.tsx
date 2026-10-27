import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useLocation, useNavigate } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DataMemoryRouter } from '../../testing/DataMemoryRouter'
import PeoplePage, { AccountCreationProvider } from './PeoplePage'

const peopleApiMock = vi.hoisted(() => ({
  request: vi.fn(),
  isAdmin: true,
}))

vi.mock('../api', () => ({
  request: peopleApiMock.request,
}))

vi.mock('../../auth/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: {
      id: 'delegate-self',
      is_admin: peopleApiMock.isAdmin,
    },
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
  default: ({
    selectedUserId,
    openWizardRequest,
    onCreationComplete,
    onWizardCancel,
  }: {
    selectedUserId?: string
    openWizardRequest?: number
    onWizardCancel?: () => void
    onCreationComplete?: (result: {
      id: string
      username: string
      name_zh: string
      temporary_password: string
    }) => void
  }) => (
    <section>
      {selectedUserId ? '模組授權' : '能力設定'}
      {openWizardRequest ? (
        <>
          <input aria-label="精靈草稿" />
          <button onClick={onWizardCancel}>取消</button>
          <button
            onClick={() =>
              onCreationComplete?.({
                id: 'person-1',
                username: 'new.person',
                name_zh: '新帳號',
                temporary_password: 'once-only-password',
              })
            }
          >
            完成建立
          </button>
        </>
      ) : null}
    </section>
  ),
}))

describe('PeoplePage', () => {
  beforeEach(() => {
    peopleApiMock.isAdmin = true
    peopleApiMock.request.mockReset()
  })

  it('keeps delegate access to its API-provided account and module panel only', async () => {
    peopleApiMock.isAdmin = false
    peopleApiMock.request.mockImplementation((path: string) => {
      if (path.startsWith('/module-delegate/users?')) {
        return Promise.resolve({
          items: [
            {
              id: 'delegate-self',
              username: 'field.member',
              name_zh: '林沐青',
            },
            {
              id: 'delegate-person',
              username: 'field.other',
              name_zh: '其他帳號',
            },
          ],
          next_cursor: null,
        })
      }
      return Promise.resolve({
        id: 'delegate-person',
        username: 'field.other',
        name_zh: '其他帳號',
      })
    })
    render(
      <DataMemoryRouter initialEntries={['/accounts']}>
        <PeoplePage onTemporaryPassword={vi.fn()} />
      </DataMemoryRouter>,
    )

    expect(screen.queryByRole('button', { name: '新增帳號' })).toBeNull()
    expect(screen.queryByText('林沐青')).toBeNull()
    fireEvent.click(await screen.findByRole('link', { name: '其他帳號' }))

    expect(await screen.findByText('模組授權')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '其他帳號' }),
    ).toBeInTheDocument()
    expect(screen.getByText('帳號：field.other')).toBeInTheDocument()
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

  it('shows loading for a new account and ignores an older detail response', async () => {
    peopleApiMock.isAdmin = false
    const first = deferred<{
      id: string
      username: string
      name_zh: string
    }>()
    const second = deferred<{
      id: string
      username: string
      name_zh: string
    }>()
    peopleApiMock.request.mockImplementation((path: string) =>
      path.endsWith('/person-1') ? first.promise : second.promise,
    )

    function AccountSwitcher() {
      const navigate = useNavigate()
      return (
        <button onClick={() => navigate('/accounts/person-2')} type="button">
          切換帳號
        </button>
      )
    }

    render(
      <DataMemoryRouter initialEntries={['/accounts/person-1']}>
        <>
          <PeoplePage onTemporaryPassword={vi.fn()} />
          <AccountSwitcher />
        </>
      </DataMemoryRouter>,
    )

    expect(await screen.findByText('載入帳號…')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '切換帳號' }))
    expect(await screen.findByText('載入帳號…')).toBeVisible()

    second.resolve({
      id: 'person-2',
      username: 'field.two',
      name_zh: '第二位人員',
    })
    expect(
      await screen.findByRole('heading', { name: '第二位人員' }),
    ).toBeVisible()
    first.resolve({
      id: 'person-1',
      username: 'field.one',
      name_zh: '第一位人員',
    })
    expect(screen.queryByRole('heading', { name: '第一位人員' })).toBeNull()
    expect(screen.getByText('帳號：field.two')).toBeInTheDocument()
  })

  it('applies a full account name as the delegate search query', async () => {
    peopleApiMock.isAdmin = false
    peopleApiMock.request.mockResolvedValue({
      items: [
        { id: 'delegate-person', username: 'field.member', name_zh: '林沐青' },
      ],
      next_cursor: null,
    })
    render(
      <DataMemoryRouter initialEntries={['/accounts']}>
        <PeoplePage onTemporaryPassword={vi.fn()} />
      </DataMemoryRouter>,
    )

    const input = await screen.findByRole('textbox', { name: '搜尋帳號' })
    fireEvent.change(input, { target: { value: 'field.member' } })
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }))

    expect(await screen.findByRole('link', { name: '林沐青' })).toBeVisible()
    expect(peopleApiMock.request).toHaveBeenCalledWith(
      '/module-delegate/users?limit=50&q=field.member',
    )
  })

  it('新增帳號是帳號頁的主要按鈕', async () => {
    peopleApiMock.request.mockResolvedValue({ items: [] })
    render(
      <DataMemoryRouter initialEntries={['/accounts']}>
        <PeoplePage onTemporaryPassword={vi.fn()} />
      </DataMemoryRouter>,
    )

    expect(await screen.findByRole('link', { name: '新增帳號' })).toHaveClass(
      'btn-primary',
    )
  })

  it.each(['返回帳號清單', '取消'])(
    'ADM-AC56：%s 保留搜尋並以 replace 返回',
    async (action) => {
      render(
        <DataMemoryRouter
          initialEntries={['/companies', '/accounts/new?q=anna']}
          initialIndex={1}
        >
          <PeoplePage onTemporaryPassword={vi.fn()} />
          <RouteProbe />
        </DataMemoryRouter>,
      )
      expect(screen.getByText('能力設定')).toBeVisible()
      expect(screen.queryByText('詳情：new')).toBeNull()
      fireEvent.click(
        screen.getByRole(action === '取消' ? 'button' : 'link', {
          name: action,
        }),
      )
      expect(screen.getByTestId('route')).toHaveTextContent('/accounts?q=anna')
      fireEvent.click(screen.getByRole('button', { name: '測試上一頁' }))
      await waitFor(() =>
        expect(screen.getByTestId('route')).toHaveTextContent('/companies'),
      )
    },
  )

  it('ADM-AC56：完成以 replace 進詳情；上一頁不回精靈', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <DataMemoryRouter
        initialEntries={['/companies', '/accounts/new?q=anna']}
        initialIndex={1}
      >
        <AccountCreationProvider>
          <PeoplePage onTemporaryPassword={vi.fn()} />
        </AccountCreationProvider>
        <RouteProbe />
      </DataMemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '完成建立' }))
    expect(await screen.findByText('詳情：person-1')).toBeVisible()
    expect(screen.getByTestId('route')).toHaveTextContent(
      '/accounts/person-1?q=anna',
    )
    expect(
      screen.getByRole('heading', { name: '已新增新帳號的帳號' }),
    ).toBeVisible()
    expect(screen.getByLabelText('臨時密碼')).toHaveTextContent(
      'once-only-password',
    )
    fireEvent.click(screen.getByRole('button', { name: '測試上一頁' }))
    await waitFor(() =>
      expect(screen.getByTestId('route')).toHaveTextContent('/companies'),
    )
    expect(screen.queryByLabelText('臨時密碼')).toBeNull()
    confirm.mockRestore()
  })

  it('shows not-found for a malformed account id without any request', () => {
    render(
      <DataMemoryRouter initialEntries={['/accounts/..%2Fcompanies%3Fx']}>
        <PeoplePage onTemporaryPassword={vi.fn()} />
      </DataMemoryRouter>,
    )

    expect(screen.getByText('找不到這個帳號')).toBeVisible()
    expect(peopleApiMock.request).not.toHaveBeenCalled()
    expect(screen.queryByText('模組授權')).toBeNull()
  })

  it('shows not-found instead of crashing on a broken percent encoding', () => {
    render(
      <DataMemoryRouter initialEntries={['/accounts/%E0%A4%A']}>
        <PeoplePage onTemporaryPassword={vi.fn()} />
      </DataMemoryRouter>,
    )

    expect(screen.getByText('找不到這個帳號')).toBeVisible()
    expect(peopleApiMock.request).not.toHaveBeenCalled()
  })

  it('does not render a second participating-project section', async () => {
    peopleApiMock.request.mockResolvedValue({ items: [] })
    render(
      <DataMemoryRouter initialEntries={['/accounts/person-1']}>
        <PeoplePage onTemporaryPassword={vi.fn()} />
      </DataMemoryRouter>,
    )

    expect(await screen.findByText('模組授權')).toBeVisible()
    expect(screen.queryByRole('heading', { name: '參與專案' })).toBeNull()
    expect(peopleApiMock.request).not.toHaveBeenCalledWith(
      '/users/person-1/participating-projects',
    )
  })

  it('keeps list search in the route when opening a person', () => {
    peopleApiMock.request.mockResolvedValue({ items: [] })
    render(
      <DataMemoryRouter initialEntries={['/accounts?q=林沐']}>
        <PeoplePage onTemporaryPassword={vi.fn()} />
      </DataMemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: '帳號' })).toBeInTheDocument()
    expect(screen.getByText('搜尋：林沐')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '開啟林沐青' }))

    expect(screen.getByRole('link', { name: '返回帳號清單' })).toHaveAttribute(
      'href',
      '/accounts?q=%E6%9E%97%E6%B2%90',
    )
    expect(screen.getByText('詳情：person-1')).toBeInTheDocument()
    expect(screen.getByText('搜尋：林沐')).toBeInTheDocument()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function RouteProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <output data-testid="route">
        {location.pathname}
        {location.search}
      </output>
      <button onClick={() => navigate(-1)}>測試上一頁</button>
    </>
  )
}
