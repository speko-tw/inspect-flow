import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from 'react'
import { Link, useNavigate } from 'react-router'

import { ConfirmBox } from '../../ui/ConfirmBox'
import { Form, FormError, FormSubmitButton } from '../../ui/Form'
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
type FormMode = { kind: 'new' } | { kind: 'edit'; project: Project } | null
type Transition =
  | { kind: 'new' }
  | { kind: 'edit'; project: Project }
  | { kind: 'list' }
  | { kind: 'navigate'; to: string }

// 換成另一個轉換時要重新掛載確認框，焦點才會回到「保留編輯」。
function transitionKey(transition: Transition): string {
  if (transition.kind === 'edit') return `edit:${transition.project.id}`
  if (transition.kind === 'list') return 'list'
  if (transition.kind === 'navigate') return `navigate:${transition.to}`
  return 'new'
}

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

/** 呈現專案清單與新增／編輯表單，並守住 ADM-R15 的草稿轉場。 */
export default function ProjectsPage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [newDraft, setNewDraft] = useState<FormState>(EMPTY_FORM)
  const [editDrafts, setEditDrafts] = useState<Record<string, FormState>>({})
  const [editFocusRequest, setEditFocusRequest] = useState(0)
  const [transition, setTransition] = useState<Transition | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [listError, setListError] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const requestId = useRef(0)
  const transitionRef = useRef<HTMLDivElement>(null)
  const editHeadingRef = useRef<HTMLHeadingElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const noticeRef = useRef<HTMLParagraphElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const restoreFocusAfterTransition = useRef(false)
  const previousFormModeRef = useRef<FormMode>(null)
  const focusAfterCloseRef = useRef<FormMode>(null)
  const newProjectButtonRef = useRef<HTMLButtonElement>(null)
  const editing = formMode?.kind === 'edit' ? formMode.project : null
  const form =
    formMode?.kind === 'new'
      ? newDraft
      : editing
        ? (editDrafts[editing.id] ?? toForm(editing))
        : null
  const originalForm = editing ? toForm(editing) : EMPTY_FORM
  const hasUnsavedChanges = Boolean(
    form &&
    Object.keys(EMPTY_FORM).some(
      (key) =>
        form[key as keyof FormState] !== originalForm[key as keyof FormState],
    ),
  )

  useEffect(() => {
    if (!transition) return
    transitionRef.current?.scrollIntoView?.({ block: 'center' })
  }, [transition])

  useEffect(() => {
    if (transition || !restoreFocusAfterTransition.current) return
    restoreFocusAfterTransition.current = false
    restoreFocusRef.current?.focus()
  }, [transition])

  useEffect(() => {
    // ADM-R38：只在表單真的關閉時記錄落點，切換到另一份表單不搶焦點。
    if (previousFormModeRef.current && !formMode) {
      focusAfterCloseRef.current = previousFormModeRef.current
    }
    previousFormModeRef.current = formMode
  }, [formMode])

  useEffect(() => {
    const closedForm = focusAfterCloseRef.current
    if (!closedForm || formMode) return
    // 儲存後清單會重載；等原專案卡片出現再聚焦，避免落到 body。
    const card =
      closedForm.kind === 'edit'
        ? document.getElementById(`project-card-${closedForm.project.id}`)
        : null
    const target = card ?? (!loading ? newProjectButtonRef.current : null)
    if (!target) return
    target.focus()
    focusAfterCloseRef.current = null
  }, [formMode, loading, projects])

  useEffect(() => {
    if (!formMode) return
    const heading = editHeadingRef.current
    heading?.scrollIntoView?.({ block: 'start' })
    heading?.focus()
  }, [formMode, editFocusRequest])

  useEffect(() => {
    if (!notice) return
    noticeRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [notice])

  useEffect(() => {
    if (!error) return
    const alert = errorRef.current
    alert?.scrollIntoView?.({ block: 'nearest' })
    alert?.focus()
  }, [error])

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
    if (formMode?.kind === 'new') {
      setNewDraft((current) => ({ ...current, [field]: value }))
    } else if (formMode?.kind === 'edit') {
      const projectId = formMode.project.id
      setEditDrafts((current) => ({
        ...current,
        [projectId]: {
          ...(current[projectId] ?? toForm(formMode.project)),
          [field]: value,
        },
      }))
    }
  }

  function dropDraft(id: string) {
    setEditDrafts((current) => {
      if (!(id in current)) return current
      const next = { ...current }
      delete next[id]
      return next
    })
  }

  function applyTransition(next: Transition) {
    setTransition(null)
    discardActiveDraft()
    if (next.kind === 'edit') {
      setFormMode(next)
      setEditFocusRequest((request) => request + 1)
      setNotice('')
      setError('')
    } else if (next.kind === 'new') {
      setFormMode(next)
      setNotice('')
      setError('')
    } else if (next.kind === 'list') {
      setFormMode(null)
      setNotice('')
      setError('')
    } else {
      setFormMode(null)
      navigate(next.to)
    }
  }

  function discardActiveDraft() {
    if (formMode?.kind === 'new') {
      setNewDraft(EMPTY_FORM)
    } else if (formMode?.kind === 'edit') {
      dropDraft(formMode.project.id)
    }
  }

  function requestTransition(next: Transition) {
    if (hasUnsavedChanges) {
      setTransition(next)
      return
    }
    applyTransition(next)
  }

  function startEdit(project: Project) {
    requestTransition({ kind: 'edit', project })
  }

  function guardProjectLink(event: MouseEvent<HTMLAnchorElement>, to: string) {
    if (!hasUnsavedChanges) return
    event.preventDefault()
    setTransition({ kind: 'navigate', to })
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form || !formMode) return
    setError('')
    setNotice('')
    const input = toInput(form)
    const creating = editing === null
    const savingProjectId = editing?.id ?? null
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
          dropDraft(editing.id)
          applyTransition({ kind: 'list' })
          return
        }
        saved = await updateProject(editing.id, changed)
      } else {
        saved = await createProject(input)
      }
      if (creating) {
        setNewDraft(EMPTY_FORM)
        setFormMode(null)
        navigate(`/admin/projects/${saved.id}`, {
          state: hasDuplicateCodeWarning(saved)
            ? { duplicateProjectCode: saved.project_code }
            : null,
        })
        return
      }
      const savedNotice = hasDuplicateCodeWarning(saved)
        ? `專案「${saved.name}」已儲存。警告：專案代號「${saved.project_code}」與其他專案重複，仍已儲存。`
        : `專案「${saved.name}」已儲存。`
      if (savingProjectId) dropDraft(savingProjectId)
      // ADM-R15：A 的回應晚於表單切換時，只關 A，不捨棄 B 的草稿。
      setFormMode((current) =>
        current?.kind === 'edit' && current.project.id === savingProjectId
          ? null
          : current,
      )
      setNotice(savedNotice)
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
      <h1 id="projects-heading">專案</h1>
      {notice && (
        <p className="notice-success" ref={noticeRef} role="status">
          {notice}
        </p>
      )}
      {transition && (
        <ConfirmBox
          key={transitionKey(transition)}
          cancelLabel="保留編輯"
          confirmLabel="捨棄"
          label="未儲存變更"
          onCancel={() => {
            restoreFocusAfterTransition.current = true
            setTransition(null)
          }}
          onConfirm={() => {
            discardActiveDraft()
            applyTransition(transition)
          }}
          role="region"
          rootRef={transitionRef}
          variant="danger"
        >
          <p>目前的專案內容尚未儲存，要保留編輯或捨棄？</p>
        </ConfirmBox>
      )}
      {formMode === null && (
        <button
          className="btn-primary"
          onClick={() => requestTransition({ kind: 'new' })}
          ref={newProjectButtonRef}
          type="button"
        >
          新增專案
        </button>
      )}
      {form && (
        <Form
          onFocusCapture={(event) => {
            if (event.target instanceof HTMLElement) {
              restoreFocusRef.current = event.target
            }
          }}
          onSubmit={save}
        >
          <h2 ref={editHeadingRef} tabIndex={-1}>
            {editing ? `編輯專案「${editing.name}」` : '新增專案'}
          </h2>
          {editing && (
            <button
              onClick={() => requestTransition({ kind: 'new' })}
              type="button"
            >
              新增專案
            </button>
          )}
          <label>
            <span className="required-label">
              專案代號 <span aria-hidden="true">*</span>
            </span>
            <input
              maxLength={32}
              onChange={(event) => change('project_code', event.target.value)}
              required
              value={form.project_code}
            />
          </label>
          <label>
            <span className="required-label">
              工程名稱 <span aria-hidden="true">*</span>
            </span>
            <input
              maxLength={128}
              onChange={(event) => change('name', event.target.value)}
              required
              value={form.name}
            />
          </label>
          <label>
            <span className="required-label">
              業主／委託單位 <span aria-hidden="true">*</span>
            </span>
            <input
              maxLength={128}
              onChange={(event) => change('client_name', event.target.value)}
              required
              value={form.client_name}
            />
          </label>
          <label>
            <span className="required-label">
              整體工程地點 <span aria-hidden="true">*</span>
            </span>
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
          <button
            onClick={() => requestTransition({ kind: 'list' })}
            type="button"
          >
            取消
          </button>
          <FormSubmitButton className="btn-primary" disabled={saving}>
            {editing ? '儲存專案' : '新增專案'}
          </FormSubmitButton>
          {error && (
            <p
              className="shared-form-error"
              ref={errorRef}
              role="alert"
              tabIndex={-1}
            >
              {error}
            </p>
          )}
        </Form>
      )}
      {loading ? <p>載入中…</p> : null}
      <Form onSubmit={searchProjects}>
        <label>
          搜尋專案
          <input
            onChange={(event) => setQuery(event.target.value)}
            value={query}
          />
        </label>
        <FormSubmitButton disabled={loading}>搜尋</FormSubmitButton>
      </Form>
      <FormError>{listError}</FormError>
      {projects.length > 0 && (
        <section aria-labelledby="project-workspace-heading">
          <h2 id="project-workspace-heading">專案工作台</h2>
          <div className="project-workspace-grid">
            {projects.map((project) => (
              <article
                className="project-workspace-card"
                id={`project-card-${project.id}`}
                key={project.id}
                tabIndex={-1}
              >
                <p className="project-code">{project.project_code}</p>
                <h3>{project.name}</h3>
                <p>{project.site_location}</p>
                <Link
                  className="btn btn-primary"
                  onClick={(event) =>
                    guardProjectLink(
                      event,
                      `/admin/projects/${project.id}/templates`,
                    )
                  }
                  to={`/admin/projects/${project.id}/templates`}
                >
                  套用範本
                </Link>
                <Link
                  className="btn"
                  onClick={(event) =>
                    guardProjectLink(event, `/admin/projects/${project.id}`)
                  }
                  to={`/admin/projects/${project.id}`}
                >
                  開啟專案
                </Link>
                <button
                  aria-label={`編輯專案「${project.name}」`}
                  className="btn project-workspace-edit"
                  onClick={() => startEdit(project)}
                  type="button"
                >
                  編輯
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
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
        <table className="projects-admin-table">
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
                    className="btn btn-sm"
                    onClick={(event) =>
                      guardProjectLink(
                        event,
                        `/admin/projects/${project.id}/members`,
                      )
                    }
                    to={`/admin/projects/${project.id}/members`}
                  >
                    成員
                  </Link>
                  <Link
                    className="btn btn-sm"
                    onClick={(event) =>
                      guardProjectLink(event, `/admin/projects/${project.id}`)
                    }
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
    </section>
  )
}
