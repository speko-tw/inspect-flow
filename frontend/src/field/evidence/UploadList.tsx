import { useState } from 'react'

import { Button } from '../../components/Button'
import { ConfirmBox } from '../../ui/ConfirmBox'
import type { QueuedUpload } from './useUploadQueue'
import { MAX_AUTO_RETRIES } from './uploadRetry'

/** 一張待上傳照片的進度說明；失敗訊息已由 `messages.ts` 轉成白話。 */
function statusText(entry: QueuedUpload): string {
  if (entry.status === 'sending') return '上傳中…'
  if (entry.status === 'retrying') {
    return `網路不穩，自動重試中 ${entry.retry}／${MAX_AUTO_RETRIES}…`
  }
  return entry.message
}

/**
 * 上傳狀態清單（FEV-R08、FEV-AC10）。失敗時照片仍留在畫面上；可重試的
 * 失敗提供「手動重送」（沿用同一冪等鍵與同一份內容），後端拒絕的 4xx
 * 只說明原因。放棄照片要先在頁內說明對象與後果再確認（FEV-R15）。
 */
export function UploadList({
  uploads,
  onResend,
  onAbandon,
}: {
  uploads: QueuedUpload[]
  onResend: (localId: string) => void
  onAbandon: (localId: string) => void
}) {
  const [confirming, setConfirming] = useState<string | null>(null)
  if (uploads.length === 0) return null
  return (
    <section className="evidence-uploads" aria-labelledby="evidence-uploads">
      <h3 id="evidence-uploads">上傳狀態</h3>
      <p className="evidence-hint">
        照片只暫留在這個頁面，請先完成上傳再離開。
      </p>
      <ul className="evidence-upload-list">
        {uploads.map((entry) => (
          <li className="evidence-upload" key={entry.localId}>
            <img
              alt="待上傳的現場照片"
              className="evidence-thumb"
              src={entry.previewUrl}
            />
            <div className="evidence-upload-text">
              <p className="evidence-upload-title">
                {entry.caption || '未填註記的照片'}
              </p>
              <p className="evidence-hint">
                {entry.itemTitle}・{entry.targetText}
              </p>
              <p
                className={
                  entry.status === 'failed' || entry.status === 'rejected'
                    ? 'evidence-upload-status evidence-upload-failed'
                    : 'evidence-upload-status'
                }
                role="status"
              >
                {entry.status === 'failed' || entry.status === 'rejected'
                  ? `上傳失敗：${statusText(entry)}`
                  : statusText(entry)}
              </p>
            </div>
            <div className="evidence-actions">
              {entry.status === 'failed' && (
                <Button
                  onClick={() => onResend(entry.localId)}
                  type="button"
                  variant="primary"
                >
                  手動重送
                </Button>
              )}
              <Button
                className="btn-danger-outline"
                onClick={() => setConfirming(entry.localId)}
                type="button"
              >
                放棄這張照片
              </Button>
            </div>
            {confirming === entry.localId && (
              <ConfirmBox
                cancelLabel="保留照片"
                confirmLabel="放棄照片"
                headingLevel={3}
                onCancel={() => setConfirming(null)}
                onConfirm={() => {
                  setConfirming(null)
                  onAbandon(entry.localId)
                }}
                title="放棄這張照片？"
                variant="danger"
              >
                <p>
                  這張照片還沒有上傳（{entry.itemTitle}・{entry.targetText}）。
                  放棄後無法找回，需要時請重新拍攝。
                </p>
              </ConfirmBox>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
