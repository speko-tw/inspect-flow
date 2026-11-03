import { useEffect, useMemo, useState } from 'react'
import { useLocation, useParams, useSearchParams } from 'react-router'

import AccessDeniedPage from '../../../components/layout/AccessDeniedPage'
import { useCurrentUser } from '../../../auth/useCurrentUser'
import { HttpError, isForbidden, isNotFound } from '../../../http'
import { BackLink } from '../../../layout/BackLink'
import RouteNotFound from '../../../RouteNotFound'
import {
  getSuggestion,
  listRevisions,
  saveRevision,
  type SuggestionDetail,
} from './api'
import { type SuggestionContent } from './content'
import { suggestionErrorMessage } from './messages'
import {
  suggestionPath,
  type SuggestionMode,
  type SuggestionNavState,
} from './paths'
import {
  SuggestionContentEditor,
  type SaveOutcome,
} from './SuggestionContentEditor'
import './Suggestions.css'

/**
 * 修改建議內容：審核者改待審件，或提議人改自己的退回件（TPL-R31、
 * TPL-R32）。保存一律另存新修訂，內容相同則沿用原版；不開放其他
 * 狀態，也不讓提議人修改待審中的件。
 */
export default function SuggestionEditPage({
  mode,
}: {
  mode: SuggestionMode
}) {
  const { suggestionId = '' } = useParams()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { user } = useCurrentUser()
  const navState = (location.state as SuggestionNavState | null) ?? {}
  const [suggestion, setSuggestion] = useState<SuggestionDetail | null>(null)
  const [returnedNo, setReturnedNo] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let active = true
    const history = listRevisions(suggestionId)
    Promise.all([getSuggestion(suggestionId, history), history])
      .then(([detail, revisions]) => {
        if (!active) return
        setSuggestion(detail)
        setReturnedNo(
          revisions.reduce(
            (max, revision) =>
              revision.events.some((event) => event.status === 'RETURNED')
                ? Math.max(max, revision.revision_no)
                : max,
            0,
          ),
        )
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

  const content = suggestion?.current_revision.content
  // 編輯器只在第一次載入時取草稿；保存後重新導向，不原地換內容。
  const stableContent = useMemo<SuggestionContent | null>(
    () => content ?? null,
    [content],
  )

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
  if (!suggestion || !stableContent) {
    return (
      <p role="alert" tabIndex={-1}>
        {error || '無法載入這件建議。'}
      </p>
    )
  }

  const current = suggestion.current_revision
  const detailTo = suggestionPath(mode, suggestion.id)
  const detailState: SuggestionNavState = {
    origin: navState.origin,
    listSearch: navState.listSearch,
    target: navState.target,
  }
  const strict = mode === 'review'
  const editable = strict
    ? suggestion.status === 'PENDING'
    : suggestion.proposer_id === user.id && suggestion.status === 'RETURNED'
  const revisedAfterReturn = current.revision_no > returnedNo

  if (!editable) {
    return (
      <section className="suggestions">
        <BackLink state={detailState} to={detailTo}>
          返回建議詳情
        </BackLink>
        <h1>目前不能修改這件建議</h1>
        <p role="status">
          {strict
            ? '只有待審中的建議可以由審核者修改。'
            : '只有退回件可以由提議人修改；待審期間只能撤回。'}
        </p>
      </section>
    )
  }

  async function save(
    next: SuggestionContent,
    submitAfter: boolean,
  ): Promise<SaveOutcome> {
    try {
      const saved = await saveRevision(suggestion!.id, next, {
        expected_revision_id: current.id,
        expected_status: suggestion!.status,
      })
      // TPL-R32：必須由伺服器正規化及覆核權限，不能跳過無變更的請求。
      const changed = saved.current_revision_id !== current.id
      const revision = { revision_no: saved.revision_no }
      const head = changed
        ? mode === 'review'
          ? `已存第 ${revision.revision_no} 版，`
          : `已保存第 ${revision.revision_no} 版，`
        : '內容沒有變更，沿用原版本；'
      const tail =
        mode === 'review'
          ? navState.target?.system_id
            ? '目的地已保留，可再按核准。'
            : '請選擇目的地後再按核准。'
          : '尚未送審。'
      return {
        ok: true,
        to: detailTo,
        state: {
          ...detailState,
          notice: `${head}${tail}`,
          confirmResubmit: submitAfter,
        } satisfies SuggestionNavState,
      }
    } catch (caught) {
      const action = mode === 'review' ? 'review' : 'revise'
      if (caught instanceof HttpError && caught.fields?.length) {
        return { ok: false, fields: caught.fields }
      }
      return { ok: false, message: suggestionErrorMessage(caught, action) }
    }
  }

  const rename = searchParams.get('rename') === '1'
  return (
    <section aria-labelledby="suggestion-edit-heading" className="suggestions">
      <BackLink state={detailState} to={detailTo}>
        返回建議詳情
      </BackLink>
      <h1 id="suggestion-edit-heading">
        {strict ? '修改待審內容' : '修改退回件'}
      </h1>
      <SuggestionContentEditor
        canResubmit={!strict}
        cancelHref={detailTo}
        cancelState={detailState}
        content={stableContent}
        contextLabel={`範本建議 / ${suggestion.source_project_name}`}
        focusKey={searchParams.get('focus')}
        nameOnly={rename}
        onSave={save}
        resubmitHint={
          revisedAfterReturn ? null : '請先修改退回內容，才能重新送審。'
        }
        revisionNo={current.revision_no}
        strict={strict}
      />
    </section>
  )
}
