import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ProjectTemplatesApiError,
  templateErrorMessage,
} from './projectTemplatesApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('templateErrorMessage', () => {
  it('save name conflicts identify the source item and next action', () => {
    expect(
      templateErrorMessage(
        new ProjectTemplatesApiError(409, 'template.name_conflict'),
        '管線查核',
      ),
    ).toBe('這個系統已有「管線查核」，沒有存入範本。請改選其他系統。')
  })
})
