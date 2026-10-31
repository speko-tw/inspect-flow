import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { HttpError, isForbidden } from '../../http'
import AccessDeniedPage from '../../components/layout/AccessDeniedPage'
import { BackButton } from '../../layout/BackLink'
import { PAGE_TITLES } from '../../layout/navigationLabels'
import { ConfirmBox } from '../../ui/ConfirmBox'
import { UnsavedLeaveBox } from '../../ui/navigation'
import * as navigationGuard from '../../ui/navigation'
import { RequiredMark } from '../../ui/Form'
import { fieldErrorMessage, mapFieldErrors } from '../../ui/fieldErrors'
import { blockImeEnter, useSubmitGuard } from '../../ui/submitGuard'
import { managementErrorMessage } from '../api'
import { InspectionPointCard } from './InspectionPointCard'
import { TemplateItemEditor } from './TemplateItemEditor'
import { validateItemFields } from './itemFieldValidation'
import { TemplateLibraryNav } from './TemplateLibraryNav'
import {
  blankPoint,
  boundField,
  forWire,
  localizeTemplateItem,
  TEMPLATE_FIELD_ERROR_MESSAGES,
  templateFieldErrorBindings,
} from './templateEditorUtils'
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
// 「尚未儲存的變更」確認框的待辦：使用者選「捨棄變更」才執行 `proceed`。
// 為什麼不只存 Selection：離開編輯的路徑不只換選取項目（例如左側
// 「新增工程類別」要切到新增表單），都必須先過這道確認（TPL-AC16）。
type Guard = { key: string; proceed: () => void }
type FocusRequest = { id: number; key: string }
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

function blankTemplate(systemId: string, sequence: number): TemplateItem {
  return {
    system_id: systemId,
    sequence,
    title: '',
    instruction: '',
    inspection_points: [blankPoint(1)],
  }
}

const TEMPLATE_NOT_SAVED =
  '範本未儲存，輸入內容已保留。請重新檢查查核項次與單位。'

const TEMPLATE_ERROR_CODES: Record<string, string> = {
  'template.name_conflict': '同一層已有相同名稱，請換個名稱。',
  'template.category_not_empty': '此類別還有系統，請先處理系統。',
  'template.system_not_empty': '此系統還有查核項目，請先處理項目。',
  'request.validation_failed': TEMPLATE_NOT_SAVED,
}

function apiMessage(error: unknown): string {
  if (error instanceof HttpError) {
    const specific = TEMPLATE_ERROR_CODES[error.code ?? '']
    if (specific) return specific
    if (error.status === 422) return TEMPLATE_NOT_SAVED
  }
  return managementErrorMessage(error)
}

/**
 * 顯示範本分類、系統與查核項目，並管理其編輯及儲存流程。
 * 只有具 `template.manage` 的使用者可寫入；唯讀狀態仍可檢視範本。
 */
