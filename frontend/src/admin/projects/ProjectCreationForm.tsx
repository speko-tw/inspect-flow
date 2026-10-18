import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'

import { ConfirmBox } from '../../ui/ConfirmBox'
import type { User } from '../api'
import { listAllPages, managementErrorMessage } from '../api'
import { FormErrorSummary } from '../../components/layout/LayoutPatterns'
import { Field } from '../../components/Field'
import { Input } from '../../components/Input'
import { HttpError } from '../../http'
import { fieldErrorMessage, mapFieldErrors } from '../../ui/fieldErrors'
import { blockImeEnter, useSubmitGuard } from '../../ui/submitGuard'
import {
  createProject,
  DEFAULT_COMPANY_ROLE,
  hasDuplicateCodeWarning,
  listCompanyRoles,
  type CompanyRole,
  type Project,
  type ProjectInput,
} from './api'

type ProjectDraft = Omit<
  ProjectInput,
  'planned_start_date' | 'planned_completion_date' | 'creator_role_user_id'
> & {
  planned_start_date: string
  planned_completion_date: string
  creator_role_user_id: string
}

const EMPTY_DRAFT: ProjectDraft = {
  company_role: DEFAULT_COMPANY_ROLE,
  project_code: '',
  name: '',
  client_name: '',
  site_location: '',
  planned_start_date: '',
  planned_completion_date: '',
  creator_role_user_id: '',
}

