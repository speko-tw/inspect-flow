import { useEffect, useState, type FormEvent } from 'react'

import { ManagementApiError, managementErrorMessage } from '../api'
import {
  createTemplateCategory,
  createTemplateSystem,
  deleteTemplateCategory,
  deleteTemplateSystem,
  getSystemTemplates,
  listTemplateCategories,
  listTemplateSystems,
  putSystemTemplates,
  renameTemplateCategory,
  renameTemplateSystem,
  type InspectionPoint,
  type TemplateCategory,
  type TemplateItem,
  type TemplateSystem,
} from './api'

function blankPoint(sequence: number): InspectionPoint {
  return {
    sequence,
    title: '',
    instruction: '',
    text_standard: null,
    numeric_standard: null,
    measurement_fields: [],
    evidence_requirements: [{ min_count: 1 }],
  }
}

function blankTemplate(systemId: string, sequence: number): TemplateItem {
  return {
    system_id: systemId,
    sequence,
    title: '',
    instruction: '',
    inspection_points: [],
  }
}

function forWire(item: TemplateItem): TemplateItem {
  return {
    ...item,
    inspection_points: item.inspection_points.map((point) => {
      const fields = point.measurement_fields.map((field) => ({
        ...field,
        client_id: field.client_id ?? field.id ?? crypto.randomUUID(),
      }))
      const numeric = point.numeric_standard
      const interval =
        numeric?.condition === 'range' && numeric.range_form === 'interval'
      const bound =
        numeric &&
        (fields.find(
          (field) =>
            (numeric.measurement_field_client_id != null &&
              numeric.measurement_field_client_id !== '' &&
              (field.client_id === numeric.measurement_field_client_id ||
                field.id === numeric.measurement_field_client_id)) ||
            (numeric.measurement_field_id != null &&
              numeric.measurement_field_id !== '' &&
              field.id === numeric.measurement_field_id),
        ) ??
          undefined)
      return {
        ...point,
        id: undefined,
        measurement_fields: fields.map((field) => ({
          client_id: field.client_id,
          name: field.name,
          field_type: field.field_type,
          unit: field === bound ? null : field.unit,
        })),
        numeric_standard: numeric
          ? {
              value: interval ? null : String(numeric.value ?? ''),
              condition: numeric.condition,
              unit: bound?.unit ?? numeric.unit,
              tolerance: interval ? null : numeric.tolerance,
              range_form:
                numeric.condition === 'range'
                  ? (numeric.range_form ?? 'tolerance')
                  : null,
              lower_bound: interval ? (numeric.lower_bound ?? null) : null,
              upper_bound: interval ? (numeric.upper_bound ?? null) : null,
              measurement_field_client_id:
                bound?.client_id ?? numeric.measurement_field_client_id,
            }
          : null,
        evidence_requirements: point.evidence_requirements.map((entry) => ({
          min_count: entry.min_count,
        })),
      }
    }),
  }
}

function numericStandardPreview(
  standard: NonNullable<InspectionPoint['numeric_standard']>,
): string {
  if (standard.condition === 'range') {
    if ((standard.range_form ?? 'tolerance') === 'interval') {
      return (
        `${standard.lower_bound ?? ''}～${standard.upper_bound ?? ''} ` +
        standard.unit
      )
    }
    return `${standard.value} ± ${standard.tolerance} ${standard.unit}`
  }
  const symbols = { '<=': '≤', '>=': '≥', '=': '＝', range: '範圍' }
  const tolerance =
    standard.tolerance === null ? '' : `；容許誤差：${standard.tolerance}`
  return (
    `${symbols[standard.condition]} ${standard.value} ${standard.unit}` +
    tolerance
  )
}

