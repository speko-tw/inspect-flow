import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'

import { httpErrorMessage, isForbidden, isNotFound } from '../../http'
import RouteNotFound from '../../RouteNotFound'
import { StatusBadge } from '../../ui/Badge'
import { ConfirmBox } from '../../ui/ConfirmBox'
import { mapFieldErrors } from '../../ui/fieldErrors'
import { useSubmitGuard } from '../../ui/submitGuard'
import { ManagementApiError } from '../api'
import { TemplateItemEditor } from '../templates/TemplateItemEditor'
import {
  boundField,
  localizeField,
  templateFieldErrorBindings,
} from '../templates/templateEditorUtils'
import type {
  InspectionPoint,
  TemplateItem,
} from '../templates/api'
import {
  type AffectedTask,
  type ProjectItemApi,
  type ProjectItemChange,
  type ProjectItemChangeResult,
  type ProjectItemPreview,
  type TaskStatus,
} from './api'

const REINSPECTION_CHOICE_ERROR = [
  '任務使用狀況已更新，',
  '請重新確認受影響任務與查核選擇。',
].join('')

const ARCHIVED_PLAN_ERROR = [
  '此項目有任務位於封存計畫，',
  '取消封存後才能修改。',
].join('')

const NO_RESULT_TEXT = '任務尚未填寫結果，直接改用新標準'

const HAS_RESULT_TEXT = [
  '已填的舊結果與照片會保留供查詢，但不再算數，',
  '任務需要重新查核',
].join('')

// 依實際影響說明：後端結果只帶任務動作，是否已有結果用修改前的
// 影響預覽（`hasResult`）判斷；草稿與已取消任務不屬於重查範圍。
function reinspectionResultText(tasks: AffectedTask[]): string {
  const relevant = tasks.filter(
    (task) => task.status !== 'DRAFT' && task.status !== 'CANCELLED',
  )
  const withResult = relevant.some((task) => task.hasResult)
  const withoutResult = relevant.some((task) => !task.hasResult)
  if (withResult && withoutResult) {
    return [
      `已有結果的任務：${HAS_RESULT_TEXT}；`,
      '尚未填寫結果的任務：直接改用新標準。',
    ].join('')
  }
  if (withResult) return `${HAS_RESULT_TEXT}。`
  if (withoutResult) return `${NO_RESULT_TEXT}。`
  return ''
}

const DRAFT_ONLY_RESULT_TEXT = '草稿任務已直接更新為新內容，沒有重新查核。'

// 依 IP-R04：PENDING／IN_PROGRESS 維持原狀、COMPLETED 退回進行中；
// 只有已有結果的項目才作廢舊結果並待重查，待重查項目補查前不能完成。
const REINSPECT_YES_HINT = [
  '已派出的任務會改用新標準；若已填過結果，',
  '舊結果與照片會保留供查詢，但不再算數，該項目要重新查核。',
  '已完成的任務會退回進行中，有待重查項目的任務補查完成前不能再完成。',
].join('')

const REINSPECT_NO_HINT =
  '只更正項目的文字，任務狀態、已填的結果與照片都不變。'

function isReinspectionChoiceRequired(error: unknown): boolean {
  return (
    error instanceof ManagementApiError &&
    error.status === 422 &&
    error.code === 'project_inspection_item.reinspection_choice_required'
  )
}

function errorMessage(error: unknown): string {
  if (isForbidden(error)) {
    return '你沒有權限修改此專案' + '查核項目。'
  }
  if (isReinspectionChoiceRequired(error)) {
    return REINSPECTION_CHOICE_ERROR
  }
  return httpErrorMessage(error, {
    codes: {
      'inspection_plan.archived': ARCHIVED_PLAN_ERROR,
      'project_inspection_item.structure_locked': [
        '此項目已有任務使用；若要增減查核項次或實測欄位、',
        '變更欄位類型，請選擇「要」重新查核。',
      ].join(''),
      'project_inspection_item.points_required': [
        '此項目已有任務使用，',
        '至少要保留一項查核項次。',
      ].join(''),
      'resource.not_found': '找不到此查核項目，請返回專案重新選擇。',
      'request.validation_failed': '請檢查項目名稱與查核項次的必填欄位。',
      'inspection_task.invalid_transition':
        '任務狀態已變更，請重新載入後再試。',
    },
    fallback: '載入或儲存失敗，請稍後再試。',
  })
}

