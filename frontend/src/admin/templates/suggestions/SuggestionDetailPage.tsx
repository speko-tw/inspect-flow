import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'

import AccessDeniedPage from '../../../components/layout/AccessDeniedPage'
import { useCurrentUser } from '../../../auth/useCurrentUser'
import { HttpError, isForbidden, isNotFound } from '../../../http'
import { BackLink } from '../../../layout/BackLink'
import RouteNotFound from '../../../RouteNotFound'
import { ConfirmBox } from '../../../ui/ConfirmBox'
import { revealElement } from '../../../ui/reveal'
import {
  getPendingCount,
  getSuggestion,
  listRevisions,
  submitSuggestion,
  withdrawSuggestion,
  type Expected,
  type SuggestionDetail,
  type SuggestionRevision,
} from './api'
import { completenessErrors, displayTitle } from './content'
import { formatTime, PENDING_WARNING } from './format'
import { suggestionErrorMessage } from './messages'
import {
  suggestionPath,
  type SuggestionMode,
  type SuggestionNavState,
} from './paths'
import { SuggestionApprovalArea } from './SuggestionApprovalArea'
import { SuggestionContentView } from './SuggestionContentView'
import { SuggestionStatusBadge } from './SuggestionStatusBadge'
import './Suggestions.css'

type Pending = 'resubmit' | 'withdraw' | null

/** 修訂旁的「（某人修改）」標記：最新版不是提議人保存時顯示。 */
function editedBy(
  suggestion: SuggestionDetail,
  revision: SuggestionRevision,
): string {
  return revision.editor_id === suggestion.proposer_id
    ? ''
    : `（${revision.editor_name}修改）`
}

/**
 * 建議詳情：提議人讀自己各版與原因、重送與撤回（`mine`），管理者讀完整
 * 歷程、核准或退回（`review`）。所有寫入都帶 expected 欄位，後端回 409
 * 時請使用者重讀，不覆蓋別人剛做的改動（TPL-R31）。
 */
