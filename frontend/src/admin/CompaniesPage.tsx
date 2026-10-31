import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { Link, useLocation, useMatch, useNavigate } from 'react-router'
import AccessDeniedPage from '../components/layout/AccessDeniedPage'
import RouteNotFound from '../RouteNotFound'
import { BackLink } from '../layout/BackLink'
import { isForbidden, isNotFound } from '../http'
import { isResourceId } from '../resourceId'

import { useCurrentUser } from '../auth/useCurrentUser'
import { StatusBadge } from '../ui/Badge'
import { ConfirmBox } from '../ui/ConfirmBox'
import { BatchActionBar } from '../ui/BatchActionBar'
import { Notice } from '../ui/Notice'
import { revealElement } from '../ui/reveal'
import { Form, FormError, FormSubmitButton, RequiredMark } from '../ui/Form'
import { activeStatus } from '../ui/statusBadge'
import { useSubmitGuard } from '../ui/submitGuard'
import { UnsavedLeaveBox } from '../ui/navigation'
import * as navigationGuard from '../ui/navigation'
import {
  createCompany,
  getCompany,
  ManagementApiError,
  type ListPageOptions,
  listActiveCompanyUsers,
  listCompaniesPage,
  managementErrorMessage,
  renameCompany,
  setCompaniesStatus,
  setCompanyActive,
  type ActiveCompanyUsers,
  type Company,
} from './api'
import { CursorListSearch } from './CursorListSearch'
import { mapWithConcurrency } from './mapWithConcurrency'
import { useCursorList } from './useCursorList'

type CompanyMode = 'list' | 'detail' | 'new'

/** ADM-R55：公司改名只有一欄，留詳情原地；其餘頁面依網址獨立。 */
export default function CompaniesPage() {
  const { user } = useCurrentUser()
  const location = useLocation()
  const list = useMatch('/companies')
  const creating = useMatch('/companies/new')
  const detail = useMatch('/companies/:companyId')
  const mode: CompanyMode = creating ? 'new' : detail ? 'detail' : 'list'
  const companyId = mode === 'detail' ? (detail?.params.companyId ?? '') : ''
  if (
    (!list && !creating && !detail) ||
    (companyId && !isResourceId(companyId))
  )
    return <RouteNotFound />
  if (!user.is_admin) return <AccessDeniedPage />
  const initialQuery =
    new URLSearchParams(location.search).get('q')?.trim() ?? ''
  // 搜尋條件跟著網址與頁面身分，不修改其他線負責的共用 cursor hook。
  return (
    <CompanyScreen
      key={`${mode}:${companyId}:${initialQuery}`}
      mode={mode}
      companyId={companyId}
      initialQuery={initialQuery}
    />
  )
}

