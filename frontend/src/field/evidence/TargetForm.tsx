import { useEffect, useRef, useState, type FormEvent } from 'react'

import { Button } from '../../components/Button'
import { FieldError, FormError } from '../../ui/Form'
import type { CoverageItem } from './types'

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
  busy,
  error,
  onSubmit,
  onBack,
}: {
  mode: 'new' | 'modify'
  item: CoverageItem
  initial: TargetValues
  /** 剛處理好、待上傳的現場版預覽（修改模式不顯示）。 */
  preview?: string
  busy: boolean
  /** 後端回的錯誤，顯示在送出按鈕旁（RG-M25）。 */
  error: string
  onSubmit: (values: TargetValues) => void
  onBack: () => void
}) {
  const heading = useRef<HTMLHeadingElement | null>(null)
  const firstPoint = useRef<HTMLInputElement | null>(null)
  const [overview, setOverview] = useState(initial.overview)
  const [pointIds, setPointIds] = useState(initial.pointIds)
  const [caption, setCaption] = useState(initial.caption)
  const [pointError, setPointError] = useState('')
  const [focusRequest, setFocusRequest] = useState(0)
  const modify = mode === 'modify'

  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [])

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
    if (!overview && pointIds.length === 0) {
      setPointError('請至少選擇一個佐證項次。')
      setFocusRequest((value) => value + 1)
      return
    }
    onSubmit({
      overview,
      pointIds: overview ? [] : pointIds,
      caption: caption.trim(),
    })
  }

  return (
    <section
      className="evidence-target"
      aria-labelledby="evidence-target-title"
    >
      <h2 id="evidence-target-title" ref={heading} tabIndex={-1}>
        {modify ? '修改說明與項次' : '選擇佐證項次與註記'}
      </h2>
      <p>查核項目：{item.title}</p>
      {preview && (
        <img
          alt="待上傳的現場照片"
          className="evidence-target-preview"
          src={preview}
        />
      )}
      <form noValidate onSubmit={submit}>
        <label className="evidence-check">
          <input
            checked={overview}
            disabled={modify}
            onChange={(event) => {
              setOverview(event.target.checked)
              setPointError('')
            }}
            type="checkbox"
          />
          總覽照片（選拍，不計入項次需求）
        </label>
        <fieldset
          aria-describedby={pointError ? 'evidence-point-error' : undefined}
          className="evidence-points"
          disabled={overview}
        >
          <legend>
            佐證項次（非總覽必選，可複選）
            <span aria-hidden="true" className="required-mark" />
          </legend>
          {item.points.map((point, index) => (
            <label className="evidence-check" key={point.point_id}>
              <input
                aria-invalid={pointError ? true : undefined}
                checked={pointIds.includes(point.point_id)}
                onChange={() => toggle(point.point_id)}
                ref={index === 0 ? firstPoint : undefined}
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
            id="evidence-caption"
            maxLength={CAPTION_LIMIT}
            onChange={(event) => setCaption(event.target.value)}
            rows={3}
            value={caption}
          />
        </div>
        {error && <FormError>{error}</FormError>}
        <div className="evidence-actions">
          <Button
            loading={busy}
            loadingText={modify ? '儲存中…' : '準備上傳…'}
            type="submit"
            variant="primary"
          >
            {modify ? '儲存修改' : '上傳現場照片'}
          </Button>
          <Button disabled={busy} onClick={onBack} type="button">
            {modify ? '取消修改' : '返回任務'}
          </Button>
        </div>
      </form>
    </section>
  )
}
