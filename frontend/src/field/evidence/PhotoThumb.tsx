import { useEffect, useRef, useState } from 'react'

import { drawLabelLayer } from './labelLayer'
import type { LayerLabels, StoredLayer } from './types'

/**
 * 現場清單縮圖：載入乾淨的現場版，再依讀回的圖層設定在前端合成預覽
 * （FEV-R23）。不取內業版檔案，圖層放不下就只顯示照片，不影響保存。
 *
 * 瀏覽器不支援畫布時退回一般 `<img>`，照片仍看得到。
 */
export function PhotoThumb({
  src,
  alt,
  layer,
  labels,
  width,
  height,
}: {
  src: string
  alt: string
  layer: StoredLayer
  labels: LayerLabels
  width: number
  height: number
}) {
  // RG-M25：先保留來源比例，避免縮圖載入後把操作結果推離視窗。
  const geometry = { aspectRatio: `${width} / ${height}` }
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [mode, setMode] = useState<'canvas' | 'plain' | 'error'>('canvas')

  useEffect(() => {
    const target = canvas.current
    if (!target) return
    let active = true
    const image = new Image()
    image.onload = () => {
      if (!active) return
      const ctx = target.getContext('2d')
      if (!ctx) {
        setMode('plain')
        return
      }
      target.width = image.naturalWidth
      target.height = image.naturalHeight
      ctx.drawImage(image, 0, 0)
      drawLabelLayer(target, layer, labels)
    }
    image.onerror = () => {
      if (active) setMode('error')
    }
    image.src = src
    return () => {
      active = false
      image.onload = null
      image.onerror = null
    }
  }, [labels, layer, src])

  if (mode === 'plain') {
    return (
      <img alt={alt} className="evidence-thumb" src={src} style={geometry} />
    )
  }
  if (mode === 'error') {
    return (
      <p
        className="evidence-thumb evidence-thumb-missing"
        role="img"
        style={geometry}
        aria-label={alt}
      >
        照片預覽無法載入
      </p>
    )
  }
  return (
    <canvas
      aria-label={alt}
      className="evidence-thumb"
      ref={canvas}
      style={geometry}
      role="img"
    />
  )
}
