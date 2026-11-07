import { describe, expect, it } from 'vitest'

import type { OfficeLayer } from './api'
import {
  getEditedImageSize,
  getLayerBox,
  getLayerPreviewRect,
  moveLayerOffset,
} from './layerGeometry'

const layer: OfficeLayer = {
  enabled: true,
  corner: 'bottom_right',
  offset_x: 0,
  offset_y: 0,
  size: 'medium',
  style: 'dark',
  overrides: {},
}

describe('layerGeometry', () => {
  it('uses post-rotation crop dimensions with backend pixel rounding', () => {
    expect(
      getEditedImageSize(1200, 800, {
        rotation: 90,
        crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 },
      }),
    ).toEqual({ width: 400, height: 480 })
  })

  it('projects the clamped box into the rotated crop preview', () => {
    expect(
      getLayerPreviewRect(
        1200,
        800,
        {
          rotation: 90,
          crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 },
        },
        layer,
      ),
    ).toMatchObject({
      left: 0.2,
      top: 0.43166666666666664,
      width: 0.39,
      height: 0.16166666666666665,
      fits: true,
    })
  })

  it('matches backend size and corner placement in source pixels', () => {
    expect(getLayerBox({ width: 1000, height: 500 }, layer)).toMatchObject({
      left: 600,
      top: 284,
      width: 390,
      height: 206,
      fits: true,
    })
  })

  it('clamps pointer and button movement at the photo edges', () => {
    const moved = moveLayerOffset(
      { width: 1000, height: 500 },
      layer,
      1000,
      500,
    )
    expect(moved).toEqual({ offset_x: 0.01, offset_y: 0.02 })
    const box = getLayerBox(
      { width: 1000, height: 500 },
      {
        ...layer,
        ...moved,
      },
    )
    expect(box.left + box.width).toBe(1000)
    expect(box.top + box.height).toBe(500)
  })

  it('hides a label that the renderer cannot fit in the photo', () => {
    expect(getLayerBox({ width: 100, height: 100 }, layer).fits).toBe(false)
  })

  it('matches the recorded backend scan for small and medium layers', () => {
    // FEV-R23：保留後端向量，避免判定分歧。
    const scan = [
      [215, false],
      [216, false],
      [217, false],
      [218, true],
      [219, true],
      [220, true],
      [221, true],
      [222, true],
      [223, true],
      [224, true],
      [225, false],
      [226, false],
      [227, false],
      [228, false],
      [229, false],
      [230, true],
      [231, true],
      [232, true],
    ] as const

    for (const size of ['small', 'medium'] as const) {
      for (const [shortEdge, expected] of scan) {
        expect(
          getLayerBox(
            { width: shortEdge, height: shortEdge },
            { ...layer, size },
          ).fits,
        ).toBe(expected)
      }
    }
  })
})
