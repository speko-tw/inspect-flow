import { useRef, useState } from 'react'
import { Link } from 'react-router'

import { ConfirmBox } from '../../../ui/ConfirmBox'
import { revealElement } from '../../../ui/reveal'
import { createSuggestion, listMySuggestions } from './api'
import { PENDING_WARNING } from './format'
import { suggestionErrorMessage } from './messages'
import { projectSuggestionsPath, type SuggestionNavState } from './paths'

/**
 * 專案查核項目列上的「建議加入範本庫」（TPL-R29、TPL-R36）。
 *
 * 只由有編輯權的人看到（呼叫端判斷）。確認框先說明對象、複製什麼、
 * 不改什麼，以及送出即待審（PR-18／PR-19）；同一來源已有待審或退回件時
 * 提醒但不阻擋。成功後在列內留言並提供直達本案清單的連結。
 */
export function ProposeSuggestion({
  projectId,
  itemId,
  itemTitle,
  onProposed,
}: {
  projectId: string
  itemId: string
  itemTitle: string
  /** 成功後通知上層重讀「本案共 N 件」。 */
  onProposed: () => void
}) {
  const [open, setOpen] = useState(false)
  const [duplicate, setDuplicate] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)
  const noticeRef = useRef<HTMLParagraphElement>(null)

  async function start() {
    setError('')
    setNotice('')
    setDuplicate(false)
    setOpen(true)
    try {
      // 提醒讀不到不擋提出；只是少一則提示。
      const page = await listMySuggestions({
        source_project_id: projectId,
        limit: 100,
      })
      setDuplicate(
        page.items.some(
          (item) =>
            item.source_item_id === itemId &&
            (item.status === 'PENDING' || item.status === 'RETURNED'),
        ),
      )
    } catch {
      setDuplicate(false)
    }
  }

  async function confirm() {
    setError('')
    try {
      await createSuggestion(projectId, itemId)
    } catch (caught) {
      setError(suggestionErrorMessage(caught, 'propose'))
      return
    }
    setOpen(false)
    setNotice(`「${itemTitle}」已送審。可由「我的範本建議」查看結果。`)
    onProposed()
    window.setTimeout(() => {
      revealElement(noticeRef.current)
      noticeRef.current?.focus({ preventScroll: true })
    }, 0)
  }

  return (
    <>
      <button
        aria-label={`建議「${itemTitle}」加入範本庫`}
        className="btn btn-sm"
        onClick={() => void start()}
        ref={trigger}
        type="button"
      >
        建議加入範本庫
      </button>
      {notice && (
        <p
          className="notice-success"
          ref={noticeRef}
          role="status"
          tabIndex={-1}
        >
          {notice}{' '}
          <Link
            state={{ origin: 'project' } satisfies SuggestionNavState}
            to={projectSuggestionsPath(projectId)}
          >
            查看我的範本建議
          </Link>
        </p>
      )}
      {open && (
        <ConfirmBox
          confirmLabel="確認提出"
          headingLevel={3}
          onCancel={() => {
            setOpen(false)
            setError('')
            trigger.current?.focus()
          }}
          onConfirm={confirm}
          title="確認提出建議"
        >
          <p>對象：「{itemTitle}」</p>
          <p>
            將目前的項目、標準、實測欄位定義及照片需求複製成一件待審建議；
            不改來源、不複製查核結果或照片，送出即進入待審。
            {PENDING_WARNING}
          </p>
          {duplicate && (
            <p className="notice-info">
              提醒：同一來源項目已有待審或退回件；仍可繼續提出另一件建議。
            </p>
          )}
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </ConfirmBox>
      )}
    </>
  )
}
