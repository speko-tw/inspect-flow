import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import {
  fetchFieldTaskDetail,
  FieldApiError,
  startFieldTask,
  type FieldTaskDetail,
} from './api'
import { personLabel, startMessages } from './startMessages'

/** 讓清單記憶跟上詳情頁已確認的結果（保留篩選、頁數與捲動）。 */
export type TaskListChange =
  { id: string; status: 'IN_PROGRESS' } | { id: string; removed: true }

type Failure = { message: string; retryable: boolean }

export default function StartAction({
  task,
  title,
  back,
  onTask,
  onListChange,
  onUnauthorized,
}: {
  task: FieldTaskDetail
  title: string
  back: string
  onTask: (task: FieldTaskDetail) => void
  onListChange?: (change: TaskListChange) => void
  onUnauthorized: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [started, setStarted] = useState(false)
  const errorRef = useRef<HTMLDivElement>(null)
  const startedRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (failure) errorRef.current?.focus()
  }, [failure])
  useEffect(() => {
    if (started) startedRef.current?.focus()
  }, [started])

  function applyLatest(latest: FieldTaskDetail) {
    onTask(latest)
    if (latest.status === 'IN_PROGRESS') {
      onListChange?.({ id: latest.id, status: 'IN_PROGRESS' })
    } else if (latest.status !== 'PENDING') {
      onListChange?.({ id: latest.id, removed: true })
    }
  }

  // 409：任務狀態已被改動。重抓 Field 詳情取得權威狀態，據此說明原因。
  async function reconcile(): Promise<Failure | null> {
    let latest: FieldTaskDetail
    try {
      latest = await fetchFieldTaskDetail(task.id)
    } catch (cause) {
      if (cause instanceof FieldApiError && cause.status === 401) {
        onUnauthorized()
        return null
      }
      if (cause instanceof FieldApiError && cause.status === 404) {
        onListChange?.({ id: task.id, removed: true })
        return { message: startMessages.missing, retryable: false }
      }
      return { message: startMessages.unknownState, retryable: false }
    }
    applyLatest(latest)
    if (latest.status === 'IN_PROGRESS' && latest.started_by?.is_me) {
      // 例如重複送出或回應遺失：其實是你開始的，直接顯示結果。
      setStarted(true)
      return null
    }
    const message = {
      CANCELLED: startMessages.cancelled(latest.cancellation_reason),
      IN_PROGRESS: startMessages.startedByOther,
      COMPLETED: startMessages.completed,
      PENDING: startMessages.unchanged,
    }[latest.status]
    return { message, retryable: false }
  }

  async function failureFor(cause: unknown): Promise<Failure | null> {
    if (!(cause instanceof FieldApiError)) {
      return { message: startMessages.retry, retryable: true }
    }
    if (cause.status === 401) {
      onUnauthorized()
      return null
    }
    if (cause.status === 403) {
      return {
        message:
          cause.code === 'auth.password_change_required'
            ? startMessages.passwordChange
            : startMessages.forbidden,
        retryable: false,
      }
    }
    if (cause.status === 404) {
      onListChange?.({ id: task.id, removed: true })
      return { message: startMessages.missing, retryable: false }
    }
    if (cause.status === 409) {
      if (cause.code === 'inspection_plan.archived') {
        return { message: startMessages.archived, retryable: false }
      }
      return reconcile()
    }
    return { message: startMessages.retry, retryable: true }
  }

  async function confirmStart() {
    if (submitting) return
    setSubmitting(true)
    setFailure(null)
    try {
      const result = await startFieldTask(task.id)
      let latest: FieldTaskDetail
      try {
        latest = await fetchFieldTaskDetail(task.id)
      } catch {
        // 已由後端確認開始；取不到詳情時只用後端回的狀態與「本人」。
        latest = {
          ...task,
          status: result.status,
          started_by: { name_zh: null, is_me: true },
          cancellation_reason: null,
        }
      }
      applyLatest(latest)
      setConfirming(false)
      setStarted(true)
    } catch (cause) {
      const next = await failureFor(cause)
      if (next) {
        setFailure(next)
        setConfirming(next.retryable)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const failed = failure && !failure.retryable
  const assignee = task.suggested_assignee

  if (task.status === 'IN_PROGRESS') {
    return (
      <>
        {failure && <FailureBox failure={failure} errorRef={errorRef} />}
        <div
          className="field-start-ok notice-success"
          role="status"
          tabIndex={-1}
          ref={startedRef}
        >
          <h3>查核進行中</h3>
          <p>實際開始者：{personLabel(task.started_by)}</p>
        </div>
        {failure && <BackLink back={back} />}
      </>
    )
  }

  if (task.status !== 'PENDING') {
    return (
      <>
        {failure ? (
          <>
            <FailureBox failure={failure} errorRef={errorRef} />
            <BackLink back={back} />
          </>
        ) : (
          <p>
            {task.status === 'COMPLETED'
              ? '查核已完成，可查看需求。'
              : `任務已取消，可查看需求。${
                  task.cancellation_reason
                    ? `取消原因：${task.cancellation_reason}`
                    : ''
                }`}
          </p>
        )}
      </>
    )
  }

  return (
    <>
      {failure && <FailureBox failure={failure} errorRef={errorRef} />}
      {failed ? (
        <BackLink back={back} />
      ) : confirming ? (
        <div className="field-confirm">
          <h3>確認開始「{title}」？</h3>
          <p>開始後會改為進行中，並記錄你是實際開始者。</p>
          {assignee && !assignee.is_me && (
            <p>
              這筆任務建議由{assignee.name_zh ?? '其他成員'}
              執行。你仍可以開始，系統會記錄你是實際開始者。
            </p>
          )}
          <button
            type="button"
            className="primary"
            disabled={submitting}
            onClick={() => void confirmStart()}
          >
            {submitting ? '開始中…' : '確認開始查核'}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => {
              setConfirming(false)
              setFailure(null)
            }}
          >
            返回查看需求
          </button>
        </div>
      ) : (
        <>
          <p>看完需求後開始查核。</p>
          <button
            type="button"
            className="primary"
            onClick={() => {
              setFailure(null)
              setConfirming(true)
            }}
          >
            開始查核
          </button>
        </>
      )}
    </>
  )
}

function FailureBox({
  failure,
  errorRef,
}: {
  failure: Failure
  errorRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <div
      className="field-inline-error"
      role="alert"
      tabIndex={-1}
      ref={errorRef}
    >
      {failure.message}
    </div>
  )
}

function BackLink({ back }: { back: string }) {
  return (
    <Link className="button-link" to={back} state={{ restoreTaskList: true }}>
      返回任務清單
    </Link>
  )
}
