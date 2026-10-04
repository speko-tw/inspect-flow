import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createTemplateItem,
  deleteTemplateItem,
  getSystemTemplates,
  putSystemTemplates,
  updateTemplateItem,
} from './api'

afterEach(() => vi.unstubAllGlobals())

describe('template API', () => {
  it('reads all system templates using cursor pagination', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          items: [{ id: 'first', title: '第一項' }],
          next_cursor: 'next-page',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [{ id: 'second', title: '第二項' }],
          next_cursor: null,
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(getSystemTemplates('system-1')).resolves.toEqual({
      items: [
        { id: 'first', title: '第一項' },
        { id: 'second', title: '第二項' },
      ],
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/template-systems/system-1/templates?limit=100',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
    expect(fetchMock.mock.calls[1][0]).toContain('cursor=next-page')
  })

  it('replaces the full system collection with item structures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await putSystemTemplates('system-1', [
      {
        system_id: 'system-1',
        sequence: 1,
        title: '欄杆檢查',
        instruction: '',
        inspection_points: [],
      },
    ])

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/template-systems/system-1/templates',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          items: [
            {
              system_id: 'system-1',
              sequence: 1,
              title: '欄杆檢查',
              instruction: '',
              inspection_points: [],
            },
          ],
        }),
      }),
    )
  })

  it('uses single-item endpoints for create, update, and delete', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: 'item-1' }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ id: 'item-1' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const item = {
      system_id: 'system-1',
      sequence: 1,
      title: '坡度',
      instruction: '',
      inspection_points: [],
    }

    await createTemplateItem(item)
    await updateTemplateItem('item-1', item)
    await deleteTemplateItem('item-1')

    expect(
      fetchMock.mock.calls.map(([url, init]) => [url, init?.method]),
    ).toEqual([
      ['/api/v1/templates', 'POST'],
      ['/api/v1/templates/item-1', 'PUT'],
      ['/api/v1/templates/item-1', 'DELETE'],
    ])
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify(item))
    expect(fetchMock.mock.calls[1][1]?.body).toBe(JSON.stringify(item))
  })
})
