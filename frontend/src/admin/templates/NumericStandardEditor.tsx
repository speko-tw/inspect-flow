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
  structureLocked?: boolean
}

export function NumericStandardEditor({
  point,
  pointIndex,
  errors,
  updatePoint,
  updateNumeric,
  structureLocked = false,
}: Props) {
  const inputError = (key: string) => errors[key]
  const index = pointIndex
  const standard = point.numeric_standard
  const key = `point:${index}`
  const numberOptions = numberFields(point)
  const unit = boundField(point)?.unit || standard?.unit || ''
  return (
    <section className="tpl-point-section" aria-label="判定標準">
      <h4>判定標準</h4>
      <div className="tpl-point-section-body">
        <fieldset className="tpl-radio-group">
          <legend>判定方式</legend>
          {[
            ['none', '無'],
            ['text', '文字'],
            ['numeric', '數值'],
          ].map(([kind, label]) => (
            <label className="tpl-radio-option" key={kind}>
              <input
                disabled={structureLocked}
                checked={
                  (standard
                    ? 'numeric'
                    : point.text_standard
                      ? 'text'
                      : 'none') === kind
                }
                name={`standard-kind-${index}`}
                onChange={() => {
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
                type="radio"
                value={kind}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {point.text_standard && (
          <>
            <label htmlFor={`standard-text-${index}`}>標準文字</label>
            <textarea
              aria-invalid={Boolean(inputError(`${key}:text`))}
              data-error-key={`${key}:text`}
              id={`standard-text-${index}`}
              onChange={(event) =>
                updatePoint(index, {
                  text_standard: { text: event.target.value },
                })
              }
              value={point.text_standard.text}
            />
            {inputError(`${key}:text`) && (
              <p className="tpl-field-error">{inputError(`${key}:text`)}</p>
            )}
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
                  disabled={structureLocked}
                  id={`binding-${index}`}
                  onChange={(event) => {
                    const field = numberOptions.find(
                      (row) => row.clientKey === event.target.value,
                    )
                    updateNumeric(index, {
                      measurement_field_id: undefined,
                      measurement_field_client_id: undefined,
                      measurement_field_client_key: event.target.value,
                      unit: field?.unit ?? '',
                    })
                  }}
                  value={standard.measurement_field_client_key ?? ''}
                >
                  <option value="">請選擇…</option>
                  {numberOptions.map((field) => (
                    <option key={field.clientKey} value={field.clientKey}>
                      {field.name || '未命名欄位'}
                    </option>
                  ))}
                </select>
              </>
            ) : numberOptions.length === 1 ? (
              <p
                className="tpl-bound-note"
                data-error-key={`${key}:binding`}
                tabIndex={-1}
              >
                使用：
                <strong>{numberOptions[0].name || '尚未命名'}</strong>（
                {numberOptions[0].unit || '單位未填'}）
              </p>
            ) : (
              <p
                className="tpl-hint"
                data-error-key={`${key}:binding`}
                tabIndex={-1}
              >
                請先在「實測欄位」新增數字欄位。
              </p>
            )}
            {inputError(`${key}:binding`) && (
              <p className="tpl-field-error">{inputError(`${key}:binding`)}</p>
            )}
            <fieldset className="tpl-radio-group">
              <legend>條件</legend>
              {[
                ['range', '範圍'],
                ['<=', '≤'],
                ['>=', '≥'],
                ['=', '＝'],
              ].map(([condition, label]) => (
                <label className="tpl-radio-option" key={condition}>
                  <input
                    checked={standard.condition === condition}
                    name={`condition-${index}`}
                    onChange={() => {
                      const selected = condition as '<=' | '>=' | '=' | 'range'
                      updateNumeric(index, {
                        condition: selected,
                        range_form:
                          selected === 'range'
                            ? (standard.range_form ?? 'interval')
                            : null,
                        lower_bound:
                          selected === 'range'
                            ? (standard.lower_bound ?? '')
                            : null,
                        upper_bound:
                          selected === 'range'
                            ? (standard.upper_bound ?? '')
                            : null,
                        value: standard.value ?? '',
                        tolerance: standard.tolerance ?? '',
                      })
                    }}
                    type="radio"
                    value={condition}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            {standard.condition === 'range' && (
              <fieldset className="tpl-radio-group">
                <legend>範圍形式</legend>
                {[
                  ['interval', '區間（下限～上限）'],
                  ['tolerance', '標準值 ± 容許誤差'],
                ].map(([form, label]) => (
                  <label className="tpl-radio-option" key={form}>
                    <input
                      checked={(standard.range_form ?? 'interval') === form}
                      name={`range-form-${index}`}
                      onChange={() =>
                        updateNumeric(index, {
                          range_form: form as 'interval' | 'tolerance',
                        })
                      }
                      type="radio"
                      value={form}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
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
                <div className="tpl-input-with-unit">
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
                  {unit && <span className="tpl-unit-suffix">{unit}</span>}
                </div>
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
                <div className="tpl-input-with-unit">
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
                  {unit && <span className="tpl-unit-suffix">{unit}</span>}
                </div>
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
                <div className="tpl-input-with-unit">
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
                  {unit && <span className="tpl-unit-suffix">{unit}</span>}
                </div>
                {inputError(`${key}:value`) && (
                  <p className="tpl-field-error">
                    {inputError(`${key}:value`)}
                  </p>
                )}
                {(standard.condition === 'range' ||
                  standard.condition === '=' ||
                  standard.tolerance) && (
                  <>
                    <label htmlFor={`tolerance-${index}`}>
                      容許誤差
                      {standard.condition === 'range' && (
                        <b aria-hidden="true" className="tpl-required">
                          {' *'}
                        </b>
                      )}
                      {standard.condition === '=' && '（選填）'}
                    </label>
                    <div className="tpl-input-with-unit">
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
                      {unit && <span className="tpl-unit-suffix">{unit}</span>}
                    </div>
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
