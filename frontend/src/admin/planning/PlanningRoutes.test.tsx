import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { Link, useLocation, useNavigate } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { DataMemoryRouter } from '../../testing/DataMemoryRouter'
import PlanningPage from './PlanningPage'
import { deferred } from '../../testing/submitGuard'
import { ManagementApiError } from '../api'
import { CurrentUserProvider } from '../../auth/useCurrentUser'
import { currentUserFixture } from '../../testing/contractFixtures'
import { createMockPlanningClient } from './api.mock'

const projectId = 'project-demo-1'
const base = `/projects/${projectId}/planning`

function LocationProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <output aria-label="目前網址">
        {location.pathname}
        {location.search}
      </output>
      <output aria-label="路由狀態">{JSON.stringify(location.state)}</output>
      <button type="button" onClick={() => navigate(-1)}>
        上一頁
      </button>
      <button type="button" onClick={() => navigate(1)}>
        下一頁
      </button>
    </>
  )
}

async function seeded(completionReady = false) {
  const client = createMockPlanningClient({ completionReady })
  const plan = await client.createPlan(projectId, { name: '橋梁計畫' })
  const items = await client.listProjectItems(projectId)
  const task = await client.createTask(plan.id, {
    name: '橋面查核',
    item_ids: [items[0].id],
    zone_id: null,
    location_text: '北側',
    suggested_assignee_id: null,
  })
  return { client, plan, task }
}

function open(
  client: ReturnType<typeof createMockPlanningClient>,
  path: string,
  permissions?: string[],
  nextPath?: string,
) {
  return render(
    <DataMemoryRouter initialEntries={[path]}>
      <CurrentUserProvider
        value={{ user: currentUserFixture(), clear: () => {} }}
      >
        <PlanningPage
          client={client}
          initialProjectId={projectId}
          viewerPermissions={permissions}
        />
      </CurrentUserProvider>
      <LocationProbe />
      <Link to={base}>離開表單</Link>
      {nextPath && <Link to={nextPath}>切換到另一筆任務</Link>}
    </DataMemoryRouter>,
  )
}

async function click(element: Element) {
  await act(async () => {
    fireEvent.click(element)
  })
}

