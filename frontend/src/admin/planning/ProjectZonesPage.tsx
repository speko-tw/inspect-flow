import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { useParams } from 'react-router'

import { HttpError, isForbidden } from '../../http'
import { ConfirmBox } from '../../ui/ConfirmBox'
import { fieldErrorMessage, mapFieldErrors } from '../../ui/fieldErrors'
import { blockImeEnter, useSubmitGuard } from '../../ui/submitGuard'
import { planningClient, planningErrorMessage } from './api'
import type { PlanningClient, ProjectZone } from './api'
import { UnsavedLeaveBox } from '../../ui/navigation'
import { useUnsavedNavigationGuard } from '../../ui/navigation'

// 業務錯誤碼（非 422 欄位清單）直接對應到名稱欄，與 ADM-R28 的欄旁錯誤一致。
const NAME_FIELD_CODES: ReadonlySet<string> = new Set([
  'project_zone.name_conflict',
  'project_zone.invalid_name',
])

function focusLocalError(message: HTMLParagraphElement | null) {
  if (!message) return
  // #734 T7：錯誤先捲入視野，聚焦時避免瀏覽器再自行捲動。
  const block =
    message.getBoundingClientRect().height > window.innerHeight * 0.8
      ? 'start'
      : 'nearest'
  message.scrollIntoView?.({ block })
  message.focus({ preventScroll: true })
}

