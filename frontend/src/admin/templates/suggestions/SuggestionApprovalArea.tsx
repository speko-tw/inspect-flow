import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, type To } from 'react-router'

import { HttpError } from '../../../http'
import { ConfirmBox } from '../../../ui/ConfirmBox'
import { revealElement } from '../../../ui/reveal'
import {
  getSystemTemplates,
  listTemplateCategories,
  listTemplateSystems,
  type TemplateCategory,
  type TemplateSystem,
} from '../api'
import {
  approveSuggestion,
  returnSuggestion,
  type Expected,
  type SuggestionDetail,
} from './api'
import { completenessErrors, displayTitle } from './content'
import { foldName } from './format'
import { suggestionErrorMessage } from './messages'
import type { SuggestionNavState } from './paths'

const REASON_MAX = 1000

type Target = { category_id: string; system_id: string }

function focusField(element: HTMLElement | null) {
  revealElement(element)
  element?.focus({ preventScroll: true })
}

/**
 * 管理者審核區（TPL-R33）：選目的地後核准入庫，或附原因退回。
 *
 * 目的地在同名、422 與改名存新版之後都保留（TPL-AC42）；選定系統時
 * 即時預警同名，但不阻擋操作，真正的同名拒絕仍以後端 409 為準。
 */
export function SuggestionApprovalArea({
  suggestion,
  expected,
  editTo,
  passState,
  onChanged,
}: {
  suggestion: SuggestionDetail
  expected: () => Expected
  editTo: (query?: string) => To
  passState: SuggestionNavState
  onChanged: (message: string) => Promise<void>
}) {
  const titleId = useId()
  const latest = suggestion.current_revision
  const [categories, setCategories] = useState<TemplateCategory[]>([])
  const [target, setTarget] = useState<Target>(
    passState.target ?? { category_id: '', system_id: '' },
  )
  const [categoryError, setCategoryError] = useState('')
  const [systemError, setSystemError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [incomplete, setIncomplete] = useState<Record<string, string> | null>(
    null,
  )
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const [returning, setReturning] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState('')
  const [returnConfirm, setReturnConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const categoryRef = useRef<HTMLSelectElement>(null)
  const systemRef = useRef<HTMLSelectElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const returnTrigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let active = true
    listTemplateCategories()
      .then((list) => {
        if (active) setCategories(list)
      })
      .catch((caught: unknown) => {
        if (active) setLoadError(suggestionErrorMessage(caught, 'review'))
      })
    return () => {
      active = false
    }
  }, [])

  // 系統清單與同名預警都綁定產生它們的條件，條件一換舊結果立即失效。
  const categoryId = target.category_id
  const [systemsFor, setSystemsFor] = useState<{
    categoryId: string
    list: TemplateSystem[]
  } | null>(null)
  const systems = systemsFor?.categoryId === categoryId ? systemsFor.list : []
  useEffect(() => {
    if (!categoryId) return
    let active = true
    listTemplateSystems(categoryId)
      .then((list) => {
        if (active) setSystemsFor({ categoryId, list })
      })
      .catch((caught: unknown) => {
        if (active) setLoadError(suggestionErrorMessage(caught, 'review'))
      })
    return () => {
      active = false
    }
  }, [categoryId])

  // 目的地或名稱改變時重查同名，只提示不阻擋（核准時後端仍會檢查）。
  const systemId = target.system_id
  const title = latest.content.title
  const checkKey = `${systemId}|${title}`
  const [warnKey, setWarnKey] = useState<string | null>(null)
  useEffect(() => {
    if (!systemId) return
    let active = true
    getSystemTemplates(systemId)
      .then(({ items }) => {
        if (!active) return
        setWarnKey(
          items.some((item) => foldName(item.title) === foldName(title))
            ? checkKey
            : null,
        )
      })
      .catch(() => {
        // 預警讀不到不影響核准；後端仍會擋同名。
      })
    return () => {
      active = false
    }
  }, [systemId, title, checkKey])
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const conflict: 'warn' | 'failed' | null =
    failedKey === checkKey
      ? 'failed'
      : systemId && warnKey === checkKey
        ? 'warn'
        : null

  function chooseCategory(id: string) {
    setTarget({ category_id: id, system_id: '' })
    setCategoryError('')
    setSystemError('')
  }

  function chooseSystem(id: string) {
    setTarget((current) => ({ ...current, system_id: id }))
    setSystemError('')
  }

  const categoryName = categories.find((c) => c.id === target.category_id)
  const systemName = systems.find((s) => s.id === target.system_id)

  function startApprove(event: FormEvent) {
    event.preventDefault()
    setConfirmError('')
    if (!target.category_id) {
      setCategoryError('請選擇目標工程類別')
      focusField(categoryRef.current)
      return
    }
    if (!target.system_id) {
      setSystemError('請選擇目標系統')
      focusField(systemRef.current)
      return
    }
    const issues = completenessErrors(latest.content)
    if (Object.keys(issues).length > 0) {
      setIncomplete(issues)
      return
    }
    setIncomplete(null)
    if (conflict) {
      setFailedKey(checkKey)
      focusField(titleRef.current)
      return
    }
    setConfirming(true)
  }

  async function approve() {
    setBusy(true)
    setConfirmError('')
    try {
      await approveSuggestion(suggestion.id, target, expected())
      setConfirming(false)
      await onChanged(
        `已核准第 ${latest.revision_no} 版並新增一筆範本；原建議與來源項目保留。`,
      )
    } catch (caught) {
      if (
        caught instanceof HttpError &&
        caught.code === 'template.name_conflict'
      ) {
        // 同名：保持待審、目的地與草稿，回到名稱欄請使用者修改。
        setConfirming(false)
        setFailedKey(checkKey)
        window.setTimeout(() => focusField(titleRef.current), 0)
        return
      }
      if (caught instanceof HttpError && caught.status === 422) {
        const paths = (caught.fields ?? []).map((field) => field.path)
        setConfirming(false)
        if (paths.includes('/category_id')) {
          setCategoryError('請選擇有效的工程類別')
          focusField(categoryRef.current)
        } else if (paths.includes('/system_id')) {
          setSystemError('此系統不屬於所選類別，請重新選擇')
          focusField(systemRef.current)
        } else {
          setConfirmError(suggestionErrorMessage(caught, 'review'))
          setConfirming(true)
        }
        return
      }
      setConfirmError(suggestionErrorMessage(caught, 'review'))
    } finally {
      setBusy(false)
    }
  }

  function startReturn(event: FormEvent) {
    event.preventDefault()
    const trimmed = reason.trim()
    if (!trimmed || trimmed.length > REASON_MAX) {
      setReasonError(
        !trimmed ? '請填寫退回原因' : `退回原因不得超過 ${REASON_MAX} 字元`,
      )
      focusField(reasonRef.current)
      return
    }
    setReasonError('')
    setReturnConfirm(true)
  }

  async function sendReturn() {
    setBusy(true)
    setConfirmError('')
    try {
      await returnSuggestion(suggestion.id, reason.trim(), expected())
      setReturnConfirm(false)
      await onChanged(
        `已退回第 ${latest.revision_no} 版，原因與審核人已保存。`,
      )
    } catch (caught) {
      if (caught instanceof HttpError && caught.status === 422) {
        // 原因被後端判定不合法：就近顯示並保留已填內容與 PENDING。
        setReturnConfirm(false)
        setReasonError(
          reason.trim().length > REASON_MAX
            ? `退回原因不得超過 ${REASON_MAX} 字元`
            : '請填寫退回原因',
        )
        window.setTimeout(() => focusField(reasonRef.current), 0)
        return
      }
      setConfirmError(suggestionErrorMessage(caught, 'review'))
    } finally {
      setBusy(false)
    }
  }

  const conflictId = `${titleId}-conflict`
  const describedBy = conflict
    ? `${titleId}-hint ${conflictId}`
    : `${titleId}-hint`
  return (
    <section aria-label="核准與退回" id="suggestion-approval-area">
      <h2>審核最新第 {latest.revision_no} 版</h2>
      {loadError && <p role="alert">{loadError}</p>}
      <form noValidate onSubmit={startApprove}>
        <label htmlFor={titleId}>入庫名稱（第 {latest.revision_no} 版）</label>
        <input
          aria-describedby={describedBy}
          aria-invalid={conflict === 'failed' || undefined}
          id={titleId}
          readOnly
          ref={titleRef}
          value={title}
        />
        <p className="muted-text" id={`${titleId}-hint`}>
          名稱要修改時，先按「修改建議內容」並儲存新版本，不會直接覆蓋既有範本。
        </p>
        {conflict && (
          <div
            className="field-error"
            id={conflictId}
            role={conflict === 'failed' ? 'alert' : 'status'}
          >
            <p>
              此系統已有同名範本「{displayTitle(title)}」。
              {conflict === 'failed'
                ? '本次沒有新增。'
                : '核准前請修改名稱或改選系統。'}
            </p>
            <Link
              className="btn btn-sm"
              state={{ ...passState, target }}
              to={editTo('?rename=1&focus=title')}
            >
              修改名稱
            </Link>
          </div>
        )}
        <div className="suggestion-inline-fields">
          <div>
            <label htmlFor={`${titleId}-category`}>目標工程類別 *</label>
            <select
              aria-describedby={`${titleId}-category-error`}
              aria-invalid={Boolean(categoryError) || undefined}
              id={`${titleId}-category`}
              onChange={(event) => chooseCategory(event.target.value)}
              ref={categoryRef}
              value={target.category_id}
            >
              <option value="">請選擇工程類別</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <p
              className="field-error"
              id={`${titleId}-category-error`}
              role={categoryError ? 'alert' : undefined}
            >
              {categoryError}
            </p>
          </div>
          <div>
            <label htmlFor={`${titleId}-system`}>目標系統 *</label>
            <select
              aria-describedby={`${titleId}-system-error`}
              aria-invalid={Boolean(systemError) || undefined}
              disabled={!target.category_id}
              id={`${titleId}-system`}
              onChange={(event) => chooseSystem(event.target.value)}
              ref={systemRef}
              value={target.system_id}
            >
              <option value="">請選擇系統</option>
              {systems.map((system) => (
                <option key={system.id} value={system.id}>
                  {system.name}
                </option>
              ))}
            </select>
            <p
              className="field-error"
              id={`${titleId}-system-error`}
              role={systemError ? 'alert' : undefined}
            >
              {systemError}
            </p>
          </div>
        </div>
        {incomplete && (
          <section className="suggestion-error-summary" role="alert">
            <h3>內容尚未完整，不能核准</h3>
            <ul>
              {Object.entries(incomplete).map(([key, message]) => (
                <li key={key}>
                  <Link
                    state={{ ...passState, target }}
                    to={editTo(`?focus=${encodeURIComponent(key)}`)}
                  >
                    {message}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="suggestion-actions">
          <button className="btn-primary" disabled={busy} type="submit">
            核准入庫
          </button>
          <button
            className="btn-danger-outline"
            disabled={busy}
            onClick={() => setReturning(true)}
            ref={returnTrigger}
            type="button"
          >
            附原因退回
          </button>
        </div>
        {confirming && (
          <ConfirmBox
            busy={busy}
            confirmLabel="確認核准入庫"
            headingLevel={3}
            onCancel={() => setConfirming(false)}
            onConfirm={approve}
            title="確認核准入庫"
          >
            <p>
              將第 {latest.revision_no} 版「{displayTitle(title)}
              」建立為「{categoryName?.name}／{systemName?.name}
              」的一筆獨立範本；不覆蓋既有範本，也不改來源專案。
            </p>
            {confirmError && <p role="alert">{confirmError}</p>}
          </ConfirmBox>
        )}
      </form>
      {returning && (
        <form noValidate onSubmit={startReturn}>
          <h3>退回第 {latest.revision_no} 版</h3>
          <label htmlFor={`${titleId}-reason`}>退回原因 *</label>
          <textarea
            aria-describedby={`${titleId}-reason-hint ${titleId}-reason-error`}
            aria-invalid={Boolean(reasonError) || undefined}
            id={`${titleId}-reason`}
            onChange={(event) => {
              setReason(event.target.value)
              setReasonError('')
            }}
            ref={reasonRef}
            value={reason}
          />
          <p className="muted-text" id={`${titleId}-reason-hint`}>
            1～{REASON_MAX} 字元，請說明要修改的地方。
          </p>
          <p
            className="field-error"
            id={`${titleId}-reason-error`}
            role={reasonError ? 'alert' : undefined}
          >
            {reasonError}
          </p>
          <div className="suggestion-actions">
            <button
              onClick={() => {
                setReturning(false)
                setReturnConfirm(false)
                setReason('')
                setReasonError('')
                window.setTimeout(() => returnTrigger.current?.focus(), 0)
              }}
              type="button"
            >
              取消退回
            </button>
            <button disabled={busy} type="submit">
              退回建議
            </button>
          </div>
          {returnConfirm && (
            <ConfirmBox
              busy={busy}
              confirmLabel="確認退回"
              headingLevel={3}
              onCancel={() => setReturnConfirm(false)}
              onConfirm={sendReturn}
              title="確認退回建議"
              variant="danger"
            >
              <p>
                退回第 {latest.revision_no} 版「{displayTitle(title)}」。
                {suggestion.proposer_name}將看到原因：{reason.trim()}
                。原版及本次原因會保留，可修改後重送。
              </p>
              {confirmError && <p role="alert">{confirmError}</p>}
            </ConfirmBox>
          )}
        </form>
      )}
    </section>
  )
}
