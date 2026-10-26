import { useEffect, useRef, useState, type FormEvent } from 'react'

import { httpErrorMessage } from '../../http'
import { listAllPages, type User } from '../api'
import type { Project } from '../projects/api'
import {
  listAuditLogs,
  type AuditLogEntry,
  type AuditLogFilters,
  type AuditLogPage,
} from './api'
import { PAGE_TITLES } from '../../terms'
import { entityLabel, EVENT_TYPE_OPTIONS, eventLabel } from './auditLabels'
import './AuditLogPage.css'
import { AuditChanges } from './AuditSnapshot'
import { Notice } from '../../ui/Notice'
import { revealElement } from '../../ui/reveal'

const emptyFilters: AuditLogFilters = {
  project_id: '',
  actor_id: '',
  from: '',
  to: '',
  event_type: '',
}

const reversedRangeError = '起始時間不得晚於結束時間。'

interface FilterErrors {
  from?: string
  to?: string
}

// 空值顯示「無」：新增事件的 before、刪除事件的 after 本來就是空值
// （ALG-R09），不是資料遺失。
function displayJson(value: unknown): string {
  return value == null ? '無' : JSON.stringify(value, null, 2)
}

/**
 * Admin 專用的稽核紀錄查詢頁（ADM-R07、ADM-R08、ALG-R22、ALG-R23）。
 *
 * 唯讀：只查詢，不新增、修改或刪除紀錄（ALG-R04）。篩選條件按下
 * 「查詢」才生效，改了輸入但沒送出時不會重新載入。
 */
export default function AuditLogPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Array<{ id: string; name: string }>>([])
  const [rolesState, setRolesState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  )
  const [optionsError, setOptionsError] = useState('')
  const [projectId, setProjectId] = useState('')
  const [actorId, setActorId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [eventType, setEventType] = useState('')
  const [filterErrors, setFilterErrors] = useState<FilterErrors>({})
  const fromRef = useRef<HTMLInputElement>(null)
  const toRef = useRef<HTMLInputElement>(null)
  const [filters, setFilters] = useState<AuditLogFilters>(emptyFilters)
  const [cursor, setCursor] = useState<string | null>(null)
  // 後端只給「下一頁」的 cursor；上一頁靠前端記下走過的 cursor 往回退。
  const [history, setHistory] = useState<Array<string | null>>([])
  const [result, setResult] = useState<AuditLogPage | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  // 篩選選項與名稱對照一次載入：角色、專案、人員的名稱都在前端查表，
  // 紀錄本身只存 id（ALG-R03，被記錄的對象日後可能已刪除）。
  useEffect(() => {
    let active = true
    void listAllPages<{ id: string; name: string }>('/roles')
      .then((rows) => {
        if (active) {
          setRoles(rows)
          setRolesState('ready')
        }
      })
      .catch(() => {
        if (active) setRolesState('error')
      })
    void Promise.all([
      listAllPages<Project>('/projects'),
      listAllPages<User>('/users'),
    ]).then(
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
    // 輸入是本地時間，轉成 UTC 的 ISO 字串再送出（API-R09）；起訖
    // 顛倒或格式不對就擋在前端，錯誤顯示在欄位旁。
    const fromDate = from ? new Date(from) : null
    const toDate = to ? new Date(to) : null
    const nextErrors: FilterErrors = {}
    if (fromDate && Number.isNaN(fromDate.getTime())) {
      nextErrors.from = '請輸入有效的起始時間。'
    }
    if (toDate && Number.isNaN(toDate.getTime())) {
      nextErrors.to = '請輸入有效的結束時間。'
    } else if (fromDate && toDate && fromDate > toDate) {
      nextErrors.to = reversedRangeError
    }
    setFilterErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      setError('')
      const target = nextErrors.from ? fromRef.current : toRef.current
      revealElement(target)
      target?.focus({ preventScroll: true })
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
      event_type: eventType,
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

  // ALG-R22：角色以「目前名稱」呈現，不是事件當時的名稱；角色清單
  // 成功載入後仍找不到才回 null（呼叫端顯示「已刪除的角色」），載入
  // 中或失敗時顯示暫時無法顯示，兩者不能混為一談，也不得顯示 UUID。
  function roleName(id: string): string | null {
    if (rolesState !== 'ready') return '角色名稱暫時無法顯示'
    return roles.find((role) => role.id === id)?.name ?? null
  }

  function actorName(id: string): string {
    return userName(id) ?? '未知帳號'
  }

  // 內部編號不給人看：查不到名稱就回 null，由呼叫端決定怎麼說。
  function userName(id: string): string | null {
    const user = users.find((candidate) => candidate.id === id)
    return user ? `${user.name_zh || user.username} (${user.username})` : null
  }

  function projectName(id: string | null): string {
    if (!id) return '無專案'
    const project = projects.find((candidate) => candidate.id === id)
    return project ? `${project.name} (${project.project_code})` : '未知專案'
  }

  function entryCard(entry: AuditLogEntry) {
    return (
      <li className="audit-entry" key={entry.id}>
        <article>
          <div className="audit-entry-heading">
            <h2>{eventLabel(entry)}</h2>
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
                {entityLabel(entry, {
                  userName,
                  roleName,
                  projectName: (id) => {
                    const project = projects.find(
                      (candidate) => candidate.id === id,
                    )
                    return project
                      ? `${project.name} (${project.project_code})`
                      : null
                  },
                })}
              </dd>
            </div>
          </dl>
          <details>
            <summary>查看改前與改後內容</summary>
            <AuditChanges
              eventType={entry.event_type}
              before={entry.before}
              after={entry.after}
              lookup={{
                roleName,
                userName,
                projectName: (id) => {
                  const project = projects.find((item) => item.id === id)
                  return project?.name ?? null
                },
              }}
            />
            <details>
              <summary>技術細節（工程人員用）</summary>
              <h3>改前原文</h3>
              <pre>{displayJson(entry.before)}</pre>
              <h3>改後原文</h3>
              <pre>{displayJson(entry.after)}</pre>
            </details>
          </details>
        </article>
      </li>
    )
  }

  return (
    <section className="audit-page" aria-labelledby="audit-page-title">
      <h1 id="audit-page-title">{PAGE_TITLES.records}</h1>
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
              setFilterErrors((previous) => ({
                ...previous,
                from: undefined,
                to:
                  previous.to === reversedRangeError ? undefined : previous.to,
              }))
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
          事件類型
          <select
            onChange={(event) => setEventType(event.target.value)}
            value={eventType}
          >
            <option value="">全部</option>
            {EVENT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {projectId && (
          <p className="audit-project-hint" id="audit-project-hint">
            選擇專案後，無專案紀錄與尚未回填的歷史紀錄不會出現。
          </p>
        )}
        <button type="submit">查詢</button>
      </form>
      {error && <Notice variant="error">{error}</Notice>}
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
