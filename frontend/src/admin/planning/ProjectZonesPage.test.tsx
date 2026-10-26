import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { Link, Route, Routes, useLocation } from 'react-router'
import { CurrentUserProvider } from '../../auth/useCurrentUser'
import { DataMemoryRouter } from '../../testing/DataMemoryRouter'
import { currentUserFixture } from '../../testing/contractFixtures'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { deferred, expectImeEnterIgnored } from '../../testing/submitGuard'
import { ManagementApiError } from '../api'
import type { PlanningClient } from './api'
import { createMockPlanningClient } from './api.mock'
import nameTooLong from './fixtures/name-too-long-422.json'
import ProjectZonesPage from './ProjectZonesPage'

const restoreScrollMocks: Array<() => void> = []

afterEach(() => {
  restoreScrollMocks.splice(0).forEach((restore) => restore())
  vi.unstubAllGlobals()
})

function mockScrollIntoView() {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollIntoView',
  )
  const scrollIntoView = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  })
  restoreScrollMocks.push(() => {
    if (descriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        'scrollIntoView',
        descriptor,
      )
    } else {
      delete (HTMLElement.prototype as { scrollIntoView?: () => void })
        .scrollIntoView
    }
  })
  return scrollIntoView
}

function validationError(fixture: {
  error: { code: string; fields: Array<{ path: string; code: string }> }
}) {
  const error = new ManagementApiError(422, fixture.error.code)
  error.fields = fixture.error.fields
  return error
}

function renderPage(
  viewerPermissions: string[],
  initialPath = '/projects/project-demo-1/zones',
) {
  const client = createMockPlanningClient()
  render(
    <DataMemoryRouter initialEntries={[initialPath]}>
      <CurrentUserProvider
        value={{ user: currentUserFixture(), clear: vi.fn() }}
      >
        <Routes>
          <Route
            element={
              <ProjectZonesPage
                client={client}
                viewerPermissions={viewerPermissions}
              />
            }
            path="/projects/:projectId/zones"
          />
          <Route
            element={
              <ProjectZonesPage
                client={client}
                viewerPermissions={viewerPermissions}
              />
            }
            path="/projects/:projectId/zones/new"
          />
        </Routes>
      </CurrentUserProvider>
    </DataMemoryRouter>,
  )
  return client
}

async function openAddForm() {
  const link = screen.queryByRole('link', { name: '新增分區' })
  if (link) fireEvent.click(link)
  await screen.findByRole('heading', { name: '新增分區' })
}