function updatePoint(
  points: InspectionPoint[],
  sequence: number,
  update: Partial<InspectionPoint>,
): InspectionPoint[] {
  return points.map((point, index) =>
    index === sequence ? { ...point, ...update } : point,
  )
}

function taskConsequence(status: TaskStatus): string {
  if (status === 'DRAFT') return '草稿任務會直接更新為新內容'
  if (status === 'PENDING') return '維持待開始'
  if (status === 'IN_PROGRESS') return '維持進行中，已有結果的項目改列待重查'
  if (status === 'COMPLETED') return '退回進行中，受影響項目改列待重查'
  return '維持已取消；恢復時才套用新內容，原有結果若受影響才待重查'
}

// 後端只要有任務使用此項目就要求帶 `reinspect`；草稿任務一律在原任務內
// 更新、不產生待重查，所以全部是草稿時不需要使用者選擇。
function isDraftOnly(tasks: AffectedTask[]): boolean {
  return tasks.length > 0 && tasks.every((task) => task.status === 'DRAFT')
}

function taskLocation(task: AffectedTask): string {
  return (
    [task.zoneName, task.locationText].filter(Boolean).join('・') ||
    '地點未指定'
  )
}

function taskLabel(task: AffectedTask): string {
  return `${task.name}（${task.planName}；${taskLocation(task)}）`
}

function localizeProjectPoints(points: InspectionPoint[]): InspectionPoint[] {
  return points.map((point) => {
    const fields = point.measurement_fields.map(localizeField)
    const standard = point.numeric_standard
    const boundKey =
      standard?.measurement_field_client_key ??
      fields.find(
        (field) =>
          field.client_id === standard?.measurement_field_client_id ||
          field.id === standard?.measurement_field_id,
      )?.clientKey
    return {
      ...point,
      measurement_fields: fields,
      numeric_standard: standard
        ? { ...standard, measurement_field_client_key: boundKey }
        : null,
    }
  })
}

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

function makeDraft(
  item: ProjectItemPreview['item'],
  points = item.inspection_points,
): TemplateItem {
  return {
    system_id: item.id,
    sequence: item.sequence,
    title: item.title,
    instruction: item.instruction,
    inspection_points: points,
  }
}

function hasStructureChange(
  before: InspectionPoint[],
  after: InspectionPoint[],
): boolean {
  const afterById = new Map(
    after.filter((point) => point.id).map((point) => [point.id!, point]),
  )
  if (before.length !== after.length) return true
  for (const point of before) {
    if (!point.id) continue
    const updated = afterById.get(point.id)
    if (!updated) return true
    const standardKind = (row: InspectionPoint) =>
      row.numeric_standard ? 'numeric' : row.text_standard ? 'text' : 'none'
    if (standardKind(point) !== standardKind(updated)) return true
    const bindingIdentity = (row: InspectionPoint) => {
      const standard = row.numeric_standard
      if (!standard) return null
      const field = row.measurement_fields.find(
        (candidate) =>
          candidate.clientKey === standard.measurement_field_client_key ||
          candidate.id === standard.measurement_field_id ||
          candidate.client_id === standard.measurement_field_client_id,
      )
      return field?.id ?? field?.client_id ?? field?.clientKey ?? null
    }
    if (
      bindingIdentity(point) !== bindingIdentity(updated) ||
      point.numeric_standard?.unit !== updated.numeric_standard?.unit
    ) {
      return true
    }
    const afterFields = new Map(
      updated.measurement_fields
        .filter((field) => field.id)
        .map((field) => [field.id!, field]),
    )
    if (point.measurement_fields.length !== updated.measurement_fields.length) {
      return true
    }
    for (const field of point.measurement_fields) {
      if (!field.id) continue
      const next = afterFields.get(field.id)
      if (
        !next ||
        next.field_type !== field.field_type ||
        next.unit !== field.unit
      ) {
        return true
      }
    }
  }
  return false
}