describe('IP-AC27～29：計畫與任務獨立網址', () => {
  it('separates list, plan detail, task detail and edit pages', async () => {
    const { client, plan, task } = await seeded()
    open(client, base)
    expect(await screen.findByRole('link', { name: /橋梁計畫/ })).toBeVisible()
    expect(screen.queryByLabelText(/計畫名稱/)).toBeNull()
    expect(screen.queryByRole('heading', { name: /橋面查核/ })).toBeNull()
    await click(screen.getByRole('link', { name: /橋梁計畫/ }))
    expect(screen.getByLabelText('目前網址')).toHaveTextContent(
      `${base}/${plan.id}`,
    )
    expect(screen.queryByRole('button', { name: '修改地點' })).toBeNull()
    await click(await screen.findByRole('link', { name: '橋面查核' }))
    expect(screen.getByLabelText('目前網址')).toHaveTextContent(
      `${base}/${plan.id}/tasks/${task.id}`,
    )
    expect(screen.queryByLabelText('補充地點')).toBeNull()
    await click(screen.getByRole('button', { name: '修改地點' }))
    expect(screen.getByLabelText('目前網址')).toHaveTextContent(
      '/edit?section=location',
    )
    const field = await screen.findByLabelText('補充地點')
    expect(field).toHaveValue('北側')
    fireEvent.change(field, { target: { value: '南側' } })
    await click(screen.getByRole('button', { name: '儲存地點' }))
    expect(await screen.findByText('已更新任務地點。')).toHaveAttribute(
      'role',
      'status',
    )
    expect(screen.getByLabelText('目前網址').textContent).not.toContain(
      '/edit',
    )
    expect(await screen.findByText('補充地點：南側')).toBeVisible()
  })

  it.each([
    ['new', '建立計畫'],
    ['plan/tasks/new', '新增任務'],
    ['plan/tasks/task/edit?section=location', '修改任務'],
    ['plan/tasks/task/edit?section=items', '修改任務'],
    ['plan/tasks/task/edit?section=assignee', '修改任務'],
  ])('rejects direct unauthorized form URL %s', async (suffix) => {
    const { client, plan, task } = await seeded()
    const resource = suffix
      .replace('plan', plan.id)
      .replace('task/edit', `${task.id}/edit`)
    const path = `${base}/${resource}`
    open(client, path, ['inspection_plan.read'])
    expect(
      await screen.findByRole('heading', { name: '無權限' }),
    ).toBeVisible()
    expect(document.querySelector('form')).toBeNull()
  })

  it.each(['location', 'assignee', 'items'])(
    'loads a direct edit URL after refresh: %s',
    async (section) => {
      const { client, plan, task } = await seeded()
      const path =
        `${base}/${plan.id}/tasks/${task.id}/edit` + `?section=${section}`
      const first = open(client, path)
      const selector = `[data-error-context="${section}"]`
      await waitFor(() =>
        expect(document.querySelector(selector)).not.toBeNull(),
      )
      first.unmount()
      open(client, path)
      await waitFor(() =>
        expect(document.querySelector(selector)).not.toBeNull(),
      )
      expect(screen.getByLabelText('目前網址')).toHaveTextContent(path)
      expect(
        screen.getByRole('link', { name: '返回任務詳情' }),
      ).toHaveAttribute('href', `${base}/${plan.id}/tasks/${task.id}`)
    },
  )

  it(
    'guards dirty navigation and clears the ' +
      'discarded draft when returning',
    async () => {
      const { client } = await seeded()
      open(client, `${base}/new`)
      const input = await screen.findByLabelText(/計畫名稱/)
      fireEvent.change(input, { target: { value: '尚未儲存' } })
      const unload = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(unload)
      expect(unload.defaultPrevented).toBe(true)
      await click(screen.getByRole('link', { name: '離開表單' }))
      const confirm = await screen.findByRole('group', {
        name: '有尚未儲存的變更',
      })
      await click(within(confirm).getByRole('button', { name: '保留編輯' }))
      expect(input).toHaveValue('尚未儲存')
      await click(screen.getByRole('link', { name: '返回計畫清單' }))
      await click(
        within(await screen.findByRole('group')).getByRole('button', {
          name: '捨棄變更',
        }),
      )
      await click(await screen.findByRole('link', { name: '建立計畫' }))
      expect(await screen.findByLabelText(/計畫名稱/)).toHaveValue('')
    },
  )

  it.each(['list', 'plan-new', 'plan', 'task-new', 'task'])(
    'restores the same resource page after refresh: %s',
    async (view) => {
      const { client, plan, task } = await seeded()
      const planPath = `${base}/${plan.id}`
      const path =
        view === 'list'
          ? base
          : view === 'plan-new'
            ? `${base}/new`
            : view === 'plan'
              ? planPath
              : view === 'task-new'
                ? `${planPath}/tasks/new`
                : `${planPath}/tasks/${task.id}`
      const heading =
        view === 'plan-new'
          ? '建立計畫'
          : view === 'task-new'
            ? '新增任務'
            : view === 'plan'
              ? '橋梁計畫'
              : view === 'task'
                ? /橋面查核/
                : '計畫與任務'
      const first = open(client, path)
      await screen.findByRole('heading', { name: heading, level: 2 })
      first.unmount()
      open(client, path)
      await screen.findByRole('heading', { name: heading, level: 2 })
      expect(screen.getByLabelText('目前網址')).toHaveTextContent(path)
      if (view === 'task') {
        expect(
          await screen.findByRole('heading', { name: /橋面查核/ }),
        ).toBeVisible()
      }
    },
  )

  it(
    'does not display a plan from another ' +
      'project or task from another plan',
    async () => {
      const { client, plan, task } = await seeded()
      const otherPlan = await client.createPlan(projectId, {
        name: '其他計畫',
      })
      const first = open(client, `${base}/${otherPlan.id}/tasks/${task.id}`)
      expect(
        await screen.findByRole('heading', { name: '找不到任務' }),
      ).toBeVisible()
      expect(screen.queryByRole('heading', { name: /橋面查核/ })).toBeNull()
      first.unmount()
      const foreignPlan = await client.createPlan('project-demo-2', {
        name: '外專案計畫',
      })
      open(client, `${base}/${foreignPlan.id}`)
      expect(
        await screen.findByRole('heading', { name: '找不到計畫' }),
      ).toBeVisible()
      expect(screen.queryByText('外專案計畫')).toBeNull()
      expect(plan.id).not.toBe(foreignPlan.id)
    },
  )

  it(
    'does not reveal forms for archived ' + 'plans or dispatched item edits',
    async () => {
      const { client, plan, task } = await seeded()
      await client.archivePlan(plan.id)
      const first = open(client, `${base}/${plan.id}/tasks/new`)
      expect(
        await screen.findByRole('heading', { name: '目前無法修改' }),
      ).toBeVisible()
      expect(document.querySelector('form')).toBeNull()
      expect(screen.getByRole('link', { name: '返回詳情' })).toHaveAttribute(
        'href',
        `${base}/${plan.id}`,
      )
      first.unmount()
      await client.unarchivePlan(plan.id)
      await client.dispatchTask(task.id)
      open(client, `${base}/${plan.id}/tasks/${task.id}/edit?section=items`)
      expect(
        await screen.findByRole('heading', { name: '目前無法修改' }),
      ).toBeVisible()
      expect(document.querySelector('form')).toBeNull()
    },
  )

  it('shows missing plan and task with a working parent link', async () => {
    const { client, plan } = await seeded()
    const first = open(client, `${base}/missing`)
    expect(
      await screen.findByRole('heading', { name: '找不到計畫' }),
    ).toBeVisible()
    first.unmount()
    open(client, `${base}/${plan.id}/tasks/missing`)
    expect(
      await screen.findByRole('heading', { name: '找不到任務' }),
    ).toBeVisible()
  })
})

