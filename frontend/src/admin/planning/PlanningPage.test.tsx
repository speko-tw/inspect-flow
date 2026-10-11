import {
  fireEvent,
  render as renderWithoutRouter,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type { ReactElement } from 'react'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { deferred, expectImeEnterIgnored } from '../../testing/submitGuard'
import { ManagementApiError } from '../api'
import type { PlanningClient } from './api'
import { createMockPlanningClient } from './api.mock'
import planNameValidation from './fixtures/name-too-long-422.json'
import taskAssigneeValidation from './fixtures/task-assignee-validation-422.json'
import taskCancelValidation from './fixtures/task-cancel-validation-422.json'
import taskCreateValidation from './fixtures/task-create-validation-422.json'
import taskLocationValidation from './fixtures/task-location-validation-422.json'
import PlanningPage from './PlanningPage'

function validationError(fixture: {
  error: { code: string; fields: Array<{ path: string; code: string }> }
}) {
  const error = new ManagementApiError(422, fixture.error.code)
  error.fields = fixture.error.fields
  return error
}

function render(ui: ReactElement) {
  return renderWithoutRouter(ui, { wrapper: MemoryRouter })
}

async function expectNotice(text: string) {
  const notice = await screen.findByText(text)
  expect(notice).toHaveAttribute('role', 'status')
  return notice
}

describe('planning management page', () => {
  it(
    'manages plans, multi-item tasks, dispatch, cancel, ' + 'and restore',
    async () => {
      const client = createMockPlanningClient()
      await client.createZone('project-demo-1', '北區')
      render(
        <PlanningPage client={client} initialProjectId="project-demo-1" />,
      )

      await screen.findByRole('heading', { name: '計畫與任務' })

      fireEvent.change(screen.getByLabelText(/計畫名稱/), {
        target: { value: '橋梁查核' },
      })
      fireEvent.click(screen.getByRole('button', { name: '建立計畫' }))
      const planButton = await screen.findByRole('button', {
        name: '橋梁查核（草稿）',
      })
      await expectNotice('已建立計畫「橋梁查核」。')
      fireEvent.click(planButton)

      fireEvent.click(await screen.findByLabelText(/混凝土外觀/))
      fireEvent.click(await screen.findByLabelText(/鋼筋保護層/))
      fireEvent.change(screen.getByLabelText(/任務分區/), {
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
      await expectNotice('已建立草稿任務，派出後現場才看得到。')
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
      await expectNotice('已更新任務地點。')
      const taskWithLocation = locatedTask.closest('article') as HTMLElement

      fireEvent.click(
        within(taskWithLocation).getByRole('button', {
          name: '派出任務',
        }),
      )
      expect(screen.getByRole('button', { name: '確認' })).toHaveClass(
        'btn-primary',
      )
      fireEvent.click(screen.getByRole('button', { name: '確認' }))
      await screen.findByRole('heading', {
        name: /混凝土外觀、鋼筋保護層\s+（待開始）/,
      })
      await expectNotice('已派出任務，現場可以查看了。')

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
      expect(
        within(cancelDialog).getByRole('heading', { name: '取消任務' }),
      ).toHaveFocus()
      fireEvent.change(screen.getByLabelText(/取消原因/), {
        target: { value: '現場順序調整' },
      })
      fireEvent.click(
        within(cancelDialog).getByRole('button', { name: '取消任務' }),
      )
      await screen.findByText('取消原因：現場順序調整')
      await expectNotice('已取消任務，之後可以恢復。')

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
      await expectNotice('已恢復任務。')
    },
    15_000,
  )

  it('switches to read-only after a write returns 403', async () => {
    const client = createMockPlanningClient()
    client.createPlan = async () => {
      throw new ManagementApiError(403, 'permission.denied')
    }
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)

    await screen.findByRole('heading', { name: '查核計畫' })
    fireEvent.change(screen.getByLabelText(/計畫名稱/), {
      target: { value: '拒絕的計畫' },
    })
    fireEvent.click(screen.getByRole('button', { name: '建立計畫' }))

    expect(await screen.findByRole('status')).toHaveTextContent('唯讀模式')
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '建立計畫' })).toBeNull()
    })
    expect(screen.getByRole('status')).toHaveTextContent('唯讀模式')
  })

  it('shows a permission page when planning reads return 403', async () => {
    const client = createMockPlanningClient()
    client.listPlans = async () => {
      throw new ManagementApiError(403, 'permission.denied')
    }
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)

    expect(
      await screen.findByRole('heading', { name: '無權限' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      '沒有這個專案的查核計畫讀取權限',
    )
    expect(screen.getByRole('link', { name: '返回專案清單' })).toHaveAttribute(
      'href',
      '/admin/projects',
    )
  })

  it('loads project from route ID without listing or fallback', async () => {
    const client = createMockPlanningClient()
    const getProject = vi.spyOn(client, 'getProject')
    render(
      <PlanningPage
        key="project-demo-2"
        client={client}
        initialProjectId="project-demo-2"
      />,
    )

    expect(await screen.findByText('專案：示範工程 B')).toBeInTheDocument()
    expect(getProject).toHaveBeenCalledWith('project-demo-2')
    expect(screen.queryByText('專案：示範工程 A')).not.toBeInTheDocument()
  })

  it.each([404, 422])(
    'shows missing project without fallback for status %i',
    async (status) => {
      const client = createMockPlanningClient()
      vi.spyOn(client, 'getProject').mockRejectedValue(
        new ManagementApiError(status, 'resource.not_found'),
      )
      render(
        <PlanningPage client={client} initialProjectId="missing-project" />,
      )

      expect(
        await screen.findByRole('heading', { name: '找不到專案' }),
      ).toBeInTheDocument()
      expect(screen.queryByText('專案：示範工程 A')).not.toBeInTheDocument()
    },
  )

  it('uses the route project ID when its name is forbidden', async () => {
    const client = createMockPlanningClient()
    vi.spyOn(client, 'getProject').mockRejectedValue(
      new ManagementApiError(403, 'permission.denied'),
    )
    render(<PlanningPage client={client} initialProjectId="project-locked" />)

    expect(
      await screen.findByRole('heading', { name: '無權限' }),
    ).toBeInTheDocument()
  })

  it('shows and focuses a create-plan error inside its form', async () => {
    const client = createMockPlanningClient()
    client.createPlan = async () => {
      throw new ManagementApiError(422, 'validation.invalid')
    }
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await screen.findByRole('heading', { name: '查核計畫' })

    const form = screen.getByLabelText(/計畫名稱/).closest('form')
    expect(screen.getByLabelText(/計畫名稱/)).toHaveAttribute('required')
    expect(screen.getByLabelText(/計畫名稱/)).toHaveAttribute(
      'aria-describedby',
      'plan-name-hint',
    )
    fireEvent.change(screen.getByLabelText(/計畫名稱/), {
      target: { value: '錯誤計畫' },
    })
    fireEvent.submit(form as HTMLFormElement)

    const alert = await within(form as HTMLElement).findByRole('alert')
    await waitFor(() => expect(alert).toHaveFocus())
    expect(alert).toHaveTextContent('輸入資料不符合規格')
  })

  it('shows a plan-name error only in the form that caused it', async () => {
    const client = createMockPlanningClient()
    const plan = await client.createPlan('project-demo-1', {
      name: '既有計畫',
    })
    client.updatePlan = async () => {
      throw new ManagementApiError(409, 'inspection_plan.archived')
    }
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: '既有計畫（草稿）' }),
    )
    expect(await screen.findByText(plan.name)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '修改計畫名稱' }))

    const createForm = document.querySelector(
      'form[data-error-context="plan-create"]',
    ) as HTMLFormElement
    const renameForm = document.querySelector(
      'form[data-error-context="plan-rename"]',
    ) as HTMLFormElement
    fireEvent.submit(renameForm)

    expect(await within(renameForm).findByRole('alert')).toHaveTextContent(
      '計畫已封存，無法修改。',
    )
    expect(within(createForm).queryByRole('alert')).toBeNull()
  })

  it('shows a plan-detail read error at page level', async () => {
    const client = createMockPlanningClient()
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await screen.findByRole('heading', { name: '查核計畫' })

    fireEvent.change(screen.getByLabelText(/計畫名稱/), {
      target: { value: '既有計畫' },
    })
    fireEvent.click(screen.getByRole('button', { name: '建立計畫' }))
    const planButton = await screen.findByRole('button', {
      name: '既有計畫（草稿）',
    })

    client.getPlan = async () => {
      throw new ManagementApiError(500, 'inspection_plan.unavailable')
    }
    fireEvent.click(planButton)

    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent('伺服器暫時無法處理')
      expect(alert.closest('section')).toHaveAttribute(
        'aria-labelledby',
        'planning-heading',
      )
    })
  })

  it('keeps plans usable when zones and members return 403', async () => {
    const client = createMockPlanningClient()
    client.listProjectZones = async () => {
      throw new ManagementApiError(403, 'permission.denied')
    }
    client.listProjectAssignees = async () => {
      throw new ManagementApiError(403, 'permission.denied')
    }
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)

    expect(
      await screen.findByRole('heading', { name: '查核計畫' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '無權限' })).toBeNull()
    expect(await screen.findAllByRole('status')).toHaveLength(1)
  })

  it('deletes draft tasks through a confirmation dialog', async () => {
    const client = createMockPlanningClient()
    await client.createZone('project-demo-1', '北區')
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await screen.findByRole('heading', { name: '計畫與任務' })
    fireEvent.change(screen.getByLabelText(/計畫名稱/), {
      target: { value: '草稿刪除' },
    })
    fireEvent.click(screen.getByRole('button', { name: '建立計畫' }))
    fireEvent.click(
      await screen.findByRole('button', { name: '草稿刪除（草稿）' }),
    )
    fireEvent.click(await screen.findByLabelText(/混凝土外觀/))
    const zone = (await client.listProjectZones('project-demo-1')).find(
      (entry) => entry.name === '北區',
    )!
    fireEvent.change(screen.getByLabelText(/任務分區/), {
      target: { value: zone.id },
    })
    fireEvent.change(screen.getByLabelText('補充地點'), {
      target: { value: '東側二樓' },
    })
    fireEvent.click(screen.getByRole('button', { name: '建立草稿任務' }))
    const task = await screen.findByRole('heading', {
      name: /混凝土外觀\s+（草稿）/,
    })
    const article = task.closest('article') as HTMLElement
    fireEvent.click(within(article).getByRole('button', { name: '刪除草稿' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    // 計畫頁是唯一保留 modal 的確認框（#501）：蓋住整頁、背景 inert。
    expect(dialog).toHaveClass('confirm-box', 'confirm-box-modal')
    expect(dialog).toHaveClass('confirm-box-danger')
    expect(
      within(dialog).getByRole('heading', { name: '請確認操作' }),
    ).toHaveFocus()
    expect(dialog).toHaveTextContent(
      `永久刪除草稿任務「混凝土外觀」，位置：${zone.name}・東側二樓？`,
    )
    expect(dialog).toHaveTextContent('刪除後無法復原')
    expect(within(dialog).queryByRole('button', { name: '確認' })).toBeNull()
    const remove = within(dialog).getByRole('button', { name: '刪除' })
    expect(remove).toHaveClass('btn-danger')
    // 確認與取消固定排成 [取消][確認]，取消一律叫「取消」（#500）。
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['取消', '刪除'])
    expect(
      within(dialog).getByRole('button', { name: '取消' }),
    ).not.toHaveClass('btn-danger')
    fireEvent.click(remove)
    expect(await screen.findByText('尚未建立任務。')).toBeInTheDocument()
    await expectNotice('已刪除草稿任務。')
  })

  it('marks the selected plan in the plan list (#500)', async () => {
    const client = createMockPlanningClient()
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await screen.findByRole('heading', { name: '計畫與任務' })
    fireEvent.change(screen.getByLabelText(/計畫名稱/), {
      target: { value: '選取樣式' },
    })
    const create = screen.getByRole('button', { name: '建立計畫' })
    expect(create).toHaveClass('btn-primary')
    fireEvent.click(create)
    const plan = await screen.findByRole('button', {
      name: '選取樣式（草稿）',
    })
    expect(plan.closest('ul')).toHaveClass('plan-list')
    expect(plan).toHaveAttribute('aria-current', 'false')
    fireEvent.click(plan)
    expect(plan).toHaveAttribute('aria-current', 'true')
  })

  it('lists items to choose without per-template numbers (#487)', async () => {
    const client = createMockPlanningClient()
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await screen.findByRole('heading', { name: '計畫與任務' })
    fireEvent.change(screen.getByLabelText(/計畫名稱/), {
      target: { value: '項次檢查' },
    })
    fireEvent.click(screen.getByRole('button', { name: '建立計畫' }))
    fireEvent.click(
      await screen.findByRole('button', { name: '項次檢查（草稿）' }),
    )
    const label = (await screen.findByLabelText(/混凝土外觀/)).closest('label')
    expect(label?.textContent).toMatch(/^混凝土外觀/)
  })

  it('hides actions on archived plans and restores them', async () => {
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
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
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
    await waitFor(() =>
      expect(screen.getByText(/計畫狀態：/)).toHaveTextContent(
        '計畫狀態：已封存',
      ),
    )
    await expectNotice('已封存計畫。')
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
    await expectNotice('已取消封存計畫。')
  })

  it('clears project A data when project B loading fails', async () => {
    const client = createMockPlanningClient()
    const listProjectZones = client.listProjectZones.bind(client)
    client.listProjectZones = async (projectId) => {
      if (projectId === 'project-demo-2') {
        throw new ManagementApiError(503, 'project_zone.unavailable')
      }
      return listProjectZones(projectId)
    }
    const { rerender } = render(
      <PlanningPage client={client} initialProjectId="project-demo-1" />,
    )

    await screen.findByRole('heading', { name: '計畫與任務' })
    await client.createZone('project-demo-1', 'A 專用分區')

    fireEvent.change(screen.getByLabelText(/計畫名稱/), {
      target: { value: 'A 專用計畫' },
    })
    fireEvent.click(screen.getByRole('button', { name: '建立計畫' }))
    await screen.findByRole('button', { name: 'A 專用計畫（草稿）' })

    vi.spyOn(client, 'getProject').mockRejectedValueOnce(
      new ManagementApiError(404, 'resource.not_found'),
    )
    rerender(
      <PlanningPage
        key="project-demo-2"
        client={client}
        initialProjectId="project-demo-2"
      />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '網址中的專案不存在或已刪除',
    )
    expect(
      screen.queryByRole('button', { name: 'A 專用計畫（草稿）' }),
    ).toBeNull()
    expect(screen.queryByLabelText(/混凝土外觀/)).toBeNull()
  })

  it('offers members returned for the selected project', async () => {
    const client = createMockPlanningClient()
    render(
      <PlanningPage
        key="project-demo-2"
        client={client}
        initialProjectId="project-demo-2"
      />,
    )

    await screen.findByRole('heading', { name: '計畫與任務' })
    fireEvent.change(screen.getByLabelText(/計畫名稱/), {
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

  it('does not show a zone selector for projects without zones', async () => {
    const client = createMockPlanningClient()
    render(
      <PlanningPage
        key="project-demo-2"
        client={client}
        initialProjectId="project-demo-2"
      />,
    )
    await screen.findByRole('heading', { name: '計畫與任務' })
    fireEvent.change(screen.getByLabelText(/計畫名稱/), {
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
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: '唯讀狀態（已完成）' }),
    )
    await screen.findByRole('heading', { name: /已完成/ })
    expect(screen.queryByRole('button', { name: '修改地點' })).toBeNull()
    expect(screen.getByText('取消原因：取消驗收')).toBeInTheDocument()
  })

  describe('field hints and errors (#490)', () => {
    it('keeps the task zone hint plain until the form is submitted', async () => {
      const client = createMockPlanningClient()
      const zone = await client.createZone('project-demo-1', '北區')
      const plan = await client.createPlan('project-demo-1', {
        name: '橋梁查核',
      })
      render(
        <PlanningPage client={client} initialProjectId="project-demo-1" />,
      )
      fireEvent.click(
        await screen.findByRole('button', { name: '橋梁查核（草稿）' }),
      )
      fireEvent.click(await screen.findByLabelText(/混凝土外觀/))

      expect(document.getElementById('task-zone-hint')).toHaveClass(
        'field-hint',
      )
      expect(document.querySelector('.tpl-field-error')).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: '建立草稿任務' }))
      const select = screen.getByLabelText(/任務分區/)
      const error = await screen.findByText('請選擇任務分區。')
      expect(error).toHaveClass('tpl-field-error')
      expect(select).toHaveAttribute('aria-invalid', 'true')
      expect(select.getAttribute('aria-describedby')).toContain(error.id)
      await waitFor(() => expect(select).toHaveFocus())
      expect((await client.getPlan(plan.id)).tasks ?? []).toHaveLength(0)

      // 選了分區，錯誤就消失，再送出就會建立。
      fireEvent.change(select, { target: { value: zone.id } })
      expect(screen.queryByText('請選擇任務分區。')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: '建立草稿任務' }))
      await expectNotice('已建立草稿任務，派出後現場才看得到。')
    })

    it('rejects a blank plan name on submit and focuses the field', async () => {
      const client = createMockPlanningClient()
      const createPlan = vi.spyOn(client, 'createPlan')
      render(
        <PlanningPage client={client} initialProjectId="project-demo-1" />,
      )
      await screen.findByRole('heading', { name: '查核計畫' })
      const input = screen.getByLabelText(/計畫名稱/)
      fireEvent.click(screen.getByRole('button', { name: '建立計畫' }))

      const error = await screen.findByText('請輸入計畫名稱。')
      expect(error).toHaveClass('tpl-field-error')
      expect(input).toHaveAttribute('aria-invalid', 'true')
      await waitFor(() => expect(input).toHaveFocus())
      expect(createPlan).not.toHaveBeenCalled()
    })

    it('confirms before leaving changed forms or unloading the page', async () => {
      const client = createMockPlanningClient()
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      renderWithoutRouter(
        <MemoryRouter
          initialEntries={['/admin/projects/project-demo-1/planning']}
        >
          <Routes>
            <Route
              element={
                <>
                  <PlanningPage
                    client={client}
                    initialProjectId="project-demo-1"
                  />
                  <Link to="/outside">切換頁面</Link>
                </>
              }
              path="/admin/projects/:projectId/planning"
            />
            <Route element={<p>已離開計畫頁</p>} path="/outside" />
          </Routes>
        </MemoryRouter>,
      )

      fireEvent.change(await screen.findByLabelText(/計畫名稱/), {
        target: { value: '尚未儲存的計畫' },
      })
      const unload = new Event('beforeunload', {
        cancelable: true,
      }) as BeforeUnloadEvent
      window.dispatchEvent(unload)
      expect(unload.defaultPrevented).toBe(true)

      fireEvent.click(screen.getByRole('link', { name: '切換頁面' }))
      expect(confirm).toHaveBeenCalledWith('有尚未儲存的變更。確定要離開嗎？')
      expect(screen.queryByText('已離開計畫頁')).toBeNull()

      confirm.mockReturnValue(true)
      fireEvent.click(screen.getByRole('link', { name: '切換頁面' }))
      expect(await screen.findByText('已離開計畫頁')).toBeVisible()
      confirm.mockRestore()
    })
  })

  describe('add forms reset after success (#490)', () => {
    it('clears the plan form after a plan is created', async () => {
      const client = createMockPlanningClient()
      render(
        <PlanningPage client={client} initialProjectId="project-demo-1" />,
      )
      await screen.findByRole('heading', { name: '查核計畫' })
      fireEvent.change(screen.getByLabelText(/計畫名稱/), {
        target: { value: '橋梁查核' },
      })
      fireEvent.click(screen.getByRole('button', { name: '建立計畫' }))

      await expectNotice('已建立計畫「橋梁查核」。')
      expect(screen.getByLabelText(/計畫名稱/)).toHaveValue('')
    })

    it('clears the task form after a task is created', async () => {
      const client = createMockPlanningClient()
      const zone = await client.createZone('project-demo-1', '北區')
      await client.createPlan('project-demo-1', { name: '橋梁查核' })
      render(
        <PlanningPage client={client} initialProjectId="project-demo-1" />,
      )
      fireEvent.click(
        await screen.findByRole('button', { name: '橋梁查核（草稿）' }),
      )
      const item = await screen.findByLabelText(/混凝土外觀/)
      fireEvent.click(item)
      fireEvent.change(screen.getByLabelText(/任務分區/), {
        target: { value: zone.id },
      })
      fireEvent.change(screen.getByLabelText('補充地點'), {
        target: { value: '東側二樓' },
      })
      fireEvent.click(screen.getByRole('button', { name: '建立草稿任務' }))

      await expectNotice('已建立草稿任務，派出後現場才看得到。')
      expect(screen.getByLabelText(/混凝土外觀/)).not.toBeChecked()
      expect(screen.getByLabelText(/任務分區/)).toHaveValue('')
      expect(screen.getByLabelText('補充地點')).toHaveValue('')
      expect(
        screen.getByRole('button', { name: '建立草稿任務' }),
      ).toBeEnabled()
    })
  })
})

