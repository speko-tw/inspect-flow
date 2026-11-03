import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate, type To } from 'react-router'

import type { HttpFieldError } from '../../../http'
import { ConfirmBox } from '../../../ui/ConfirmBox'
import { fieldErrorMessage, mapFieldErrors } from '../../../ui/fieldErrors'
import { useUnsavedNavigationGuard } from '../../../ui/navigation'
import type { InspectionPoint, TemplateItem } from '../api'
import { validateItemFields } from '../itemFieldValidation'
import {
  blankPoint,
  TEMPLATE_FIELD_ERROR_MESSAGES,
  templateFieldErrorBindings,
} from '../templateEditorUtils'
import { TemplateItemEditor } from '../TemplateItemEditor'
import {
  fromEditorItem,
  photoDraftOf,
  toEditorItem,
  type SuggestionContent,
} from './content'

/** 儲存結果：成功時由編輯器放行離頁並導向；失敗時把訊息留在編輯頁。 */
export type SaveOutcome =
  | { ok: true; to: To; state?: unknown }
  | { ok: false; message?: string; fields?: HttpFieldError[] }

type FocusRequest = { id: number; key: string }

const LEAVE_TEXT = '本次未儲存的改動會遺失；原有修訂與審核紀錄仍會保留。'

/**
 * 在共用項目結構編輯器外加上建議專用的儲存流程（TPL-R32、TPL-R36）：
 * 審核者與重送前一律要求完整合法；提議人保存退回件可保留未完成內容，
 * 重送時才檢查。422 與其他失敗保留草稿與欄位位置，不清空輸入。
 *
 * `nameOnly` 是「修改名稱」捷徑：焦點直達名稱、先收合項次，使用者
 * 之後手動展開不再被強制收合。
 */
