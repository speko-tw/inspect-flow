import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'

import { ConfirmBox } from '../../ui/ConfirmBox'
import type { User } from '../api'
import { listAllPages, managementErrorMessage } from '../api'
import { FormErrorSummary, FormField, FormGroup } from '../../components'
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

// 表單草稿：日期與建立者角色人選用字串保存（輸入框的值）。送出時
// 日期轉成 null；建立者角色人選沒選就不送該欄位。
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

/**
 * ADM-R32：開設專案；Admin 可選填建立者角色人選。
 *
 * - `cancelWithParentGuard`：父層已負責未儲存變更的離頁確認時為真，
 *   取消直接交給 `onCancel`，不再自己跳確認框（避免問兩次）。
 * - `formSession`／`onCreated`：送出時記下表單代號並隨結果回傳，父層
 *   據此判斷回應回來時表單是否已被關閉或換掉（ADM-R15）。
 */
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
  const requestErrorRef = useRef<HTMLParagraphElement | null>(null)
  const dirty = Object.keys(EMPTY_DRAFT).some(
    (field) =>
      draft[field as keyof ProjectDraft] !==
      EMPTY_DRAFT[field as keyof ProjectDraft],
  )

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    if (!error || !requestErrorRef.current) return
    // #734 T7：一般送出錯誤置於按鈕前並聚焦，不捲回頁面頂端。
    const message = requestErrorRef.current
    const block =
      message.getBoundingClientRect().height > window.innerHeight * 0.8
        ? 'start'
        : 'nearest'
    message.scrollIntoView?.({ block })
    message.focus({ preventScroll: true })
  }, [error])

  useEffect(() => {
    let active = true
    Promise.all([
      listCompanyRoles(),
      // 只有 Admin 能列全部人員（非 Admin 呼叫 GET /users 會 403），也
      // 只有 Admin 能指定建立者角色人選（DOM-R65）。
      isAdmin ? listAllPages<User>('/users') : Promise.resolve([]),
    ])
      .then(([companyRoles, users]) => {
        if (!active) return
        setRoles(companyRoles)
        // 建立者角色人選限啟用、非系統帳號、非外部協作人員（DOM-R65、
        // DOM-R71）；後端同樣會檢查。
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
      // 非 Admin 開專案自己就是建立者；帶這個欄位後端會回 422
      // （DOM-R65），所以只有 Admin 且有選人時才送。
      ...(isAdmin && draft.creator_role_user_id
        ? { creator_role_user_id: draft.creator_role_user_id }
        : {}),
    }
    try {
      const project = await createProject(input)
      if (onCreated) onCreated(project, submittedSession)
      else
        navigate(`/projects/${project.id}`, {
          state: hasDuplicateCodeWarning(project)
            ? { duplicateProjectCode: project.project_code }
            : null,
        })
    } catch (caught) {
      // 帶欄位指標的 422 顯示在對應欄位旁；對不上欄位的錯誤才放在
      // 表單一般訊息區，不讓錯誤只剩一句通用說明。
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
      <FormGroup title="專案資料">
        <FormField
          id="company-role"
          label="本公司在這個案子的角色"
          required
          description="會決定報表種類。同工地的另一種角色請另開專案。"
          error={fieldErrors.company_role}
        >
          {(control) => (
            <select
              {...control}
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
          )}
        </FormField>
        <FormField
          id="project-code"
          label="專案代號"
          required
          error={fieldErrors.project_code}
        >
          {(control) => (
            <Input
              {...control}
              maxLength={32}
              required
              value={draft.project_code}
              onChange={(event) => change('project_code', event.target.value)}
            />
          )}
        </FormField>
        <FormField
          id="project-name"
          label="工程名稱"
          required
          error={fieldErrors.name}
        >
          {(control) => (
            <Input
              {...control}
              maxLength={128}
              required
              value={draft.name}
              onChange={(event) => change('name', event.target.value)}
            />
          )}
        </FormField>
        <FormField
          id="client-name"
          label="業主／委託單位"
          required
          error={fieldErrors.client_name}
        >
          {(control) => (
            <Input
              {...control}
              maxLength={128}
              required
              value={draft.client_name}
              onChange={(event) => change('client_name', event.target.value)}
            />
          )}
        </FormField>
        <FormField
          id="site-location"
          label="整體工程地點"
          required
          error={fieldErrors.site_location}
        >
          {(control) => (
            <Input
              {...control}
              maxLength={256}
              required
              value={draft.site_location}
              onChange={(event) => change('site_location', event.target.value)}
            />
          )}
        </FormField>
        <FormField id="planned-start-date" label="預定開工日">
          {(control) => (
            <Input
              {...control}
              type="date"
              value={draft.planned_start_date}
              onChange={(event) =>
                change('planned_start_date', event.target.value)
              }
            />
          )}
        </FormField>
        <FormField id="planned-completion-date" label="預定完工日">
          {(control) => (
            <Input
              {...control}
              type="date"
              value={draft.planned_completion_date}
              onChange={(event) =>
                change('planned_completion_date', event.target.value)
              }
            />
          )}
        </FormField>
        {isAdmin && (
          <FormField
            id="creator-role-user"
            label="建立者角色人選"
            description="不選則不指定建立者角色人選。"
          >
            {(control) => (
              <select
                {...control}
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
            )}
          </FormField>
        )}
      </FormGroup>
      {error && (
        <p ref={requestErrorRef} role="alert" tabIndex={-1}>
          {error}
        </p>
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