// 計畫頁所有表單與確認框的防連點與輸入法 Enter（#507）。
// 分區新增的連按與輸入法測試在上方 #490。
describe('planning forms guard (#507)', () => {
  type Method = Exclude<
    {
      [K in keyof PlanningClient]: PlanningClient[K] extends (
        ...args: never[]
      ) => Promise<unknown>
        ? K
        : never
    }[keyof PlanningClient],
    never
  >

  // 讓指定的 client 方法等到 gate 完成才回應，並記錄呼叫次數。
  function hold(client: PlanningClient, method: Method) {
    const gate = deferred()
    const original = client[method] as (...args: unknown[]) => Promise<unknown>
    const spy = vi.fn(async (...args: unknown[]) => {
      await gate.promise
      return original.apply(client, args)
    })
    ;(client as unknown as Record<string, unknown>)[method] = spy
    return { gate, spy }
  }

  function watch(client: PlanningClient, method: Method) {
    const original = client[method] as (...args: unknown[]) => Promise<unknown>
    const spy = vi.fn((...args: unknown[]) => original.apply(client, args))
    ;(client as unknown as Record<string, unknown>)[method] = spy
    return spy
  }

  async function seeded(dispatched = false) {
    const client = createMockPlanningClient()
    const zone = await client.createZone('project-demo-1', '北區')
    const plan = await client.createPlan('project-demo-1', {
      name: '橋梁查核',
    })
    const items = await client.listProjectItems('project-demo-1')
    const task = await client.createTask(plan.id, {
      item_ids: [items[0].id],
      suggested_assignee_id: null,
      zone_id: zone.id,
      location_text: null,
    })
    if (dispatched) await client.dispatchTask(task.id)
    return { client, zone, plan, task }
  }

  async function openPlan(client: PlanningClient) {
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    fireEvent.click(await screen.findByRole('button', { name: /橋梁查核（/ }))
    return (
      await screen.findByRole('heading', { name: /混凝土外觀/ })
    ).closest('article') as HTMLElement
  }

  const formByContext = (context: string) =>
    document.querySelector(
      `[data-error-context="${context}"]`,
    ) as HTMLFormElement

  it('maps plan creation 422 fields and focuses the reported name', async () => {
    const client = createMockPlanningClient()
    client.createPlan = vi
      .fn()
      .mockRejectedValue(validationError(planNameValidation))
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    const input = await screen.findByLabelText(/計畫名稱/)
    fireEvent.change(input, { target: { value: '長名稱' } })
    fireEvent.click(screen.getByRole('button', { name: '建立計畫' }))

    expect(await screen.findByText('輸入內容太長。')).toBeVisible()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(input).toHaveFocus())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('maps plan rename 422 fields and focuses the reported name', async () => {
    const { client } = await seeded()
    client.updatePlan = vi
      .fn()
      .mockRejectedValue(validationError(planNameValidation))
    await openPlan(client)
    fireEvent.click(screen.getByRole('button', { name: '修改計畫名稱' }))
    const form = formByContext('plan-rename')
    const input = within(form).getByLabelText(/計畫名稱/)
    fireEvent.change(input, { target: { value: '更新名稱' } })
    fireEvent.click(within(form).getByRole('button', { name: '儲存計畫名稱' }))

    expect(await within(form).findByText('輸入內容太長。')).toBeVisible()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(input).toHaveFocus())
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('maps all task creation 422 fields and focuses the first reported field', async () => {
    const { client, zone } = await seeded()
    client.createTask = vi
      .fn()
      .mockRejectedValue(validationError(taskCreateValidation))
    await openPlan(client)
    const form = formByContext('task')
    fireEvent.click(within(form).getByLabelText(/鋼筋保護層/))
    fireEvent.change(within(form).getByLabelText(/任務分區/), {
      target: { value: zone.id },
    })
    fireEvent.change(within(form).getByLabelText('補充地點'), {
      target: { value: '東側' },
    })
    fireEvent.click(within(form).getByRole('button', { name: '建立草稿任務' }))

    expect(await within(form).findAllByText('輸入內容太長。')).toHaveLength(2)
    expect(
      within(form).getAllByText('欄位格式不正確，請檢查輸入內容。'),
    ).toHaveLength(2)
    expect(
      within(form).getByRole('group', { name: /選擇一筆以上/ }),
    ).toHaveAttribute('aria-invalid', 'true')
    expect(within(form).getByLabelText(/任務分區/)).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(within(form).getByLabelText('補充地點')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(within(form).getByLabelText('建議指派人')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await waitFor(() =>
      expect(
        within(form).getByRole('group', { name: /選擇一筆以上/ }),
      ).toHaveFocus(),
    )
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('maps task location 422 fields and focuses the first reported field', async () => {
    const { client, zone } = await seeded()
    client.updateLocation = vi
      .fn()
      .mockRejectedValue(validationError(taskLocationValidation))
    const article = await openPlan(client)
    fireEvent.click(within(article).getByRole('button', { name: '修改地點' }))
    const form = formByContext('location')
    fireEvent.change(within(form).getByLabelText('補充地點'), {
      target: { value: '東側' },
    })
    fireEvent.click(within(form).getByRole('button', { name: '儲存地點' }))

    expect(
      await within(form).findByText('欄位格式不正確，請檢查輸入內容。'),
    ).toBeVisible()
    expect(await within(form).findByText('輸入內容太長。')).toBeVisible()
    expect(within(form).getByLabelText(/分區/)).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(within(form).getByLabelText('補充地點')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await waitFor(() =>
      expect(within(form).getByLabelText(/分區/)).toHaveFocus(),
    )
    expect(zone.id).toBeTruthy()
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('maps task assignment 422 fields and focuses the assignee selector', async () => {
    const { client } = await seeded()
    client.setSuggestedAssignee = vi
      .fn()
      .mockRejectedValue(validationError(taskAssigneeValidation))
    const article = await openPlan(client)
    fireEvent.click(
      within(article).getByRole('button', { name: '修改建議指派' }),
    )
    const form = formByContext('assignee')
    fireEvent.change(within(form).getByLabelText('建議指派人'), {
      target: { value: 'project-a-member-1' },
    })
    fireEvent.click(within(form).getByRole('button', { name: '儲存指派' }))

    expect(
      await within(form).findByText('欄位格式不正確，請檢查輸入內容。'),
    ).toBeVisible()
    expect(within(form).getByLabelText('建議指派人')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await waitFor(() =>
      expect(within(form).getByLabelText('建議指派人')).toHaveFocus(),
    )
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows and focuses a general error in the task-assignment form', async () => {
    const { client } = await seeded()
    client.setSuggestedAssignee = vi
      .fn()
      .mockRejectedValue(
        new ManagementApiError(500, 'inspection_task.unavailable'),
      )
    const article = await openPlan(client)
    fireEvent.click(
      within(article).getByRole('button', { name: '修改建議指派' }),
    )
    const form = formByContext('assignee')
    fireEvent.click(within(form).getByRole('button', { name: '儲存指派' }))

    const alert = await within(form).findByRole('alert')
    expect(alert).toHaveTextContent('伺服器暫時無法處理')
    await waitFor(() => expect(alert).toHaveFocus())
  })

  it('keeps an unknown assignment pointer in the general form error', async () => {
    const { client } = await seeded()
    const unknownField = new ManagementApiError(
      422,
      'request.validation_failed',
    )
    unknownField.fields = [{ path: '/unexpected', code: 'field.invalid' }]
    client.setSuggestedAssignee = vi.fn().mockRejectedValue(unknownField)
    const article = await openPlan(client)
    fireEvent.click(
      within(article).getByRole('button', { name: '修改建議指派' }),
    )
    const form = formByContext('assignee')
    const selector = within(form).getByLabelText('建議指派人')
    fireEvent.click(within(form).getByRole('button', { name: '儲存指派' }))

    const alert = await within(form).findByRole('alert')
    expect(alert).toHaveTextContent('輸入資料不符合規格')
    await waitFor(() => expect(alert).toHaveFocus())
    expect(selector).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('maps task cancellation 422 fields and focuses the reason', async () => {
    const { client } = await seeded(true)
    client.cancelTask = vi
      .fn()
      .mockRejectedValue(validationError(taskCancelValidation))
    const article = await openPlan(client)
    fireEvent.click(within(article).getByRole('button', { name: '取消任務' }))
    const dialog = screen.getByRole('dialog')
    const reason = within(dialog).getByLabelText(/取消原因/)
    fireEvent.change(reason, { target: { value: '現場調整' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '取消任務' }))

    expect(await within(dialog).findByText('輸入內容太長。')).toBeVisible()
    expect(reason).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(reason).toHaveFocus())
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps unknown 422 pointers in the general error without guessing a field', async () => {
    const client = createMockPlanningClient()
    const unknownField = new ManagementApiError(
      422,
      'request.validation_failed',
    )
    unknownField.fields = [{ path: '/unexpected', code: 'field.invalid' }]
    client.createPlan = vi.fn().mockRejectedValue(unknownField)
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    const input = await screen.findByLabelText(/計畫名稱/)
    fireEvent.change(input, { target: { value: '測試計畫' } })
    fireEvent.click(screen.getByRole('button', { name: '建立計畫' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '輸入資料不符合規格，請檢查後再試。',
    )
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
    expect(
      screen.queryByText('欄位格式不正確，請檢查輸入內容。'),
    ).not.toBeInTheDocument()
  })

  it('creates one plan when the form is submitted twice quickly', async () => {
    const client = createMockPlanningClient()
    const { gate, spy } = hold(client, 'createPlan')
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await screen.findByRole('heading', { name: '查核計畫' })
    fireEvent.change(screen.getByLabelText(/計畫名稱/), {
      target: { value: '橋梁查核' },
    })
    const form = formByContext('plan-create')

    fireEvent.submit(form)
    fireEvent.submit(form)
    gate.resolve()

    await expectNotice('已建立計畫「橋梁查核」。')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ignores IME Enter in the plan form', async () => {
    const client = createMockPlanningClient()
    const spy = watch(client, 'createPlan')
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await screen.findByRole('heading', { name: '查核計畫' })
    fireEvent.change(screen.getByLabelText(/計畫名稱/), {
      target: { value: '橋梁查核' },
    })

    expectImeEnterIgnored(screen.getByLabelText(/計畫名稱/))

    expect(spy).not.toHaveBeenCalled()
  })

  it('accepts another plan after a failed one', async () => {
    const client = createMockPlanningClient()
    const spy = vi.fn(async () => {
      throw new ManagementApiError(500, 'server.error')
    })
    client.createPlan = spy
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await screen.findByRole('heading', { name: '查核計畫' })
    fireEvent.change(screen.getByLabelText(/計畫名稱/), {
      target: { value: '橋梁查核' },
    })
    const form = formByContext('plan-create')

    fireEvent.submit(form)
    await within(form).findByRole('alert')
    fireEvent.submit(form)

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
  })

  it('renames the plan once on a double submit', async () => {
    const { client } = await seeded()
    const { gate, spy } = hold(client, 'updatePlan')
    await openPlan(client)
    fireEvent.click(screen.getByRole('button', { name: '修改計畫名稱' }))
    const form = formByContext('plan-rename')
    fireEvent.change(within(form).getByLabelText(/計畫名稱/), {
      target: { value: '橋梁查核二版' },
    })

    fireEvent.submit(form)
    fireEvent.submit(form)
    gate.resolve()

    await expectNotice('已更新計畫名稱。')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('ignores IME Enter in the plan rename', async () => {
    const { client } = await seeded()
    const spy = watch(client, 'updatePlan')
    await openPlan(client)
    fireEvent.click(screen.getByRole('button', { name: '修改計畫名稱' }))
    const form = formByContext('plan-rename')
    fireEvent.change(within(form).getByLabelText(/計畫名稱/), {
      target: { value: '橋梁查核二版' },
    })

    expectImeEnterIgnored(within(form).getByLabelText(/計畫名稱/))

    expect(spy).not.toHaveBeenCalled()
  })

  it('creates one task when the form is submitted twice quickly', async () => {
    const { client, zone } = await seeded()
    const { gate, spy } = hold(client, 'createTask')
    await openPlan(client)
    const form = formByContext('task')
    fireEvent.click(within(form).getByLabelText(/鋼筋保護層/))
    fireEvent.change(within(form).getByLabelText(/任務分區/), {
      target: { value: zone.id },
    })

    fireEvent.submit(form)
    fireEvent.submit(form)
    gate.resolve()

    await expectNotice('已建立草稿任務，派出後現場才看得到。')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('reports missing task items and focuses the item selector on Enter submit', async () => {
    const { client } = await seeded()
    const createTask = vi.spyOn(client, 'createTask')
    await openPlan(client)
    const form = formByContext('task')

    form.requestSubmit()

    const error = await within(form).findByText('請至少選擇一筆查核項目。')
    expect(error).toBeVisible()
    expect(
      within(form).getByRole('group', { name: /選擇一筆以上/ }),
    ).toHaveFocus()
    expect(createTask).not.toHaveBeenCalled()
  })

  it('ignores IME Enter in the task form', async () => {
    const { client, zone } = await seeded()
    const spy = watch(client, 'createTask')
    await openPlan(client)
    const form = formByContext('task')
    fireEvent.click(within(form).getByLabelText(/鋼筋保護層/))
    fireEvent.change(within(form).getByLabelText(/任務分區/), {
      target: { value: zone.id },
    })

    expectImeEnterIgnored(within(form).getByLabelText('補充地點'))

    expect(spy).not.toHaveBeenCalled()
  })

  it('saves the location once on a double submit', async () => {
    const { client } = await seeded()
    const { gate, spy } = hold(client, 'updateLocation')
    const article = await openPlan(client)
    fireEvent.click(within(article).getByRole('button', { name: '修改地點' }))
    const form = formByContext('location')
    fireEvent.change(within(form).getByLabelText('補充地點'), {
      target: { value: '東側三樓' },
    })

    fireEvent.submit(form)
    fireEvent.submit(form)
    gate.resolve()

    await expectNotice('已更新任務地點。')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('ignores IME Enter in the location form', async () => {
    const { client } = await seeded()
    const spy = watch(client, 'updateLocation')
    const article = await openPlan(client)
    fireEvent.click(within(article).getByRole('button', { name: '修改地點' }))
    const form = formByContext('location')

    expectImeEnterIgnored(within(form).getByLabelText('補充地點'))

    expect(spy).not.toHaveBeenCalled()
  })

  it('saves the assignee once on a double submit', async () => {
    const { client } = await seeded()
    const { gate, spy } = hold(client, 'setSuggestedAssignee')
    const article = await openPlan(client)
    fireEvent.click(
      within(article).getByRole('button', { name: '修改建議指派' }),
    )
    const form = within(article)
      .getByRole('button', { name: '儲存指派' })
      .closest('form') as HTMLFormElement

    fireEvent.submit(form)
    fireEvent.submit(form)
    gate.resolve()

    await expectNotice('已更新建議指派。')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('ignores IME Enter in the assignee form', async () => {
    const { client } = await seeded()
    const spy = watch(client, 'setSuggestedAssignee')
    const article = await openPlan(client)
    fireEvent.click(
      within(article).getByRole('button', { name: '修改建議指派' }),
    )

    expectImeEnterIgnored(within(article).getByLabelText('建議指派人'))

    expect(spy).not.toHaveBeenCalled()
  })

  it('dispatches once when the confirm button is clicked twice', async () => {
    const { client } = await seeded()
    const { gate, spy } = hold(client, 'dispatchTask')
    const article = await openPlan(client)
    expect(within(article).getByText(/尚未指派/)).toBeVisible()
    expect(
      within(article).getByRole('button', { name: '派出任務' }),
    ).toBeDisabled()

    fireEvent.click(
      within(article).getByRole('button', {
        name: '前往建議指派欄位',
      }),
    )
    fireEvent.change(within(article).getByLabelText('建議指派人'), {
      target: { value: 'project-a-member-1' },
    })
    fireEvent.click(within(article).getByRole('button', { name: '儲存指派' }))
    await waitFor(() => {
      expect(within(article).queryByText(/尚未指派/)).not.toBeInTheDocument()
    })

    fireEvent.click(within(article).getByRole('button', { name: '派出任務' }))
    const confirm = screen.getByRole('button', { name: '確認' })

    fireEvent.click(confirm)
    fireEvent.click(confirm)
    gate.resolve()

    await expectNotice('已派出任務，現場可以查看了。')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('cancels a task once on a double submit', async () => {
    const { client } = await seeded(true)
    const { gate, spy } = hold(client, 'cancelTask')
    const article = await openPlan(client)
    fireEvent.click(within(article).getByRole('button', { name: '取消任務' }))
    fireEvent.change(screen.getByLabelText(/取消原因/), {
      target: { value: '現場順序調整' },
    })
    const form = screen.getByRole('dialog')

    fireEvent.submit(form)
    fireEvent.submit(form)
    gate.resolve()

    await expectNotice('已取消任務，之後可以恢復。')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('cancel dialog is a textarea only (IME Enter n/a)', async () => {
    const { client } = await seeded(true)
    const spy = watch(client, 'cancelTask')
    const article = await openPlan(client)
    fireEvent.click(within(article).getByRole('button', { name: '取消任務' }))
    fireEvent.change(screen.getByLabelText(/取消原因/), {
      target: { value: '現場順序調整' },
    })

    expect(screen.getByLabelText(/取消原因/).tagName).toBe('TEXTAREA')
    expect(spy).not.toHaveBeenCalled()
  })

  it('guards a changed cancel reason as an unsaved draft', async () => {
    const { client } = await seeded(true)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const article = await openPlan(client)
    fireEvent.click(within(article).getByRole('button', { name: '取消任務' }))
    fireEvent.change(screen.getByLabelText(/取消原因/), {
      target: { value: '尚未儲存的原因' },
    })

    const unload = new Event('beforeunload', {
      cancelable: true,
    }) as BeforeUnloadEvent
    window.dispatchEvent(unload)

    expect(unload.defaultPrevented).toBe(true)
    expect(confirm).toHaveBeenCalledTimes(0)
    confirm.mockRestore()
  })
})
