import { useEffect, useState, type FormEvent } from 'react'

import { httpErrorMessage } from '../../http'
import { listAllPages, listUsers, type User } from '../api'
import type { Project } from '../projects/api'
import {
  listAuditLogs,
  type AuditLogEntry,
  type AuditLogFilters,
  type AuditLogPage,
} from './api'
import './AuditLogPage.css'

const emptyFilters: AuditLogFilters = {
  project_id: '',
  actor_id: '',
  from: '',
  to: '',
  event_type: '',
}

function displayJson(value: unknown): string {
  return value == null ? '無' : JSON.stringify(value, null, 2)
}

function utcValue(local: string): string {
  return local ? new Date(local).toISOString() : ''
}

export default function AuditLogPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [optionsError, setOptionsError] = useState('')
  const [projectId, setProjectId] = useState('')
  const [actorId, setActorId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [eventType, setEventType] = useState('')
  const [filters, setFilters] = useState<AuditLogFilters>(emptyFilters)
  const [cursor, setCursor] = useState<string | null>(null)
  const [history, setHistory] = useState<Array<string | null>>([])
  const [result, setResult] = useState<AuditLogPage | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    void Promise.all([listAllPages<Project>('/projects'), listUsers()]).then(
      ([projectRows, userRows]) => {
        if (active) {
          setProjects(projectRows)
          setUsers(userRows)
        }
      },
      (caught: unknown) => {
        if (active) setOptionsError(httpErrorMessage(caught))
      },
    )
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    void listAuditLogs(filters, cursor).then(
      (page) => {
        if (active) {
          setResult(page)
          setLoading(false)
        }
      },
      (caught: unknown) => {
        if (active) {
          setResult(null)
          setError(httpErrorMessage(caught))
          setLoading(false)
        }
      },
    )
    return () => {
      active = false
    }
  }, [filters, cursor])

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (from && to && new Date(from) > new Date(to)) {
      setError('起始時間不得晚於結束時間。')
      return
    }
    setLoading(true)
    setError('')
    setHistory([])
    setCursor(null)
    setFilters({
      project_id: projectId,
      actor_id: actorId,
      from: utcValue(from),
      to: utcValue(to),
      event_type: eventType.trim(),
    })
  }

  function nextPage() {
    if (!result?.next_cursor) return
    setLoading(true)
    setError('')
    setHistory((previous) => [...previous, cursor])
    setCursor(result.next_cursor)
  }

  function previousPage() {
    if (!history.length) return
    setLoading(true)
    setError('')
    setCursor(history[history.length - 1])
    setHistory((previous) => previous.slice(0, -1))
  }

  function actorName(id: string): string {
    const user = users.find((candidate) => candidate.id === id)
    return user ? `${user.name_zh || user.username} (${user.username})` : id
  }

  function projectName(id: string | null): string {
    if (!id) return '無專案'
    const project = projects.find((candidate) => candidate.id === id)
    return project ? `${project.name} (${project.project_code})` : id
  }

  function entryCard(entry: AuditLogEntry) {
    return (
      <li className="audit-entry" key={entry.id}>
        <article>
          <div className="audit-entry-heading">
            <h2>{entry.event_type}</h2>
            <time dateTime={entry.created_at}>
              {new Date(entry.created_at).toLocaleString('zh-TW')}
            </time>
          </div>
          <dl>
            <div>
              <dt>專案</dt>
              <dd>{projectName(entry.project_id)}</dd>
            </div>
            <div>
              <dt>操作者</dt>
              <dd>{actorName(entry.created_by)}</dd>
            </div>
            <div>
              <dt>對象</dt>
              <dd>
                {entry.entity_type} · {entry.entity_id}
              </dd>
            </div>
          </dl>
          <details>
            <summary>查看改前與改後內容</summary>
            <div className="audit-entry-changes">
              <div>
                <h3>改前</h3>
                <pre>{displayJson(entry.before)}</pre>
              </div>
              <div>
                <h3>改後</h3>
                <pre>{displayJson(entry.after)}</pre>
              </div>
            </div>
          </details>
        </article>
      </li>
    )
  }

  return (
    <section className="audit-page" aria-labelledby="audit-page-title">
      <h1 id="audit-page-title">稽核紀錄</h1>
      <p>查詢系統操作紀錄。這個頁面只提供檢視，不會修改紀錄。</p>
      {optionsError && <p role="alert">篩選選項載入失敗：{optionsError}</p>}
      <form className="audit-filters" onSubmit={search}>
        <label>
          專案
          <select
            onChange={(event) => setProjectId(event.target.value)}
            value={projectId}
          >
            <option value="">全部專案</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} ({project.project_code})
              </option>
            ))}
          </select>
        </label>
        <label>
          操作者
          <select
            onChange={(event) => setActorId(event.target.value)}
            value={actorId}
          >
            <option value="">全部操作者</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name_zh || user.username} ({user.username})
              </option>
            ))}
          </select>
        </label>
        <label>
          起始時間（含）
          <input
            onChange={(event) => setFrom(event.target.value)}
            type="datetime-local"
            value={from}
          />
        </label>
        <label>
          結束時間（不含）
          <input
            onChange={(event) => setTo(event.target.value)}
            type="datetime-local"
            value={to}
          />
        </label>
        <label>
          事件類型
          <input
            onChange={(event) => setEventType(event.target.value)}
            placeholder="例如 project_zone.created"
            value={eventType}
          />
        </label>
        <button type="submit">查詢</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p role="status">載入稽核紀錄中…</p>
      ) : result?.items.length ? (
        <ol className="audit-results">{result.items.map(entryCard)}</ol>
      ) : !error ? (
        <p role="status">沒有符合條件的稽核紀錄。</p>
      ) : null}
      <nav aria-label="稽核紀錄分頁" className="audit-pagination">
        <button
          disabled={loading || history.length === 0}
          onClick={previousPage}
          type="button"
        >
          上一頁
        </button>
        <span>第 {history.length + 1} 頁</span>
        <button
          disabled={loading || !result?.next_cursor}
          onClick={nextPage}
          type="button"
        >
          下一頁
        </button>
      </nav>
    </section>
  )
}
