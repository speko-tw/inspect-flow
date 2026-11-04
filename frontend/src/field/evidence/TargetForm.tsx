import { useEffect, useRef, useState, type FormEvent } from 'react'

import { Button } from '../../components/Button'
import { ConfirmBox } from '../../ui/ConfirmBox'
import { FieldError, FormError } from '../../ui/Form'
import { Notice } from '../../ui/Notice'
import { photoIdentity } from './PhotoList'
import { PhotoThumb } from './PhotoThumb'
import type { CoverageItem, FieldPhoto } from './types'

/** 註記字數上限（FEV-R05）。 */
export const CAPTION_LIMIT = 500

/** 表單送出的值：對應項次、是否總覽與註記。 */
export interface TargetValues {
  overview: boolean
  pointIds: string[]
  caption: string
}

/**
 * 選擇照片對應的項次與註記（FEV-R04、FEV-R05、FEV-R15）。
 *
 * 新增與修改共用欄位，但入口分開：新增是「上傳現場照片」，修改是
 * 「儲存修改」且總覽屬性鎖定（要改就刪除重拍）。項次是有依賴的輸入，
 * 先列出該查核項目可選的項次再讓使用者勾選；非總覽沒選項次時錯誤顯示
 * 在欄位旁並聚焦第一個選項，不靠色彩單獨表達。
 */
