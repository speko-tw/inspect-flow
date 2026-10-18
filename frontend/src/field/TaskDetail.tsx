import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { InfoRow } from '../components/InfoRow'
import { SectionHeader } from '../components/SectionHeader'
import { ResourceState } from '../components/layout/LayoutPatterns'
import { isNotFound } from '../http'
import { BackLink } from '../layout/BackLink'
import { StatusBadge } from '../ui/Badge'
import { formatInspectionStandard } from '../ui/inspectionStandard'
import {
  fetchFieldTaskDetail,
  FieldApiError,
  type FieldTaskDetail,
} from './api'
import StartAction, { type TaskListChange } from './StartAction'

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

/**
 * 顯示 Field Task 的唯讀快照與地點，遵守 FUI-R03、IP-R10。
 *
 * @returns Task 詳情與可用的開始查核操作。
 */
export default function TaskDetail({
  taskId,
  homePath = '/field',
  onListChange,
}: {
  taskId: string
  /** 這個帳號的落點（`landing.ts`）；找不到任務時的「回首頁」。 */
  homePath?: string
  onListChange?: (change: TaskListChange) => void
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const [task, setTask] = useState<FieldTaskDetail | null>(null)
  const [error, setError] = useState<'missing' | 'forbidden' | 'other' | null>(
    null,
  )
  const [retry, setRetry] = useState(0)
  const back = `/field/${location.search}`
  const heading = task?.name ?? ''

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
        // Field 詳情以 404 隱藏不可見任務，任務 id 格式不對是 422，兩者都
        // 顯示找不到；403 僅防禦其他閘道拒絕。
        setError(
          isNotFound(cause)
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
      <BackLink to={back} state={{ restoreTaskList: true }}>
        返回任務
      </BackLink>
      {!task && !error && (
        <ResourceState
          state="loading"
          title="載入任務詳情中"
          message="正在取得任務需求與操作狀態。"
        />
      )}
      {error && (
        <section
          className="field-notice field-notice-error field-detail-error"
          role="alert"
        >
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
            <Button
              variant="secondary"
              type="button"
              className="field-inline-action"
              onClick={() => {
                setError(null)
                setRetry((value) => value + 1)
              }}
            >
              重試
            </Button>
          )}
          {error === 'missing' ? (
            <Link className="btn" to={homePath}>
              回首頁
            </Link>
          ) : (
            <Link className="btn" to={back} state={{ restoreTaskList: true }}>
              返回任務清單
            </Link>
          )}
        </section>
      )}
      {task && (
        <>
          <Card className="field-detail-hero">
            <div className="field-detail-heading">
              <div>
                <p className="field-detail-project">{task.project_name}</p>
                <h1>{heading}</h1>
              </div>
              <StatusBadge status={task.status} />
            </div>
            <div className="field-detail-summary">
              {(task.location.zone_name || task.location.location_text) && (
                <InfoRow
                  className="field-detail-meta"
                  label="查核地點"
                  value={
                    <span className="field-detail-values">
                      {task.location.zone_name && (
                        <span>分區：{task.location.zone_name}</span>
                      )}
                      {task.location.location_text && (
                        <span>補充地點：{task.location.location_text}</span>
                      )}
                    </span>
                  }
                />
              )}
              <InfoRow
                className="field-detail-meta"
                label="建議指派"
                value={
                  <span className="field-detail-values">
                    <span>{task.suggested_assignee?.name_zh ?? '未指定'}</span>
                    {task.status === 'PENDING' &&
                      task.suggested_assignee &&
                      !task.suggested_assignee.is_me && (
                        <small>
                          你也可以協助開始此任務；會記錄實際開始者。
                        </small>
                      )}
                  </span>
                }
              />
              <InfoRow
                className="field-detail-meta"
                label="派送時間"
                value={displayTime(task.dispatched_at)}
              />
            </div>
          </Card>
          <SectionHeader
            className="field-section-head"
            title="查核需求"
            description="建立任務時的需求"
          />
          {task.items.map((item, itemIndex) => (
            <article className="field-detail-item" key={itemIndex}>
              <Card className="field-detail-item-card">
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
                          <dd>{formatInspectionStandard(point)}</dd>
                        </div>
                        <div>
                          <dt>照片需求</dt>
                          <dd>{photos ? `至少 ${photos} 張` : '無需照片'}</dd>
                        </div>
                      </dl>
                    </section>
                  )
                })}
              </Card>
            </article>
          ))}
          <section className="field-action-panel" aria-label="任務操作">
            <Card className="field-action-card">
              <SectionHeader title="任務操作" />
              <StartAction
                task={task}
                title={heading}
                back={back}
                onTask={setTask}
                onListChange={onListChange}
                onUnauthorized={() =>
                  navigate('/login', {
                    state: { from: location.pathname + location.search },
                  })
                }
              />
              <p>填寫結果與照片上傳將在後續版本提供。</p>
            </Card>
          </section>
        </>
      )}
    </>
  )
}
