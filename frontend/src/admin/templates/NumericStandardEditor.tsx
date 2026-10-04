import type { InspectionPoint } from './api'
import {
  boundField,
  numberFields,
  numberStandard,
} from './templateEditorUtils'

type Props = {
  point: InspectionPoint
  pointIndex: number
  errors: Record<string, string>
  updatePoint: (index: number, changes: Partial<InspectionPoint>) => void
  updateNumeric: (
    index: number,
    changes: Partial<NonNullable<InspectionPoint['numeric_standard']>>,
  ) => void
}

export function NumericStandardEditor({
  point,
  pointIndex,
  errors,
  updatePoint,
  updateNumeric,
}: Props) {
  const inputError = (key: string) => errors[key]
  const index = pointIndex
  const standard = point.numeric_standard
  const key = `point:${index}`
  const numberOptions = numberFields(point)
  return (
    <section className="tpl-point-section" aria-label="判定標準">
      <h4>判定標準</h4>
      <div className="tpl-point-section-body">
        <label htmlFor={`standard-kind-${index}`}>標準類型</label>
        <select
          id={`standard-kind-${index}`}
          onChange={(event) => {
            const kind = event.target.value
            if (kind === 'numeric') {
              const next = numberStandard(point)
              updatePoint(index, next)
              if (!numberFields(point).length) {
                window.setTimeout(() => {
                  document
                    .getElementById(
                      `field-${index}-` +
                        `${next.measurement_fields.length - 1}-` +
                        'name',
                    )
                    ?.focus()
                }, 0)
              }
            } else if (kind === 'text') {
              updatePoint(index, {
                numeric_standard: null,
                text_standard: point.text_standard ?? { text: '' },
              })
            } else {
              updatePoint(index, {
                numeric_standard: null,
                text_standard: null,
              })
            }
          }}
          value={standard ? 'numeric' : point.text_standard ? 'text' : 'none'}
        >
          <option value="none">不設定標準</option>
          <option value="text">文字標準</option>
          <option value="numeric">數值標準</option>
        </select>
        {point.text_standard && (
          <>
            <label htmlFor={`standard-text-${index}`}>標準文字</label>
            <textarea
              id={`standard-text-${index}`}
              onChange={(event) =>
                updatePoint(index, {
                  text_standard: { text: event.target.value },
                })
              }
              value={point.text_standard.text}
            />
          </>
        )}
        {standard && (
          <>
            {numberOptions.length > 1 ? (
              <>
                <label htmlFor={`binding-${index}`}>
                  用來判定的數字欄位{' '}
                  <b aria-hidden="true" className="tpl-required">
                    *
                  </b>
                </label>
                <select
                  aria-invalid={Boolean(inputError(`${key}:binding`))}
                  data-error-key={`${key}:binding`}
                  id={`binding-${index}`}
                  onChange={(event) => {
                    const field = numberOptions.find(
                      (row) =>
                        (row.client_id ?? row.id) === event.target.value,
                    )
                    updateNumeric(index, {
                      measurement_field_id: undefined,
                      measurement_field_client_id: event.target.value,
                      unit: field?.unit ?? '',
                    })
                  }}
                  value={
                    standard.measurement_field_client_id ??
                    standard.measurement_field_id ??
                    ''
                  }
                >
                  <option value="">請選擇…</option>
                  {numberOptions.map((field) => (
                    <option
                      key={field.client_id ?? field.id}
                      value={field.client_id ?? field.id}
                    >
                      {field.name || '未命名欄位'}
                    </option>
                  ))}
                </select>
              </>
            ) : numberOptions.length === 1 ? (
              <p className="tpl-bound-note">
                使用：
                <strong>{numberOptions[0].name || '尚未命名'}</strong>（
                {numberOptions[0].unit || '單位未填'}）
              </p>
            ) : (
              <p className="tpl-hint">請先在「實測欄位」新增數字欄位。</p>
            )}
            {inputError(`${key}:binding`) && (
              <p className="tpl-field-error">{inputError(`${key}:binding`)}</p>
            )}
            <label htmlFor={`condition-${index}`}>條件</label>
            <select
              id={`condition-${index}`}
              onChange={(event) => {
                const condition = event.target.value as
                  '<=' | '>=' | '=' | 'range'
                updateNumeric(index, {
                  condition,
                  range_form:
                    condition === 'range'
                      ? (standard.range_form ?? 'interval')
                      : null,
                  lower_bound:
                    condition === 'range'
                      ? (standard.lower_bound ?? '')
                      : null,
                  upper_bound:
                    condition === 'range'
                      ? (standard.upper_bound ?? '')
                      : null,
                  value: standard.value ?? '',
                  tolerance: standard.tolerance ?? '',
                })
              }}
              value={standard.condition}
            >
              <option value="<=">≤（不得超過標準值）</option>
              <option value=">=">≥（不得低於標準值）</option>
              <option value="=">＝（等於標準值）</option>
              <option value="range">範圍</option>
            </select>
            {standard.condition === 'range' && (
              <>
                <label htmlFor={`range-form-${index}`}>範圍形式</label>
                <select
                  id={`range-form-${index}`}
                  onChange={(event) =>
                    updateNumeric(index, {
                      range_form: event.target.value as
                        'interval' | 'tolerance',
                    })
                  }
                  value={standard.range_form ?? 'interval'}
                >
                  <option value="interval">區間（下限～上限）</option>
                  <option value="tolerance">標準值 ± 容許誤差</option>
                </select>
              </>
            )}
            {standard.condition === 'range' &&
            (standard.range_form ?? 'interval') === 'interval' ? (
              <>
                <label htmlFor={`lower-${index}`}>
                  下限{' '}
                  <b aria-hidden="true" className="tpl-required">
                    *
                  </b>
                </label>
                <input
                  aria-invalid={Boolean(
                    inputError(`${key}:lower`) || inputError(`${key}:range`),
                  )}
                  data-error-key={`${key}:lower`}
                  id={`lower-${index}`}
                  inputMode="decimal"
                  onChange={(event) =>
                    updateNumeric(index, {
                      lower_bound: event.target.value,
                    })
                  }
                  value={standard.lower_bound ?? ''}
                />
                {inputError(`${key}:lower`) && (
                  <p className="tpl-field-error">
                    {inputError(`${key}:lower`)}
                  </p>
                )}
                {inputError(`${key}:range`) && (
                  <p className="tpl-field-error">
                    {inputError(`${key}:range`)}
                  </p>
                )}
                <label htmlFor={`upper-${index}`}>
                  上限{' '}
                  <b aria-hidden="true" className="tpl-required">
                    *
                  </b>
                </label>
                <input
                  aria-invalid={Boolean(inputError(`${key}:upper`))}
                  data-error-key={`${key}:upper`}
                  id={`upper-${index}`}
                  inputMode="decimal"
                  onChange={(event) =>
                    updateNumeric(index, {
                      upper_bound: event.target.value,
                    })
                  }
                  value={standard.upper_bound ?? ''}
                />
                {inputError(`${key}:upper`) && (
                  <p className="tpl-field-error">
                    {inputError(`${key}:upper`)}
                  </p>
                )}
              </>
            ) : (
              <>
                <label htmlFor={`value-${index}`}>
                  標準值{' '}
                  <b aria-hidden="true" className="tpl-required">
                    *
                  </b>
                </label>
                <input
                  aria-invalid={Boolean(inputError(`${key}:value`))}
                  data-error-key={`${key}:value`}
                  id={`value-${index}`}
                  inputMode="decimal"
                  onChange={(event) =>
                    updateNumeric(index, {
                      value: event.target.value,
                    })
                  }
                  value={standard.value ?? ''}
                />
                {inputError(`${key}:value`) && (
                  <p className="tpl-field-error">
                    {inputError(`${key}:value`)}
                  </p>
                )}
                {(standard.condition === 'range' || standard.tolerance) && (
                  <>
                    <label htmlFor={`tolerance-${index}`}>
                      容許誤差{' '}
                      <b aria-hidden="true" className="tpl-required">
                        *
                      </b>
                    </label>
                    <input
                      aria-invalid={Boolean(inputError(`${key}:tolerance`))}
                      data-error-key={`${key}:tolerance`}
                      id={`tolerance-${index}`}
                      inputMode="decimal"
                      onChange={(event) =>
                        updateNumeric(index, {
                          tolerance: event.target.value,
                        })
                      }
                      value={standard.tolerance ?? ''}
                    />
                    {inputError(`${key}:tolerance`) && (
                      <p className="tpl-field-error">
                        {inputError(`${key}:tolerance`)}
                      </p>
                    )}
                  </>
                )}
              </>
            )}
            <p className="tpl-bound-note">
              標準單位：
              {boundField(point)?.unit || standard.unit || '單位未填'}
              （由綁定欄位帶入）
            </p>
            <p className="tpl-hint">
              {standard.condition === 'range'
                ? '量測值要落在一段範圍內。'
                : '量測值依所選條件與標準值判定。'}
            </p>
          </>
        )}
      </div>
    </section>
  )
}
