import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'

import { ManagementApiError } from '../api'
import type { InspectionPoint } from '../templates/api'
import {
  type ProjectItemApi,
  type ProjectItemChange,
  type ProjectItemChangeResult,
  type ProjectItemPreview,
  type TaskStatus,
} from './api'

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  DRAFT: '草稿',
  PENDING: '待開始',
  IN_PROGRESS: '進行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
}

const REINSPECTION_CHOICE_ERROR = [
  '任務使用狀況已更新，',
  '請重新確認受影響任務與查核選擇。',
].join('')

const ARCHIVED_PLAN_ERROR = [
  '此項目有任務位於封存計畫，',
  '取消封存後才能修改。',
].join('')

function isForbidden(error: unknown): boolean {
  return error instanceof ManagementApiError && error.status === 403
}

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
  return '載入或儲存失敗，請稍後再試。'
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
  if (status === 'DRAFT') return '標準在原任務內更新'
  if (status === 'COMPLETED') return '退回進行中'
  if (status === 'CANCELLED') {
    return '恢復時套用新標準並' + '標記待重查'
  }
  return '維持目前狀態'
}

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
  const [confirming, setConfirming] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialogHeadingRef = useRef<HTMLHeadingElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let active = true
    if (!projectId || !itemId) return
    void api
      .loadPreview(projectId, itemId)
      .then((loaded) => {
        if (!active) return
        setPreview(loaded)
        setTitle(loaded.item.title)
        setInstruction(loaded.item.instruction)
        setInspectionPoints(loaded.item.inspection_points)
        if (loaded.affectedTasks.some((task) => task.planArchived)) {
          setReadOnly(true)
          setError(ARCHIVED_PLAN_ERROR)
        }
      })
      .catch((caught: unknown) => {
        if (!active) return
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

  async function reloadPreview(): Promise<ProjectItemPreview> {
    if (!projectId || !itemId) throw new Error('Missing route parameters')
    const loaded = await api.loadPreview(projectId, itemId)
    setPreview(loaded)
    return loaded
  }

  async function save(selectedReinspect?: boolean) {
    if (!projectId || !itemId) return
    setError('')
    setBusy(true)
    const change: ProjectItemChange = {
      title,
      instruction,
      inspection_points: structuredClone(inspectionPoints),
      ...(selectedReinspect === undefined
        ? {}
        : { reinspect: selectedReinspect }),
    }
    try {
      const updated = await api.update(projectId, itemId, change)
      setResult(updated)
      setConfirming(false)
      try {
        const loaded = await reloadPreview()
        setTitle(change.title)
        setInstruction(change.instruction)
        setInspectionPoints(change.inspection_points)
        if (loaded.affectedTasks.some((task) => task.planArchived)) {
          setReadOnly(true)
        }
      } catch {
        setTitle(change.title)
        setInstruction(change.instruction)
        setInspectionPoints(change.inspection_points)
        setError('已儲存變更，但重新載入任務狀態失敗。')
      }
    } catch (caught) {
      if (isForbidden(caught)) {
        setReadOnly(true)
        setConfirming(false)
      } else if (isReinspectionChoiceRequired(caught)) {
        try {
          const loaded = await reloadPreview()
          setReinspect(null)
          setConfirming(true)
          if (loaded.affectedTasks.some((task) => task.planArchived)) {
            setReadOnly(true)
          }
        } catch (reloadError) {
          if (isForbidden(reloadError)) setReadOnly(true)
        }
      }
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setResult(null)
    setReinspect(null)
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    returnFocusRef.current =
      (submitter as HTMLElement | null) ??
      event.currentTarget.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      )
    setConfirming(true)
  }

  if (!projectId || !itemId) {
    return <p role="alert">缺少專案或查核項目識別碼。</p>
  }

  if (loading) return <p>載入中…</p>

  return (
    <section aria-labelledby="project-item-heading">
      <p>
        <Link to={`/admin/projects/${projectId ?? ''}`}>返回專案</Link>
      </p>
      <h1 id="project-item-heading">修改專案查核項目</h1>
      {readOnly && <p role="status">唯讀瀏覽</p>}
      {error && <p role="alert">{error}</p>}
      {preview && (
        <>
          <form onSubmit={submit}>
            <label>
              項目名稱
              <input
                disabled={readOnly || busy}
                onChange={(event) => setTitle(event.target.value)}
                required
                value={title}
              />
            </label>
            <label>
              項目說明
              <textarea
                disabled={readOnly || busy}
                onChange={(event) => setInstruction(event.target.value)}
                value={instruction}
              />
            </label>
            <fieldset disabled={readOnly || busy}>
              <legend>查核項次</legend>
              {inspectionPoints.map((point, index) => (
                <fieldset key={`${point.sequence}-${index}`}>
                  <legend>第 {point.sequence} 項</legend>
                  <label>
                    項次名稱
                    <input
                      onChange={(event) =>
                        setInspectionPoints(
                          updatePoint(inspectionPoints, index, {
                            title: event.target.value,
                          }),
                        )
                      }
                      value={point.title}
                    />
                  </label>
                  <label>
                    查核說明
                    <textarea
                      onChange={(event) =>
                        setInspectionPoints(
                          updatePoint(inspectionPoints, index, {
                            instruction: event.target.value,
                          }),
                        )
                      }
                      value={point.instruction}
                    />
                  </label>
                  {point.text_standard && (
                    <label>
                      文字標準
                      <textarea
                        onChange={(event) =>
                          setInspectionPoints(
                            updatePoint(inspectionPoints, index, {
                              text_standard: { text: event.target.value },
                            }),
                          )
                        }
                        value={point.text_standard.text}
                      />
                    </label>
                  )}
                  {point.numeric_standard && (
                    <p>
                      數值標準：
                      {point.numeric_standard.value ?? '未指定'}{' '}
                      {point.numeric_standard.unit}
                    </p>
                  )}
                  {point.measurement_fields.length > 0 && (
                    <p>
                      實測欄位：
                      {point.measurement_fields
                        .map((field) => field.name)
                        .join('、')}
                    </p>
                  )}
                  {point.evidence_requirements.length > 0 && (
                    <p>此項次含照片需求設定。</p>
                  )}
                </fieldset>
              ))}
            </fieldset>
            <button disabled={readOnly || busy} type="submit">
              儲存變更
            </button>
          </form>

          {confirming && (
            <section
              aria-labelledby="reinspect-heading"
              aria-modal="true"
              role="dialog"
            >
              <h2 id="reinspect-heading" ref={dialogHeadingRef} tabIndex={-1}>
                儲存前確認重新查核
              </h2>
              <p>
                {'選擇「要」會將已派出且未取消任務中，'}
                {'受影響項目的舊需求與 Snapshot 標示為'}
                {'「標準變更作廢」並保留歷史。'}
                {'只有已有結果的項目會另外作廢舊結果'}
                {'與照片，'}
                {'並列為待重查；尚無結果的項目'}
                {'直接使用新 Snapshot。'}
                {'原為草稿的任務會在原任務內更新。'}
                {'選擇「不要」只更正 Snapshot 文字，'}
                {'任務狀態、結果與照片不變。'}
                {'已有待重查項目的 Task '}
                {'完成補查前不得完成。'}
                {'已核發報告不受影響。'}
              </p>
              <h3>使用此項目的任務</h3>
              {preview.affectedTasks.length === 0 ? (
                <p>
                  {'目前沒有任務使用此項目，'}
                  {'確認後只儲存項目標準。'}
                </p>
              ) : (
                <ul>
                  {preview.affectedTasks.map((task) => (
                    <li key={task.id}>
                      {task.name}（{task.planName}；
                      {TASK_STATUS_LABELS[task.status]}）：
                      {taskConsequence(task.status)}
                    </li>
                  ))}
                </ul>
              )}
              {preview.affectedTasks.length > 0 && (
                <p>
                  {'選擇「要」重新查核時，'}
                  {'各任務會有以下狀態變化：'}
                </p>
              )}
              {preview.affectedTasks.length > 0 && (
                <fieldset disabled={readOnly}>
                  <legend>是否重新查核？</legend>
                  <label>
                    <input
                      checked={reinspect === true}
                      onChange={() => setReinspect(true)}
                      name="reinspect"
                      type="radio"
                    />
                    要，作廢受影響項目並重新查核
                  </label>
                  <label>
                    <input
                      checked={reinspect === false}
                      onChange={() => setReinspect(false)}
                      name="reinspect"
                      type="radio"
                    />
                    不要，只更正文字
                  </label>
                </fieldset>
              )}
              <button
                disabled={
                  readOnly ||
                  busy ||
                  (preview.affectedTasks.length > 0 && reinspect === null)
                }
                onClick={() => void save(reinspect ?? undefined)}
                type="button"
              >
                確認儲存
              </button>
              <button
                disabled={busy}
                onClick={() => setConfirming(false)}
                type="button"
              >
                返回編輯
              </button>
            </section>
          )}

          {result && (
            <section aria-labelledby="change-result-heading" role="status">
              <h2 id="change-result-heading">修改結果</h2>
              <h3>已作廢並保留的舊需求／Snapshot 歷史</h3>
              {result.invalidatedHistory.length ? (
                <ul>
                  {result.invalidatedHistory.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p>沒有舊需求或 Snapshot 歷史被作廢。</p>
              )}
              <h3>已作廢的結果／照片，並列為待重查</h3>
              {result.invalidatedResults.length ? (
                <ul>
                  {result.invalidatedResults.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p>沒有既有結果或照片需要作廢。</p>
              )}
              <h3>維持有效的其他項目</h3>
              <ul>
                {result.preservedItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <h3>草稿任務原位更新</h3>
              {result.updatedDraftTasks.length ? (
                <ul>
                  {result.updatedDraftTasks.map((task) => (
                    <li key={task}>{task}</li>
                  ))}
                </ul>
              ) : (
                <p>沒有草稿任務。</p>
              )}
            </section>
          )}
        </>
      )}
    </section>
  )
}
