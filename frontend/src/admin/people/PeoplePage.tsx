import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'

import { ACCOUNT_LABEL } from '../../layout/navigationLabels'
import {
  UnsavedLeaveBox,
  useUnsavedNavigationGuard,
} from '../../ui/navigation'
import UsersPage from '../UsersPage'
import ModulePermissionsPage from '../module-permissions/ModulePermissionsPage'
import { useCurrentUser } from '../../auth/useCurrentUser'
import { request } from '../api'
import { isResourceId } from '../../resourceId'
import RouteNotFound from '../../RouteNotFound'
import { routePath, ROUTES } from '../../routes'
import { BackLink } from '../../layout/BackLink'
import { Notice } from '../../ui/Notice'
import TemporaryPassword from '../TemporaryPassword'
import AccessDeniedPage from '../../components/layout/AccessDeniedPage'
import { ConfirmBox } from '../../ui/ConfirmBox'

interface DelegatePerson {
  id: string
  username: string
  name_zh: string | null
}

interface DelegatePersonPage {
  items: DelegatePerson[]
  next_cursor: string | null
}

/**
 * 網址中的帳號編號解碼；壞掉的百分比編碼（如 `%E0%A4%A`）會讓
 * decodeURIComponent 丟例外，改回傳原字串，後續 isResourceId 會
 * 擋下並顯示「找不到這個帳號」，不讓整頁崩潰（ADM-R25，#713）。
 */
