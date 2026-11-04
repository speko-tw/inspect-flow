import { useEffect, useRef, useState } from 'react'

import { Button } from '../../components/Button'
import { FormError } from '../../ui/Form'
import {
  type ImageSource,
  PREVIEW_EDGE,
  normalizeRotation,
  renderBase,
  withBrightness,
} from './imageEdit'
import {
  DEFAULT_LAYER,
  LABEL_ROWS,
  drawLabelLayer,
  labelValues,
} from './labelLayer'
import type { FieldLayerChoice, LayerCorner, LayerLabels } from './types'

/** 現場編修的狀態：旋轉、亮度與圖層開關／角落，沒有其他控制項。 */
export interface EditorState {
  rotation: 0 | 90 | 180 | 270
  brightness: number
  layer: FieldLayerChoice
}

/** 剛拍好的狀態：沒有旋轉、亮度 0、圖層預設開啟左下（FEV-R22）。 */
export const INITIAL_EDITOR_STATE: EditorState = {
  rotation: 0,
  brightness: 0,
  layer: { enabled: DEFAULT_LAYER.enabled, corner: DEFAULT_LAYER.corner },
}

const CORNERS: ReadonlyArray<{ value: LayerCorner; label: string }> = [
  { value: 'bottom_left', label: '左下' },
  { value: 'bottom_right', label: '右下' },
  { value: 'top_left', label: '左上' },
  { value: 'top_right', label: '右上' },
]

/** 長按照片多久後顯示編修前（毫秒）。 */
const LONG_PRESS_MS = 450

/** 與剛拍好的狀態比較；有任何旋轉、亮度或圖層變動就算有編修。 */
export function isEdited(state: EditorState): boolean {
  return (
    state.rotation !== INITIAL_EDITOR_STATE.rotation ||
    state.brightness !== INITIAL_EDITOR_STATE.brightness ||
    state.layer.enabled !== INITIAL_EDITOR_STATE.layer.enabled ||
    state.layer.corner !== INITIAL_EDITOR_STATE.layer.corner
  )
}

/**
 * 現場簡化編修器（FEV-R02、FEV-R23）：只有 90° 旋轉、亮度 −100～+100、
 * 長按比較，以及圖層開關與四角位置；沒有裁切、比例、拉直、拖曳微調、
 * 大小、樣式或文字修改，精細編修由內業處理。
 *
 * 預覽由乾淨的來源影像在前端即時合成圖層；五欄內容唯讀，上傳前的檢驗
 * 時間顯示「上傳後以伺服器時間填入」。取消在左上、確認在右上，
 * 觸控目標至少 44px（FEV-R25 的版面慣例）。
 */
