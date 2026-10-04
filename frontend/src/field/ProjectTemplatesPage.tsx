import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'

import LogoutButton from '../auth/LogoutButton'
import { useCurrentUser } from '../auth/useCurrentUser'
import {
  applyTemplate,
  listTemplateCategories,
  listTemplateItems,
  listTemplateSystems,
  ProjectTemplatesApiError,
  templateErrorMessage,
  type AppliedItem,
  type TemplateCategory,
  type TemplateItem,
  type TemplateSystem,
} from './projectTemplatesApi'

function appliedTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('zh-TW')
}

function forbidden(error: unknown): boolean {
  return error instanceof ProjectTemplatesApiError && error.status === 403
}

export default function ProjectTemplatesPage() {
  const { projectId = '' } = useParams()
  const { user } = useCurrentUser()
  const [categories, setCategories] = useState<TemplateCategory[]>([])
  const [systems, setSystems] = useState<TemplateSystem[]>([])
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [categoryId, setCategoryId] = useState('')
  const [systemId, setSystemId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [mode, setMode] = useState<'item' | 'system'>('item')
  const [added, setAdded] = useState<AppliedItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [readDenied, setReadDenied] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    listTemplateCategories()
      .then((items) => {
        if (active) setCategories(items)
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(templateErrorMessage(caught))
        if (forbidden(caught)) {
          setReadOnly(true)
          setReadDenied(true)
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!categoryId) return
    let active = true
    listTemplateSystems(categoryId)
      .then((items) => {
        if (active) setSystems(items)
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(templateErrorMessage(caught))
        if (forbidden(caught)) {
          setReadOnly(true)
          setReadDenied(true)
        }
      })
    return () => {
      active = false
    }
  }, [categoryId])

  useEffect(() => {
    if (!systemId) return
    let active = true
    listTemplateItems(systemId)
      .then((items) => {
        if (active) setTemplates(items)
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(templateErrorMessage(caught))
        if (forbidden(caught)) {
          setReadOnly(true)
          setReadDenied(true)
        }
      })
    return () => {
      active = false
    }
  }, [systemId])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!systemId || (mode === 'item' && !templateId)) return
    setBusy(true)
    setError('')
    setAdded(null)
    try {
      setAdded(
        await applyTemplate(
          projectId,
          mode === 'item'
            ? { template_id: templateId }
            : { system_id: systemId },
        ),
      )
    } catch (caught) {
      setError(templateErrorMessage(caught))
      if (forbidden(caught)) setReadOnly(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="topbar-brand">InspectFlow 工程查核系統</span>
        <nav aria-label="專案功能">
          <Link to="/field">回工作台</Link>
          {user.is_admin && <Link to="/admin/projects">專案管理</Link>}
        </nav>
        <span className="topbar-user">
          登入者：{user.name_zh ?? user.username}
        </span>
        <LogoutButton />
      </header>
      <main>
        <h1>專案查核項目</h1>
        <p>專案 ID：{projectId}</p>
        <section aria-labelledby="apply-heading">
          <h2 id="apply-heading">套用範本</h2>
          {loading && <p>載入中…</p>}
          {error && <p role="alert">{error}</p>}
          {readOnly && (
            <p>
              {readDenied
                ? '範本讀取權限不足，無法載入其他內容。'
                : '目前只能瀏覽範本。'}
            </p>
          )}
          {!loading && categories.length === 0 && !error && (
            <p>目前沒有工程類別。</p>
          )}
          {categories.length > 0 && (
            <form onSubmit={(event) => void submit(event)}>
              <label>
                工程類別
                <select
                  onChange={(event) => {
                    setCategoryId(event.target.value)
                    setSystemId('')
                    setTemplateId('')
                    setSystems([])
                    setTemplates([])
                    setAdded(null)
                  }}
                  value={categoryId}
                >
                  <option value="">請選擇工程類別</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              {categoryId && (
                <label>
                  系統
                  <select
                    onChange={(event) => {
                      setSystemId(event.target.value)
                      setTemplateId('')
                      setTemplates([])
                      setAdded(null)
                    }}
                    value={systemId}
                  >
                    <option value="">請選擇系統</option>
                    {systems.map((system) => (
                      <option key={system.id} value={system.id}>
                        {system.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {systemId && (
                <fieldset>
                  <legend>套用範圍</legend>
                  <label>
                    <input
                      checked={mode === 'item'}
                      onChange={() => setMode('item')}
                      type="radio"
                    />
                    單一查核項目
                  </label>
                  <label>
                    <input
                      checked={mode === 'system'}
                      onChange={() => setMode('system')}
                      type="radio"
                    />
                    整個系統
                  </label>
                </fieldset>
              )}
              {systemId && mode === 'item' && (
                <label>
                  查核項目
                  <select
                    onChange={(event) => setTemplateId(event.target.value)}
                    value={templateId}
                  >
                    <option value="">請選擇查核項目</option>
                    {templates.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!readOnly && (
                <button
                  disabled={
                    busy || !systemId || (mode === 'item' && !templateId)
                  }
                  type="submit"
                >
                  {busy ? '套用中…' : '套用至專案'}
                </button>
              )}
            </form>
          )}
          {added && (
            <section aria-labelledby="applied-heading" role="status">
              <h3 id="applied-heading">本次新增的查核項目</h3>
              {added.length === 0 ? (
                <p>這個系統沒有項目</p>
              ) : (
                <ul>
                  {added.map((item) => (
                    <li key={item.id}>
                      來源：{item.source_template_name}；套用時間：
                      <time dateTime={item.applied_at}>
                        {appliedTime(item.applied_at)}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </section>
      </main>
    </div>
  )
}
