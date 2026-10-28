import { afterEach, expect, it, vi } from 'vitest'
import { createMemoryRouter } from 'react-router'

import { getBasePath } from './basePath'
import { request } from './http'
import { fetchCurrentUser } from './auth/api'
import { fetchSetupRequired } from './setup/api'

afterEach(() => {
  document.head.querySelector('meta[name="inspectflow-base-path"]')?.remove()
  vi.unstubAllGlobals()
})

it('子路徑同時套用 Router basename 與三個請求入口', async () => {
  const meta = document.createElement('meta')
  meta.name = 'inspectflow-base-path'
  meta.content = '/inspectflow'
  document.head.append(meta)
  const fetchMock = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ setup_required: true }))),
    )
  vi.stubGlobal('fetch', fetchMock)
  await request('/projects')
  await fetchCurrentUser()
  await fetchSetupRequired()
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    '/inspectflow/api/v1/projects',
    '/inspectflow/api/v1/auth/me',
    '/inspectflow/api/v1/setup/status',
  ])
  const router = createMemoryRouter([{ path: '/projects', element: null }], {
    basename: getBasePath(),
    initialEntries: ['/inspectflow/projects'],
  })
  await router.navigate('/projects/new')
  expect(router.state.location.pathname).toBe('/inspectflow/projects/new')
  router.dispose()
})
