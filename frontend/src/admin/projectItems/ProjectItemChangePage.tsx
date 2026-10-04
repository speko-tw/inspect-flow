import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'

import {
  mockProjectItemApi,
  ProjectItemApiError,
  type ProjectItemApi,
  type ProjectItemChangeResult,
  type ProjectItemPreview,
} from './api'

function isForbidden(error: unknown): boolean {
  return error instanceof ProjectItemApiError && error.status === 403
}

function errorMessage(error: unknown): string {
  if (isForbidden(error)) return '你沒有權限修改此專案查核項目。'
  return '載入或儲存失敗，請稍後再試。'
}

export default function ProjectItemChangePage({
  api = mockProjectItemApi,
}: {
  api?: ProjectItemApi
}) {
  const { projectId = '', itemId = 'item-1' } = useParams()
  const [preview, setPreview] = useState<ProjectItemPreview | null>(null)
  const [title, setTitle] = useState('')
  const [standard, setStandard] = useState('')
  const [reinspect, setReinspect] = useState<boolean | null>(null)
  const [result, setResult] = useState<ProjectItemChangeResult | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void api
      .loadPreview(projectId, itemId)
      .then((loaded) => {
        if (!active) return
        setPreview(loaded)
        setTitle(loaded.item.title)
        setStandard(loaded.item.standard)
        if (loaded.affectedTasks.some((task) => task.planArchived)) {
          setReadOnly(true)
          setError('此項目有任務位於封存計畫，取消封存後才能修改。')
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

  async function save(selectedReinspect: boolean) {
    setError('')
    setBusy(true)
    try {
      const updated = await api.update(projectId, itemId, {
        title,
        standard,
        reinspect: selectedReinspect,
      })
      setResult(updated)
      setConfirming(false)
    } catch (caught) {
      if (isForbidden(caught)) {
        setReadOnly(true)
        setConfirming(false)
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
    setReinspect(preview?.affectedTasks.length ? null : false)
    setConfirming(true)
  }

  if (loading) return <p>載入中…</p>

  return (
    <section aria-labelledby="project-item-heading">
      <p>
        <Link to={`/admin/projects/${projectId}`}>返回專案</Link>
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
              查核標準
              <textarea
                disabled={readOnly || busy}
                onChange={(event) => setStandard(event.target.value)}
                required
                value={standard}
              />
            </label>
            <button disabled={readOnly || busy} type="submit">
              儲存變更
            </button>
          </form>

          {confirming && (
            <section aria-labelledby="reinspect-heading" role="dialog">
              <h2 id="reinspect-heading">儲存前確認重新查核</h2>
              <p>
                選擇「要」會將已派出且未取消任務中，受影響項目的舊需求與
                Snapshot 標示為「標準變更作廢」並保留歷史。只有已有結果的
                項目會另外作廢舊結果與照片並列為待重查；尚無結果的項目直接
                使用新 Snapshot。原為 DRAFT 的任務會在原任務內更新。選擇
                「不要」只更正 Snapshot 文字，任務狀態、結果與照片不變。已
                核發報告不受影響。
              </p>
              <h3>使用此項目的任務</h3>
              {preview.affectedTasks.length === 0 ? (
                <p>目前沒有任務使用此項目，確認後只儲存項目標準。</p>
              ) : (
                <ul>
                  {preview.affectedTasks.map((task) => (
                    <li key={task.id}>
                      {task.name}（{task.planName}；{task.status}）
                      {task.status === 'DRAFT' && '：在原任務內更新'}
                    </li>
                  ))}
                </ul>
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
                disabled={readOnly || busy || reinspect === null}
                onClick={() => reinspect !== null && void save(reinspect)}
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
              <h3>DRAFT 任務原位更新</h3>
              {result.updatedDraftTasks.length ? (
                <ul>
                  {result.updatedDraftTasks.map((task) => (
                    <li key={task}>{task}</li>
                  ))}
                </ul>
              ) : (
                <p>沒有 DRAFT 任務。</p>
              )}
            </section>
          )}
        </>
      )}
    </section>
  )
}