/**
 * 依 IP-R10 管理專案分區，並說明無分區時的文字地點流程。
 * 讀取失敗時禁止新增，避免在未知既有分區的情況下重複建立。
 */
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
  const [deleting, setDeleting] = useState<ProjectZone | null>(null)
  const [loadedProjectId, setLoadedProjectId] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const loading = loadedProjectId !== projectId
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [notice, setNotice] = useState('')
  const [nameError, setNameError] = useState(false)
  const [serverNameError, setServerNameError] = useState('')
  const nameInput = useRef<HTMLInputElement>(null)
  const errorMessage = useRef<HTMLParagraphElement>(null)
  const deleteErrorMessage = useRef<HTMLParagraphElement>(null)
  const pageHeading = useRef<HTMLHeadingElement>(null)
  const rowTrigger = useRef<HTMLElement | null>(null)
  const focusRowId = useRef<string | null>(null)
  const focusRowAfterEdit = useRef(false)
  const rowTriggers = useRef(new Map<string, HTMLButtonElement>())
  // Enter 走 requestSubmit() 時，停用的按鈕擋不住第二次送出，連按兩次
  // Enter 會送出兩次並讓第二次變成「名稱重複」；用同步防護擋掉。
  const guard = useSubmitGuard()
  const canManage = viewerPermissions.includes('project_zone.manage')
  const hasUnsavedChanges = Boolean(
    canManage && (editing ? name !== editing.name : name.length > 0),
  )
  const leaveGuard = useUnsavedNavigationGuard(hasUnsavedChanges)

  useEffect(() => {
    if (nameError || serverNameError) nameInput.current?.focus()
  }, [nameError, serverNameError])

  useEffect(() => {
    if (error && !nameError && !serverNameError) {
      focusLocalError(errorMessage.current)
    }
  }, [error, nameError, serverNameError])

  useEffect(() => {
    if (deleteError) focusLocalError(deleteErrorMessage.current)
  }, [deleteError])

  // 進入改名時把焦點放到名稱欄。改名表單掛在該列內、新增表單掛在頁底，
  // 共用同一個 ref；從一列切到另一列時元件不一定重新掛載，autoFocus 不
  // 會再生效，所以要自己移。
  const editingId = editing?.id
  useEffect(() => {
    if (editingId) nameInput.current?.focus()
  }, [editingId])

  // 編輯結束後表單才會收起；等觸發鈕重新掛載再依列 ID 找它，不能沿用
  // 編輯中已卸載的舊 DOM 參照。
  useEffect(() => {
    if (editing || !focusRowAfterEdit.current) return
    focusRowAfterEdit.current = false
    const trigger = focusRowId.current
      ? rowTriggers.current.get(focusRowId.current)
      : null
    focusRowId.current = null
    if (trigger?.isConnected) trigger.focus()
  }, [editing])

  useEffect(() => {
    let active = true
    client.listProjectZones(projectId).then(
      (result) => {
        if (!active) return
        setZones(result)
        setError('')
        setLoadFailed(false)
        setLoadedProjectId(projectId)
      },
      (caught: unknown) => {
        if (!active) return
        // 載入失敗時不能把空陣列當成「尚未設定分區」，也不能讓人新增，
        // 否則會在看不到既有分區的情況下重複建立。
        setZones([])
        setLoadFailed(true)
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
  }, [client, projectId, reloadKey])

  function clearNameErrors() {
    setNameError(false)
    setServerNameError('')
  }

  function cancelEditing() {
    focusRowAfterEdit.current = true
    setEditing(null)
    setName('')
    setError('')
    clearNameErrors()
  }

  function handleNameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // 輸入法選字的 Enter 只是確認選字，不送出。
    if (blockImeEnter(event)) return
    if (event.key === 'Escape') {
      event.preventDefault()
      if (editing) {
        cancelEditing()
      } else {
        // 新增表單常駐；Esc 等同放棄這次輸入。
        setName('')
        setError('')
        clearNameErrors()
      }
    } else if (event.key === 'Enter') {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  function reportWriteError(caught: unknown) {
    if (!(caught instanceof HttpError)) {
      setError(planningErrorMessage(caught))
      return
    }
    if (caught.status === 422 && caught.fields?.length) {
      // 只綁定 API 契約中的 /name；其他 pointer 顯示一般錯誤，不猜欄位。
      const mapped = mapFieldErrors(caught.fields, [
        { path: '/name', key: 'zone-name' },
      ])
      const code = mapped.errors['zone-name']
      if (code) setServerNameError(fieldErrorMessage(code))
      setError(
        mapped.unmatched.length || !code ? planningErrorMessage(caught) : '',
      )
    } else if (caught.code && NAME_FIELD_CODES.has(caught.code)) {
      // 名稱重複（409）等業務錯誤：顯示在名稱欄旁並聚焦（ADM-R28）。
      setServerNameError(planningErrorMessage(caught))
    } else if (isForbidden(caught)) {
      // 這一頁不會因 403 切換成唯讀，所以不能沿用規劃頁「已切換為唯讀」的說法。
      setError('你沒有權限變更這個專案的分區，內容沒有更動。')
    } else {
      setError(planningErrorMessage(caught))
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // ADM-R28：新操作包含欄位驗證，需清掉舊成功提示。
    setNotice('')
    if (!name.trim()) {
      setError('')
      setServerNameError('')
      setNameError(true)
      return
    }
    if (!guard.enter()) return
    setBusy(true)
    setError('')
    clearNameErrors()
    setNotice('')
    try {
      if (editing) {
        const updated = await client.renameZone(projectId, editing.id, name)
        setZones((current) =>
          current.map((zone) => (zone.id === updated.id ? updated : zone)),
        )
        setNotice(`已將分區改名為「${updated.name}」。`)
        focusRowAfterEdit.current = true
      } else {
        const created = await client.createZone(projectId, name)
        setZones((current) => [...current, created])
        setNotice(`已新增分區「${created.name}」。`)
      }
      setEditing(null)
      setName('')
    } catch (caught) {
      reportWriteError(caught)
    } finally {
      guard.leave()
      setBusy(false)
    }
  }

  function closeDelete() {
    const trigger = rowTrigger.current
    setDeleting(null)
    setDeleteError('')
    queueMicrotask(() => {
      if (trigger?.isConnected) trigger.focus()
    })
  }

  async function remove(zone: ProjectZone) {
    setBusy(true)
    setError('')
    setDeleteError('')
    setNotice('')
    try {
      await client.deleteZone(projectId, zone.id)
      setZones((current) => current.filter((item) => item.id !== zone.id))
      setNotice(`已刪除分區「${zone.name}」。`)
      setDeleting(null)
      // 觸發鈕所在的列已經不在了，焦點回到頁面標題。
      queueMicrotask(() => pageHeading.current?.focus())
    } catch (caught) {
      // #734 T7：保留列內確認框，讓錯誤與補救動作留在原處。
      if (isForbidden(caught)) {
        setDeleteError('你沒有權限變更這個專案的分區，內容沒有更動。')
      } else {
        setDeleteError(planningErrorMessage(caught))
      }
    } finally {
      setBusy(false)
    }
  }

  function renderNameForm(isEditing: boolean) {
    const formHeading = isEditing
      ? `修改分區「${editing?.name ?? ''}」`
      : '新增分區'

    return (
      <form
        noValidate
        onKeyDown={blockImeEnter}
        onSubmit={(event) => void save(event)}
      >
        <h3>{formHeading}</h3>
        <label>
          分區名稱
          <input
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
              clearNameErrors()
              setError('')
              setNotice('')
            }}
            onKeyDown={handleNameKeyDown}
            data-field="project-zone-name"
            value={name}
          />
        </label>
        {(nameError || serverNameError) && (
          <p className="field-error" id="project-zone-name-error">
            {nameError ? '請輸入分區名稱。' : serverNameError}
          </p>
        )}
        <button className="btn-primary" disabled={busy} type="submit">
          {isEditing ? '儲存名稱' : '新增分區'}
        </button>
        {isEditing && (
          <button disabled={busy} onClick={cancelEditing} type="button">
            取消
          </button>
        )}
      </form>
    )
  }

  return (
    <section aria-labelledby="project-zones-heading">
      <h2 id="project-zones-heading" ref={pageHeading} tabIndex={-1}>
        分區
      </h2>
      <p>
        {/* IP-R10 允許專案零個分區；無分區時任務改填文字地點。 */}
        管理專案內可供任務選擇的地點分區。沒有分區時，可在任務填寫文字地點。
      </p>
      <UnsavedLeaveBox guard={leaveGuard} />
      {error && (
        <p ref={errorMessage} role="alert" tabIndex={-1}>
          {error}
        </p>
      )}
      {loading ? <p>載入中…</p> : null}
      {!loading && loadFailed ? (
        <button onClick={() => setReloadKey((key) => key + 1)} type="button">
          重新載入
        </button>
      ) : null}
      {!loading && !loadFailed && zones.length === 0 ? (
        <p>尚未設定分區。</p>
      ) : null}
      {notice && (
        <p className="notice-success" role="status">
          {notice}
        </p>
      )}
      <ul className="named-list">
        {zones.map((zone) => (
          <li className="named-row" key={zone.id}>
            {/* 改名表單就在該列內展開，分區多時不必捲到頁面底部才找到它。 */}
            {editing?.id === zone.id ? (
              renderNameForm(true)
            ) : (
              <span className="named-row-name">{zone.name}</span>
            )}
            {canManage && editing?.id !== zone.id && (
              <span className="named-row-actions">
                <button
                  className="btn-sm"
                  ref={(element) => {
                    if (element) rowTriggers.current.set(zone.id, element)
                    else rowTriggers.current.delete(zone.id)
                  }}
                  disabled={busy}
                  onClick={(event) => {
                    rowTrigger.current = event.currentTarget
                    focusRowId.current = zone.id
                    setDeleting(null)
                    setName(zone.name)
                    setEditing(zone)
                    setError('')
                    // ADM-R28：原列改名時清除舊成功提示。
                    setNotice('')
                    clearNameErrors()
                  }}
                  type="button"
                >
                  重新命名
                </button>
                <button
                  className="btn-sm"
                  disabled={busy}
                  onClick={(event) => {
                    rowTrigger.current = event.currentTarget
                    setError('')
                    setDeleteError('')
                    setNotice('')
                    setDeleting(zone)
                  }}
                  type="button"
                >
                  刪除
                </button>
              </span>
            )}
            {canManage && deleting?.id === zone.id && (
              <ConfirmBox
                busy={busy}
                confirmLabel="確認刪除"
                headingLevel={3}
                onCancel={closeDelete}
                onConfirm={() => remove(zone)}
                title={`刪除分區「${zone.name}」？`}
                variant="danger"
              >
                <p>刪除後無法復原；已有任務使用的分區無法刪除。</p>
                {deleteError && (
                  <p ref={deleteErrorMessage} role="alert" tabIndex={-1}>
                    {deleteError}
                  </p>
                )}
              </ConfirmBox>
            )}
          </li>
        ))}
      </ul>
      {canManage &&
        !loading &&
        !loadFailed &&
        !editing &&
        renderNameForm(false)}
    </section>
  )
}