function CompanyScreen({
  mode,
  companyId,
  initialQuery,
}: {
  mode: CompanyMode
  companyId: string
  initialQuery: string
}) {
  const { user: currentUser } = useCurrentUser()
  const navigate = useNavigate()
  const location = useLocation()
  const [forbidden, setForbidden] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const suffix = initialQuery ? `?q=${encodeURIComponent(initialQuery)}` : ''
  const listPath = `/companies${suffix}`
  const detailPath = (id: string) =>
    `/companies/${encodeURIComponent(id)}${suffix}`
  const [query, setQuery] = useState(initialQuery)
  // URL 是這一頁已套用的查詢；cursor 與 reload 仍由原 hook 管理。
  const fetchPage = useCallback(
    (options: ListPageOptions) =>
      mode === 'list'
        ? listCompaniesPage({ ...options, q: initialQuery })
        : Promise.resolve({ items: [], next_cursor: null }),
    [mode, initialQuery],
  )
  const loadError = useCallback((caught: unknown) => {
    if (isForbidden(caught)) setForbidden(true)
    return managementErrorMessage(caught)
  }, [])
  const companyList = useCursorList(fetchPage, loadError)
  const [detailCompany, setDetailCompany] = useState<Company | null>(null)
  const [detailLoading, setDetailLoading] = useState(mode === 'detail')
  const [detailError, setDetailError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [nameError, setNameError] = useState('')
  const company = detailCompany
  const {
    items: listCompanies,
    error: listError,
    nextCursor,
    loading: listLoading,
    loadingMore,
    reload,
    loadMore,
  } = companyList
  const companies =
    mode === 'detail' && detailCompany ? [detailCompany] : listCompanies
  const loading =
    mode === 'detail' ? detailLoading : mode === 'list' ? listLoading : false
  const appliedQuery = initialQuery

  function search(value: string) {
    if (companyList.loading || companyList.loadingMore) return
    const next = value.trim()
    if (next === initialQuery) {
      void reload()
      return
    }
    navigate(`/companies${next ? `?q=${encodeURIComponent(next)}` : ''}`, {
      replace: true,
    })
  }
  const clearSearch = () => search('')

  useEffect(() => {
    if (mode !== 'detail') return
    let active = true
    void getCompany(companyId)
      .then(
        (item) => {
          if (active) setDetailCompany(item)
        },
        (caught: unknown) => {
          if (!active) return
          setForbidden(isForbidden(caught))
          setNotFound(isNotFound(caught))
          setDetailError(managementErrorMessage(caught))
        },
      )
      .finally(() => {
        if (active) setDetailLoading(false)
      })
    return () => {
      active = false
    }
  }, [mode, companyId, reloadKey])
  const [name, setName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [error, setError] = useState('')
  const [operationNotice, setOperationNotice] = useState('')
  const [formNotice, setFormNotice] = useState(() => {
    const text = (location.state as { managementNotice?: unknown } | null)
      ?.managementNotice
    return typeof text === 'string' ? text : ''
  })
  const formRef = useRef<HTMLFormElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const renameButtonRef = useRef<HTMLButtonElement>(null)
  const wasRenaming = useRef(false)

  useEffect(() => {
    if (wasRenaming.current && !renamingId) {
      renameButtonRef.current?.focus({ preventScroll: true })
    }
    wasRenaming.current = Boolean(renamingId)
  }, [renamingId])

  useEffect(() => {
    if (!renamingId && mode !== 'new') return
    revealElement(formRef.current)
    nameRef.current?.focus({ preventScroll: true })
  }, [renamingId, mode])
  // 新增或改名的存檔錯誤：顯示在表單裡並聚焦。表單在頁面底部，放在頁頂
  // 的話使用者看不到，螢幕閱讀器也不會被帶過去（F-O02）。
  const [formError, setFormError] = useState<{
    message: string
    request: number
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([])
  const [batchLoading, setBatchLoading] = useState(false)
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchError, setBatchError] = useState('')
  const [batchNotice, setBatchNotice] = useState('')
  const [batchPreview, setBatchPreview] = useState<{
    companies: Company[]
    activeUsers: Record<string, ActiveCompanyUsers['users']>
    selectedUsers: Record<string, string[]>
    activate: boolean
  } | null>(null)
  const saveGuard = useSubmitGuard()
  const renamedCompany = companies.find((item) => item.id === renamingId)
  const hasUnsavedChanges = renamingId
    ? renameValue !== (renamedCompany?.name ?? '')
    : mode === 'new' && name !== ''
  const leaveGuard = navigationGuard.useUnsavedNavigationGuard(
    Boolean(hasUnsavedChanges && !forbidden && !notFound),
  )
  const [deactivating, setDeactivating] = useState<{
    company: Company
    users: Array<{ id: string; username: string; name_zh: string | null }>
    count: number
    selected: string[]
    targetActive: boolean
  } | null>(null)

  const consumedNoticeKey = useRef<string | null>(null)
  useEffect(() => {
    const state = location.state as Record<string, unknown> | null
    if (!state || !Object.hasOwn(state, 'managementNotice')) return
    // 同一歷史紀錄只清理一次，避免重繪時的 replace 蓋掉使用者返回清單。
    if (consumedNoticeKey.current === location.key) return
    consumedNoticeKey.current = location.key
    const rest = { ...state }
    delete rest.managementNotice
    leaveGuard.allowNavigation(() =>
      navigate(location.pathname + location.search + location.hash, {
        replace: true,
        state: Object.keys(rest).length ? rest : null,
      }),
    )
  }, [
    location.key,
    location.state,
    location.pathname,
    location.search,
    location.hash,
    leaveGuard,
    navigate,
  ])

  useEffect(() => {
    if (!nameError) return
    revealElement(nameRef.current)
    nameRef.current?.focus({ preventScroll: true })
  }, [nameError])

  function fail(caught: unknown) {
    if (isForbidden(caught)) {
      setForbidden(true)
      return
    }
    if (
      caught instanceof ManagementApiError &&
      caught.status === 404 &&
      companyId
    ) {
      setNotFound(true)
      return
    }
    const known =
      caught instanceof ManagementApiError &&
      (caught.code === 'company.name_conflict' ||
        caught.fields?.some((field) => field.path === '/name'))
    if (known) setNameError(managementErrorMessage(caught))
    else
      setFormError((previous) => ({
        message: managementErrorMessage(caught),
        request: (previous?.request ?? 0) + 1,
      }))
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const savedName = (renamingId ? renameValue : name).trim()
    setFormNotice('')
    setFormError(null)
    setNameError('')
    if (!savedName) {
      setNameError('請輸入公司名稱。')
      return
    }
    if (savedName.length > 128) {
      setNameError('公司名稱最多 128 個字元。')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (renamingId) {
        const updated = await renameCompany(renamingId, savedName)
        setDetailCompany(updated)
        setRenamingId(null)
        setRenameValue('')
        setFormNotice(`已將公司名稱更新為「${updated.name}」。`)
      } else {
        const created = await createCompany(savedName)
        leaveGuard.allowNavigation(() =>
          navigate(detailPath(created.id), {
            replace: true,
            state: { managementNotice: `已新增公司「${created.name}」。` },
          }),
        )
      }
    } catch (caught) {
      fail(caught)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(item: Company) {
    setOperationNotice('')
    setFormNotice('')
    if (!saveGuard.enter()) return
    setError('')
    setSaving(true)
    try {
      // 公司可能已被其他管理者變更，以最新狀態決定目標及受影響帳號。
      const fresh = await getCompany(item.id)
      const targetActive = !fresh.is_active
      const activeUsers = targetActive
        ? { users: [], count: 0 }
        : await listActiveCompanyUsers(item.id)
      setDeactivating({
        company: fresh,
        ...activeUsers,
        selected: [],
        targetActive,
      })
    } catch (caught) {
      if (isForbidden(caught)) setForbidden(true)
      else if (isNotFound(caught)) setNotFound(true)
      else setError(managementErrorMessage(caught))
    } finally {
      saveGuard.leave()
      setSaving(false)
    }
  }

  async function confirmDeactivation() {
    if (!deactivating || !saveGuard.enter()) return
    setError('')
    setSaving(true)
    try {
      const updated = await setCompanyActive(
        deactivating.company.id,
        deactivating.targetActive,
        deactivating.targetActive ? [] : deactivating.selected,
      )
      setDetailCompany(updated)
      setOperationNotice(
        updated.is_active
          ? `已啟用公司「${updated.name}」。`
          : `已停用公司「${updated.name}」。`,
      )
      setDeactivating(null)
    } catch (caught) {
      if (isForbidden(caught)) setForbidden(true)
      else setError(managementErrorMessage(caught))
    } finally {
      saveGuard.leave()
      setSaving(false)
    }
  }

  async function prepareBatchDeactivation(activate = false) {
    const selected = companies.filter((item) =>
      selectedCompanyIds.includes(item.id),
    )
    if (
      selected.length === 0 ||
      selected.some((item) => item.is_active === activate) ||
      batchLoading
    ) {
      return
    }
    setBatchError('')
    setBatchNotice('')
    setBatchLoading(true)
    try {
      // 預覽保留各公司的帳號歸屬，送出時才能只停用使用者勾選的帳號。
      const activeUsers = await mapWithConcurrency(selected, (item) =>
        activate
          ? Promise.resolve({ users: [], count: 0 })
          : listActiveCompanyUsers(item.id),
      )
      const usersByCompany: Record<string, ActiveCompanyUsers['users']> = {}
      selected.forEach((item, index) => {
        usersByCompany[item.id] = activeUsers[index].users
      })
      setBatchPreview({
        activate,
        companies: selected,
        activeUsers: usersByCompany,
        selectedUsers: Object.fromEntries(
          selected.map((item) => [item.id, []]),
        ),
      })
    } catch (caught) {
      if (isForbidden(caught)) setForbidden(true)
      else setBatchError(managementErrorMessage(caught))
    } finally {
      setBatchLoading(false)
    }
  }

  async function confirmBatchDeactivation() {
    if (!batchPreview || batchBusy || !saveGuard.enter()) return
    setBatchError('')
    setBatchBusy(true)
    try {
      await setCompaniesStatus(
        batchPreview.companies.map((item) => ({
          company_id: item.id,
          is_active: batchPreview.activate,
          disable_user_ids: batchPreview.activate
            ? []
            : (batchPreview.selectedUsers[item.id] ?? []),
        })),
      )
      const verb = batchPreview.activate ? '啟用' : '停用'
      setBatchNotice(`已${verb} ${batchPreview.companies.length} 間公司。`)
      setSelectedCompanyIds([])
      setBatchPreview(null)
      await reload()
    } catch (caught) {
      if (isForbidden(caught)) setForbidden(true)
      else setBatchError(managementErrorMessage(caught))
    } finally {
      saveGuard.leave()
      setBatchBusy(false)
    }
  }

  async function batchActivate() {
    await prepareBatchDeactivation(true)
  }

  function toggleBatchUser(
    companyId: string,
    userId: string,
    checked: boolean,
  ) {
    setBatchPreview((current) => {
      if (!current) return current
      const selected = current.selectedUsers[companyId] ?? []
      return {
        ...current,
        selectedUsers: {
          ...current.selectedUsers,
          [companyId]: checked
            ? [...selected, userId]
            : selected.filter((id) => id !== userId),
        },
      }
    })
  }

  const statusVerb = deactivating?.targetActive ? '啟用' : '停用'
  if (forbidden) return <AccessDeniedPage />
  if (notFound)
    return (
      <section>
        <BackLink replace={mode === 'new'} to={listPath}>
          返回公司清單
        </BackLink>
        <h1>找不到這家公司</h1>
      </section>
    )
  return (
    <section aria-labelledby="companies-heading">
      <UnsavedLeaveBox guard={leaveGuard} />
      {mode !== 'list' && (
        <BackLink replace={mode === 'new'} to={listPath}>
          返回公司清單
        </BackLink>
      )}
      <h1 id="companies-heading">
        {mode === 'new'
          ? '新增公司'
          : mode === 'detail'
            ? loading
              ? '載入中…'
              : (company?.name ?? '公司詳情')
            : '公司管理'}
      </h1>
      {mode !== 'detail' && !loading && formNotice && (
        <Notice>{formNotice}</Notice>
      )}
      {detailError && (
        <>
          <Notice variant="error" autoReveal={false}>
            {detailError}
          </Notice>
          <button
            type="button"
            onClick={() => {
              setDetailLoading(true)
              setDetailError('')
              setReloadKey((key) => key + 1)
            }}
          >
            重新載入
          </button>
        </>
      )}
      {mode === 'list' && (
        <>
          <Link className="btn btn-primary" to={`/companies/new${suffix}`}>
            新增公司
          </Link>
          {loading ? <p>載入中…</p> : null}
          <CursorListSearch
            disabled={loading}
            label="搜尋公司"
            onQueryChange={setQuery}
            onSearch={(event) => {
              event.preventDefault()
              void search(query)
            }}
            query={query}
          />
          {listError && (
            <>
              <Notice variant="error" autoReveal={false}>
                {listError}
              </Notice>
              <button type="button" onClick={() => void reload()}>
                重新載入
              </button>
            </>
          )}
          {!loading && !listError && companies.length === 0 ? (
            appliedQuery ? (
              <p>
                找不到符合「{appliedQuery}」的公司。{' '}
                <button onClick={() => void clearSearch()} type="button">
                  清除搜尋
                </button>
              </p>
            ) : (
              <p>目前沒有公司。</p>
            )
          ) : null}
          {companies.length > 0 && (
            <table className="companies-table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="visually-hidden">選取</span>
                  </th>
                  <th scope="col">公司名稱</th>
                  <th scope="col">狀態</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => (
                  <tr key={company.id}>
                    <td data-label="選取">
                      <input
                        aria-label={`選取公司 ${company.name}`}
                        checked={selectedCompanyIds.includes(company.id)}
                        disabled={saving || batchBusy}
                        onChange={(event) =>
                          setSelectedCompanyIds((current) =>
                            event.target.checked
                              ? [...current, company.id]
                              : current.filter((id) => id !== company.id),
                          )
                        }
                        type="checkbox"
                        value={company.id}
                      />
                    </td>
                    <th scope="row">
                      <Link to={detailPath(company.id)}>{company.name}</Link>
                    </th>
                    <td data-label="狀態">
                      <StatusBadge status={activeStatus(company.is_active)} />
                    </td>
                    <td data-label="操作">
                      <Link
                        className="btn btn-emphasis"
                        aria-label={`查看公司 ${company.name}`}
                        to={detailPath(company.id)}
                      >
                        查看
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {nextCursor && (
            <button
              disabled={loading || loadingMore}
              onClick={() => void loadMore()}
              type="button"
            >
              {loadingMore ? '載入中…' : '載入更多'}
            </button>
          )}
          {companies.length > 0 && (
            <BatchActionBar
              label="批次公司操作"
              actions={
                <>
                  <p>已選取 {selectedCompanyIds.length} 間公司。</p>
                  <button
                    className="btn"
                    disabled={
                      selectedCompanyIds.length === 0 ||
                      companies
                        .filter((item) => selectedCompanyIds.includes(item.id))
                        .some((item) => item.is_active) ||
                      batchBusy
                    }
                    onClick={() => void batchActivate()}
                    type="button"
                  >
                    {batchBusy ? '正在更新公司…' : '批次啟用公司'}
                  </button>
                  <button
                    className="btn-danger-outline"
                    disabled={
                      selectedCompanyIds.length === 0 ||
                      companies
                        .filter((item) => selectedCompanyIds.includes(item.id))
                        .some((item) => !item.is_active) ||
                      batchBusy ||
                      batchLoading
                    }
                    onClick={() => void prepareBatchDeactivation()}
                    type="button"
                  >
                    {batchLoading ? '正在檢查公司…' : '批次停用公司'}
                  </button>
                </>
              }
              feedback={
                <>
                  {' '}
                  {batchError && <Notice variant="error">{batchError}</Notice>}
                  {batchNotice && <Notice>{batchNotice}</Notice>}
                </>
              }
              confirmation={
                <>
                  {' '}
                  {batchPreview && (
                    <ConfirmBox
                      busy={batchBusy}
                      confirmLabel={
                        batchBusy
                          ? '正在更新公司…'
                          : batchPreview?.activate
                            ? '確認批次啟用公司'
                            : '確認批次停用公司'
                      }
                      label={
                        batchPreview.activate ? '批次啟用確認' : '批次停用確認'
                      }
                      onCancel={() => {
                        setBatchPreview(null)
                        setBatchError('')
                      }}
                      onConfirm={confirmBatchDeactivation}
                      role="region"
                      variant={batchPreview.activate ? 'neutral' : 'danger'}
                    >
                      {batchPreview.activate ? (
                        <p>選取的公司會啟用；不會變更任何帳號的啟用狀態。</p>
                      ) : (
                        <p>選取的公司會停用；只有勾選的帳號會一併停用。</p>
                      )}
                      {!batchPreview.activate && <p>選擇要一併停用的帳號</p>}
                      {!batchPreview.activate &&
                        batchPreview.companies.map((item) => (
                          <fieldset key={item.id}>
                            <legend>{item.name}</legend>
                            {batchPreview.activeUsers[item.id].length === 0 ? (
                              <p>沒有啟用中的帳號。</p>
                            ) : (
                              batchPreview.activeUsers[item.id].map((user) => (
                                <label key={user.id}>
                                  <input
                                    checked={batchPreview.selectedUsers[
                                      item.id
                                    ].includes(user.id)}
                                    disabled={
                                      batchBusy || user.id === currentUser.id
                                    }
                                    onChange={(event) =>
                                      toggleBatchUser(
                                        item.id,
                                        user.id,
                                        event.target.checked,
                                      )
                                    }
                                    type="checkbox"
                                    value={user.id}
                                  />
                                  {user.name_zh
                                    ? `${user.name_zh}（${user.username}）`
                                    : user.username}
                                  {user.id === currentUser.id && (
                                    <span className="field-hint">
                                      不能批次停用自己的帳號。
                                    </span>
                                  )}
                                </label>
                              ))
                            )}
                          </fieldset>
                        ))}
                    </ConfirmBox>
                  )}
                </>
              }
            />
          )}
        </>
      )}
      {mode === 'detail' && company && !loading && (
        <section aria-label="公司詳情">
          <p>
            狀態：
            <StatusBadge status={activeStatus(company.is_active)} />
          </p>
          <p className="field-hint">
            停用後，不能再把帳號連結到這家公司；已連結的帳號維持啟用，不受影響。
          </p>
          <div className="named-row-actions">
            <button
              ref={renameButtonRef}
              disabled={saving || Boolean(renamingId) || Boolean(deactivating)}
              onClick={() => {
                setFormError(null)
                setFormNotice('')
                setOperationNotice('')
                setError('')
                setNameError('')
                setRenamingId(company.id)
                setRenameValue(company.name)
              }}
              type="button"
            >
              修改公司名稱
            </button>
            <button
              className={company.is_active ? 'btn-danger-outline' : 'btn'}
              disabled={saving || Boolean(renamingId)}
              onClick={() => void toggleActive(company)}
              type="button"
            >
              {company.is_active ? '停用公司' : '啟用公司'}
            </button>
          </div>
          {formNotice && <Notice>{formNotice}</Notice>}
          {error && <Notice variant="error">{error}</Notice>}
          {operationNotice && <Notice>{operationNotice}</Notice>}
          {deactivating?.company.id === company.id && (
            <ConfirmBox
              busy={saving}
              key={deactivating.company.id}
              role="region"
              confirmLabel={
                deactivating.targetActive ? '確認啟用公司' : '確認停用公司'
              }
              onCancel={() => setDeactivating(null)}
              onConfirm={confirmDeactivation}
              title={`${statusVerb}「${deactivating.company.name}」`}
              variant={deactivating.targetActive ? 'neutral' : 'danger'}
            >
              {deactivating.targetActive ? (
                <p>啟用公司不會變更任何帳號的啟用狀態。</p>
              ) : (
                <p>
                  這家公司還有 {deactivating.count}{' '}
                  個啟用中的帳號。停用公司不會停用他們；要一併停用，請在下方勾選。
                </p>
              )}
              {!deactivating.targetActive && (
                <p>只有勾選的帳號會一併停用；未選取的帳號會維持啟用。</p>
              )}
              {!deactivating.targetActive && (
                <fieldset>
                  <legend>選擇要一併停用的帳號</legend>
                  {deactivating.users.map((user) => (
                    <label key={user.id}>
                      <input
                        checked={deactivating.selected.includes(user.id)}
                        onChange={(event) => {
                          setDeactivating((current) => {
                            if (!current) return current
                            const selected = event.target.checked
                              ? [...current.selected, user.id]
                              : current.selected.filter((id) => id !== user.id)
                            return { ...current, selected }
                          })
                        }}
                        type="checkbox"
                        value={user.id}
                      />
                      {user.name_zh
                        ? `${user.name_zh}（${user.username}）`
                        : user.username}
                    </label>
                  ))}
                </fieldset>
              )}
            </ConfirmBox>
          )}
        </section>
      )}
      {(mode === 'new' || (mode === 'detail' && renamingId)) && (
        <Form
          ref={formRef}
          guard={saveGuard}
          onSubmit={save}
          noValidate
          aria-labelledby={
            renamingId ? 'company-editor-heading' : 'companies-heading'
          }
        >
          {renamingId && <h2 id="company-editor-heading">修改公司名稱</h2>}
          <label>
            <span className="required-label">
              公司名稱 <RequiredMark />
            </span>
            <input
              ref={nameRef}
              onChange={(event) =>
                renamingId
                  ? setRenameValue(event.target.value)
                  : setName(event.target.value)
              }
              required
              maxLength={128}
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? 'company-name-error' : undefined}
              value={renamingId ? renameValue : name}
            />
          </label>
          {nameError && (
            <p className="field-error" id="company-name-error" role="alert">
              {nameError}
            </p>
          )}
          <div className="named-row-actions">
            {renamingId ? (
              <button
                onClick={() => {
                  setFormError(null)
                  setNameError('')
                  setRenamingId(null)
                  setRenameValue('')
                }}
                type="button"
              >
                取消
              </button>
            ) : (
              <Link replace className="btn" to={listPath}>
                取消
              </Link>
            )}
            <FormSubmitButton className="btn-primary" disabled={saving}>
              {renamingId ? '儲存公司名稱' : '新增公司'}
            </FormSubmitButton>
          </div>
          <FormError focusRequest={formError?.request} tabIndex={-1}>
            {formError?.message}
          </FormError>
        </Form>
      )}
    </section>
  )
}
