import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'

import { ManagementApiError, managementErrorMessage } from '../api'
import { InlineConfirm } from './InlineConfirm'
import { InspectionPointCard } from './InspectionPointCard'
import { TemplateItemEditor } from './TemplateItemEditor'
import { TemplateLibraryNav } from './TemplateLibraryNav'
import { boundField, forWire, localizeField } from './templateEditorUtils'
import {
  createTemplateCategory,
  createTemplateItem,
  createTemplateSystem,
  deleteTemplateCategory,
  deleteTemplateItem,
  deleteTemplateSystem,
  getSystemTemplates,
  listTemplateCategories,
  listTemplateSystems,
  renameTemplateCategory,
  renameTemplateSystem,
  updateTemplateItem,
  type InspectionPoint,
  type MeasurementField,
  type TemplateCategory,
  type TemplateItem,
  type TemplateSystem,
} from './api'

type Selection = { type: 'category' | 'system' | 'item'; id: string }
type Mode =
  | 'view'
  | 'create-category'
  | 'create-system'
  | 'rename-category'
  | 'rename-system'
  | 'create-item'
  | 'edit-item'
  | 'delete-category'
  | 'delete-system'
  | 'delete-item'

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
    inspection_points: [blankPoint(1)],
  }
}

function localizeFields(item: TemplateItem): TemplateItem {
  return {
    ...item,
    inspection_points: item.inspection_points.map((point) => {
      const measurementFields = point.measurement_fields.map(localizeField)
      const numeric = point.numeric_standard
      const keyByClientId = new Map(
        measurementFields.map((field) => [field.client_id!, field.clientKey!]),
      )
      const keyById = new Map(
        measurementFields
          .filter((field) => field.id)
          .map((field) => [field.id!, field.clientKey!]),
      )
      const boundKey =
        numeric?.measurement_field_client_key ??
        (numeric?.measurement_field_client_id
          ? keyByClientId.get(numeric.measurement_field_client_id)
          : undefined) ??
        (numeric?.measurement_field_id
          ? keyById.get(numeric.measurement_field_id)
          : undefined)
      return {
        ...point,
        numeric_standard: numeric
          ? {
              ...numeric,
              measurement_field_id: undefined,
              measurement_field_client_id: undefined,
              measurement_field_client_key: boundKey,
            }
          : null,
        measurement_fields: measurementFields.map((field) =>
          Boolean(numeric) && Boolean(boundKey) && field.clientKey === boundKey
            ? { ...field, unit: field.unit ?? numeric?.unit ?? '' }
            : field,
        ),
      }
    }),
  }
}

function isForbidden(error: unknown): boolean {
  return (
    error instanceof ManagementApiError &&
    (error.status === 403 || error.code === 'permission.denied')
  )
}

function apiMessage(error: unknown): string {
  if (error instanceof ManagementApiError) {
    const messages: Record<string, string> = {
      'template.name_conflict': '同一層已有相同名稱，請換個名稱。',
      'template.category_not_empty': '此類別還有系統，請先處理系統。',
      'template.system_not_empty': '此系統還有查核項目，請先處理項目。',
      'request.validation_failed':
        '範本未儲存，輸入內容已保留。請重新檢查查核項次與單位。',
      'permission.denied': '你沒有權限執行這項操作。',
    }
    if (messages[error.code ?? '']) return messages[error.code ?? '']
    if (error.status === 422) {
      return '範本未儲存，輸入內容已保留。請重新檢查查核項次與單位。'
    }
  }
  return managementErrorMessage(error)
}

