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
import { listAllPages } from '../api'
import { listProjectMembers } from '../projects/api'

interface DelegatePerson {
  id: string
  username: string
  name_zh: string | null
}

interface DelegatePersonPage {
  items: DelegatePerson[]
  next_cursor: string | null
}

/** Admin 人員入口；保留清單與授權精靈狀態供清單、詳情路由共用。 */
export function PeoplePage({
  onTemporaryPassword,
}: {
  onTemporaryPassword: (username: string, password: string) => void
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useCurrentUser()
  const [searchParams, setSearchParams] = useSearchParams()
  const [wizardRequest, setWizardRequest] = useState(0)
  const [wizardDirty, setWizardDirty] = useState(false)
  const [userFormsDirty, setUserFormsDirty] = useState(false)
  const pageGuard = useUnsavedNavigationGuard(wizardDirty || userFormsDirty)
  const detailMatch = location.pathname.match(/^\/admin\/people\/([^/]+)$/)
  const personId = detailMatch ? decodeURIComponent(detailMatch[1]) : null
  const query = searchParams.get('q') ?? ''

  function updateQuery(nextQuery: string) {
    const next = new URLSearchParams(searchParams)
    if (nextQuery.trim()) next.set('q', nextQuery.trim())
    else next.delete('q')
    setSearchParams(next, { replace: true })
  }

  return (
    <main aria-labelledby="people-heading" className="admin-page">
      <UnsavedLeaveBox guard={pageGuard} />
      <h1 id="people-heading">{ACCOUNT_LABEL}</h1>
      {personId ? (
        <p>
          <Link
            to={{
              pathname: '/admin/people',
              search: query ? `?q=${encodeURIComponent(query)}` : '',
            }}
          >
            返回{ACCOUNT_LABEL}清單
          </Link>
        </p>
      ) : (
        user.is_admin && (
          <button onClick={() => setWizardRequest((value) => value + 1)}>
            新增帳號
          </button>
        )
      )}
      {user.is_admin ? (
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
              pathname: `/admin/people/${encodeURIComponent(id)}`,
              search: next.toString(),
            })
          }}
          onTemporaryPassword={onTemporaryPassword}
        />
      ) : (
        !personId && (
          <DelegatedPeopleList
            key={query}
            onSelect={(id) =>
              navigate({
                pathname: `/admin/people/${encodeURIComponent(id)}`,
                search: query ? `?q=${encodeURIComponent(query)}` : '',
              })
            }
            query={query}
            updateQuery={updateQuery}
            visible
          />
        )
      )}
      {(personId || (user.is_admin && wizardRequest > 0)) && (
        <ModulePermissionsPage
          embedded
          externalNavigationGuard
          openWizardRequest={wizardRequest}
          onDirtyChange={setWizardDirty}
          selectedUserId={personId ?? undefined}
          onTemporaryPassword={onTemporaryPassword}
        />
      )}
      {user.is_admin && personId && (
        <ParticipatingProjects userId={personId} />
      )}
    </main>
  )
}

function DelegatedPeopleList({
  onSelect,
  query,
  updateQuery,
  visible,
}: {
  onSelect: (id: string) => void
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
      <ul aria-label="帳號清單">
        {items.map((person) => (
          <li key={person.id}>
            <button onClick={() => onSelect(person.id)} type="button">
              {person.name_zh || person.username}
            </button>
          </li>
        ))}
      </ul>
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

function ParticipatingProjects({ userId }: { userId: string }) {
  const [reloadRequest, setReloadRequest] = useState(0)
  const requestKey = `${userId}:${reloadRequest}`
  const [result, setResult] = useState<{
    key: string
    projects: Array<{ id: string; project_code: string; name: string }>
    error: string
    failedProjectCount: number
  }>({ key: '', projects: [], error: '', failedProjectCount: 0 })
  const loading = result.key !== requestKey
  const projects = result.key === requestKey ? result.projects : []
  const error = result.key === requestKey ? result.error : ''
  const failedProjectCount =
    result.key === requestKey ? result.failedProjectCount : 0

  useEffect(() => {
    let active = true
    const key = `${userId}:${reloadRequest}`
    void listAllPages<{ id: string; project_code: string; name: string }>(
      '/projects',
    )
      .then(async (allProjects) => {
        const memberships = await mapWithConcurrency(
          allProjects,
          4,
          async (project) => ({
            project,
            isMember: (await listProjectMembers(project.id)).some(
              (member) => member.user_id === userId,
            ),
          }),
        )
        if (active) {
          setResult({
            key,
            projects: memberships
              .filter(
                (
                  result,
                ): result is PromiseFulfilledResult<{
                  project: { id: string; project_code: string; name: string }
                  isMember: boolean
                }> => result.status === 'fulfilled' && result.value.isMember,
              )
              .map(({ value }) => value.project),
            failedProjectCount: memberships.filter(
              (result) => result.status === 'rejected',
            ).length,
            error: memberships.some((result) => result.status === 'rejected')
              ? '部分專案的成員資料無法讀取，摘要不完整。'
              : '',
          })
        }
      })
      .catch(() => {
        if (active) {
          setResult({
            key,
            projects: [],
            error: '目前無法載入參與專案。',
            failedProjectCount: 0,
          })
        }
      })
    return () => {
      active = false
    }
  }, [reloadRequest, userId])

  return (
    <section aria-labelledby="participating-projects-heading">
      <h2 id="participating-projects-heading">參與專案</h2>
      {loading && <p role="status">載入中…</p>}
      {error && <p role="alert">{error}</p>}
      {error && !loading && (
        <button
          onClick={() => setReloadRequest((request) => request + 1)}
          type="button"
        >
          重新載入參與專案
        </button>
      )}
      {!loading && !error && projects.length === 0 && (
        <p>目前沒有參與專案。</p>
      )}
      {failedProjectCount > 0 && (
        <p>有 {failedProjectCount} 個專案的成員資料尚未確認。</p>
      )}
      <ul>
        {projects.map((project) => (
          <li key={project.id}>
            <Link to={`/admin/projects/${project.id}/members`}>
              {project.project_code}／{project.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let nextIndex = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++
        try {
          results[index] = {
            status: 'fulfilled',
            value: await mapper(items[index]),
          }
        } catch (reason) {
          results[index] = { status: 'rejected', reason }
        }
      }
    }),
  )
  return results
}

export default PeoplePage
