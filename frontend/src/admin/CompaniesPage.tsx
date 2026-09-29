import { useEffect, useState, type FormEvent } from 'react'

import {
  createCompany,
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
      await setCompanyActive(company.id, !company.is_active)
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
