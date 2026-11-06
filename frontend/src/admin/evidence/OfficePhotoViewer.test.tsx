import { useRef, useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { OfficePhoto } from './api'
import { OfficePhotoViewer } from './OfficePhotoViewer'

const photo = {
  id: 'photo-1',
  variants: {
    field: { width: 1200, height: 800 },
    office: { width: 1200, height: 800 },
  },
} as OfficePhoto

function ViewerFixture() {
  const trigger = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)} ref={trigger} type="button">
        開啟照片大圖
      </button>
      {open && (
        <OfficePhotoViewer
          identity="林檢查員，2026年10月1日 上午10:00"
          onClose={() => setOpen(false)}
          photo={photo}
          taskId="task-1"
          triggerRef={trigger}
        />
      )}
    </>
  )
}

describe('OfficePhotoViewer', () => {
  it('shows saved images and restores focus after Escape', async () => {
    render(<ViewerFixture />)
    const trigger = screen.getByRole('button', { name: '開啟照片大圖' })
    fireEvent.click(trigger)

    const viewer = await screen.findByRole('dialog', {
      name: /大圖檢視｜林檢查員/,
    })
    expect(viewer).toHaveAttribute('aria-modal', 'true')
    expect(
      screen.getByText('檢視保存版本；下載維持原尺寸。'),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '現場版' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '內業版' })).toBeInTheDocument()
    expect(screen.getByText('保存的現場版本')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '關閉大圖檢視' })).toHaveFocus()
    expect(screen.getByAltText(/現場版原尺寸/)).toHaveAttribute(
      'src',
      '/api/v1/inspection-tasks/task-1/photos/photo-1/image?variant=field',
    )
    expect(screen.getByAltText(/內業版原尺寸/)).toHaveAttribute(
      'src',
      '/api/v1/inspection-tasks/task-1/photos/photo-1/image?variant=office',
    )

    fireEvent(viewer, new Event('cancel', { cancelable: true }))
    await waitFor(() => expect(viewer).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