function decodePersonId(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

type CreationResult = {
  id: string
  username: string
  temporary_password: string
  name_zh: string | null
}

const CreationContext = createContext<{
  created: CreationResult | null
  setCreated: (result: CreationResult | null) => void
} | null>(null)

/** 跨新增與詳情路由保存一次性結果；離開目標頁即清除。 */
export function AccountCreationProvider({
  children,
}: {
  children: ReactNode
}) {
  const location = useLocation()
  const [created, setCreated] = useState<CreationResult | null>(null)
  const [previousPath, setPreviousPath] = useState(location.pathname)
  if (previousPath !== location.pathname) {
    setPreviousPath(location.pathname)
    if (
      created &&
      location.pathname !==
        routePath(ROUTES.adminPeople, {
          personId: created.id,
        })
    )
      setCreated(null)
  }
  return (
    <CreationContext value={{ created, setCreated }}>
      {children}
    </CreationContext>
  )
}

/** 帳號路由入口；草稿在路由切換時重置，密碼不進入歷史或儲存。 */
export function PeoplePage(props: {
  onTemporaryPassword: (
    username: string,
    password: string,
    source?: 'created' | 'reset',
    displayName?: string,
  ) => void
}) {
  const location = useLocation()
  const result = useContext(CreationContext)
  return (
    <PeopleRoute
      key={location.pathname}
      {...props}
      created={
        result?.created &&
        location.pathname.replace(/\/$/, '') ===
          routePath(ROUTES.adminPeople, { personId: result.created.id })
          ? result.created
          : null
      }
      onCreated={(created) => result?.setCreated(created)}
    />
  )
}

/** ADM-R56：清單、詳情與新增各用自己的網址及頁內草稿。 */
function PeopleRoute({
  onTemporaryPassword,
  created,
  onCreated,
}: {
  created: CreationResult | null
  onCreated: (result: CreationResult) => void
  onTemporaryPassword: (
    username: string,
    password: string,
    source?: 'created' | 'reset',
    displayName?: string,
  ) => void
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useCurrentUser()
  const [searchParams, setSearchParams] = useSearchParams()
  const [wizardDirty, setWizardDirty] = useState(false)
  const [wizardHasTemporaryPassword, setWizardHasTemporaryPassword] =
    useState(false)
  const [pendingPasswordLeave, setPendingPasswordLeave] = useState<
    (() => void) | null
  >(null)
  const [userFormsDirty, setUserFormsDirty] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const pageGuard = useUnsavedNavigationGuard(
    wizardDirty ||
      userFormsDirty ||
      wizardHasTemporaryPassword ||
      Boolean(created),
    wizardHasTemporaryPassword || created
      ? '臨時密碼抄下了嗎？'
      : '有尚未儲存的變更。確定要離開嗎？',
  )
  const pathname = location.pathname.replace(/\/$/, '')
  const detailMatch = pathname.match(
    new RegExp(
      `^${ROUTES.adminPeople.path.replace('/:personId?', '')}/([^/]+)$`,
    ),
  )
  const isCreateRoute = pathname === ROUTES.adminAccountNew.path
  const personId =
    !isCreateRoute && detailMatch ? decodePersonId(detailMatch[1]) : null
  const createWizardOpen = user.is_admin && isCreateRoute
  const query = searchParams.get('q') ?? ''
  const listPath = `/accounts${query ? `?q=${encodeURIComponent(query)}` : ''}`

  function updateQuery(nextQuery: string) {
    const next = new URLSearchParams(searchParams)
    if (nextQuery.trim()) next.set('q', nextQuery.trim())
    else next.delete('q')
    setSearchParams(next, { replace: true })
  }

  function requestPasswordLeave(action: () => void) {
    if (wizardHasTemporaryPassword) {
      setPendingPasswordLeave(() => action)
      return
    }
    action()
  }

  function confirmPasswordLeave() {
    const action = pendingPasswordLeave
    setPendingPasswordLeave(null)
    if (action) pageGuard.allowNavigation(action)
  }

  // 帳號編號會原樣拼進 API 路徑；特製網址（含 `/`、`?`）解碼後不得
  // 送出請求，直接顯示找不到（ADM-R25，#711）。
  if (accessDenied || (isCreateRoute && !user.is_admin)) {
    return <AccessDeniedPage />
  }

  if (personId && !isResourceId(personId)) {
    return (
      <section className="admin-page">
        <RouteNotFound
          message="網址可能輸入錯誤，或這個帳號已不存在。"
          title="找不到這個帳號"
        />
      </section>
    )
  }

  return (
    <section
      aria-labelledby={
        personId
          ? user.is_admin
            ? 'person-basic-heading'
            : 'delegated-person-heading'
          : 'people-heading'
      }
      className="admin-page"
    >
      {pendingPasswordLeave ? (
        <ConfirmBox
          cancelLabel="留在此頁"
          confirmLabel="離開此頁"
          onCancel={() => setPendingPasswordLeave(null)}
          onConfirm={confirmPasswordLeave}
          title="臨時密碼抄下了嗎？"
        >
          <p>離開後就無法再次查看臨時密碼。</p>
        </ConfirmBox>
      ) : (wizardHasTemporaryPassword || created) && pageGuard.pending ? (
        <ConfirmBox
          cancelLabel="留在此頁"
          confirmLabel="離開此頁"
          onCancel={pageGuard.stay}
          onConfirm={pageGuard.leave}
          title="臨時密碼抄下了嗎？"
        >
          <p>離開後就無法再次查看臨時密碼。</p>
        </ConfirmBox>
      ) : (
        <UnsavedLeaveBox guard={pageGuard} />
      )}
      {!personId && (
        <h1 id="people-heading">
          {createWizardOpen ? '新增帳號' : ACCOUNT_LABEL}
        </h1>
      )}
      {personId || createWizardOpen ? (
        <BackLink replace to={listPath}>
          返回帳號清單
        </BackLink>
      ) : user.is_admin ? (
        <Link
          className="btn btn-primary"
          replace
          to={{
            pathname: ROUTES.adminAccountNew.path,
            search: location.search,
          }}
        >
          新增帳號
        </Link>
      ) : null}
      {created && (
        <section aria-label="建立完成">
          <Notice>
            <h2>已新增{created.name_zh || created.username}的帳號</h2>
          </Notice>
          <p>帳號：{created.username}</p>
          <p>他第一次登入必須先改成自己的密碼。離開此頁後就看不到這組密碼。</p>
          <TemporaryPassword password={created.temporary_password} />
        </section>
      )}
      {!user.is_admin && personId && (
        <DelegatedPersonHeading userId={personId} />
      )}
      {user.is_admin && !createWizardOpen ? (
        <UsersPage
          detailUserId={personId}
          initialQuery={query}
          externalNavigationGuard
          onDirtyChange={setUserFormsDirty}
          onQueryApplied={updateQuery}
          onSelectUser={(id) => {
            const next = new URLSearchParams(searchParams)
            if (query) next.set('q', query)
            navigate(
              {
                pathname: routePath(ROUTES.adminPeople, { personId: id }),
                search: next.toString(),
              },
              { replace: true },
            )
          }}
          onTemporaryPassword={onTemporaryPassword}
        />
      ) : !user.is_admin ? (
        !personId && (
          <DelegatedPeopleList
            key={query}
            currentUserId={user.id}
            query={query}
            updateQuery={updateQuery}
            visible
          />
        )
      ) : null}
      {(personId || createWizardOpen) && (
        <ModulePermissionsPage
          embedded
          externalNavigationGuard
          onForbidden={() => setAccessDenied(true)}
          openWizardRequest={createWizardOpen ? 1 : 0}
          onWizardCancel={
            createWizardOpen
              ? () => navigate(listPath, { replace: true })
              : undefined
          }
          onCreationComplete={(result) => {
            onCreated(result)
            pageGuard.allowNavigation(() =>
              navigate(
                {
                  pathname: routePath(ROUTES.adminPeople, {
                    personId: result.id,
                  }),
                  search: location.search,
                },
                { replace: true },
              ),
            )
          }}
          onDirtyChange={setWizardDirty}
          onTemporaryPasswordVisible={setWizardHasTemporaryPassword}
          onRequestTemporaryPasswordLeave={requestPasswordLeave}
          onWizardBackToList={() => navigate(listPath, { replace: true })}
          onWizardViewUser={(id) => {
            navigate(routePath(ROUTES.adminPeople, { personId: id }), {
              replace: true,
            })
          }}
          selectedUserId={personId ?? undefined}
        />
      )}
    </section>
  )
}

function DelegatedPersonHeading({ userId }: { userId: string }) {
  const [result, setResult] = useState<{
    userId: string
    person: DelegatePerson | null
    error: string
  } | null>(null)
  const currentResult = result?.userId === userId ? result : null

  useEffect(() => {
    let active = true
    void request<DelegatePerson>(
      `/module-delegate/users/${encodeURIComponent(userId)}`,
    )
      .then((person) => active && setResult({ userId, person, error: '' }))
      .catch(() => {
        if (active) {
          setResult({ userId, person: null, error: '目前無法查看此帳號。' })
        }
      })
    return () => {
      active = false
    }
  }, [userId])

  if (currentResult?.error) {
    return <p role="alert">{currentResult.error}</p>
  }
  if (!currentResult?.person) return <p role="status">載入帳號…</p>
  const person = currentResult.person
  return (
    <header>
      <h1 id="delegated-person-heading">
        {person.name_zh || person.username}
      </h1>
      <p>帳號：{person.username}</p>
    </header>
  )
}

function DelegatedPeopleList({
  currentUserId,
  query,
  updateQuery,
  visible,
}: {
  currentUserId: string
  query: string
  updateQuery: (query: string) => void
  visible: boolean
}) {
  const [input, setInput] = useState(query)
  const requestKey = `${visible}:${query}`
  const [result, setResult] = useState<{
    key: string
    items: DelegatePerson[]
    cursor: string | null
    error: string
  }>({ key: '', items: [], cursor: null, error: '' })
  const [loadingMore, setLoadingMore] = useState(false)
  const loading = (visible && result.key !== requestKey) || loadingMore
  const items = result.key === requestKey ? result.items : []
  const cursor = result.key === requestKey ? result.cursor : null
  const error = result.key === requestKey ? result.error : ''

  useEffect(() => {
    if (!visible) return
    let active = true
    const key = `${visible}:${query}`
    const params = new URLSearchParams({ limit: '50' })
    if (query.trim()) params.set('q', query.trim())
    void request<DelegatePersonPage>(
      `/module-delegate/users?${params.toString()}`,
    )
      .then((page) => {
        if (!active) return
        setResult({
          key,
          items: page.items,
          cursor: page.next_cursor,
          error: '',
        })
      })
      .catch(
        () =>
          active &&
          setResult({
            key,
            items: [],
            cursor: null,
            error: '目前無法載入帳號清單，請重試。',
          }),
      )
    return () => {
      active = false
    }
  }, [query, visible])

  async function loadMore() {
    if (!cursor || loading) return
    setLoadingMore(true)
    setResult((current) => ({ ...current, error: '' }))
    try {
      const params = new URLSearchParams({ limit: '50', cursor })
      if (query.trim()) params.set('q', query.trim())
      const page = await request<DelegatePersonPage>(
        `/module-delegate/users?${params.toString()}`,
      )
      setResult((current) => ({
        ...current,
        items: [...current.items, ...page.items],
        cursor: page.next_cursor,
      }))
    } catch {
      setResult((current) => ({
        ...current,
        error: '目前無法載入更多帳號，請重試。',
      }))
    } finally {
      setLoadingMore(false)
    }
  }

  if (!visible) return null

  return (
    <section aria-label="可管理權限的帳號">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          updateQuery(input.trim())
        }}
      >
        <label>
          搜尋帳號
          <input
            onChange={(event) => setInput(event.target.value)}
            value={input}
          />
        </label>
        <button type="submit">搜尋</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">載入中…</p>}
      <div
        aria-label="帳號清單，可水平捲動"
        className="users-table-scroll"
        role="region"
        tabIndex={0}
      >
        <table className="users-account-table">
          <thead>
            <tr>
              <th scope="col">姓名</th>
              <th scope="col">帳號</th>
            </tr>
          </thead>
          <tbody>
            {items
              .filter((person) => person.id !== currentUserId)
              .map((person) => (
                <tr key={person.id}>
                  <th scope="row">
                    <Link
                      className="users-account-name-link"
                      to={{
                        pathname: routePath(ROUTES.adminPeople, {
                          personId: person.id,
                        }),
                        search: query ? `?q=${encodeURIComponent(query)}` : '',
                      }}
                    >
                      {person.name_zh || person.username}
                    </Link>
                  </th>
                  <td data-label="帳號">{person.username}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {cursor && (
        <button
          disabled={loading}
          onClick={() => void loadMore()}
          type="button"
        >
          載入更多
        </button>
      )}
    </section>
  )
}

export default PeoplePage
