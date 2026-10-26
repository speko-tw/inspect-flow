import { useEffect, useRef, useState } from 'react'

import type { InspectionPoint, MeasurementField } from './api'
import { RequiredMark } from '../../ui/Form'
import { revealElement } from '../../ui/reveal'
import { ConfirmBox } from '../../ui/ConfirmBox'
import { boundField, localizeField } from './templateEditorUtils'

type Props = {
  point: InspectionPoint
  pointIndex: number
  /** 錯誤 key 的項次前綴；專案項目編輯改用穩定識別而非索引。 */
  errorPointKey?: string
  errors: Record<string, string>
  confirmField: string
  setConfirmField: (value: string) => void
  updateField: (
    pointIndex: number,
    fieldIndex: number,
    changes: Partial<MeasurementField>,
  ) => void
  updatePoint: (index: number, changes: Partial<InspectionPoint>) => void
  /** 依 IP-R13，鎖定時不得增刪欄位或改型別、單位與綁定，只能改名稱。 */
  structureLocked?: boolean
}

/**
 * 編輯單一查核項次的實測欄位（文字或數字）：新增、改名、改型別與單位、
 * 移除（TPL-R11、TPL-R16）。
 *
 * 被數值標準綁定的欄位不能直接移除或改成文字，須先解除綁定；這類主動
 * 操作被拒時，說明顯示在該欄位旁並聚焦（TPL-R17）。
 */
