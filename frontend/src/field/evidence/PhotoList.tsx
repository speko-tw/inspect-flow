import { Button } from '../../components/Button'
import { ConfirmBox } from '../../ui/ConfirmBox'
import { Notice } from '../../ui/Notice'
import { FormError } from '../../ui/Form'
import { pointLabel } from './CoverageList'
import { photoImageUrl } from './evidenceApi'
import { PhotoThumb } from './PhotoThumb'
import type { Coverage, CoverageItem, FieldPhoto } from './types'

/** 目前的刪除確認狀態：哪張照片、送出中與後端回的錯誤。 */
export interface DeleteState {
  photoId: string
  busy: boolean
  error: string
}

/** 修改結果留在該照片卡片；刪除後留在原項目的照片區（RG-M25）。 */
export interface PhotoFeedback {
  itemId: string
  photoId: string | null
  text: string
}

/** 時間顯示成裝置當地的「年/月/日 時:分」。 */
function displayTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-TW', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date)
}

/** 這張照片對應到哪裡，供清單與刪除說明使用。 */
export function targetOf(photo: FieldPhoto, item: CoverageItem): string {
  if (photo.is_overview) return '總覽照片（選拍）'
  const labels = item.points
    .filter((point) => photo.point_ids.includes(point.id))
    .map(pointLabel)
  return labels.length ? `佐證項次：${labels.join('、')}` : '佐證項次'
}

/**
 * 已上傳照片清單（依查核項目分組，總覽在前，排序由後端決定）。
 * 縮圖在前端合成圖層預覽（FEV-R23）。修改與刪除只給拍照者本人且任務
 * 進行中時使用；刪除先在卡片內說明對象與後果再確認（FEV-R10、R15），
 * 後端仍會覆核狀態與權限。
 */
export function PhotoList({
  taskId,
  coverage,
  photos,
  canChange,
  feedback,
  deleting,
  onModify,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  taskId: string
  coverage: Coverage
  photos: FieldPhoto[]
  canChange: boolean
  feedback: PhotoFeedback | null
  deleting: DeleteState | null
  onModify: (photo: FieldPhoto) => void
  onAskDelete: (photo: FieldPhoto) => void
  onCancelDelete: () => void
  onConfirmDelete: (photo: FieldPhoto) => void
}) {
  return (
    <>
      <h3 className="evidence-photos-title">
        已上傳照片（{photos.length} 張）
      </h3>
      {photos.length === 0 && <p>還沒有上傳照片。</p>}
      {coverage.items.map((item) => {
        const own = photos.filter((photo) => photo.item_id === item.item_id)
        if (own.length === 0 && feedback?.itemId !== item.item_id) return null
        return (
          <section
            aria-label={`${item.title}的照片`}
            className="evidence-photo-group"
            key={item.item_id}
          >
            <h4>{item.title}</h4>
            <ul className="evidence-photo-grid">
              {own.map((photo) => {
                const mine = canChange && photo.uploaded_by.is_me
                const target = targetOf(photo, item)
                const confirming = deleting?.photoId === photo.id
                return (
                  <li className="evidence-photo" key={photo.id}>
                    <PhotoThumb
                      width={photo.width}
                      height={photo.height}
                      alt={photo.caption || '現場照片'}
                      labels={photo.labels}
                      layer={photo.layer}
                      src={photoImageUrl(taskId, photo.id, 640)}
                    />
                    <h5>{photo.caption || '未填註記'}</h5>
                    <p>{target}</p>
                    <small>
                      {photo.uploaded_by.name_zh ?? '未記錄'}・
                      {displayTime(photo.uploaded_at)}
                    </small>
                    {!photo.uploaded_by.is_me && (
                      <p className="evidence-hint">
                        這是其他人上傳的照片，只能查看。
                      </p>
                    )}
                    {mine && (
                      <div className="evidence-actions">
                        <Button
                          aria-label={`修改說明與項次，${photo.caption || target}`}
                          onClick={() => onModify(photo)}
                          type="button"
                        >
                          修改說明與項次
                        </Button>
                        <Button
                          aria-label={`刪除照片，${photo.caption || target}`}
                          className="btn-danger-outline"
                          onClick={() => onAskDelete(photo)}
                          type="button"
                        >
                          刪除照片
                        </Button>
                      </div>
                    )}
                    {feedback?.photoId === photo.id && (
                      <Notice>{feedback.text}</Notice>
                    )}
                    {confirming && deleting && (
                      <ConfirmBox
                        busy={deleting.busy}
                        cancelLabel="保留照片"
                        confirmLabel="刪除照片"
                        headingLevel={3}
                        onCancel={onCancelDelete}
                        onConfirm={() => onConfirmDelete(photo)}
                        title="刪除這張照片？"
                        variant="danger"
                      >
                        <p>
                          要刪除「{photo.caption || '未填註記'}」（{target}
                          ）。刪除後這張照片不再計入「已有幾張」，
                          現場清單也看不到；需要時請重新拍攝。
                        </p>
                        {deleting.error && (
                          <FormError>{deleting.error}</FormError>
                        )}
                      </ConfirmBox>
                    )}
                  </li>
                )
              })}
            </ul>
            {feedback?.itemId === item.item_id &&
              feedback.photoId === null && <Notice>{feedback.text}</Notice>}
          </section>
        )
      })}
    </>
  )
}
