import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useParams } from 'react-router'

import { httpErrorMessage, isForbidden, isNotFound } from '../../http'
import AccessDeniedPage from '../../components/layout/AccessDeniedPage'
import RouteNotFound from '../../RouteNotFound'
import { StatusBadge } from '../../ui/Badge'
import { ConfirmBox } from '../../ui/ConfirmBox'
import { fieldErrorMessage, mapFieldErrors } from '../../ui/fieldErrors'
import { useSubmitGuard } from '../../ui/submitGuard'
import { UnsavedLeaveBox } from '../../ui/navigation'
import { useUnsavedNavigationGuard } from '../../ui/navigation'
import { ManagementApiError } from '../api'
import { TemplateItemEditor } from '../templates/TemplateItemEditor'
import { validateItemFields } from '../templates/itemFieldValidation'
import {
  blankPoint,
  localizeInspectionPoints,
  TEMPLATE_FIELD_ERROR_MESSAGES,
  templateFieldErrorBindings,
} from '../templates/templateEditorUtils'
import type { InspectionPoint, TemplateItem } from '../templates/api'
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

// 依 IP-R04 說明實際影響：後端結果只帶任務動作，是否已有結果用修改前的
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
  '只更正文字與數值標準、容差、區間；任務狀態、結果、照片與照片需求不變。'

const STRUCTURE_REINSPECTION_HINT = [
  '這次有結構變更（項次、欄位、單位、',
  '標準種類或照片需求），一定要重新查核',
].join('')

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
      'project_inspection_item.duplicate_name':
        '這個專案已有同名查核項目，請換個名稱。',
      'project_inspection_item.structure_locked': [
        '此項目已有任務使用；若要修改照片需求，或增減項次、實測欄位，',
        '變更欄位類型、單位、數值綁定或標準種類，請選擇「要」重新查核。',
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

// 選「不要」只更正文字，已派出任務的狀態都不變；草稿任務不受選擇影響。
function taskConsequenceText(
  status: TaskStatus,
  reinspect: boolean | null,
): string {
  if (status === 'DRAFT' || reinspect !== false) {
    return taskConsequence(status)
  }
  return '狀態維持不變'
}

// 有任務使用時每次都帶 reinspect 是 KD-55。只有草稿任務受影響時（ADM-R28
// 不顯示選擇）送 true，是為了避開 IP-R13 的結構鎖（false 會鎖結構）；
// 依 IP-R04 草稿任務會在同一個 Task 內更新 Snapshot，不產生待重查。
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
      return (
        standard.measurement_field_client_key ??
        standard.measurement_field_client_id ??
        standard.measurement_field_id ??
        null
      )
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
    if (
      point.measurement_fields.length !== updated.measurement_fields.length
    ) {
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
    if (
      JSON.stringify(point.evidence_requirements) !==
      JSON.stringify(updated.evidence_requirements)
    ) {
      return true
    }
  }
  return false
}