describe('載入、重試與明細一致性', () => {
  it('explains why archived plans are read-only', async () => {
    const { client, plan } = await seeded()
    await client.archivePlan(plan.id)
    open(client, `${base}/${plan.id}`)
    expect(
      await screen.findByText(
        '計畫已封存。取消封存後才能新增、修改或派出任務。',
      ),
    ).toBeVisible()
  })

  it('explains why dispatched task items cannot be replaced', async () => {
    const { client, plan, task } = await seeded(true)
    await client.dispatchTask(task.id)
    open(client, `${base}/${plan.id}/tasks/${task.id}`)
    expect(
      await screen.findByText('任務已派出，不能更換查核項目'),
    ).toBeVisible()
  })

  it('retries project loading after a transient failure', async () => {
    const { client } = await seeded()
    const original = client.getProject.bind(client)
    client.getProject = vi
      .fn()
      .mockRejectedValueOnce(new ManagementApiError(503, 'unavailable'))
      .mockImplementation(original)
    open(client, base)
    expect(await screen.findByRole('alert')).toBeVisible()
    await click(screen.getByRole('button', { name: '重新載入' }))
    expect(await screen.findByRole('link', { name: /橋梁計畫/ })).toBeVisible()
    expect(client.getProject).toHaveBeenCalledTimes(2)
  })

  it('hides old detail and success until saved detail reloads', async () => {
    const { client, plan, task } = await seeded()
    const original = client.getPlan.bind(client)
    const before = await original(plan.id)
    const getProject = vi.spyOn(client, 'getProject')
    const gate = deferred()
    client.getPlan = vi
      .fn()
      .mockResolvedValueOnce(before)
      .mockImplementation(async (id: string) => {
        await gate.promise
        return original(id)
      })
    open(client, `${base}/${plan.id}/tasks/${task.id}/edit`)
    fireEvent.change(await screen.findByLabelText('補充地點'), {
      target: { value: '南側新地點' },
    })
    await click(screen.getByRole('button', { name: '儲存地點' }))
    expect(screen.getByText('載入中…')).toBeVisible()
    expect(screen.getByText('補充地點：北側')).not.toBeVisible()
    expect(screen.getByText('已更新任務地點。')).not.toBeVisible()
    await act(async () => gate.resolve())
    expect(await screen.findByText('補充地點：南側新地點')).toBeVisible()
    expect(screen.getByText('已更新任務地點。')).toBeVisible()
    expect(getProject).toHaveBeenCalledTimes(1)
  })

  it(
    'does not show an empty task list ' + 'while created detail reloads',
    async () => {
      const client = createMockPlanningClient()
      const plan = await client.createPlan(projectId, { name: '空計畫' })
      const original = client.getPlan.bind(client)
      const before = await original(plan.id)
      const gate = deferred()
      client.getPlan = vi
        .fn()
        .mockResolvedValueOnce(before)
        .mockImplementation(async (id: string) => {
          await gate.promise
          return original(id)
        })
      open(client, `${base}/${plan.id}/tasks/new`)
      await click(await screen.findByLabelText(/混凝土外觀/))
      fireEvent.change(screen.getByLabelText(/任務名稱/), {
        target: { value: '第一筆任務' },
      })
      await click(screen.getByRole('button', { name: '建立草稿任務' }))
      expect(screen.getByText('載入中…')).toBeVisible()
      expect(screen.queryByText('尚未建立任務。')).toBeNull()
      await act(async () => gate.resolve())
      expect(
        await screen.findByRole('heading', {
          name: /第一筆任務/,
          level: 2,
        }),
      ).toBeVisible()
    },
  )

  it(
    'keeps a created task loading until ' + 'delayed plan detail resolves',
    async () => {
      const { client, plan } = await seeded()
      const original = client.getPlan.bind(client)
      const before = await original(plan.id)
      const gate = deferred()
      client.getPlan = vi
        .fn()
        .mockResolvedValueOnce(before)
        .mockImplementation(async (id: string) => {
          await gate.promise
          return original(id)
        })
      open(client, `${base}/${plan.id}/tasks/new`)
      await click(await screen.findByLabelText(/混凝土外觀/))
      fireEvent.change(screen.getByLabelText(/任務名稱/), {
        target: { value: '延遲回應的新任務' },
      })
      await click(screen.getByRole('button', { name: '建立草稿任務' }))
      expect(screen.queryByRole('heading', { name: '找不到任務' })).toBeNull()
      expect(screen.getAllByText('載入中…').length).toBeGreaterThan(0)
      await act(async () => {
        gate.resolve()
      })
      expect(
        await screen.findByRole('heading', {
          name: /延遲回應的新任務/,
          level: 2,
        }),
      ).toBeVisible()
      await waitFor(() =>
        expect(
          screen.getByRole('heading', {
            name: /延遲回應的新任務/,
            level: 2,
          }),
        ).toHaveFocus(),
      )
    },
  )

  it('offers retry after plan detail loading fails', async () => {
    const { client, plan, task } = await seeded()
    const original = client.getPlan.bind(client)
    client.getPlan = vi
      .fn()
      .mockRejectedValueOnce(new ManagementApiError(503, 'unavailable'))
      .mockImplementation(original)
    open(client, `${base}/${plan.id}/tasks/${task.id}`)
    expect(await screen.findByRole('alert')).toBeVisible()
    await click(screen.getByRole('button', { name: '重新載入' }))
    expect(
      await screen.findByRole('heading', {
        name: /橋面查核/,
        level: 2,
      }),
    ).toBeVisible()
    expect(client.getPlan).toHaveBeenCalledTimes(2)
  })

  it('offers retry beside page-level list loading errors', async () => {
    const { client } = await seeded()
    const original = client.listPlans.bind(client)
    client.listPlans = vi
      .fn()
      .mockRejectedValueOnce(new ManagementApiError(503, 'unavailable'))
      .mockImplementation(original)
    open(client, base)
    expect(await screen.findByRole('alert')).toBeVisible()
    await click(screen.getByRole('button', { name: '重新載入' }))
    expect(await screen.findByRole('link', { name: /橋梁計畫/ })).toBeVisible()
    expect(client.listPlans).toHaveBeenCalledTimes(2)
  })
})

