import { describe, expect, it } from 'vitest'

import type { OfficePhoto } from './api'
import { photoDownloadName } from './downloadName'

const photo = {
  id: 'a1234567-1234-1234-1234-123456789abc',
  is_overview: false,
  point_ids: ['point-b', 'point-a'],
  point_sequences: [2, 1],
  captured_at: '2026-10-01T16:05:00Z',
  uploaded_at: '2026-10-02T03:00:00Z',
  label_timezone: 'Asia/Taipei',
  labels: {
    project_name: '示範工程',
    item_title: '管線檢查',
    uploaded_at: '2026-10-02T03:00:00Z',
  },
} as OfficePhoto

describe('photoDownloadName', () => {
  it('identifies the source and photo for both versions', () => {
    const stem = '示範工程_管線檢查_項次1+2_20261002-1100_a1234567'
    expect(photoDownloadName(photo, 'office')).toBe(`${stem}_內業版.jpg`)
    expect(photoDownloadName(photo, 'field')).toBe(`${stem}_現場版.jpg`)
    expect(
      photoDownloadName({ ...photo, is_overview: true }, 'office'),
    ).toContain('_總覽_')
    expect(
      photoDownloadName({ ...photo, point_sequences: [] }, 'office'),
    ).toContain('_項次未記錄_')
    expect(
      photoDownloadName(
        { ...photo, point_sequences: [], point_ids: [] },
        'office',
      ),
    ).toContain('_未對應項次_')
  })

  it('uses the rendered inspection time when capture time is missing', () => {
    expect(
      photoDownloadName({ ...photo, captured_at: null }, 'office'),
    ).toContain('_20261002-1100_a1234567_')
    expect(
      photoDownloadName({ ...photo, point_sequences: [10, 2] }, 'office'),
    ).toContain('_項次2+10_')
  })

  it.each([
    ['UTC', '2026-10-01T15:05:00Z', '20261001-1505'],
    ['Asia/Tokyo', '2026-10-01T15:05:00Z', '20261002-0005'],
  ])(
    'uses the rendered inspection timestamp in %s, across dates if needed',
    (timezone, labelTime, filenameTime) => {
      const value = {
        ...photo,
        captured_at: '2026-10-03T06:00:00Z',
        uploaded_at: '2026-10-04T12:20:00Z',
        label_timezone: timezone,
        labels: { ...photo.labels, uploaded_at: labelTime },
      }
      expect(photoDownloadName(value, 'office')).toContain(
        `_${filenameTime}_a1234567_`,
      )
    },
  )

  it('缺少檢驗時間時以未記錄作為檔名時間段', () => {
    expect(
      photoDownloadName(
        { ...photo, labels: { ...photo.labels, uploaded_at: null } },
        'office',
      ),
    ).toContain('_未記錄_')
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
          uploaded_at: photo.labels.uploaded_at,
        },
        point_sequences: Array.from({ length: 100 }, (_, i) => i + 1),
      },
      'office',
    )
    expect(new TextEncoder().encode(value).length).toBeLessThanOrEqual(240)
    expect(value).not.toMatch(/[\uD800-\uDFFF]/u)
    expect(value).toContain('_20261002-1100_a1234567_內業版.jpg')
    expect(value).not.toContain(photo.id)
    expect(value).not.toMatch(/point-a|point-b/)
    expect(value).toContain('等100項_')
    expect(photoDownloadName({ ...photo, labels: {} }, 'office')).toMatch(
      /^未記錄工程_未記錄項目_/,
    )
  })
})