export default function SuggestionDetailPage({
  mode,
}: {
  mode: SuggestionMode
}) {
  const { suggestionId = '' } = useParams()
  const location = useLocation()
  const { user } = useCurrentUser()
  const navState = (location.state as SuggestionNavState | null) ?? {}
  // AC42：目的地屬於整件審核流程，不能跟歷史版切換時的子元件卸載。
  const [target, setTarget] = useState(navState.target)
  const [suggestion, setSuggestion] = useState<SuggestionDetail | null>(null)
  const [revisions, setRevisions] = useState<SuggestionRevision[]>([])
  const [selectedNo, setSelectedNo] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [notice, setNotice] = useState(navState.notice ?? '')
  const [pending, setPending] = useState<Pending>(null)
  const [confirmError, setConfirmError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sourceLost, setSourceLost] = useState(false)
  const [missing, setMissing] = useState<Record<string, string> | null>(null)
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const focusNotice = useRef(false)
  const noticeRef = useRef<HTMLParagraphElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const autoConfirm = useRef(Boolean(navState.confirmResubmit))

  const refreshPendingCount = useCallback(() => {
    if (mode !== 'review') return
    getPendingCount()
      .then((value) => setPendingCount(value.pending_count))
      .catch(() => setPendingCount(null))
  }, [mode])

  const fetchAll = useCallback(() => {
    const history = listRevisions(suggestionId)
    return Promise.all([getSuggestion(suggestionId, history), history])
  }, [suggestionId])

  const apply = useCallback(
    ([detail, list]: [SuggestionDetail, SuggestionRevision[]]) => {
      setSuggestion(detail)
      setRevisions(list)
      setSelectedNo(detail.current_revision.revision_no)
    },
    [],
  )

  async function reload() {
    const result = await fetchAll()
    apply(result)
    return { detail: result[0], list: result[1] }
  }

  useEffect(() => {
    let active = true
    fetchAll()
      .then((result) => {
        if (active) apply(result)
      })
      .catch((caught: unknown) => {
        if (!active) return
        if (isForbidden(caught)) setDenied(true)
        else if (isNotFound(caught)) setNotFound(true)
        else setError(suggestionErrorMessage(caught, 'read'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [fetchAll, apply])

  useEffect(() => {
    refreshPendingCount()
  }, [refreshPendingCount])

  useEffect(() => {
    if (notice) {
      revealElement(noticeRef.current)
      // UDS-R18：動作成功後觸發者可能消失，讓結果承接鍵盤位置。
      if (focusNotice.current) {
        focusNotice.current = false
        noticeRef.current?.focus({ preventScroll: true })
      }
    }
  }, [notice])

  const latest = suggestion?.current_revision
  const returnedNo = revisions.reduce(
    (max, revision) =>
      revision.events.some((event) => event.status === 'RETURNED')
        ? Math.max(max, revision.revision_no)
        : max,
    0,
  )
  const revisedAfterReturn = latest ? latest.revision_no > returnedNo : false
  const isProposer = suggestion?.proposer_id === user.id

  function expected(): Expected {
    return {
      expected_revision_id: suggestion!.current_revision_id,
      expected_status: suggestion!.status,
    }
  }

  function startResubmit() {
    if (!latest) return
    const issues = completenessErrors(latest.content)
    setConfirmError('')
    if (Object.keys(issues).length > 0) {
      setMissing(issues)
      setPending(null)
      return
    }
    setMissing(null)
    setPending('resubmit')
  }

  // 「儲存並重新送審」存好新版後回到這裡，直接開啟重送確認。
  const autoReady = Boolean(latest) && isProposer
  useEffect(() => {
    if (!autoReady || !autoConfirm.current) return
    autoConfirm.current = false
    startResubmit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoReady])

  async function runAction(action: 'resubmit' | 'withdraw') {
    if (!suggestion) return
    setBusy(true)
    setConfirmError('')
    try {
      if (action === 'resubmit') {
        await submitSuggestion(suggestion.id, expected())
      } else {
        await withdrawSuggestion(suggestion.id, expected())
      }
      const { detail } = await reload()
      setPending(null)
      focusNotice.current = true
      setNotice(
        action === 'resubmit'
          ? `第 ${detail.current_revision.revision_no} 版已重新送審。`
          : `已撤回第 ${detail.current_revision.revision_no} 版建議，內容與歷程保留。`,
      )
    } catch (caught) {
      if (action === 'resubmit' && isForbidden(caught)) setSourceLost(true)
      if (
        caught instanceof HttpError &&
        caught.code === 'template_suggestion.changed'
      ) {
        await reload().catch(() => undefined)
      }
      setConfirmError(
        suggestionErrorMessage(
          caught,
          action === 'resubmit' ? 'submit' : 'withdraw',
        ),
      )
    } finally {
      setBusy(false)
    }
  }

  if (denied) return <AccessDeniedPage />
  if (notFound) {
    return (
      <RouteNotFound
        message="網址可能輸入錯誤，或這件建議已不存在。"
        title="找不到這件建議"
      />
    )
  }
  if (loading) return <p>載入中…</p>
  if (!suggestion || !latest) {
    return (
      <p role="alert" tabIndex={-1}>
        {error || '無法載入這件建議。'}
      </p>
    )
  }

  const selected =
    revisions.find((revision) => revision.revision_no === selectedNo) ?? latest
  const isCurrent = selected.revision_no === latest.revision_no
  const canReview = mode === 'review' && suggestion.status === 'PENDING'
  const canRevise =
    mode === 'mine' &&
    isProposer &&
    suggestion.status === 'RETURNED' &&
    !sourceLost
  const canEditPending = canReview && isCurrent
  const canWithdraw =
    mode === 'mine' &&
    isProposer &&
    (suggestion.status === 'PENDING' || suggestion.status === 'RETURNED')
  const listPath = `${suggestionPath(mode)}${navState.listSearch ?? ''}`
  const passState: SuggestionNavState = {
    origin: navState.origin,
    listSearch: navState.listSearch,
    target,
  }
  const editTo = (query = '') => ({
    pathname: suggestionPath(mode, suggestion.id, 'edit'),
    search: query,
  })

  return (
    <section aria-labelledby="suggestion-heading" className="suggestions">
      <BackLink state={passState} to={listPath}>
        {mode === 'mine'
          ? '返回建議清單'
          : `返回範本建議審核${
              pendingCount === null ? '' : `（待審 ${pendingCount} 件）`
            }`}
      </BackLink>
      <h1 id="suggestion-heading" ref={headingRef} tabIndex={-1}>
        {displayTitle(latest.content.title)}
      </h1>
      <SuggestionStatusBadge status={suggestion.status} />
      <p>
        提議人：{suggestion.proposer_name} · 來源：
        {suggestion.source_project_name}／{suggestion.source_item_title}
      </p>
      <p className="muted-text">
        建議保存提出時的項目結構，不會因來源後續修改而改變。
      </p>
      <div aria-live="polite">
        {notice && (
          <p
            className="notice-success"
            ref={noticeRef}
            role="status"
            tabIndex={-1}
          >
            {notice}
          </p>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {suggestion.latest_return && (
        <p className="notice-info">
          第 {suggestion.latest_return.revision_no} 版退回原因：
          {suggestion.latest_return.reason}
          <br />
          {suggestion.latest_return.reviewer_name} ·{' '}
          {formatTime(suggestion.latest_return.returned_at)}
        </p>
      )}
      {suggestion.approval && (
        <p className="notice-success">
          已核准第 {suggestion.approval.revision_no} 版，入庫：
          {suggestion.approval.category_name}／
          {suggestion.approval.system_name}／
          {suggestion.approval.template_title}
          {suggestion.approval.sequence !== null &&
            `，序號 ${suggestion.approval.sequence}`}
          。<br />
          審核人：{suggestion.approval.reviewer_name} ·{' '}
          {formatTime(suggestion.approval.reviewed_at)}
        </p>
      )}
      <div className="suggestion-version-picker">
        <label htmlFor="suggestion-version">檢視版本</label>
        <select
          id="suggestion-version"
          onChange={(event) => setSelectedNo(Number(event.target.value))}
          value={selected.revision_no}
        >
          {revisions.map((revision) => (
            <option key={revision.id} value={revision.revision_no}>
              第 {revision.revision_no} 版 · {revision.editor_name}
            </option>
          ))}
        </select>
      </div>
      <h2>
        第 {selected.revision_no} 版內容
        {isCurrent ? '（最新）' : '（歷史唯讀）'}
      </h2>
      <p>
        編輯者：{selected.editor_name} · {formatTime(selected.created_at)}
      </p>
      <SuggestionContentView content={selected.content} />
      <div className="suggestion-actions">
        {mode === 'review' && revisions.length > 1 && (
          <Link
            className="btn"
            state={passState}
            to={suggestionPath(mode, suggestion.id, 'compare')}
          >
            比較前後兩版
          </Link>
        )}
        {canEditPending && (
          <Link className="btn" state={passState} to={editTo()}>
            修改建議內容
          </Link>
        )}
        {canRevise && (
          <Link className="btn" state={passState} to={editTo()}>
            修改退回件
          </Link>
        )}
      </div>
      {mode === 'mine' && isProposer && suggestion.status === 'RETURNED' && (
        <>
          {sourceLost && (
            <p className="notice-info" role="status">
              來源專案編輯權已失效，仍可查看歷程及撤回；不能修改或重送。
            </p>
          )}
          <section aria-label="重新送審" id="suggestion-resubmit-area">
            {sourceLost ? (
              <p>來源專案編輯權已失效，不能重新送審。</p>
            ) : revisedAfterReturn ? (
              <p>此版尚未送審，確認完整後可重新送審。</p>
            ) : (
              <p id="suggestion-resubmit-hint">
                請先修改退回內容並保存新版本，才能重新送審。
              </p>
            )}
            <button
              aria-describedby={
                !revisedAfterReturn ? 'suggestion-resubmit-hint' : undefined
              }
              className="btn-primary"
              disabled={sourceLost || !revisedAfterReturn || busy}
              onClick={startResubmit}
              type="button"
            >
              重新送審
            </button>
            {missing && (
              <section
                className="suggestion-error-summary"
                role="alert"
                tabIndex={-1}
              >
                <h3>此版尚未送審，請完成以下欄位</h3>
                <ul>
                  {Object.entries(missing).map(([key, message]) => (
                    <li key={key}>
                      <Link
                        state={passState}
                        to={editTo(`?focus=${encodeURIComponent(key)}`)}
                      >
                        {message}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {pending === 'resubmit' && (
              <ConfirmBox
                busy={busy}
                confirmLabel="確認重新送審"
                headingLevel={3}
                onCancel={() => setPending(null)}
                onConfirm={() => runAction('resubmit')}
                title="確認重新送審"
              >
                <p>
                  將本件第 {latest.revision_no}{' '}
                  版重新交給範本管理者審核；沿用同一件建議，先前內容與退回原因繼續保留。
                  {PENDING_WARNING}
                </p>
                {confirmError && <p role="alert">{confirmError}</p>}
              </ConfirmBox>
            )}
          </section>
        </>
      )}
      {mode === 'review' && suggestion.status === 'PENDING' && !isCurrent && (
        <section aria-label="核准" id="suggestion-approval-area">
          <p className="notice-info">請切回最新版才能核准</p>
          <button
            onClick={() => setSelectedNo(latest.revision_no)}
            type="button"
          >
            切回最新第 {latest.revision_no} 版
          </button>
        </section>
      )}
      {canReview && isCurrent && (
        <SuggestionApprovalArea
          editTo={editTo}
          expected={expected}
          target={target ?? { category_id: '', system_id: '' }}
          onTargetChange={setTarget}
          onChanged={async (message) => {
            await reload()
            focusNotice.current = true
            setNotice(message)
            refreshPendingCount()
          }}
          passState={passState}
          suggestion={suggestion}
        />
      )}
      {canWithdraw && (
        <section aria-label="撤回">
          <div className="suggestion-actions">
            <button
              className="btn-danger-outline"
              disabled={busy}
              onClick={() => {
                setConfirmError('')
                setPending('withdraw')
              }}
              type="button"
            >
              撤回建議
            </button>
          </div>
          {pending === 'withdraw' && (
            <ConfirmBox
              busy={busy}
              confirmLabel="確認撤回"
              headingLevel={3}
              onCancel={() => setPending(null)}
              onConfirm={() => runAction('withdraw')}
              title="確認撤回建議"
              variant="danger"
            >
              <p>
                撤回「{displayTitle(latest.content.title)}
                」後不再審核；各版與退回原因保留，本件不能再重送。需要再次提議時請建立新件。
              </p>
              {confirmError && <p role="alert">{confirmError}</p>}
            </ConfirmBox>
          )}
        </section>
      )}
      <section aria-labelledby="suggestion-history-heading">
        <h2 id="suggestion-history-heading">各版歷程</h2>
        <div className="suggestion-history">
          {revisions.map((revision) => (
            <article key={revision.id}>
              <h3>
                第 {revision.revision_no} 版{editedBy(suggestion, revision)}
              </h3>
              <p>
                編輯者：{revision.editor_name} ·{' '}
                {formatTime(revision.created_at)}
              </p>
              {revision.events.length === 0 ? (
                <p>修訂已保存，尚無此版的審核決定。</p>
              ) : (
                revision.events.map((event) => (
                  <p key={`${event.status}-${event.created_at}`}>
                    {
                      {
                        PENDING: '待審',
                        RETURNED: '退回',
                        APPROVED: '已核准',
                        WITHDRAWN: '已撤回',
                      }[event.status]
                    }{' '}
                    · {event.actor_name} · {formatTime(event.created_at)}
                    {event.reason && (
                      <>
                        <br />
                        退回原因：{event.reason}
                      </>
                    )}
                  </p>
                ))
              )}
              <button
                className="link-button"
                onClick={() => {
                  setSelectedNo(revision.revision_no)
                  headingRef.current?.focus()
                }}
                type="button"
              >
                查看第 {revision.revision_no} 版
              </button>
            </article>
          ))}
        </div>
      </section>
    </section>
  )
}
