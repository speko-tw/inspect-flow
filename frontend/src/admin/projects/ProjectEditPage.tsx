import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'

import { useCurrentUser } from '../../auth/useCurrentUser'
import { BackLink } from '../../layout/BackLink'
import { ProjectNotFound } from '../../RouteNotFound'
import { ConfirmBox } from '../../ui/ConfirmBox'
import { FieldError, FormSubmitButton, RequiredMark } from '../../ui/Form'
import { fieldErrorMessage, mapFieldErrors } from '../../ui/fieldErrors'
import { blockImeEnter, useSubmitGuard } from '../../ui/submitGuard'
import {
  UnsavedLeaveBox,
  useUnsavedNavigationGuard,
} from '../../ui/navigation'
import { HttpError, isForbidden, isNotFound } from '../../http'
import { Input } from '../../components/Input'
import { managementErrorMessage } from '../api'
import ProjectDeniedPage from '../projectHome/ProjectDeniedPage'
import ProjectSectionShell from '../projectHome/ProjectSectionShell'
import { getWorkflowSummary } from '../projectHome/api'
import {
  getProject,
  listCompanyRoles,
  updateProject,
  type CompanyRole,
  type Project,
  type ProjectInput,
} from './api'

const REASON_MAX_LENGTH = 256

type Draft = Omit<
  ProjectInput,
  'planned_start_date' | 'planned_completion_date'
> & {
  planned_start_date: string
  planned_completion_date: string
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; projectId: string }
  | { kind: 'denied'; projectId: string }
  | { kind: 'not-found'; projectId: string }
  | {
      kind: 'ready'
      projectId: string
      project: Project
      companyRoles: CompanyRole[]
      viewerPermissions: string[]
    }

type ReturnState = { returnTo?: unknown; returnQuery?: unknown }

