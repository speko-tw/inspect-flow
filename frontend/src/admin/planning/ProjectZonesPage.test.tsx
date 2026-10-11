import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { deferred, expectImeEnterIgnored } from '../../testing/submitGuard'
import { ManagementApiError } from '../api'
import type { PlanningClient } from './api'
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

  it('asks in the page before a link discards a zone draft', async () => {
    const client = createMockPlanningClient()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <MemoryRouter initialEntries={['/admin/projects/project-demo-1/zones']}>
        <Routes>
          <Route
            element={
              <>
                <ProjectZonesPage client={client} viewerPermissions={MANAGE} />
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

function mount(client: PlanningClient, permissions = MANAGE) {
  render(
    <MemoryRouter initialEntries={[`/admin/projects/${PROJECT}/zones`]}>
      <Routes>
        <Route
          element={
            <ProjectZonesPage
              client={client}
              viewerPermissions={permissions}
            />
          }
          path="/admin/projects/:projectId/zones"
        />
      </Routes>
    </MemoryRouter>,
  )
}

function rowOf(name: string) {
  return screen.getByText(name).closest('li') as HTMLElement
}

describe('adding and renaming zones', () => {
  it('cancels a typed new zone with Escape', async () => {
    mount(createMockPlanningClient())
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

    fireEvent.click(
      within(rowOf('北區')).getByRole('button', { name: '重新命名' }),
    )
    const input = screen.getByLabelText('分區名稱')
    expect(input).toHaveFocus()
    fireEvent.change(input, { target: { value: '北側' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByRole('status')).toHaveTextContent(
      '已將分區改名為「北側」。',
    )
    expect(screen.getByText('北側')).toBeVisible()

    const trigger = within(rowOf('北側')).getByRole('button', {
      name: '重新命名',
    })
    fireEvent.click(trigger)
    fireEvent.change(screen.getByLabelText('分區名稱'), {
      target: { value: '取消的名稱' },
    })
    fireEvent.keyDown(screen.getByLabelText('分區名稱'), { key: 'Escape' })

    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByText('取消的名稱')).toBeNull()
    expect(screen.getByRole('heading', { name: '新增分區' })).toBeVisible()
  })

  it('sends one create request when Enter is pressed twice quickly (#490)', async () => {
    const client = createMockPlanningClient()
    const { gate, spy } = hold(client, 'createZone')
    mount(client)
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
    expect(input).toHaveValue('')
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
    const input = await screen.findByLabelText('分區名稱')
    fireEvent.change(input, { target: { value: '北區' } })

    fireEvent.click(screen.getByRole('button', { name: '新增分區' }))

    expect(
      await screen.findByText('同一專案已有相同名稱的分區。'),
    ).toHaveClass('tpl-field-error')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute(
      'aria-describedby',
      'project-zone-name-error',
    )
    expect(input).toHaveFocus()
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
    expect(input).toHaveFocus()
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
    expect(within(box).getByRole('button', { name: '取消' })).toHaveFocus()
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
    expect(trigger).toHaveFocus()
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
      item_ids: [item.id],
      suggested_assignee_id: null,
      zone_id: zone.id,
      location_text: null,
    })
    await openDelete(client, '北區')

    fireEvent.click(screen.getByRole('button', { name: '確認刪除' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '分區已有任務使用，無法刪除。',
    )
    expect(screen.queryByRole('group')).toBeNull()
    expect(screen.getByText('北區')).toBeVisible()
  })

  it('does not claim the page became read-only when a write returns 403', async () => {
    const client = createMockPlanningClient()
    await client.createZone(PROJECT, '北區')
    client.deleteZone = vi
      .fn()
      .mockRejectedValue(new ManagementApiError(403, 'permission.denied'))
    await openDelete(client, '北區')

    fireEvent.click(screen.getByRole('button', { name: '確認刪除' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('你沒有權限變更這個專案的分區')
    expect(alert).not.toHaveTextContent('唯讀')
  })

  it('does not claim read-only when adding a zone returns 403 either', async () => {
    const client = createMockPlanningClient()
    client.createZone = vi
      .fn()
      .mockRejectedValue(new ManagementApiError(403, 'permission.denied'))
    mount(client)
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
    expect(screen.getByLabelText('分區名稱')).toBeVisible()
  })

  it('hides the controls from a member who can only read', async () => {
    const client = createMockPlanningClient()
    await client.createZone(PROJECT, '北區')
    mount(client, ['project_zone.read'])

    expect(await screen.findByText('北區')).toBeVisible()
    expect(screen.queryByRole('button', { name: '刪除' })).toBeNull()
    expect(screen.queryByRole('button', { name: '重新命名' })).toBeNull()
  })
})
