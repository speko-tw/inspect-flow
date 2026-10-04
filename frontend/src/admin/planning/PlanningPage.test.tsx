import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PlanningApiError } from './api'
import { createMockPlanningClient } from './api.mock'
import PlanningPage from './PlanningPage'

describe('planning management page', () => {
  it(
    'manages zones, plans, multi-item tasks, dispatch, cancel, ' +
      'and restore',
    async () => {
      const client = createMockPlanningClient()
      render(<PlanningPage client={client} />)

      await screen.findByRole('heading', { name: '專案分區' })
      fireEvent.change(screen.getByLabelText('分區名稱'), {
        target: { value: '北區' },
      })
      fireEvent.click(screen.getByRole('button', { name: '新增分區' }))
      await screen.findByText('北區')

      fireEvent.change(screen.getByLabelText('計畫名稱'), {
        target: { value: '橋梁查核' },
      })
      fireEvent.click(screen.getByRole('button', { name: '建立計畫' }))
      const planButton = await screen.findByRole('button', {
        name: '橋梁查核（草稿）',
      })
      fireEvent.click(planButton)

      fireEvent.click(await screen.findByLabelText(/混凝土外觀/))
      fireEvent.click(await screen.findByLabelText(/鋼筋保護層/))
      fireEvent.change(screen.getByLabelText('任務分區'), {
        target: {
          value: (await client.listProjectZones('project-demo-1'))[0].id,
        },
      })
      fireEvent.change(screen.getByLabelText('補充地點'), {
        target: { value: '東側二樓' },
      })
      fireEvent.change(screen.getByLabelText('建議指派人'), {
        target: { value: 'project-a-member-1' },
      })
      fireEvent.click(screen.getByRole('button', { name: '建立草稿任務' }))

      const taskHeading = await screen.findByRole('heading', {
        name: /混凝土外觀、鋼筋保護層\s+（草稿）/,
      })
      const taskArticle = taskHeading.closest('article')
      expect(taskArticle).not.toBeNull()
      expect(
        within(taskArticle as HTMLElement).getByText('分區：北區'),
      ).toBeInTheDocument()
      expect(
        within(taskArticle as HTMLElement).getByText('補充地點：東側二樓'),
      ).toBeInTheDocument()
      expect(
        within(taskArticle as HTMLElement).getByText('建議指派：現場人員甲'),
      ).toBeInTheDocument()

      fireEvent.click(
        within(taskArticle as HTMLElement).getByRole('button', {
          name: '修改地點',
        }),
      )
      fireEvent.change(
        within(taskArticle as HTMLElement).getByLabelText('補充地點'),
        { target: { value: '東側三樓' } },
      )
      fireEvent.click(
        within(taskArticle as HTMLElement).getByRole('button', {
          name: '儲存地點',
        }),
      )
      const locatedTask = await screen.findByText('補充地點：東側三樓')
      const taskWithLocation = locatedTask.closest('article') as HTMLElement

      fireEvent.click(
        within(taskWithLocation).getByRole('button', {
          name: '派出任務',
        }),
      )
      fireEvent.click(screen.getByRole('button', { name: '確認' }))
      await screen.findByRole('heading', {
        name: /混凝土外觀、鋼筋保護層\s+（待開始）/,
      })

      const refreshedTask = screen
        .getByRole('heading', {
          name: /混凝土外觀、鋼筋保護層\s+（待開始）/,
        })
        .closest('article') as HTMLElement
      fireEvent.click(
        within(refreshedTask).getByRole('button', {
          name: '取消任務',
        }),
      )
      const cancelDialog = screen.getByRole('dialog')
      expect(cancelDialog).toHaveAttribute('aria-modal', 'true')
      expect(document.activeElement).toBe(
        within(cancelDialog).getByRole('heading', { name: '取消任務' }),
      )
      fireEvent.change(screen.getByLabelText('取消原因'), {
        target: { value: '現場順序調整' },
      })
      fireEvent.click(screen.getByRole('button', { name: '確認取消' }))
      await screen.findByText('取消原因：現場順序調整')

      const cancelledTask = screen
        .getByRole('heading', {
          name: /混凝土外觀、鋼筋保護層\s+（已取消）/,
        })
        .closest('article') as HTMLElement
      fireEvent.click(
        within(cancelledTask).getByRole('button', {
          name: '恢復任務',
        }),
      )
      fireEvent.click(screen.getByRole('button', { name: '確認' }))
      await screen.findByRole('heading', {
        name: /混凝土外觀、鋼筋保護層\s+（待開始）/,
      })
    },
    15_000,
  )

  it('switches to read-only after a write returns 403', async () => {
    const client = createMockPlanningClient()
    client.createPlan = async () => {
      throw new PlanningApiError(403, 'permission.denied')
    }
    render(<PlanningPage client={client} />)

    await screen.findByRole('heading', { name: '查核計畫' })
    fireEvent.change(screen.getByLabelText('計畫名稱'), {
      target: { value: '拒絕的計畫' },
    })
    fireEvent.click(screen.getByRole('button', { name: '建立計畫' }))

    expect(await screen.findByRole('status')).toHaveTextContent('唯讀模式')
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '建立計畫' })).toBeNull()
    })
    fireEvent.change(screen.getByLabelText('專案'), {
      target: { value: 'project-demo-2' },
    })
    await screen.findByRole('heading', { name: '專案分區' })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows a permission page when planning reads return 403', async () => {
    const client = createMockPlanningClient()
    client.listProjects = async () => {
      throw new PlanningApiError(403, 'permission.denied')
    }
    render(<PlanningPage client={client} />)

    expect(
      await screen.findByRole('heading', { name: '無權限' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      '沒有這個專案的查核計畫讀取權限',
    )
  })

  it('deletes draft tasks through a confirmation dialog', async () => {
    const client = createMockPlanningClient()
    render(<PlanningPage client={client} />)
    await screen.findByRole('heading', { name: '專案分區' })
    fireEvent.change(screen.getByLabelText('計畫名稱'), {
      target: { value: '草稿刪除' },
    })
    fireEvent.click(screen.getByRole('button', { name: '建立計畫' }))
    fireEvent.click(
      await screen.findByRole('button', { name: '草稿刪除（草稿）' }),
    )
    fireEvent.click(await screen.findByLabelText(/混凝土外觀/))
    fireEvent.click(screen.getByRole('button', { name: '建立草稿任務' }))
    const task = await screen.findByRole('heading', {
      name: /混凝土外觀\s+（草稿）/,
    })
    const article = task.closest('article') as HTMLElement
    fireEvent.click(within(article).getByRole('button', { name: '刪除草稿' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(document.activeElement).toBe(
      within(dialog).getByRole('heading', { name: '請確認操作' }),
    )
    fireEvent.click(within(dialog).getByRole('button', { name: '確認' }))
    expect(await screen.findByText('尚未建立任務。')).toBeInTheDocument()
  })

  it('hides task actions on archived plans and restores them on unarchive', async () => {
    const client = createMockPlanningClient()
    const plan = await client.createPlan('project-demo-1', {
      name: '封存驗收',
    })
    const [item] = await client.listProjectItems('project-demo-1')
    const task = await client.createTask(plan.id, {
      item_ids: [item.id],
      suggested_assignee_id: null,
      zone_id: null,
      location_text: null,
    })
    await client.dispatchTask(task.id)
    render(<PlanningPage client={client} />)
    fireEvent.click(
      await screen.findByRole('button', { name: '封存驗收（進行中）' }),
    )
    const article = (
      await screen.findByRole('heading', {
        name: /混凝土外觀\s+（待開始）/,
      })
    ).closest('article') as HTMLElement
    fireEvent.click(screen.getByRole('button', { name: '封存計畫' }))
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '確認' }),
    )
    await screen.findByText('計畫狀態：已封存')
    expect(
      within(article).queryByRole('button', { name: '修改地點' }),
    ).toBeNull()
    expect(
      within(article).queryByRole('button', { name: '取消任務' }),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '取消封存' }))
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '確認' }),
    )
    expect(
      await within(article).findByRole('button', { name: '修改地點' }),
    ).toBeInTheDocument()
  })

  it('clears project A data when project B loading fails', async () => {
    const client = createMockPlanningClient()
    const listProjectZones = client.listProjectZones.bind(client)
    client.listProjectZones = async (projectId) => {
      if (projectId === 'project-demo-2') {
        throw new PlanningApiError(503, 'project_zone.unavailable')
      }
      return listProjectZones(projectId)
    }
    render(<PlanningPage client={client} />)

    await screen.findByRole('heading', { name: '專案分區' })
    fireEvent.change(screen.getByLabelText('分區名稱'), {
      target: { value: 'A 專用分區' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增分區' }))
    await screen.findByText('A 專用分區')

    fireEvent.change(screen.getByLabelText('計畫名稱'), {
      target: { value: 'A 專用計畫' },
    })
    fireEvent.click(screen.getByRole('button', { name: '建立計畫' }))
    await screen.findByRole('button', { name: 'A 專用計畫（草稿）' })

    fireEvent.change(screen.getByLabelText('專案'), {
      target: { value: 'project-demo-2' },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '目前無法完成操作',
    )
    expect(
      screen.queryByRole('button', { name: 'A 專用計畫（草稿）' }),
    ).toBeNull()
    expect(screen.queryByText('A 專用分區')).toBeNull()
    expect(screen.queryByLabelText(/混凝土外觀/)).toBeNull()
  })

  it(
    'discards a project-bound confirmation when switching ' + 'projects',
    async () => {
      const client = createMockPlanningClient()
      const deleteZone = vi.spyOn(client, 'deleteZone')
      render(<PlanningPage client={client} />)

      await screen.findByRole('heading', { name: '專案分區' })
      fireEvent.change(screen.getByLabelText('分區名稱'), {
        target: { value: '待刪除分區' },
      })
      fireEvent.click(screen.getByRole('button', { name: '新增分區' }))
      const zoneText = await screen.findByText('待刪除分區')
      fireEvent.click(
        within(zoneText.parentElement as HTMLElement).getByRole('button', {
          name: '刪除',
        }),
      )
      expect(screen.getByText('刪除分區「待刪除分區」？')).toBeInTheDocument()

      fireEvent.change(screen.getByLabelText('專案'), {
        target: { value: 'project-demo-2' },
      })
      await screen.findByRole('heading', { name: '查核計畫' })
      expect(screen.queryByText('刪除分區「待刪除分區」？')).toBeNull()
      expect(deleteZone).not.toHaveBeenCalled()
    },
  )

  it('offers members returned for the selected project', async () => {
    const client = createMockPlanningClient()
    render(<PlanningPage client={client} />)

    await screen.findByRole('heading', { name: '專案分區' })
    fireEvent.change(screen.getByLabelText('專案'), {
      target: { value: 'project-demo-2' },
    })
    await screen.findByRole('heading', { name: '查核計畫' })
    fireEvent.change(screen.getByLabelText('計畫名稱'), {
      target: { value: 'B 專案計畫' },
    })
    fireEvent.click(screen.getByRole('button', { name: '建立計畫' }))
    const planButton = await screen.findByRole('button', {
      name: 'B 專案計畫（草稿）',
    })
    fireEvent.click(planButton)

    fireEvent.click(await screen.findByLabelText(/材料進場查驗/))
    fireEvent.change(screen.getByLabelText('建議指派人'), {
      target: { value: 'project-b-member-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '建立草稿任務' }))
    await screen.findByText('建議指派：專案 B 現場人員')
  })

  it('renames zones and explains when an in-use zone cannot be deleted', async () => {
    const client = createMockPlanningClient()
    render(<PlanningPage client={client} />)
    await screen.findByRole('heading', { name: '專案分區' })
    fireEvent.change(screen.getByLabelText('分區名稱'), {
      target: { value: '北區' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增分區' }))
    const zone = await screen.findByText('北區')
    fireEvent.click(
      within(zone.parentElement as HTMLElement).getByRole('button', {
        name: '改名',
      }),
    )
    fireEvent.change(screen.getByLabelText('分區名稱'), {
      target: { value: '北側' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存名稱' }))
    const renamed = await screen.findByText('北側')

    fireEvent.change(screen.getByLabelText('計畫名稱'), {
      target: { value: '分區引用' },
    })
    fireEvent.click(screen.getByRole('button', { name: '建立計畫' }))
    fireEvent.click(
      await screen.findByRole('button', { name: '分區引用（草稿）' }),
    )
    fireEvent.click(await screen.findByLabelText(/混凝土外觀/))
    fireEvent.change(screen.getByLabelText('任務分區'), {
      target: {
        value: (await client.listProjectZones('project-demo-1'))[0].id,
      },
    })
    fireEvent.click(screen.getByRole('button', { name: '建立草稿任務' }))
    await screen.findByRole('heading', { name: /混凝土外觀\s+（草稿）/ })
    fireEvent.click(
      within(renamed.parentElement as HTMLElement).getByRole('button', {
        name: '刪除',
      }),
    )
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '確認' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '分區已有任務使用，無法刪除。',
    )
  })

  it('does not show a zone selector for projects without zones', async () => {
    const client = createMockPlanningClient()
    render(<PlanningPage client={client} />)
    await screen.findByRole('heading', { name: '專案分區' })
    fireEvent.change(screen.getByLabelText('專案'), {
      target: { value: 'project-demo-2' },
    })
    fireEvent.change(screen.getByLabelText('計畫名稱'), {
      target: { value: '無分區計畫' },
    })
    fireEvent.click(screen.getByRole('button', { name: '建立計畫' }))
    fireEvent.click(
      await screen.findByRole('button', { name: '無分區計畫（草稿）' }),
    )
    await screen.findByLabelText(/材料進場查驗/)
    expect(screen.queryByLabelText('任務分區')).toBeNull()
  })

  it('hides location editing for completed and cancelled tasks', async () => {
    const client = createMockPlanningClient({ completionReady: true })
    const plan = await client.createPlan('project-demo-1', {
      name: '唯讀狀態',
    })
    const [item] = await client.listProjectItems('project-demo-1')
    const completed = await client.createTask(plan.id, {
      item_ids: [item.id],
      suggested_assignee_id: null,
      zone_id: null,
      location_text: null,
    })
    await client.dispatchTask(completed.id)
    await client.startTask(completed.id)
    await client.completeTask(completed.id)
    const cancelled = await client.createTask(plan.id, {
      item_ids: [item.id],
      suggested_assignee_id: null,
      zone_id: null,
      location_text: null,
    })
    await client.dispatchTask(cancelled.id)
    await client.cancelTask(cancelled.id, '取消驗收')
    render(<PlanningPage client={client} />)
    fireEvent.click(
      await screen.findByRole('button', { name: '唯讀狀態（已完成）' }),
    )
    await screen.findByRole('heading', { name: /已完成/ })
    expect(screen.queryByRole('button', { name: '修改地點' })).toBeNull()
    expect(screen.getByText('取消原因：取消驗收')).toBeInTheDocument()
  })
})
