import { expect, it, vi } from 'vitest'
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

it('無效時區改用台北時區，且輸出標示實際使用的時區', () => {
  expect(() =>
    formatRecordedTime('2026-11-01T01:30:59Z', 'Not/A-Time-Zone'),
  ).not.toThrow()
  expect(formatRecordedTime('2026-11-01T01:30:59Z', 'Not/A-Time-Zone')).toBe(
    '2026/11/01 09:30（Asia/Taipei）',
  )
})

it('快取重複使用的合法時區 formatter', () => {
  const formatterSpy = vi.spyOn(Intl, 'DateTimeFormat')

  formatRecordedTime('2026-11-01T01:30:59Z', 'Pacific/Chatham')
  const callsAfterFirstUse = formatterSpy.mock.calls.length
  formatRecordedTime('2026-11-02T01:30:59Z', 'Pacific/Chatham')

  expect(callsAfterFirstUse).toBeGreaterThan(0)
  expect(formatterSpy).toHaveBeenCalledTimes(callsAfterFirstUse)
  formatterSpy.mockRestore()
})

it('台北時區也不可用時以執行環境時區完成格式化', () => {
  const NativeDateTimeFormat = Intl.DateTimeFormat
  class TimezoneFailureDateTimeFormat extends NativeDateTimeFormat {
    constructor(
      locales?: Intl.LocalesArgument,
      options?: Intl.DateTimeFormatOptions,
    ) {
      if (options?.timeZone) throw new RangeError('unsupported timezone')
      super(locales, options)
    }
  }
  vi.stubGlobal('Intl', {
    ...Intl,
    DateTimeFormat: TimezoneFailureDateTimeFormat,
  })

  try {
    expect(() =>
      formatRecordedTime('2026-11-01T01:30:59Z', 'No/Usable-Time-Zone'),
    ).not.toThrow()
    expect(
      formatRecordedTime('2026-11-01T01:30:59Z', 'No/Usable-Time-Zone'),
    ).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/u)
  } finally {
    vi.unstubAllGlobals()
  }
})
