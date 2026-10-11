import { fireEvent, render, screen, within } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ManagementApiError } from '../api'
import { createMockPlanningClient } from './api.mock'
import nameTooLong from './fixtures/name-too-long-422.json'
import ProjectZonesPage from './ProjectZonesPage'

afterEach(() => vi.unstubAllGlobals())

function validationError(fixture: {
  error: { code: string; fields: Array<{ path: string; code: string }> }
}) {
  const error = new ManagementApiError(422, fixture.error.code)
  error.fields = fixture.error.fields
  return error
}

function renderPage(viewerPermissions: string[]) {
  const client = createMockPlanningClient()
  render(
    <MemoryRouter initialEntries={['/admin/projects/project-demo-1/zones']}>
      <Routes>
        <Route
          element={
            <ProjectZonesPage
              client={client}
              viewerPermissions={viewerPermissions}
            />
          }
          path="/admin/projects/:projectId/zones"
        />
      </Routes>
    </MemoryRouter>,
  )
  return client
}

describe('project zones section', () => {
  it('lets members with manage permission add a project zone', async () => {
    const client = renderPage(['project_zone.read', 'project_zone.manage'])

    fireEvent.change(await screen.findByLabelText('分區名稱'), {
      target: { value: '北區' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增分區' }))

    expect(await screen.findByText('北區')).toBeVisible()
    expect(await screen.findByRole('status')).toHaveTextContent(
      '已新增分區「北區」。',
    )
    await expect(
      client.listProjectZones('project-demo-1'),
    ).resolves.toHaveLength(1)
  })

  it('shows zones without edit controls to read-only members', async () => {
    const client = createMockPlanningClient()
    await client.createZone('project-demo-1', '北區')
    render(
      <MemoryRouter initialEntries={['/admin/projects/project-demo-1/zones']}>
        <Routes>
          <Route
            element={
              <ProjectZonesPage
                client={client}
                viewerPermissions={['project_zone.read']}
              />
            }
            path="/admin/projects/:projectId/zones"
          />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('北區')).toBeVisible()
    expect(screen.queryByRole('button', { name: '新增分區' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '新增分區' })).toBeNull()
  })

  it('shows and focuses a field error when an empty zone form is submitted', async () => {
    const client = renderPage(['project_zone.read', 'project_zone.manage'])
    const input = await screen.findByLabelText('分區名稱')

    fireEvent.click(screen.getByRole('button', { name: '新增分區' }))

    expect(await screen.findByText('請輸入分區名稱。')).toBeVisible()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveFocus()
    await expect(client.listProjectZones('project-demo-1')).resolves.toEqual(
      [],
    )
  })

  it('clears an empty rename error when cancelled back to add mode', async () => {
    const client = createMockPlanningClient()
    await client.createZone('project-demo-1', '北區')
    render(
      <MemoryRouter initialEntries={['/admin/projects/project-demo-1/zones']}>
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
            path="/admin/projects/:projectId/zones"
          />
        </Routes>
      </MemoryRouter>,
    )

    const northRow = (await screen.findByText('北區')).closest('li')
    fireEvent.click(
      within(northRow as HTMLElement).getByRole('button', {
        name: '重新命名',
      }),
    )
    fireEvent.change(screen.getByLabelText('分區名稱'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存名稱' }))
    expect(await screen.findByText('請輸入分區名稱。')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.getByRole('heading', { name: '新增分區' })).toBeVisible()
    expect(screen.getByLabelText('分區名稱')).toHaveAttribute(
      'aria-invalid',
      'false',
    )
    expect(screen.queryByText('請輸入分區名稱。')).not.toBeInTheDocument()
  })

  it('maps the server zone-name 422 field beside the input and focuses it', async () => {
    const client = renderPage(['project_zone.read', 'project_zone.manage'])
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
    expect(input).toHaveFocus()
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
      <MemoryRouter initialEntries={['/admin/projects/project-demo-1/zones']}>
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
            path="/admin/projects/:projectId/zones"
          />
        </Routes>
      </MemoryRouter>,
    )
    const input = await screen.findByLabelText('分區名稱')
    fireEvent.change(input, { target: { value: '超出伺服器限制的分區名稱' } })
    fireEvent.click(screen.getByRole('button', { name: '新增分區' }))

    expect(await screen.findByText('輸入內容太長。')).toBeVisible()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveFocus()
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
      <MemoryRouter initialEntries={['/admin/projects/project-demo-1/zones']}>
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
            path="/admin/projects/:projectId/zones"
          />
        </Routes>
      </MemoryRouter>,
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
    fireEvent.click(
      within(southRow as HTMLElement).getByRole('button', {
        name: '重新命名',
      }),
    )

    expect(input).toHaveValue('南區')
    expect(input).toHaveAttribute('aria-invalid', 'false')
    expect(screen.queryByText('輸入內容太長。')).not.toBeInTheDocument()
  })

  it('guards a zone draft before links and refresh', async () => {
    const client = createMockPlanningClient()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <MemoryRouter initialEntries={['/admin/projects/project-demo-1/zones']}>
        <Routes>
          <Route
            element={
              <>
                <ProjectZonesPage
                  client={client}
                  viewerPermissions={[
                    'project_zone.read',
                    'project_zone.manage',
                  ]}
                />
                <Link to="/outside">切換頁面</Link>
              </>
            }
            path="/admin/projects/:projectId/zones"
          />
          <Route element={<p>已離開分區頁</p>} path="/outside" />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.change(await screen.findByLabelText('分區名稱'), {
      target: { value: '尚未儲存' },
    })
    const unload = new Event('beforeunload', {
      cancelable: true,
    }) as BeforeUnloadEvent
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)

    fireEvent.click(screen.getByRole('link', { name: '切換頁面' }))
    expect(screen.queryByText('已離開分區頁')).toBeNull()

    confirm.mockRestore()
  })
})