function toDraft(project: Project): Draft {
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

function toInput(draft: Draft): ProjectInput {
  return {
    ...draft,
    project_code: draft.project_code.trim(),
    name: draft.name.trim(),
    client_name: draft.client_name.trim(),
    site_location: draft.site_location.trim(),
    planned_start_date: draft.planned_start_date || null,
    planned_completion_date: draft.planned_completion_date || null,
  }
}

function safeReturnTo(value: unknown, projectId: string): string {
  if (value === '/projects') return value
  const home = `/projects/${projectId}`
  return home
}

/** ADM-R54：以專案權限守門的獨立專案修改頁。 */
export default function ProjectEditPage() {
  const { projectId = '' } = useParams()
  const { user } = useCurrentUser()
  const location = useLocation()
  const navigate = useNavigate()
  const guard = useSubmitGuard()
  const routeState = location.state as ReturnState | null
  const returnTo = safeReturnTo(routeState?.returnTo, projectId)
  const returnQuery =
    returnTo === '/projects' && typeof routeState?.returnQuery === 'string'
      ? routeState.returnQuery
      : ''
  const returnState = returnQuery ? { projectQuery: returnQuery } : null
  const backLabel = returnTo === '/projects' ? '返回專案清單' : '返回專案首頁'
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' })
  const [retry, setRetry] = useState(0)
  const [draftState, setDraftState] = useState<{
    projectId: string
    draft: Draft
  } | null>(null)
  const [roleState, setRoleState] = useState<{
    projectId: string
    status: 'loading' | 'ready' | 'error'
    roles: CompanyRole[]
  } | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmRoleChangeOpen, setConfirmRoleChangeOpen] = useState(false)
  const [focusTarget, setFocusTarget] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState(0)
  const mounted = useRef(false)
  const currentProjectId = useRef(projectId)
  currentProjectId.current = projectId
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement | null>(null)
  const roleSelectRef = useRef<HTMLSelectElement | null>(null)
  const errorRef = useRef<HTMLParagraphElement | null>(null)
  const focusReason = useRef(false)
  const returnFocusToRole = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    let active = true
    getWorkflowSummary(projectId)
      .then(async (summary) => {
        if (
          !user.is_admin &&
          !summary.viewer_permission_codes.includes('project.update')
        ) {
          if (active) setLoadState({ kind: 'denied', projectId })
          return
        }
        const [project, companyRoles] = await Promise.all([
          getProject(projectId),
          listCompanyRoles(),
        ])
        if (active) {
          setLoadState({
            kind: 'ready',
            projectId,
            project,
            companyRoles,
            viewerPermissions: summary.viewer_permission_codes,
          })
          setRoleState({ projectId, status: 'ready', roles: companyRoles })
          setDraftState((current) =>
            current?.projectId === projectId
              ? current
              : { projectId, draft: toDraft(project) },
          )
        }
      })
      .catch((caught: unknown) => {
        if (!active) return
        if (isForbidden(caught)) {
          setLoadState({ kind: 'denied', projectId })
        } else if (isNotFound(caught)) {
          setLoadState({ kind: 'not-found', projectId })
        } else {
          setLoadState({
            kind: 'error',
            message: managementErrorMessage(caught),
            projectId,
          })
        }
      })
    return () => {
      active = false
    }
  }, [projectId, retry, user.is_admin])

  useEffect(() => {
    if (!focusTarget || !focusRequest) return
    const targetId =
      focusTarget === 'name'
        ? 'project-name'
        : focusTarget.replaceAll('_', '-')
    const target = document.getElementById(`edit-${targetId}`)
    if (!target) return
    target.scrollIntoView?.({ block: 'nearest' })
    target.focus({ preventScroll: true })
  }, [focusRequest, focusTarget])

  useEffect(() => {
    if (!focusReason || !reasonError) return
    focusReason.current = false
    reasonRef.current?.scrollIntoView?.({ block: 'nearest' })
    reasonRef.current?.focus({ preventScroll: true })
  }, [reasonError])

  useEffect(() => {
    if (!error) return
    errorRef.current?.scrollIntoView?.({ block: 'nearest' })
    errorRef.current?.focus({ preventScroll: true })
  }, [error])

  useEffect(() => {
    if (!confirmRoleChangeOpen && returnFocusToRole.current) {
      returnFocusToRole.current = false
      roleSelectRef.current?.focus({ preventScroll: true })
    }
  }, [confirmRoleChangeOpen])

  const ready = loadState.kind === 'ready' ? loadState : null
  const readyProjectId = ready?.projectId
  useEffect(() => {
    if (!readyProjectId) return
    headingRef.current?.scrollIntoView?.({ block: 'start' })
    headingRef.current?.focus()
  }, [readyProjectId])

  const project = ready?.project ?? null
  const draft =
    project && draftState?.projectId === projectId
      ? draftState.draft
      : project
        ? toDraft(project)
        : null
  const companyRoles =
    roleState?.projectId === projectId ? roleState.roles : []
  const roleStatus =
    roleState?.projectId === projectId ? roleState.status : 'loading'
  const isDirty = Boolean(
    project &&
    draft &&
    Object.keys(draft).some(
      (key) =>
        draft[key as keyof Draft] !== toDraft(project)[key as keyof Draft],
    ),
  )
  const leaveGuard = useUnsavedNavigationGuard(isDirty)

  async function retryRoles() {
    setRoleState({ projectId, status: 'loading', roles: [] })
    try {
      const roles = await listCompanyRoles()
      setRoleState({ projectId, status: 'ready', roles })
    } catch {
      setRoleState({ projectId, status: 'error', roles: [] })
    }
  }

  function change(field: keyof Draft, value: string) {
    if (!draft || !project) return
    setDraftState({ projectId, draft: { ...draft, [field]: value } })
    setFieldErrors((current) => ({ ...current, [field]: '' }))
    setError('')
    if (field === 'company_role') {
      setReasonError('')
      setConfirmRoleChangeOpen(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft || !project || !guard.enter()) return
    setError('')
    setFieldErrors({})
    setReasonError('')
    if (draft.company_role !== project.company_role) {
      setConfirmRoleChangeOpen(true)
      guard.leave()
      return
    }
    await persist(null)
  }

  async function persist(roleChangeReason: string | null) {
    if (!draft || !project) return
    const input = toInput(draft)
    const original = toInput(toDraft(project))
    const changed = Object.fromEntries(
      Object.entries(input).filter(
        ([key, value]) => original[key as keyof ProjectInput] !== value,
      ),
    )
    if (Object.keys(changed).length === 0) {
      guard.leave()
      leaveGuard.allowNavigation(() =>
        navigate(returnTo, { replace: true, state: returnState }),
      )
      return
    }
    if (changed.company_role !== undefined && roleChangeReason !== null) {
      changed.company_role_change_reason = roleChangeReason
    }
    setSaving(true)
    try {
      const saved = await updateProject(projectId, changed)
      if (!mounted.current || currentProjectId.current !== projectId) return
      const state = {
        projectNotice: `專案「${saved.name}」已儲存。`,
        ...(returnState ?? {}),
      }
      leaveGuard.allowNavigation(() =>
        navigate(returnTo, { replace: true, state }),
      )
    } catch (caught) {
      if (!mounted.current || currentProjectId.current !== projectId) return
      if (isForbidden(caught)) {
        setLoadState({ kind: 'denied', projectId })
      } else if (
        caught instanceof HttpError &&
        caught.code === 'project.company_role_reason_required'
      ) {
        focusReason.current = true
        setReasonError('改本公司角色必須填寫變更原因。')
      } else if (caught instanceof HttpError && caught.fields?.length) {
        const mapped = mapFieldErrors(caught.fields, [
          { path: '/project_code', key: 'project_code' },
          { path: '/name', key: 'name' },
          { path: '/client_name', key: 'client_name' },
          { path: '/site_location', key: 'site_location' },
          { path: '/company_role', key: 'company_role' },
          { path: '/company_role_change_reason', key: 'reason' },
        ])
        const messages = Object.fromEntries(
          Object.entries(mapped.errors).map(([key, code]) => [
            key,
            key === 'company_role'
              ? '這個角色不能使用，請重新選擇。'
              : fieldErrorMessage(code),
          ]),
        )
        if (messages.reason) {
          focusReason.current = true
          setReasonError('變更原因最多 256 個字元。')
        } else {
          setConfirmRoleChangeOpen(false)
        }
        setFieldErrors(messages)
        if (!messages.reason) {
          const first = [
            'project_code',
            'name',
            'client_name',
            'site_location',
            'company_role',
          ].find((key) => messages[key])
          if (first) {
            setFocusTarget(first)
            setFocusRequest((value) => value + 1)
          }
        }
        if (mapped.unmatched.length) {
          setError(managementErrorMessage(caught))
        }
      } else {
        setError(managementErrorMessage(caught))
      }
    } finally {
      if (mounted.current && currentProjectId.current === projectId) {
        setSaving(false)
        guard.leave()
      }
    }
  }

  async function confirmRoleChange() {
    const trimmed = reason.trim()
    if (!trimmed) {
      focusReason.current = true
      setReasonError('請填寫變更原因。')
      return
    }
    if (trimmed.length > REASON_MAX_LENGTH) {
      focusReason.current = true
      setReasonError(`變更原因最多 ${REASON_MAX_LENGTH} 個字元。`)
      return
    }
    setReasonError('')
    if (!guard.enter()) return
    await persist(trimmed)
  }

  if (
    loadState.kind === 'loading' ||
    ('projectId' in loadState && loadState.projectId !== projectId)
  ) {
    return <p role="status">正在載入專案…</p>
  }
  if (loadState.kind === 'denied') return <ProjectDeniedPage />
  if (loadState.kind === 'not-found') return <ProjectNotFound />
  if (loadState.kind === 'error') {
    return (
      <section aria-label="載入專案失敗">
        <BackLink state={returnState} to={returnTo}>
          {backLabel}
        </BackLink>
        <p role="alert">{loadState.message}</p>
        <button onClick={() => setRetry((value) => value + 1)} type="button">
          重新載入
        </button>
      </section>
    )
  }
  if (!ready || !project || !draft) return null

  return (
    <ProjectSectionShell
      activeSection="home"
      backLabel={backLabel}
      backState={returnState}
      backTo={returnTo}
      project={ready.project}
      projectId={projectId}
      viewerPermissions={ready.viewerPermissions}
    >
      <section aria-labelledby="project-edit-heading">
        <UnsavedLeaveBox guard={leaveGuard} />
        <h2 id="project-edit-heading" ref={headingRef} tabIndex={-1}>
          修改專案「{project.name}」
        </h2>
        <form
          className="project-create-form"
          onKeyDown={blockImeEnter}
          onSubmit={submit}
        >
          <fieldset disabled={saving}>
            <legend>專案資料</legend>
            <label htmlFor="edit-company-role">
              <span className="required-label">
                本公司在這個案子的角色 <RequiredMark />
              </span>
              <select
                aria-describedby={
                  fieldErrors.company_role
                    ? 'edit-company-role-error'
                    : undefined
                }
                aria-invalid={fieldErrors.company_role ? 'true' : undefined}
                disabled={roleStatus !== 'ready'}
                id="edit-company-role"
                onChange={(event) =>
                  change('company_role', event.target.value)
                }
                ref={roleSelectRef}
                required
                value={draft.company_role}
              >
                {companyRoles.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
                {!companyRoles.some(
                  (role) => role.value === draft.company_role,
                ) && (
                  <option value={draft.company_role}>
                    {draft.company_role}
                  </option>
                )}
              </select>
              {roleStatus === 'error' && (
                <span role="alert">
                  無法載入角色選項。{' '}
                  <button onClick={() => void retryRoles()} type="button">
                    重試
                  </button>
                </span>
              )}
            </label>
            <FieldError id="edit-company-role-error">
              {fieldErrors.company_role ?? ''}
            </FieldError>
            <label htmlFor="edit-project-code">
              <span className="required-label">
                專案代號 <RequiredMark />
              </span>
              <Input
                aria-describedby={
                  fieldErrors.project_code
                    ? 'edit-project-code-error'
                    : undefined
                }
                aria-invalid={fieldErrors.project_code ? 'true' : undefined}
                id="edit-project-code"
                maxLength={32}
                onChange={(event) =>
                  change('project_code', event.target.value)
                }
                required
                value={draft.project_code}
              />
            </label>
            <FieldError id="edit-project-code-error">
              {fieldErrors.project_code ?? ''}
            </FieldError>
            <label htmlFor="edit-project-name">
              <span className="required-label">
                工程名稱 <RequiredMark />
              </span>
              <Input
                aria-describedby={
                  fieldErrors.name ? 'edit-project-name-error' : undefined
                }
                aria-invalid={fieldErrors.name ? 'true' : undefined}
                id="edit-project-name"
                maxLength={128}
                onChange={(event) => change('name', event.target.value)}
                required
                value={draft.name}
              />
            </label>
            <FieldError id="edit-project-name-error">
              {fieldErrors.name ?? ''}
            </FieldError>
            <label htmlFor="edit-client-name">
              <span className="required-label">
                業主／委託單位 <RequiredMark />
              </span>
              <Input
                aria-describedby={
                  fieldErrors.client_name
                    ? 'edit-client-name-error'
                    : undefined
                }
                aria-invalid={fieldErrors.client_name ? 'true' : undefined}
                id="edit-client-name"
                maxLength={128}
                onChange={(event) => change('client_name', event.target.value)}
                required
                value={draft.client_name}
              />
            </label>
            <FieldError id="edit-client-name-error">
              {fieldErrors.client_name ?? ''}
            </FieldError>
            <label htmlFor="edit-site-location">
              <span className="required-label">
                整體工程地點 <RequiredMark />
              </span>
              <Input
                aria-describedby={
                  fieldErrors.site_location
                    ? 'edit-site-location-error'
                    : undefined
                }
                aria-invalid={fieldErrors.site_location ? 'true' : undefined}
                id="edit-site-location"
                maxLength={256}
                onChange={(event) =>
                  change('site_location', event.target.value)
                }
                required
                value={draft.site_location}
              />
            </label>
            <FieldError id="edit-site-location-error">
              {fieldErrors.site_location ?? ''}
            </FieldError>
            <label htmlFor="edit-start-date">
              預定開工日
              <Input
                id="edit-start-date"
                onChange={(event) =>
                  change('planned_start_date', event.target.value)
                }
                type="date"
                value={draft.planned_start_date}
              />
            </label>
            <label htmlFor="edit-completion-date">
              預定完工日
              <Input
                id="edit-completion-date"
                onChange={(event) =>
                  change('planned_completion_date', event.target.value)
                }
                type="date"
                value={draft.planned_completion_date}
              />
            </label>
          </fieldset>
          <div className="card-actions">
            <button
              className="btn"
              onClick={() => navigate(returnTo, { state: returnState })}
              type="button"
            >
              取消
            </button>
            <FormSubmitButton
              className="btn-primary"
              disabled={saving || roleStatus === 'loading'}
            >
              {saving ? '儲存中…' : '儲存專案'}
            </FormSubmitButton>
          </div>
          {error && (
            <p ref={errorRef} role="alert" tabIndex={-1}>
              {error}
            </p>
          )}
        </form>
        {confirmRoleChangeOpen && (
          <ConfirmBox
            asForm
            busy={saving}
            cancelLabel="取消"
            confirmLabel="確認"
            label="修改本公司角色"
            noValidate
            onCancel={() => {
              returnFocusToRole.current = true
              setConfirmRoleChangeOpen(false)
            }}
            onConfirm={confirmRoleChange}
            variant="neutral"
          >
            <p>
              要把「{project.name}」的本公司角色由「
              {companyRoles.find((role) => role.value === project.company_role)
                ?.label ?? project.company_role}
              」改為「
              {companyRoles.find((role) => role.value === draft.company_role)
                ?.label ?? draft.company_role}
              」嗎？
            </p>
            <p>
              之後新建的任務改為新的檢查層級，已建立的任務與已產生的報表維持原樣。
            </p>
            <label htmlFor="edit-company-role-reason">
              <span className="required-label">
                變更原因 <RequiredMark />
              </span>
              <textarea
                aria-describedby={
                  reasonError ? 'edit-company-role-reason-error' : undefined
                }
                aria-invalid={reasonError ? 'true' : undefined}
                id="edit-company-role-reason"
                maxLength={REASON_MAX_LENGTH}
                onChange={(event) => {
                  setReason(event.target.value)
                  setReasonError('')
                }}
                ref={reasonRef}
                required
                value={reason}
              />
            </label>
            <FieldError id="edit-company-role-reason-error">
              {reasonError}
            </FieldError>
          </ConfirmBox>
        )}
      </section>
    </ProjectSectionShell>
  )
}