function structureSignature(
  points: InspectionPoint[],
  photoDraft: Record<string, string>,
): string {
  return JSON.stringify({
    points: points.map((point) => ({
      id: point.id,
      clientKey: point.clientKey,
      numericKind: Boolean(point.numeric_standard),
      textKind: Boolean(point.text_standard),
      binding:
        point.numeric_standard?.measurement_field_client_key ??
        point.numeric_standard?.measurement_field_client_id ??
        point.numeric_standard?.measurement_field_id ??
        null,
      unit: point.numeric_standard?.unit ?? null,
      fields: point.measurement_fields.map((field) => ({
        id: field.id,
        clientKey: field.clientKey,
        type: field.field_type,
        unit: field.unit,
      })),
      evidence: point.evidence_requirements,
    })),
    photoDraft,
  })
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

function deletedStructureNames(
  before: InspectionPoint[],
  after: InspectionPoint[],
): string[] {
  const afterById = new Map(
    after.filter((point) => point.id).map((point) => [point.id!, point]),
  )
  const deleted: string[] = []
  for (const point of before) {
    if (!point.id) continue
    const updated = afterById.get(point.id)
    if (!updated) {
      deleted.push(`項次「${point.title}」`)
      continue
    }
    const fieldIds = new Set(
      updated.measurement_fields
        .map((field) => field.id)
        .filter((id): id is string => Boolean(id)),
    )
    for (const field of point.measurement_fields) {
      if (field.id && !fieldIds.has(field.id)) {
        deleted.push(`「${point.title}」的欄位「${field.name}」`)
      }
    }
  }
  return deleted
}

/**
 * 依 IP-R04、IP-R13 呈現項目修改及重新查核確認。
 * 受影響 Plan 已封存或無修改權限時改為唯讀，儲存仍交由後端覆核。
 */
export default function ProjectItemChangePage({
  api,
}: {
  api: ProjectItemApi
}) {
  const { projectId, itemId } = useParams()
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
  const [accessDenied, setAccessDenied] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [busy, setBusy] = useState(false)
  const guard = useSubmitGuard()
  const [error, setError] = useState('')
  const [focusSaveError, setFocusSaveError] = useState(false)
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
  const [attemptedSave, setAttemptedSave] = useState(false)
  // null 代表尚未載入成功（載入中、失敗、404、403）；此時沒有可比對的
  // 原始內容，不算有未儲存變更，離頁不應被攔下。
  const [baseline, setBaseline] = useState<string | null>(null)
  const dialogHeadingRef = useRef<HTMLHeadingElement>(null)
  const confirmBoxRef = useRef<HTMLDivElement>(null)
  const editorRootRef = useRef<HTMLDivElement>(null)
  const actionErrorRef = useRef<HTMLParagraphElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const previousStructureRef = useRef<string | null>(null)

  const editorValues = {
    title,
    instruction,
    inspectionPoints,
    photoDraft,
  }
  const dirty = baseline !== null && baseline !== JSON.stringify(editorValues)
  const leaveGuard = useUnsavedNavigationGuard(dirty)
  const draftOnly = preview ? isDraftOnly(preview.affectedTasks) : false
  const hasDraft = preview
    ? preview.affectedTasks.some((task) => task.status === 'DRAFT')
    : false
  const needsChoice = preview
    ? preview.affectedTasks.some((task) => task.status !== 'DRAFT')
    : false
  // #435：隱含的不要只適用純改名；混入其他內容後回到未選狀態。
  // 明確勾選的選擇另存於 reinspect，不會因編輯內容而被覆蓋。
  const original =
    baseline === null ? null : (JSON.parse(baseline) as { title: string })
  const renameOnly =
    original !== null &&
    title.trim() !== original.title.trim() &&
    JSON.stringify({ ...editorValues, title: original.title }) === baseline
  const reinspectionChoice = reinspect ?? (renameOnly ? false : null)
  const photoRequirementChanged = Boolean(
    preview?.item.inspection_points.some(
      (point, index) =>
        Number(photoDraft[String(index)] ?? '1') !==
        point.evidence_requirements[0]?.min_count,
    ),
  )

  useEffect(() => {
    const current = structureSignature(inspectionPoints, photoDraft)
    if (
      previousStructureRef.current !== null &&
      previousStructureRef.current !== current
    ) {
      // IP-R13/IP-R22：結構改動後不能沿用舊的「不要」決策。
      setReinspect(null)
    }
    previousStructureRef.current = current
  }, [inspectionPoints, photoDraft])

  useEffect(() => {
    let active = true
    if (!projectId || !itemId) return
    void api
      .loadPreview(projectId, itemId)
      .then((loaded) => {
        if (!active) return
        setFocusSaveError(false)
        setAccessDenied(false)
        const localized = {
          ...loaded,
          item: {
            ...loaded.item,
            inspection_points: localizeInspectionPoints(
              loaded.item.inspection_points,
              { stablePointKeys: true },
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
        previousStructureRef.current = structureSignature(
          localized.item.inspection_points,
          photos,
        )
        setBaseline(
          JSON.stringify({
            title: localized.item.title,
            instruction: localized.item.instruction,
            inspectionPoints: localized.item.inspection_points,
            photoDraft: photos,
          }),
        )
        if (loaded.readOnly) {
          setReadOnly(true)
          setFocusSaveError(false)
          setError('你沒有權限修改此專案查核項目。')
        }
        if (loaded.affectedTasks.some((task) => task.planArchived)) {
          setReadOnly(true)
          setFocusSaveError(false)
          setError(ARCHIVED_PLAN_ERROR)
        }
      })
      .catch((caught: unknown) => {
        if (!active) return
        setFocusSaveError(false)
        // 項目 id 格式不對或不存在：顯示找不到，不顯示空表單與錯誤句。
        if (isNotFound(caught)) setNotFound(true)
        if (isForbidden(caught)) setAccessDenied(true)
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
      // 手機確認框在表單下方；對齊框底，讓確認按鈕留在可視範圍。
      if (
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(max-width: 40rem)').matches
      ) {
        confirmBoxRef.current?.scrollIntoView({ block: 'end' })
      }
    } else if (returnFocusRef.current?.isConnected) {
      returnFocusRef.current.focus()
      returnFocusRef.current = null
    }
  }, [confirming])

  useEffect(() => {
    if (error && preview && focusSaveError) {
      const requestError = editorRootRef.current?.querySelector<HTMLElement>(
        '.tpl-editor-footer [role="alert"]',
      )
      requestError?.scrollIntoView?.({ block: 'nearest' })
      requestError?.focus({ preventScroll: true })
    }
  }, [error, focusSaveError, preview])

  function applyPreview(loaded: ProjectItemPreview) {
    const localized = {
      ...loaded,
      item: {
        ...loaded.item,
        inspection_points: localizeInspectionPoints(
          loaded.item.inspection_points,
          { stablePointKeys: true },
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
    previousStructureRef.current = structureSignature(
      localized.item.inspection_points,
      photos,
    )
    // 新一輪修改須重新選擇；純改名由編輯內容推導預設值（#435）。
    setReinspect(null)
    setBaseline(
      JSON.stringify({
        title: localized.item.title,
        instruction: localized.item.instruction,
        inspectionPoints: localized.item.inspection_points,
        photoDraft: photos,
      }),
    )
    return localized
  }

  async function reloadPreview(
    resetEditor = false,
  ): Promise<ProjectItemPreview> {
    if (!projectId || !itemId) throw new Error('Missing route parameters')
    const loaded = await api.loadPreview(projectId, itemId)
    if (resetEditor) return applyPreview(loaded)
    const localized = {
      ...loaded,
      item: {
        ...loaded.item,
        inspection_points: localizeInspectionPoints(
          loaded.item.inspection_points,
          { stablePointKeys: true },
        ),
      },
    }
    setPreview(localized)
    return localized
  }

  // `recheckDrafts`：只有草稿任務時要送 reinspect: true（見 isDraftOnly），
  // 送出前先重讀任務；期間若已有任務被派出，改送會誤用草稿原位更新的語意。
  async function save(selectedReinspect?: boolean, recheckDrafts = false) {
    if (!projectId || !itemId) return
    if (!guard.enter()) return
    setFocusSaveError(false)
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
      ...(selectedReinspect === undefined ||
      preview?.affectedTasks.length === 0
        ? {}
        : { reinspect: selectedReinspect }),
    }
    try {
      let tasksAtSave = preview?.affectedTasks ?? []
      if (recheckDrafts) {
        const loaded = await reloadPreview()
        if (loaded.affectedTasks.some((task) => task.status !== 'DRAFT')) {
          // 沿用競態回復：停下來，請使用者針對最新的任務重新選擇。
          setConfirming(false)
          setReinspect(null)
          setError(REINSPECTION_CHOICE_ERROR)
          if (
            loaded.readOnly ||
            loaded.affectedTasks.some((task) => task.planArchived)
          ) {
            setReadOnly(true)
          }
          return
        }
        tasksAtSave = loaded.affectedTasks
        if (loaded.affectedTasks.length === 0) delete change.reinspect
      }
      const updated = await api.update(projectId, itemId, change)
      setResultTasks(tasksAtSave)
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
        // 改用回應內帶 id 的項次當新基準：用送出前的草稿會缺少新項次與
        // 欄位的 id，下一次儲存就會把它們當成新資料再建立一次。
        if (preview) {
          applyPreview({
            ...preview,
            item: {
              ...preview.item,
              title: updated.title,
              instruction: updated.instruction,
              inspection_points: updated.inspection_points,
            },
          })
        }
        setError('已儲存變更，但重新載入任務狀態失敗。')
      }
    } catch (caught) {
      setFocusSaveError(true)
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
        caught.code === 'project_inspection_item.structure_locked'
      ) {
        setConfirming(false)
        setReinspect(null)
        try {
          const loaded = await reloadPreview()
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
          templateFieldErrorBindings(draft, undefined, true),
        )
        const messages = Object.fromEntries(
          Object.entries(mapped.errors).map(([key, code]) => [
            key,
            fieldErrorMessage(code, TEMPLATE_FIELD_ERROR_MESSAGES),
          ]),
        )
        setServerFieldErrors(messages)
        setConfirming(false)
        fieldErrorsHandled = true
        setError(
          mapped.unmatched.length ? '查核項目未儲存，請檢查欄位內容。' : '',
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
    const invalid = validateItemFields(draft, photoDraft, {
      stablePointErrorKeys: true,
    })
    if (Object.keys(invalid).length > 0) {
      const firstErrorKey = Object.keys(invalid)[0]
      focusRequestId.current += 1
      setFocusRequest({ id: focusRequestId.current, key: firstErrorKey })
      const invalidPoints = draft.inspection_points.flatMap((point, index) => {
        const pointKey = `point:${point.clientKey ?? point.id ?? index}:`
        return Object.keys(invalid).some((key) => key.startsWith(pointKey))
          ? [index]
          : []
      })
      return Promise.resolve(invalidPoints)
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

  const currentDraft = preview
    ? { ...makeDraft(preview.item, inspectionPoints), title, instruction }
    : null
  const localErrors =
    attemptedSave && currentDraft
      ? validateItemFields(currentDraft, photoDraft, {
          stablePointErrorKeys: true,
        })
      : {}
  const willDeleteStructure = preview
    ? removesStructure(preview.item.inspection_points, inspectionPoints)
    : false
  const hasStructuralChange = Boolean(
    preview &&
    (hasStructureChange(preview.item.inspection_points, inspectionPoints) ||
      photoRequirementChanged),
  )
  const deletedNames = preview
    ? deletedStructureNames(preview.item.inspection_points, inspectionPoints)
    : []

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

  if (accessDenied) return <AccessDeniedPage headingLevel={2} />

  return (
    <section aria-labelledby="project-item-heading">
      <h2 id="project-item-heading">修改專案查核項目</h2>
      {readOnly && (
        <p className="notice-info" role="status">
          唯讀瀏覽
        </p>
      )}
      {error && !preview && (
        <p ref={actionErrorRef} role="alert" tabIndex={-1}>
          {error}
        </p>
      )}
      {error && preview && !focusSaveError && (
        <p className="notice-error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <>
          {currentDraft && (
            <div ref={editorRootRef}>
              <TemplateItemEditor
                addPoint={() =>
                  setInspectionPoints((current) => [
                    ...current,
                    blankPoint(current.length + 1, { stableClientKey: true }),
                  ])
                }
                cancelLabel="返回專案查核項目"
                cancelHref={`/projects/${projectId}/inspection-items`}
                stablePointErrorKeys
                clearPointServerErrors={(index) => {
                  const point = inspectionPoints[index]
                  const identity = point?.clientKey ?? point?.id ?? index
                  const prefix = `point:${identity}:`
                  setServerFieldErrors((current) =>
                    Object.fromEntries(
                      Object.entries(current).filter(
                        ([key]) => !key.startsWith(prefix),
                      ),
                    ),
                  )
                }}
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
                      if (pointIndex > index)
                        next[String(pointIndex - 1)] = value
                    })
                    return next
                  })
                }}
                resetMode={() => {}}
                requestError={focusSaveError ? error : ''}
                saveItem={submitItem}
                saveLabel="儲存變更"
                selected={null}
                setConfirmField={setConfirmField}
                setGuard={() => {}}
                setPhotoDraft={setPhotoDraft}
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
            </div>
          )}

          {confirming && (
            <ConfirmBox
              busy={busy}
              confirmDisabled={
                readOnly ||
                (needsChoice && reinspectionChoice === null) ||
                // IP-R13/IP-R22：有結構變更時禁止沿用舊的「不要」決策。
                (needsChoice &&
                  reinspectionChoice === false &&
                  hasStructuralChange)
              }
              confirmLabel="確認儲存"
              headingRef={dialogHeadingRef}
              rootRef={confirmBoxRef}
              initialFocus="none"
              onCancel={() => setConfirming(false)}
              onConfirm={() =>
                draftOnly
                  ? save(true, true)
                  : save(reinspectionChoice ?? undefined)
              }
              role="dialog"
              title={needsChoice ? '儲存前確認是否重新查核' : '儲存前確認'}
              variant={willDeleteStructure ? 'danger' : undefined}
            >
              {needsChoice && (
                <>
                  <fieldset className="tpl-card" disabled={readOnly || busy}>
                    <legend>這次修改要不要重新查核？</legend>
                    <label className="tpl-radio-option">
                      <input
                        aria-describedby="reinspect-yes-hint"
                        checked={reinspectionChoice === true}
                        onChange={() => setReinspect(true)}
                        name="reinspect"
                        type="radio"
                      />
                      要，用新標準重新查核
                    </label>
                    <p className="tpl-hint muted-text" id="reinspect-yes-hint">
                      {REINSPECT_YES_HINT}
                    </p>
                    <label className="tpl-radio-option">
                      <input
                        aria-describedby="reinspect-no-hint"
                        checked={reinspectionChoice === false}
                        disabled={hasStructuralChange}
                        onChange={() => setReinspect(false)}
                        name="reinspect"
                        type="radio"
                      />
                      不要，只更正文字與標準值
                    </label>
                    <p className="tpl-hint muted-text" id="reinspect-no-hint">
                      {hasStructuralChange
                        ? STRUCTURE_REINSPECTION_HINT
                        : REINSPECT_NO_HINT}
                    </p>
                  </fieldset>
                  <p>
                    {'有任務已經派出。'}
                    {hasDraft && '草稿任務不受選擇影響，會直接更新為新內容；'}
                    {'已核發的報告也不受影響。'}
                  </p>
                  <p>
                    {reinspectionChoice === true &&
                      '你選擇「要」重新查核，各任務會有以下狀態變化。'}
                    {reinspectionChoice === false &&
                      !hasStructuralChange &&
                      '你選擇「不要」重新查核，各任務狀態維持不變。'}
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
              {willDeleteStructure && (
                <>
                  <p>即將刪除：{deletedNames.join('、')}。</p>
                  {preview.affectedTasks.some(
                    (task) => task.status !== 'DRAFT',
                  ) && (
                    <p>
                      已派出任務的舊結果與照片會依重新查核規則作廢；
                      已取消任務於恢復時套用目前標準。
                    </p>
                  )}
                </>
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
                      {needsChoice && (
                        <>
                          ：
                          {taskConsequenceText(
                            task.status,
                            reinspectionChoice,
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </ConfirmBox>
          )}

          <UnsavedLeaveBox guard={leaveGuard} />

          {result && (
            <section
              aria-labelledby="change-result-heading"
              className="notice-success"
              role="status"
            >
              <h2 id="change-result-heading">修改結果</h2>
              <p>
                {isDraftOnly(resultTasks)
                  ? DRAFT_ONLY_RESULT_TEXT
                  : result.reinspection_selected
                    ? '已選擇重新查核。'
                    : result.affected_tasks.length === 0
                      ? '已儲存項目內容。'
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
