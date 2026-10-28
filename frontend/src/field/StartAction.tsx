import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import { Button } from '../components/Button'
import { ConfirmationPanel } from '../components/layout/LayoutPatterns'
import {
  fetchFieldTaskDetail,
  FieldApiError,
  startFieldTask,
  type FieldTaskDetail,
} from './api'
import { useSubmitGuard } from '../ui/submitGuard'
import { personLabel, startMessages } from './startMessages'

/** 讓清單記憶跟上詳情頁已確認的結果（保留篩選、頁數與捲動）。 */
export type TaskListChange =
  { id: string; status: 'IN_PROGRESS' } | { id: string; removed: true }

/**
 * 開始查核失敗時顯示的說明。`retryable` 只用於網路中斷，以及 401／
 * 403／404／409 以外的其餘狀態碼，此時保留確認框讓使用者再按一次；權限不足、狀態已被改動等不可重試的
 * 失敗只提供返回清單。
 */
type Failure = { message: string; retryable: boolean }

/**
 * Field 任務詳情的「開始查核」操作與結果回饋（FUI-R03、FUI-R04）。
 *
 * 只有 `PENDING` 任務提供開始操作；`IN_PROGRESS` 顯示進行中與實際開始
 * 者、不得重複開始，其餘狀態只能查看。畫面不做樂觀更新，狀態與權限
 * 都以伺服器回應為準。
 *
 * @param back 「返回任務清單」的路徑，帶回清單原本的篩選與頁數。
 * @param onTask 取得最新詳情後通知上層更新。
 * @param onListChange 通知清單記憶同步（開始或已不在清單）。
 * @param onUnauthorized 登入失效（401）時由上層重新登入（FUI-R07）。
 */
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
  const guard = useSubmitGuard()
  const errorRef = useRef<HTMLDivElement>(null)
  const startedRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (failure) errorRef.current?.focus()
  }, [failure])
  useEffect(() => {
    // 依 UDS-R18 例外：成功後觸發按鈕會消失，焦點移到結果狀態區。
    if (started) startedRef.current?.focus()
  }, [started])

  // 清單只列 PENDING 與 IN_PROGRESS（FUI-R02）：進行中改標狀態，
  // 已完成或已取消的任務從清單移除。
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
      // Field 詳情對不存在、DRAFT 或無權限一律回 404（FUI-R06），
      // 所以只能說「找不到或已無法查看」，並從清單移除。
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
      // 臨時密碼尚未變更時後端也回 403，文案要指向變更密碼，
      // 不能說成沒有權限。
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
    // 409：計畫已封存時任務只能查看（FUI-R04）；其餘 409 代表任務
    // 狀態已被改動，重抓詳情後說明實際原因。
    if (cause.status === 409) {
      if (cause.code === 'inspection_plan.archived') {
        return { message: startMessages.archived, retryable: false }
      }
      return reconcile()
    }
    return { message: startMessages.retry, retryable: true }
  }

  async function confirmStart() {
    // 快速連按 Enter 時，state 與停用的按鈕擋不住同一輪事件內的第二次
    // 送出，所以另用 ref 同步擋掉（見 submitGuard）。
    if (submitting || !guard.enter()) return
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
      // next 為 null 有兩種情況，這裡都不顯示錯誤：401 已交給
      // onUnauthorized 處理；或 409 重抓後發現其實是本人開始，
      // reconcile() 已套用最新資料並顯示進行中。
      if (next) {
        setFailure(next)
        setConfirming(next.retryable)
      }
    } finally {
      guard.leave()
      setSubmitting(false)
    }
  }

  const failed = failure && !failure.retryable
  const assignee = task.suggested_assignee

  // 進行中：不得重複開始，只顯示實際開始者（FUI-R04）。有 failure
  // 時（例如已被別人開始）另附返回清單。
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
        {failure && <TaskListLink back={back} />}
      </>
    )
  }

  // 已完成或已取消：不提供開始操作（FUI-R04）。
  if (task.status !== 'PENDING') {
    return (
      <>
        {failure ? (
          <>
            <FailureBox failure={failure} errorRef={errorRef} />
            <TaskListLink back={back} />
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
        <TaskListLink back={back} />
      ) : confirming ? (
        <ConfirmationPanel
          tone="neutral"
          confirming={submitting}
          confirmLabel="確認開始查核"
          cancelLabel="取消"
          impact="開始後會改為進行中，並記錄你是實際開始者。"
          onCancel={() => {
            setConfirming(false)
            setFailure(null)
          }}
          onConfirm={confirmStart}
          // 取消後焦點回到「開始查核」按鈕；它在確認收合後才重新
          // render，所以延後再聚焦。
          returnFocus={() => {
            queueMicrotask(() =>
              document.getElementById('field-start-task')?.focus(),
            )
          }}
          title={`確認開始「${title}」？`}
        />
      ) : (
        <>
          <p>看完需求後開始查核。</p>
          <Button
            id="field-start-task"
            variant="primary"
            className="field-primary-action"
            onClick={() => {
              setFailure(null)
              setConfirming(true)
            }}
          >
            開始查核
          </Button>
        </>
      )}
      {/* 建議指派只是預設，不限制同專案其他有權限的成員開始任務
          （FUI-R02）；非本人時只提醒，仍可開始，並記錄實際開始者。 */}
      {confirming && assignee && !assignee.is_me && (
        <p className="field-confirm-assignee-note">
          這筆任務建議由{assignee.name_zh ?? '其他成員'}
          執行。你仍可以開始，系統會記錄你是實際開始者。
        </p>
      )}
    </>
  )
}

/** 開始失敗的說明；`role="alert"` 並可聚焦，錯誤出現時由外層聚焦。 */
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

/** 返回任務清單，`restoreTaskList` 讓清單還原原本的篩選與捲動位置。 */
function TaskListLink({ back }: { back: string }) {
  return (
    <Link className="btn" to={back} state={{ restoreTaskList: true }}>
      返回任務清單
    </Link>
  )
}
