import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  listTemplateItems,
  ProjectTemplatesApiError,
  templateErrorMessage,
} from './projectTemplatesApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listTemplateItems', () => {
  it('loads complete, paginated items for a system preview', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: 'template-1',
              system_id: 'system-1',
              sequence: 1,
              title: '檢查項目',
              instruction: '依圖檢查',
              inspection_points: [],
            },
          ],
          next_cursor: null,
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(listTemplateItems('system-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'template-1',
        title: '檢查項目',
        instruction: '依圖檢查',
      }),
    ])

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/template-systems/system-1/templates?limit=100',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })
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
