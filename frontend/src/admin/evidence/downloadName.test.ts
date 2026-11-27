import { describe, expect, it } from 'vitest'

import type { OfficePhoto } from './api'
import { photoDownloadName } from './downloadName'

const photo = {
  id: 'a1234567-1234-1234-1234-123456789abc',
  is_overview: false,
  point_ids: ['point-b', 'point-a'],
  labels: { project_name: '示範工程', item_title: '管線檢查' },
} as OfficePhoto

describe('photoDownloadName', () => {
  it('identifies the source and photo for both versions', () => {
    const stem = '示範工程_管線檢查_項次-point-a+point-b_照片-' + photo.id
    expect(photoDownloadName(photo, 'office')).toBe(`${stem}_內業版.jpg`)
    expect(photoDownloadName(photo, 'field')).toBe(`${stem}_現場版.jpg`)
    expect(
      photoDownloadName({ ...photo, is_overview: true }, 'office'),
    ).toContain('_總覽_')
    expect(photoDownloadName({ ...photo, point_ids: [] }, 'office')).toContain(
      '_未對應項次_',
    )
  })

  it('replaces forbidden characters without exposing paths', () => {
    const value = photoDownloadName(
      {
        ...photo,
        labels: {
          project_name: '../CON/\\:*?"<>|\u0000\n\u007f\u202e工程. ',
          item_title: ' . ',
          uploader_name: '不應出現在檔名',
          location: '/private/secret',
        },
      },
      'office',
    )
    expect(value).not.toMatch(/[\\/:*?"<>|\p{Cc}\p{Cf}]/u)
    expect(value).not.toMatch(/^[ .]|[ .]$/u)
    expect(value).toContain('_未記錄項目_')
    expect(value).not.toMatch(/不應出現在檔名|secret/)
    expect(value.endsWith('_內業版.jpg')).toBe(true)
  })

  it('bounds UTF-8 bytes and preserves Unicode and photo identity', () => {
    const value = photoDownloadName(
      {
        ...photo,
        labels: {
          project_name: '中😀'.repeat(1000),
          item_title: '文𠮷'.repeat(1000),
        },
        point_ids: Array.from({ length: 100 }, (_, i) => `point-${i}`),
      },
      'office',
    )
    expect(new TextEncoder().encode(value).length).toBeLessThanOrEqual(240)
    expect(value).not.toMatch(/[\uD800-\uDFFF]/u)
    expect(value).toContain(`_照片-${photo.id}_內業版.jpg`)
    expect(photoDownloadName({ ...photo, labels: {} }, 'office')).toMatch(
      /^未記錄工程_未記錄項目_/,
    )
  })
})