export function SuggestionContentEditor({
  content,
  revisionNo,
  strict,
  canResubmit,
  resubmitHint,
  nameOnly = false,
  focusKey,
  contextLabel,
  cancelHref,
  onSave,
}: {
  content: SuggestionContent
  revisionNo: number
  /** 審核者修改待審內容：保存前須通過完整檢查。 */
  strict: boolean
  /** 退回件才有「儲存並重新送審」。 */
  canResubmit: boolean
  /** 還沒有退回後新版、草稿也沒改時，不能重新送審的原因。 */
  resubmitHint: string | null
  nameOnly?: boolean
  focusKey?: string | null
  contextLabel: string
  cancelHref: string
  onSave: (
    content: SuggestionContent,
    submitAfter: boolean,
  ) => Promise<SaveOutcome>
}) {
  const navigate = useNavigate()
  const initial = useMemo(() => toEditorItem(content), [content])
  const initialPhotos = useMemo(() => photoDraftOf(initial), [initial])
  const [title, setTitle] = useState(initial.title)
  const [instruction, setInstruction] = useState(initial.instruction)
  const [points, setPoints] = useState<InspectionPoint[]>(
    initial.inspection_points,
  )
  const [photoDraft, setPhotoDraft] = useState(initialPhotos)
  const [confirmField, setConfirmField] = useState('')
  const [attempted, setAttempted] = useState(Boolean(focusKey))
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [requestError, setRequestError] = useState('')
  const [busy, setBusy] = useState(false)
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(
    focusKey ? { id: 1, key: focusKey } : null,
  )
  const focusId = useRef(focusKey ? 1 : 0)
  const rootRef = useRef<HTMLDivElement>(null)
  const requestErrorRef = useRef<HTMLParagraphElement>(null)

  const baseline = useMemo(
    () =>
      JSON.stringify({
        title: initial.title,
        instruction: initial.instruction,
        points: initial.inspection_points,
        photos: initialPhotos,
      }),
    [initial, initialPhotos],
  )
  const dirty =
    JSON.stringify({ title, instruction, points, photos: photoDraft }) !==
    baseline
  const guard = useUnsavedNavigationGuard(dirty && !busy)

  const draft: TemplateItem = {
    ...initial,
    title,
    instruction,
    inspection_points: points.map((point, index) => ({
      ...point,
      sequence: index + 1,
    })),
  }
  const localErrors = attempted
    ? validateItemFields(draft, photoDraft, { stablePointErrorKeys: true })
    : {}

  useEffect(() => {
    if (!requestError) return
    requestErrorRef.current?.scrollIntoView?.({ block: 'nearest' })
    requestErrorRef.current?.focus({ preventScroll: true })
  }, [requestError])

  function requestFocus(key: string) {
    focusId.current += 1
    setFocusRequest({ id: focusId.current, key })
  }

  function invalidPointIndexes(errors: Record<string, string>): number[] {
    return draft.inspection_points.flatMap((point, index) =>
      Object.keys(errors).some((key) =>
        key.startsWith(`point:${point.clientKey}:`),
      )
        ? [index]
        : [],
    )
  }

  function applyServerFields(fields: HttpFieldError[]) {
    const bindings = templateFieldErrorBindings(
      draft,
      undefined,
      true,
    ).flatMap((binding) => {
      const path = binding.path.replace(
        'measurement_field_client_id',
        'measurement_field_logical_id',
      )
      return [
        { path: `/content${path}`, key: binding.key },
        { path, key: binding.key },
      ]
    })
    const mapped = mapFieldErrors(fields, bindings)
    const messages = Object.fromEntries(
      Object.entries(mapped.errors).map(([key, code]) => [
        key,
        fieldErrorMessage(code, TEMPLATE_FIELD_ERROR_MESSAGES),
      ]),
    )
    setServerErrors(messages)
    const first = Object.keys(messages)[0]
    if (first) requestFocus(first)
    return { messages, unmatched: mapped.unmatched.length > 0 }
  }

  async function run(submitAfter: boolean): Promise<number[] | null> {
    setRequestError('')
    setServerErrors({})
    if (strict || submitAfter) {
      setAttempted(true)
      const invalid = validateItemFields(draft, photoDraft, {
        stablePointErrorKeys: true,
      })
      const first = Object.keys(invalid)[0]
      if (first) {
        requestFocus(first)
        return invalidPointIndexes(invalid)
      }
    }
    setBusy(true)
    try {
      const outcome = await onSave(
        fromEditorItem(draft, photoDraft),
        submitAfter,
      )
      if (outcome.ok) {
        // 已保存：放行這次離頁，避免被自己的未儲存攔截擋下。
        guard.allowNavigation(() =>
          navigate(outcome.to, { state: outcome.state }),
        )
        return null
      }
      if (outcome.fields?.length) {
        const result = applyServerFields(outcome.fields)
        setRequestError(
          outcome.message ??
            (result.unmatched ? '建議未儲存，請檢查欄位內容。' : ''),
        )
        return invalidPointIndexes(result.messages)
      }
      setRequestError(outcome.message ?? '儲存失敗，請稍後再試。')
      return null
    } finally {
      setBusy(false)
    }
  }

  function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    return run(false)
  }

  const resubmitDisabled = canResubmit && !dirty && resubmitHint !== null

  return (
    <div ref={rootRef} className="suggestion-editor">
      {guard.pending && (
        <ConfirmBox
          cancelLabel="繼續編輯"
          confirmLabel="放棄修改"
          headingLevel={3}
          onCancel={guard.stay}
          onConfirm={guard.leave}
          title="放棄未儲存變更"
          variant="danger"
        >
          <p>{LEAVE_TEXT}</p>
        </ConfirmBox>
      )}
      <p className="muted-text" id="suggestion-editor-base">
        目前已存第 {revisionNo} 版；本次修改另存新版本，前版與審核紀錄保留。
      </p>
      <TemplateItemEditor
        initialOpenPoint={nameOnly ? null : 0}
        movePoint={(from, to) => {
          const order = points.map((_point, index) => index)
          ;[order[from], order[to]] = [order[to], order[from]]
          setPoints(order.map((index) => points[index]))
          setPhotoDraft((current) =>
            Object.fromEntries(
              order.map((index, position) => [
                String(position),
                current[String(index)] ?? '1',
              ]),
            ),
          )
          setServerErrors({})
          setConfirmField('')
        }}
        moveField={(pointIndex, from, to) => {
          setPoints((current) =>
            current.map((point, index) => {
              if (index !== pointIndex) return point
              const fields = [...point.measurement_fields]
              ;[fields[from], fields[to]] = [fields[to], fields[from]]
              return { ...point, measurement_fields: fields }
            }),
          )
          setServerErrors({})
        }}
        addPoint={() =>
          setPoints((current) => [
            ...current,
            blankPoint(current.length + 1, { stableClientKey: true }),
          ])
        }
        cancelHref={cancelHref}
        cancelLabel="取消修改"
        clearPointServerErrors={(index) => {
          const key = points[index]?.clientKey
          if (!key) return
          setServerErrors((current) =>
            Object.fromEntries(
              Object.entries(current).filter(
                ([name]) => !name.startsWith(`point:${key}:`),
              ),
            ),
          )
        }}
        confirmField={confirmField}
        contextLabel={contextLabel}
        dirty={dirty}
        errors={{ ...serverErrors, ...localErrors }}
        focusRequest={focusRequest}
        itemDraft={draft}
        mode="edit-item"
        photoDraft={photoDraft}
        readOnly={busy}
        removePoint={(index) => {
          setPoints((current) =>
            current.filter((_point, position) => position !== index),
          )
          setPhotoDraft((current) => {
            const next: Record<string, string> = {}
            for (const [key, value] of Object.entries(current)) {
              const position = Number(key)
              if (position < index) next[key] = value
              if (position > index) next[String(position - 1)] = value
            }
            return next
          })
        }}
        requestError=""
        resetMode={() => {}}
        saveItem={submitForm}
        saveLabel="儲存新版本"
        selected={null}
        setConfirmField={setConfirmField}
        setGuard={() => {}}
        setPhotoDraft={setPhotoDraft}
        stablePointErrorKeys
        systemId=""
        updateDraft={(changes: Partial<TemplateItem>) => {
          if (changes.instruction !== undefined) {
            setInstruction(changes.instruction)
          }
          if (changes.title === undefined) return
          setTitle(changes.title)
          setServerErrors((current) =>
            Object.fromEntries(
              Object.entries(current).filter(([key]) => key !== 'title'),
            ),
          )
        }}
        updateField={(pointIndex, fieldIndex, changes) =>
          setPoints((current) =>
            current.map((point, index) =>
              index !== pointIndex
                ? point
                : {
                    ...point,
                    measurement_fields: point.measurement_fields.map(
                      (field, position) =>
                        position === fieldIndex
                          ? { ...field, ...changes }
                          : field,
                    ),
                  },
            ),
          )
        }
        updateNumeric={(index, changes) =>
          setPoints((current) =>
            current.map((point, position) =>
              position === index
                ? {
                    ...point,
                    numeric_standard: {
                      ...point.numeric_standard!,
                      ...changes,
                    },
                  }
                : point,
            ),
          )
        }
        updatePoint={(index, changes) =>
          setPoints((current) =>
            current.map((point, position) =>
              position === index ? { ...point, ...changes } : point,
            ),
          )
        }
      />
      {requestError && (
        <p
          className="field-error"
          ref={requestErrorRef}
          role="alert"
          tabIndex={-1}
        >
          {requestError}
        </p>
      )}
      <p className="muted-text">
        {strict
          ? '審核中修改須通過欄位檢查；保存之後再回詳情選目的地核准。'
          : '退回件可先保存未完成內容，重新送審時再檢查完整性。'}
      </p>
      {canResubmit && (
        <div className="suggestion-resubmit">
          <button
            aria-describedby="suggestion-resubmit-hint"
            className="btn-primary"
            disabled={busy || resubmitDisabled}
            onClick={() => void run(true)}
            type="button"
          >
            儲存並重新送審
          </button>
          <p className="muted-text" id="suggestion-resubmit-hint">
            {resubmitDisabled
              ? resubmitHint
              : '重新送審前會檢查所有欄位；只儲存可保留未完成內容。'}
          </p>
        </div>
      )}
    </div>
  )
}
