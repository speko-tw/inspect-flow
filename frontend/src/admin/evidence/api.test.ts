import { describe, expect, it } from 'vitest'

import { officeImageUrl } from './api'

describe('officeImageUrl', () => {
  it.each(['field', 'office'] as const)(
    'adds the selected %s variant digest to the image URL',
    (variant) => {
      const sha256 = '0123456789abcdef'.repeat(4)

      expect(officeImageUrl('task-1', 'photo-1', variant, sha256)).toBe(
        `/api/v1/inspection-tasks/task-1/photos/photo-1` +
          `/image?variant=${variant}&v=01234567`,
      )
    },
  )

  it('keeps the image URL stable when no digest is available', () => {
    expect(officeImageUrl('task-1', 'photo-1', 'office')).toBe(
      '/api/v1/inspection-tasks/task-1/photos/photo-1/image?variant=office',
    )
  })
})