describe('網址、返回與草稿邊界', () => {
  it.each(['', '?section=invalid', '?section=', '/'])(
    'uses the location editor for default, invalid or trailing edit URL %s',
    async (suffix) => {
      const { client, plan, task } = await seeded()
      open(client, `${base}/${plan.id}/tasks/${task.id}/edit${suffix}`)
      expect(await screen.findByLabelText('補充地點')).toHaveValue('北側')
      expect(
        screen.getByRole('heading', {
          name: '修改地點｜橋面查核',
          level: 2,
        }),
      ).toBeVisible()
    },
  )

  it.each(['new/tasks/x', 'plan/tasks/new/edit', 'plan/other/task'])(
    'rejects malformed planning fragment %s before requesting detail',
    async (suffix) => {
      const { client, plan } = await seeded()
      const getPlan = vi.spyOn(client, 'getPlan')
      open(client, `${base}/${suffix.replace('plan', plan.id)}`)
      expect(
        screen.getByRole('heading', { name: '找不到這個頁面' }),
      ).toBeVisible()
      expect(getPlan).not.toHaveBeenCalled()
      expect(document.querySelector('form')).toBeNull()
    },
  )

  it(
    'rejects assign editing for a ' + 'manage-only member and returns to list',
    async () => {
      const { client, plan, task } = await seeded()
      open(
        client,
        `${base}/${plan.id}/tasks/${task.id}/edit?section=assignee`,
        ['inspection_plan.read', 'inspection_task.manage'],
      )
      expect(
        await screen.findByRole('heading', { name: '無權限' }),
      ).toBeVisible()
      expect(document.querySelector('form')).toBeNull()
      const back = screen.getByRole('link', { name: '返回計畫清單' })
      expect(back).toHaveClass('btn')
      expect(back).toHaveAttribute('href', base)
      await click(back)
      expect(
        await screen.findByRole('link', { name: /橋梁計畫/ }),
      ).toBeVisible()
    },
  )

  it(
    'returns denied direct forms to the plan list ' + 'after detail 403',
    async () => {
      const { client, plan, task } = await seeded()
      client.getPlan = vi
        .fn()
        .mockRejectedValue(new ManagementApiError(403, 'permission.denied'))
      open(client, `${base}/${plan.id}/tasks/${task.id}/edit`)
      expect(
        await screen.findByRole('heading', { name: '無權限' }),
      ).toBeVisible()
      expect(document.querySelector('form')).toBeNull()
      const back = screen.getByRole('link', { name: '返回計畫清單' })
      expect(back).toHaveClass('btn')
      expect(back).toHaveAttribute('href', base)
    },
  )

  it.each(['location', 'items', 'assignee'])(
    'rejects completed task direct editing: %s',
    async (section) => {
      const { client, plan, task } = await seeded(true)
      await client.dispatchTask(task.id)
      await client.startTask(task.id)
      await client.completeTask(task.id)
      const path =
        `${base}/${plan.id}/tasks/${task.id}/edit` + `?section=${section}`
      open(client, path)
      expect(
        await screen.findByRole('heading', { name: '目前無法修改' }),
      ).toBeVisible()
      expect(document.querySelector('form')).toBeNull()
      expect(screen.getByRole('link', { name: '返回詳情' })).toHaveClass('btn')
    },
  )

  it(
    'resets a discarded A draft when the ' + 'same instance changes to task B',
    async () => {
      const { client, plan, task } = await seeded()
      const item = (await client.listProjectItems(projectId))[0]
      const taskB = await client.createTask(plan.id, {
        name: '另一筆任務',
        item_ids: [item.id],
        zone_id: null,
        location_text: '南側',
        suggested_assignee_id: null,
      })
      const prefix = `${base}/${plan.id}/tasks/`
      open(
        client,
        `${prefix}${task.id}/edit?section=location`,
        undefined,
        `${prefix}${taskB.id}/edit?section=location`,
      )
      const input = await screen.findByLabelText('補充地點')
      fireEvent.change(input, { target: { value: 'A 未儲存' } })
      await click(screen.getByRole('link', { name: '切換到另一筆任務' }))
      const prompt = await screen.findByRole('group', {
        name: '有尚未儲存的變更',
      })
      expect(input).toHaveValue('A 未儲存')
      await click(within(prompt).getByRole('button', { name: '捨棄變更' }))
      await screen.findByRole('heading', { name: '修改地點｜另一筆任務' })
      expect(await screen.findByLabelText('補充地點')).toHaveValue('南側')
      expect(screen.queryByDisplayValue('A 未儲存')).toBeNull()
    },
  )

  it(
    'clears only plan-detail denial when ' + 'navigating to a new task URL',
    async () => {
      const { client, plan, task } = await seeded()
      const original = client.getPlan.bind(client)
      client.getPlan = vi
        .fn()
        .mockRejectedValueOnce(
          new ManagementApiError(403, 'permission.denied'),
        )
        .mockImplementation(original)
      const prefix = `${base}/${plan.id}/tasks/${task.id}`
      open(client, prefix, undefined, `${prefix}/edit?section=location`)
      expect(
        await screen.findByRole('heading', { name: '無權限' }),
      ).toBeVisible()
      await click(screen.getByRole('link', { name: '切換到另一筆任務' }))
      expect(await screen.findByLabelText('補充地點')).toHaveValue('北側')
    },
  )

  it(
    'replaces saved edit entries and consumes ' +
      'success state before back/forward',
    async () => {
      const { client, plan } = await seeded()
      open(client, `${base}/${plan.id}`)
      await click(await screen.findByRole('link', { name: '橋面查核' }))
      await click(screen.getByRole('button', { name: '修改地點' }))
      fireEvent.change(await screen.findByLabelText('補充地點'), {
        target: { value: '東側' },
      })
      await click(screen.getByRole('button', { name: '儲存地點' }))
      expect(await screen.findByText('已更新任務地點。')).toHaveClass('notice')
      await waitFor(() =>
        expect(screen.getByLabelText('路由狀態')).toHaveTextContent('null'),
      )
      await click(screen.getByRole('button', { name: '上一頁' }))
      expect(
        await screen.findByRole('heading', { name: /橋面查核/, level: 2 }),
      ).toBeVisible()
      expect(screen.queryByLabelText('補充地點')).toBeNull()
      expect(screen.queryByText('已更新任務地點。')).toBeNull()
      await click(screen.getByRole('button', { name: '下一頁' }))
      expect(screen.queryByText('已更新任務地點。')).toBeNull()
      expect(screen.queryByLabelText('補充地點')).toBeNull()
    },
  )

  it(
    'creates a plan directly into detail ' +
      'with one primary new-task action',
    async () => {
      const { client } = await seeded()
      open(client, base)
      await click(await screen.findByRole('link', { name: '建立計畫' }))
      const form = document.querySelector('form')!
      expect(
        within(form)
          .getAllByRole('button')
          .map((b) => b.textContent?.trim()),
      ).toEqual(['取消', '建立計畫'])
      fireEvent.change(screen.getByLabelText(/計畫名稱/), {
        target: { value: '新計畫' },
      })
      await click(screen.getByRole('button', { name: '建立計畫' }))
      expect(
        await screen.findByRole('heading', { name: '新計畫', level: 2 }),
      ).toBeVisible()
      expect(screen.getByText('已建立計畫，接著新增任務。')).toHaveAttribute(
        'role',
        'status',
      )
      expect(screen.getByRole('button', { name: '＋ 新增任務' })).toHaveClass(
        'btn-primary',
      )
      expect(document.querySelectorAll('.btn-primary')).toHaveLength(1)
      await waitFor(() =>
        expect(screen.getByLabelText('路由狀態')).toHaveTextContent('null'),
      )
      await click(screen.getByRole('button', { name: '上一頁' }))
      expect(await screen.findByRole('link', { name: /新計畫/ })).toBeVisible()
      expect(screen.queryByLabelText(/計畫名稱/)).toBeNull()
      expect(screen.queryByText('已建立計畫，接著新增任務。')).toBeNull()
    },
  )

  it(
    'guards plan-new cancel and ' + 'discards only after confirmation',
    async () => {
      const { client } = await seeded()
      open(client, `${base}/new`)
      fireEvent.change(await screen.findByLabelText(/計畫名稱/), {
        target: { value: '未儲存' },
      })
      await click(screen.getByRole('button', { name: '取消' }))
      const prompt = await screen.findByRole('group', {
        name: '有尚未儲存的變更',
      })
      await click(within(prompt).getByRole('button', { name: '保留編輯' }))
      expect(screen.getByLabelText(/計畫名稱/)).toHaveValue('未儲存')
      await click(screen.getByRole('button', { name: '取消' }))
      await click(screen.getByRole('button', { name: '捨棄變更' }))
      expect(
        await screen.findByRole('link', { name: /橋梁計畫/ }),
      ).toBeVisible()
      expect(screen.queryByLabelText(/計畫名稱/)).toBeNull()
    },
  )
})

