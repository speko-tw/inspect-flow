import { describe, expect, it } from 'vitest'

import { fitStageSize } from './stageGeometry'

describe('fitStageSize', () => {
  it.each([
    ['360px mobile', { width: 300, height: 422 }],
    ['390px mobile', { width: 330, height: 422 }],
    ['768px tablet', { width: 440, height: 624 }],
    ['1280px desktop', { width: 740, height: 624 }],
  ] as const)('fits portrait and landscape images at %s', (_label, canvas) => {
    for (const aspectRatio of [9 / 16, 16 / 9]) {
      const stage = fitStageSize(canvas, aspectRatio)

      expect(stage.width).toBeLessThanOrEqual(canvas.width)
      expect(stage.height).toBeLessThanOrEqual(canvas.height)
      expect(stage.width / stage.height).toBeCloseTo(aspectRatio)
    }
  })

  it('returns zero size before canvas dimensions are available', () => {
    expect(fitStageSize({ width: 0, height: 240 }, 9 / 16)).toEqual({
      width: 0,
      height: 0,
    })
  })
})
