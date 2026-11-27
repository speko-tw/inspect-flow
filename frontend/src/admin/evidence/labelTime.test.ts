import { expect, it } from 'vitest'
import { formatRecordedTime } from './labelTime'

it('缺少或無效的檢驗時間顯示未記錄', () => {
  for (const value of [null, undefined, '', '無效']) {
    expect(formatRecordedTime(value, 'UTC')).toBe('未記錄')
  }
})

it('檢驗時間採 API 時區，保留分鐘、不四捨五入秒數', () => {
  expect(formatRecordedTime('2026-11-01T01:30:59Z', 'America/New_York')).toBe(
    '2026/10/31 21:30（America/New_York）',
  )
})