describe('動作與表單一致性', () => {
  it.each([
    ['new-task', '建立草稿任務'],
    ['location', '儲存地點'],
    ['assignee', '指定建議指派人'],
    ['items', '儲存查核項目'],
    ['name', '儲存名稱'],
    ['plan-name', '儲存計畫名稱'],
  ])('puts cancel before the primary submit: %s', async (kind, submit) => {
    const { client, plan, task } = await seeded()
    const prefix = `${base}/${plan.id}`
    const taskPath = `${prefix}/tasks/${task.id}`
    const path =
      kind === 'new-task'
        ? `${prefix}/tasks/new`
        : kind === 'name'
          ? taskPath
          : kind === 'plan-name'
            ? prefix
            : `${taskPath}/edit?section=${kind}`
    open(client, path)
    if (kind === 'name' || kind === 'plan-name') {
      await click(
        await screen.findByRole('button', {
          name: kind === 'name' ? '修改名稱' : '修改計畫名稱',
        }),
      )
    }
    const button = await screen.findByRole('button', { name: submit })
    const form = button.closest('form')!
    const buttons = within(form)
      .getAllByRole('button')
      .map((b) => b.textContent?.trim())
    expect(buttons).toEqual(['取消', submit])
    expect(document.querySelectorAll('.btn-primary')).toHaveLength(1)
  })

  it(
    'orders dispatch, three edits, rename, ' +
      'and the separate danger action',
    async () => {
      const { client, plan, task } = await seeded()
      open(client, `${base}/${plan.id}/tasks/${task.id}`)
      await screen.findByRole('heading', { name: /橋面查核/, level: 2 })
      const actions = document.querySelector('.planning-task-actions')!
      const buttons = within(actions as HTMLElement).getAllByRole('button')
      expect(buttons.map((b) => b.textContent?.trim())).toEqual([
        '派出任務',
        '修改地點',
        '修改查核項目',
        '修改名稱',
        '刪除草稿',
      ])
      expect(buttons[0]).toHaveClass('btn-primary')
      expect(buttons[4]).toHaveClass('btn-danger-outline')
      expect(buttons[4]).not.toHaveClass('btn-danger')
      expect(buttons[4].parentElement).toHaveClass('planning-task-delete')
    },
  )

  it(
    'uses outline danger triggers ' + 'and solid delete confirmation',
    async () => {
      const { client, plan, task } = await seeded()
      open(client, `${base}/${plan.id}/tasks/${task.id}`)
      const trigger = await screen.findByRole('button', {
        name: '刪除草稿',
      })
      expect(trigger).toHaveClass('btn-danger-outline')
      expect(trigger).not.toHaveClass('btn-danger')
      await click(trigger)
      expect(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: '確認刪除',
        }),
      ).toHaveClass('btn-danger')
    },
  )

  it(
    'uses an outline archive trigger ' + 'and solid archive confirmation',
    async () => {
      const { client, plan } = await seeded()
      open(client, `${base}/${plan.id}`)
      const trigger = await screen.findByRole('button', {
        name: '封存計畫',
      })
      expect(trigger).toHaveClass('btn-danger-outline')
      await click(trigger)
      expect(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: '確認封存',
        }),
      ).toHaveClass('btn-danger')
    },
  )

  it(
    'uses an outline cancel trigger ' + 'and solid task confirmation',
    async () => {
      const { client, plan, task } = await seeded(true)
      await client.dispatchTask(task.id)
      open(client, `${base}/${plan.id}/tasks/${task.id}`)
      const trigger = await screen.findByRole('button', {
        name: '取消任務',
      })
      expect(trigger).toHaveClass('btn-danger-outline')
      await click(trigger)
      expect(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: '取消任務',
        }),
      ).toHaveClass('btn-danger')
    },
  )

  it('explains the assignment blocker to a dispatch-only member', async () => {
    const { client, plan, task } = await seeded()
    open(client, `${base}/${plan.id}/tasks/${task.id}`, [
      'inspection_plan.read',
      'inspection_task.dispatch',
    ])
    expect(await screen.findByText('請洽有指派權限的專案管理者')).toBeVisible()
    expect(screen.queryByRole('button', { name: '指定建議指派人' })).toBeNull()
  })
})
