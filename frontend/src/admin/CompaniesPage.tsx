import { useEffect, useRef, useState, type FormEvent } from 'react'

import { StatusBadge } from '../ui/Badge'
import { ConfirmBox } from '../ui/ConfirmBox'
import { Form, FormError, FormSubmitButton } from '../ui/Form'
import { activeStatus } from '../ui/statusBadge'
import { useSubmitGuard } from '../ui/submitGuard'
import {
  createCompany,
  listActiveCompanyUsers,
  listCompaniesPage,
  managementErrorMessage,
  renameCompany,
  setCompanyActive,
  type Company,
} from './api'

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [name, setName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [listError, setListError] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const requestId = useRef(0)
  const searchGuard = useSubmitGuard()
  const saveGuard = useSubmitGuard()
  const [deactivating, setDeactivating] = useState<{
    company: Company
    users: Array<{ id: string; username: string; name_zh: string | null }>
    count: number
    selected: string[]
  } | null>(null)

  async function reload() {
    const id = ++requestId.current
    setListError('')
    setCompanies([])
    setNextCursor(null)
    setLoadingMore(false)
    setLoading(true)
    try {
      const page = await listCompaniesPage({ q: appliedQuery, limit: 50 })
      if (id === requestId.current) {
        setCompanies(page.items)
        setNextCursor(page.next_cursor)
      }
    } catch (caught) {
      if (id === requestId.current)
        setListError(managementErrorMessage(caught))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    const id = ++requestId.current
    async function load() {
      try {
        const page = await listCompaniesPage({ limit: 50 })
        if (active && id === requestId.current) {
          setCompanies(page.items)
          setNextCursor(page.next_cursor)
        }
      } catch (caught) {
        if (active && id === requestId.current) {
          setListError(managementErrorMessage(caught))
        }
      } finally {
        if (active && id === requestId.current) {
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  async function searchCompanies(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const search = query.trim()
    setAppliedQuery(search)
    const id = ++requestId.current
    setCompanies([])
    setNextCursor(null)
    setLoadingMore(false)
    setListError('')
    setLoading(true)
    try {
      const page = await listCompaniesPage({ q: search, limit: 50 })
      if (id === requestId.current) {
        setCompanies(page.items)
        setNextCursor(page.next_cursor)
      }
    } catch (caught) {
      if (id === requestId.current)
        setListError(managementErrorMessage(caught))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }

  async function loadMoreCompanies() {
    if (!nextCursor || loading || loadingMore) return
    const id = requestId.current
    setLoadingMore(true)
    setListError('')
    try {
      const page = await listCompaniesPage({
        q: appliedQuery,
        cursor: nextCursor,
        limit: 50,
      })
      if (id === requestId.current) {
        setCompanies((current) => [...current, ...page.items])
        setNextCursor(page.next_cursor)
      }
    } catch (caught) {
      if (id === requestId.current)
        setListError(managementErrorMessage(caught))
    } finally {
      if (id === requestId.current) setLoadingMore(false)
    }
  }

  async function clearSearch() {
    setQuery('')
    setAppliedQuery('')
    const id = ++requestId.current
    setCompanies([])
    setNextCursor(null)
    setLoadingMore(false)
    setListError('')
    setLoading(true)
    try {
      const page = await listCompaniesPage({ limit: 50 })
      if (id === requestId.current) {
        setCompanies(page.items)
        setNextCursor(page.next_cursor)
      }
    } catch (caught) {
      if (id === requestId.current)
        setListError(managementErrorMessage(caught))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
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
      setError(managementErrorMessage(caught))
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
      <Form guard={searchGuard} onSubmit={searchCompanies}>
        <label>
          搜尋公司
          <input
            onChange={(event) => setQuery(event.target.value)}
            value={query}
          />
        </label>
        <FormSubmitButton disabled={loading}>搜尋</FormSubmitButton>
      </Form>
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {nextCursor && (
        <button
          disabled={loading || loadingMore}
          onClick={() => void loadMoreCompanies()}
          type="button"
        >
          {loadingMore ? '載入中…' : '載入更多'}
        </button>
      )}
      <Form guard={saveGuard} onSubmit={save}>
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
