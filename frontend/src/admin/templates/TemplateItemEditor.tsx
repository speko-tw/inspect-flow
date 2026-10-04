import type { FormEvent } from 'react'

import { MeasurementFieldEditor } from './MeasurementFieldEditor'
import { NumericStandardEditor } from './NumericStandardEditor'
import type { InspectionPoint, MeasurementField, TemplateItem } from './api'
import { numericSummary } from './templateEditorUtils'

type Selection = { type: 'category' | 'system' | 'item'; id: string }
type Mode = 'create-item' | 'edit-item'

type Props = {
  itemDraft: TemplateItem | null
  errors: Record<string, string>
  requestError: string
  dirty: boolean
  setGuard: (selection: Selection | null) => void
  selected: Selection | null
  systemId: string
  selectedCategory?: { name: string }
  selectedSystem?: { name: string }
  mode: Mode
  resetMode: () => void
  saveItem: (event: FormEvent<HTMLFormElement>) => void | Promise<void>
  readOnly: boolean
  updateDraft: (changes: Partial<TemplateItem>) => void
  updatePoint: (index: number, changes: Partial<InspectionPoint>) => void
  updateField: (
    pointIndex: number,
    fieldIndex: number,
    changes: Partial<MeasurementField>,
  ) => void
  addPoint: () => void
  removePoint: (index: number) => void
  updateNumeric: (
    index: number,
    changes: Partial<NonNullable<InspectionPoint['numeric_standard']>>,
  ) => void
  photoDraft: Record<string, string>
  setPhotoDraft: (
    updater: (current: Record<string, string>) => Record<string, string>,
  ) => void
  confirmField: string
  setConfirmField: (value: string) => void
}