export default function TemplatesPage({ canManage }: { canManage: boolean }) {
  const location = useLocation()
  const navigateRoute = useNavigate()
  const [wizardNotice, setWizardNotice] = useState(() => {
    const state = location.state as {
      savedTemplateTitle?: unknown
      savedTemplatePath?: unknown
    } | null
    return typeof state?.savedTemplateTitle === 'string' &&
      typeof state.savedTemplatePath === 'string'
      ? `已存入『${state.savedTemplatePath}』：${state.savedTemplateTitle}`
      : ''
  })
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
  const [serverFieldErrors, setServerFieldErrors] = useState<
    Record<string, string>
  >({})
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)
  const focusRequestId = useRef(0)
  const [attemptedSave, setAttemptedSave] = useState(false)
  const [actionError, setActionError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const handledWizardResult = useRef(false)
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [readOnly, setReadOnly] = useState(!canManage)
  const [mobilePane, setMobilePane] = useState<'list' | 'detail'>('list')
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 40rem)').matches,
  )
  const [guard, setGuard] = useState<Guard | null>(null)
  const [confirmField, setConfirmField] = useState('')
  // 儲存與刪除共用一道防護：送出中不接受第二次送出（#507）。
  const submitGuard = useSubmitGuard()

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(max-width: 40rem)')
    const update = () => setIsMobile(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])

  // ref 防止 StrictMode／依賴更新重複選取；replace 清掉一次性回傳資料。
  useEffect(() => {
    const state = location.state as {
      savedTemplateId?: unknown
      savedCategoryId?: unknown
      savedSystemId?: unknown
      savedTemplateTitle?: unknown
      savedTemplatePath?: unknown
    } | null
    if (!state) return
    if (
      handledWizardResult.current ||
      typeof state.savedTemplateId !== 'string' ||
      typeof state.savedCategoryId !== 'string' ||
      typeof state.savedSystemId !== 'string' ||
      !categories.length
    ) {
      return
    }
    handledWizardResult.current = true
    const savedTemplateId = state.savedTemplateId
    const savedCategoryId = state.savedCategoryId
    const savedSystemId = state.savedSystemId
    let active = true
    async function selectSavedTemplate() {
      const categoryId = savedCategoryId
      const systemId = savedSystemId
      const categorySystems = await listTemplateSystems(categoryId)
      if (!active) return
      const result = await getSystemTemplates(systemId)
      if (!active) return
      setSystems((current) => [
        ...current.filter((system) => system.category_id !== categoryId),
        ...categorySystems,
      ])
      setLoadedCategoryIds((current) => new Set(current).add(categoryId))
      setItems((current) => [
        ...current.filter((item) => item.system_id !== systemId),
        ...result.items.map(localizeTemplateItem),
      ])
      setLoadedSystemIds((current) => new Set(current).add(systemId))
      setSelected({ type: 'item', id: savedTemplateId })
      setExpanded(new Set([categoryId, systemId]))
      setMobilePane('detail')
      // ref 防止重複載入選取；replace 清掉一次性 state，避免回頁重播橫幅。
      navigateRoute(location.pathname, { replace: true, state: null })
    }
    void selectSavedTemplate().catch((caught: unknown) => {
      if (active) fail(caught)
    })
    return () => {
      active = false
    }
  }, [categories, location.pathname, location.state, navigateRoute])

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
  // 路由離開保護與樹狀選取保護各自涵蓋不同離開方式，需同步維持。
  const leaveGuard = navigationGuard.useUnsavedNavigationGuard(dirty)

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
        if (isForbidden(caught)) {
          setAccessDenied(true)
          setError('')
        } else {
          setError(managementErrorMessage(caught))
        }
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
        if (!active) return
        if (isForbidden(caught)) {
          setAccessDenied(true)
          setError('')
        } else {
          setError(managementErrorMessage(caught))
        }
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
            ...result.items.map(localizeTemplateItem),
          ])
        }
      })
      .catch((caught: unknown) => {
        if (!active) return
        if (isForbidden(caught)) {
          setAccessDenied(true)
          setError('')
        } else {
          setError(managementErrorMessage(caught))
        }
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
    setServerFieldErrors({})
    setFocusRequest(null)
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
    setWizardNotice('')
    setNotice('')
    setError('')
    if (dirty) {
      setGuard(selectionGuard(next))
      // 手機一次只顯示一個窗格；確認框在詳情窗格，要切過去才看得到。
      setMobilePane('detail')
      return
    }
    resetMode()
    setSelected(next)
    setMobilePane('detail')
    if (next.type !== 'item') {
      setExpanded((current) => new Set([...current, next.id]))
    }
  }

  function selectionGuard(next: Selection): Guard {
    return {
      key: `${next.type}:${next.id}`,
      proceed: () => {
        resetMode()
        setSelected(next)
        setMobilePane('detail')
      },
    }
  }

  // 左側「新增工程類別」：編輯中先走確認，不得直接丟掉未儲存的內容。
  function addCategory(): void {
    if (dirty) {
      setNotice('')
      setError('')
      setGuard({
        key: 'create-category',
        proceed: () => {
          resetMode()
          beginName('create-category')
        },
      })
      setMobilePane('detail')
      return
    }
    beginName('create-category')
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
    const localized = localizeTemplateItem(item)
    const normalized = {
      ...localized,
      inspection_points: localized.inspection_points.map((point) => ({
        ...point,
        measurement_fields: point.measurement_fields.map((field) => ({
          ...field,
          nameLinked: field.name === point.title,
        })),
      })),
    }
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
    setServerFieldErrors({})
    setFocusRequest(null)
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
    if (!submitGuard.enter()) return
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
    } finally {
      submitGuard.leave()
    }
  }

  function updateDraft(changes: Partial<TemplateItem>): void {
    setItemDraft((current) => (current ? { ...current, ...changes } : current))
    if (changes.title !== undefined) {
      setServerFieldErrors((current) => {
        if (!('title' in current)) return current
        const next = { ...current }
        delete next.title
        return next
      })
    }
    setError('')
  }

  function updatePoint(
    index: number,
    changes: Partial<InspectionPoint>,
  ): void {
    clearPointServerErrors(index)
    setItemDraft((current) =>
      current
        ? {
            ...current,
            inspection_points: current.inspection_points.map(
              (point, position) => {
                if (position !== index) return point
                const next = { ...point, ...changes }
                if (changes.title !== undefined) {
                  next.measurement_fields = next.measurement_fields.map(
                    (field) =>
                      field.nameLinked
                        ? { ...field, name: changes.title!.trim() }
                        : field,
                  )
                }
                return next
              },
            ),
          }
        : current,
    )
    setError('')
  }

  function clearPointServerErrors(index: number): void {
    setServerFieldErrors((current) => {
      const prefix = `point:${index}:`
      const next = Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.startsWith(prefix)),
      )
      return Object.keys(next).length === Object.keys(current).length
        ? current
        : next
    })
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
            nameLinked: changes.name === undefined && row.nameLinked,
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
    setServerFieldErrors((current) =>
      Object.keys(current).some((key) => key.startsWith('point:'))
        ? Object.fromEntries(
            Object.entries(current).filter(
              ([key]) => !key.startsWith('point:'),
            ),
          )
        : current,
    )
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
    const result = validateItemFields(itemDraft, photoDraft)
    if (
      systemItems.some(
        (row) =>
          row.id !== itemDraft.id &&
          row.title.trim().toLocaleLowerCase() ===
            itemDraft.title.trim().toLocaleLowerCase(),
      )
    ) {
      // TPL-R18：名稱位於表單最前，重名也須先聚焦並列為摘要首項。
      delete result.title
      return { title: '此系統已有同名查核項目，請換個名稱', ...result }
    }
    return result
  }, [itemDraft, photoDraft, systemItems])

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

  async function saveItem(
    event: FormEvent<HTMLFormElement>,
  ): Promise<number[] | null> {
    event.preventDefault()
    if (!itemDraft) return null
    setAttemptedSave(true)
    const found = validateItem()
    if (Object.keys(found).length) {
      setErrors(found)
      setServerFieldErrors({})
      setError('')
      focusFirstError(found)
      return [
        ...new Set(
          Object.keys(found)
            .map((key) => /^point:(\d+):/.exec(key)?.[1])
            .filter((index): index is string => index !== undefined)
            .map(Number),
        ),
      ]
    }
    if (!submitGuard.enter()) return null
    setError('')
    setServerFieldErrors({})
    try {
      const input = wireItem({ ...itemDraft, system_id: systemId })
      const result = itemDraft.id
        ? await updateTemplateItem(itemDraft.id, input)
        : await createTemplateItem(input)
      setItems((current) =>
        itemDraft.id
          ? current.map((row) =>
              row.id === result.id ? localizeTemplateItem(result) : row,
            )
          : [...current, localizeTemplateItem(result)],
      )
      setSelected({ type: 'item', id: result.id ?? '' })
      resetMode()
      showNotice('查核項目已儲存')
      return null
    } catch (caught) {
      if (
        caught instanceof HttpError &&
        caught.status === 422 &&
        caught.fields?.length
      ) {
        const mapped = mapFieldErrors(
          caught.fields,
          templateFieldErrorBindings(itemDraft),
        )
        const messages = Object.fromEntries(
          Object.entries(mapped.errors).map(([key, code]) => [
            key,
            fieldErrorMessage(code, TEMPLATE_FIELD_ERROR_MESSAGES),
          ]),
        )
        setServerFieldErrors(messages)
        setError(mapped.unmatched.length ? TEMPLATE_NOT_SAVED : '')
        const firstErrorKey = Object.keys(messages)[0]
        if (firstErrorKey) {
          focusRequestId.current += 1
          setFocusRequest({ id: focusRequestId.current, key: firstErrorKey })
        }
        return [
          ...new Set(
            Object.keys(messages)
              .map((key) => /^point:(\d+):/.exec(key)?.[1])
              .filter((index): index is string => index !== undefined)
              .map(Number),
          ),
        ]
      }
      setServerFieldErrors({})
      fail(caught)
      return null
    } finally {
      submitGuard.leave()
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!submitGuard.enter()) return
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
    } finally {
      submitGuard.leave()
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
        onKeyDown={blockImeEnter}
        onSubmit={(event) => void saveName(event)}
      >
        <h2>{heading}</h2>
        <label htmlFor="tpl-name">
          名稱 <RequiredMark />
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
            if (blockImeEnter(event)) return
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
          <p className="field-error" id="tpl-name-error" role="alert">
            {errors.name || '已有同名項目，請換個名稱'}
          </p>
        )}
        <p className="tpl-hint muted-text">同一層名稱不可重複。</p>
        <div className="tpl-actions">
          <button onClick={resetMode} type="button">
            取消
          </button>
          <button
            className="btn-primary"
            disabled={Boolean(duplicate)}
            type="submit"
          >
            儲存
          </button>
          <span className="tpl-hint muted-text">Enter 儲存，Esc 取消</span>
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
        errors={{
          ...serverFieldErrors,
          ...(attemptedSave ? validateItem() : errors),
        }}
        focusRequest={focusRequest}
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
        setGuard={(next) => setGuard(next ? selectionGuard(next) : null)}
        setPhotoDraft={setPhotoDraft}
        clearPointServerErrors={clearPointServerErrors}
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
  function renderDetail(): ReactNode {
    if (guard) {
      return (
        <ConfirmBox
          key={guard.key}
          cancelLabel="保留編輯"
          confirmLabel="捨棄變更"
          label="尚未儲存的變更"
          onCancel={() => setGuard(null)}
          onConfirm={() => {
            const pending = guard
            setGuard(null)
            pending.proceed()
          }}
          role="alertdialog"
          variant="danger"
        >
          <p>
            <strong>這裡有尚未儲存的變更。</strong>
            要保留編輯，還是捨棄變更？
          </p>
        </ConfirmBox>
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
          <p className="tpl-crumb muted-text">
            範本庫 / {selectedCategory.name}
          </p>
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
                  className="btn-danger-outline"
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
                  <p className="field-error" role="alert">
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
            <ConfirmBox
              confirmLabel="確認刪除"
              label="刪除確認"
              onCancel={() => setMode('view')}
              onConfirm={confirmDelete}
              variant="danger"
            >
              <p>刪除「{selectedCategory.name}」？刪除後無法復原。</p>
            </ConfirmBox>
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
            <p className="tpl-empty-small muted-text">
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
          <p className="tpl-crumb muted-text">
            範本庫 / {selectedCategory?.name} / {selectedSystem.name}
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
                  className="btn-danger-outline"
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
                  <p className="field-error" role="alert">
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
            <ConfirmBox
              confirmLabel="確認刪除"
              label="刪除確認"
              onCancel={() => setMode('view')}
              onConfirm={confirmDelete}
              variant="danger"
            >
              <p>刪除「{selectedSystem.name}」？刪除後無法復原。</p>
            </ConfirmBox>
          )}
          <h3>查核項目（{systemItems.length}）</h3>
          {systemItems.length === 0 ? (
            <p className="tpl-empty-small muted-text">
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
          <p className="tpl-crumb muted-text">
            範本庫 / {selectedCategory?.name} / {selectedSystem?.name} /{' '}
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
                  className="btn-danger-outline"
                  onClick={() => {
                    setActionError('')
                    setMode('delete-item')
                  }}
                  type="button"
                >
                  刪除查核項目
                </button>
                {actionError && (
                  <p className="field-error" role="alert">
                    {actionError}
                  </p>
                )}
              </>
            )}
          </div>
          {mode === 'delete-item' && (
            <ConfirmBox
              confirmLabel="確認刪除"
              label="刪除確認"
              onCancel={() => setMode('view')}
              onConfirm={confirmDelete}
              variant="danger"
            >
              <p>刪除「{selectedItem.title}」？刪除後無法復原。</p>
            </ConfirmBox>
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

  if (accessDenied) return <AccessDeniedPage />

  return (
    <section aria-labelledby="templates-heading" className="tpl-page">
      <UnsavedLeaveBox guard={leaveGuard} />
      <header className="tpl-page-heading">
        <h1 id="templates-heading">{PAGE_TITLES.templates}</h1>
        {readOnly && <span className="tpl-readonly">唯讀瀏覽</span>}
        {canManage && (
          <Link className="btn" to="/templates/from-project">
            從專案存為範本
          </Link>
        )}
      </header>
      {wizardNotice && (
        <p className="notice-success" role="status">
          {wizardNotice}
        </p>
      )}
      {loading ? (
        <p>載入中…</p>
      ) : (
        <div className="tpl-layout" data-pane={mobilePane}>
          <div className="tpl-list-pane">
            <TemplateLibraryNav
              categories={categories}
              expanded={expanded}
              items={items}
              loadedCategoryIds={loadedCategoryIds}
              loadedSystemIds={loadedSystemIds}
              mobile={isMobile}
              onAddCategory={addCategory}
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
              <BackButton
                className="tpl-mobile-back"
                onClick={() => setMobilePane('list')}
              >
                返回清單
              </BackButton>
            )}
            {guard ? (
              renderDetail()
            ) : (
              <>
                {error && mode !== 'create-item' && mode !== 'edit-item' && (
                  <p className="tpl-detail-notice notice-error" role="alert">
                    {error}
                  </p>
                )}
                {notice && (
                  <p
                    className="tpl-detail-notice notice-success"
                    role="status"
                  >
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
