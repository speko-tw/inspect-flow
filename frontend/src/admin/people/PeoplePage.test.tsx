import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DataMemoryRouter } from '../../testing/DataMemoryRouter'
import PeoplePage from './PeoplePage'

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
    onTemporaryPasswordVisible,
    onRequestTemporaryPasswordLeave,
    onWizardBackToList,
    onWizardViewUser,
  }: {
    selectedUserId?: string
    openWizardRequest?: number
    onTemporaryPasswordVisible?: (visible: boolean) => void
    onRequestTemporaryPasswordLeave?: (action: () => void) => void
    onWizardBackToList?: () => void
    onWizardViewUser?: (id: string) => void
  }) => (
    <ModulePermissionsMock
      onRequestTemporaryPasswordLeave={onRequestTemporaryPasswordLeave}
      onTemporaryPasswordVisible={onTemporaryPasswordVisible}
      onWizardBackToList={onWizardBackToList}
      onWizardViewUser={onWizardViewUser}
      openWizardRequest={openWizardRequest}
      selectedUserId={selectedUserId}
    />
  ),
}))

function ModulePermissionsMock({
  openWizardRequest,
  selectedUserId,
  onTemporaryPasswordVisible,
  onRequestTemporaryPasswordLeave,
  onWizardBackToList,
  onWizardViewUser,
}: {
  openWizardRequest?: number
  selectedUserId?: string
  onTemporaryPasswordVisible?: (visible: boolean) => void
  onRequestTemporaryPasswordLeave?: (action: () => void) => void
  onWizardBackToList?: () => void
  onWizardViewUser?: (id: string) => void
}) {
  const [passwordVisible, setPasswordVisible] = useState(false)
  const action = (leave: () => void) =>
    onRequestTemporaryPasswordLeave?.(leave)

  return (
    <section>
      {selectedUserId ? '模組授權' : '能力設定'}
      {openWizardRequest ? (
        <>
          <button
            onClick={() => {
              setPasswordVisible(true)
              onTemporaryPasswordVisible?.(true)
            }}
            type="button"
          >
            顯示臨時密碼
          </button>
          {passwordVisible && <output>temporary-secret</output>}
          <button
            onClick={() =>
              action(() => {
                setPasswordVisible(false)
                onTemporaryPasswordVisible?.(false)
              })
            }
            type="button"
          >
            新增另一個帳號
          </button>
          <button
            onClick={() =>
              action(() => {
                setPasswordVisible(false)
                onTemporaryPasswordVisible?.(false)
                onWizardBackToList?.()
              })
            }
            type="button"
          >
            回清單
          </button>
          <button
            onClick={() =>
              action(() => {
                setPasswordVisible(false)
                onTemporaryPasswordVisible?.(false)
                onWizardViewUser?.('person-1')
              })
            }
            type="button"
          >
            查看這個帳號的能力
          </button>
        </>
      ) : null}
    </section>
  )
}

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

  it('臨時密碼顯示時，站內導覽須確認且可留在精靈', async () => {
    peopleApiMock.request.mockResolvedValue({ items: [] })
    render(
      <DataMemoryRouter initialEntries={['/accounts']}>
        <>
          <PeoplePage onTemporaryPassword={vi.fn()} />
          <Link to="/companies">離開精靈</Link>
        </>
      </DataMemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '新增帳號' }))
    fireEvent.click(screen.getByRole('button', { name: '顯示臨時密碼' }))
    fireEvent.click(screen.getByRole('link', { name: '離開精靈' }))

    expect(
      await screen.findByRole('heading', { name: '臨時密碼抄下了嗎？' }),
    ).toBeVisible()
    expect(screen.getByRole('heading', { name: '新增帳號' })).toBeVisible()
    expect(screen.getByText('temporary-secret')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '留在此頁' }))
    expect(
      screen.queryByRole('heading', { name: '臨時密碼抄下了嗎？' }),
    ).toBeNull()
    expect(screen.getByRole('heading', { name: '新增帳號' })).toBeVisible()
    expect(screen.getByText('temporary-secret')).toBeVisible()
  })

  it.each([
    ['新增另一個帳號', '新增帳號'],
    ['回清單', '帳號'],
    ['查看這個帳號的能力', '詳情：person-1'],
    ['取消', '帳號'],
  ])(
    '內部操作「%s」取消會保留密碼，確認後才執行',
    async (actionLabel, expectedAfterConfirm) => {
      peopleApiMock.request.mockResolvedValue({ items: [] })
      render(
        <DataMemoryRouter initialEntries={['/accounts']}>
          <PeoplePage onTemporaryPassword={vi.fn()} />
        </DataMemoryRouter>,
      )

      fireEvent.click(await screen.findByRole('button', { name: '新增帳號' }))
      fireEvent.click(screen.getByRole('button', { name: '顯示臨時密碼' }))
      expect(screen.getByText('temporary-secret')).toBeVisible()

      fireEvent.click(screen.getByRole('button', { name: actionLabel }))
      expect(
        await screen.findByRole('heading', { name: '臨時密碼抄下了嗎？' }),
      ).toBeVisible()
      expect(screen.getByText('temporary-secret')).toBeVisible()
      fireEvent.click(screen.getByRole('button', { name: '留在此頁' }))
      expect(screen.getByText('temporary-secret')).toBeVisible()
      expect(screen.getByRole('button', { name: actionLabel })).toBeVisible()

      fireEvent.click(screen.getByRole('button', { name: actionLabel }))
      fireEvent.click(screen.getByRole('button', { name: '離開此頁' }))
      expect(screen.queryByText('temporary-secret')).toBeNull()
      if (expectedAfterConfirm === '新增帳號') {
        expect(screen.getByRole('heading', { name: '新增帳號' })).toBeVisible()
      } else if (expectedAfterConfirm === '帳號') {
        expect(screen.getByRole('heading', { name: '帳號' })).toBeVisible()
      } else {
        expect(screen.getByText('詳情：person-1')).toBeVisible()
      }
    },
  )

  it('臨時密碼顯示時，瀏覽器返回使用指定確認文字', async () => {
    peopleApiMock.request.mockResolvedValue({ items: [] })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    function BackNavigation() {
      const navigate = useNavigate()
      const location = useLocation()
      return (
        <>
          <output data-testid="path">{location.pathname}</output>
          <button onClick={() => navigate(-1)} type="button">
            上一頁
          </button>
        </>
      )
    }

    render(
      <DataMemoryRouter
        initialEntries={['/companies', '/accounts']}
        initialIndex={1}
      >
        <>
          <PeoplePage onTemporaryPassword={vi.fn()} />
          <BackNavigation />
        </>
      </DataMemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '新增帳號' }))
    fireEvent.click(screen.getByRole('button', { name: '顯示臨時密碼' }))
    fireEvent.click(screen.getByRole('button', { name: '上一頁' }))

    expect(confirm).toHaveBeenCalledWith('臨時密碼抄下了嗎？')
    expect(screen.getByTestId('path')).toHaveTextContent('/accounts')
    expect(screen.getByText('temporary-secret')).toBeVisible()
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

  it('returns to the list when the account nav link is clicked in the wizard', () => {
    peopleApiMock.request.mockResolvedValue({ items: [] })
    render(
      <DataMemoryRouter initialEntries={['/accounts']}>
        <Link to="/accounts">帳號導覽</Link>
        <PeoplePage onTemporaryPassword={vi.fn()} />
      </DataMemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: '新增帳號' }))
    expect(screen.getByRole('heading', { name: '新增帳號' })).toBeVisible()
    expect(screen.getByText('能力設定')).toBeVisible()

    fireEvent.click(screen.getByRole('link', { name: '帳號導覽' }))

    expect(screen.getByRole('heading', { name: '帳號' })).toBeVisible()
    expect(screen.queryByText('能力設定')).toBeNull()
    expect(screen.getByRole('button', { name: '新增帳號' })).toBeVisible()
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