export function PhotoEditor({
  source,
  labels,
  state,
  busy,
  error,
  onChange,
  onCancel,
  onConfirm,
}: {
  source: ImageSource
  labels: LayerLabels
  state: EditorState
  busy: boolean
  error: string
  onChange: (next: EditorState) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const heading = useRef<HTMLHeadingElement | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const cache = useRef<{
    source: ImageSource
    rotation: number
    base: HTMLCanvasElement
    original: HTMLCanvasElement
  } | null>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )
  const [comparing, setComparing] = useState(false)
  const [previewError, setPreviewError] = useState(false)
  const { rotation, brightness, layer } = state
  const brightnessText = brightness > 0 ? `+${brightness}` : String(brightness)

  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [])

  // 預覽：底圖只在換旋轉時重畫，拖動亮度只重算像素（FEV-R02）。
  useEffect(() => {
    const target = canvas.current
    if (!target) return
    try {
      if (
        !cache.current ||
        cache.current.source !== source ||
        cache.current.rotation !== rotation
      ) {
        cache.current = {
          source,
          rotation,
          base: renderBase(source, rotation, PREVIEW_EDGE),
          original: renderBase(source, 0, PREVIEW_EDGE),
        }
      }
      const shown = comparing
        ? cache.current.original
        : withBrightness(cache.current.base, brightness)
      target.width = shown.width
      target.height = shown.height
      target.getContext('2d')?.drawImage(shown, 0, 0)
      if (!comparing) {
        drawLabelLayer(target, { ...DEFAULT_LAYER, ...layer }, labels, true)
      }
    } catch (cause) {
      console.error('Photo preview failed:', cause)
      // 預覽失敗是環境問題（例如沒有畫布），錯誤提示改由下一個微任務
      // 設定，避免在 effect 本體同步更新 state。
      queueMicrotask(() => setPreviewError(true))
    }
  }, [source, rotation, brightness, layer, labels, comparing])

  useEffect(() => () => clearTimeout(pressTimer.current), [])

  const values = labelValues(labels, true)
  const nothingToReset = rotation === 0 && brightness === 0

  // FEV-R02：移出或失去捕捉也要清掉長按計時器，避免比較卡住。
  function stopCanvasComparison() {
    clearTimeout(pressTimer.current)
    pressTimer.current = undefined
    setComparing(false)
  }

  return (
    <section
      className="evidence-editor"
      aria-labelledby="evidence-editor-title"
    >
      <div className="evidence-editor-bar">
        <Button disabled={busy} onClick={onCancel} type="button">
          取消
        </Button>
        <h2 id="evidence-editor-title" ref={heading} tabIndex={-1}>
          編修現場照片
        </h2>
        <Button
          loading={busy}
          loadingText="處理中…"
          onClick={onConfirm}
          type="button"
          variant="primary"
        >
          確認
        </Button>
      </div>
      <div className="evidence-editor-body">
        <div className="evidence-stage">
          <canvas
            aria-label="現場照片與圖層預覽"
            className="evidence-editor-canvas"
            onLostPointerCapture={stopCanvasComparison}
            onPointerCancel={stopCanvasComparison}
            onPointerDown={(event) => {
              clearTimeout(pressTimer.current)
              event.currentTarget.setPointerCapture(event.pointerId)
              pressTimer.current = setTimeout(
                () => setComparing(true),
                LONG_PRESS_MS,
              )
            }}
            onPointerLeave={stopCanvasComparison}
            onPointerUp={stopCanvasComparison}
            ref={canvas}
            role="img"
          />
          {comparing && (
            <p className="evidence-compare-tag" role="status">
              編修前
            </p>
          )}
        </div>
        {previewError && (
          <FormError>此裝置無法預覽照片，請改用其他瀏覽器或裝置。</FormError>
        )}
        <div className="evidence-actions">
          <Button
            disabled={busy}
            onClick={() =>
              onChange({
                ...state,
                rotation: normalizeRotation(rotation + 90),
              })
            }
            type="button"
          >
            旋轉 90°
          </Button>
          <button
            className="evidence-compare-button"
            disabled={busy}
            onBlur={() => setComparing(false)}
            onKeyDown={(event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault()
                setComparing(true)
              }
            }}
            onKeyUp={() => setComparing(false)}
            onPointerCancel={() => setComparing(false)}
            onPointerDown={(event) => {
              // 旋轉前後的預覽比例會移動按鈕，捕捉指標以維持比較。
              event.currentTarget.setPointerCapture(event.pointerId)
              setComparing(true)
            }}
            onPointerLeave={() => setComparing(false)}
            onPointerUp={() => setComparing(false)}
            type="button"
          >
            按住比較編修前
          </button>
          <Button
            disabled={nothingToReset || busy}
            onClick={() => onChange({ ...state, rotation: 0, brightness: 0 })}
            type="button"
          >
            重設旋轉與亮度
          </Button>
        </div>
        <div className="evidence-control">
          <label
            className="evidence-brightness-label"
            htmlFor="evidence-brightness"
          >
            亮度{' '}
            <span className="evidence-value" aria-hidden="true">
              {brightnessText}
            </span>
          </label>
          <input
            disabled={busy}
            id="evidence-brightness"
            aria-valuetext={brightnessText}
            max={100}
            min={-100}
            onChange={(event) =>
              onChange({ ...state, brightness: Number(event.target.value) })
            }
            step={1}
            type="range"
            value={brightness}
          />
        </div>
        <fieldset className="evidence-layer-controls">
          <legend>工程標示圖層</legend>
          <label className="evidence-check">
            <input
              checked={layer.enabled}
              disabled={busy}
              onChange={(event) =>
                onChange({
                  ...state,
                  layer: { ...layer, enabled: event.target.checked },
                })
              }
              className="evidence-checkbox"
              type="checkbox"
            />
            顯示工程圖層
          </label>
          <label htmlFor="evidence-corner">位置</label>
          <select
            disabled={busy || !layer.enabled}
            id="evidence-corner"
            onChange={(event) =>
              onChange({
                ...state,
                layer: {
                  ...layer,
                  corner: event.target.value as LayerCorner,
                },
              })
            }
            value={layer.corner}
          >
            {CORNERS.map((corner) => (
              <option key={corner.value} value={corner.value}>
                {corner.label}
              </option>
            ))}
          </select>
        </fieldset>
        <details className="evidence-layer-details">
          <summary>查看圖層完整文字（唯讀）</summary>
          {LABEL_ROWS.map((row) => (
            <div className="evidence-control" key={row.key}>
              <label htmlFor={`evidence-label-${row.key}`}>{row.title}</label>
              <textarea
                id={`evidence-label-${row.key}`}
                readOnly
                rows={2}
                value={values[row.key]}
              />
            </div>
          ))}
        </details>
        <p className="evidence-hint">
          現場版保持乾淨；工程標示由內業版呈現。精細裁切與文字更正交由內業處理。
        </p>
        {error && <FormError>{error}</FormError>}
      </div>
    </section>
  )
}
