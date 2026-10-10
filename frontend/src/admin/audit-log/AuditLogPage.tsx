import { useEffect, useRef, useState, type FormEvent } from 'react'

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

const eventTypePattern = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/

interface FilterErrors {
  from?: string
  to?: string
  eventType?: string
}

function displayJson(value: unknown): string {
  return value == null ? '無' : JSON.stringify(value, null, 2)
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
  const [filterErrors, setFilterErrors] = useState<FilterErrors>({})
  const fromRef = useRef<HTMLInputElement>(null)
  const toRef = useRef<HTMLInputElement>(null)
  const eventTypeRef = useRef<HTMLInputElement>(null)
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
    const fromDate = from ? new Date(from) : null
    const toDate = to ? new Date(to) : null
    const nextErrors: FilterErrors = {}
    if (fromDate && Number.isNaN(fromDate.getTime())) {
      nextErrors.from = '請輸入有效的起始時間。'
    }
    if (toDate && Number.isNaN(toDate.getTime())) {
      nextErrors.to = '請輸入有效的結束時間。'
    } else if (fromDate && toDate && fromDate > toDate) {
      nextErrors.to = '起始時間不得晚於結束時間。'
    }
    const normalizedEventType = eventType.trim()
    if (normalizedEventType && !eventTypePattern.test(normalizedEventType)) {
      nextErrors.eventType = '事件類型格式應為資料類型.動作。'
    }
    setFilterErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      setError('')
      if (nextErrors.from) fromRef.current?.focus()
      else if (nextErrors.to) toRef.current?.focus()
      else eventTypeRef.current?.focus()
      return
    }
    setLoading(true)
    setError('')
    setHistory([])
    setCursor(null)
    setFilters({
      project_id: projectId,
      actor_id: actorId,
      from: fromDate?.toISOString() ?? '',
      to: toDate?.toISOString() ?? '',
      event_type: normalizedEventType,
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
            aria-describedby={projectId ? 'audit-project-hint' : undefined}
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
          <span id="audit-from-label">起始時間（含）</span>
          <input
            aria-describedby={
              filterErrors.from ? 'audit-from-error' : undefined
            }
            aria-invalid={Boolean(filterErrors.from)}
            aria-labelledby="audit-from-label"
            onChange={(event) => {
              setFrom(event.target.value)
              setFilterErrors((previous) => ({ ...previous, from: undefined }))
            }}
            ref={fromRef}
            type="datetime-local"
            value={from}
          />
          {filterErrors.from && (
            <span
              className="audit-filter-error"
              id="audit-from-error"
              role="alert"
            >
              {filterErrors.from}
            </span>
          )}
        </label>
        <label>
          <span id="audit-to-label">結束時間（不含）</span>
          <input
            aria-describedby={filterErrors.to ? 'audit-to-error' : undefined}
            aria-invalid={Boolean(filterErrors.to)}
            aria-labelledby="audit-to-label"
            onChange={(event) => {
              setTo(event.target.value)
              setFilterErrors((previous) => ({ ...previous, to: undefined }))
            }}
            ref={toRef}
            type="datetime-local"
            value={to}
          />
          {filterErrors.to && (
            <span
              className="audit-filter-error"
              id="audit-to-error"
              role="alert"
            >
              {filterErrors.to}
            </span>
          )}
        </label>
        <label>
          <span id="audit-event-type-label">事件類型</span>
          <input
            aria-describedby={
              filterErrors.eventType ? 'audit-event-type-error' : undefined
            }
            aria-invalid={Boolean(filterErrors.eventType)}
            aria-labelledby="audit-event-type-label"
            onChange={(event) => {
              setEventType(event.target.value)
              setFilterErrors((previous) => ({
                ...previous,
                eventType: undefined,
              }))
            }}
            placeholder="例如 project_zone.created"
            ref={eventTypeRef}
            value={eventType}
          />
          {filterErrors.eventType && (
            <span
              className="audit-filter-error"
              id="audit-event-type-error"
              role="alert"
            >
              {filterErrors.eventType}
            </span>
          )}
        </label>
        {projectId && (
          <p className="audit-project-hint" id="audit-project-hint">
            選擇專案後，無專案紀錄與尚未回填的歷史紀錄不會出現。
          </p>
        )}
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