export function TargetForm({
  mode,
  item,
  initial,
  preview,
  existingPhoto,
  busy,
  error,
  notice,
  onClearError,
  onSubmit,
  onBack,
}: {
  mode: 'new' | 'modify'
  item: CoverageItem
  initial: TargetValues
  /** 剛處理好、待上傳的現場版預覽（修改模式不顯示）。 */
  preview?: string
  /** 修改對象與清單同源的縮圖；新上傳流程不提供。 */
  existingPhoto?: { photo: FieldPhoto; thumbnailUrl: string }
  busy: boolean
  /** 後端錯誤；修改時顯示在儲存確認框內，新增時在送出鈕旁（RG-M25）。 */
  error: string
  /** 成功回應待重讀時的資訊，留在儲存確認框內，不先宣稱已完成。 */
  notice?: string
  /** 返回修改或重新確認前清掉上一次錯誤，保留使用者填寫的欄位。 */
  onClearError?: () => void
  onSubmit: (values: TargetValues) => void | Promise<void>
  onBack: () => void
}) {
  const form = useRef<HTMLFormElement | null>(null)
  const [restoreFocus, setRestoreFocus] = useState(0)
  const heading = useRef<HTMLHeadingElement | null>(null)
  const firstPoint = useRef<HTMLInputElement | null>(null)
  const [overview, setOverview] = useState(initial.overview)
  const [pointIds, setPointIds] = useState(initial.pointIds)
  const [caption, setCaption] = useState(initial.caption)
  const [pointError, setPointError] = useState('')
  const [focusRequest, setFocusRequest] = useState(0)
  const [pending, setPending] = useState<TargetValues | null>(null)
  const modify = mode === 'modify'

  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (restoreFocus > 0)
      form.current
        ?.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.focus({ preventScroll: true })
  }, [restoreFocus])

  function toggle(pointId: string) {
    setPointError('')
    setPointIds((current) =>
      current.includes(pointId)
        ? current.filter((id) => id !== pointId)
        : [...current, pointId],
    )
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || pending) return
    if (!overview && pointIds.length === 0) {
      setPointError('請至少選擇一個佐證項次。')
      setFocusRequest((value) => value + 1)
      return
    }
    const values = {
      overview,
      pointIds: overview ? [] : pointIds,
      caption: caption.trim(),
    }
    if (modify) {
      onClearError?.()
      setPending(values)
    } else onSubmit(values)
  }

  return (
    <section
      className="evidence-target"
      aria-labelledby="evidence-target-title"
    >
      <h2 id="evidence-target-title" ref={heading} tabIndex={-1}>
        {modify ? '修改說明與項次' : '選擇佐證項次與註記'}
      </h2>
      {existingPhoto && (
        <PhotoThumb
          src={existingPhoto.thumbnailUrl}
          alt={`修改中的照片：${existingPhoto.photo.caption || photoIdentity(existingPhoto.photo)}`}
          width={existingPhoto.photo.width}
          height={existingPhoto.photo.height}
          layer={existingPhoto.photo.layer}
          labels={existingPhoto.photo.labels}
        />
      )}
      <p>查核項目：{item.title}</p>
      {preview && (
        <img
          alt="待上傳的現場照片"
          className="evidence-target-preview"
          src={preview}
        />
      )}
      <form noValidate onSubmit={submit} ref={form}>
        <label className="evidence-check">
          <input
            checked={overview}
            disabled={modify}
            onChange={(event) => {
              setOverview(event.target.checked)
              setPointError('')
            }}
            className="evidence-checkbox"
            type="checkbox"
          />
          總覽照片（選拍，不計入項次需求）
        </label>
        <fieldset
          aria-describedby={pointError ? 'evidence-point-error' : undefined}
          className="evidence-points"
          disabled={overview || busy || Boolean(pending)}
        >
          <legend>
            佐證項次（非總覽必選，可複選）
            <span aria-hidden="true" className="required-mark" />
          </legend>
          {item.points.map((point, index) => (
            <label className="evidence-check" key={point.id}>
              <input
                aria-invalid={pointError ? true : undefined}
                checked={pointIds.includes(point.id)}
                onChange={() => toggle(point.id)}
                ref={index === 0 ? firstPoint : undefined}
                className="evidence-checkbox"
                type="checkbox"
              />
              {point.sequence}. {point.title}
            </label>
          ))}
          <FieldError
            focusRequest={focusRequest || undefined}
            focusTarget={firstPoint}
            id="evidence-point-error"
          >
            {pointError}
          </FieldError>
        </fieldset>
        <div className="evidence-control">
          <label htmlFor="evidence-caption">
            照片註記（選填，最多 {CAPTION_LIMIT} 字）
          </label>
          <textarea
            disabled={busy || Boolean(pending)}
            id="evidence-caption"
            maxLength={CAPTION_LIMIT}
            onChange={(event) => setCaption(event.target.value)}
            rows={3}
            value={caption}
          />
        </div>
        {error && !pending && <FormError>{error}</FormError>}
        <div className="evidence-actions">
          <Button
            disabled={Boolean(pending)}
            loading={busy}
            loadingText={modify ? '儲存中…' : '準備上傳…'}
            type="submit"
            variant="primary"
          >
            {modify ? '儲存修改' : '上傳現場照片'}
          </Button>
          <Button
            disabled={busy || Boolean(pending)}
            onClick={onBack}
            type="button"
          >
            {modify ? '取消修改' : '放棄照片'}
          </Button>
        </div>
        {pending && (
          <ConfirmBox
            busy={busy}
            cancelLabel="返回修改"
            confirmLabel="確認儲存"
            onCancel={() => {
              setPending(null)
              onClearError?.()
              setRestoreFocus((value) => value + 1)
            }}
            onConfirm={() => (pending ? onSubmit(pending) : undefined)}
            title="儲存照片說明與項次？"
          >
            {existingPhoto && (
              <p>要修改{photoIdentity(existingPhoto.photo)}的說明與項次。</p>
            )}
            <p>照片註記：{pending.caption || '未填寫'}</p>
            <p>
              佐證範圍：
              {pending.overview
                ? '總覽照片（選拍）'
                : item.points
                    .filter((point) => pending.pointIds.includes(point.id))
                    .map((point) => `${point.sequence}. ${point.title}`)
                    .join('、')}
            </p>
            <p>儲存後會更新照片說明及項次張數，照片影像保持原樣。</p>
            {notice && <Notice variant="info">{notice}</Notice>}
            {error && (
              <FormError focusRequest={1} tabIndex={-1}>
                {error}
              </FormError>
            )}
          </ConfirmBox>
        )}
      </form>
    </section>
  )
}