function removesStructure(
  before: InspectionPoint[],
  after: InspectionPoint[],
): boolean {
  const afterById = new Map(
    after.filter((point) => point.id).map((point) => [point.id!, point]),
  )
  for (const point of before) {
    if (!point.id) continue
    const updated = afterById.get(point.id)
    if (!updated) return true
    const fieldIds = new Set(
      updated.measurement_fields
        .map((field) => field.id)
        .filter((id): id is string => Boolean(id)),
    )
    if (
      point.measurement_fields.some(
        (field) => field.id && !fieldIds.has(field.id),
      )
    ) {
      return true
    }
  }
  return false
}

function validateDraft(
  item: TemplateItem,
  photos: Record<string, string>,
): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!item.title.trim()) errors.title = '請填寫查核項目名稱'
  if (item.inspection_points.length === 0) {
    errors.points = '請至少新增一個查核項次'
  }
  item.inspection_points.forEach((point, pointIndex) => {
    const key = `point:${pointIndex}`
    if (!point.title.trim()) errors[`${key}:title`] = '請填寫項次標題'
    point.measurement_fields.forEach((field, fieldIndex) => {
      const fieldKey = `${key}:field:${fieldIndex}`
      if (!field.name.trim()) {
        errors[`${fieldKey}:name`] = '請填寫欄位名稱'
      }
      if (field.field_type === 'number' && !field.unit?.trim()) {
        errors[`${fieldKey}:unit`] = '請填寫數字欄位的單位'
      }
    })
    const standard = point.numeric_standard
    if (standard) {
      if (!boundField(point)) errors[`${key}:binding`] = '請選擇數字欄位'
      if (standard.condition === 'range' && standard.range_form === 'interval') {
        const lower = Number(standard.lower_bound)
        const upper = Number(standard.upper_bound)
        if (!Number.isFinite(lower)) errors[`${key}:lower`] = '請填寫有效下限'
        if (!Number.isFinite(upper)) errors[`${key}:upper`] = '請填寫有效上限'
        if (Number.isFinite(lower) && Number.isFinite(upper) && lower > upper) {
          errors[`${key}:range`] = '下限不能大於上限'
        }
      } else {
        if (!standard.value?.trim() || !Number.isFinite(Number(standard.value))) {
          errors[`${key}:value`] = '請填寫有效標準值'
        }
        if (standard.condition === 'range') {
          const tolerance = Number(standard.tolerance)
          if (
            !standard.tolerance?.trim() ||
            !Number.isFinite(tolerance) ||
            tolerance < 0
          ) {
            errors[`${key}:tolerance`] = '請填寫大於或等於 0 的容許誤差'
          }
        }
      }
    }
    if (point.text_standard && !point.text_standard.text.trim()) {
      errors[`${key}:text`] = '請填寫文字標準'
    }
    const count = Number(photos[String(pointIndex)] ?? '1')
    if (!Number.isInteger(count) || count < 1) {
      errors[`${key}:photos`] = '照片至少要 1 張'
    }
  })
  return errors
}

function fieldErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    'field.required': '請填寫此欄位。',
    'field.invalid': '欄位格式不正確，請檢查輸入內容。',
    'field.out_of_range': '數值超出允許範圍。',
    'template.sequence_duplicate': '項次順序重複，請檢查項次。',
    'template.photo_requirement_count': '每個項次必須設定一筆照片需求。',
    'template.client_id_duplicate': '實測欄位識別重複，請重新設定欄位。',
    'template.numeric_field_unbound': '請選擇有效的數字欄位。',
    'template.numeric_unit_required': '請填寫數字欄位的單位。',
    'template.bound_field_unit_forbidden': '綁定欄位的單位由數值標準帶入。',
  }
  return messages[code] ?? '欄位內容不符合規則，請檢查後再試。'
}

