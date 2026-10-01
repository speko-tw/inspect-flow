import { useEffect, useState, type FormEvent } from 'react'

import {
  createCompany,
  listActiveCompanyUsers,
  listCompanies,
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
  const [deactivating, setDeactivating] = useState<{
    company: Company
    users: Array<{ id: string; username: string; name_zh: string | null }>
    count: number
    selected: string[]
  } | null>(null)

  async function reload() {
    setError('')
    try {
      setCompanies(await listCompanies())
    } catch (caught) {
      setError(managementErrorMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const rows = await listCompanies()
        if (active) {
          setCompanies(rows)
        }
      } catch (caught) {
        if (active) {
          setError(managementErrorMessage(caught))
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

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
      setSaving(false)
    }
  }

  async function confirmDeactivation() {
    if (!deactivating) return
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
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="companies-heading">
      <h1 id="companies-heading">公司管理</h1>
      {error && <p role="alert">{error}</p>}
      {deactivating && (
        <section aria-labelledby="deactivate-company-heading">
          <h2 id="deactivate-company-heading">
            停用「{deactivating.company.name}」
          </h2>
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
          <button disabled={saving} onClick={() => void confirmDeactivation()}>
            確認停用公司
          </button>
          <button
            disabled={saving}
            onClick={() => setDeactivating(null)}
            type="button"
          >
            取消
          </button>
        </section>
      )}
      {loading ? <p>載入中…</p> : null}
      {!loading && companies.length === 0 ? <p>目前沒有公司。</p> : null}
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
                <td>{company.is_active ? '啟用' : '停用'}</td>
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
      <form onSubmit={save}>
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
        <button disabled={saving} type="submit">
          {renamingId ? '儲存名稱' : '新增公司'}
        </button>
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
      </form>
    </section>
  )
}
