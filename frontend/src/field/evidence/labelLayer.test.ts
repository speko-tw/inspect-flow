import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LAYER,
  PENDING_TIME_TEXT,
  formatLabelTime,
  labelValues,
  layoutLayer,
  wrapText,
} from './labelLayer'

// 每個字寬度等於字級，與實際字型無關，讓排版結果可預測。
const measure = (text: string, fontSize: number) =>
  Array.from(text).length * fontSize

const values = {
  project_name: '示範工程甲',
  item_title: '鋼筋工程',
  location: '一樓／東側',
  uploader_name: '張先生',
  uploaded_at: '2026/10/31 10:24',
}

describe('wrapText', () => {
  it('每格最多兩行，超出以省略號結尾', () => {
    const lines = wrapText('一二三四五六七八九十', 40, 10, measure)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('一二三四')
    expect(lines[1]).toBe('五六七…')
  })

  it('短文字只有一行，空字串也有一行', () => {
    expect(wrapText('甲乙', 100, 10, measure)).toEqual(['甲乙'])
    expect(wrapText('', 100, 10, measure)).toEqual([''])
  })
})

describe('layoutLayer（FEV-R22 比例）', () => {
  it('中尺寸寬度是短邊 0.78，字級至少 14，疊在照片內', () => {
    const layout = layoutLayer(2000, 1500, DEFAULT_LAYER, values, measure)
    expect(layout).not.toBeNull()
    expect(layout?.size).toBe('medium')
    expect(layout?.width).toBe(Math.round(0.78 * 1500))
    expect(layout?.fontSize).toBe(Math.max(14, Math.round(0.022 * 1500)))
    const margin = Math.max(2, Math.round(0.02 * 1500))
    expect(layout?.x).toBe(margin)
    expect(layout?.y).toBe(1500 - margin - (layout?.height ?? 0))
    expect((layout?.x ?? 0) + (layout?.width ?? 0)).toBeLessThanOrEqual(2000)
  })

  it('四個角落的位置', () => {
    const at = (corner: typeof DEFAULT_LAYER.corner) =>
      layoutLayer(2000, 1500, { ...DEFAULT_LAYER, corner }, values, measure)
    const left = at('top_left')
    const right = at('bottom_right')
    expect(left?.y).toBe(left?.x)
    expect(right?.x).toBe(2000 - (left?.x ?? 0) - (right?.width ?? 0))
    expect(at('top_right')?.y).toBe(left?.y)
  })

  it.each(['top_left', 'top_right', 'bottom_left', 'bottom_right'] as const)(
    '%s 依照片寬高套用正規化偏移，超界時限制整塊於照片內',
    (corner) => {
      const base = layoutLayer(
        2000,
        1500,
        { ...DEFAULT_LAYER, corner },
        values,
        measure,
      )!
      const shifted = layoutLayer(
        2000,
        1500,
        { ...DEFAULT_LAYER, corner, offset_x: 0.1, offset_y: -0.1 },
        values,
        measure,
      )!
      expect(shifted.x).toBe(Math.min(base.x + 200, 2000 - base.width))
      expect(shifted.y).toBe(Math.max(0, base.y - 150))
      const far = layoutLayer(
        2000,
        1500,
        { ...DEFAULT_LAYER, corner, offset_x: 1, offset_y: -1 },
        values,
        measure,
      )!
      expect(far.x).toBe(2000 - far.width)
      expect(far.y).toBe(0)
      const opposite = layoutLayer(
        2000,
        1500,
        { ...DEFAULT_LAYER, corner, offset_x: -1, offset_y: 1 },
        values,
        measure,
      )!
      expect(opposite.x).toBe(0)
      expect(opposite.y).toBe(1500 - opposite.height)
    },
  )

  it('偏移像素與後端 int 一致向零截斷，不四捨五入負數', () => {
    const base = layoutLayer(2000, 1500, DEFAULT_LAYER, values, measure)!
    const moved = layoutLayer(
      2000,
      1500,
      { ...DEFAULT_LAYER, offset_x: 0.0009, offset_y: -0.0011 },
      values,
      measure,
    )!
    expect(moved.x).toBe(base.x + 1)
    expect(moved.y).toBe(base.y - 1)
  })

  it('大尺寸放不下改試中、小；都放不下就回 null，不擋上傳', () => {
    const large = { ...DEFAULT_LAYER, size: 'large' as const }
    const fallback = layoutLayer(2000, 1500, large, values, measure)
    expect(fallback).not.toBeNull()
    expect(layoutLayer(60, 40, DEFAULT_LAYER, values, measure)).toBeNull()
  })
})

describe('labelValues', () => {
  it('上傳前時間顯示伺服器時間待填提示，缺值依規格顯示', () => {
    const shown = labelValues(
      {
        project_name: '',
        item_title: '',
        location: '',
        uploader_name: '',
        uploaded_at: null,
      },
      true,
    )
    expect(shown).toMatchObject({
      project_name: '未記錄',
      item_title: '未記錄',
      location: '未填寫',
      uploader_name: '未記錄',
      uploaded_at: PENDING_TIME_TEXT,
    })
  })

  it('UTC 時間轉成 Asia/Taipei 的 YYYY/MM/DD HH:mm', () => {
    expect(formatLabelTime('2026-10-31T17:30:45Z')).toBe('2026/11/01 01:30')
    expect(formatLabelTime(null)).toBe('未記錄')
    expect(formatLabelTime('壞掉')).toBe('未記錄')
  })
})