/** ADM-R32：開設專案；Admin 可選填建立者角色人選。 */
export function ProjectCreationForm({
  isAdmin,
  onDirtyChange,
  cancelWithParentGuard = false,
  formSession = 0,
  onCancel,
  onCreated,
}: {
  isAdmin: boolean
  onDirtyChange?: (dirty: boolean) => void
  cancelWithParentGuard?: boolean
  formSession?: number
  onCancel?: () => void
  onCreated?: (project: Project, formSession: number) => void
}) {
  const navigate = useNavigate()
  const guard = useSubmitGuard()
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [roles, setRoles] = useState<CompanyRole[]>([])
  const [people, setPeople] = useState<User[]>([])
  const [loadError, setLoadError] = useState('')
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const dirty = Object.keys(EMPTY_DRAFT).some(
    (field) =>
      draft[field as keyof ProjectDraft] !==
      EMPTY_DRAFT[field as keyof ProjectDraft],
  )

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    let active = true
    Promise.all([
      listCompanyRoles(),
      isAdmin ? listAllPages<User>('/users') : Promise.resolve([]),
    ])
      .then(([companyRoles, users]) => {
        if (!active) return
        setRoles(companyRoles)
        setPeople(
          users.filter(
            (user) =>
              user.is_active &&
              !user.is_system &&
              !user.is_external_collaborator,
          ),
        )
      })
      .catch((caught: unknown) => {
        if (active) setLoadError(managementErrorMessage(caught))
      })
      .finally(() => {
        if (active) setOptionsLoading(false)
      })
    return () => {
      active = false
    }
  }, [isAdmin])

  function change(field: keyof ProjectDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!guard.enter()) return
    setError('')
    setFieldErrors({})
    setSaving(true)
    const submittedSession = formSession
    const input: ProjectInput = {
      project_code: draft.project_code.trim(),
      name: draft.name.trim(),
      client_name: draft.client_name.trim(),
      site_location: draft.site_location.trim(),
      company_role: draft.company_role,
      planned_start_date: draft.planned_start_date || null,
      planned_completion_date: draft.planned_completion_date || null,
      ...(isAdmin && draft.creator_role_user_id
        ? { creator_role_user_id: draft.creator_role_user_id }
        : {}),
    }
    try {
      const project = await createProject(input)
      if (onCreated) onCreated(project, submittedSession)
      else
        navigate(`/admin/projects/${project.id}`, {
          state: hasDuplicateCodeWarning(project)
            ? { duplicateProjectCode: project.project_code }
            : null,
        })
    } catch (caught) {
      if (caught instanceof HttpError && caught.fields?.length) {
        const mapped = mapFieldErrors(caught.fields, [
          { path: '/project_code', key: 'project_code' },
          { path: '/name', key: 'name' },
          { path: '/client_name', key: 'client_name' },
          { path: '/site_location', key: 'site_location' },
          { path: '/company_role', key: 'company_role' },
        ])
        const messages = Object.fromEntries(
          Object.entries(mapped.errors).map(([key, code]) => [
            key,
            fieldErrorMessage(code),
          ]),
        )
        setFieldErrors(messages)
        setError(mapped.unmatched.length ? managementErrorMessage(caught) : '')
      } else {
        setError(managementErrorMessage(caught))
      }
    } finally {
      guard.leave()
      setSaving(false)
    }
  }

  function cancel() {
    if (cancelWithParentGuard) {
      onCancel?.()
      return
    }
    if (dirty) setConfirmCancel(true)
    else onCancel?.()
  }

  return (
    <form
      className="project-create-form"
      onKeyDown={blockImeEnter}
      onSubmit={submit}
    >
      <h2>新增專案</h2>
      {loadError && <p role="alert">無法載入選項：{loadError}</p>}
      <FormErrorSummary
        errors={[
          ['project_code', 'project-code', '專案代號'],
          ['name', 'project-name', '工程名稱'],
          ['client_name', 'client-name', '業主／委託單位'],
          ['site_location', 'site-location', '整體工程地點'],
          ['company_role', 'company-role', '本公司在這個案子的角色'],
        ].flatMap(([key, fieldId, fieldLabel]) =>
          fieldErrors[key]
            ? [{ fieldId, fieldLabel, message: fieldErrors[key] }]
            : [],
        )}
      />
      {error && <p role="alert">{error}</p>}
      <label>
        <span>本公司在這個案子的角色（必填）</span>
        <select
          aria-invalid={Boolean(fieldErrors.company_role)}
          required
          value={draft.company_role}
          onChange={(event) => change('company_role', event.target.value)}
        >
          {roles.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </select>
        <span className="field-hint">
          會決定報表種類。同工地的另一種角色請另開專案。
        </span>
        {fieldErrors.company_role && (
          <span className="field-error" role="alert">
            {fieldErrors.company_role}
          </span>
        )}
      </label>
      <Field
        id="project-code"
        label="專案代號"
        required
        error={fieldErrors.project_code}
      >
        <Input
          maxLength={32}
          value={draft.project_code}
          onChange={(event) => change('project_code', event.target.value)}
        />
      </Field>
      <Field
        id="project-name"
        label="工程名稱"
        required
        error={fieldErrors.name}
      >
        <Input
          maxLength={128}
          value={draft.name}
          onChange={(event) => change('name', event.target.value)}
        />
      </Field>
      <Field
        id="client-name"
        label="業主／委託單位"
        required
        error={fieldErrors.client_name}
      >
        <Input
          maxLength={128}
          value={draft.client_name}
          onChange={(event) => change('client_name', event.target.value)}
        />
      </Field>
      <Field
        id="site-location"
        label="整體工程地點"
        required
        error={fieldErrors.site_location}
      >
        <Input
          maxLength={256}
          value={draft.site_location}
          onChange={(event) => change('site_location', event.target.value)}
        />
      </Field>
      <Field id="planned-start-date" label="預定開工日">
        <Input
          type="date"
          value={draft.planned_start_date}
          onChange={(event) =>
            change('planned_start_date', event.target.value)
          }
        />
      </Field>
      <Field id="planned-completion-date" label="預定完工日">
        <Input
          type="date"
          value={draft.planned_completion_date}
          onChange={(event) =>
            change('planned_completion_date', event.target.value)
          }
        />
      </Field>
      {isAdmin && (
        <label>
          <span>建立者角色人選（選填）</span>
          <select
            value={draft.creator_role_user_id}
            onChange={(event) =>
              change('creator_role_user_id', event.target.value)
            }
          >
            <option value="">不指定</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name_zh || person.username}（{person.username}）
              </option>
            ))}
          </select>
          <span className="field-hint">不選則不指定建立者角色人選。</span>
        </label>
      )}
      <div className="card-actions">
        {onCancel && (
          <button onClick={cancel} type="button">
            取消
          </button>
        )}
        <button
          className="btn-primary"
          disabled={saving || optionsLoading || Boolean(loadError)}
          type="submit"
        >
          {saving ? '建立中…' : '新增專案'}
        </button>
      </div>
      {confirmCancel && (
        <ConfirmBox
          cancelLabel="保留編輯"
          confirmLabel="捨棄"
          label="未儲存變更"
          onCancel={() => setConfirmCancel(false)}
          onConfirm={() => onCancel?.()}
          variant="danger"
        >
          <p>目前的專案內容尚未儲存，要保留編輯或捨棄？</p>
        </ConfirmBox>
      )}
    </form>
  )
}
