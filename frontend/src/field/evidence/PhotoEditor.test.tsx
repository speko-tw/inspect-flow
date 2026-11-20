import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { INITIAL_EDITOR_STATE, PhotoEditor } from './PhotoEditor'
import { photo } from './testFixtures'

vi.mock('./imageEdit', async (original) => ({
  ...(await original<typeof import('./imageEdit')>()),
  renderBase: vi.fn(() => ({ width: 227, height: 227 })),
  withBrightness: vi.fn((canvas) => canvas),
}))
vi.mock('./labelLayer', async (original) => ({
  ...(await original<typeof import('./labelLayer')>()),
  drawLabelLayer: vi.fn(),
}))

afterEach(() => vi.restoreAllMocks())

it.each([227, 1200])('照片短邊 %i 的提示不阻擋確認上傳', (edge) => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  render(
    <PhotoEditor
      source={{
        width: edge,
        height: edge,
        image: {} as CanvasImageSource,
        release: vi.fn(),
      }}
      labels={photo().labels}
      state={INITIAL_EDITOR_STATE}
      busy={false}
      error=""
      onChange={vi.fn()}
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
    />,
  )
  expect(Boolean(screen.queryByText('照片太小，標示不會合成'))).toBe(
    edge === 227,
  )
  expect(screen.getByRole('button', { name: '確認' })).toBeEnabled()
})
