import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from 'react'
import { Link, useNavigate } from 'react-router'

import { RequiredMark } from '../../ui/Form'
import { ConfirmBox } from '../../ui/ConfirmBox'
import { mapFieldErrors } from '../../ui/fieldErrors'
import { FieldError, Form, FormError, FormSubmitButton } from '../../ui/Form'
import { HttpError } from '../../http'
import { managementErrorMessage } from '../api'
import { CursorListSearch } from '../CursorListSearch'
import { useCursorList } from '../useCursorList'
import {
  DEFAULT_COMPANY_ROLE,
  createProject,
  hasDuplicateCodeWarning,
  listCompanyRoles,
  listProjectsPage,
  updateProject,
  type CompanyRole,
  type Project,
  type ProjectInput,
} from './api'

// DOM-R76、ADM-R42：改本公司角色的原因，去除前後空白後 1～256 字元。
const REASON_MAX_LENGTH = 256

const EMPTY_FORM = {
  // ADM-R40：開案預設承攬施工方；送出時仍明確帶上選取值。
  company_role: DEFAULT_COMPANY_ROLE,
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
    company_role: project.company_role,
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
    company_role: form.company_role,
    project_code: form.project_code.trim(),
    name: form.name.trim(),
    client_name: form.client_name.trim(),
    site_location: form.site_location.trim(),
    planned_start_date: form.planned_start_date || null,
    planned_completion_date: form.planned_completion_date || null,
  }
}

function roleLabel(roles: CompanyRole[], value: string): string {
  return roles.find((role) => role.value === value)?.label ?? value
}

/** 角色選項；尚未載入或清單沒有目前值時，仍保留目前值避免畫面空白。 */
function roleOptions(
  roles: CompanyRole[],
  current: string,
  status: 'loading' | 'ready' | 'error',
) {
  if (status === 'loading') {
    return <option value={current}>載入中…</option>
  }
  const options = roles.map((role) => (
    <option key={role.value} value={role.value}>
      {role.label}
    </option>
  ))
  if (!roles.some((role) => role.value === current)) {
    options.unshift(
      <option key={current} value={current}>
        {current}
      </option>,
    )
  }
  return options
}

