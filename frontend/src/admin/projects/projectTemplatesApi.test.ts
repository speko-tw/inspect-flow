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
    ).toBe(
      '這個系統已有「管線查核」，沒有存入範本。請改名後重試，或改選其他系統。',
    )
  })
})

it('TPL-AC32：套用說明同名項目已停用，存為範本說明來源已停用', () => {
  const error = new ProjectTemplatesApiError(
    409,
    'project_inspection_item.inactive_name',
  )
  expect(templateErrorMessage(error)).toBe(
    '同名項目已停用，可在已停用清單恢復。',
  )
  expect(templateErrorMessage(error, '來源', 'save')).toBe(
    '來源項目已停用，請先到已停用清單恢復，才能存為範本。',
  )
})
