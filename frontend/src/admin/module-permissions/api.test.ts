import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  applyPermissionBundle,
  getRevokeImpact,
  grantModulePermission,
  revokeModulePermission,
} from './api'

afterEach(() => vi.unstubAllGlobals())

describe('module permission API contract', () => {
  it('uses the atomic bundle apply endpoint', async () => {
    const fetchMock = vi.fn(
      async (...args: [RequestInfo | URL, RequestInit?]) => {
        void args
        return Response.json({
          user_id: 'user-1',
          granted_codes: ['inspection.use'],
        })
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    await applyPermissionBundle('user-1', 'bundle-1')

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toContain(
      '/users/user-1/permission-bundles/bundle-1:apply',
    )
    expect(init?.method).toBe('POST')
  })

  it('previews impacts before revoking and sends no write on preview', async () => {
    const fetchMock = vi.fn(
      async (...args: [RequestInfo | URL, RequestInit?]) => {
        void args
        return Response.json({
          membership_count: 2,
          projects: [],
          projects_becoming_unmanaged: [],
        })
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    const impact = await getRevokeImpact('user-1', 'project.use')

    expect(impact.membership_count).toBe(2)
    expect(fetchMock.mock.calls[0]?.[1]?.method ?? 'GET').toBe('GET')
  })

  it('uses individual grant and revoke methods for advanced changes', async () => {
    const fetchMock = vi.fn(
      async (...args: [RequestInfo | URL, RequestInit?]) => {
        void args
        return new Response(null, { status: 204 })
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    await grantModulePermission('user-1', 'inspection.use')
    await revokeModulePermission('user-1', 'inspection.use')

    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual([
      'PUT',
      'DELETE',
    ])
  })
})
