import { useState, type FormEvent } from 'react'

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
  setCompanyActive,
  type Company,
} from './api'
import { CursorListSearch } from './CursorListSearch'
import { useCursorList } from './useCursorList'

export default function CompaniesPage() {
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

  return (
    <section aria-labelledby="companies-heading">
      <UnsavedLeaveBox guard={leaveGuard} />
      <h1 id="companies-heading">公司管理</h1>
      <FormError>{error}</FormError>
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
          <p>還有 {deactivating.count} 位啟用中的人員</p>
          <p>只有勾選的人員會一併停用；未選取的人員帳號會維持啟用。</p>
          <fieldset>
            <legend>選擇要一併停用的人員</legend>
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
              <th scope="col">公司名稱</th>
              <th scope="col">狀態</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((company) => (
              <tr key={company.id}>
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
                    <span>停用公司不會自動停用人員帳號。</span>
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