export default function TemplatesPage() {
  const [categories, setCategories] = useState<TemplateCategory[]>([])
  const [systems, setSystems] = useState<TemplateSystem[]>([])
  const [items, setItems] = useState<TemplateItem[]>([])
  const [loadedSystemIds, setLoadedSystemIds] = useState<Set<string>>(
    new Set(),
  )
  const [loadedCategoryIds, setLoadedCategoryIds] = useState<Set<string>>(
    new Set(),
  )
  const [selected, setSelected] = useState<Selection | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<Mode>('view')
  const [nameDraft, setNameDraft] = useState('')
  const [itemDraft, setItemDraft] = useState<TemplateItem | null>(null)
  const [baseline, setBaseline] = useState('')
  const [photoDraft, setPhotoDraft] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [attemptedSave, setAttemptedSave] = useState(false)
  const [actionError, setActionError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [readOnly, setReadOnly] = useState(false)
  const [mobilePane, setMobilePane] = useState<'list' | 'detail'>('list')
  const [guard, setGuard] = useState<Selection | null>(null)
  const [confirmField, setConfirmField] = useState('')

  const categoryId =
    selected?.type === 'category'
      ? selected.id
      : selected?.type === 'system'
        ? (systems.find((system) => system.id === selected.id)?.category_id ??
          '')
        : selected?.type === 'item'
          ? (systems.find(
              (system) =>
                system.id ===
                items.find((item) => item.id === selected.id)?.system_id,
            )?.category_id ?? '')
          : ''
  const systemId =
    selected?.type === 'system'
      ? selected.id
      : selected?.type === 'item'
        ? (items.find((item) => item.id === selected.id)?.system_id ?? '')
        : ''
  const selectedCategory = categories.find((item) => item.id === categoryId)
  const selectedSystem = systems.find((item) => item.id === systemId)
  const selectedItem = items.find((item) => item.id === selected?.id)
  const systemItems = items.filter((item) => item.system_id === systemId)
  const dirty = useMemo(() => {
    if (
      mode === 'create-category' ||
      mode === 'create-system' ||
      mode === 'rename-category' ||
      mode === 'rename-system'
    ) {
      const original = mode.startsWith('rename')
        ? mode === 'rename-category'
          ? (selectedCategory?.name ?? '')
          : (selectedSystem?.name ?? '')
        : ''
      return nameDraft !== original
    }
    if (mode === 'create-item' || mode === 'edit-item') {
      return JSON.stringify({ itemDraft, photoDraft }) !== baseline
    }
    return false
  }, [
    baseline,
    itemDraft,
    mode,
    nameDraft,
    photoDraft,
    selectedCategory?.name,
    selectedSystem?.name,
  ])

  useEffect(() => {
    let active = true
    void listTemplateCategories()
      .then((rows) => {
        if (!active) return
        setCategories(rows)
        if (rows[0]) {
          setSelected({ type: 'category', id: rows[0].id })
          setExpanded(new Set([rows[0].id]))
        }
      })
      .catch((caught: unknown) => {
        if (!active) return
        if (isForbidden(caught)) setReadOnly(true)
        setError(
          isForbidden(caught)
            ? '你沒有權限瀏覽範本庫。'
            : managementErrorMessage(caught),
        )
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    if (!categoryId) {
      return
    }
    void listTemplateSystems(categoryId)
      .then((rows) => {
        if (!active) return
        setSystems((current) => [
          ...current.filter((row) => row.category_id !== categoryId),
          ...rows,
        ])
        setLoadedCategoryIds((current) => new Set([...current, categoryId]))
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            isForbidden(caught)
              ? '你沒有權限瀏覽範本庫。'
              : managementErrorMessage(caught),
          )
      })
    return () => {
      active = false
    }
  }, [categoryId])

  useEffect(() => {
    let active = true
    if (!systemId) {
      return
    }
    void getSystemTemplates(systemId)
      .then((result) => {
        if (active) {
          setLoadedSystemIds((current) => new Set([...current, systemId]))
          setItems((current) => [
            ...current.filter((item) => item.system_id !== systemId),
            ...result.items.map(localizeFields),
          ])
        }
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            isForbidden(caught)
              ? '你沒有權限瀏覽範本庫。'
              : managementErrorMessage(caught),
          )
      })
    return () => {
      active = false
    }
  }, [systemId])

  function resetMode(): void {
    setMode('view')
    setNameDraft('')
    setItemDraft(null)
    setBaseline('')
    setPhotoDraft({})
    setErrors({})
    setAttemptedSave(false)
    setActionError('')
    setConfirmField('')
  }

  function showNotice(message: string): void {
    setError('')
    setNotice(message)
  }

  function fail(caught: unknown): void {
    setNotice('')
    setError(
      isForbidden(caught)
        ? '目前帳號只有瀏覽權限，已切換為唯讀模式。'
        : apiMessage(caught),
    )
    if (isForbidden(caught)) setReadOnly(true)
  }

  function navigate(next: Selection): void {
    setNotice('')
    setError('')
    if (dirty) {
      setGuard(next)
      return
    }
    resetMode()
    setSelected(next)
    setMobilePane('detail')
    if (next.type !== 'item') {
      setExpanded((current) => new Set([...current, next.id]))
    }
  }

  function beginName(nextMode: Mode, initial = ''): void {
    setNotice('')
    setError('')
    setActionError('')
    setMode(nextMode)
    setNameDraft(initial)
    setMobilePane('detail')
  }

  function beginItem(
    item: TemplateItem,
    nextMode: 'create-item' | 'edit-item',
  ): void {
    const normalized = localizeFields(item)
    const photos = Object.fromEntries(
      normalized.inspection_points.map((point, index) => [
        String(index),
        String(point.evidence_requirements[0]?.min_count ?? 1),
      ]),
    )
    setItemDraft(normalized)
    setPhotoDraft(photos)
    setBaseline(JSON.stringify({ itemDraft: normalized, photoDraft: photos }))
    setErrors({})
    setAttemptedSave(false)
    setMode(nextMode)
    setNotice('')
    setError('')
  }

  async function saveName(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const name = nameDraft.trim()
    const nameError = !name ? '請填寫名稱' : ''
    const siblings = mode.includes('category')
      ? categories
          .filter((row) => row.id !== selectedCategory?.id)
          .map((row) => row.name)
      : systems
          .filter(
            (row) =>
              row.category_id === categoryId && row.id !== selectedSystem?.id,
          )
          .map((row) => row.name)
    const duplicate = siblings.some(
      (row) => row.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
    if (nameError || duplicate) {
      setErrors({ name: nameError || '已有同名項目，請換個名稱' })
      document.getElementById('tpl-name')?.focus()
      return
    }
    try {
      if (mode === 'create-category') {
        const created = await createTemplateCategory(name)
        setCategories((current) => [...current, created])
        setSelected({ type: 'category', id: created.id })
        setExpanded((current) => new Set([...current, created.id]))
        showNotice(`已新增工程類別「${created.name}」`)
      } else if (mode === 'rename-category' && selectedCategory) {
        const updated = await renameTemplateCategory(selectedCategory.id, name)
        setCategories((current) =>
          current.map((row) => (row.id === updated.id ? updated : row)),
        )
        showNotice(`已重新命名為「${updated.name}」`)
      } else if (mode === 'create-system' && selectedCategory) {
        const created = await createTemplateSystem(selectedCategory.id, name)
        setSystems((current) => [...current, created])
        setSelected({ type: 'system', id: created.id })
        setExpanded((current) => new Set([...current, created.id]))
        showNotice(`已新增系統「${created.name}」`)
      } else if (mode === 'rename-system' && selectedSystem) {
        const updated = await renameTemplateSystem(selectedSystem.id, name)
        setSystems((current) =>
          current.map((row) => (row.id === updated.id ? updated : row)),
        )
        showNotice(`已重新命名為「${updated.name}」`)
      }
      resetMode()
    } catch (caught) {
      fail(caught)
      if (isForbidden(caught)) setNameDraft(nameDraft)
    }
  }

  function updateDraft(changes: Partial<TemplateItem>): void {
    setItemDraft((current) => (current ? { ...current, ...changes } : current))
    setError('')
  }

  function updatePoint(
    index: number,
    changes: Partial<InspectionPoint>,
  ): void {
    setItemDraft((current) =>
      current
        ? {
            ...current,
            inspection_points: current.inspection_points.map(
              (point, position) =>
                position === index ? { ...point, ...changes } : point,
            ),
          }
        : current,
    )
    setError('')
  }

  function updateField(
    pointIndex: number,
    fieldIndex: number,
    changes: Partial<MeasurementField>,
  ): void {
    const point = itemDraft?.inspection_points[pointIndex]
    const field = point?.measurement_fields[fieldIndex]
    if (!point || !field) return
    const isBound = boundField(point) === field
    if (changes.field_type && isBound && changes.field_type !== 'number') {
      setError('此欄位正用於數值標準。請先解除綁定，再變更欄位型別。')
      return
    }
    const fields = point.measurement_fields.map((row, position) =>
      position === fieldIndex
        ? {
            ...row,
            ...changes,
            unit:
              changes.field_type === 'text'
                ? null
                : (changes.unit ?? row.unit ?? ''),
          }
        : row,
    )
    const standard = point.numeric_standard
    updatePoint(pointIndex, {
      measurement_fields: fields,
      numeric_standard:
        standard && isBound
          ? { ...standard, unit: fields[fieldIndex].unit ?? '' }
          : standard,
    })
  }

  function addPoint(): void {
    if (!itemDraft) return
    updateDraft({
      inspection_points: [
        ...itemDraft.inspection_points,
        blankPoint(itemDraft.inspection_points.length + 1),
      ],
    })
  }

  function removePoint(index: number): void {
    if (!itemDraft) return
    updateDraft({
      inspection_points: itemDraft.inspection_points
        .filter((_point, position) => position !== index)
        .map((point, position) => ({ ...point, sequence: position + 1 })),
    })
    setPhotoDraft((current) => {
      const next: Record<string, string> = {}
      Object.entries(current).forEach(([key, value]) => {
        const oldIndex = Number(key)
        if (oldIndex < index) next[String(oldIndex)] = value
        if (oldIndex > index) next[String(oldIndex - 1)] = value
      })
      return next
    })
  }

  const validateItem = useCallback((): Record<string, string> => {
    if (!itemDraft) return {}
    const result: Record<string, string> = {}
    if (!itemDraft.title.trim()) result.title = '請填寫查核項目名稱'
    if (
      systemItems.some(
        (row) =>
          row.id !== itemDraft.id &&
          row.title.trim().toLocaleLowerCase() ===
            itemDraft.title.trim().toLocaleLowerCase(),
      )
    ) {
      result.title = '此系統已有同名查核項目，請換個名稱'
    }
    if (itemDraft.inspection_points.length === 0) {
      result.points = '請至少新增一個查核項次'
    }
    itemDraft.inspection_points.forEach((point, pointIndex) => {
      const key = `point:${pointIndex}`
      if (!point.title.trim()) result[`${key}:title`] = '請填寫項次標題'
      point.measurement_fields.forEach((field, fieldIndex) => {
        const base = `${key}:field:${fieldIndex}`
        if (!field.name.trim()) {
          result[`${base}:name`] = '請填寫欄位名稱'
        }
        if (field.field_type === 'number' && !field.unit?.trim()) {
          result[`${base}:unit`] = '請填寫單位'
        }
      })
      const standard = point.numeric_standard
      if (standard) {
        if (!boundField(point)) {
          result[`${key}:binding`] = '請選擇要用來判定的數字欄位'
        }
        if (standard.condition === 'range') {
          if ((standard.range_form ?? 'tolerance') === 'interval') {
            const lower = Number(standard.lower_bound)
            const upper = Number(standard.upper_bound)
            if (!standard.lower_bound?.trim() || !Number.isFinite(lower)) {
              result[`${key}:lower`] = '請填寫有效的下限'
            }
            if (!standard.upper_bound?.trim() || !Number.isFinite(upper)) {
              result[`${key}:upper`] = '請填寫有效的上限'
            }
            if (
              Number.isFinite(lower) &&
              Number.isFinite(upper) &&
              lower > upper
            ) {
              result[`${key}:range`] = '下限不能大於上限'
            }
          } else {
            if (
              !standard.value?.trim() ||
              !Number.isFinite(Number(standard.value))
            ) {
              result[`${key}:value`] = '請填寫有效的標準值'
            }
            const tolerance = Number(standard.tolerance)
            if (!standard.tolerance?.trim() || !Number.isFinite(tolerance)) {
              result[`${key}:tolerance`] = '請填寫有效的容許誤差'
            } else if (tolerance < 0) {
              result[`${key}:tolerance`] = '容許誤差不能小於 0'
            }
          }
        } else {
          if (
            !standard.value?.trim() ||
            !Number.isFinite(Number(standard.value))
          ) {
            result[`${key}:value`] = '請填寫有效的標準值'
          }
          if (standard.tolerance?.trim()) {
            const tolerance = Number(standard.tolerance)
            if (!Number.isFinite(tolerance)) {
              result[`${key}:tolerance`] = '請填寫有效的容許誤差'
            } else if (tolerance < 0) {
              result[`${key}:tolerance`] = '容許誤差不能小於 0'
            }
          }
        }
      }
      if (point.text_standard && !point.text_standard.text.trim()) {
        result[`${key}:text`] = '請填寫標準文字'
      }
      const photos = photoDraft[String(pointIndex)] ?? '1'
      if (
        !photos.trim() ||
        !Number.isInteger(Number(photos)) ||
        Number(photos) < 1
      ) {
        result[`${key}:photos`] = '照片至少需要 1 張'
      }
    })
    return result
  }, [itemDraft, photoDraft, systemItems])

  function focusFirstError(nextErrors: Record<string, string>): void {
    const first = Object.keys(nextErrors)[0]
    if (!first) return
    window.setTimeout(() => {
      const fieldKey = first.endsWith(':range')
        ? first.slice(0, -':range'.length) + ':lower'
        : first
      const field = document.querySelector<HTMLElement>(
        `[data-error-key="${fieldKey}"]`,
      )
      const card = field?.closest('details')
      if (card) card.open = true
      field?.scrollIntoView?.({ block: 'center' })
      field?.focus()
    }, 0)
  }

  function wireItem(item: TemplateItem): TemplateItem {
    const next = forWire(item)
    return {
      ...next,
      inspection_points: next.inspection_points.map((point, index) => ({
        ...point,
        sequence: index + 1,
        evidence_requirements: [
          {
            min_count: Number(photoDraft[String(index)] ?? '1'),
          },
        ],
      })),
    }
  }

  async function saveItem(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!itemDraft) return
    setAttemptedSave(true)
    const found = validateItem()
    if (Object.keys(found).length) {
      setErrors(found)
      setError('')
      focusFirstError(found)
      return
    }
    try {
      const input = wireItem({ ...itemDraft, system_id: systemId })
      const result = itemDraft.id
        ? await updateTemplateItem(itemDraft.id, input)
        : await createTemplateItem(input)
      setItems((current) =>
        itemDraft.id
          ? current.map((row) =>
              row.id === result.id ? localizeFields(result) : row,
            )
          : [...current, localizeFields(result)],
      )
      setSelected({ type: 'item', id: result.id ?? '' })
      resetMode()
      showNotice('查核項目已儲存')
    } catch (caught) {
      fail(caught)
    }
  }

  async function confirmDelete(): Promise<void> {
    try {
      if (mode === 'delete-category' && selectedCategory) {
        await deleteTemplateCategory(selectedCategory.id)
        const previousIndex = categories.findIndex(
          (row) => row.id === selectedCategory.id,
        )
        const remaining = categories.filter(
          (row) => row.id !== selectedCategory.id,
        )
        const nextCategory =
          remaining[Math.min(previousIndex, remaining.length - 1)]
        setCategories(remaining)
        setSystems((current) =>
          current.filter((row) => row.category_id !== selectedCategory.id),
        )
        setSelected(
          nextCategory ? { type: 'category', id: nextCategory.id } : null,
        )
        showNotice(`已刪除「${selectedCategory.name}」`)
      } else if (mode === 'delete-system' && selectedSystem) {
        await deleteTemplateSystem(selectedSystem.id)
        setSystems((current) =>
          current.filter((row) => row.id !== selectedSystem.id),
        )
        setSelected({ type: 'category', id: selectedSystem.category_id })
        showNotice(`已刪除「${selectedSystem.name}」`)
      } else if (mode === 'delete-item' && selectedItem?.id) {
        await deleteTemplateItem(selectedItem.id)
        setItems((current) =>
          current.filter((row) => row.id !== selectedItem.id),
        )
        setSelected({ type: 'system', id: selectedItem.system_id })
        showNotice(`已刪除「${selectedItem.title}」`)
      }
      resetMode()
    } catch (caught) {
      setNotice('')
      setError('')
      setActionError(apiMessage(caught))
      setMode('view')
    }
  }

  function updateNumeric(
    index: number,
    changes: Partial<NonNullable<InspectionPoint['numeric_standard']>>,
  ): void {
    const point = itemDraft?.inspection_points[index]
    if (!point?.numeric_standard) return
    const numeric = { ...point.numeric_standard, ...changes }
    const bound = point.measurement_fields.find(
      (field) =>
        Boolean(numeric.measurement_field_client_key) &&
        field.clientKey === numeric.measurement_field_client_key,
    )
    updatePoint(index, {
      numeric_standard: { ...numeric, unit: bound?.unit ?? numeric.unit },
    })
  }

  function renderNameForm(): ReactNode {
    const heading =
      mode === 'create-category'
        ? '新增工程類別'
        : mode === 'create-system'
          ? `在「${selectedCategory?.name}」新增系統`
          : mode === 'rename-category'
            ? '重新命名工程類別'
            : '重新命名系統'
    const siblingNames =
      mode === 'rename-category'
        ? categories
            .filter((row) => row.id !== selectedCategory?.id)
            .map((row) => row.name)
        : mode === 'create-category'
          ? categories.map((row) => row.name)
          : mode === 'rename-system'
            ? systems
                .filter(
                  (row) =>
                    row.category_id === categoryId &&
                    row.id !== selectedSystem?.id,
                )
                .map((row) => row.name)
            : systems
                .filter((row) => row.category_id === categoryId)
                .map((row) => row.name)
    const duplicate =
      nameDraft.trim() &&
      siblingNames.some(
        (name) =>
          name.trim().toLocaleLowerCase() ===
          nameDraft.trim().toLocaleLowerCase(),
      )
    return (
      <form
        className="tpl-name-form"
        onSubmit={(event) => void saveName(event)}
      >
        <h2>{heading}</h2>
        <label htmlFor="tpl-name">
          名稱{' '}
          <span aria-hidden="true" className="tpl-required">
            *
          </span>
        </label>
        <input
          aria-describedby={errors.name ? 'tpl-name-error' : undefined}
          aria-invalid={Boolean(errors.name || duplicate)}
          autoFocus
          data-error-key="name"
          id="tpl-name"
          onChange={(event) => {
            setNameDraft(event.target.value)
            setErrors({})
            setError('')
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') resetMode()
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          aria-required="true"
          value={nameDraft}
        />
        {(errors.name || duplicate) && (
          <p className="tpl-field-error" id="tpl-name-error" role="alert">
            {errors.name || '已有同名項目，請換個名稱'}
          </p>
        )}
        <p className="tpl-hint">同一層名稱不可重複。</p>
        <div className="tpl-actions">
          <button
            className="btn-primary"
            disabled={Boolean(duplicate)}
            type="submit"
          >
            儲存
          </button>
          <button onClick={resetMode} type="button">
            取消
          </button>
          <span className="tpl-hint">Enter 儲存，Esc 取消</span>
        </div>
      </form>
    )
  }

  function renderItemEditor(): ReactNode {
    return (
      <TemplateItemEditor
        addPoint={addPoint}
        confirmField={confirmField}
        dirty={dirty}
        errors={attemptedSave ? validateItem() : errors}
        requestError={error}
        itemDraft={itemDraft}
        mode={mode as 'create-item' | 'edit-item'}
        photoDraft={photoDraft}
        readOnly={readOnly}
        removePoint={removePoint}
        resetMode={resetMode}
        saveItem={saveItem}
        selected={selected}
        selectedCategory={selectedCategory}
        selectedSystem={selectedSystem}
        setConfirmField={setConfirmField}
        setGuard={setGuard}
        setPhotoDraft={setPhotoDraft}
        systemId={systemId}
        updateDraft={updateDraft}
        updateField={updateField}
        updateNumeric={updateNumeric}
        updatePoint={updatePoint}
      />
    )
  }

  const editable = !readOnly
  const childCount =
    selected?.type === 'category'
      ? systems.filter((row) => row.category_id === selected.id).length
      : selected?.type === 'system'
        ? systemItems.length
        : 0
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 640

  function renderDetail(): ReactNode {
    if (guard) {
      return (
        <div
          className="tpl-guard"
          role="alertdialog"
          aria-label="尚未儲存的變更"
        >
          <p>
            <strong>這裡有尚未儲存的變更。</strong>
            要保留編輯，還是捨棄變更？
          </p>
          <button
            className="btn-primary"
            onClick={() => setGuard(null)}
            type="button"
          >
            保留編輯
          </button>
          <button
            className="btn-danger"
            onClick={() => {
              const next = guard
              setGuard(null)
              resetMode()
              setSelected(next)
              setMobilePane('detail')
            }}
            type="button"
          >
            捨棄變更
          </button>
        </div>
      )
    }
    if (
      mode === 'create-category' ||
      mode === 'create-system' ||
      mode === 'rename-category' ||
      mode === 'rename-system'
    ) {
      return renderNameForm()
    }
    if (mode === 'create-item' || mode === 'edit-item') {
      return renderItemEditor()
    }
    if (!selected) {
      if (categories.length > 0) {
        return (
          <div className="tpl-empty">
            <h2>選一個項目</h2>
            <p>從左側選一個工程類別、系統或查核項目，這裡會顯示內容。</p>
          </div>
        )
      }
      return (
        <div className="tpl-empty">
          <h2>還沒有工程類別</h2>
          <p>新增一個類別，開始整理查核項目。</p>
        </div>
      )
    }
    if (selected.type === 'category' && selectedCategory) {
      return (
        <>
          <p className="tpl-crumb">範本庫 / {selectedCategory.name}</p>
          <h2 tabIndex={-1}>{selectedCategory.name}</h2>
          <div className="tpl-actions">
            {editable && (
              <>
                <button
                  onClick={() =>
                    beginName('rename-category', selectedCategory.name)
                  }
                  type="button"
                >
                  重新命名
                </button>
                <button
                  className="btn-danger"
                  onClick={() => {
                    setNotice('')
                    setActionError(
                      childCount ? '此類別還有系統，請先處理系統。' : '',
                    )
                    setMode(childCount ? 'view' : 'delete-category')
                  }}
                  type="button"
                >
                  刪除
                </button>
                {actionError && mode !== 'delete-category' && (
                  <p className="tpl-field-error" role="alert">
                    {actionError}
                  </p>
                )}
                <button
                  className="btn-primary"
                  onClick={() => beginName('create-system')}
                  type="button"
                >
                  在「{selectedCategory.name}」新增系統
                </button>
              </>
            )}
          </div>
          {mode === 'delete-category' && (
            <InlineConfirm
              onCancel={() => setMode('view')}
              onConfirm={() => void confirmDelete()}
            >
              刪除「{selectedCategory.name}」？刪除後無法復原。
            </InlineConfirm>
          )}
          <h3>
            系統（
            {
              systems.filter((row) => row.category_id === selectedCategory.id)
                .length
            }
            ）
          </h3>
          {systems.filter((row) => row.category_id === selectedCategory.id)
            .length === 0 ? (
            <p className="tpl-empty-small">
              這個類別還沒有系統。新增第一個系統。
            </p>
          ) : (
            <ul className="tpl-detail-list">
              {systems
                .filter((row) => row.category_id === selectedCategory.id)
                .map((system) => (
                  <li key={system.id}>
                    <button
                      onClick={() =>
                        navigate({ type: 'system', id: system.id })
                      }
                      type="button"
                    >
                      {system.name}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </>
      )
    }
    if (selected.type === 'system' && selectedSystem) {
      return (
        <>
          <p className="tpl-crumb">
            範本庫 / {selectedCategory?.name} /{selectedSystem.name}
          </p>
          <h2 tabIndex={-1}>{selectedSystem.name}</h2>
          <div className="tpl-actions">
            {editable && (
              <>
                <button
                  onClick={() =>
                    beginName('rename-system', selectedSystem.name)
                  }
                  type="button"
                >
                  重新命名
                </button>
                <button
                  className="btn-danger"
                  onClick={() => {
                    setNotice('')
                    setActionError(
                      childCount ? '此系統還有查核項目，請先處理項目。' : '',
                    )
                    setMode(childCount ? 'view' : 'delete-system')
                  }}
                  type="button"
                >
                  刪除
                </button>
                {actionError && mode !== 'delete-system' && (
                  <p className="tpl-field-error" role="alert">
                    {actionError}
                  </p>
                )}
                <button
                  className="btn-primary"
                  onClick={() =>
                    beginItem(
                      blankTemplate(selectedSystem.id, systemItems.length + 1),
                      'create-item',
                    )
                  }
                  type="button"
                >
                  新增查核項目
                </button>
              </>
            )}
          </div>
          {mode === 'delete-system' && (
            <InlineConfirm
              onCancel={() => setMode('view')}
              onConfirm={() => void confirmDelete()}
            >
              刪除「{selectedSystem.name}」？刪除後無法復原。
            </InlineConfirm>
          )}
          <h3>查核項目（{systemItems.length}）</h3>
          {systemItems.length === 0 ? (
            <p className="tpl-empty-small">
              這個系統還沒有查核項目。新增第一個查核項目。
            </p>
          ) : (
            <ul className="tpl-detail-list">
              {systemItems.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() =>
                      navigate({ type: 'item', id: item.id ?? '' })
                    }
                    type="button"
                  >
                    {item.sequence}. {item.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )
    }
    if (selected.type === 'item' && selectedItem) {
      return (
        <>
          <p className="tpl-crumb">
            範本庫 / {selectedCategory?.name} /{selectedSystem?.name} /{' '}
            {selectedItem.title}
          </p>
          <h2 tabIndex={-1}>{selectedItem.title}</h2>
          {selectedItem.instruction && <p>{selectedItem.instruction}</p>}
          <div className="tpl-actions">
            {editable && (
              <>
                <button
                  className="btn-primary"
                  onClick={() => beginItem(selectedItem, 'edit-item')}
                  type="button"
                >
                  編輯查核項目
                </button>
                <button
                  className="btn-danger"
                  onClick={() => {
                    setActionError('')
                    setMode('delete-item')
                  }}
                  type="button"
                >
                  刪除查核項目
                </button>
                {actionError && (
                  <p className="tpl-field-error" role="alert">
                    {actionError}
                  </p>
                )}
              </>
            )}
          </div>
          {mode === 'delete-item' && (
            <InlineConfirm
              onCancel={() => setMode('view')}
              onConfirm={() => void confirmDelete()}
            >
              刪除「{selectedItem.title}」？刪除後無法復原。
            </InlineConfirm>
          )}
          <h3>查核項次（{selectedItem.inspection_points.length}）</h3>
          {selectedItem.inspection_points.map((point, index) => (
            <InspectionPointCard
              index={index}
              key={point.id ?? index}
              point={point}
            />
          ))}
        </>
      )
    }
    return (
      <div className="tpl-empty">
        <h2>選一個項目</h2>
        <p>從左側選一個工程類別、系統或查核項目，這裡會顯示內容。</p>
      </div>
    )
  }

  return (
    <section aria-labelledby="templates-heading" className="tpl-page">
      <header className="tpl-page-heading">
        <h1 id="templates-heading">範本管理</h1>
        {readOnly && <span className="tpl-readonly">唯讀瀏覽</span>}
      </header>
      {loading ? (
        <p>載入中…</p>
      ) : (
        <div className="tpl-layout" data-pane={mobilePane}>
          <div className="tpl-list-pane">
            {mobilePane === 'detail' && (
              <button
                className="tpl-mobile-back"
                onClick={() => setMobilePane('list')}
                type="button"
              >
                ‹ 返回
              </button>
            )}
            <TemplateLibraryNav
              categories={categories}
              expanded={expanded}
              items={items}
              loadedCategoryIds={loadedCategoryIds}
              loadedSystemIds={loadedSystemIds}
              mobile={isMobile}
              onAddCategory={() => beginName('create-category')}
              onSelect={navigate}
              onToggle={(id) =>
                setExpanded((current) => {
                  const next = new Set(current)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  return next
                })
              }
              readOnly={readOnly}
              selected={selected}
              systems={systems}
              mode="manage"
            />
          </div>
          <section className="tpl-detail-pane" aria-label="範本詳情">
            {mobilePane === 'detail' && (
              <button
                className="tpl-mobile-back"
                onClick={() => setMobilePane('list')}
                type="button"
              >
                ‹ 返回清單
              </button>
            )}
            {guard ? (
              renderDetail()
            ) : (
              <>
                {error && mode !== 'create-item' && mode !== 'edit-item' && (
                  <p
                    className="tpl-detail-notice tpl-notice-error"
                    role="alert"
                  >
                    {error}
                  </p>
                )}
                {notice && (
                  <p className="tpl-detail-notice tpl-notice-ok" role="status">
                    {notice}
                  </p>
                )}
                {renderDetail()}
              </>
            )}
          </section>
        </div>
      )}
    </section>
  )
}
