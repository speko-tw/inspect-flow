import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'

import { managementErrorMessage } from '../api'
import {
  createProject,
  hasDuplicateCodeWarning,
  listProjectsPage,
  updateProject,
  type Project,
  type ProjectInput,
} from './api'

const EMPTY_FORM = {
  project_code: '',
  name: '',
  client_name: '',
  site_location: '',
  planned_start_date: '',
  planned_completion_date: '',
}

type FormState = typeof EMPTY_FORM

function toForm(project: Project): FormState {
  return {
    project_code: project.project_code,
    name: project.name,
    client_name: project.client_name,
    site_location: project.site_location,
    planned_start_date: project.planned_start_date ?? '',
    planned_completion_date: project.planned_completion_date ?? '',
  }
}

function toInput(form: FormState): ProjectInput {
  return {
    project_code: form.project_code.trim(),
    name: form.name.trim(),
    client_name: form.client_name.trim(),
    site_location: form.site_location.trim(),
    planned_start_date: form.planned_start_date || null,
    planned_completion_date: form.planned_completion_date || null,
  }
}

export default function ProjectsPage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [reloadKey, setReloadKey] = useState(0)
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [listError, setListError] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const requestId = useRef(0)

  useEffect(() => {
    let active = true
    const id = ++requestId.current
    async function load() {
      try {
        const page = await listProjectsPage({ q: appliedQuery, limit: 50 })
        if (active && id === requestId.current) {
          setProjects(page.items)
          setNextCursor(page.next_cursor)
        }
      } catch (caught) {
        if (active) {
          setListError(managementErrorMessage(caught))
        }
      } finally {
        if (active) {
          if (id === requestId.current) setLoading(false)
        }
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [reloadKey, appliedQuery])

  async function searchProjects(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const search = query.trim()
    const id = ++requestId.current
    setProjects([])
    setNextCursor(null)
    setLoadingMore(false)
    setListError('')
    setAppliedQuery(search)
    setLoading(true)
    try {
      const page = await listProjectsPage({ q: search, limit: 50 })
      if (id === requestId.current) {
        setProjects(page.items)
        setNextCursor(page.next_cursor)
      }
    } catch (caught) {
      if (id === requestId.current)
        setListError(managementErrorMessage(caught))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }

  async function loadMoreProjects() {
    if (!nextCursor || loading || loadingMore) return
    const id = requestId.current
    const cursor = nextCursor
    setLoadingMore(true)
    setListError('')
    try {
      const page = await listProjectsPage({
        q: appliedQuery,
        cursor,
        limit: 50,
      })
      if (id === requestId.current) {
        setProjects((current) => [...current, ...page.items])
        setNextCursor(page.next_cursor)
      }
    } catch (caught) {
      if (id === requestId.current)
        setListError(managementErrorMessage(caught))
    } finally {
      if (id === requestId.current) setLoadingMore(false)
    }
  }

  function change(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function startEdit(project: Project) {
    setEditing(project)
    setForm(toForm(project))
    setNotice('')
    setError('')
  }

  function cancelEdit() {
    setEditing(null)
    setForm(EMPTY_FORM)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    const input = toInput(form)
    const creating = editing === null
    setSaving(true)
    try {
      let saved: Project
      if (editing) {
        const original = toInput(toForm(editing))
        const changed = Object.fromEntries(
          Object.entries(input).filter(
            ([key, value]) => original[key as keyof ProjectInput] !== value,
          ),
        )
        if (Object.keys(changed).length === 0) {
          cancelEdit()
          return
        }
        saved = await updateProject(editing.id, changed)
      } else {
        saved = await createProject(input)
      }
      if (creating) {
        cancelEdit()
        navigate(`/admin/projects/${saved.id}`)
        return
      }
      setNotice(
        hasDuplicateCodeWarning(saved)
          ? `專案「${saved.name}」已儲存。警告：專案代號「${saved.project_code}」與其他專案重複，仍已儲存。`
          : `專案「${saved.name}」已儲存。`,
      )
      cancelEdit()
      setProjects([])
      setNextCursor(null)
      setLoading(true)
      setLoadingMore(false)
      setListError('')
      setReloadKey((key) => key + 1)
    } catch (caught) {
      setError(managementErrorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="projects-heading">
      <h1 id="projects-heading">專案管理</h1>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {loading ? <p>載入中…</p> : null}
      <form onSubmit={searchProjects}>
        <label>
          搜尋專案
          <input
            onChange={(event) => setQuery(event.target.value)}
            value={query}
          />
        </label>
        <button disabled={loading} type="submit">
          搜尋
        </button>
      </form>
      {listError && <p role="alert">{listError}</p>}
      {!loading && projects.length === 0 ? (
        appliedQuery ? (
          <p>
            找不到符合「{appliedQuery}」的專案。{' '}
            <button
              onClick={() => {
                setQuery('')
                setAppliedQuery('')
              }}
              type="button"
            >
              清除搜尋
            </button>
          </p>
        ) : (
          <p>目前沒有專案。</p>
        )
      ) : null}
      {projects.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">專案代號</th>
              <th scope="col">工程名稱</th>
              <th scope="col">業主／委託單位</th>
              <th scope="col">工程地點</th>
              <th scope="col">預定開工</th>
              <th scope="col">預定完工</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.id}>
                <th scope="row">
                  {project.project_code}
                  {hasDuplicateCodeWarning(project) ? (
                    <span>（代號重複）</span>
                  ) : null}
                </th>
                <td>{project.name}</td>
                <td>{project.client_name}</td>
                <td>{project.site_location}</td>
                <td>{project.planned_start_date ?? '—'}</td>
                <td>{project.planned_completion_date ?? '—'}</td>
                <td>
                  <button onClick={() => startEdit(project)} type="button">
                    編輯
                  </button>
                  <Link
                    className="button-link"
                    to={`/admin/projects/${project.id}/members`}
                  >
                    成員
                  </Link>
                  <Link
                    className="button-link"
                    to={`/admin/projects/${project.id}`}
                  >
                    開啟專案
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
          onClick={() => void loadMoreProjects()}
          type="button"
        >
          {loadingMore ? '載入中…' : '載入更多'}
        </button>
      )}
      <form onSubmit={save}>
        <h2>{editing ? `編輯專案「${editing.name}」` : '新增專案'}</h2>
        <label>
          專案代號
          <input
            maxLength={32}
            onChange={(event) => change('project_code', event.target.value)}
            required
            value={form.project_code}
          />
        </label>
        <label>
          工程名稱
          <input
            maxLength={128}
            onChange={(event) => change('name', event.target.value)}
            required
            value={form.name}
          />
        </label>
        <label>
          業主／委託單位
          <input
            maxLength={128}
            onChange={(event) => change('client_name', event.target.value)}
            required
            value={form.client_name}
          />
        </label>
        <label>
          整體工程地點
          <input
            maxLength={256}
            onChange={(event) => change('site_location', event.target.value)}
            required
            value={form.site_location}
          />
        </label>
        <label>
          預定開工日
          <input
            onChange={(event) =>
              change('planned_start_date', event.target.value)
            }
            type="date"
            value={form.planned_start_date}
          />
        </label>
        <label>
          預定完工日
          <input
            onChange={(event) =>
              change('planned_completion_date', event.target.value)
            }
            type="date"
            value={form.planned_completion_date}
          />
        </label>
        <button disabled={saving} type="submit">
          {editing ? '儲存專案' : '新增專案'}
        </button>
        {editing && (
          <button onClick={cancelEdit} type="button">
            取消
          </button>
        )}
      </form>
    </section>
  )
}
