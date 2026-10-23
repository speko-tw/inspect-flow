import { describe, expect, it } from 'vitest'

import { ManagementApiError, managementErrorMessage } from './api'

describe('批次數量提示（ADM-R13、#414）', () => {
  it('超過 200 筆時保留可採取行動的白話說明', () => {
    const message = '一次最多選取 200 筆，請減少數量後再試。'
    expect(
      managementErrorMessage(
        new ManagementApiError(422, 'request.validation_failed', [message]),
      ),
    ).toBe(message)
  })
  it('其他驗證錯誤仍使用一般輸入提示', () => {
    expect(
      managementErrorMessage(
        new ManagementApiError(422, 'request.validation_failed', [
          'unexpected internal details',
        ]),
      ),
    ).toBe('資料格式不正確，請檢查輸入內容。')
  })
})