export default function ProjectItemChangePage({
  api,
}: {
  api: ProjectItemApi
}) {
  const { projectId, itemId } = useParams()
  const navigate = useNavigate()
  const [preview, setPreview] = useState<ProjectItemPreview | null>(null)
  const [title, setTitle] = useState('')
  const [instruction, setInstruction] = useState('')
  const [inspectionPoints, setInspectionPoints] = useState<InspectionPoint[]>(
    [],
  )
  const [reinspect, setReinspect] = useState<boolean | null>(null)
  const [result, setResult] = useState<ProjectItemChangeResult | null>(null)
  const [resultTasks, setResultTasks] = useState(
    [] as ProjectItemPreview['affectedTasks'],
  )
  const [confirming, setConfirming] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [busy, setBusy] = useState(false)
  const guard = useSubmitGuard()
  const [error, setError] = useState('')
  const [serverFieldErrors, setServerFieldErrors] = useState<
    Record<string, string>
  >({})
  const [focusRequest, setFocusRequest] = useState<{
    id: number
    key: string
  } | null>(null)
  const focusRequestId = useRef(0)
  const [photoDraft, setPhotoDraft] = useState<Record<string, string>>({})
  const [confirmField, setConfirmField] = useState('')
  const [leaving, setLeaving] = useState(false)
  const [attemptedSave, setAttemptedSave] = useState(false)
  const baselineRef = useRef('')
  const dialogHeadingRef = useRef<HTMLHeadingElement>(null)
  const actionErrorRef = useRef<HTMLParagraphElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const editorValues = {
    title,
    instruction,
    inspectionPoints,
    photoDraft,
  }
  const dirty = baselineRef.current !== JSON.stringify(editorValues)
  const draftOnly = preview ? isDraftOnly(preview.affectedTasks) : false
  const hasDraft = preview
    ? preview.affectedTasks.some((task) => task.status === 'DRAFT')
    : false
  const needsChoice = preview
    ? preview.affectedTasks.some((task) => task.status !== 'DRAFT')
    : false
  const structureLocked = needsChoice && reinspect === false

  useEffect(() => {
    let active = true
    if (!projectId || !itemId) return
    void api
      .loadPreview(projectId, itemId)
      .then((loaded) => {
        if (!active) return
        const localized = {
          ...loaded,
          item: {
            ...loaded.item,
            inspection_points: localizeProjectPoints(
              loaded.item.inspection_points,
            ),
          },
        }
        const photos = Object.fromEntries(
          localized.item.inspection_points.map((point, index) => [
            String(index),
            String(point.evidence_requirements[0]?.min_count ?? 1),
          ]),
        )
        setPreview(localized)
        setTitle(localized.item.title)
        setInstruction(localized.item.instruction)
        setInspectionPoints(localized.item.inspection_points)
        setPhotoDraft(photos)
        baselineRef.current = JSON.stringify({
          title: localized.item.title,
          instruction: localized.item.instruction,
          inspectionPoints: localized.item.inspection_points,
          photoDraft: photos,
        })
        if (loaded.readOnly) {
          setReadOnly(true)
          setError('你沒有權限修改此專案查核項目。')
        }
        if (loaded.affectedTasks.some((task) => task.planArchived)) {
          setReadOnly(true)
          setError(ARCHIVED_PLAN_ERROR)
        }
      })
      .catch((caught: unknown) => {
        if (!active) return
        // 項目 id 格式不對或不存在：顯示找不到，不顯示空表單與錯誤句。
        if (isNotFound(caught)) setNotFound(true)
        if (isForbidden(caught)) setReadOnly(true)
        setError(errorMessage(caught))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [api, itemId, projectId])

  useEffect(() => {
    if (confirming) {
      dialogHeadingRef.current?.focus()
    } else if (returnFocusRef.current?.isConnected) {
      returnFocusRef.current.focus()
      returnFocusRef.current = null
    }
  }, [confirming])

  useEffect(() => {
    if (error && preview) actionErrorRef.current?.focus()
  }, [error, preview])

  function applyPreview(loaded: ProjectItemPreview) {
    const localized = {
      ...loaded,
      item: {
        ...loaded.item,
        inspection_points: localizeProjectPoints(
          loaded.item.inspection_points,
        ),
      },
    }
    const photos = Object.fromEntries(
      localized.item.inspection_points.map((point, index) => [
        String(index),
        String(point.evidence_requirements[0]?.min_count ?? 1),
      ]),
    )
    setPreview(localized)
    setTitle(localized.item.title)
    setInstruction(localized.item.instruction)
    setInspectionPoints(localized.item.inspection_points)
    setPhotoDraft(photos)
    setReinspect(null)
    baselineRef.current = JSON.stringify({
      title: localized.item.title,
      instruction: localized.item.instruction,
      inspectionPoints: localized.item.inspection_points,
      photoDraft: photos,
    })
    return localized
  }

  async function reloadPreview(resetEditor = false): Promise<ProjectItemPreview> {
    if (!projectId || !itemId) throw new Error('Missing route parameters')
    const loaded = await api.loadPreview(projectId, itemId)
    if (resetEditor) return applyPreview(loaded)
    const localized = {
      ...loaded,
      item: {
        ...loaded.item,
        inspection_points: localizeProjectPoints(
          loaded.item.inspection_points,
        ),
      },
    }
    setPreview(localized)
    return localized
  }

  async function save(selectedReinspect?: boolean) {
    if (!projectId || !itemId) return
    if (!guard.enter()) return
    setError('')
    setBusy(true)
    const change: ProjectItemChange = {
      title,
      instruction,
      inspection_points: structuredClone(
        inspectionPoints.map((point, index) => ({
          ...point,
          sequence: index + 1,
          evidence_requirements: [
            { min_count: Number(photoDraft[String(index)] ?? '1') },
          ],
        })),
      ),
      ...(selectedReinspect === undefined
        ? {}
        : { reinspect: selectedReinspect }),
    }
    try {
      const updated = await api.update(projectId, itemId, change)
      setResultTasks(preview?.affectedTasks ?? [])
      setResult(updated)
      setConfirming(false)
      setAttemptedSave(false)
      setServerFieldErrors({})
      try {
        const loaded = await reloadPreview(true)
        if (loaded.readOnly) setReadOnly(true)
        if (loaded.affectedTasks.some((task) => task.planArchived)) {
          setReadOnly(true)
        }
      } catch {
        setTitle(change.title)
        setInstruction(change.instruction)
        setInspectionPoints(change.inspection_points)
        baselineRef.current = JSON.stringify({
          title: change.title,
          instruction: change.instruction,
          inspectionPoints: change.inspection_points,
          photoDraft,
        })
        setError('已儲存變更，但重新載入任務狀態失敗。')
      }
    } catch (caught) {
      let fieldErrorsHandled = false
      if (isForbidden(caught)) {
        setReadOnly(true)
        setConfirming(false)
      } else if (
        caught instanceof ManagementApiError &&
        caught.code === 'inspection_plan.archived'
      ) {
        setReadOnly(true)
        setConfirming(false)
        try {
          await reloadPreview()
        } catch {
          // 保留後端回報的封存訊息。
        }
      } else if (isReinspectionChoiceRequired(caught)) {
        try {
          const loaded = await reloadPreview()
          setConfirming(false)
          setError(REINSPECTION_CHOICE_ERROR)
          if (
            loaded.readOnly ||
            loaded.affectedTasks.some((task) => task.planArchived)
          ) {
            setReadOnly(true)
          }
        } catch (reloadError) {
          if (isForbidden(reloadError)) setReadOnly(true)
        }
      } else if (
        caught instanceof ManagementApiError &&
        caught.status === 422 &&
        caught.fields?.length
      ) {
        const draft = {
          ...makeDraft(preview!.item, change.inspection_points),
          title: change.title,
          instruction: change.instruction,
        }
        const mapped = mapFieldErrors(
          caught.fields,
          templateFieldErrorBindings(draft),
        )
        const messages = Object.fromEntries(
          Object.entries(mapped.errors).map(([key, code]) => [
            key,
            fieldErrorMessage(code),
          ]),
        )
        setServerFieldErrors(messages)
        setConfirming(false)
        fieldErrorsHandled = true
        setError(
          mapped.unmatched.length
            ? '查核項目未儲存，請檢查欄位內容。'
            : '',
        )
        const firstErrorKey = Object.keys(messages)[0]
        if (firstErrorKey) {
          focusRequestId.current += 1
          setFocusRequest({ id: focusRequestId.current, key: firstErrorKey })
        }
      }
      if (!fieldErrorsHandled) setError(errorMessage(caught))
    } finally {
      guard.leave()
      setBusy(false)
    }
  }

  function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setResult(null)
    setServerFieldErrors({})
    setAttemptedSave(true)
    const draft = {
      ...makeDraft(preview!.item, inspectionPoints),
      title,
      instruction,
    }
    const invalid = validateDraft(draft, photoDraft)
    if (Object.keys(invalid).length > 0) {
      const firstErrorKey = Object.keys(invalid)[0]
      focusRequestId.current += 1
      setFocusRequest({ id: focusRequestId.current, key: firstErrorKey })
      return Promise.resolve(
        [...new Set(
          Object.keys(invalid)
            .map((key) => /^point:(\d+):/.exec(key)?.[1])
            .filter((index): index is string => index !== undefined)
            .map(Number),
        )],
      )
    }
    if (needsChoice && reinspect === null) {
      setError('請先選擇這次修改要不要重新查核。')
      return Promise.resolve(null)
    }
    if (
      structureLocked &&
      hasStructureChange(preview!.item.inspection_points, inspectionPoints)
    ) {
      setError(
        '選擇「不要」重新查核時，不能增減項次或實測欄位，也不能變更欄位型別、單位、數值綁定或標準種類。',
      )
      return Promise.resolve(null)
    }
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    returnFocusRef.current =
      (submitter as HTMLElement | null) ??
      event.currentTarget.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      )
    setConfirming(true)
    return Promise.resolve(null)
  }

  function requestLeave() {
    if (dirty) setLeaving(true)
    else navigate(`/admin/projects/${projectId}/inspection-items`)
  }

  const currentDraft = preview
    ? { ...makeDraft(preview.item, inspectionPoints), title, instruction }
    : null
  const localErrors =
    attemptedSave && currentDraft
      ? validateDraft(currentDraft, photoDraft)
      : {}
  const willDeleteStructure = preview
    ? removesStructure(preview.item.inspection_points, inspectionPoints)
    : false

  useEffect(() => {
    if (!dirty) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [dirty])

  if (!projectId || !itemId) {
    return <p role="alert">缺少專案或查核項目識別碼。</p>
  }

  if (loading) return <p>載入中…</p>

  if (notFound) {
    return (
      <RouteNotFound
        headingLevel={2}
        message="網址可能輸入錯誤，或這個查核項目已不存在。"
        title="找不到這個查核項目"
      />
    )
  }

  return (
    <section aria-labelledby="project-item-heading">
      <h2 id="project-item-heading">修改專案查核項目</h2>
      {readOnly && (
        <p className="notice-info" role="status">
          唯讀瀏覽
        </p>
      )}
      {error && (
        <p ref={actionErrorRef} role="alert" tabIndex={-1}>
          {error}
        </p>
      )}
      {preview && (
        <>
          {needsChoice && (
            <fieldset className="tpl-card" disabled={readOnly || busy}>
              <legend>這次修改要不要重新查核？</legend>
              <label className="tpl-radio-option">
                <input
                  checked={reinspect === true}
                  onChange={() => setReinspect(true)}
                  name="reinspect"
                  type="radio"
                />
                要，用新標準重新查核
              </label>
              <p className="tpl-hint">{REINSPECT_YES_HINT}</p>
              <label className="tpl-radio-option">
                <input
                  checked={reinspect === false}
                  onChange={() => setReinspect(false)}
                  name="reinspect"
                  type="radio"
                />
                不要，只更正文字
              </label>
              <p className="tpl-hint">{REINSPECT_NO_HINT}</p>
            </fieldset>
          )}
          {currentDraft && (
            <TemplateItemEditor
              addPoint={() =>
                setInspectionPoints((current) => [
                  ...current,
                  blankPoint(current.length + 1),
                ])
              }
              cancelLabel="返回專案查核項目"
              clearPointServerErrors={(index) =>
                setServerFieldErrors((current) =>
                  Object.fromEntries(
                    Object.entries(current).filter(
                      ([key]) => !key.startsWith(`point:${index}:`),
                    ),
                  ),
                )
              }
              confirmField={confirmField}
              contextLabel={`專案查核項目 / ${preview.item.title}`}
              dirty={dirty}
              errors={{ ...serverFieldErrors, ...localErrors }}
              focusRequest={focusRequest}
              itemDraft={currentDraft}
              mode="edit-item"
              photoDraft={photoDraft}
              readOnly={readOnly || busy}
              removePoint={(index) => {
                setInspectionPoints((current) =>
                  current
                    .filter((_point, pointIndex) => pointIndex !== index)
                    .map((point, pointIndex) => ({
                      ...point,
                      sequence: pointIndex + 1,
                    })),
                )
                setPhotoDraft((current) => {
                  const next: Record<string, string> = {}
                  Object.entries(current).forEach(([key, value]) => {
                    const pointIndex = Number(key)
                    if (pointIndex < index) next[key] = value
                    if (pointIndex > index) next[String(pointIndex - 1)] = value
                  })
                  return next
                })
              }}
              resetMode={requestLeave}
              requestError=""
              saveItem={submitItem}
              saveLabel="儲存變更"
              selected={null}
              setConfirmField={setConfirmField}
              setGuard={() => setLeaving(true)}
              setPhotoDraft={setPhotoDraft}
              structureLocked={structureLocked}
              structureLockReason={
                '有已派出的任務受影響；選擇「不要」時只能修改文字與標準值、容許誤差、區間，不能增減項次或欄位，也不能變更欄位型別、單位、數值綁定或標準種類。'
              }
              systemId={projectId}
              updateDraft={(changes: Partial<TemplateItem>) => {
                if (changes.title !== undefined) setTitle(changes.title)
                if (changes.instruction !== undefined) {
                  setInstruction(changes.instruction)
                }
                setError('')
                setResult(null)
              }}
              updateField={(pointIndex, fieldIndex, changes) => {
                setInspectionPoints((current) =>
                  current.map((point, index) =>
                    index !== pointIndex
                      ? point
                      : {
                          ...point,
                          measurement_fields: point.measurement_fields.map(
                            (field, fieldPosition) =>
                              fieldPosition === fieldIndex
                                ? { ...field, ...changes }
                                : field,
                          ),
                        },
                  ),
                )
                setError('')
                setResult(null)
              }}
              updateNumeric={(index, changes) =>
                setInspectionPoints((current) =>
                  updatePoint(current, index, {
                    numeric_standard: {
                      ...current[index].numeric_standard!,
                      ...changes,
                    },
                  }),
                )
              }
              updatePoint={(index, changes) =>
                setInspectionPoints((current) =>
                  updatePoint(current, index, changes),
                )
              }
            />
          )}

          {confirming && (
            <ConfirmBox
              busy={busy}
              confirmDisabled={readOnly || (needsChoice && reinspect === null)}
              confirmLabel="確認儲存"
              headingRef={dialogHeadingRef}
              initialFocus="none"
              onCancel={() => setConfirming(false)}
              onConfirm={() =>
                save(draftOnly ? false : (reinspect ?? undefined))
              }
              role="dialog"
              title={needsChoice ? '儲存前確認是否重新查核' : '儲存前確認'}
              variant={willDeleteStructure ? 'danger' : undefined}
            >
              {needsChoice && (
                <>
                  <p>
                    {'有任務已經派出，請先選擇這次修改要不要重新查核。'}
                    {hasDraft && '草稿任務不受選擇影響，會直接更新為新內容；'}
                    {'已核發的報告也不受影響。'}
                  </p>
                  <p>
                    {'選擇「要」重新查核時，'}
                    {'各任務會有以下狀態變化；'}
                    {'選擇「不要」時，各任務狀態維持不變。'}
                  </p>
                </>
              )}
              {draftOnly && (
                <p>
                  {'使用此項目的任務都還是草稿，'}
                  {'儲存後草稿任務會直接更新為新內容，'}
                  {'不需要重新查核。'}
                </p>
              )}
              <h3>使用此項目的任務</h3>
              {preview.affectedTasks.length === 0 ? (
                <p>
                  {'目前沒有任務使用此項目，'}
                  {'確認後只儲存項目內容。'}
                </p>
              ) : (
                <ul>
                  {preview.affectedTasks.map((task) => (
                    <li key={task.id}>
                      {task.name}（{task.planName}；{taskLocation(task)}；
                      <StatusBadge status={task.status} />）
                      {needsChoice && <>：{taskConsequence(task.status)}</>}
                    </li>
                  ))}
                </ul>
              )}
            </ConfirmBox>
          )}

          {leaving && (
            <ConfirmBox
              cancelLabel="保留編輯"
              confirmLabel="捨棄變更"
              label="尚未儲存的變更"
              onCancel={() => setLeaving(false)}
              onConfirm={() => {
                setLeaving(false)
                navigate(`/admin/projects/${projectId}/inspection-items`)
              }}
              role="alertdialog"
              variant="danger"
            >
              <p>目前的項目內容尚未儲存，要保留編輯或捨棄變更？</p>
            </ConfirmBox>
          )}

          {result && (
            <section
              aria-labelledby="change-result-heading"
              className="notice-success"
              role="status"
            >
              <h2 id="change-result-heading">修改結果</h2>
              <p>
                {result.reinspection_selected
                  ? '已選擇重新查核。'
                  : result.affected_tasks.length === 0
                    ? '已儲存項目內容。'
                    : isDraftOnly(resultTasks)
                      ? DRAFT_ONLY_RESULT_TEXT
                      : '已更正文字，沒有重新查核。'}
              </p>
              {result.reinspection_selected &&
                reinspectionResultText(resultTasks) && (
                  <p>{reinspectionResultText(resultTasks)}</p>
                )}
              <h3>受影響任務的實際處理</h3>
              {result.affected_tasks.length ? (
                <ul>
                  {result.affected_tasks.map((task) => {
                    const before = resultTasks.find(
                      (entry) => entry.id === task.task_id,
                    )
                    return (
                      <li key={task.task_id}>
                        {before ? taskLabel(before) : task.task_id}：
                        {task.action === 'draft_updated' && (
                          <>草稿任務已更新為新內容</>
                        )}
                        {task.action === 'returned_to_in_progress' &&
                          '已完成任務退回進行中'}
                        {task.action === 'needs_reinspection' &&
                          '受影響項目待重查'}
                        {task.action === 'updated' &&
                          '目前標準已更新，任務狀態維持'}
                        {task.action === 'apply_current_standard_on_restore' &&
                          '取消狀態維持，恢復時套用目前標準'}
                        {result.reinspection_selected &&
                          task.prior_status !== 'DRAFT' &&
                          task.prior_status !== 'CANCELLED' && (
                            <>
                              {before?.hasResult
                                ? '；舊結果與照片保留供查詢，但不再算數'
                                : '；尚未填寫結果，直接改用新標準'}
                            </>
                          )}
                        {task.needs_reinspection && '；須重新查核'}
                        {before && before.preservedItemTitles.length > 0 && (
                          <>
                            ；其他項目維持有效：
                            {before.preservedItemTitles.join('、')}
                          </>
                        )}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p>沒有任務使用此項目。</p>
              )}
            </section>
          )}
        </>
      )}
    </section>
  )
}
