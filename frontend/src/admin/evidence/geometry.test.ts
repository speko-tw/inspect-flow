import { describe, expect, it } from 'vitest'

import {
  moveCrop,
  orientedSize,
  resizeCrop,
  type CropHandle,
} from './geometry'

const base = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 }
const handles: Exclude<CropHandle, 'move'>[] = [
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
  'nw',
]

describe('crop geometry', () => {
  it('keeps a locked pixel ratio for all eight handles', () => {
    for (const handle of handles) {
      const crop = resizeCrop(base, handle, 0.08, -0.06, 0.75, 1000, 800)
      expect(crop.width / crop.height).toBeCloseTo(0.75)
      expect(crop.x).toBeGreaterThanOrEqual(0)
      expect(crop.y).toBeGreaterThanOrEqual(0)
      expect(crop.x + crop.width).toBeLessThanOrEqual(1)
      expect(crop.y + crop.height).toBeLessThanOrEqual(1)
    }
  })

  it('preserves edge anchors and clamps movement inside the source', () => {
    const north = resizeCrop(base, 'n', 0, -0.1, 0.75, 1000, 800)
    expect(north.y + north.height).toBeCloseTo(base.y + base.height)
    const west = resizeCrop(base, 'w', -0.1, 0, 0.75, 1000, 800)
    expect(west.x + west.width).toBeCloseTo(base.x + base.width)
    expect(moveCrop(base, 1, -1)).toEqual({ ...base, x: 0.4, y: 0 })
  })

  it('uses post-rotation source dimensions for crop ratios', () => {
    expect(orientedSize(1200, 800, 90)).toEqual({ width: 800, height: 1200 })
    expect(orientedSize(1200, 800, 180)).toEqual({ width: 1200, height: 800 })
  })
})
