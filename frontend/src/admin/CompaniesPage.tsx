import { useState, type FormEvent } from 'react'

import { useCurrentUser } from '../auth/useCurrentUser'
import { StatusBadge } from '../ui/Badge'
import { ConfirmBox } from '../ui/ConfirmBox'
import { Form, FormError, FormSubmitButton } from '../ui/Form'
import { activeStatus } from '../ui/statusBadge'
import { useSubmitGuard } from '../ui/submitGuard'
import { UnsavedLeaveBox } from '../ui/navigation'
import * as navigationGuard from '../ui/navigation'
import {
  createCompany,
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
import { useCursorList } from './useCursorList'

export default function CompaniesPage() {
  const { user: currentUser } = useCurrentUser()
  const companyList = useCursorList(listCompaniesPage, managementErrorMessage)
  const {
    items: companies,
    query,
    setQuery,
    appliedQuery,
    error: listError,
    nextCursor,
    loading,
    loadingMore,
    search,
    clearSearch,
    reload,
    loadMore,
  } = companyList
  const [name, setName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [error, setError] = useState('')
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
  } | null>(null)
  const saveGuard = useSubmitGuard()
  const renamedCompany = companies.find((item) => item.id === renamingId)
  const hasUnsavedChanges = renamingId
    ? renameValue !== (renamedCompany?.name ?? '')
    : name !== ''
  const leaveGuard =
    navigationGuard.useUnsavedNavigationGuard(hasUnsavedChanges)
  const [deactivating, setDeactivating] = useState<{
    company: Company
    users: Array<{ id: string; username: string; name_zh: string | null }>
    count: number
    selected: string[]
  } | null>(null)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setFormError(null)
    try {
      if (renamingId) {
        await renameCompany(renamingId, renameValue)
        setRenamingId(null)
        setRenameValue('')
      } else {
        await createCompany(name)
        setName('')
      }
      await reload()
    } catch (caught) {
      setFormError((previous) => ({
        message: managementErrorMessage(caught),
        request: (previous?.request ?? 0) + 1,
      }))
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(company: Company) {
    if (!saveGuard.enter()) return
    setError('')
    setSaving(true)
    try {
      if (!company.is_active) {
        await setCompanyActive(company.id, true)
        await reload()
        return
      }
      const activeUsers = await listActiveCompanyUsers(company.id)
      if (activeUsers.count > 0) {
        setDeactivating({
          company,
          users: activeUsers.users,
          count: activeUsers.count,
          selected: [],
        })
        return
      }
      await setCompanyActive(company.id, false)
      await reload()
    } catch (caught) {
      setError(managementErrorMessage(caught))
    } finally {
      saveGuard.leave()
      setSaving(false)
    }
  }

  async function confirmDeactivation() {
    if (!deactivating) return
    if (!saveGuard.enter()) return
    setError('')
    setSaving(true)
    try {
      await setCompanyActive(
        deactivating.company.id,
        false,
        deactivating.selected,
      )
      setDeactivating(null)
      await reload()
    } catch (caught) {
      setError(managementErrorMessage(caught))
    } finally {
      saveGuard.leave()
      setSaving(false)
    }
  }

  async function prepareBatchDeactivation() {
    const selected = companies.filter((item) =>
      selectedCompanyIds.includes(item.id),
    )
    if (
      selected.length === 0 ||
      selected.some((item) => !item.is_active) ||
      batchLoading
    ) {
      return
    }
    setBatchError('')
    setBatchNotice('')
    setBatchLoading(true)
    try {
      const activeUsers = await Promise.all(
        selected.map((item) => listActiveCompanyUsers(item.id)),
      )
      const usersByCompany: Record<string, ActiveCompanyUsers['users']> = {}
      selected.forEach((item, index) => {
        usersByCompany[item.id] = activeUsers[index].users
      })
      setBatchPreview({
        companies: selected,
        activeUsers: usersByCompany,
        selectedUsers: Object.fromEntries(
          selected.map((item) => [item.id, []]),
        ),
      })
    } catch (caught) {
      setBatchError(managementErrorMessage(caught))
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
          is_active: false,
          disable_user_ids: batchPreview.selectedUsers[item.id] ?? [],
        })),
      )
      setBatchNotice(`已停用 ${batchPreview.companies.length} 間公司。`)
      setSelectedCompanyIds([])
      setBatchPreview(null)
      await reload()
    } catch (caught) {
      setBatchError(managementErrorMessage(caught))
    } finally {
      saveGuard.leave()
      setBatchBusy(false)
    }
  }

  async function batchActivate() {
    const selected = companies.filter((item) =>
      selectedCompanyIds.includes(item.id),
    )
    if (
      selected.length === 0 ||
      selected.some((item) => item.is_active) ||
      batchBusy ||
      !saveGuard.enter()
    ) {
      return
    }
    setBatchError('')
    setBatchNotice('')
    setBatchBusy(true)
    try {
      await setCompaniesStatus(
        selected.map((item) => ({
          company_id: item.id,
          is_active: true,
          disable_user_ids: [],
        })),
      )
      setBatchNotice(`已啟用 ${selected.length} 間公司。`)
      setSelectedCompanyIds([])
      await reload()
    } catch (caught) {
      setBatchError(managementErrorMessage(caught))
    } finally {
      saveGuard.leave()
      setBatchBusy(false)
    }
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

  return (
    <section aria-labelledby="companies-heading">
      <UnsavedLeaveBox guard={leaveGuard} />
      <h1 id="companies-heading">公司管理</h1>
      <FormError>{error}</FormError>
      {batchError && <p role="alert">{batchError}</p>}
      {batchNotice && <p role="status">{batchNotice}</p>}
      {batchPreview && (
        <ConfirmBox
          busy={batchBusy}
          confirmLabel={batchBusy ? '正在停用公司…' : '確認批次停用公司'}
          label="批次停用確認"
          onCancel={() => {
            setBatchPreview(null)
            setBatchError('')
          }}
          onConfirm={confirmBatchDeactivation}
          role="region"
          variant="danger"
        >
          <p>選取的公司會停用；只有勾選的帳號會一併停用。</p>
          <p>選擇要一併停用的帳號</p>
          {batchPreview.companies.map((item) => (
            <fieldset key={item.id}>
              <legend>{item.name}</legend>
              {batchPreview.activeUsers[item.id].length === 0 ? (
                <p>沒有啟用中的帳號。</p>
              ) : (
                batchPreview.activeUsers[item.id].map((user) => (
                  <label key={user.id}>
                    <input
                      checked={batchPreview.selectedUsers[item.id].includes(
                        user.id,
                      )}
                      disabled={batchBusy || user.id === currentUser.id}
                      onChange={(event) =>
                        toggleBatchUser(item.id, user.id, event.target.checked)
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
      {deactivating && (
        <ConfirmBox
          busy={saving}
          key={deactivating.company.id}
          role="region"
          confirmLabel="確認停用公司"
          onCancel={() => setDeactivating(null)}
          onConfirm={confirmDeactivation}
          title={`停用「${deactivating.company.name}」`}
          variant="danger"
        >
          <p>還有 {deactivating.count} 個啟用中的帳號</p>
          <p>只有勾選的帳號會一併停用；未選取的帳號會維持啟用。</p>
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
        </ConfirmBox>
      )}
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
      <FormError>{listError}</FormError>
      {!loading && companies.length === 0 ? (
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
        <table>
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
                <td>
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
                <th scope="row">{company.name}</th>
                <td>
                  <StatusBadge status={activeStatus(company.is_active)} />
                </td>
                <td>
                  <button
                    onClick={() => {
                      setFormError(null)
                      setRenamingId(company.id)
                      setRenameValue(company.name)
                    }}
                    type="button"
                  >
                    改名稱
                  </button>
                  <button
                    disabled={saving}
                    onClick={() => void toggleActive(company)}
                    type="button"
                  >
                    {company.is_active ? '停用公司' : '啟用公司'}
                  </button>
                  {company.is_active && (
                    <span>停用公司不會自動停用帳號。</span>
                  )}
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
        <div aria-label="批次公司操作">
          <p>已選取 {selectedCompanyIds.length} 間公司。</p>
          <button
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
        </div>
      )}
      <Form
        error={formError?.message}
        errorFocusRequest={formError?.request}
        errorTabIndex={-1}
        guard={saveGuard}
        onSubmit={save}
      >
        <h2>{renamingId ? '修改公司名稱' : '新增公司'}</h2>
        <label>
          公司名稱
          <input
            onChange={(event) =>
              renamingId
                ? setRenameValue(event.target.value)
                : setName(event.target.value)
            }
            required
            value={renamingId ? renameValue : name}
          />
        </label>
        {renamingId && (
          <button
            onClick={() => {
              setFormError(null)
              setRenamingId(null)
              setRenameValue('')
            }}
            type="button"
          >
            取消
          </button>
        )}
        <FormSubmitButton className="btn-primary" disabled={saving}>
          {renamingId ? '儲存名稱' : '新增公司'}
        </FormSubmitButton>
      </Form>
    </section>
  )
}
