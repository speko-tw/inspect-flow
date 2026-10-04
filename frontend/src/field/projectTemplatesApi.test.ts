import { afterEach, describe, expect, it, vi } from 'vitest'

import { listTemplateItems } from './projectTemplatesApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listTemplateItems', () => {
  it('loads paginated summaries filtered by system_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [{ id: 'template-1', title: '檢查項目' }],
          next_cursor: null,
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(listTemplateItems('system-1')).resolves.toEqual([
      { id: 'template-1', title: '檢查項目' },
    ])

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/templates?system_id=system-1&limit=100',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })
})