export function MeasurementFieldEditor({
  point,
  pointIndex,
  errorPointKey,
  errors,
  confirmField,
  setConfirmField,
  updateField,
  updatePoint,
  structureLocked = false,
}: Props) {
  // 操作錯誤以欄位的穩定識別當 key，不用陣列位置，增刪重排時錯誤才
  // 不會轉移到另一個欄位（TPL-R17）。
  const [actionErrors, setActionErrors] = useState<
    Record<
      string,
      {
        type?: string
        remove?: string
      }
    >
  >({})
  const binding = boundField(point)
  const bindingKey = binding?.clientKey ?? binding?.client_id ?? binding?.id
  const fieldKeys = point.measurement_fields.map(
    (field) => field.clientKey ?? field.client_id ?? field.id,
  )
  const context = JSON.stringify([bindingKey, fieldKeys])
  const [previousContext, setPreviousContext] = useState(context)
  // TPL-R17：錯誤屬於欄位，不屬於位置；解除綁定即清除，不能重綁後復活。
  if (previousContext !== context) {
    setPreviousContext(context)
    setActionErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([key]) => fieldKeys.includes(key) && key === bindingKey,
        ),
      ),
    )
  }
  const alertRefs = useRef(new Map<string, HTMLElement>())
  const [focusRequest, setFocusRequest] = useState({ key: '', attempt: 0 })
  // 主動操作失敗：先捲入視窗再聚焦，聚焦時不再捲動，避免畫面二次
  // 跳動（TPL-R17、UDS-R18）。
  useEffect(() => {
    if (!focusRequest.attempt) return
    const alert = alertRefs.current.get(focusRequest.key) ?? null
    revealElement(alert)
    alert?.focus({ preventScroll: true })
  }, [focusRequest])

  function showActionError(
    key: string,
    kind: 'type' | 'remove',
    message: string,
  ) {
    setActionErrors({ [key]: { [kind]: message } })
    setFocusRequest((current) => ({
      key: `${key}:${kind}`,
      attempt: current.attempt + 1,
    }))
  }

  function alertRef(key: string, node: HTMLElement | null) {
    if (node) alertRefs.current.set(key, node)
    else alertRefs.current.delete(key)
  }
  return (
    <section className="tpl-point-section" aria-label="要記錄什麼">
      <h4>要記錄什麼</h4>
      <p className="tpl-hint muted-text">沒有實測欄位也可以，例如只要拍照。</p>
      {point.measurement_fields.length === 0 && (
        <p className="tpl-empty-small muted-text">還沒有實測欄位。</p>
      )}
      {point.measurement_fields.map((field, fieldIndex) => {
        const bound = boundField(point) === field
        const pointBase = errorPointKey ?? `point:${pointIndex}`
        const base = `${pointBase}:field:${fieldIndex}`
        const actionKey = String(
          field.clientKey ?? field.client_id ?? field.id,
        )
        const removeField = () => {
          updatePoint(pointIndex, {
            measurement_fields: point.measurement_fields.filter(
              (_row, position) => position !== fieldIndex,
            ),
          })
          setConfirmField('')
        }
        return (
          <div className="tpl-field-card" key={field.clientKey}>
            <label htmlFor={`field-${pointIndex}-${fieldIndex}-name`}>
              欄位名稱 <RequiredMark />
            </label>
            <input
              aria-invalid={Boolean(errors[`${base}:name`])}
              data-error-key={`${base}:name`}
              id={`field-${pointIndex}-${fieldIndex}-name`}
              onChange={(event) =>
                updateField(pointIndex, fieldIndex, {
                  name: event.target.value,
                  nameLinked: false,
                })
              }
              value={field.name}
            />
            {errors[`${base}:name`] && (
              <p className="field-error">{errors[`${base}:name`]}</p>
            )}
            <label htmlFor={`field-${pointIndex}-${fieldIndex}-type`}>
              欄位型別
            </label>
            <select
              aria-invalid={Boolean(errors[`${base}:type`])}
              data-error-key={`${base}:type`}
              disabled={structureLocked}
              id={`field-${pointIndex}-${fieldIndex}-type`}
              onChange={(event) => {
                // 綁定欄位不得改成文字（TPL-R17）：不改值，直接說明原因。
                if (bound && event.target.value !== 'number') {
                  showActionError(
                    actionKey,
                    'type',
                    '這個欄位用於數值標準；請先改綁其他欄位或移除標準。',
                  )
                  return
                }
                setActionErrors((current) => {
                  const next = { ...current }
                  delete next[actionKey]
                  return next
                })
                // 文字欄位不帶單位；改成數字欄位時單位清空，必填
                // （TPL-R11）要使用者自己填。
                updateField(pointIndex, fieldIndex, {
                  field_type: event.target.value as 'text' | 'number',
                  unit: event.target.value === 'text' ? null : '',
                })
              }}
              value={field.field_type}
            >
              <option value="text">文字</option>
              <option value="number">數字</option>
            </select>
            {errors[`${base}:type`] && (
              <p className="field-error">{errors[`${base}:type`]}</p>
            )}
            {actionErrors[actionKey]?.type && (
              <p
                className="field-error"
                role="alert"
                tabIndex={-1}
                ref={(node) => alertRef(`${actionKey}:type`, node)}
              >
                {actionErrors[actionKey]?.type}
              </p>
            )}
            {field.field_type === 'number' && (
              <>
                <label htmlFor={`field-${pointIndex}-${fieldIndex}-unit`}>
                  單位 <RequiredMark />
                </label>
                <input
                  aria-invalid={Boolean(errors[`${base}:unit`])}
                  data-error-key={`${base}:unit`}
                  disabled={structureLocked}
                  id={`field-${pointIndex}-${fieldIndex}-unit`}
                  onChange={(event) =>
                    updateField(pointIndex, fieldIndex, {
                      unit: event.target.value,
                    })
                  }
                  value={field.unit ?? ''}
                />
                {errors[`${base}:unit`] && (
                  <p className="field-error">{errors[`${base}:unit`]}</p>
                )}
              </>
            )}
            {bound && (
              <p className="tpl-hint muted-text">此欄位用於數值標準。</p>
            )}
            {/* 綁定中的欄位不出現移除確認，直接說明原因（TPL-R17）。 */}
            {confirmField === `${pointIndex}:${fieldIndex}` &&
            !structureLocked &&
            !bound ? (
              <ConfirmBox
                confirmLabel="移除欄位"
                label="移除欄位確認"
                onCancel={() => setConfirmField('')}
                onConfirm={removeField}
                variant="danger"
              >
                <p>確定移除「{field.name || '未命名欄位'}」？</p>
              </ConfirmBox>
            ) : (
              <button
                disabled={structureLocked}
                onClick={() => {
                  if (bound) {
                    setConfirmField('')
                    showActionError(
                      actionKey,
                      'remove',
                      '這個欄位仍綁定數值標準，請先解除綁定後再移除。',
                    )
                  } else if (field.name || field.unit) {
                    // 已填內容才要確認；空白的新欄位沒有東西可丟，
                    // 直接移除。
                    setConfirmField(`${pointIndex}:${fieldIndex}`)
                  } else {
                    removeField()
                  }
                }}
                type="button"
              >
                移除欄位
              </button>
            )}
            {bound && actionErrors[actionKey]?.remove && (
              <div
                role="alert"
                tabIndex={-1}
                ref={(node) => alertRef(`${actionKey}:remove`, node)}
              >
                <p className="field-error">
                  {actionErrors[actionKey]?.remove}
                </p>
                <button
                  type="button"
                  onClick={(event) => {
                    // 捷徑：捲到同項次的「判定標準」並聚焦目前選的判定
                    // 方式，讓使用者去解除綁定（TPL-R17）。
                    const standard = event.currentTarget
                      .closest('.tpl-point-section')
                      ?.parentElement?.querySelector<HTMLElement>(
                        '[aria-label="判定標準"]',
                      )
                    standard?.scrollIntoView?.({ block: 'nearest' })
                    standard
                      ?.querySelector<HTMLInputElement>('input:checked')
                      ?.focus()
                  }}
                >
                  前往判定標準
                </button>
              </div>
            )}
          </div>
        )
      })}
      <button
        disabled={structureLocked}
        onClick={() => {
          // 第一個欄位預填項次標題並隨標題同步（TPL-R20）；後續欄位
          // 名稱留白、不預填（TPL-R21）。
          updatePoint(pointIndex, {
            measurement_fields: [
              ...point.measurement_fields,
              {
                ...localizeField({
                  name: point.measurement_fields.length
                    ? ''
                    : point.title.trim(),
                  nameLinked: point.measurement_fields.length === 0,
                  field_type: 'number',
                  unit: '',
                }),
              },
            ],
          })
          // 焦點移到新欄位的名稱（TPL-R21）；新欄位要等這次更新 render
          // 後才存在，所以延後一拍再聚焦。
          window.setTimeout(() => {
            document
              .getElementById(
                `field-${pointIndex}-${point.measurement_fields.length}-name`,
              )
              ?.focus()
          }, 0)
        }}
        type="button"
      >
        新增實測欄位
      </button>
    </section>
  )
}
