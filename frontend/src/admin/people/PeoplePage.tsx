import { useEffect, useState } from 'react'
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

/** Admin 人員入口；保留清單與授權精靈狀態供清單、詳情路由共用。 */
export function PeoplePage({
  onTemporaryPassword,
}: {
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
  const [wizardRequest, setWizardRequest] = useState(0)
  const [wizardDirty, setWizardDirty] = useState(false)
  const [wizardHasTemporaryPassword, setWizardHasTemporaryPassword] =
    useState(false)
  const [pendingPasswordLeave, setPendingPasswordLeave] = useState<
    (() => void) | null
  >(null)
  const [userFormsDirty, setUserFormsDirty] = useState(false)
  const pageGuard = useUnsavedNavigationGuard(
    wizardDirty || userFormsDirty || wizardHasTemporaryPassword,
    wizardHasTemporaryPassword
      ? '臨時密碼抄下了嗎？'
      : '有尚未儲存的變更。確定要離開嗎？',
  )
  // 完成頁點導覽的「帳號」會連到同一個網址，路徑沒變、只有
  // location.key 換新；此時精靈要收起，回到清單（#713）。
  const [seenLocationKey, setSeenLocationKey] = useState(location.key)
  if (seenLocationKey !== location.key) {
    setSeenLocationKey(location.key)
    setWizardRequest(0)
  }
  const detailMatch = location.pathname.match(
    new RegExp(
      `^${ROUTES.adminPeople.path.replace('/:personId?', '')}/([^/]+)$`,
    ),
  )
  const personId = detailMatch ? decodePersonId(detailMatch[1]) : null
  const createWizardOpen = user.is_admin && wizardRequest > 0
  const query = searchParams.get('q') ?? ''

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
      ) : wizardHasTemporaryPassword && pageGuard.pending ? (
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
      {personId ? (
        <p>
          <Link
            to={{
              pathname: '/accounts',
              search: query ? `?q=${encodeURIComponent(query)}` : '',
            }}
          >
            返回{ACCOUNT_LABEL}清單
          </Link>
        </p>
      ) : createWizardOpen ? (
        !wizardHasTemporaryPassword && (
          <button
            onClick={() => requestPasswordLeave(() => setWizardRequest(0))}
            type="button"
          >
            取消
          </button>
        )
      ) : (
        user.is_admin && (
          <button
            className="btn-primary"
            onClick={() => setWizardRequest((value) => value + 1)}
            type="button"
          >
            新增帳號
          </button>
        )
      )}
      {!user.is_admin && personId && (
        <DelegatedPersonHeading userId={personId} />
      )}
      {user.is_admin && !createWizardOpen ? (
        <UsersPage
          detailUserId={personId}
          hideCreateForm
          initialQuery={query}
          externalNavigationGuard
          onDirtyChange={setUserFormsDirty}
          onQueryApplied={updateQuery}
          onSelectUser={(id) => {
            const next = new URLSearchParams(searchParams)
            if (query) next.set('q', query)
            navigate({
              pathname: routePath(ROUTES.adminPeople, { personId: id }),
              search: next.toString(),
            })
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
          openWizardRequest={wizardRequest}
          onDirtyChange={setWizardDirty}
          onTemporaryPasswordVisible={setWizardHasTemporaryPassword}
          onRequestTemporaryPasswordLeave={requestPasswordLeave}
          onWizardBackToList={() => setWizardRequest(0)}
          onWizardViewUser={(id) => {
            setWizardRequest(0)
            navigate(routePath(ROUTES.adminPeople, { personId: id }))
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
