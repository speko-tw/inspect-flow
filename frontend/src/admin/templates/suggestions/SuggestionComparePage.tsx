import { useEffect, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router'

import AccessDeniedPage from '../../../components/layout/AccessDeniedPage'
import { isForbidden, isNotFound } from '../../../http'
import { BackLink } from '../../../layout/BackLink'
import RouteNotFound from '../../../RouteNotFound'
import {
  compareRevisions,
  getSuggestion,
  listRevisions,
  type SuggestionDetail,
  type SuggestionRevision,
} from './api'
import { backendDifferences, DIFFERENCE_LABELS, displayTitle } from './content'
import { formatTime } from './format'
import { suggestionErrorMessage } from './messages'
import { suggestionPath, type SuggestionNavState } from './paths'
import { SuggestionContentView } from './SuggestionContentView'
import './Suggestions.css'

type Side = 'before' | 'after'

/**
 * 管理者比較相鄰兩版（TPL-R32、TPL-AC36）。差異由後端依穩定邏輯
 * 識別判定，前端只格式化呈現；非相鄰的兩版不提供選項，也不會送出請求。手機寬度預設收合
 * 兩份完整內容，先看差異摘要，再按「看前版／看後版」跳到同一項次。
 */
export default function SuggestionComparePage() {
  const { suggestionId = '' } = useParams()
  const location = useLocation()
  const navState = (location.state as SuggestionNavState | null) ?? {}
  const [suggestion, setSuggestion] = useState<SuggestionDetail | null>(null)
  const [revisions, setRevisions] = useState<SuggestionRevision[]>([])
  const [pairNo, setPairNo] = useState<number | null>(null)
  const [pair, setPair] = useState<Awaited<
    ReturnType<typeof compareRevisions>
  > | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const summaryRef = useRef<HTMLHeadingElement>(null)
  const sides = useRef<Record<Side, HTMLDetailsElement | null>>({
    before: null,
    after: null,
  })

  useEffect(() => {
    let active = true
    const history = listRevisions(suggestionId)
    Promise.all([getSuggestion(suggestionId, history), history])
      .then(([detail, list]) => {
        if (!active) return
        setSuggestion(detail)
        setRevisions(list)
        setPairNo(list.length > 1 ? list[list.length - 1].revision_no : null)
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
  }, [suggestionId])

  useEffect(() => {
    if (pairNo === null) return
    const to = revisions.find((r) => r.revision_no === pairNo)
    const from = revisions.find((r) => r.revision_no === pairNo - 1)
    if (!to || !from) return
    let active = true
    compareRevisions(suggestionId, from.id, to.id)
      .then((result) => {
        if (active) {
          setPair(result)
          setError('')
        }
      })
      .catch((caught: unknown) => {
        if (!active) return
        setPair(null)
        setError(suggestionErrorMessage(caught, 'review'))
      })
    return () => {
      active = false
    }
  }, [pairNo, revisions, suggestionId])

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

  const detailTo = suggestionPath('review', suggestionId)
  const back = (
    <BackLink state={navState} to={detailTo}>
      返回建議詳情
    </BackLink>
  )
  if (!suggestion || revisions.length < 2) {
    return (
      <section className="suggestions">
        {back}
        <h1>尚無可比較的前後兩版</h1>
        {error && <p role="alert">{error}</p>}
      </section>
    )
  }

  const differences = pair ? backendDifferences(pair) : []
  const narrow =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 640px)').matches

  function jump(side: Side, pointId: string | null) {
    const host = sides.current[side]
    if (!host) return
    host.open = true
    const target =
      (pointId &&
        document.getElementById(`compare-${side}-point-${pointId}`)) ||
      document.getElementById(`compare-${side}-item`)
    target?.focus({ preventScroll: true })
    target?.scrollIntoView?.({ block: 'start' })
  }

  return (
    <section
      aria-labelledby="suggestion-compare-heading"
      className="suggestions"
    >
      {back}
      <h1 id="suggestion-compare-heading">比較前後兩版</h1>
      <p>{displayTitle(suggestion.current_revision.content.title)}</p>
      <label htmlFor="suggestion-compare-pair">相鄰版本</label>
      <select
        id="suggestion-compare-pair"
        onChange={(event) => setPairNo(Number(event.target.value))}
        value={pairNo ?? undefined}
      >
        {revisions.slice(1).map((revision) => (
          <option key={revision.id} value={revision.revision_no}>
            第 {revision.revision_no - 1} 版／第 {revision.revision_no} 版
          </option>
        ))}
      </select>
      {error && <p role="alert">{error}</p>}
      <h2 id="suggestion-compare-summary" ref={summaryRef} tabIndex={-1}>
        差異摘要
      </h2>
      {pair &&
        (differences.length > 0 ? (
          <ul className="suggestion-changes">
            {differences.map((difference, index) => (
              <li key={`${difference.label}-${index}`}>
                <span className="badge badge-neutral">
                  {DIFFERENCE_LABELS[difference.kind]}
                </span>{' '}
                <strong>{difference.label}</strong>
                <p>
                  前：{difference.before}
                  <br />
                  後：{difference.after}
                </p>
                <div className="suggestion-actions">
                  <button
                    className="link-button"
                    onClick={() => jump('before', difference.pointId)}
                    type="button"
                  >
                    看前版
                  </button>
                  <button
                    className="link-button"
                    onClick={() => jump('after', difference.pointId)}
                    type="button"
                  >
                    看後版
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p>這兩版內容相同。</p>
        ))}
      {pair && (
        <div className="suggestion-compare-grid">
          {(
            [
              ['before', pair.from],
              ['after', pair.to],
            ] as const
          ).map(([side, revision]) => (
            <details
              className="suggestion-compare-side"
              id={`compare-${side}`}
              key={`${side}-${revision.id}`}
              open={!narrow}
              ref={(node) => {
                sides.current[side] = node
              }}
            >
              <summary>
                {side === 'before' ? '前版' : '後版'}：第{' '}
                {revision.revision_no} 版完整內容
              </summary>
              <p>
                {revision.editor_name} · {formatTime(revision.created_at)}
              </p>
              {(revisions.find((row) => row.id === revision.id)?.events ?? [])
                .length === 0 ? (
                <p>修訂已保存，尚無此版的審核決定。</p>
              ) : (
                (
                  revisions.find((row) => row.id === revision.id)?.events ?? []
                ).map((event) => (
                  <p key={`${event.status}-${event.created_at}`}>
                    {event.actor_name} · {formatTime(event.created_at)}
                    {event.reason && (
                      <>
                        <br />
                        退回原因：{event.reason}
                      </>
                    )}
                  </p>
                ))
              )}
              <SuggestionContentView
                content={revision.content}
                idPrefix={`compare-${side}`}
              />
              <button
                className="link-button"
                onClick={() => {
                  summaryRef.current?.scrollIntoView?.({ block: 'start' })
                  summaryRef.current?.focus({ preventScroll: true })
                }}
                type="button"
              >
                返回差異摘要
              </button>
            </details>
          ))}
        </div>
      )}
    </section>
  )
}