describe('project zones section', () => {
  it('denies a direct add-form URL without manage permission', async () => {
    const client = createMockPlanningClient()
    render(
      <DataMemoryRouter
        initialEntries={['/projects/project-demo-1/zones/new']}
      >
        <CurrentUserProvider
          value={{ user: currentUserFixture(), clear: vi.fn() }}
        >
          <Routes>
            <Route
              element={
                <ProjectZonesPage
                  client={client}
                  viewerPermissions={['project_zone.read']}
                />
              }
              path="/projects/:projectId/zones/new"
            />
          </Routes>
        </CurrentUserProvider>
      </DataMemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: '無權限', level: 2 }),
    ).toBeVisible()
    expect(screen.queryByLabelText('分區名稱')).toBeNull()
  })

  it('opens an authorized direct add URL in the standalone form', async () => {
    renderPage(
      ['project_zone.read', 'project_zone.manage'],
      '/projects/project-demo-1/zones/new',
    )

    expect(
      await screen.findByRole('heading', { name: '新增分區' }),
    ).toBeVisible()
    expect(screen.getByLabelText('分區名稱')).toBeVisible()
    expect(screen.queryByRole('link', { name: '新增分區' })).toBeNull()
    expect(screen.getByRole('link', { name: '取消' })).toHaveAttribute(
      'href',
      '/projects/project-demo-1/zones',
    )
  })

  it('lets members with manage permission add a project zone', async () => {
    const client = renderPage(['project_zone.read', 'project_zone.manage'])
    await openAddForm()

    fireEvent.change(await screen.findByLabelText('分區名稱'), {
      target: { value: '北區' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增分區' }))

    expect(await screen.findByText('北區')).toBeVisible()
    expect(await screen.findByRole('status')).toHaveTextContent(
      '已新增分區「北區」。',
    )
    const northRow = screen.getByText('北區').closest('li')
    fireEvent.click(
      within(northRow as HTMLElement).getByRole('button', {
        name: '重新命名',
      }),
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByLabelText('分區名稱').closest('li')).toBe(northRow)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await openAddForm()
    fireEvent.click(await screen.findByRole('button', { name: '新增分區' }))
    expect(await screen.findByText('請輸入分區名稱。')).toBeVisible()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await expect(
      client.listProjectZones('project-demo-1'),
    ).resolves.toHaveLength(1)
  })

  it('clears a discarded zone name before reopening the add route', async () => {
    renderPage(MANAGE)
    await openAddForm()
    fireEvent.change(await screen.findByLabelText('分區名稱'), {
      target: { value: '捨棄的分區' },
    })

    fireEvent.click(screen.getByRole('link', { name: '取消' }))
    const prompt = await screen.findByRole('group', {
      name: '有尚未儲存的變更',
    })
    fireEvent.click(within(prompt).getByRole('button', { name: '捨棄變更' }))
    expect(screen.getByRole('heading', { name: '分區' })).toBeVisible()

    await openAddForm()
    expect(screen.getByLabelText('分區名稱')).toHaveValue('')
  })

  it('shows zones without edit controls to read-only members', async () => {
    const client = createMockPlanningClient()
    await client.createZone('project-demo-1', '北區')
    render(
      <DataMemoryRouter initialEntries={['/projects/project-demo-1/zones']}>
        <Routes>
          <Route
            element={
              <ProjectZonesPage
                client={client}
                viewerPermissions={['project_zone.read']}
              />
            }
            path="/projects/:projectId/zones"
          />
          <Route
            element={
              <ProjectZonesPage
                client={client}
                viewerPermissions={[
                  'project_zone.read',
                  'project_zone.manage',
                ]}
              />
            }
            path="/projects/:projectId/zones/new"
          />
        </Routes>
      </DataMemoryRouter>,
    )

    expect(await screen.findByText('北區')).toBeVisible()
    expect(screen.queryByRole('link', { name: '新增分區' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '新增分區' })).toBeNull()
  })

  it('shows and focuses a field error when an empty zone form is submitted', async () => {
    const client = renderPage(['project_zone.read', 'project_zone.manage'])
    fireEvent.click(await screen.findByRole('link', { name: '新增分區' }))
    const input = await screen.findByLabelText('分區名稱')

    fireEvent.click(screen.getByRole('button', { name: '新增分區' }))

    expect(await screen.findByText('請輸入分區名稱。')).toBeVisible()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(input).toHaveFocus())
    await expect(client.listProjectZones('project-demo-1')).resolves.toEqual(
      [],
    )
  })

  it('clears an empty rename error when cancelled back to add mode', async () => {
    const client = createMockPlanningClient()
    await client.createZone('project-demo-1', '北區')
    render(
      <DataMemoryRouter initialEntries={['/projects/project-demo-1/zones']}>
        <Routes>
          <Route
            element={
              <ProjectZonesPage
                client={client}
                viewerPermissions={[
                  'project_zone.read',
                  'project_zone.manage',
                ]}
              />
            }
            path="/projects/:projectId/zones"
          />
          <Route
            element={
              <ProjectZonesPage
                client={client}
                viewerPermissions={[
                  'project_zone.read',
                  'project_zone.manage',
                ]}
              />
            }
            path="/projects/:projectId/zones/new"
          />
        </Routes>
      </DataMemoryRouter>,
    )

    const northRow = (await screen.findByText('北區')).closest('li')
    fireEvent.click(
      within(northRow as HTMLElement).getByRole('button', {
        name: '重新命名',
      }),
    )
    const inlineInput = screen.getByLabelText('分區名稱')
    expect(inlineInput.closest('li')).toBe(northRow)
    expect(
      within(northRow as HTMLElement).getByRole('heading', {
        name: '修改分區「北區」',
      }),
    ).toBeVisible()
    fireEvent.change(inlineInput, {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存名稱' }))
    expect(await screen.findByText('請輸入分區名稱。')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    fireEvent.click(screen.getByRole('link', { name: '新增分區' }))
    expect(screen.getByRole('heading', { name: '新增分區' })).toBeVisible()
    expect(screen.getByLabelText('分區名稱')).toHaveAttribute(
      'aria-invalid',
      'false',
    )
    expect(screen.queryByText('請輸入分區名稱。')).not.toBeInTheDocument()
  })

  it('returns focus to the row trigger after a successful rename', async () => {
    const client = createMockPlanningClient()
    await client.createZone('project-demo-1', '北區')
    render(
      <DataMemoryRouter initialEntries={['/projects/project-demo-1/zones']}>
        <Routes>
          <Route
            element={
              <ProjectZonesPage
                client={client}
                viewerPermissions={[
                  'project_zone.read',
                  'project_zone.manage',
                ]}
              />
            }
            path="/projects/:projectId/zones"
          />
          <Route
            element={
              <ProjectZonesPage
                client={client}
                viewerPermissions={[
                  'project_zone.read',
                  'project_zone.manage',
                ]}
              />
            }
            path="/projects/:projectId/zones/new"
          />
        </Routes>
      </DataMemoryRouter>,
    )
    const row = (await screen.findByText('北區')).closest('li') as HTMLElement
    const trigger = within(row).getByRole('button', { name: '重新命名' })
    fireEvent.click(trigger)
    expect(
      within(row).queryByRole('button', { name: '重新命名' }),
    ).not.toBeInTheDocument()
    expect(
      within(row).queryByRole('button', { name: '刪除' }),
    ).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('分區名稱'), {
      target: { value: '北一區' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存名稱' }))

    expect(await screen.findByText('北一區')).toBeVisible()
    await waitFor(() => {
      const row = screen.getByText('北一區').closest('li') as HTMLElement
      expect(
        within(row).getByRole('button', { name: '重新命名' }),
      ).toHaveFocus()
      expect(within(row).getByRole('button', { name: '刪除' })).toBeVisible()
    })
  })

  it('maps the server zone-name 422 field beside the input and focuses it', async () => {
    const client = renderPage(['project_zone.read', 'project_zone.manage'])
    fireEvent.click(await screen.findByRole('link', { name: '新增分區' }))
    client.createZone = vi.fn().mockRejectedValue(validationError(nameTooLong))
    const input = await screen.findByLabelText('分區名稱')
    fireEvent.change(input, { target: { value: '一個很長的名稱' } })
    fireEvent.click(screen.getByRole('button', { name: '新增分區' }))

    expect(await screen.findByText('輸入內容太長。')).toBeVisible()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute(
      'aria-describedby',
      'project-zone-name-error',
    )
    // 錯誤先在 render 出現，焦點由 effect 移動，須等 effect 完成。
    await waitFor(() => expect(input).toHaveFocus())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('maps a real 422 response envelope from the planning HTTP client', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return Response.json(nameTooLong, { status: 422 })
        }
        return Response.json({ items: [], next_cursor: null })
      },
    )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <DataMemoryRouter initialEntries={['/projects/project-demo-1/zones']}>
        <Routes>
          <Route
            element={
              <ProjectZonesPage
                viewerPermissions={[
                  'project_zone.read',
                  'project_zone.manage',
                ]}
              />
            }
            path="/projects/:projectId/zones"
          />
          <Route
            element={
              <ProjectZonesPage
                viewerPermissions={[
                  'project_zone.read',
                  'project_zone.manage',
                ]}
              />
            }
            path="/projects/:projectId/zones/new"
          />
        </Routes>
      </DataMemoryRouter>,
    )
    await openAddForm()
    const input = await screen.findByLabelText('分區名稱')
    fireEvent.change(input, { target: { value: '超出伺服器限制的分區名稱' } })
    fireEvent.click(screen.getByRole('button', { name: '新增分區' }))

    expect(await screen.findByText('輸入內容太長。')).toBeVisible()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(input).toHaveFocus())
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/projects/project-demo-1/zones'),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clears a prior rename validation error when choosing another zone', async () => {
    const client = createMockPlanningClient()
    await client.createZone('project-demo-1', '北區')
    await client.createZone('project-demo-1', '南區')
    client.renameZone = vi.fn().mockRejectedValue(validationError(nameTooLong))
    render(
      <DataMemoryRouter initialEntries={['/projects/project-demo-1/zones']}>
        <Routes>
          <Route
            element={
              <ProjectZonesPage
                client={client}
                viewerPermissions={[
                  'project_zone.read',
                  'project_zone.manage',
                ]}
              />
            }
            path="/projects/:projectId/zones"
          />
        </Routes>
      </DataMemoryRouter>,
    )

    const northRow = (await screen.findByText('北區')).closest('li')
    fireEvent.click(
      within(northRow as HTMLElement).getByRole('button', {
        name: '重新命名',
      }),
    )
    fireEvent.change(screen.getByLabelText('分區名稱'), {
      target: { value: '超出伺服器限制的分區名稱' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存名稱' }))

    const input = screen.getByLabelText('分區名稱')
    expect(await screen.findByText('輸入內容太長。')).toBeVisible()
    expect(input).toHaveAttribute('aria-invalid', 'true')

    const southRow = screen.getByText('南區').closest('li')
    expect(
      within(northRow as HTMLElement).queryByRole('button', {
        name: '重新命名',
      }),
    ).not.toBeInTheDocument()
    expect(
      within(southRow as HTMLElement).getByRole('button', {
        name: '重新命名',
      }),
    ).toBeEnabled()
    expect(
      within(southRow as HTMLElement).getByRole('button', { name: '刪除' }),
    ).toBeEnabled()
    fireEvent.click(
      within(southRow as HTMLElement).getByRole('button', {
        name: '重新命名',
      }),
    )

    expect(
      within(southRow as HTMLElement).queryByRole('button', {
        name: '重新命名',
      }),
    ).not.toBeInTheDocument()
    expect(
      within(southRow as HTMLElement).queryByRole('button', {
        name: '刪除',
      }),
    ).not.toBeInTheDocument()
    expect(
      within(northRow as HTMLElement).getByRole('button', {
        name: '重新命名',
      }),
    ).toBeEnabled()
    expect(
      within(northRow as HTMLElement).getByRole('button', { name: '刪除' }),
    ).toBeEnabled()

    const southInput = screen.getByLabelText('分區名稱')
    expect(southInput).toHaveValue('南區')
    expect(southInput).toHaveAttribute('aria-invalid', 'false')
    expect(screen.queryByText('輸入內容太長。')).not.toBeInTheDocument()
  })

  it('asks in the page before a link discards a zone draft', async () => {
    const client = createMockPlanningClient()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <DataMemoryRouter initialEntries={['/projects/project-demo-1/zones']}>
        <Routes>
          <Route
            element={
              <>
                <ProjectZonesPage client={client} viewerPermissions={MANAGE} />
                <Link to="/outside">切換頁面</Link>
              </>
            }
            path="/projects/:projectId/zones"
          />
          <Route
            element={
              <>
                <ProjectZonesPage client={client} viewerPermissions={MANAGE} />
                <Link to="/outside">切換頁面</Link>
              </>
            }
            path="/projects/:projectId/zones/new"
          />
          <Route element={<p>已離開分區頁</p>} path="/outside" />
        </Routes>
      </DataMemoryRouter>,
    )

    await openAddForm()
    fireEvent.change(await screen.findByLabelText('分區名稱'), {
      target: { value: '尚未儲存' },
    })
    const unload = new Event('beforeunload', {
      cancelable: true,
    }) as BeforeUnloadEvent
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)

    fireEvent.click(screen.getByRole('link', { name: '切換頁面' }))
    const box = await screen.findByRole('group', { name: '有尚未儲存的變更' })
    expect(confirm).not.toHaveBeenCalled()
    expect(screen.queryByText('已離開分區頁')).toBeNull()

    fireEvent.click(within(box).getByRole('button', { name: '保留編輯' }))
    expect(screen.getByLabelText('分區名稱')).toHaveValue('尚未儲存')

    fireEvent.click(screen.getByRole('link', { name: '切換頁面' }))
    fireEvent.click(
      within(await screen.findByRole('group')).getByRole('button', {
        name: '捨棄變更',
      }),
    )
    expect(await screen.findByText('已離開分區頁')).toBeVisible()
    confirm.mockRestore()
  })
})

const MANAGE = ['project_zone.read', 'project_zone.manage']
const PROJECT = 'project-demo-1'

type Zones = Pick<
  PlanningClient,
  'createZone' | 'renameZone' | 'deleteZone' | 'listProjectZones'
>

/** 讓指定方法等到 gate 完成才回應，模擬「請求還沒回來」。 */
function hold(client: PlanningClient, method: 'createZone' | 'renameZone') {
  const gate = deferred()
  const original = (client[method] as Zones[typeof method]).bind(client)
  const spy = vi.fn(async (...args: unknown[]) => {
    await gate.promise
    return (original as (...a: unknown[]) => unknown)(...args)
  })
  client[method] = spy as never
  return { gate, spy }
}

function ZoneLocationState() {
  const location = useLocation()
  return (
    <output data-testid="zone-location-state">
      {JSON.stringify(location.state)}
    </output>
  )
}

function mount(
  client: PlanningClient,
  permissions = MANAGE,
  initialPath = `/projects/${PROJECT}/zones`,
  showRouteNavigation = false,
  showLocationState = false,
) {
  render(
    <CurrentUserProvider
      value={{ user: currentUserFixture(), clear: vi.fn() }}
    >
      <DataMemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            element={
              <ProjectZonesPage
                client={client}
                viewerPermissions={permissions}
              />
            }
            path="/projects/:projectId/zones"
          />
          <Route
            element={
              <ProjectZonesPage
                client={client}
                viewerPermissions={permissions}
              />
            }
            path="/projects/:projectId/zones/new"
          />
        </Routes>
        {showRouteNavigation && (
          <Link to={`/projects/${PROJECT}/zones/new`}>
            測試：開啟新增分區網址
          </Link>
        )}
        {showLocationState ? <ZoneLocationState /> : null}
      </DataMemoryRouter>
    </CurrentUserProvider>,
  )
}

function rowOf(name: string) {
  return screen.getByText(name).closest('li') as HTMLElement
}

describe('adding and renaming zones', () => {
  it('matches the add route with a trailing slash', async () => {
    mount(
      createMockPlanningClient(),
      MANAGE,
      `/projects/${PROJECT}/zones/new/`,
    )

    expect(
      await screen.findByRole('heading', { name: '新增分區' }),
    ).toBeVisible()
    const input = screen.getByLabelText('分區名稱')
    expect(input).toBeVisible()
    const actions = input.closest('form')?.querySelector('.named-row-actions')
    expect(actions).not.toBeNull()
    const cancel = within(actions as HTMLElement).getByRole('link', {
      name: '取消',
    })
    const submit = within(actions as HTMLElement).getByRole('button', {
      name: '新增分區',
    })
    expect(cancel.parentElement).toBe(submit.parentElement)
    expect(
      cancel.compareDocumentPosition(submit) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0)
  })

  it('consumes the created-zone location state after showing its row notice', async () => {
    const scrollIntoView = mockScrollIntoView()
    const client = createMockPlanningClient()
    mount(client, MANAGE, `/projects/${PROJECT}/zones/new`, false, true)
    await screen.findByLabelText('分區名稱')
    fireEvent.change(screen.getByLabelText('分區名稱'), {
      target: { value: '新增分區' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增分區' }))

    const zoneName = await screen.findByText('新增分區', {
      selector: '.named-row-name',
    })
    await waitFor(() => {
      expect(screen.getByTestId('zone-location-state')).toHaveTextContent(
        'null',
      )
    })
    const row = zoneName.closest('li')
    const rowNotice = within(row as HTMLElement).getByRole('status')
    expect(rowNotice).toHaveTextContent('已新增分區「新增分區」。')
    await waitFor(() => {
      expect(row).toHaveStyle({ backgroundColor: 'var(--success-bg)' })
    })
    await waitFor(() => {
      expect(scrollIntoView.mock.contexts).toContain(rowNotice)
    })
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(screen.getByTestId('zone-location-state')).toHaveTextContent('null')
  })

  it('creates instead of renaming after entering the add route', async () => {
    const client = createMockPlanningClient()
    await client.createZone(PROJECT, 'A')
    const create = vi.spyOn(client, 'createZone')
    const rename = vi.spyOn(client, 'renameZone')
    mount(client, MANAGE, `/projects/${PROJECT}/zones`, true)
    await screen.findByText('A')

    const addLink = screen.getByRole('link', { name: '新增分區' })
    expect(addLink).toHaveAttribute('href', `/projects/${PROJECT}/zones/new`)
    fireEvent.click(
      within(rowOf('A')).getByRole('button', { name: '重新命名' }),
    )
    expect(screen.getByLabelText('分區名稱')).toHaveValue('A')
    fireEvent.click(
      screen.getByRole('link', { name: '測試：開啟新增分區網址' }),
    )
    expect(
      await screen.findByRole('heading', { name: '新增分區' }),
    ).toBeVisible()
    fireEvent.change(screen.getByLabelText('分區名稱'), {
      target: { value: 'B' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增分區' }))

    expect.soft(create).toHaveBeenCalledWith(PROJECT, 'B')
    expect.soft(rename).not.toHaveBeenCalled()
    await expect(client.listProjectZones(PROJECT)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'A' }),
        expect.objectContaining({ name: 'B' }),
      ]),
    )
  })

  it('cancels a typed new zone with Escape', async () => {
    mount(createMockPlanningClient())
    await openAddForm()
    const input = await screen.findByLabelText('分區名稱')
    fireEvent.change(input, { target: { value: '暫存分區' } })

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(input).toHaveValue('')
    expect(screen.queryByText('暫存分區')).toBeNull()
  })

  it('renames with Enter, cancels another rename with Escape and gives focus back', async () => {
    const client = createMockPlanningClient()
    await client.createZone(PROJECT, '北區')
    mount(client)
    await screen.findByText('北區')

    const originalRow = rowOf('北區')
    fireEvent.click(
      within(originalRow).getByRole('button', { name: '重新命名' }),
    )
    const input = screen.getByLabelText('分區名稱')
    expect(
      within(originalRow).queryByRole('button', { name: '重新命名' }),
    ).not.toBeInTheDocument()
    expect(
      within(originalRow).queryByRole('button', { name: '刪除' }),
    ).not.toBeInTheDocument()
    // 進入改名模式後由 effect 聚焦，等待焦點移動完成。
    await waitFor(() => expect(input).toHaveFocus())
    fireEvent.change(input, { target: { value: '北側' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByRole('status')).toHaveTextContent(
      '已將分區改名為「北側」。',
    )
    expect(screen.getByText('北側')).toBeVisible()

    const trigger = within(rowOf('北側')).getByRole('button', {
      name: '重新命名',
    })
    // 先完成上一輪回焦，再以已取得焦點的輸入框接收鍵盤操作。
    await waitFor(() => expect(trigger).toHaveFocus())
    fireEvent.click(trigger)
    await waitFor(() =>
      expect(screen.getByLabelText('分區名稱')).toHaveFocus(),
    )
    fireEvent.change(screen.getByLabelText('分區名稱'), {
      target: { value: '取消的名稱' },
    })
    fireEvent.keyDown(screen.getByLabelText('分區名稱'), { key: 'Escape' })

    await waitFor(() => {
      expect(
        within(rowOf('北側')).getByRole('button', { name: '重新命名' }),
      ).toHaveFocus()
    })
    expect(screen.queryByText('取消的名稱')).toBeNull()
    expect(screen.getByRole('link', { name: '新增分區' })).toBeVisible()
  })

  it('restores both row actions and focus after clicking cancel', async () => {
    const client = createMockPlanningClient()
    await client.createZone(PROJECT, '北區')
    mount(client)
    await screen.findByText('北區')

    const row = rowOf('北區')
    fireEvent.click(within(row).getByRole('button', { name: '重新命名' }))
    const input = screen.getByLabelText('分區名稱')
    await waitFor(() => expect(input).toHaveFocus())
    expect(screen.queryByRole('link', { name: '新增分區' })).toBeNull()
    expect(
      within(row).queryByRole('button', { name: '重新命名' }),
    ).not.toBeInTheDocument()
    expect(
      within(row).queryByRole('button', { name: '刪除' }),
    ).not.toBeInTheDocument()
    fireEvent.change(input, { target: { value: '取消的名稱' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    await waitFor(() => {
      expect(
        within(row).getByRole('button', { name: '重新命名' }),
      ).toHaveFocus()
      expect(within(row).getByRole('button', { name: '刪除' })).toBeVisible()
    })
    expect(screen.getByRole('link', { name: '新增分區' })).toBeVisible()
    expect(screen.queryByText('取消的名稱')).toBeNull()
  })

  it('sends one create request when Enter is pressed twice quickly (#490)', async () => {
    const client = createMockPlanningClient()
    const { gate, spy } = hold(client, 'createZone')
    mount(client)
    await openAddForm()
    const input = await screen.findByLabelText('分區名稱')
    fireEvent.change(input, { target: { value: '一樓' } })

    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    gate.resolve()

    expect(await screen.findByRole('status')).toHaveTextContent(
      '已新增分區「一樓」。',
    )
    expect(spy).toHaveBeenCalledTimes(1)
    // 第二次 Enter 不能變成「名稱重複」的錯誤。
    expect(screen.queryByRole('alert')).toBeNull()
    expect(await screen.findByText('一樓')).toBeVisible()
  })

  it('sends one rename request when Enter is pressed twice quickly', async () => {
    const client = createMockPlanningClient()
    await client.createZone(PROJECT, '北區')
    const { gate, spy } = hold(client, 'renameZone')
    mount(client)
    await screen.findByText('北區')
    fireEvent.click(
      within(rowOf('北區')).getByRole('button', { name: '重新命名' }),
    )
    const input = screen.getByLabelText('分區名稱')
    fireEvent.change(input, { target: { value: '北側' } })

    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    gate.resolve()

    expect(await screen.findByRole('status')).toHaveTextContent(
      '已將分區改名為「北側」。',
    )
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('does not submit when Enter only confirms an IME choice', async () => {
    const client = createMockPlanningClient()
    const create = vi.spyOn(client, 'createZone')
    mount(client)
    await openAddForm()
    const input = await screen.findByLabelText('分區名稱')
    fireEvent.change(input, { target: { value: '一樓' } })

    expectImeEnterIgnored(input)

    expect(create).not.toHaveBeenCalled()
    expect(input).toHaveValue('一樓')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByRole('status')).toHaveTextContent(
      '已新增分區「一樓」。',
    )
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('ignores IME Enter in the rename form', async () => {
    const client = createMockPlanningClient()
    await client.createZone(PROJECT, '北區')
    const rename = vi.spyOn(client, 'renameZone')
    mount(client)
    await screen.findByText('北區')
    fireEvent.click(
      within(rowOf('北區')).getByRole('button', { name: '重新命名' }),
    )
    const input = screen.getByLabelText('分區名稱')
    fireEvent.change(input, { target: { value: '北側' } })

    expectImeEnterIgnored(input)

    expect(rename).not.toHaveBeenCalled()
  })

  it('disables the buttons while a zone is being added or renamed (#516)', async () => {
    const client = createMockPlanningClient()
    await client.createZone(PROJECT, '北區')
    const create = hold(client, 'createZone')
    const rename = hold(client, 'renameZone')
    mount(client)
    await screen.findByText('北區')
    await openAddForm()
    fireEvent.change(screen.getByLabelText('分區名稱'), {
      target: { value: '南區' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增分區' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '新增分區' })).toBeDisabled(),
    )
    create.gate.resolve()
    await screen.findByText('南區')

    fireEvent.click(
      within(rowOf('北區')).getByRole('button', { name: '重新命名' }),
    )
    fireEvent.change(screen.getByLabelText('分區名稱'), {
      target: { value: '北側' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存名稱' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '儲存名稱' })).toBeDisabled(),
    )
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
    rename.gate.resolve()
    await screen.findByText('北側')
  })

  it('shows a duplicate name 409 beside the name field and focuses it', async () => {
    const client = createMockPlanningClient()
    await client.createZone(PROJECT, '北區')
    mount(client)
    await openAddForm()
    const input = await screen.findByLabelText('分區名稱')
    fireEvent.change(input, { target: { value: '北區' } })

    fireEvent.click(screen.getByRole('button', { name: '新增分區' }))

    expect(
      await screen.findByText('同一專案已有相同名稱的分區。'),
    ).toHaveClass('field-error')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute(
      'aria-describedby',
      'project-zone-name-error',
    )
    await waitFor(() => expect(input).toHaveFocus())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a duplicate name 409 from a rename beside the field too', async () => {
    const client = createMockPlanningClient()
    await client.createZone(PROJECT, '北區')
    await client.createZone(PROJECT, '南區')
    mount(client)
    await screen.findByText('南區')
    fireEvent.click(
      within(rowOf('南區')).getByRole('button', { name: '重新命名' }),
    )
    const input = screen.getByLabelText('分區名稱')
    fireEvent.change(input, { target: { value: '北區' } })

    fireEvent.click(screen.getByRole('button', { name: '儲存名稱' }))

    expect(
      await screen.findByText('同一專案已有相同名稱的分區。'),
    ).toBeVisible()
    await waitFor(() => expect(input).toHaveFocus())
  })
})

describe('deleting zones', () => {
  async function openDelete(client: PlanningClient, name: string) {
    mount(client)
    await screen.findByText(name)
    const trigger = within(rowOf(name)).getByRole('button', { name: '刪除' })
    trigger.focus()
    fireEvent.click(trigger)
    return trigger
  }

  it('confirms in the row with a danger button, not a native dialog', async () => {
    const client = createMockPlanningClient()
    await client.createZone(PROJECT, '待刪除分區')
    const nativeConfirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const deleteZone = vi.spyOn(client, 'deleteZone')
    await openDelete(client, '待刪除分區')

    const box = within(rowOf('待刪除分區')).getByRole('group', {
      name: '刪除分區「待刪除分區」？',
    })
    // ConfirmBox 掛載後由 effect 設定初始焦點。
    await waitFor(() =>
      expect(within(box).getByRole('button', { name: '取消' })).toHaveFocus(),
    )
    expect(within(box).getByRole('button', { name: '確認刪除' })).toHaveClass(
      'btn-danger',
    )
    expect(nativeConfirm).not.toHaveBeenCalled()
    expect(deleteZone).not.toHaveBeenCalled()

    nativeConfirm.mockRestore()
  })

  it('closes with Esc, sends nothing and gives focus back to the trigger', async () => {
    const client = createMockPlanningClient()
    await client.createZone(PROJECT, '待取消分區')
    const deleteZone = vi.spyOn(client, 'deleteZone')
    const trigger = await openDelete(client, '待取消分區')
    const box = screen.getByRole('group', { name: /刪除分區/ })

    fireEvent.keyDown(box, { key: 'Escape' })

    await waitFor(() => expect(box).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(deleteZone).not.toHaveBeenCalled()
    expect(screen.getByText('待取消分區')).toBeVisible()
  })

  it('deletes after confirmation and shows a status notice', async () => {
    const client = createMockPlanningClient()
    await client.createZone(PROJECT, '待刪除分區')
    await openDelete(client, '待刪除分區')

    fireEvent.click(screen.getByRole('button', { name: '確認刪除' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      '已刪除分區「待刪除分區」。',
    )
    expect(screen.queryByText('待刪除分區', { selector: 'span' })).toBeNull()
    await expect(client.listProjectZones(PROJECT)).resolves.toEqual([])
  })

  it('explains that a zone used by a task cannot be deleted', async () => {
    const client = createMockPlanningClient()
    const zone = await client.createZone(PROJECT, '北區')
    const plan = await client.createPlan(PROJECT, { name: '引用分區' })
    const [item] = await client.listProjectItems(PROJECT)
    await client.createTask(plan.id, {
      name: '混凝土外觀',
      item_ids: [item.id],
      suggested_assignee_id: null,
      zone_id: zone.id,
      location_text: null,
    })
    await openDelete(client, '北區')

    fireEvent.click(screen.getByRole('button', { name: '確認刪除' }))

    const row = rowOf('北區')
    const box = within(row).getByRole('group', {
      name: '刪除分區「北區」？',
    })
    const alert = await within(box).findByRole('alert')
    expect(alert).toHaveTextContent('分區已有任務使用，無法刪除。')
    await waitFor(() => expect(alert).toHaveFocus())
    expect(within(row).getByText('北區')).toBeVisible()
    expect(within(row).getByRole('button', { name: '確認刪除' })).toBeVisible()
  })

  it('does not claim the page became read-only when a write returns 403', async () => {
    const client = createMockPlanningClient()
    await client.createZone(PROJECT, '北區')
    client.deleteZone = vi
      .fn()
      .mockRejectedValue(new ManagementApiError(403, 'permission.denied'))
    await openDelete(client, '北區')

    fireEvent.click(screen.getByRole('button', { name: '確認刪除' }))

    const row = rowOf('北區')
    const box = within(row).getByRole('group', {
      name: '刪除分區「北區」？',
    })
    const alert = await within(box).findByRole('alert')
    expect(alert).toHaveTextContent('你沒有權限變更這個專案的分區')
    expect(alert).not.toHaveTextContent('唯讀')
    await waitFor(() => expect(alert).toHaveFocus())
    expect(within(row).getByRole('button', { name: '確認刪除' })).toBeVisible()
  })

  it('does not claim read-only when adding a zone returns 403 either', async () => {
    const client = createMockPlanningClient()
    client.createZone = vi
      .fn()
      .mockRejectedValue(new ManagementApiError(403, 'permission.denied'))
    mount(client)
    await openAddForm()
    fireEvent.change(await screen.findByLabelText('分區名稱'), {
      target: { value: '北區' },
    })

    fireEvent.click(screen.getByRole('button', { name: '新增分區' }))

    const alert = await screen.findByRole('alert')
    expect(alert).not.toHaveTextContent('唯讀')
  })
})

describe('loading zones', () => {
  it('shows neither the empty message nor the add form when loading fails', async () => {
    const client = createMockPlanningClient()
    client.listProjectZones = vi
      .fn()
      .mockRejectedValue(new ManagementApiError(500, 'internal'))
    mount(client)

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.queryByText('尚未設定分區。')).toBeNull()
    expect(screen.queryByLabelText('分區名稱')).toBeNull()
    expect(screen.queryByRole('heading', { name: '新增分區' })).toBeNull()
  })

  it('explains a 403 when reading the zone list is denied', async () => {
    const client = createMockPlanningClient()
    client.listProjectZones = vi
      .fn()
      .mockRejectedValue(new ManagementApiError(403, 'permission.denied'))
    mount(client)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '你沒有讀取這個專案分區的權限。',
    )
    expect(screen.queryByLabelText('分區名稱')).toBeNull()
  })

  it('keeps a direct add route as an error view when list loading fails', async () => {
    const client = createMockPlanningClient()
    client.listProjectZones = vi
      .fn()
      .mockRejectedValue(new ManagementApiError(503, 'service.unavailable'))
    mount(client, MANAGE, `/projects/${PROJECT}/zones/new`)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('伺服器暫時無法處理')
    expect(screen.queryByRole('heading', { name: '無權限' })).toBeNull()
    expect(screen.queryByLabelText('分區名稱')).toBeNull()
    expect(screen.getByRole('button', { name: '重新載入' })).toBeVisible()
  })

  it('denies a direct add route when reading the zone list returns 403', async () => {
    const client = createMockPlanningClient()
    client.listProjectZones = vi
      .fn()
      .mockRejectedValue(new ManagementApiError(403, 'permission.denied'))
    mount(client, MANAGE, `/projects/${PROJECT}/zones/new`)

    expect(
      await screen.findByRole('heading', { name: '無權限', level: 2 }),
    ).toBeVisible()
    expect(screen.queryByLabelText('分區名稱')).toBeNull()
    expect(screen.queryByRole('button', { name: '重新載入' })).toBeNull()
  })

  it('offers a reload that recovers the list', async () => {
    const client = createMockPlanningClient()
    await client.createZone(PROJECT, '北區')
    const list = client.listProjectZones.bind(client)
    client.listProjectZones = vi
      .fn()
      .mockRejectedValueOnce(new ManagementApiError(500, 'internal'))
      .mockImplementation(list)
    mount(client)
    await screen.findByRole('alert')

    fireEvent.click(screen.getByRole('button', { name: '重新載入' }))

    expect(await screen.findByText('北區')).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('link', { name: '新增分區' })).toBeVisible()
  })

  it('hides the controls from a member who can only read', async () => {
    const client = createMockPlanningClient()
    await client.createZone(PROJECT, '北區')
    mount(client, ['project_zone.read'])

    expect(await screen.findByText('北區')).toBeVisible()
    expect(screen.queryByRole('link', { name: '新增分區' })).toBeNull()
    expect(screen.queryByRole('button', { name: '刪除' })).toBeNull()
    expect(screen.queryByRole('button', { name: '重新命名' })).toBeNull()
  })
})
