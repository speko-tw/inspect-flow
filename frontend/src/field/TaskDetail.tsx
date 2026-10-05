import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import {
  fetchFieldTaskDetail,
  FieldApiError,
  type FieldTaskDetail,
} from './api'

function standardText(
  point: FieldTaskDetail['items'][number]['inspection_points'][number],
) {
  const standard = point.numeric_standard
  if (!standard) return point.text_standard?.text || '未設定標準'
  const unit =
    point.measurement_fields.find(
      (field) => field.id === standard.measurement_field_id,
    )?.unit ?? standard.unit
  const suffix = unit ? ` ${unit}` : ''
  if (standard.condition === 'range') {
    if (standard.range_form === 'interval') {
      return `${standard.lower_bound}～${standard.upper_bound}${suffix}`
    }
    return `${standard.value} ± ${standard.tolerance}${suffix}`
  }
  const symbol = { '<=': '≤', '>=': '≥', '=': '＝' }[standard.condition]
  const tolerance = standard.tolerance ? ` ± ${standard.tolerance}` : ''
  return `${symbol} ${standard.value}${tolerance}${suffix}`
}

function displayTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-TW', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date)
}

function fieldLabel(field: { name: string; unit: string | null }) {
  return `${field.name}${field.unit ? `（${field.unit}）` : ''}`
}

export default function TaskDetail({ taskId }: { taskId: string }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [task, setTask] = useState<FieldTaskDetail | null>(null)
  const [error, setError] = useState<'missing' | 'forbidden' | 'other' | null>(
    null,
  )
  const [retry, setRetry] = useState(0)
  const back = `/field/${location.search}`

  useEffect(() => {
    let active = true
    fetchFieldTaskDetail(taskId)
      .then((detail) => {
        if (active) setTask(detail)
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof FieldApiError && cause.status === 401) {
          navigate('/login', {
            state: { from: location.pathname + location.search },
          })
          return
        }
        setError(
          cause instanceof FieldApiError && cause.status === 404
            ? 'missing'
            : cause instanceof FieldApiError && cause.status === 403
              ? 'forbidden'
              : 'other',
        )
      })
    return () => {
      active = false
    }
  }, [location.pathname, location.search, navigate, retry, taskId])

  return (
    <>
      <Link className="field-back" to={back} state={{ restoreTaskList: true }}>
        ‹ 返回任務
      </Link>
      {!task && !error && <p role="status">載入任務詳情中…</p>}
      {error && (
        <section className="field-notice field-error" role="alert">
          <h1>
            {error === 'missing'
              ? '找不到這筆任務'
              : error === 'forbidden'
                ? '無法查看任務'
                : '無法載入任務詳情'}
          </h1>
          <p>
            {error === 'missing'
              ? '任務不存在，或你目前無法查看這筆任務。'
              : error === 'forbidden'
                ? '你的帳號沒有查看現場任務的權限。'
                : '請稍後再試。'}
          </p>
          {error === 'other' && (
            <button
              type="button"
              onClick={() => {
                setError(null)
                setRetry((value) => value + 1)
              }}
            >
              重試
            </button>
          )}
          <Link to={back} state={{ restoreTaskList: true }}>
            返回任務清單
          </Link>
        </section>
      )}
      {task && (
        <>
          <section className="field-detail-hero">
            <span className={`field-status ${task.status.toLowerCase()}`}>
              {
                {
                  PENDING: '待開始',
                  IN_PROGRESS: '進行中',
                  COMPLETED: '已完成',
                  CANCELLED: '已取消',
                }[task.status]
              }
            </span>
            <h1>
              {task.items.length
                ? task.items.length > 1
                  ? `${task.items[0].title} 等 ${task.items.length} 項`
                  : task.items[0].title
                : '查核任務'}
            </h1>
            <p className="field-detail-project">{task.project_name}</p>
            <div className="field-detail-meta">
              <strong>查核地點</strong>
              {task.location.zone_name && (
                <span>分區：{task.location.zone_name}</span>
              )}
              <span>{task.location.location_text ?? '未指定'}</span>
            </div>
            <div className="field-detail-meta">
              <strong>建議指派</strong>
              <span>{task.suggested_assignee?.name_zh ?? '未指定'}</span>
            </div>
            <div className="field-detail-meta">
              <strong>派送時間</strong>
              <span>{displayTime(task.dispatched_at)}</span>
            </div>
          </section>
          <div className="field-section-head">
            <h2>查核需求</h2>
            <small>建立任務時的需求</small>
          </div>
          {task.items.map((item, itemIndex) => (
            <article className="field-detail-item" key={itemIndex}>
              <h3>{item.title}</h3>
              {item.instruction && <p>{item.instruction}</p>}
              {item.inspection_points.map((point, pointIndex) => {
                const photos = point.evidence_requirements
                  .filter(
                    (row) => row.evidence_type === 'photo' && row.required,
                  )
                  .reduce((total, row) => total + row.min_count, 0)
                return (
                  <section className="field-detail-point" key={pointIndex}>
                    <span className="field-point-number">
                      項次 {point.sequence}
                    </span>
                    <h4>{point.title}</h4>
                    {point.instruction && <p>{point.instruction}</p>}
                    <dl className="field-detail-req">
                      <div>
                        <dt>實測欄位</dt>
                        <dd>
                          {point.measurement_fields.length
                            ? point.measurement_fields
                                .map(fieldLabel)
                                .join('、')
                            : '無需實測值'}
                        </dd>
                      </div>
                      <div>
                        <dt>判定標準</dt>
                        <dd>{standardText(point)}</dd>
                      </div>
                      <div>
                        <dt>照片需求</dt>
                        <dd>{photos ? `至少 ${photos} 張` : '無需照片'}</dd>
                      </div>
                    </dl>
                  </section>
                )
              })}
            </article>
          ))}
          <section className="field-action-panel" aria-label="任務操作">
            <h2>任務操作</h2>
            <p>
              {
                {
                  PENDING: '看完需求後開始查核。',
                  IN_PROGRESS: '查核進行中。',
                  COMPLETED: '查核已完成，可查看需求。',
                  CANCELLED: '任務已取消，可查看需求。',
                }[task.status]
              }
            </p>
            {task.status === 'PENDING' && (
              <button type="button" disabled>
                開始查核（下一步開放）
              </button>
            )}
            <p>填寫結果與照片上傳將在後續版本提供。</p>
          </section>
        </>
      )}
    </>
  )
}
