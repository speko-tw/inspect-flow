import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  collectPages,
  FORBIDDEN_MESSAGE,
  GENERIC_FAILURE_MESSAGE,
  HttpError,
  httpErrorMessage,
  isForbidden,
  listAllPages,
  NETWORK_ERROR_MESSAGE,
  request,
  SERVER_ERROR_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
} from './http'

afterEach(() => vi.unstubAllGlobals())

class CustomError extends HttpError {}

describe('request', () => {
  it('sends same-site JSON and returns the parsed body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      request('/things', { method: 'POST', body: '{}' }),
    ).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/things',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  it('returns undefined for 204', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    )
    await expect(request('/things/1', { method: 'DELETE' })).resolves.toBe(
      undefined,
    )
  })

  it('throws the given class with status, code, and details', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: 'x.conflict', details: ['a'] } },
            { status: 409 },
          ),
        ),
    )
    const error = await request('/things', undefined, CustomError).catch(
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(CustomError)
    expect(error).toBeInstanceOf(HttpError)
    expect(error).toMatchObject({
      status: 409,
      code: 'x.conflict',
      details: ['a'],
    })
  })

  it('reports a 200 response whose body is not JSON as an API error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })),
    )
    const error = await request('/things').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(HttpError)
    expect(httpErrorMessage(error)).toBe(GENERIC_FAILURE_MESSAGE)
  })

  it('keeps only the status when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('boom', { status: 502 })),
    )
    const error = await request('/things').catch((caught: unknown) => caught)
    expect(error).toMatchObject({ status: 502, code: undefined })
  })
})

describe('pagination', () => {
  it('collectPages follows next_cursor until it is null', async () => {
    const pages: Record<
      string,
      { items: number[]; next_cursor: string | null }
    > = {
      start: { items: [1, 2], next_cursor: 'b' },
      b: { items: [3], next_cursor: null },
    }
    const seen: Array<string | null> = []
    const items = await collectPages<number>(async (cursor) => {
      seen.push(cursor)
      return pages[cursor ?? 'start']
    })
    expect(items).toEqual([1, 2, 3])
    expect(seen).toEqual([null, 'b'])
  })

  it('listAllPages asks for 100 per page and passes extra params', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ items: ['a'], next_cursor: 'next' }),
      )
      .mockResolvedValueOnce(
        Response.json({ items: ['b'], next_cursor: null }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(listAllPages('/things', { q: 'x' })).resolves.toEqual([
      'a',
      'b',
    ])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/things?limit=100&q=x')
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/v1/things?limit=100&q=x&cursor=next',
    )
  })
})

describe('isForbidden', () => {
  it('accepts 403 and permission.denied from any HttpError', () => {
    expect(isForbidden(new HttpError(403))).toBe(true)
    expect(isForbidden(new CustomError(422, 'permission.denied'))).toBe(true)
    expect(isForbidden(new HttpError(401))).toBe(false)
    expect(isForbidden(new Error('network'))).toBe(false)
    expect(isForbidden({ status: 403 })).toBe(false)
  })
})

describe('httpErrorMessage', () => {
  it.each([
    [
      'network failure',
      new TypeError('Failed to fetch'),
      NETWORK_ERROR_MESSAGE,
    ],
    ['401', new HttpError(401), SESSION_EXPIRED_MESSAGE],
    ['403', new HttpError(403), FORBIDDEN_MESSAGE],
    [
      'permission.denied',
      new HttpError(422, 'permission.denied'),
      FORBIDDEN_MESSAGE,
    ],
    ['500', new HttpError(500), SERVER_ERROR_MESSAGE],
    ['503', new HttpError(503), SERVER_ERROR_MESSAGE],
    ['422', new HttpError(422), GENERIC_FAILURE_MESSAGE],
    ['409', new HttpError(409), GENERIC_FAILURE_MESSAGE],
  ])('maps %s to a shared message', (_name, error, message) => {
    expect(httpErrorMessage(error)).toBe(message)
  })

  it('lets a page override codes and the fallback only', () => {
    const options = {
      codes: { 'x.special': '特例' },
      fallback: '頁面自己的說明',
    }
    expect(httpErrorMessage(new HttpError(409, 'x.special'), options)).toBe(
      '特例',
    )
    expect(httpErrorMessage(new HttpError(409), options)).toBe(
      '頁面自己的說明',
    )
    expect(httpErrorMessage(new HttpError(503), options)).toBe(
      SERVER_ERROR_MESSAGE,
    )
    expect(httpErrorMessage(new HttpError(401), options)).toBe(
      SESSION_EXPIRED_MESSAGE,
    )
  })
})
