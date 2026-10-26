import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { Link, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { DataMemoryRouter } from '../../testing/DataMemoryRouter'
import PlanningPage from './PlanningPage'
import { CurrentUserProvider } from '../../auth/useCurrentUser'
import { currentUserFixture } from '../../testing/contractFixtures'
import { createMockPlanningClient } from './api.mock'

const projectId = 'project-demo-1'
const base = `/projects/${projectId}/planning`

function LocationProbe() {
  const location = useLocation()
  return (
    <output aria-label="目前網址">
      {location.pathname}
      {location.search}
    </output>
  )
}

async function seeded() {
  const client = createMockPlanningClient()
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
    expect(
      await screen.findByRole('button', { name: /橋梁計畫/ }),
    ).toBeVisible()
    expect(screen.queryByLabelText(/計畫名稱/)).toBeNull()
    expect(screen.queryByRole('heading', { name: /橋面查核/ })).toBeNull()
    await click(screen.getByRole('button', { name: /橋梁計畫/ }))
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
