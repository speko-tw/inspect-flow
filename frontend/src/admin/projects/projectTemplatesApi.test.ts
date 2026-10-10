import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ProjectTemplatesApiError,
  templateErrorMessage,
} from './projectTemplatesApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('templateErrorMessage', () => {
  it.each([
    [401, '登入狀態已失效，請重新登入。'],
    [403, '你沒有權限執行這項操作。'],
    [500, '伺服器暫時無法處理，請稍後再試。'],
    [502, '伺服器暫時無法處理，請稍後再試。'],
  ])('shows the shared message for status %s', (status, message) => {
    expect(templateErrorMessage(new ProjectTemplatesApiError(status))).toBe(
      message,
    )
  })

  it('only shows the connection message for non-API failures', () => {
    expect(templateErrorMessage(new TypeError('Failed to fetch'))).toBe(
      '無法連線到伺服器，請稍後再試。',
    )
  })

  it('save name conflicts identify the source item and next action', () => {
    expect(
      templateErrorMessage(
        new ProjectTemplatesApiError(409, 'template.name_conflict'),
        '管線查核',
      ),
    ).toBe('這個系統已有「管線查核」，沒有存入範本。請改選其他系統。')
  })
})
