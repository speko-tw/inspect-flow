import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { PhotoThumb } from './PhotoThumb'
import { photo } from './testFixtures'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('縮圖載入前預留來源比例，載入縮圖後仍維持版面比例', () => {
  const images: { onload: (() => void) | null }[] = []
  vi.stubGlobal(
    'Image',
    class {
      onload = null
      onerror = null
      naturalWidth = 640
      naturalHeight = 427
      constructor() {
        images.push(this)
      }
      set src(_value: string) {}
    },
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  const p = photo()
  render(
    <PhotoThumb
      src="/photo"
      alt="現場照片"
      layer={{ ...p.layer, enabled: false }}
      labels={p.labels}
      width={1200}
      height={800}
    />,
  )
  const canvas = screen.getByRole('img', {
    name: '現場照片',
  }) as HTMLCanvasElement
  expect(canvas.style.aspectRatio).toBe('1200 / 800')
  act(() => images[0].onload?.())
  expect(canvas.width).toBe(640)
  expect(canvas.height).toBe(427)
  expect(canvas.style.aspectRatio).toBe('1200 / 800')
})
