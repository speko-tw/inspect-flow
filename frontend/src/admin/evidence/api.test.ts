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

  it('uses the digest prefix as the cache version', () => {
    const first = officeImageUrl(
      'task-1',
      'photo-1',
      'office',
      'deadbeef11111111',
    )
    const samePrefix = officeImageUrl(
      'task-1',
      'photo-1',
      'office',
      'deadbeef22222222',
    )

    expect(first).toContain('&v=deadbeef')
    expect(first).toBe(samePrefix)
  })
})