/** 呈現專案清單與新增／編輯表單，並守住 ADM-R15 的草稿轉場。 */
export default function ProjectsPage() {
  const navigate = useNavigate()
  const projectList = useCursorList(listProjectsPage, managementErrorMessage)
  const {
    items: projects,
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
  } = projectList
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [newDraft, setNewDraft] = useState<FormState>(EMPTY_FORM)
  const [editDrafts, setEditDrafts] = useState<Record<string, FormState>>({})
  const [editFocusRequest, setEditFocusRequest] = useState(0)
  const [transition, setTransition] = useState<Transition | null>(null)
  const [roles, setRoles] = useState<CompanyRole[]>([])
  const [rolesStatus, setRolesStatus] = useState<
    'loading' | 'ready' | 'error'
  >('loading')
  const [roleFieldError, setRoleFieldError] = useState('')
  const [roleFocusRequest, setRoleFocusRequest] = useState(0)
  // ADM-R42：改角色要先在確認框填原因；原因草稿獨立保存，
  // 確認框因錯誤關閉再開時不必重打。
  const [roleConfirmOpen, setRoleConfirmOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState('')
  const [reasonFocusRequest, setReasonFocusRequest] = useState(0)
  const roleSelectRef = useRef<HTMLSelectElement>(null)
  const reasonInputRef = useRef<HTMLTextAreaElement>(null)
  const roleConfirmRef = useRef<HTMLDivElement>(null)
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
  const roleChanged = Boolean(
    editing && form && form.company_role !== editing.company_role,
  )
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
    // 清單重載期間使用者可能已點進別處（例如搜尋框），此時不搶焦點。
    const active = document.activeElement
    focusAfterCloseRef.current = null
    if (active && active !== document.body) return
    target.focus()
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
    // ADM-R40：角色選項取自後端登記表，不在畫面寫死。
    let active = true
    listCompanyRoles()
      .then((items) => {
        if (!active) return
        setRoles(items)
        setRolesStatus('ready')
      })
      .catch(() => {
        if (active) setRolesStatus('error')
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (roleConfirmOpen && roleChanged) {
      roleConfirmRef.current?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [roleConfirmOpen, roleChanged])

  useEffect(() => {
    if (!error) return
    const alert = errorRef.current
    alert?.scrollIntoView?.({ block: 'nearest' })
    alert?.focus()
  }, [error])

  function change(field: keyof FormState, value: string) {
    if (field === 'company_role') {
      // 改角色就重新走一次確認：改回原值時確認框要關掉，否則再改成
      // 別的值時會直接帶著舊的「已開啟」狀態跳出來。
      setRoleFieldError('')
      setRoleConfirmOpen(false)
      setReasonError('')
    }
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

  function resetRoleConfirm() {
    setRoleConfirmOpen(false)
    setReason('')
    setReasonError('')
    setRoleFieldError('')
  }

  function applyTransition(next: Transition) {
    setTransition(null)
    resetRoleConfirm()
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
    // ADM-R42：改本公司角色先跳確認框並收原因；取消時不送出請求。
    if (editing && roleChanged) {
      setError('')
      setNotice('')
      setRoleConfirmOpen(true)
      return
    }
    await persist(null)
  }

  /** 驗證確認框的原因欄；通過才送出（DOM-R76：去空白後 1～256 字元）。 */
  async function confirmRoleChange() {
    const trimmed = reason.trim()
    if (!trimmed) {
      setReasonError('請填寫變更原因。')
      setReasonFocusRequest((request) => request + 1)
      return
    }
    if (trimmed.length > REASON_MAX_LENGTH) {
      setReasonError(`變更原因最多 ${REASON_MAX_LENGTH} 個字元。`)
      setReasonFocusRequest((request) => request + 1)
      return
    }
    setReasonError('')
    await persist(trimmed)
  }

  function cancelRoleChange() {
    setRoleConfirmOpen(false)
    setReasonError('')
    roleSelectRef.current?.focus()
  }

  async function persist(changeReason: string | null) {
    if (!form || !formMode) return
    setError('')
    setNotice('')
    setRoleFieldError('')
    const input = toInput(form)
    const creating = editing === null
    const savingProjectId = editing?.id ?? null
    setSaving(true)
    try {
      let saved: Project
      if (editing) {
        const original = toInput(toForm(editing))
        const changed: Record<string, unknown> = Object.fromEntries(
          Object.entries(input).filter(
            ([key, value]) => original[key as keyof ProjectInput] !== value,
          ),
        )
        if (Object.keys(changed).length === 0) {
          dropDraft(editing.id)
          applyTransition({ kind: 'list' })
          return
        }
        if (changed.company_role !== undefined && changeReason !== null) {
          changed.company_role_change_reason = changeReason
        }
        saved = await updateProject(editing.id, changed)
      } else {
        saved = await createProject(input)
      }
      resetRoleConfirm()
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
      void reload()
    } catch (caught) {
      showSaveError(caught)
    } finally {
      setSaving(false)
    }
  }

  /** 角色與原因的錯誤顯示在欄位旁並聚焦；其餘留在表單的一般訊息區。 */
  function showSaveError(caught: unknown) {
    if (
      caught instanceof HttpError &&
      caught.code === 'project.company_role_reason_required'
    ) {
      setReasonError('改本公司角色必須填寫變更原因。')
      setReasonFocusRequest((request) => request + 1)
      return
    }
    if (caught instanceof HttpError && caught.fields) {
      // 後端對未登記角色與過長原因回帶欄位指標的 422（ADM-R28）。
      const mapped = mapFieldErrors(caught.fields, [
        { path: '/company_role', key: 'role' },
        { path: '/company_role_change_reason', key: 'reason' },
      ])
      if (mapped.errors.reason) {
        setReasonError(`變更原因最多 ${REASON_MAX_LENGTH} 個字元。`)
        setReasonFocusRequest((request) => request + 1)
        return
      }
      if (mapped.errors.role) {
        setRoleConfirmOpen(false)
        setRoleFieldError('這個角色不能使用，請重新選擇。')
        setRoleFocusRequest((request) => request + 1)
        return
      }
    }
    setRoleConfirmOpen(false)
    setError(managementErrorMessage(caught))
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
              本公司在這個案子的角色 <RequiredMark />
            </span>
            <select
              aria-describedby={[
                'company-role-hint',
                roleFieldError || rolesStatus === 'error'
                  ? 'company-role-error'
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-invalid={
                roleFieldError || rolesStatus === 'error' ? 'true' : undefined
              }
              disabled={rolesStatus !== 'ready'}
              onChange={(event) => change('company_role', event.target.value)}
              ref={roleSelectRef}
              required
              value={form.company_role}
            >
              {roleOptions(roles, form.company_role, rolesStatus)}
            </select>
            <span className="field-hint" id="company-role-hint">
              會決定報表種類。同工地的另一種角色請另開專案。
            </span>
          </label>
          <FieldError
            focusRequest={roleFocusRequest || undefined}
            focusTarget={roleSelectRef}
            id="company-role-error"
          >
            {rolesStatus === 'error'
              ? '角色選項載入失敗，請重新整理後再試。'
              : roleFieldError}
          </FieldError>
          <label>
            <span className="required-label">
              專案代號 <RequiredMark />
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
              工程名稱 <RequiredMark />
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
              業主／委託單位 <RequiredMark />
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
              整體工程地點 <RequiredMark />
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
          <FormSubmitButton
            className="btn-primary"
            disabled={saving || (!editing && rolesStatus !== 'ready')}
          >
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
      {editing && roleChanged && roleConfirmOpen && form && (
        <ConfirmBox
          asForm
          busy={saving}
          cancelLabel="取消"
          confirmLabel="確認"
          label="修改本公司角色"
          noValidate
          onCancel={cancelRoleChange}
          onConfirm={confirmRoleChange}
          rootRef={roleConfirmRef}
          variant="neutral"
        >
          <p>
            要把「{editing.name}」的本公司角色由「
            {roleLabel(roles, editing.company_role)}」改為「
            {roleLabel(roles, form.company_role)}」嗎？
          </p>
          <p>
            之後新建的任務改為新的檢查層級，已建立的任務與已產生的報表維持原樣。
          </p>
          <label>
            <span className="required-label">
              變更原因 <RequiredMark />
            </span>
            <textarea
              aria-describedby={
                reasonError ? 'company-role-reason-error' : undefined
              }
              aria-invalid={reasonError ? 'true' : undefined}
              onChange={(event) => {
                setReason(event.target.value)
                setReasonError('')
              }}
              ref={reasonInputRef}
              required
              value={reason}
            />
          </label>
          <FieldError
            focusRequest={reasonFocusRequest || undefined}
            focusTarget={reasonInputRef}
            id="company-role-reason-error"
          >
            {reasonError}
          </FieldError>
        </ConfirmBox>
      )}
      {loading ? <p>載入中…</p> : null}
      <CursorListSearch
        disabled={loading}
        label="搜尋專案"
        onQueryChange={setQuery}
        onSearch={(event) => {
          event.preventDefault()
          void search(query)
        }}
        query={query}
      />
      <FormError>{listError}</FormError>
      {projects.length > 0 && (
        <section aria-labelledby="project-workspace-heading">
          <h2 id="project-workspace-heading">專案工作台</h2>
          <div className="project-workspace-grid">
            {projects.map((project) => {
              // TPL-R23：導覽與未儲存變更守衛共用
              // 正式套用路徑，避免守衛後前往舊網址。
              const applyTemplatesPath = [
                '/admin/projects',
                project.id,
                'inspection-items',
                'templates',
              ].join('/')
              return (
                <article
                  className="project-workspace-card"
                  id={`project-card-${project.id}`}
                  key={project.id}
                  tabIndex={-1}
                >
                  <p className="project-code">
                    {project.project_code}
                    {hasDuplicateCodeWarning(project) ? (
                      <span>（代號重複）</span>
                    ) : null}
                  </p>
                  <h3>{project.name}</h3>
                  <p>{project.site_location}</p>
                  {/* 列表只剩卡片，業主與預定日期不得因此看不到；
                      沒有值就不顯示該行。 */}
                  {project.client_name ? (
                    <p>{`業主：${project.client_name}`}</p>
                  ) : null}
                  {project.planned_start_date ? (
                    <p>{`預定開工：${project.planned_start_date}`}</p>
                  ) : null}
                  {project.planned_completion_date ? (
                    <p>{`預定完工：${project.planned_completion_date}`}</p>
                  ) : null}
                  <Link
                    className="btn btn-primary"
                    onClick={(event) =>
                      guardProjectLink(event, applyTemplatesPath)
                    }
                    to={applyTemplatesPath}
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
                  <button
                    aria-label={`編輯專案「${project.name}」`}
                    className="btn"
                    onClick={() => startEdit(project)}
                    type="button"
                  >
                    編輯
                  </button>
                </article>
              )
            })}
          </div>
        </section>
      )}
      {!loading && projects.length === 0 ? (
        appliedQuery ? (
          <p>
            找不到符合「{appliedQuery}」的專案。{' '}
            <button onClick={() => void clearSearch()} type="button">
              清除搜尋
            </button>
          </p>
        ) : (
          <p>目前沒有專案。</p>
        )
      ) : null}
      {nextCursor && (
        <button
          disabled={loading || loadingMore}
          onClick={() => void loadMore()}
          type="button"
        >
          {loadingMore ? '載入中…' : '載入更多'}
        </button>
      )}
    </section>
  )
}
