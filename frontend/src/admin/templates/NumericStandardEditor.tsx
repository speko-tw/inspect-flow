import { RequiredMark } from '../../ui/Form'
import type { InspectionPoint } from './api'
import {
  boundField,
  numberFields,
  numberStandard,
  rangeForm,
} from './templateEditorUtils'

type Props = {
  point: InspectionPoint
  pointIndex: number
  /** 錯誤 key 的項次前綴；專案項目編輯改用穩定識別而非索引。 */
  errorPointKey?: string
  errors: Record<string, string>
  updatePoint: (index: number, changes: Partial<InspectionPoint>) => void
  updateNumeric: (
    index: number,
    changes: Partial<NonNullable<InspectionPoint['numeric_standard']>>,
  ) => void
  /** 依 IP-R13，鎖定時不得改判定方式與綁定欄位，內容仍可更正。 */
  structureLocked?: boolean
}

/**
 * 編輯單一查核項次的判定標準：無、文字或數值（TPL-R11、TPL-R13）。
 *
 * 數值標準必須綁定該項次的一個數字實測欄位，單位由該欄位帶入、在此
 * 唯讀顯示（TPL-R17）；錯誤依 `errors` 的 key 顯示在對應欄位旁
 * （TPL-R18）。
 */
export function NumericStandardEditor({
  point,
  pointIndex,
  errorPointKey,
  errors,
  updatePoint,
  updateNumeric,
  structureLocked = false,
}: Props) {
  const inputError = (key: string) => errors[key]
  const index = pointIndex
  const standard = point.numeric_standard
  const key = errorPointKey ?? `point:${index}`
  const numberOptions = numberFields(point)
  // 單位以綁定欄位為準，標準自己的 unit 只是備援；寫入時綁定欄位的
  // unit 為 null、標準的 unit 取自該欄位（TPL-R17）。
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
                    // 項次原本沒有數字欄位時會自動新增一個（TPL-R16），
                    // 焦點移到它的名稱欄；欄位要等這次更新 render 後才
                    // 存在，所以延後一拍再聚焦。
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
                    // 只清除數值標準，實測欄位保留；欄位可以不綁定任何
                    // 標準（TPL-R11）。
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
              <p className="field-error">{inputError(`${key}:text`)}</p>
            )}
          </>
        )}
        {standard && (
          <>
            {numberOptions.length > 1 ? (
              <>
                <label htmlFor={`binding-${index}`}>
                  用來判定的數字欄位 <RequiredMark />
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
                    // 改綁時丟掉舊綁定的持久 id，只留 clientKey 當關聯，
                    // 單位改成新欄位的單位。
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
                className="tpl-hint muted-text"
                data-error-key={`${key}:binding`}
                tabIndex={-1}
              >
                請先在「實測欄位」新增數字欄位。
              </p>
            )}
            {inputError(`${key}:binding`) && (
              <p className="field-error">{inputError(`${key}:binding`)}</p>
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
                      // 非 range 條件不得帶範圍形式與上下限（TPL-R13），
                      // 切換時清成 null；value 與 tolerance 保留，切回
                      // 其他條件時不必重填。range 沿用原形式，沒有則
                      // 預設區間。
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
                      checked={rangeForm(standard) === form}
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
            rangeForm(standard) === 'interval' ? (
              <>
                <label htmlFor={`lower-${index}`}>
                  下限 <RequiredMark />
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
                  {unit && (
                    <span className="tpl-unit-suffix muted-text">{unit}</span>
                  )}
                </div>
                {inputError(`${key}:lower`) && (
                  <p className="field-error">{inputError(`${key}:lower`)}</p>
                )}
                {/* 「下限不能大於上限」是兩欄之間的錯誤，顯示並聚焦在
                    下限欄（TPL-R13）。 */}
                {inputError(`${key}:range`) && (
                  <p className="field-error">{inputError(`${key}:range`)}</p>
                )}
                <label htmlFor={`upper-${index}`}>
                  上限 <RequiredMark />
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
                  {unit && (
                    <span className="tpl-unit-suffix muted-text">{unit}</span>
                  )}
                </div>
                {inputError(`${key}:upper`) && (
                  <p className="field-error">{inputError(`${key}:upper`)}</p>
                )}
              </>
            ) : (
              <>
                <label htmlFor={`value-${index}`}>
                  標準值 <RequiredMark />
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
                  {unit && (
                    <span className="tpl-unit-suffix muted-text">{unit}</span>
                  )}
                </div>
                {inputError(`${key}:value`) && (
                  <p className="field-error">{inputError(`${key}:value`)}</p>
                )}
                {/* TPL-R13：範圍的容許誤差必填、「＝」選填；≤、≥ 只在
                    原本已有誤差值時才顯示。 */}
                {(standard.condition === 'range' ||
                  standard.condition === '=' ||
                  standard.tolerance) && (
                  <>
                    <label htmlFor={`tolerance-${index}`}>
                      容許誤差
                      {standard.condition === 'range' && <RequiredMark />}
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
                      {unit && (
                        <span className="tpl-unit-suffix muted-text">
                          {unit}
                        </span>
                      )}
                    </div>
                    {inputError(`${key}:tolerance`) && (
                      <p className="field-error">
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
            <p className="tpl-hint muted-text">
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
