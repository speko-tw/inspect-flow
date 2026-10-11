import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useParams } from 'react-router'

import { HttpError, isForbidden } from '../../http'
import { mapFieldErrors } from '../../ui/fieldErrors'
import { planningClient, planningErrorMessage } from './api'
import type { PlanningClient, ProjectZone } from './api'
import { useUnsavedNavigationGuard } from './useUnsavedNavigationGuard'

/** 管理專案分區，並依 IP-R10 支援無分區專案的文字地點流程。 */
export default function ProjectZonesPage({
  client = planningClient,
  viewerPermissions,
}: {
  client?: PlanningClient
  viewerPermissions: string[]
}) {
  const { projectId = '' } = useParams()
  const [zones, setZones] = useState<ProjectZone[]>([])
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<ProjectZone | null>(null)
  const [loadedProjectId, setLoadedProjectId] = useState('')
  const loading = loadedProjectId !== projectId
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [nameError, setNameError] = useState(false)
  const [serverNameError, setServerNameError] = useState('')
  const nameInput = useRef<HTMLInputElement>(null)
  const errorMessage = useRef<HTMLParagraphElement>(null)
  const canManage = viewerPermissions.includes('project_zone.manage')
  const hasUnsavedChanges = Boolean(
    canManage && (editing ? name !== editing.name : name.length > 0),
  )
  useUnsavedNavigationGuard(hasUnsavedChanges)

  useEffect(() => {
    if (nameError || serverNameError) nameInput.current?.focus()
  }, [nameError, serverNameError])

  useEffect(() => {
    if (error && !nameError && !serverNameError) errorMessage.current?.focus()
  }, [error, nameError, serverNameError])

  useEffect(() => {
    let active = true
    client.listProjectZones(projectId).then(
      (result) => {
        if (!active) return
        setZones(result)
        setError('')
        setLoadedProjectId(projectId)
      },
      (caught: unknown) => {
        if (!active) return
        setError(
          isForbidden(caught)
            ? '你沒有讀取這個專案分區的權限。'
            : planningErrorMessage(caught),
        )
        setLoadedProjectId(projectId)
      },
    )
    return () => {
      active = false
    }
  }, [client, projectId])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim()) {
      setError('')
      setServerNameError('')
      setNameError(true)
      return
    }
    setBusy(true)
    setError('')
    setNameError(false)
    setServerNameError('')
    setNotice('')
    try {
      if (editing) {
        const updated = await client.renameZone(projectId, editing.id, name)
        setZones((current) =>
          current.map((zone) => (zone.id === updated.id ? updated : zone)),
        )
        setNotice(`已將分區改名為「${updated.name}」。`)
      } else {
        const created = await client.createZone(projectId, name)
        setZones((current) => [...current, created])
        setNotice(`已新增分區「${created.name}」。`)
      }
      setEditing(null)
      setName('')
    } catch (caught) {
      if (
        caught instanceof HttpError &&
        caught.status === 422 &&
        caught.fields?.length
      ) {
        // 只綁定 API 契約中的 /name；其他 pointer 顯示一般錯誤，不猜欄位。
        const mapped = mapFieldErrors(caught.fields, [
          { path: '/name', key: 'zone-name' },
        ])
        const code = mapped.errors['zone-name']
        const messages: Record<string, string> = {
          'field.required': '請填寫此欄位。',
          'field.invalid': '欄位格式不正確，請檢查輸入內容。',
          'field.too_long': '輸入內容太長。',
          'field.too_short': '輸入內容太短。',
          'field.out_of_range': '數值超出允許範圍。',
          'field.duplicate': '此欄位不可重複。',
        }
        if (code) {
          setServerNameError(
            messages[code] ?? '欄位內容不符合規則，請檢查後再試。',
          )
        }
        setError(
          mapped.unmatched.length || !code ? planningErrorMessage(caught) : '',
        )
      } else {
        setError(planningErrorMessage(caught))
      }
    } finally {
      setBusy(false)
    }
  }

  async function remove(zone: ProjectZone) {
    if (!window.confirm(`確定刪除分區「${zone.name}」？`)) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await client.deleteZone(projectId, zone.id)
      setZones((current) => current.filter((item) => item.id !== zone.id))
      setNotice(`已刪除分區「${zone.name}」。`)
    } catch (caught) {
      setError(planningErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="project-zones-heading">
      <h2 id="project-zones-heading">分區</h2>
      <p>
        {/* IP-R10 允許專案零個分區；無分區時任務改填文字地點。 */}
        管理專案內可供任務選擇的地點分區。沒有分區時，可在任務填寫文字地點。
      </p>
      {notice && (
        <p className="notice-success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p ref={errorMessage} role="alert" tabIndex={-1}>
          {error}
        </p>
      )}
      {loading ? <p>載入中…</p> : null}
      {!loading && zones.length === 0 ? <p>尚未設定分區。</p> : null}
      <ul className="named-list">
        {zones.map((zone) => (
          <li className="named-row" key={zone.id}>
            <span className="named-row-name">{zone.name}</span>
            {canManage && (
              <span className="named-row-actions">
                <button
                  className="btn-sm"
                  disabled={busy}
                  onClick={() => {
                    setName(zone.name)
                    setEditing(zone)
                    setError('')
                    setNameError(false)
                    setServerNameError('')
                  }}
                  type="button"
                >
                  重新命名
                </button>
                <button
                  className="btn-sm"
                  disabled={busy}
                  onClick={() => void remove(zone)}
                  type="button"
                >
                  刪除
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <form noValidate onSubmit={(event) => void save(event)}>
          <h3>{editing ? '修改分區' : '新增分區'}</h3>
          <label>
            分區名稱
            <input
              autoFocus={Boolean(editing)}
              aria-describedby={
                nameError || serverNameError
                  ? 'project-zone-name-error'
                  : undefined
              }
              aria-invalid={nameError || Boolean(serverNameError)}
              aria-required="true"
              ref={nameInput}
              maxLength={128}
              onChange={(event) => {
                setName(event.target.value)
                setNameError(false)
                setServerNameError('')
                setError('')
              }}
              data-field="project-zone-name"
              value={name}
            />
          </label>
          {(nameError || serverNameError) && (
            <p className="tpl-field-error" id="project-zone-name-error">
              {nameError ? '請輸入分區名稱。' : serverNameError}
            </p>
          )}
          <button className="btn-primary" disabled={busy} type="submit">
            {editing ? '儲存名稱' : '新增分區'}
          </button>
          {editing && (
            <button
              disabled={busy}
              onClick={() => {
                setEditing(null)
                setName('')
                setError('')
                setNameError(false)
                setServerNameError('')
              }}
              type="button"
            >
              取消
            </button>
          )}
        </form>
      )}
    </section>
  )
}
