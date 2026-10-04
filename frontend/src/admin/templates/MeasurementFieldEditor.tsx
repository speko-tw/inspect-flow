import { useState } from 'react'

import type { InspectionPoint, MeasurementField } from './api'
import { InlineConfirm } from './InlineConfirm'
import { boundField } from './templateEditorUtils'

type Props = {
  point: InspectionPoint
  pointIndex: number
  errors: Record<string, string>
  confirmField: string
  setConfirmField: (value: string) => void
  updateField: (
    pointIndex: number,
    fieldIndex: number,
    changes: Partial<MeasurementField>,
  ) => void
  updatePoint: (index: number, changes: Partial<InspectionPoint>) => void
}

export function MeasurementFieldEditor({
  point,
  pointIndex,
  errors,
  confirmField,
  setConfirmField,
  updateField,
  updatePoint,
}: Props) {
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})
  return (
    <section className="tpl-point-section" aria-label="要記錄什麼">
      <h4>要記錄什麼</h4>
      <p className="tpl-hint">沒有實測欄位也可以，例如只要拍照。</p>
      {point.measurement_fields.length === 0 && (
        <p className="tpl-empty-small">還沒有實測欄位。</p>
      )}
      {point.measurement_fields.map((field, fieldIndex) => {
        const bound = boundField(point) === field
        const base = `point:${pointIndex}:field:${fieldIndex}`
        const removeField = () => {
          updatePoint(pointIndex, {
            measurement_fields: point.measurement_fields.filter(
              (_row, position) => position !== fieldIndex,
            ),
          })
          setConfirmField('')
        }
        return (
          <div className="tpl-field-card" key={field.client_id ?? field.id}>
            <label htmlFor={`field-${pointIndex}-${fieldIndex}-name`}>
              欄位名稱{' '}
              <b aria-hidden="true" className="tpl-required">
                *
              </b>
            </label>
            <input
              aria-invalid={Boolean(errors[`${base}:name`])}
              data-error-key={`${base}:name`}
              id={`field-${pointIndex}-${fieldIndex}-name`}
              onChange={(event) =>
                updateField(pointIndex, fieldIndex, {
                  name: event.target.value,
                })
              }
              value={field.name}
            />
            {errors[`${base}:name`] && (
              <p className="tpl-field-error">{errors[`${base}:name`]}</p>
            )}
            <label htmlFor={`field-${pointIndex}-${fieldIndex}-type`}>
              欄位型別
            </label>
            <select
              id={`field-${pointIndex}-${fieldIndex}-type`}
              onChange={(event) => {
                if (bound && event.target.value !== 'number') {
                  setActionErrors((current) => ({
                    ...current,
                    [`${base}:type`]:
                      '這個欄位用於數值標準；請先改綁其他欄位或移除標準。',
                  }))
                  return
                }
                setActionErrors((current) => {
                  const next = { ...current }
                  delete next[`${base}:type`]
                  return next
                })
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
            {actionErrors[`${base}:type`] && (
              <p className="tpl-field-error" role="alert">
                {actionErrors[`${base}:type`]}
              </p>
            )}
            {field.field_type === 'number' && (
              <>
                <label htmlFor={`field-${pointIndex}-${fieldIndex}-unit`}>
                  單位{' '}
                  <b aria-hidden="true" className="tpl-required">
                    *
                  </b>
                </label>
                <input
                  aria-invalid={Boolean(errors[`${base}:unit`])}
                  data-error-key={`${base}:unit`}
                  id={`field-${pointIndex}-${fieldIndex}-unit`}
                  onChange={(event) =>
                    updateField(pointIndex, fieldIndex, {
                      unit: event.target.value,
                    })
                  }
                  value={field.unit ?? ''}
                />
                {errors[`${base}:unit`] && (
                  <p className="tpl-field-error">{errors[`${base}:unit`]}</p>
                )}
              </>
            )}
            {bound && <p className="tpl-hint">此欄位用於數值標準。</p>}
            {confirmField === `${pointIndex}:${fieldIndex}` ? (
              <InlineConfirm
                confirmLabel="移除欄位"
                onCancel={() => setConfirmField('')}
                onConfirm={removeField}
              >
                確定移除「{field.name || '未命名欄位'}」？
              </InlineConfirm>
            ) : (
              <button
                onClick={() => {
                  if (bound) {
                    setActionErrors((current) => ({
                      ...current,
                      [`${base}:remove`]:
                        '這個欄位用於數值標準；請先改綁其他欄位或移除標準。',
                    }))
                  } else if (field.name || field.unit) {
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
            {actionErrors[`${base}:remove`] && (
              <p className="tpl-field-error" role="alert">
                {actionErrors[`${base}:remove`]}
              </p>
            )}
          </div>
        )
      })}
      <button
        onClick={() =>
          updatePoint(pointIndex, {
            measurement_fields: [
              ...point.measurement_fields,
              {
                client_id: crypto.randomUUID(),
                name: '',
                field_type: 'number',
                unit: '',
              },
            ],
          })
        }
        type="button"
      >
        新增實測欄位
      </button>
    </section>
  )
}
