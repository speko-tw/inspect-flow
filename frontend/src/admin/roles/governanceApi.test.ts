import { afterEach, describe, expect, it, vi } from 'vitest'

import { getCreatorRole, setCreatorRole, updateRole } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('role governance API contract', () => {
  it('updates role flags and reads/writes the creator role setting', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void init
        const path = new URL(String(input), 'http://test.local').pathname
        if (path.endsWith('/creator-role')) {
          return Response.json({ role_id: 'role-1' })
        }
        return Response.json({ id: 'role-1' })
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    await updateRole('role-1', {
      is_assignable: false,
      is_external_allowed: true,
    })
    await getCreatorRole()
    await setCreatorRole('role-1')

    expect(
      fetchMock.mock.calls.map((call) => call[1]?.method ?? 'GET'),
    ).toEqual(['PATCH', 'GET', 'PATCH'])
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      is_assignable: false,
      is_external_allowed: true,
    })
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      role_id: 'role-1',
    })
  })
})