function apiMessage(error: unknown): string {
  if (error instanceof ManagementApiError) {
    const messages: Record<string, string> = {
      'template.name_conflict': '名稱已存在，請改用其他名稱。',
      'template.category_not_empty': '此工程類別仍有系統，無法刪除。',
      'template.system_not_empty': '此系統仍有查核項目，無法刪除。',
      'request.validation_failed': '資料驗證失敗，請檢查必填欄位與數值格式。',
      'permission.denied': '你沒有權限執行這項操作。',
    }
    if (messages[error.code ?? '']) return messages[error.code ?? '']
    if (error.status === 422) {
      return '資料驗證失敗，請檢查必填欄位與數值格式。'
    }
  }
  return managementErrorMessage(error)
}

function readErrorMessage(error: unknown): string {
  if (
    error instanceof ManagementApiError &&
    (error.status === 403 || error.code === 'permission.denied')
  ) {
    return '你沒有權限瀏覽範本庫。'
  }
  return apiMessage(error)
}

function isForbidden(error: unknown): boolean {
  return (
    error instanceof ManagementApiError &&
    (error.status === 403 || error.code === 'permission.denied')
  )
}

export default function TemplatesPage() {
  const [categories, setCategories] = useState<TemplateCategory[]>([])
  const [systems, setSystems] = useState<TemplateSystem[]>([])
  const [items, setItems] = useState<TemplateItem[]>([])
  const [categoryId, setCategoryId] = useState('')
  const [systemId, setSystemId] = useState('')
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [editingSystem, setEditingSystem] = useState<string | null>(null)
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [creatingSystem, setCreatingSystem] = useState(false)
  const [editingItem, setEditingItem] = useState<TemplateItem | null>(null)
  const [preview, setPreview] = useState<TemplateItem | null>(null)
  const [previewGroups, setPreviewGroups] = useState<TemplateItem[] | null>(
    null,
  )
  const [confirmDeleteId, setConfirmDeleteId] = useState('')
  const [confirmDeleteCategory, setConfirmDeleteCategory] = useState(false)
  const [confirmDeleteSystem, setConfirmDeleteSystem] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [readOnly, setReadOnly] = useState(false)

  useEffect(() => {
    let active = true
    void listTemplateCategories()
      .then((result) => {
        if (active) {
          setCategories(result)
          setCategoryId(result[0]?.id ?? '')
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          if (isForbidden(caught)) setReadOnly(true)
          setError(readErrorMessage(caught))
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    if (!categoryId) return
    void listTemplateSystems(categoryId)
      .then((result) => {
        if (active) {
          setSystems(result)
          setSystemId(result[0]?.id ?? '')
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          if (isForbidden(caught)) setReadOnly(true)
          setError(readErrorMessage(caught))
        }
      })
    return () => {
      active = false
    }
  }, [categoryId])

  useEffect(() => {
    let active = true
    if (!systemId) return
    void getSystemTemplates(systemId)
      .then((result) => {
        if (active) setItems(result.items)
      })
      .catch((caught: unknown) => {
        if (active) {
          if (isForbidden(caught)) setReadOnly(true)
          setError(readErrorMessage(caught))
        }
      })
    return () => {
      active = false
    }
  }, [systemId])

  function denied(caught: unknown): void {
    const forbidden =
      caught instanceof ManagementApiError &&
      (caught.status === 403 || caught.code === 'permission.denied')
    setError(
      forbidden
        ? '目前帳號只有瀏覽權限，已切換為唯讀模式。'
        : apiMessage(caught),
    )
    if (forbidden) {
      setReadOnly(true)
      setEditingCategory(null)
      setEditingSystem(null)
    }
  }

  async function reloadAll(
    preferredCategoryId?: string,
    preferredSystemId?: string,
  ) {
    try {
      const result = await listTemplateCategories()
      setCategories(result)
      const selected = result.find(
        (item) => item.id === (preferredCategoryId ?? categoryId),
      )
      const nextCategory = selected?.id ?? result[0]?.id ?? ''
      setCategoryId(nextCategory)
      if (nextCategory) {
        const nextSystems = await listTemplateSystems(nextCategory)
        setSystems(nextSystems)
        const selectedSystem = nextSystems.find(
          (item) => item.id === (preferredSystemId ?? systemId),
        )
        const nextSystem = selectedSystem?.id ?? nextSystems[0]?.id ?? ''
        setSystemId(nextSystem)
        if (nextSystem) setItems((await getSystemTemplates(nextSystem)).items)
        else setItems([])
      } else {
        setSystems([])
        setSystemId('')
        setItems([])
      }
    } catch (caught) {
      denied(caught)
    }
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = (editingCategory ?? '').trim()
    if (!name) return
    try {
      let preferredCategoryId = categoryId
      if (
        !creatingCategory &&
        categories.some((item) => item.id === categoryId)
      ) {
        await renameTemplateCategory(categoryId, name)
        setNotice('工程類別已更新。')
      } else {
        const created = await createTemplateCategory(name)
        setCategoryId(created.id)
        preferredCategoryId = created.id
        setNotice('工程類別已新增。')
      }
      setEditingCategory(null)
      setCreatingCategory(false)
      setError('')
      await reloadAll(preferredCategoryId)
    } catch (caught) {
      denied(caught)
    }
  }

  async function saveSystem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = (editingSystem ?? '').trim()
    if (!name || !categoryId) return
    try {
      let preferredSystemId = systemId
      if (!creatingSystem && systems.some((item) => item.id === systemId)) {
        await renameTemplateSystem(systemId, name)
        setNotice('系統已更新。')
      } else {
        const created = await createTemplateSystem(categoryId, name)
        setSystemId(created.id)
        preferredSystemId = created.id
        setNotice('系統已新增。')
      }
      setEditingSystem(null)
      setCreatingSystem(false)
      setError('')
      await reloadAll(categoryId, preferredSystemId)
    } catch (caught) {
      denied(caught)
    }
  }

  async function removeCategory() {
    if (!categoryId) return
    setConfirmDeleteCategory(false)
    try {
      await deleteTemplateCategory(categoryId)
      setNotice('工程類別已刪除。')
      setError('')
      await reloadAll()
    } catch (caught) {
      denied(caught)
    }
  }

  async function removeSystem() {
    if (!systemId) return
    setConfirmDeleteSystem(false)
    try {
      await deleteTemplateSystem(systemId)
      setNotice('系統已刪除。')
      setError('')
      await reloadAll()
    } catch (caught) {
      denied(caught)
    }
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!systemId || !editingItem) return
    const invalid = editingItem.inspection_points.some((point) => {
      const standard = point.numeric_standard
      if (!standard || standard.condition !== 'range') return false
      if ((standard.range_form ?? 'tolerance') === 'interval') {
        const lower = Number(standard.lower_bound)
        const upper = Number(standard.upper_bound)
        return (
          !standard.lower_bound?.trim() ||
          !standard.upper_bound?.trim() ||
          !Number.isFinite(lower) ||
          !Number.isFinite(upper) ||
          lower > upper
        )
      }
      const tolerance = Number(standard.tolerance)
      return (
        !standard.value?.trim() ||
        !standard.tolerance?.trim() ||
        !Number.isFinite(Number(standard.value)) ||
        !Number.isFinite(tolerance) ||
        tolerance < 0
      )
    })
    if (invalid) {
      setError('範圍標準欄位無效，請檢查上下限或容許誤差。')
      return
    }
    try {
      const input = forWire({ ...editingItem, system_id: systemId })
      const next = editingItem.id
        ? items.map((item) => (item.id === editingItem.id ? input : item))
        : [...items, input]
      const result = await putSystemTemplates(systemId, next.map(forWire))
      setItems(result.items)
      setEditingItem(null)
      setError('')
      setNotice('查核項目範本已儲存。')
    } catch (caught) {
      denied(caught)
      await reloadAll()
    }
  }

  async function removeItem(item: TemplateItem) {
    if (!systemId) return
    try {
      const result = await putSystemTemplates(
        systemId,
        items.filter((row) => row.id !== item.id).map(forWire),
      )
      setItems(result.items)
      setConfirmDeleteId('')
      setNotice('查核項目範本已刪除。')
      setError('')
    } catch (caught) {
      denied(caught)
      await reloadAll()
    }
  }

  function updatePoint(index: number, changes: Partial<InspectionPoint>) {
    setEditingItem((current) =>
      current
        ? {
            ...current,
            inspection_points: current.inspection_points.map((point, item) =>
              item === index ? { ...point, ...changes } : point,
            ),
          }
        : current,
    )
  }

  function renderPoint(point: InspectionPoint, index: number) {
    const numeric = point.numeric_standard
    const boundField = point.measurement_fields.find(
      (field) =>
        (numeric?.measurement_field_client_id != null &&
          numeric.measurement_field_client_id !== '' &&
          (field.client_id === numeric.measurement_field_client_id ||
            field.id === numeric.measurement_field_client_id)) ||
        (numeric?.measurement_field_id != null &&
          numeric.measurement_field_id !== '' &&
          field.id === numeric.measurement_field_id),
    )
    return (
      <fieldset key={point.id ?? index}>
        <legend>查核項次 {index + 1}</legend>
        <label>
          項次標題
          <input
            onChange={(event) =>
              updatePoint(index, { title: event.target.value })
            }
            required
            value={point.title}
          />
        </label>
        <label>
          項次說明
          <textarea
            onChange={(event) =>
              updatePoint(index, { instruction: event.target.value })
            }
            value={point.instruction}
          />
        </label>
        <label>
          標準類型
          <select
            onChange={(event) =>
              updatePoint(index, {
                text_standard:
                  event.target.value === 'text' ? { text: '' } : null,
                numeric_standard:
                  event.target.value === 'number'
                    ? {
                        value: '',
                        condition: '<=',
                        unit: '',
                        tolerance: null,
                        range_form: null,
                        lower_bound: null,
                        upper_bound: null,
                        measurement_field_client_id: '',
                      }
                    : null,
              })
            }
            value={numeric ? 'number' : point.text_standard ? 'text' : 'none'}
          >
            <option value="none">無</option>
            <option value="text">文字標準</option>
            <option value="number">數值標準</option>
          </select>
        </label>
        {point.text_standard && (
          <label>
            標準文字
            <textarea
              onChange={(event) =>
                updatePoint(index, {
                  text_standard: { text: event.target.value },
                })
              }
              value={point.text_standard.text}
            />
          </label>
        )}
        {numeric && (
          <>
            <label>
              綁定數字實測欄位
              <select
                onChange={(event) => {
                  const field = point.measurement_fields.find(
                    (candidate) =>
                      candidate.client_id === event.target.value ||
                      candidate.id === event.target.value,
                  )
                  updatePoint(index, {
                    numeric_standard: {
                      ...numeric,
                      measurement_field_id: undefined,
                      measurement_field_client_id: event.target.value,
                      unit: field?.unit ?? '',
                    },
                  })
                }}
                required
                value={
                  numeric.measurement_field_client_id ??
                  point.measurement_fields.find(
                    (field) => field.id === numeric.measurement_field_id,
                  )?.id ??
                  ''
                }
              >
                <option value="">請選擇數字欄位</option>
                {point.measurement_fields
                  .filter((field) => field.field_type === 'number')
                  .map((field) => (
                    <option
                      key={field.client_id ?? field.id}
                      value={field.client_id ?? field.id}
                    >
                      {field.name}（{field.unit}）
                    </option>
                  ))}
              </select>
            </label>
            <label>
              條件
              <select
                onChange={(event) => {
                  const condition = event.target.value as
                    '<=' | '>=' | '=' | 'range'
                  updatePoint(index, {
                    numeric_standard: {
                      ...numeric,
                      condition,
                      range_form:
                        condition === 'range'
                          ? (numeric.range_form ?? 'tolerance')
                          : null,
                      lower_bound: null,
                      upper_bound: null,
                    },
                  })
                }}
                value={numeric.condition}
              >
                <option value="<=">≤</option>
                <option value=">=">≥</option>
                <option value="=">＝</option>
                <option value="range">範圍</option>
              </select>
            </label>
            {numeric.condition === 'range' && (
              <>
                <label>
                  範圍形式
                  <select
                    onChange={(event) => {
                      const rangeForm = event.target.value as
                        'interval' | 'tolerance'
                      updatePoint(index, {
                        numeric_standard: {
                          ...numeric,
                          range_form: rangeForm,
                          value: rangeForm === 'interval' ? '' : numeric.value,
                          tolerance:
                            rangeForm === 'interval'
                              ? null
                              : numeric.tolerance,
                          lower_bound:
                            rangeForm === 'tolerance'
                              ? null
                              : numeric.lower_bound,
                          upper_bound:
                            rangeForm === 'tolerance'
                              ? null
                              : numeric.upper_bound,
                        },
                      })
                    }}
                    value={numeric.range_form ?? 'tolerance'}
                  >
                    <option value="interval">區間（下限～上限）</option>
                    <option value="tolerance">標準值 ± 容許誤差</option>
                  </select>
                </label>
                {(numeric.range_form ?? 'tolerance') === 'interval' ? (
                  <>
                    <label>
                      下限
                      <input
                        inputMode="decimal"
                        onChange={(event) =>
                          updatePoint(index, {
                            numeric_standard: {
                              ...numeric,
                              lower_bound: event.target.value,
                            },
                          })
                        }
                        required
                        value={numeric.lower_bound ?? ''}
                      />
                    </label>
                    <label>
                      上限
                      <input
                        inputMode="decimal"
                        onChange={(event) =>
                          updatePoint(index, {
                            numeric_standard: {
                              ...numeric,
                              upper_bound: event.target.value,
                            },
                          })
                        }
                        required
                        value={numeric.upper_bound ?? ''}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      標準值
                      <input
                        inputMode="decimal"
                        onChange={(event) =>
                          updatePoint(index, {
                            numeric_standard: {
                              ...numeric,
                              value: event.target.value,
                            },
                          })
                        }
                        required
                        value={numeric.value ?? ''}
                      />
                    </label>
                    <label>
                      容許誤差
                      <input
                        inputMode="decimal"
                        onChange={(event) =>
                          updatePoint(index, {
                            numeric_standard: {
                              ...numeric,
                              tolerance: event.target.value || null,
                            },
                          })
                        }
                        required
                        value={numeric.tolerance ?? ''}
                      />
                    </label>
                  </>
                )}
              </>
            )}
            {numeric.condition !== 'range' && (
              <>
                <label>
                  標準值
                  <input
                    inputMode="decimal"
                    onChange={(event) =>
                      updatePoint(index, {
                        numeric_standard: {
                          ...numeric,
                          value: event.target.value,
                        },
                      })
                    }
                    required
                    value={numeric.value ?? ''}
                  />
                </label>
                <label>
                  容許誤差
                  <input
                    inputMode="decimal"
                    onChange={(event) =>
                      updatePoint(index, {
                        numeric_standard: {
                          ...numeric,
                          tolerance: event.target.value || null,
                        },
                      })
                    }
                    value={numeric.tolerance ?? ''}
                  />
                </label>
              </>
            )}
            <label>
              單位（由綁定欄位帶入）
              <input disabled value={boundField?.unit ?? numeric.unit} />
            </label>
          </>
        )}
        <h3>實測欄位</h3>
        {point.measurement_fields.map((field, fieldIndex) => (
          <fieldset key={field.client_id ?? field.id ?? fieldIndex}>
            <label>
              欄位名稱
              <input
                onChange={(event) => {
                  const fields = [...point.measurement_fields]
                  fields[fieldIndex] = { ...field, name: event.target.value }
                  updatePoint(index, { measurement_fields: fields })
                }}
                value={field.name}
              />
            </label>
            <label>
              欄位型別
              <select
                onChange={(event) => {
                  const fields = [...point.measurement_fields]
                  fields[fieldIndex] = {
                    ...field,
                    field_type: event.target.value as 'text' | 'number',
                    unit:
                      event.target.value === 'number'
                        ? (field.unit ?? '')
                        : null,
                  }
                  updatePoint(index, { measurement_fields: fields })
                }}
                value={field.field_type}
              >
                <option value="text">文字</option>
                <option value="number">數字</option>
              </select>
            </label>
            {field.field_type === 'number' && (
              <label>
                單位
                <input
                  onChange={(event) => {
                    const fields = [...point.measurement_fields]
                    fields[fieldIndex] = { ...field, unit: event.target.value }
                    updatePoint(index, { measurement_fields: fields })
                  }}
                  required
                  value={field.unit ?? ''}
                />
              </label>
            )}
            <button
              onClick={() =>
                updatePoint(index, {
                  measurement_fields: point.measurement_fields.filter(
                    (_entry, position) => position !== fieldIndex,
                  ),
                })
              }
              type="button"
            >
              移除欄位
            </button>
          </fieldset>
        ))}
        <button
          onClick={() =>
            updatePoint(index, {
              measurement_fields: [
                ...point.measurement_fields,
                {
                  client_id: crypto.randomUUID(),
                  name: '',
                  field_type: 'text',
                  unit: null,
                },
              ],
            })
          }
          type="button"
        >
          新增實測欄位
        </button>
        <label>
          每項次最少照片數
          <input
            min={1}
            onChange={(event) =>
              updatePoint(index, {
                evidence_requirements: [
                  { min_count: Number(event.target.value) || 1 },
                ],
              })
            }
            type="number"
            value={point.evidence_requirements[0]?.min_count ?? 1}
          />
        </label>
        <button
          className="btn-danger"
          onClick={() =>
            setEditingItem((current) =>
              current
                ? {
                    ...current,
                    inspection_points: current.inspection_points
                      .filter((_entry, position) => position !== index)
                      .map((entry, position) => ({
                        ...entry,
                        sequence: position + 1,
                      })),
                  }
                : current,
            )
          }
          type="button"
        >
          移除此項次
        </button>
      </fieldset>
    )
  }

  const selectedCategory = categories.find((item) => item.id === categoryId)
  const selectedSystem = systems.find((item) => item.id === systemId)
  const editable = !readOnly

  return (
    <section aria-labelledby="templates-heading">
      <h1 id="templates-heading">範本管理</h1>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {readOnly && <p>唯讀瀏覽</p>}
      {loading ? <p>載入中…</p> : null}
      {!loading && categories.length === 0 && <p>目前沒有工程類別。</p>}
      <div className="template-browser">
        <section aria-label="工程類別">
          <h2>工程類別</h2>
          <label>
            選擇工程類別
            <select
              onChange={(event) => {
                setCategoryId(event.target.value)
                setCreatingCategory(false)
                setCreatingSystem(false)
                setEditingCategory(
                  categories.find((item) => item.id === event.target.value)
                    ?.name ?? null,
                )
                setEditingSystem(null)
                setEditingItem(null)
                setConfirmDeleteCategory(false)
                setConfirmDeleteSystem(false)
                setConfirmDeleteId('')
                setSystemId('')
                setItems([])
              }}
              value={categoryId}
            >
              <option value="">請選擇</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          {editable && (
            <>
              <button
                onClick={() => {
                  setCreatingCategory(true)
                  setEditingCategory('')
                }}
                type="button"
              >
                新增工程類別
              </button>
              <form onSubmit={saveCategory}>
                <label>
                  工程類別名稱
                  <input
                    onChange={(event) =>
                      setEditingCategory(event.target.value)
                    }
                    required
                    value={editingCategory ?? selectedCategory?.name ?? ''}
                  />
                </label>
                <button type="submit">
                  {creatingCategory ? '新增類別' : '更新類別'}
                </button>
              </form>
              {selectedCategory && (
                <>
                  <button
                    className="btn-danger"
                    onClick={() => setConfirmDeleteCategory(true)}
                    type="button"
                  >
                    刪除工程類別
                  </button>
                  {confirmDeleteCategory && (
                    <div role="group" aria-label="確認刪除工程類別">
                      <p>確定刪除工程類別「{selectedCategory.name}」？</p>
                      <button
                        onClick={() => void removeCategory()}
                        type="button"
                      >
                        確認刪除工程類別
                      </button>
                      <button
                        onClick={() => setConfirmDeleteCategory(false)}
                        type="button"
                      >
                        取消刪除工程類別
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>
        <section aria-label="系統">
          <h2>系統</h2>
          <label>
            選擇系統
            <select
              onChange={(event) => {
                setSystemId(event.target.value)
                setCreatingSystem(false)
                setEditingSystem(
                  systems.find((item) => item.id === event.target.value)
                    ?.name ?? null,
                )
                setEditingItem(null)
                setConfirmDeleteSystem(false)
                setConfirmDeleteId('')
                setItems([])
              }}
              value={systemId}
            >
              <option value="">請選擇</option>
              {systems.map((system) => (
                <option key={system.id} value={system.id}>
                  {system.name}
                </option>
              ))}
            </select>
          </label>
          {editable && (
            <>
              <button
                disabled={!categoryId}
                onClick={() => {
                  setCreatingSystem(true)
                  setEditingSystem('')
                }}
                type="button"
              >
                新增系統…
              </button>
              <form onSubmit={saveSystem}>
                <label>
                  系統名稱
                  <input
                    disabled={!categoryId}
                    onChange={(event) => setEditingSystem(event.target.value)}
                    required
                    value={editingSystem ?? selectedSystem?.name ?? ''}
                  />
                </label>
                <button disabled={!categoryId} type="submit">
                  {creatingSystem ? '新增系統' : '更新系統'}
                </button>
              </form>
              {selectedSystem && (
                <>
                  <button
                    className="btn-danger"
                    onClick={() => setConfirmDeleteSystem(true)}
                    type="button"
                  >
                    刪除系統
                  </button>
                  {confirmDeleteSystem && (
                    <div role="group" aria-label="確認刪除系統">
                      <p>確定刪除系統「{selectedSystem.name}」？</p>
                      <button
                        onClick={() => void removeSystem()}
                        type="button"
                      >
                        確認刪除系統
                      </button>
                      <button
                        onClick={() => setConfirmDeleteSystem(false)}
                        type="button"
                      >
                        取消刪除系統
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>
        <section aria-label="查核項目範本">
          <h2>查核項目範本</h2>
          {editable && selectedSystem && (
            <button
              onClick={() =>
                setEditingItem(blankTemplate(systemId, items.length + 1))
              }
              type="button"
            >
              新增查核項目
            </button>
          )}
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                {item.sequence}. {item.title}{' '}
                <button
                  aria-label={`預覽：${item.title}`}
                  onClick={() => {
                    setPreview(item)
                    setPreviewGroups(null)
                  }}
                  type="button"
                >
                  預覽單項
                </button>{' '}
                {editable && (
                  <>
                    <button
                      aria-label={`編輯：${item.title}`}
                      onClick={() => setEditingItem(item)}
                      type="button"
                    >
                      編輯
                    </button>{' '}
                    <button
                      aria-label={`刪除：${item.title}`}
                      onClick={() => setConfirmDeleteId(item.id ?? '')}
                      type="button"
                    >
                      刪除
                    </button>
                    {confirmDeleteId === item.id && (
                      <span
                        role="group"
                        aria-label={`確認刪除：${item.title}`}
                      >
                        <span>確定刪除「{item.title}」？</span>
                        <button
                          onClick={() => void removeItem(item)}
                          type="button"
                        >
                          確認刪除
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId('')}
                          type="button"
                        >
                          取消刪除
                        </button>
                      </span>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          {items.length > 0 && (
            <button
              onClick={() =>
                (() => {
                  setPreview({
                    system_id: systemId,
                    sequence: 1,
                    title: selectedSystem?.name ?? '系統範本',
                    instruction: '',
                    inspection_points: [],
                  })
                  setPreviewGroups(items)
                })()
              }
              type="button"
            >
              預覽整個系統
            </button>
          )}
        </section>
      </div>
      {editingItem && (
        <form
          aria-label="查核項目編輯器"
          onSubmit={(event) => {
            if (!editable) {
              event.preventDefault()
              return
            }
            void saveItem(event)
          }}
        >
          <h2>{editingItem.id ? '編輯查核項目' : '新增查核項目'}</h2>
          {!editable && <p>以下內容是尚未儲存的草稿，僅供唯讀檢視。</p>}
          <fieldset disabled={!editable}>
            <label>
              項目名稱
              <input
                onChange={(event) =>
                  setEditingItem({ ...editingItem, title: event.target.value })
                }
                required
                value={editingItem.title}
              />
            </label>
            <label>
              項目說明
              <textarea
                onChange={(event) =>
                  setEditingItem({
                    ...editingItem,
                    instruction: event.target.value,
                  })
                }
                value={editingItem.instruction}
              />
            </label>
            <label>
              項目順序
              <input
                max={32767}
                min={1}
                onChange={(event) =>
                  setEditingItem({
                    ...editingItem,
                    sequence: Number(event.target.value),
                  })
                }
                type="number"
                value={editingItem.sequence}
              />
            </label>
            {editingItem.inspection_points.map(renderPoint)}
            {editable && (
              <button
                onClick={() =>
                  setEditingItem({
                    ...editingItem,
                    inspection_points: [
                      ...editingItem.inspection_points,
                      blankPoint(editingItem.inspection_points.length + 1),
                    ],
                  })
                }
                type="button"
              >
                新增查核項次
              </button>
            )}
            {editable && <button type="submit">儲存範本</button>}
            {editable && (
              <button onClick={() => setEditingItem(null)} type="button">
                取消
              </button>
            )}
          </fieldset>
        </form>
      )}
      {preview && (
        <section aria-label="範本預覽" role="dialog">
          <h2>{preview.title}</h2>
          <p>{preview.instruction || '沒有項目說明。'}</p>
          {(previewGroups ?? [preview]).map((group) => (
            <section key={group.id ?? group.title}>
              {previewGroups && (
                <h3>
                  {group.sequence}. {group.title}
                </h3>
              )}
              {group.inspection_points.map((point, index) => (
                <article key={point.id ?? `${point.sequence}-${index}`}>
                  <h3>
                    {previewGroups
                      ? `項次 ${point.sequence}. `
                      : `${point.sequence}. `}
                    {point.title}
                  </h3>
                  <p>{point.instruction || '沒有項次說明。'}</p>
                  {point.text_standard && (
                    <p>文字標準：{point.text_standard.text}</p>
                  )}
                  {point.numeric_standard && (
                    <p>
                      數值標準：
                      {numericStandardPreview(point.numeric_standard)}
                    </p>
                  )}
                  <p>
                    實測欄位：
                    {point.measurement_fields
                      .map(
                        (field) =>
                          `${field.name}${field.unit ? `（${field.unit}）` : ''}`,
                      )
                      .join('、') || '無'}
                  </p>
                  <p>
                    至少照片數：
                    {point.evidence_requirements[0]?.min_count ?? 1}
                  </p>
                </article>
              ))}
            </section>
          ))}
          <button
            onClick={() => {
              setPreview(null)
              setPreviewGroups(null)
            }}
            type="button"
          >
            關閉預覽
          </button>
        </section>
      )}
    </section>
  )
}