export function TemplateItemEditor({
  itemDraft,
  errors,
  requestError,
  dirty,
  setGuard,
  selected,
  systemId,
  selectedCategory,
  selectedSystem,
  mode,
  resetMode,
  saveItem,
  readOnly,
  updateDraft,
  updatePoint,
  updateField,
  addPoint,
  removePoint,
  updateNumeric,
  photoDraft,
  setPhotoDraft,
  confirmField,
  setConfirmField,
}: Props) {
  if (!itemDraft) return null
  const inputError = (key: string) => errors[key]
  const fieldForError = (key: string): HTMLElement | null => {
    const fieldKey = key.endsWith(':range')
      ? key.slice(0, -':range'.length) + ':lower'
      : key
    return document.querySelector<HTMLElement>(
      `[data-error-key="${fieldKey}"]`,
    )
  }
  const alert =
    Object.keys(errors).length > 0
      ? `尚有 ${Object.keys(errors).length} 處要修正`
      : ''
  return (
    <form
      aria-label="查核項目編輯器"
      className="tpl-editor"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        if (dirty) {
          setGuard(selected ?? { type: 'system', id: systemId })
        } else {
          resetMode()
        }
      }}
      onSubmit={(event) => void saveItem(event)}
    >
      <div className="tpl-editor-heading">
        <div>
          <p className="tpl-crumb">
            範本庫 / {selectedCategory?.name} /{selectedSystem?.name}
          </p>
          <h2>
            {mode === 'create-item'
              ? `在「${selectedSystem?.name}」新增查核項目`
              : `編輯「${itemDraft.title || '未命名查核項目'}」`}
          </h2>
        </div>
        <button
          onClick={() => {
            if (dirty) setGuard(selected ?? { type: 'system', id: systemId })
            else resetMode()
          }}
          type="button"
        >
          取消編輯
        </button>
      </div>
      {alert && (
        <div className="tpl-error-summary" role="alert">
          <p>{alert}</p>
          <ul>
            {Object.entries(errors).map(([key, message]) => (
              <li key={key}>
                <button
                  onClick={() => {
                    window.setTimeout(() => {
                      const field = fieldForError(key)
                      const card = field?.closest('details')
                      if (card) card.open = true
                      field?.scrollIntoView?.({ block: 'center' })
                      field?.focus()
                    }, 0)
                  }}
                  type="button"
                >
                  {message}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {readOnly && (
        <p className="tpl-hint">以下內容是尚未儲存的草稿，僅供唯讀檢視。</p>
      )}
      <fieldset className="tpl-editor-body" disabled={readOnly}>
        <>
          <section className="tpl-card" aria-labelledby="tpl-basic-title">
            <h3 id="tpl-basic-title">基本資料</h3>
            <label htmlFor="item-title">
              查核項目名稱{' '}
              <b aria-hidden="true" className="tpl-required">
                *
              </b>
            </label>
            <input
              aria-invalid={Boolean(inputError('title'))}
              aria-required="true"
              data-error-key="title"
              id="item-title"
              onChange={(event) => updateDraft({ title: event.target.value })}
              value={itemDraft.title}
            />
            {inputError('title') && (
              <p className="tpl-field-error">{inputError('title')}</p>
            )}
            <label htmlFor="item-instruction">項目說明</label>
            <textarea
              id="item-instruction"
              onChange={(event) =>
                updateDraft({ instruction: event.target.value })
              }
              value={itemDraft.instruction}
            />
          </section>
          <section className="tpl-card" aria-labelledby="tpl-points-title">
            <h3 id="tpl-points-title">查核項次</h3>
            <p className="tpl-hint">
              每張卡片是一個現場查核步驟。實測欄位可以留空。
            </p>
            {itemDraft.inspection_points.map((point, index) => (
              <details className="tpl-point-card" key={point.id ?? index} open>
                <summary>
                  <span>
                    項次 {index + 1}：{point.title || '未命名項次'}
                  </span>
                  <span className="tpl-point-summary">
                    {pointSummary(point, photoDraft[String(index)] ?? '1')}
                  </span>
                </summary>
                <label htmlFor={`point-${index}-title`}>
                  項次標題{' '}
                  <b aria-hidden="true" className="tpl-required">
                    *
                  </b>
                </label>
                <input
                  aria-invalid={Boolean(inputError(`point:${index}:title`))}
                  data-error-key={`point:${index}:title`}
                  id={`point-${index}-title`}
                  onChange={(event) =>
                    updatePoint(index, { title: event.target.value })
                  }
                  value={point.title}
                />
                {inputError(`point:${index}:title`) && (
                  <p className="tpl-field-error">
                    {inputError(`point:${index}:title`)}
                  </p>
                )}
                <label htmlFor={`point-${index}-instruction`}>說明</label>
                <textarea
                  id={`point-${index}-instruction`}
                  onChange={(event) =>
                    updatePoint(index, {
                      instruction: event.target.value,
                    })
                  }
                  value={point.instruction}
                />
                <div className="tpl-actions">
                  <button onClick={() => removePoint(index)} type="button">
                    移除此項次
                  </button>
                </div>
                <MeasurementFieldEditor
                  confirmField={confirmField}
                  errors={errors}
                  point={point}
                  pointIndex={index}
                  setConfirmField={setConfirmField}
                  updateField={updateField}
                  updatePoint={updatePoint}
                />
                <NumericStandardEditor
                  errors={errors}
                  point={point}
                  pointIndex={index}
                  updateNumeric={updateNumeric}
                  updatePoint={updatePoint}
                />
                <section className="tpl-point-section" aria-label="照片需求">
                  <h4>照片需求</h4>
                  <label htmlFor={`photos-${index}`}>
                    照片至少幾張{' '}
                    <b aria-hidden="true" className="tpl-required">
                      *
                    </b>
                  </label>
                  <input
                    aria-invalid={Boolean(inputError(`point:${index}:photos`))}
                    data-error-key={`point:${index}:photos`}
                    id={`photos-${index}`}
                    inputMode="numeric"
                    min="1"
                    onChange={(event) => {
                      setPhotoDraft((current) => ({
                        ...current,
                        [String(index)]: event.target.value,
                      }))
                    }}
                    value={photoDraft[String(index)] ?? '1'}
                  />
                  {inputError(`point:${index}:photos`) && (
                    <p className="tpl-field-error">
                      {inputError(`point:${index}:photos`)}
                    </p>
                  )}
                </section>
              </details>
            ))}
            {errors.points && (
              <p className="tpl-field-error" role="alert">
                {errors.points}
              </p>
            )}
            <button onClick={addPoint} type="button">
              新增查核項次
            </button>
          </section>
          <section className="tpl-card tpl-live-preview" aria-label="預覽">
            <h3>預覽：每個項次的白話摘要</h3>
            <p>
              <strong className="tpl-preview-title">
                {itemDraft.title || '（尚未命名）'}
              </strong>
              共 {itemDraft.inspection_points.length} 個項次
            </p>
            <ol>
              {itemDraft.inspection_points.map((point, index) => (
                <li key={point.id ?? index}>
                  <strong className="tpl-preview-point">
                    項次 {index + 1}
                  </strong>
                  {pointSummary(point, photoDraft[String(index)] ?? '1')}
                </li>
              ))}
            </ol>
          </section>
        </>
      </fieldset>
      <div className="tpl-editor-footer">
        {requestError && (
          <p className="tpl-field-error" role="alert">
            {requestError}
          </p>
        )}
        <button className="btn-primary" disabled={readOnly} type="submit">
          儲存查核項目
        </button>
        <button
          onClick={() => {
            if (dirty) setGuard(selected ?? { type: 'system', id: systemId })
            else resetMode()
          }}
          type="button"
        >
          取消
        </button>
      </div>
    </form>
  )
}

function pointSummary(point: InspectionPoint, photos: string): string {
  const fields = point.measurement_fields
    .map((field) => {
      const name = field.name.trim() || '？'
      return `${name}${field.unit?.trim() ? `（${field.unit}）` : ''}`
    })
    .join('、')
  return `${point.title.trim() || '？'}｜量測 ${fields || '無實測欄位'}｜${numericSummary(point)}｜照片 ${photos.trim() || '？'} 張`
}
