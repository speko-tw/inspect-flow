import {
  act,
  fireEvent,
  render as renderWithoutRouter,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { useEffect, type ReactElement, type ReactNode } from 'react'
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router'
import { DataMemoryRouter } from '../../testing/DataMemoryRouter'
import { describe, expect, it, vi } from 'vitest'

import { deferred, expectImeEnterIgnored } from '../../testing/submitGuard'
import { currentUserFixture } from '../../testing/contractFixtures'
import { CurrentUserProvider } from '../../auth/useCurrentUser'
import { ManagementApiError } from '../api'
import type { InspectionTask, PlanningClient } from './api'
import { createMockPlanningClient } from './api.mock'
import planNameValidation from './fixtures/name-too-long-422.json'
import taskAssigneeValidation from './fixtures/task-assignee-validation-422.json'
import taskCancelValidation from './fixtures/task-cancel-validation-422.json'
import taskCreateValidation from './fixtures/task-create-validation-422.json'
import taskLocationValidation from './fixtures/task-location-validation-422.json'
import PlanningPage, { type PlanningPageClient } from './PlanningPage'

const READ_ONLY_NOTICE =
  '你在這個專案只能查看計畫與任務，不能新增、修改或派出。' +
  '需要調整請找有管理權限的專案成員或管理者。'
const ASSIGNEE_LIST_UNAVAILABLE_NOTICE =
  '看不到成員名單，這次只能選「不指定」，' + '之後請有權限的人補上。'

function validationError(fixture: {
  error: { code: string; fields: Array<{ path: string; code: string }> }
}) {
  const error = new ManagementApiError(422, fixture.error.code)
  error.fields = fixture.error.fields
  return error
}

/** 模擬真實 router：換專案 props 時也換網址，避免測試產生矛盾的路徑。 */
function PlanningRouteSync({ projectId }: { projectId: string }) {
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    const path = `/projects/${projectId}/planning`
    if (!location.pathname.startsWith(path)) {
      void navigate(path, { replace: true })
    }
  }, [projectId, location.pathname, navigate])
  return null
}

function render(ui: ReactElement, user = currentUserFixture()) {
  const projectId =
    (ui.props as { initialProjectId?: string }).initialProjectId ??
    'project-demo-1'
  const initialPath = `/projects/${projectId}/planning`
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataMemoryRouter initialEntries={[initialPath]}>
        <CurrentUserProvider value={{ user, clear: vi.fn() }}>
          <PlanningRouteSync
            projectId={
              (children as ReactElement<{ initialProjectId?: string }>).props
                .initialProjectId ?? projectId
            }
          />
          {children}
        </CurrentUserProvider>
      </DataMemoryRouter>
    )
  }
  return renderWithoutRouter(ui, { wrapper: Wrapper })
}

async function expectNotice(text: string) {
  const notice = await screen.findByText(text)
  expect(notice).toHaveAttribute('role', 'status')
  return notice
}

async function click(element: Element) {
  await act(async () => {
    fireEvent.click(element)
  })
}

async function openPlanCreationForm() {
  const back = screen.queryByRole('link', { name: '返回計畫清單' })
  if (!screen.queryByRole('link', { name: '建立計畫' }) && back)
    await click(back)
  await click(await screen.findByRole('link', { name: '建立計畫' }))
  await screen.findByLabelText(/計畫名稱/)
}

async function openTaskDetail() {
  const link = document.querySelector<HTMLAnchorElement>(
    'article a[href*="/tasks/"]',
  )
  if (link) await click(link)
}

async function openTaskCreationForm(): Promise<void> {
  const button = await screen.findByRole('button', {
    name: '＋ 新增任務',
  })
  await click(button)
  expect(screen.queryByText('尚未建立任務。')).not.toBeInTheDocument()
}

describe('planning management page', () => {
  it('任務詳情以所屬計畫連結取代計畫層介紹與狀態', async () => {
    const client = createMockPlanningClient()
    const plan = await client.createPlan('project-demo-1', {
      name: '任務所屬計畫',
    })
    const [item] = await client.listProjectItems('project-demo-1')
    await client.createTask(plan.id, {
      name: '任務詳情案例',
      item_ids: [item.id],
      zone_id: null,
      location_text: '工地',
      suggested_assignee_id: null,
    })
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await click(await screen.findByRole('link', { name: /任務所屬計畫/ }))
    const taskLink = await screen.findByRole('link', {
      name: '任務詳情案例',
    })
    expect(taskLink.querySelector('h4 .planning-task-name')).toHaveTextContent(
      '任務詳情案例',
    )
    expect(taskLink.querySelector('.planning-task-summary')).toBeVisible()
    await click(taskLink)

    expect(screen.queryByText(/^專案：/)).toBeNull()
    expect(screen.getByText('所屬計畫：')).toBeVisible()
    expect(screen.getByRole('link', { name: /任務所屬計畫/ })).toHaveAttribute(
      'href',
      expect.stringContaining(`/planning/${plan.id}`),
    )
    expect(screen.queryByText(/計畫狀態：/)).toBeNull()
    expect(
      screen.queryByText(
        '計畫的狀態會跟著任務自動更新；任務派出後，現場才看得到。',
      ),
    ).toBeNull()
  })

  it(
    'manages plans, multi-item tasks, dispatch, cancel, ' + 'and restore',
    async () => {
      const client = createMockPlanningClient()
      await client.createZone('project-demo-1', '北區')
      render(
        <PlanningPage client={client} initialProjectId="project-demo-1" />,
      )

      await screen.findByRole('heading', { name: '計畫與任務' })

      // 初次載入完成後欄位才存在，避免同步查找早於資料載入。
      await openPlanCreationForm()
      fireEvent.change(await screen.findByLabelText(/計畫名稱/), {
        target: { value: '橋梁查核' },
      })
      await click(screen.getByRole('button', { name: '建立計畫' }))
      await expectNotice('已建立計畫，接著新增任務。')
      await click(screen.getByRole('link', { name: '返回計畫清單' }))
      const planButton = await screen.findByRole('link', {
        name: '橋梁查核（草稿）',
      })

      await click(planButton)
      await waitFor(() =>
        expect(
          screen.getByRole('heading', { name: '橋梁查核' }),
        ).toHaveFocus(),
      )
      await click(await screen.findByRole('button', { name: '＋ 新增任務' }))

      await click(await screen.findByLabelText(/混凝土外觀/))
      await click(await screen.findByLabelText(/鋼筋保護層/))
      fireEvent.change(screen.getByLabelText(/任務分區/), {
        target: {
          value: (await client.listProjectZones('project-demo-1'))[0].id,
        },
      })
      fireEvent.change(screen.getByLabelText('補充地點'), {
        target: { value: '東側二樓' },
      })
      const taskNameInput = screen.getByLabelText(/任務名稱/)
      expect(taskNameInput).toHaveValue('混凝土外觀等 2 項－北區')
      fireEvent.change(taskNameInput, {
        target: { value: '橋梁外牆複查' },
      })
      const secondItem = screen.getByLabelText(/鋼筋保護層/)
      await click(secondItem)
      await click(secondItem)
      expect(taskNameInput).toHaveValue('橋梁外牆複查')
      fireEvent.change(screen.getByLabelText('建議指派人'), {
        target: { value: 'project-a-member-1' },
      })
      await click(screen.getByRole('button', { name: '建立草稿任務' }))

      const taskHeading = await screen.findByRole('heading', {
        name: /橋梁外牆複查\s+（草稿）/,
      })
      await expectNotice('已建立草稿任務，派出後現場才看得到。')
      const taskArticle = taskHeading.closest('article')
      expect(taskArticle).not.toBeNull()
      expect(
        (taskArticle as HTMLElement).querySelector('.named-row-actions'),
      ).not.toBeNull()
      expect(
        within(taskArticle as HTMLElement).getAllByRole('button'),
      ).toHaveLength(6)
      expect(
        within(taskArticle as HTMLElement).getByText(
          '查核項目：混凝土外觀、鋼筋保護層',
        ),
      ).toBeInTheDocument()
      expect(
        within(taskArticle as HTMLElement).getByText('分區：北區'),
      ).toBeInTheDocument()
      expect(
        within(taskArticle as HTMLElement).getByText('補充地點：東側二樓'),
      ).toBeInTheDocument()
      expect(
        within(taskArticle as HTMLElement).getByText('建議指派：現場人員甲'),
      ).toBeInTheDocument()

      await openTaskDetail()
      await click(
        within(taskArticle as HTMLElement).getByRole('button', {
          name: '修改地點',
        }),
      )
      fireEvent.change(
        within(taskArticle as HTMLElement).getByLabelText('補充地點'),
        { target: { value: '東側三樓' } },
      )
      await click(
        within(taskArticle as HTMLElement).getByRole('button', {
          name: '儲存地點',
        }),
      )
      const locatedTask = await screen.findByText('補充地點：東側三樓')
      await expectNotice('已更新任務地點。')
      const taskWithLocation = locatedTask.closest('article') as HTMLElement

      await click(
        within(taskWithLocation).getByRole('button', {
          name: '派出任務',
        }),
      )
      expect(
        within(screen.getByRole('dialog')).getByRole('heading', {
          name: '派出這個任務？',
        }),
      ).toBeVisible()
      expect(
        within(screen.getByRole('dialog')).getAllByRole('listitem'),
      ).toHaveLength(4)
      expect(screen.getByRole('dialog')).toHaveTextContent(
        '任務：橋梁外牆複查查核項目：混凝土外觀、鋼筋保護層分區：北區建議指派人：現場人員甲',
      )
      expect(screen.getByRole('button', { name: '確認派出' })).toHaveClass(
        'btn-primary',
      )
      await click(screen.getByRole('button', { name: '確認派出' }))
      await screen.findByRole('heading', {
        name: /橋梁外牆複查\s+（待開始）/,
      })
      await expectNotice('已派出任務，現場可以查看了。')

      const refreshedTask = screen
        .getByRole('heading', {
          name: /橋梁外牆複查\s+（待開始）/,
        })
        .closest('article') as HTMLElement
      await click(
        within(refreshedTask).getByRole('button', {
          name: '取消任務',
        }),
      )
      const cancelDialog = screen.getByRole('dialog')
      expect(cancelDialog).toHaveAttribute('aria-modal', 'true')
      // 確認框掛載後由 effect 設定初始焦點。
      await waitFor(() =>
        expect(
          within(cancelDialog).getByRole('heading', {
            name: /取消任務「橋梁外牆複查」/,
          }),
        ).toHaveFocus(),
      )
      fireEvent.change(screen.getByLabelText(/取消原因/), {
        target: { value: '現場順序調整' },
      })
      await click(
        within(cancelDialog).getByRole('button', { name: '取消任務' }),
      )
      await screen.findByText('取消原因：現場順序調整')
      await expectNotice('已取消任務，之後可以恢復。')

      const cancelledTask = screen
        .getByRole('heading', {
          name: /橋梁外牆複查\s+（已取消）/,
        })
        .closest('article') as HTMLElement
      await click(
        within(cancelledTask).getByRole('button', {
          name: '恢復任務',
        }),
      )
      expect(screen.getByRole('dialog')).toHaveTextContent(
        '任務將恢復至取消前狀態。',
      )
      expect(
        screen.getByRole('heading', { name: '恢復這個任務？' }),
      ).toBeVisible()
      await click(screen.getByRole('button', { name: '確認恢復' }))
      await screen.findByRole('heading', {
        name: /橋梁外牆複查\s+（待開始）/,
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
    render(
      <CurrentUserProvider
        value={{ user: currentUserFixture(), clear: vi.fn() }}
      >
        <PlanningPage client={client} initialProjectId="project-demo-1" />
      </CurrentUserProvider>,
    )

    await screen.findByRole('heading', { name: '查核計畫' })
    await openPlanCreationForm()
    fireEvent.change(screen.getByLabelText(/計畫名稱/), {
      target: { value: '拒絕的計畫' },
    })
    await click(screen.getByRole('button', { name: '建立計畫' }))

    const readOnlyNotice = await screen.findByRole('status')
    expect(readOnlyNotice).toHaveTextContent(READ_ONLY_NOTICE)
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '建立計畫' })).toBeNull()
    })
    expect(screen.getByRole('status')).toHaveTextContent(READ_ONLY_NOTICE)
  })

  it('shows a permission page when planning reads return 403', async () => {
    const client = createMockPlanningClient()
    client.listPlans = async () => {
      throw new ManagementApiError(403, 'permission.denied')
    }
    render(
      <CurrentUserProvider
        value={{ user: currentUserFixture(), clear: vi.fn() }}
      >
        <PlanningPage client={client} initialProjectId="project-demo-1" />
      </CurrentUserProvider>,
    )

    expect(
      await screen.findByRole('heading', { name: '無權限' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      '你沒有使用這個頁面的權限',
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('link', { name: '回到我的首頁' })).toHaveAttribute(
      'href',
      '/settings',
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

    await openPlanCreationForm()
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
    await click(await screen.findByRole('link', { name: '既有計畫（草稿）' }))
    expect(await screen.findByText(plan.name)).toBeInTheDocument()
    await click(screen.getByRole('button', { name: '修改計畫名稱' }))

    const renameForm = document.querySelector(
      'form[data-error-context="plan-rename"]',
    ) as HTMLFormElement
    fireEvent.submit(renameForm)

    expect(await within(renameForm).findByRole('alert')).toHaveTextContent(
      '計畫已封存，無法修改。',
    )
    await click(screen.getByRole('link', { name: '返回計畫清單' }))
    await openPlanCreationForm()
    expect(
      document.querySelector(
        '[data-error-context="plan-create"] [role="alert"]',
      ),
    ).toBeNull()
  })

  it('shows a plan-detail read error at page level', async () => {
    const client = createMockPlanningClient()
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await screen.findByRole('heading', { name: '查核計畫' })

    await openPlanCreationForm()
    fireEvent.change(screen.getByLabelText(/計畫名稱/), {
      target: { value: '既有計畫' },
    })
    await click(screen.getByRole('button', { name: '建立計畫' }))
    await expectNotice('已建立計畫，接著新增任務。')
    await click(screen.getByRole('link', { name: '返回計畫清單' }))
    const planButton = await screen.findByRole('link', {
      name: '既有計畫（草稿）',
    })

    client.getPlan = async () => {
      throw new ManagementApiError(500, 'inspection_plan.unavailable')
    }
    await click(planButton)

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
    await client.createPlan('project-demo-1', { name: '唯讀計畫' })
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
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await click(await screen.findByRole('link', { name: '唯讀計畫（草稿）' }))
    await openTaskCreationForm()
    const form = document.querySelector(
      '[data-error-context="task"]',
    ) as HTMLFormElement
    expect(
      within(form).getByText(ASSIGNEE_LIST_UNAVAILABLE_NOTICE),
    ).toBeInTheDocument()
    expect(within(form).queryByRole('button', { name: '重試' })).toBeNull()
  })

  it('shows unavailable assignee lookup beside the task field', async () => {
    const client = createMockPlanningClient()
    await client.createPlan('project-demo-1', { name: '人員查詢失敗' })
    const available = await client.listProjectAssignees('project-demo-1')
    let attempts = 0
    client.listProjectAssignees = async () => {
      if (attempts++ === 0) {
        throw new ManagementApiError(503, 'inspection_task.unavailable')
      }
      return available
    }
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)

    expect(
      await screen.findByText(
        '計畫的狀態會跟著任務自動更新；任務派出後，現場才看得到。',
      ),
    ).toBeVisible()
    await click(
      await screen.findByRole('link', { name: '人員查詢失敗（草稿）' }),
    )
    await openTaskCreationForm()

    const form = document.querySelector(
      '[data-error-context="task"]',
    ) as HTMLFormElement
    const selector = within(form).getByLabelText('建議指派人')
    const hint = within(form).getByText('成員名單暫時載入失敗')
    expect(selector).toBeDisabled()
    expect(selector).toHaveAttribute('aria-describedby', hint.id)
    expect(within(form).getByRole('option', { name: '不指定' })).toBeVisible()
    await click(within(form).getByRole('button', { name: '重試' }))
    await waitFor(() => expect(selector).toBeEnabled())
    await waitFor(() => expect(selector).toHaveFocus())
    expect(
      within(form).queryByText('成員名單暫時載入失敗'),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('focuses the assignee field after a retry fails', async () => {
    const client = createMockPlanningClient()
    await client.createPlan('project-demo-1', { name: '重試失敗' })
    let attempts = 0
    client.listProjectAssignees = async () => {
      attempts += 1
      throw new ManagementApiError(503, 'inspection_task.unavailable')
    }
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await click(await screen.findByRole('link', { name: '重試失敗（草稿）' }))
    await openTaskCreationForm()
    const form = document.querySelector(
      '[data-error-context="task"]',
    ) as HTMLFormElement
    const selector = within(form).getByLabelText('建議指派人')
    const hint = within(form).getByText('成員名單暫時載入失敗')
    await click(within(form).getByRole('button', { name: '重試' }))
    await waitFor(() =>
      expect(within(form).getByRole('button', { name: '重試' })).toBeEnabled(),
    )
    expect(selector).toBeDisabled()
    await waitFor(() => expect(hint).toHaveFocus())
    expect(attempts).toBe(2)
  })

  it('clears retrying members when switching projects during a retry', async () => {
    const client = createMockPlanningClient()
    await client.createPlan('project-demo-1', { name: 'A 專案' })
    await client.createPlan('project-demo-2', { name: 'B 專案' })
    const retryRequest =
      deferred<Awaited<ReturnType<PlanningClient['listProjectAssignees']>>>()
    let projectOneRequests = 0
    client.listProjectAssignees = async (projectId) => {
      if (projectId === 'project-demo-2') {
        throw new ManagementApiError(503, 'inspection_task.unavailable')
      }
      if (projectOneRequests++ === 0) {
        throw new ManagementApiError(503, 'inspection_task.unavailable')
      }
      return retryRequest.promise
    }
    const { rerender } = render(
      <PlanningPage client={client} initialProjectId="project-demo-1" />,
    )
    await click(await screen.findByRole('link', { name: 'A 專案（草稿）' }))
    await openTaskCreationForm()
    const form = document.querySelector(
      '[data-error-context="task"]',
    ) as HTMLFormElement
    await click(within(form).getByRole('button', { name: '重試' }))
    expect(
      await within(form).findByRole('button', { name: '重試中…' }),
    ).toBeDisabled()

    rerender(
      <PlanningPage client={client} initialProjectId="project-demo-2" />,
    )
    expect(await screen.findByText('專案：示範工程 B')).toBeInTheDocument()
    await click(await screen.findByRole('link', { name: 'B 專案（草稿）' }))
    await openTaskCreationForm()
    const nextForm = document.querySelector(
      '[data-error-context="task"]',
    ) as HTMLFormElement
    await waitFor(() =>
      expect(
        within(nextForm).getByRole('button', { name: '重試' }),
      ).toBeEnabled(),
    )
    expect(
      within(nextForm).queryByRole('button', { name: '重試中…' }),
    ).toBeNull()
    retryRequest.resolve([])
  })

  it('deletes draft tasks through a confirmation dialog', async () => {
    const client = createMockPlanningClient()
    await client.createZone('project-demo-1', '北區')
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await screen.findByRole('heading', { name: '計畫與任務' })
    await openPlanCreationForm()
    fireEvent.change(screen.getByLabelText(/計畫名稱/), {
      target: { value: '草稿刪除' },
    })
    await click(screen.getByRole('button', { name: '建立計畫' }))
    await expectNotice('已建立計畫，接著新增任務。')
    await click(screen.getByRole('link', { name: '返回計畫清單' }))
    await click(await screen.findByRole('link', { name: '草稿刪除（草稿）' }))
    await openTaskCreationForm()
    await click(await screen.findByLabelText(/混凝土外觀/))
    const zone = (await client.listProjectZones('project-demo-1')).find(
      (entry) => entry.name === '北區',
    )!
    fireEvent.change(screen.getByLabelText(/任務分區/), {
      target: { value: zone.id },
    })
    fireEvent.change(screen.getByLabelText('補充地點'), {
      target: { value: '東側二樓' },
    })
    await click(screen.getByRole('button', { name: '建立草稿任務' }))
    const task = await screen.findByRole('heading', {
      name: /混凝土外觀－北區\s+（草稿）/,
    })
    const article = task.closest('article') as HTMLElement
    await openTaskDetail()
    await click(within(article).getByRole('button', { name: '刪除草稿' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    // 計畫頁是唯一保留 modal 的確認框（#501）：蓋住整頁、背景 inert。
    expect(dialog).toHaveClass('confirm-box', 'confirm-box-modal')
    expect(dialog).toHaveClass('confirm-box-danger')
    await waitFor(() =>
      expect(
        within(dialog).getByRole('heading', { name: '刪除這個草稿？' }),
      ).toHaveFocus(),
    )
    expect(dialog).toHaveTextContent(
      '任務「混凝土外觀－北區」（查核項目：混凝土外觀）。',
    )
    expect(dialog).toHaveTextContent('。刪除後無法復原。')
    expect(within(dialog).queryByRole('button', { name: '確認' })).toBeNull()
    const remove = within(dialog).getByRole('button', { name: '確認刪除' })
    expect(remove).toHaveClass('btn-danger')
    // 確認與取消固定排成 [取消][確認]，取消一律叫「取消」（#500）。
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['取消', '確認刪除'])
    expect(
      within(dialog).getByRole('button', { name: '取消' }),
    ).not.toHaveClass('btn-danger')
    await click(remove)
    expect(await screen.findByText('尚未建立任務。')).toBeInTheDocument()
    await expectNotice('已刪除草稿任務。')
  })

  it('marks the selected plan in the plan list (#500)', async () => {
    const client = createMockPlanningClient()
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await screen.findByRole('heading', { name: '計畫與任務' })
    await openPlanCreationForm()
    fireEvent.change(screen.getByLabelText(/計畫名稱/), {
      target: { value: '選取樣式' },
    })
    const create = screen.getByRole('button', { name: '建立計畫' })
    expect(create).toHaveClass('btn-primary')
    await click(create)
    await expectNotice('已建立計畫，接著新增任務。')
    await click(screen.getByRole('link', { name: '返回計畫清單' }))
    const plan = await screen.findByRole('link', {
      name: '選取樣式（草稿）',
    })
    expect(plan.closest('ul')).toHaveClass('plan-list')
    expect(plan.getAttribute('href')).toMatch(/\/planning\/[^/]+$/)
    await click(plan)
    expect(
      await screen.findByRole('heading', { name: '選取樣式' }),
    ).toHaveFocus()
    expect(screen.queryByRole('link', { name: '選取樣式（草稿）' })).toBeNull()
  })

  it('scrolls to and focuses the selected plan heading', async () => {
    const originalScroll = HTMLElement.prototype.scrollIntoView
    const scroll = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scroll,
    })
    try {
      const client = createMockPlanningClient()
      await client.createPlan('project-demo-1', { name: '定位計畫' })
      render(
        <PlanningPage client={client} initialProjectId="project-demo-1" />,
      )
      await click(
        await screen.findByRole('link', { name: '定位計畫（草稿）' }),
      )
      const heading = await screen.findByRole('heading', { name: '定位計畫' })
      await waitFor(() => expect(heading).toHaveFocus())
      expect(scroll).toHaveBeenCalledWith({ block: 'start' })
    } finally {
      if (originalScroll) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
          configurable: true,
          value: originalScroll,
        })
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
      }
    }
  })

  it('lists items to choose without per-template numbers (#487)', async () => {
    const client = createMockPlanningClient()
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await screen.findByRole('heading', { name: '計畫與任務' })
    await openPlanCreationForm()
    fireEvent.change(screen.getByLabelText(/計畫名稱/), {
      target: { value: '項次檢查' },
    })
    await click(screen.getByRole('button', { name: '建立計畫' }))
    await expectNotice('已建立計畫，接著新增任務。')
    await click(screen.getByRole('link', { name: '返回計畫清單' }))
    await click(await screen.findByRole('link', { name: '項次檢查（草稿）' }))
    await openTaskCreationForm()
    const label = (await screen.findByLabelText(/混凝土外觀/)).closest('label')
    expect(label?.textContent).toMatch(/^混凝土外觀/)
  })

  it('omits the separator when an item has no instruction', async () => {
    const client = createMockPlanningClient()
    const listItems = client.listProjectItems.bind(client)
    client.listProjectItems = async (projectId) => {
      const items = await listItems(projectId)
      return items.map((item, index) =>
        index === 0 ? { ...item, instruction: '' } : item,
      )
    }
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await openPlanCreationForm()
    fireEvent.change(await screen.findByLabelText(/計畫名稱/), {
      target: { value: '無說明項目' },
    })
    await click(screen.getByRole('button', { name: '建立計畫' }))
    await expectNotice('已建立計畫，接著新增任務。')
    await click(screen.getByRole('link', { name: '返回計畫清單' }))
    await click(
      await screen.findByRole('link', { name: '無說明項目（草稿）' }),
    )
    await openTaskCreationForm()

    const itemLabel = (await screen.findByLabelText(/混凝土外觀/)).closest(
      'label',
    )
    expect(itemLabel).toHaveTextContent('混凝土外觀')
    expect(itemLabel).not.toHaveTextContent('—')
  })

  it('suggests a single item name with optional supplemental location', async () => {
    const client = createMockPlanningClient()
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await openPlanCreationForm()
    fireEvent.change(await screen.findByLabelText(/計畫名稱/), {
      target: { value: '單項名稱' },
    })
    await click(screen.getByRole('button', { name: '建立計畫' }))
    await expectNotice('已建立計畫，接著新增任務。')
    await click(screen.getByRole('link', { name: '返回計畫清單' }))
    await click(await screen.findByRole('link', { name: '單項名稱（草稿）' }))
    await openTaskCreationForm()
    await click(await screen.findByLabelText(/鋼筋保護層/))
    expect(screen.getByLabelText(/任務名稱/)).toHaveValue('鋼筋保護層')
    fireEvent.change(screen.getByLabelText('補充地點'), {
      target: { value: '東側' },
    })
    expect(screen.getByLabelText(/任務名稱/)).toHaveValue('鋼筋保護層－東側')
  })

  it('truncates suggested task names at 128 characters', async () => {
    const client = createMockPlanningClient()
    const listItems = client.listProjectItems.bind(client)
    client.listProjectItems = async (projectId) =>
      (await listItems(projectId)).map((item, index) =>
        index === 0 ? { ...item, title: '甲'.repeat(140) } : item,
      )
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await openPlanCreationForm()
    fireEvent.change(await screen.findByLabelText(/計畫名稱/), {
      target: { value: '名稱長度' },
    })
    await click(screen.getByRole('button', { name: '建立計畫' }))
    await expectNotice('已建立計畫，接著新增任務。')
    await click(screen.getByRole('link', { name: '返回計畫清單' }))
    await click(await screen.findByRole('link', { name: '名稱長度（草稿）' }))
    await openTaskCreationForm()
    await click(await screen.findByLabelText(/甲{5}/))
    expect(screen.getByLabelText(/任務名稱/)).toHaveValue('甲'.repeat(128))
  })

  it('keeps task creation collapsed and lists existing tasks', async () => {
    const client = createMockPlanningClient()
    const plan = await client.createPlan('project-demo-1', {
      name: '既有任務清單',
    })
    const [item] = await client.listProjectItems('project-demo-1')
    await client.createTask(plan.id, {
      name: '混凝土外觀',
      item_ids: [item.id],
      suggested_assignee_id: null,
      zone_id: null,
      location_text: null,
    })
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await click(
      await screen.findByRole('link', { name: '既有任務清單（草稿）' }),
    )

    expect(
      screen.queryByRole('button', { name: '建立草稿任務' }),
    ).not.toBeInTheDocument()
    await openTaskCreationForm()
    const summary = screen.getAllByText('本計畫已有 1 筆任務')[0]
    expect(summary).toHaveStyle({ minHeight: '44px' })
    // display:flex 會移除 <summary> 的展開箭頭，所以只用 min-height。
    expect(summary.style.display).toBe('')
    await click(summary)
    expect(
      within(summary.parentElement as HTMLElement).getByText('混凝土外觀'),
    ).toBeVisible()

    const itemCheckbox = screen.getByLabelText(/混凝土外觀/)
    await click(itemCheckbox)
    expect(itemCheckbox).toBeChecked()
    expect(
      screen.getByText('此項目已在本計畫任務中使用；仍可建立另一筆任務。'),
    ).toBeVisible()
    await click(screen.getByRole('button', { name: '建立草稿任務' }))
    await expectNotice('已建立草稿任務，派出後現場才看得到。')
    await click(screen.getByRole('link', { name: '返回計畫詳情' }))
    const addTaskButton = screen.getByRole('button', {
      name: '＋ 新增任務',
    })
    expect(addTaskButton).toBeVisible()
    await click(screen.getByRole('button', { name: '＋ 新增任務' }))
    expect(
      screen.queryByText('已建立草稿任務，派出後現場才看得到。'),
    ).not.toBeInTheDocument()
  })

  it('edits a task name in place and can cancel the edit', async () => {
    const client = createMockPlanningClient()
    const plan = await client.createPlan('project-demo-1', {
      name: '任務名稱編輯',
    })
    const [item] = await client.listProjectItems('project-demo-1')
    const task = await client.createTask(plan.id, {
      name: '原任務名稱',
      item_ids: [item.id],
      suggested_assignee_id: null,
      zone_id: null,
      location_text: null,
    })
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await click(
      await screen.findByRole('link', { name: '任務名稱編輯（草稿）' }),
    )
    const heading = await screen.findByRole('heading', {
      name: /原任務名稱\s+（草稿）/,
    })
    const article = heading.closest('article') as HTMLElement
    await openTaskDetail()
    await click(within(article).getByRole('button', { name: '修改名稱' }))
    const nameInput = within(article).getByLabelText(/任務名稱/)
    fireEvent.change(nameInput, { target: { value: '取消的名稱' } })
    await click(within(article).getByRole('button', { name: '取消' }))
    const discardDialog = screen.getByRole('group', {
      name: '有尚未儲存的變更',
    })
    expect(discardDialog).toHaveTextContent('修改內容尚未儲存')
    await click(
      within(discardDialog).getByRole('button', { name: '保留編輯' }),
    )
    expect(within(article).getByLabelText(/任務名稱/)).toHaveValue(
      '取消的名稱',
    )
    await click(within(article).getByRole('button', { name: '取消' }))
    await click(
      within(
        screen.getByRole('group', { name: '有尚未儲存的變更' }),
      ).getByRole('button', {
        name: '捨棄變更',
      }),
    )
    await waitFor(() =>
      expect(within(article).queryByLabelText(/任務名稱/)).toBeNull(),
    )
    await waitFor(() =>
      expect(
        within(article).getByRole('button', { name: '修改名稱' }),
      ).toHaveFocus(),
    )
    expect(
      within(article).getByRole('heading', {
        name: /原任務名稱\s+（草稿）/,
      }),
    ).toBeInTheDocument()

    await click(within(article).getByRole('button', { name: '修改名稱' }))
    fireEvent.change(within(article).getByLabelText(/任務名稱/), {
      target: { value: '更新後名稱' },
    })
    await click(within(article).getByRole('button', { name: '儲存名稱' }))
    expect(
      await within(article).findByRole('heading', {
        name: /更新後名稱\s+（草稿）/,
      }),
    ).toBeInTheDocument()
    await expectNotice('已更新任務名稱。')
    expect((await client.getTask(task.id)).name).toBe('更新後名稱')
  })

  it('hides actions on archived plans and restores them', async () => {
    const client = createMockPlanningClient()
    const plan = await client.createPlan('project-demo-1', {
      name: '封存驗收',
    })
    const [item] = await client.listProjectItems('project-demo-1')
    const task = await client.createTask(plan.id, {
      name: '混凝土外觀',
      item_ids: [item.id],
      suggested_assignee_id: null,
      zone_id: null,
      location_text: null,
    })
    await client.dispatchTask(task.id)
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await click(
      await screen.findByRole('link', { name: '封存驗收（進行中）' }),
    )
    const article = (
      await screen.findByRole('heading', {
        name: /混凝土外觀\s+（待開始）/,
      })
    ).closest('article') as HTMLElement
    const archiveButton = screen.getByRole('button', { name: '封存計畫' })
    // 封存鈕與「修改計畫名稱」同一列，間距只由「任務」標題的上邊距提供。
    expect(archiveButton.parentElement).toBe(
      screen.getByRole('button', { name: '修改計畫名稱' }).parentElement,
    )
    expect(
      screen.getByRole('heading', { name: '任務' }).parentElement,
    ).toHaveClass('planning-section-title')
    await click(screen.getByRole('button', { name: '封存計畫' }))
    expect(
      screen.getByRole('heading', { name: '封存這個計畫？' }),
    ).toBeVisible()
    expect(
      within(screen.getByRole('dialog')).getByText('封存期間任務將唯讀。'),
    ).toBeVisible()
    await click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: '確認封存',
      }),
    )
    await waitFor(() =>
      expect(screen.getByText(/計畫狀態：/)).toHaveTextContent(
        '計畫狀態：已封存',
      ),
    )
    await expectNotice('已封存計畫。')
    await openTaskDetail()
    expect(
      screen.getByRole('heading', {
        name: /混凝土外觀.*（待開始）/,
        level: 2,
      }),
    ).toBeVisible()
    expect(
      within(article).queryByRole('button', { name: '修改地點' }),
    ).toBeNull()
    expect(
      within(article).queryByRole('button', { name: '取消任務' }),
    ).toBeNull()
    await click(screen.getByRole('link', { name: '返回計畫詳情' }))
    await click(screen.getByRole('button', { name: '取消封存' }))
    expect(
      screen.getByRole('heading', { name: '取消封存這個計畫？' }),
    ).toBeVisible()
    expect(
      within(screen.getByRole('dialog')).getByText(
        '取消封存後依目前任務重算計畫狀態。',
      ),
    ).toBeVisible()
    await click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: '確認取消封存',
      }),
    )
    await expectNotice('已取消封存計畫。')
    await openTaskDetail()
    expect(
      await within(article).findByRole('button', { name: '修改地點' }),
    ).toBeInTheDocument()
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

    await openPlanCreationForm()
    fireEvent.change(screen.getByLabelText(/計畫名稱/), {
      target: { value: 'A 專用計畫' },
    })
    await click(screen.getByRole('button', { name: '建立計畫' }))
    await expectNotice('已建立計畫，接著新增任務。')
    await click(screen.getByRole('link', { name: '返回計畫清單' }))
    await screen.findByRole('link', { name: 'A 專用計畫（草稿）' })

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
      screen.queryByRole('link', { name: 'A 專用計畫（草稿）' }),
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
    await openPlanCreationForm()
    fireEvent.change(screen.getByLabelText(/計畫名稱/), {
      target: { value: 'B 專案計畫' },
    })
    await click(screen.getByRole('button', { name: '建立計畫' }))
    await expectNotice('已建立計畫，接著新增任務。')
    await click(screen.getByRole('link', { name: '返回計畫清單' }))
    const planButton = await screen.findByRole('link', {
      name: 'B 專案計畫（草稿）',
    })
    await click(planButton)
    await openTaskCreationForm()

    await click(await screen.findByLabelText(/材料進場查驗/))
    fireEvent.change(screen.getByLabelText('建議指派人'), {
      target: { value: 'project-b-member-1' },
    })
    await click(screen.getByRole('button', { name: '建立草稿任務' }))
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
    await openPlanCreationForm()
    fireEvent.change(screen.getByLabelText(/計畫名稱/), {
      target: { value: '無分區計畫' },
    })
    await click(screen.getByRole('button', { name: '建立計畫' }))
    await expectNotice('已建立計畫，接著新增任務。')
    await click(screen.getByRole('link', { name: '返回計畫清單' }))
    await click(
      await screen.findByRole('link', { name: '無分區計畫（草稿）' }),
    )
    await openTaskCreationForm()
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
      name: '已完成任務',
      item_ids: [item.id],
      suggested_assignee_id: null,
      zone_id: null,
      location_text: null,
    })
    await client.dispatchTask(completed.id)
    await client.startTask(completed.id)
    await client.completeTask(completed.id)
    const cancelled = await client.createTask(plan.id, {
      name: '已取消任務',
      item_ids: [item.id],
      suggested_assignee_id: null,
      zone_id: null,
      location_text: null,
    })
    await client.dispatchTask(cancelled.id)
    await client.cancelTask(cancelled.id, '取消驗收')
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await click(
      await screen.findByRole('link', { name: '唯讀狀態（已完成）' }),
    )
    for (const name of ['已完成任務', '已取消任務']) {
      await click(await screen.findByRole('link', { name }))
      expect(
        await screen.findByRole('heading', {
          name: new RegExp(name),
          level: 2,
        }),
      ).toBeVisible()
      for (const action of ['修改地點', '修改名稱', '修改建議指派']) {
        expect(screen.queryByRole('button', { name: action })).toBeNull()
      }
      if (name === '已取消任務') {
        expect(screen.getByText('取消原因：取消驗收')).toBeInTheDocument()
      }
      await click(screen.getByRole('link', { name: '返回計畫詳情' }))
    }
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
      await click(
        await screen.findByRole('link', { name: '橋梁查核（草稿）' }),
      )
      await click(await screen.findByRole('button', { name: '＋ 新增任務' }))
      await click(await screen.findByLabelText(/混凝土外觀/))

      expect(document.getElementById('task-zone-hint')).toHaveClass(
        'field-hint',
      )
      expect(document.querySelector('.field-error')).toBeNull()

      await click(screen.getByRole('button', { name: '建立草稿任務' }))
      const select = screen.getByLabelText(/任務分區/)
      const error = await screen.findByText('請選擇任務分區。')
      expect(error).toHaveClass('field-error')
      expect(select).toHaveAttribute('aria-invalid', 'true')
      expect(select.getAttribute('aria-describedby')).toContain(error.id)
      await waitFor(() => expect(select).toHaveFocus())
      expect((await client.getPlan(plan.id)).tasks ?? []).toHaveLength(0)

      // 選了分區，錯誤就消失，再送出就會建立。
      fireEvent.change(select, { target: { value: zone.id } })
      expect(screen.queryByText('請選擇任務分區。')).toBeNull()
      await click(screen.getByRole('button', { name: '建立草稿任務' }))
      await expectNotice('已建立草稿任務，派出後現場才看得到。')
    })

    it('rejects a blank plan name on submit and focuses the field', async () => {
      const client = createMockPlanningClient()
      const createPlan = vi.spyOn(client, 'createPlan')
      render(
        <PlanningPage client={client} initialProjectId="project-demo-1" />,
      )
      await screen.findByRole('heading', { name: '查核計畫' })
      await openPlanCreationForm()
      const input = screen.getByLabelText(/計畫名稱/)
      await click(screen.getByRole('button', { name: '建立計畫' }))

      const error = await screen.findByText('請輸入計畫名稱。')
      expect(error).toHaveClass('field-error')
      expect(input).toHaveAttribute('aria-invalid', 'true')
      await waitFor(() => expect(input).toHaveFocus())
      expect(createPlan).not.toHaveBeenCalled()
    })

    it('confirms before leaving changed forms or unloading the page', async () => {
      const client = createMockPlanningClient()
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      renderWithoutRouter(
        <DataMemoryRouter
          initialEntries={['/projects/project-demo-1/planning']}
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
              path="/projects/:projectId/planning/*"
            />
            <Route element={<p>已離開計畫頁</p>} path="/outside" />
          </Routes>
        </DataMemoryRouter>,
      )

      await openPlanCreationForm()
      fireEvent.change(await screen.findByLabelText(/計畫名稱/), {
        target: { value: '尚未儲存的計畫' },
      })
      const unload = new Event('beforeunload', {
        cancelable: true,
      }) as BeforeUnloadEvent
      window.dispatchEvent(unload)
      expect(unload.defaultPrevented).toBe(true)

      await click(screen.getByRole('link', { name: '切換頁面' }))
      const box = await screen.findByRole('group', {
        name: '有尚未儲存的變更',
      })
      expect(confirm).not.toHaveBeenCalled()
      expect(screen.queryByText('已離開計畫頁')).toBeNull()

      await click(within(box).getByRole('button', { name: '保留編輯' }))
      expect(screen.getByLabelText(/計畫名稱/)).toHaveValue('尚未儲存的計畫')

      await click(screen.getByRole('link', { name: '切換頁面' }))
      await click(
        within(await screen.findByRole('group')).getByRole('button', {
          name: '捨棄變更',
        }),
      )
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
      await openPlanCreationForm()
      fireEvent.change(screen.getByLabelText(/計畫名稱/), {
        target: { value: '橋梁查核' },
      })
      await click(screen.getByRole('button', { name: '建立計畫' }))

      await expectNotice('已建立計畫，接著新增任務。')
      await openPlanCreationForm()
      expect(screen.getByLabelText(/計畫名稱/)).toHaveValue('')
    })

    it('clears the task form after a task is created', async () => {
      const client = createMockPlanningClient()
      const zone = await client.createZone('project-demo-1', '北區')
      await client.createPlan('project-demo-1', { name: '橋梁查核' })
      render(
        <PlanningPage client={client} initialProjectId="project-demo-1" />,
      )
      await click(
        await screen.findByRole('link', { name: '橋梁查核（草稿）' }),
      )
      await click(await screen.findByRole('button', { name: '＋ 新增任務' }))
      const item = await screen.findByLabelText(/混凝土外觀/)
      await click(item)
      fireEvent.change(screen.getByLabelText(/任務分區/), {
        target: { value: zone.id },
      })
      fireEvent.change(screen.getByLabelText('補充地點'), {
        target: { value: '東側二樓' },
      })
      await click(screen.getByRole('button', { name: '建立草稿任務' }))

      await expectNotice('已建立草稿任務，派出後現場才看得到。')
      expect(
        screen.queryByRole('button', { name: '建立草稿任務' }),
      ).not.toBeInTheDocument()
      const returnLink = screen.getByRole('link', { name: '返回計畫詳情' })
      expect(returnLink).toBeVisible()
      await waitFor(() =>
        expect(
          screen.getByRole('heading', { name: /混凝土外觀.*（草稿）/ }),
        ).toHaveFocus(),
      )
      await click(screen.getByRole('link', { name: '返回計畫詳情' }))
      await click(screen.getByRole('button', { name: '＋ 新增任務' }))
      expect(screen.getByLabelText(/混凝土外觀/)).not.toBeChecked()
      expect(screen.getByLabelText(/任務分區/)).toHaveValue('')
      expect(screen.getByLabelText('補充地點')).toHaveValue('')
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
  function hold(client: PlanningPageClient, method: Method) {
    const gate = deferred()
    const original = client[method] as (...args: unknown[]) => Promise<unknown>
    const spy = vi.fn(async (...args: unknown[]) => {
      await gate.promise
      return original.apply(client, args)
    })
    ;(client as unknown as Record<string, unknown>)[method] = spy
    return { gate, spy }
  }

  function watch(client: PlanningPageClient, method: Method) {
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
      name: '混凝土外觀',
      item_ids: [items[0].id],
      suggested_assignee_id: null,
      zone_id: zone.id,
      location_text: null,
    })
    if (dispatched) await client.dispatchTask(task.id)
    return { client, zone, plan, task }
  }

  async function openPlan(
    client: PlanningPageClient,
    mode: 'plan' | 'task' | 'new' = 'task',
  ) {
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    const originalPlanButton = await screen.findByRole('link', {
      name: /橋梁查核（/,
    })
    await click(originalPlanButton)
    if (mode === 'new') {
      await openTaskCreationForm()
      return document.querySelector('#task-creation-form') as HTMLElement
    }
    if (mode === 'task') await openTaskDetail()
    return (
      await screen.findByRole('heading', { name: /混凝土外觀/ })
    ).closest('article') as HTMLElement
  }

  const formByContext = (context: string) =>
    document.querySelector(
      `[data-error-context="${context}"]`,
    ) as HTMLFormElement

  it('preserves assignments when assignee lookup fails', async () => {
    const { client, task } = await seeded()
    await client.setSuggestedAssignee(task.id, 'project-a-member-1')
    const saveAssignee = vi.spyOn(client, 'setSuggestedAssignee')
    client.listProjectAssignees = async () => {
      throw new ManagementApiError(503, 'inspection_task.unavailable')
    }
    const article = await openPlan(client)
    await click(within(article).getByRole('button', { name: '修改建議指派' }))

    const form = formByContext('assignee')
    const selector = within(form).getByLabelText('建議指派人')
    const formHeading = screen.getByRole('heading', {
      name: /^修改建議指派｜/,
      level: 2,
    })
    await waitFor(() => expect(formHeading).toHaveFocus())
    expect(selector).toBeDisabled()
    expect(selector).toHaveValue('project-a-member-1')
    expect(selector).toHaveAttribute(
      'aria-describedby',
      `assignee-list-unavailable-${task.id}`,
    )
    expect(saveAssignee).not.toHaveBeenCalled()

    await click(within(form).getByRole('button', { name: '儲存建議指派' }))

    await expectNotice('已更新建議指派。')
    expect(saveAssignee).toHaveBeenCalledOnce()
    expect(saveAssignee).toHaveBeenCalledWith(task.id, 'project-a-member-1')
  })

  it('confirms plan switches with a dirty task form (ADM-R38)', async () => {
    const { client } = await seeded()
    await client.createPlan('project-demo-1', {
      name: '第二計畫',
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    const originalPlanButton = await screen.findByRole('link', {
      name: /橋梁查核（/,
    })
    await click(originalPlanButton)
    await openTaskCreationForm()
    fireEvent.change(screen.getByLabelText('補充地點'), {
      target: { value: '尚未儲存的地點' },
    })

    await click(screen.getByRole('link', { name: '返回計畫詳情' }))
    expect(confirm).not.toHaveBeenCalled()
    expect(
      await screen.findByRole('group', { name: '有尚未儲存的變更' }),
    ).toBeVisible()
    const locationInput = screen.getByLabelText('補充地點')
    expect(locationInput).toHaveValue('尚未儲存的地點')
    expect(
      screen.getByRole('heading', { name: '新增任務', level: 2 }),
    ).toBeVisible()

    await click(screen.getByRole('button', { name: '捨棄變更' }))
    await click(screen.getByRole('link', { name: '返回計畫清單' }))
    await click(screen.getByRole('link', { name: /第二計畫（/ }))
    expect(
      await screen.findByRole('heading', { name: '第二計畫' }),
    ).toBeVisible()
    expect(screen.queryByLabelText('補充地點')).toBeNull()
    const addTaskButton = screen.getByRole('button', {
      name: '＋ 新增任務',
    })
    expect(addTaskButton).toBeVisible()
  })

  it('maps plan creation 422 fields and focuses the reported name', async () => {
    const client = createMockPlanningClient()
    client.createPlan = vi
      .fn()
      .mockRejectedValue(validationError(planNameValidation))
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await openPlanCreationForm()
    const input = await screen.findByLabelText(/計畫名稱/)
    fireEvent.change(input, { target: { value: '長名稱' } })
    await click(screen.getByRole('button', { name: '建立計畫' }))

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
    await openPlan(client, 'plan')
    await click(screen.getByRole('button', { name: '修改計畫名稱' }))
    const form = formByContext('plan-rename')
    const input = within(form).getByLabelText(/計畫名稱/)
    fireEvent.change(input, { target: { value: '更新名稱' } })
    await click(within(form).getByRole('button', { name: '儲存計畫名稱' }))

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
    await openPlan(client, 'new')
    const form = formByContext('task')
    await click(within(form).getByLabelText(/鋼筋保護層/))
    fireEvent.change(within(form).getByLabelText(/任務分區/), {
      target: { value: zone.id },
    })
    fireEvent.change(within(form).getByLabelText('補充地點'), {
      target: { value: '東側' },
    })
    await click(within(form).getByRole('button', { name: '建立草稿任務' }))

    expect(await within(form).findAllByText('輸入內容太長。')).toHaveLength(3)
    expect(
      within(form).getAllByText('欄位格式不正確，請檢查輸入內容。'),
    ).toHaveLength(2)
    expect(within(form).getByLabelText(/任務名稱/)).toHaveAttribute(
      'aria-invalid',
      'true',
    )
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
    // 任務名稱在表單最前面，/name 錯誤是第一個被回報的欄位。
    await waitFor(() =>
      expect(within(form).getByLabelText(/任務名稱/)).toHaveFocus(),
    )
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a blank task name beside the field and focuses it', async () => {
    const { client } = await seeded()
    const spy = watch(client, 'createTask')
    await openPlan(client, 'new')
    const form = formByContext('task')
    await click(within(form).getByLabelText(/鋼筋保護層/))
    const input = within(form).getByLabelText(/任務名稱/)
    expect(
      input.closest('label')?.querySelector('.required-label .required-mark'),
    ).not.toBeNull()
    fireEvent.change(input, { target: { value: '   ' } })
    await click(within(form).getByRole('button', { name: '建立草稿任務' }))

    expect(await within(form).findByText('請輸入任務名稱。')).toBeVisible()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(input).toHaveFocus())
    expect(spy).not.toHaveBeenCalled()
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('maps the server invalid_name code on creation to the name field', async () => {
    const { client, zone } = await seeded()
    client.createTask = vi
      .fn()
      .mockRejectedValue(
        new ManagementApiError(422, 'inspection_task.invalid_name'),
      )
    await openPlan(client, 'new')
    const form = formByContext('task')
    await click(within(form).getByLabelText(/鋼筋保護層/))
    fireEvent.change(within(form).getByLabelText(/任務分區/), {
      target: { value: zone.id },
    })
    const input = within(form).getByLabelText(/任務名稱/)
    await click(within(form).getByRole('button', { name: '建立草稿任務' }))

    expect(
      await within(form).findByText('任務名稱需為 1 到 128 個字元。'),
    ).toBeVisible()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(input).toHaveFocus())
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('maps task location 422 fields and focuses the first reported field', async () => {
    const { client, zone } = await seeded()
    client.updateLocation = vi
      .fn()
      .mockRejectedValue(validationError(taskLocationValidation))
    const article = await openPlan(client)
    await click(within(article).getByRole('button', { name: '修改地點' }))
    const form = formByContext('location')
    fireEvent.change(within(form).getByLabelText('補充地點'), {
      target: { value: '東側' },
    })
    await click(within(form).getByRole('button', { name: '儲存地點' }))

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
    await click(within(article).getByRole('button', { name: '修改建議指派' }))
    const form = formByContext('assignee')
    fireEvent.change(within(form).getByLabelText('建議指派人'), {
      target: { value: 'project-a-member-1' },
    })
    await click(within(form).getByRole('button', { name: '儲存建議指派' }))

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
    await click(within(article).getByRole('button', { name: '修改建議指派' }))
    const form = formByContext('assignee')
    await click(within(form).getByRole('button', { name: '儲存建議指派' }))

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
    await click(within(article).getByRole('button', { name: '修改建議指派' }))
    const form = formByContext('assignee')
    const selector = within(form).getByLabelText('建議指派人')
    await click(within(form).getByRole('button', { name: '儲存建議指派' }))

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
    await click(within(article).getByRole('button', { name: '取消任務' }))
    const dialog = screen.getByRole('dialog')
    const reason = within(dialog).getByLabelText(/取消原因/)
    fireEvent.change(reason, { target: { value: '現場調整' } })
    await click(within(dialog).getByRole('button', { name: '取消任務' }))

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
    await openPlanCreationForm()
    const input = await screen.findByLabelText(/計畫名稱/)
    fireEvent.change(input, { target: { value: '測試計畫' } })
    await click(screen.getByRole('button', { name: '建立計畫' }))

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
    await openPlanCreationForm()
    fireEvent.change(screen.getByLabelText(/計畫名稱/), {
      target: { value: '橋梁查核' },
    })
    const form = formByContext('plan-create')

    fireEvent.submit(form)
    fireEvent.submit(form)
    gate.resolve()

    await expectNotice('已建立計畫，接著新增任務。')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ignores IME Enter in the plan form', async () => {
    const client = createMockPlanningClient()
    const spy = watch(client, 'createPlan')
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await screen.findByRole('heading', { name: '查核計畫' })
    await openPlanCreationForm()
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
    await openPlanCreationForm()
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
    await openPlan(client, 'plan')
    await click(screen.getByRole('button', { name: '修改計畫名稱' }))
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
    await openPlan(client, 'plan')
    await click(screen.getByRole('button', { name: '修改計畫名稱' }))
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
    await openPlan(client, 'new')
    const form = formByContext('task')
    await click(within(form).getByLabelText(/鋼筋保護層/))
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
    await openPlan(client, 'new')
    const form = formByContext('task')

    form.requestSubmit()

    const error = await within(form).findByText('請至少選擇一筆查核項目。')
    expect(error).toBeVisible()
    // 錯誤 render 後由 effect 聚焦欄位，不能只等錯誤文字。
    await waitFor(() =>
      expect(
        within(form).getByRole('group', { name: /選擇一筆以上/ }),
      ).toHaveFocus(),
    )
    expect(createTask).not.toHaveBeenCalled()
  })

  it('ignores IME Enter in the task form', async () => {
    const { client, zone } = await seeded()
    const spy = watch(client, 'createTask')
    await openPlan(client, 'new')
    const form = formByContext('task')
    await click(within(form).getByLabelText(/鋼筋保護層/))
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
    await click(within(article).getByRole('button', { name: '修改地點' }))
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

  it('confirms discard prompts for both fields (ADM-R38)', async () => {
    const { client } = await seeded()
    const article = await openPlan(client)

    await click(within(article).getByRole('button', { name: '修改地點' }))
    const location = within(article).getByLabelText('補充地點')
    fireEvent.change(location, { target: { value: '未儲存位置' } })
    await click(within(article).getByRole('button', { name: '取消' }))
    let prompt = within(article).getByRole('group', {
      name: '有尚未儲存的變更',
    })
    await waitFor(() =>
      expect(
        within(prompt).getByRole('button', { name: '保留編輯' }),
      ).toHaveFocus(),
    )
    await click(within(prompt).getByRole('button', { name: '保留編輯' }))
    expect(within(article).getByLabelText('補充地點')).toHaveValue(
      '未儲存位置',
    )
    await click(within(article).getByRole('button', { name: '取消' }))
    prompt = within(article).getByRole('group', {
      name: '有尚未儲存的變更',
    })
    await click(within(prompt).getByRole('button', { name: '捨棄變更' }))
    expect(within(article).queryByLabelText('補充地點')).toBeNull()
    await waitFor(() =>
      expect(
        within(article).getByRole('button', { name: '修改地點' }),
      ).toHaveFocus(),
    )

    await click(within(article).getByRole('button', { name: '修改建議指派' }))
    fireEvent.change(within(article).getByLabelText('建議指派人'), {
      target: { value: 'project-a-member-1' },
    })
    await click(within(article).getByRole('button', { name: '取消' }))
    prompt = within(article).getByRole('group', {
      name: '有尚未儲存的變更',
    })
    await click(within(prompt).getByRole('button', { name: '捨棄變更' }))
    expect(within(article).queryByLabelText('建議指派人')).toBeNull()
    await waitFor(() =>
      expect(
        within(article).getByRole('button', { name: '修改建議指派' }),
      ).toHaveFocus(),
    )
  })

  it('ignores IME Enter in the task rename form', async () => {
    const { client } = await seeded()
    const spy = watch(client, 'updateTaskName')
    const article = await openPlan(client)
    await click(within(article).getByRole('button', { name: '修改名稱' }))

    expectImeEnterIgnored(within(article).getByLabelText(/任務名稱/))

    expect(spy).not.toHaveBeenCalled()
  })

  it('maps task rename 422 name errors and focuses the input', async () => {
    const { client } = await seeded()
    client.updateTaskName = vi
      .fn()
      .mockRejectedValue(validationError(planNameValidation))
    const article = await openPlan(client)
    await click(within(article).getByRole('button', { name: '修改名稱' }))
    const form = formByContext('task-rename')
    const input = within(form).getByLabelText(/任務名稱/)
    expect(
      input.closest('label')?.querySelector('.required-label .required-mark'),
    ).not.toBeNull()
    fireEvent.change(input, { target: { value: '新名稱' } })
    await click(within(form).getByRole('button', { name: '儲存名稱' }))

    expect(await within(form).findByText('輸入內容太長。')).toBeVisible()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(input).toHaveFocus())
  })

  it('ignores IME Enter in the location form', async () => {
    const { client } = await seeded()
    const spy = watch(client, 'updateLocation')
    const article = await openPlan(client)
    await click(within(article).getByRole('button', { name: '修改地點' }))
    const form = formByContext('location')

    expectImeEnterIgnored(within(form).getByLabelText('補充地點'))

    expect(spy).not.toHaveBeenCalled()
  })

  it('saves the assignee once on a double submit', async () => {
    const { client } = await seeded()
    const { gate, spy } = hold(client, 'setSuggestedAssignee')
    const article = await openPlan(client)
    await click(within(article).getByRole('button', { name: '修改建議指派' }))
    const form = within(article)
      .getByRole('button', { name: '儲存建議指派' })
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
    await click(within(article).getByRole('button', { name: '修改建議指派' }))

    expectImeEnterIgnored(within(article).getByLabelText('建議指派人'))

    expect(spy).not.toHaveBeenCalled()
  })

  it('dispatches once when the confirm button is clicked twice', async () => {
    const { client } = await seeded()
    const { gate, spy } = hold(client, 'dispatchTask')
    const article = await openPlan(client)
    expect(within(article).getByText(/派出前還需要/)).toBeVisible()
    expect(
      within(article).getByRole('button', {
        name: '派出任務',
      }),
    ).toHaveAccessibleDescription(/派出前還需要：指定建議指派人/)
    expect(
      within(article).getByRole('button', { name: '派出任務' }),
    ).toBeDisabled()

    await click(
      within(article).getByRole('button', {
        name: '指定建議指派人',
      }),
    )
    fireEvent.change(within(article).getByLabelText('建議指派人'), {
      target: { value: 'project-a-member-1' },
    })
    await click(within(article).getByRole('button', { name: '儲存建議指派' }))
    await waitFor(() => {
      expect(
        within(article).queryByText(/派出前還需要/),
      ).not.toBeInTheDocument()
    })

    await click(within(article).getByRole('button', { name: '派出任務' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('派出後現場即可查看')
    const confirm = screen.getByRole('button', { name: '確認派出' })

    await click(confirm)
    await click(confirm)
    gate.resolve()

    await expectNotice('已派出任務，現場可以查看了。')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('cancels a task once on a double submit', async () => {
    const { client } = await seeded(true)
    const { gate, spy } = hold(client, 'cancelTask')
    const article = await openPlan(client)
    await click(within(article).getByRole('button', { name: '取消任務' }))
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
    await click(within(article).getByRole('button', { name: '取消任務' }))
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
    await click(within(article).getByRole('button', { name: '取消任務' }))
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

  describe('dispatch blockers (#451)', () => {
    const BLOCKERS = '派出前需要處理的項目'

    /** 讓 getPlan 回傳被改過的任務，模擬 API 目前不會產生的舊草稿。 */
    function reshapeTasks(
      client: PlanningPageClient,
      change: (task: InspectionTask) => InspectionTask,
    ) {
      const original = client.getPlan.bind(client)
      client.getPlan = vi.fn(async (id: string) => {
        const plan = await original(id)
        return { ...plan, tasks: (plan.tasks ?? []).map(change) }
      })
    }

    /** 任務沒有查核項目時標題是空的，所以改用 article 角色找任務。 */
    async function openPlanBare(client: PlanningPageClient) {
      render(
        <PlanningPage client={client} initialProjectId="project-demo-1" />,
      )
      await click(await screen.findByRole('link', { name: /橋梁查核（/ }))
      await openTaskDetail()
      return screen.findByRole('article')
    }

    async function seededComplete() {
      const client = createMockPlanningClient()
      const zone = await client.createZone('project-demo-1', '北區')
      const plan = await client.createPlan('project-demo-1', {
        name: '橋梁查核',
      })
      const [item] = await client.listProjectItems('project-demo-1')
      await client.createTask(plan.id, {
        name: '混凝土外觀',
        item_ids: [item.id],
        suggested_assignee_id: 'project-a-member-1',
        zone_id: zone.id,
        location_text: null,
      })
      return client
    }

    it('renders no blocker list when nothing blocks dispatch', async () => {
      const client = await seededComplete()
      const article = await openPlan(client)

      expect(
        within(article).getByRole('button', { name: '派出任務' }),
      ).toBeEnabled()
      expect(
        within(article).queryByRole('list', { name: BLOCKERS }),
      ).not.toBeInTheDocument()
      expect(article.querySelector('.task-dispatch-blockers')).toBeNull()
      expect(
        within(article).getByRole('button', { name: '派出任務' }),
      ).not.toHaveAttribute('aria-describedby')
    })

    it.each([
      { assign: true, manage: false },
      { assign: false, manage: true },
      { assign: true, manage: true },
    ])(
      'keeps permitted shortcuts without dispatch: %j',
      async ({ assign, manage }) => {
        const client = await seededComplete()
        reshapeTasks(client, (task) => ({
          ...task,
          assignee_id: null,
          assignee: null,
          zone_id: null,
          zone: null,
          location_text: null,
          items: [],
        }))
        render(
          <PlanningPage
            client={client}
            initialProjectId="project-demo-1"
            viewerPermissions={[
              'inspection_plan.read',
              'inspection_task.read',
              ...(assign ? ['inspection_task.assign'] : []),
              ...(manage ? ['inspection_task.manage'] : []),
            ]}
          />,
        )
        await click(await screen.findByRole('link', { name: /橋梁查核（/ }))
        await openTaskDetail()
        let article = await screen.findByRole('article')
        let list = within(article).getByRole('list', { name: BLOCKERS })
        expect(within(list).getAllByRole('listitem')).toHaveLength(3)
        expect(within(list).getAllByRole('button')).toHaveLength(
          Number(assign) + Number(manage) * 2,
        )
        expect(within(article).queryByText(/派出前還需要/)).toBeNull()
        expect(
          within(article).queryByRole('button', { name: '派出任務' }),
        ).toBeNull()
        for (const [label, allowed, field] of [
          ['指定建議指派人', assign, /建議指派人/],
          ['填寫地點', manage, /分區/],
        ] as const) {
          if (!allowed) {
            expect(
              within(list).queryByRole('button', { name: label }),
            ).toBeNull()
            continue
          }
          const shortcut = within(list).getByRole('button', { name: label })
          await click(shortcut)
          await waitFor(() =>
            expect(within(article).getByLabelText(field)).toHaveFocus(),
          )
          await click(within(article).getByRole('button', { name: '取消' }))
          article = await screen.findByRole('article')
          list = within(article).getByRole('list', { name: BLOCKERS })
          await waitFor(() =>
            expect(
              within(list).getByRole('button', { name: label }),
            ).toHaveFocus(),
          )
        }
        if (manage) {
          await click(
            within(list).getByRole('button', { name: '選擇查核項目' }),
          )
          expect(
            screen.getByRole('form', { name: /^修改查核項目｜/ }),
          ).toBeVisible()
        } else {
          expect(
            within(list).queryByRole('button', {
              name: '選擇查核項目',
            }),
          ).toBeNull()
        }
      },
    )

    it('shows plain reasons without modification permissions', async () => {
      const client = await seededComplete()
      reshapeTasks(client, (task) => ({
        ...task,
        assignee_id: null,
        assignee: null,
        zone_id: null,
        zone: null,
        location_text: null,
        items: [],
      }))
      render(
        <PlanningPage
          client={client}
          initialProjectId="project-demo-1"
          viewerPermissions={['inspection_plan.read', 'inspection_task.read']}
        />,
      )
      await click(await screen.findByRole('link', { name: /橋梁查核（/ }))
      await openTaskDetail()
      const article = await screen.findByRole('article')
      const list = within(article).getByRole('list', { name: BLOCKERS })
      expect(
        within(list)
          .getAllByRole('listitem')
          .map((li) => li.textContent),
      ).toEqual([
        '尚未指派建議指派人。',
        '尚未填寫地點。',
        '尚未選擇查核項目。',
      ])
      expect(within(list).queryByRole('button')).toBeNull()
      expect(within(article).queryByText(/派出前還需要/)).toBeNull()
      expect(
        within(article).queryByRole('button', { name: '派出任務' }),
      ).toBeNull()
    })

    it('lists a missing location and jumps to the location field', async () => {
      const client = await seededComplete()
      reshapeTasks(client, (task) => ({
        ...task,
        zone_id: null,
        zone: null,
        location_text: null,
      }))
      const article = await openPlan(client)

      const list = within(article).getByText(/派出前還需要/)
      expect(list.tagName).toBe('P')
      const dispatch = within(article).getByRole('button', {
        name: '派出任務',
      })
      expect(dispatch).toHaveAttribute('aria-describedby', list.id)
      expect(list).toHaveTextContent('派出前還需要：填寫地點')
      expect(
        within(article).getAllByRole('button', {
          name: '填寫地點',
        }),
      ).toHaveLength(1)
      expect(within(article).queryByText(/尚未指派/)).toBeNull()
      expect(
        within(article).getByRole('button', { name: '派出任務' }),
      ).toBeDisabled()

      await click(within(list).getByRole('button', { name: '填寫地點' }))

      expect(
        screen.getByRole('heading', { name: /^修改地點｜/, level: 2 }),
      ).toBeVisible()
      await waitFor(() =>
        expect(within(article).getByLabelText(/分區/)).toHaveFocus(),
      )
    })

    it('opens the draft item editor from a missing-item blocker', async () => {
      const client = await seededComplete()
      reshapeTasks(client, (task) => ({ ...task, items: [] }))
      const article = await openPlanBare(client)

      const list = within(article).getByText(/派出前還需要/)
      expect(list.tagName).toBe('P')
      const dispatch = within(article).getByRole('button', {
        name: '派出任務',
      })
      expect(dispatch).toHaveAttribute('aria-describedby', list.id)
      expect(list).toHaveTextContent('派出前還需要：選擇查核項目')
      expect(
        within(article).getAllByRole('button', {
          name: '選擇查核項目',
        }),
      ).toHaveLength(1)
      const hashBefore = window.location.hash

      await click(within(list).getByRole('button', { name: '選擇查核項目' }))

      await waitFor(() =>
        expect(
          screen.getByRole('group', { name: /選擇一筆以上/ }),
        ).toHaveFocus(),
      )
      expect(
        screen.getByRole('heading', {
          name: /^修改查核項目｜/,
          level: 2,
        }),
      ).toBeVisible()
      expect(window.location.hash).toBe(hashBefore)
      expect(
        screen.queryByRole('group', { name: '有尚未儲存的變更' }),
      ).toBeNull()
      expect(within(list).queryByRole('link')).toBeNull()
    })

    it('guards unsaved item changes and saves a replacement selection', async () => {
      const client = await seededComplete()
      const updateItems = vi.spyOn(client, 'updateTaskItems')
      const article = await openPlanBare(client)
      let edit = within(article).getByRole('button', {
        name: '修改查核項目',
      })
      await click(edit)
      const form = within(article).getByRole('form', {
        name: /^修改查核項目｜/,
      })
      expect(within(form).queryByText(/本計畫已有 1 筆任務/)).toBeNull()
      expect(within(form).getAllByText(/本計畫已有 0 筆任務/)).toHaveLength(3)

      const secondItem = within(form).getByLabelText(/鋼筋保護層/)
      await click(secondItem)
      await click(within(form).getByRole('button', { name: '取消' }))
      expect(
        screen.getByRole('heading', { name: '有尚未儲存的變更' }),
      ).toBeVisible()
      await click(screen.getByRole('button', { name: '保留編輯' }))
      expect(secondItem).toBeChecked()

      await click(within(form).getByRole('button', { name: '取消' }))
      await click(screen.getByRole('button', { name: '捨棄變更' }))
      edit = within(article).getByRole('button', { name: '修改查核項目' })
      await waitFor(() => expect(edit).toHaveFocus())
      await click(edit)
      const reopened = within(article).getByRole('form', {
        name: /^修改查核項目｜/,
      })
      await click(within(reopened).getByLabelText(/鋼筋保護層/))
      await click(
        within(reopened).getByRole('button', { name: '儲存查核項目' }),
      )

      await expectNotice('已更新草稿任務的查核項目。')
      await screen.findByRole('heading', {
        name: /混凝土外觀\s+（草稿）/,
      })
      const selectedItems = '查核項目：混凝土外觀、鋼筋保護層'
      expect(await within(article).findByText(selectedItems)).toBeVisible()
      expect(updateItems).toHaveBeenCalledWith(expect.any(String), {
        item_ids: ['item-demo-1', 'item-demo-2'],
      })
    })

    it('shows item replacement business errors beside and focuses the field', async () => {
      const client = await seededComplete()
      client.updateTaskItems = vi
        .fn()
        .mockRejectedValue(
          new ManagementApiError(422, 'inspection_task.invalid_project_item'),
        )
      const article = await openPlanBare(client)
      await click(
        within(article).getByRole('button', { name: '修改查核項目' }),
      )
      const form = within(article).getByRole('form', {
        name: /^修改查核項目｜/,
      })
      await click(within(form).getByRole('button', { name: '儲存查核項目' }))

      const message = await within(form).findByText(
        '所選查核項目不屬於這個專案，請重新整理後再選。',
      )
      expect(message).toBeVisible()
      const field = within(form).getByRole('group', {
        name: /選擇一筆以上查核項目/,
      })
      expect(field).toHaveAttribute('aria-invalid', 'true')
      await waitFor(() => expect(field).toHaveFocus())
    })

    it('rejects an empty item selection beside the field without calling the API', async () => {
      const client = await seededComplete()
      const updateItems = vi.spyOn(client, 'updateTaskItems')
      const article = await openPlanBare(client)
      await click(
        within(article).getByRole('button', { name: '修改查核項目' }),
      )
      const form = within(article).getByRole('form', {
        name: /^修改查核項目｜/,
      })
      await click(within(form).getByLabelText(/混凝土外觀/))
      await click(within(form).getByRole('button', { name: '儲存查核項目' }))

      const message = await within(form).findByText(
        '請至少選擇一筆查核項目。',
        { selector: '.field-error' },
      )
      expect(message).toBeVisible()
      const field = within(form).getByRole('group', {
        name: /選擇一筆以上查核項目/,
      })
      expect(field).toHaveAttribute('aria-invalid', 'true')
      await waitFor(() => expect(field).toHaveFocus())
      expect(updateItems).not.toHaveBeenCalled()
    })

    it('shows a 409 state conflict inside the item form and keeps the selection', async () => {
      const client = await seededComplete()
      client.updateTaskItems = vi
        .fn()
        .mockRejectedValue(
          new ManagementApiError(409, 'inspection_task.invalid_transition'),
        )
      const article = await openPlanBare(client)
      await click(
        within(article).getByRole('button', { name: '修改查核項目' }),
      )
      const form = within(article).getByRole('form', {
        name: /^修改查核項目｜/,
      })
      await click(within(form).getByLabelText(/鋼筋保護層/))
      await click(within(form).getByRole('button', { name: '儲存查核項目' }))

      const alert = await within(form).findByRole('alert')
      expect(alert).toHaveTextContent('目前任務狀態不允許這項操作。')
      expect(within(form).getByLabelText(/鋼筋保護層/)).toBeChecked()
    })

    it('guards page unload while the item selection is changed', async () => {
      const client = await seededComplete()
      const article = await openPlanBare(client)
      await click(
        within(article).getByRole('button', { name: '修改查核項目' }),
      )
      const unchanged = new Event('beforeunload', {
        cancelable: true,
      }) as BeforeUnloadEvent
      window.dispatchEvent(unchanged)
      expect(unchanged.defaultPrevented).toBe(false)

      await click(within(article).getByLabelText(/鋼筋保護層/))
      const changed = new Event('beforeunload', {
        cancelable: true,
      }) as BeforeUnloadEvent
      window.dispatchEvent(changed)
      expect(changed.defaultPrevented).toBe(true)
    })

    it('hides item editing once a write returns 403 turns the page read-only', async () => {
      const client = await seededComplete()
      client.updateLocation = vi
        .fn()
        .mockRejectedValue(new ManagementApiError(403, 'permission.denied'))
      const article = await openPlanBare(client)
      expect(
        within(article).getByRole('button', { name: '修改查核項目' }),
      ).toBeVisible()
      await click(
        within(article).getByRole('button', { name: '修改查核項目' }),
      )
      await click(within(article).getByLabelText(/鋼筋保護層/))
      await click(within(article).getByRole('button', { name: '取消' }))
      await click(within(article).getByRole('button', { name: '捨棄變更' }))
      await click(within(article).getByRole('button', { name: '修改地點' }))
      await click(within(article).getByRole('button', { name: '儲存地點' }))

      await waitFor(() =>
        expect(
          within(article).queryByRole('button', { name: '儲存地點' }),
        ).toBeNull(),
      )
      expect(
        within(article).queryByRole('button', { name: '修改查核項目' }),
      ).toBeNull()
      expect(
        within(article).queryByRole('form', {
          name: /^修改查核項目｜/,
        }),
      ).toBeNull()
      const unload = new Event('beforeunload', {
        cancelable: true,
      }) as BeforeUnloadEvent
      window.dispatchEvent(unload)
      expect(unload.defaultPrevented).toBe(false)
    })

    it('shows reasons but no shortcuts or forms on an archived plan', async () => {
      const client = await seededComplete()
      reshapeTasks(client, (task) => ({
        ...task,
        assignee_id: null,
        assignee: null,
        zone_id: null,
        zone: null,
        location_text: null,
        items: [],
      }))
      const [plan] = (await client.listPlans('project-demo-1')).items
      await client.archivePlan(plan.id)
      const article = await openPlanBare(client)

      const list = within(article).getByRole('list', { name: BLOCKERS })
      expect(list).toHaveTextContent('尚未指派')
      expect(list).toHaveTextContent('尚未填寫地點')
      expect(list).toHaveTextContent('尚未選擇查核項目')
      expect(within(list).queryByRole('button')).toBeNull()
      expect(within(list).queryByRole('link')).toBeNull()
      expect(screen.queryByRole('heading', { name: '新增任務' })).toBeNull()
      expect(
        within(article).queryByRole('button', { name: '修改查核項目' }),
      ).toBeNull()
    })

    it('removes shortcuts and open edit forms once a write returns 403', async () => {
      const { client } = await seeded()
      client.updateLocation = vi
        .fn()
        .mockRejectedValue(new ManagementApiError(403, 'permission.denied'))
      const article = await openPlan(client)
      expect(
        within(article).getByRole('button', { name: '指定建議指派人' }),
      ).toBeVisible()
      await click(within(article).getByRole('button', { name: '修改地點' }))
      await click(within(article).getByRole('button', { name: '儲存地點' }))

      await waitFor(() =>
        expect(
          within(article).queryByRole('button', { name: '儲存地點' }),
        ).toBeNull(),
      )
      expect(
        within(article).queryByRole('button', { name: '指定建議指派人' }),
      ).toBeNull()
      expect(within(article).getByText(/尚未指派/)).toBeVisible()
      expect(
        within(article).queryByRole('button', { name: '修改建議指派' }),
      ).toBeNull()
      expect(
        within(article).queryByRole('form', { name: /^修改建議指派｜/ }),
      ).toBeNull()
    })

    it('does not guard against leaving once read-only hides the forms', async () => {
      const { client } = await seeded()
      client.updateLocation = vi
        .fn()
        .mockRejectedValue(new ManagementApiError(403, 'permission.denied'))
      const article = await openPlan(client)
      await click(within(article).getByRole('button', { name: '修改地點' }))
      fireEvent.change(within(article).getByLabelText('補充地點'), {
        target: { value: '東側' },
      })
      const dirtyUnload = new Event('beforeunload', {
        cancelable: true,
      }) as BeforeUnloadEvent
      window.dispatchEvent(dirtyUnload)
      expect(dirtyUnload.defaultPrevented).toBe(true)

      let disconnectUnloadObserver = () => {}
      const unloadAfterHide = new Promise<boolean>((resolve) => {
        const observer = new MutationObserver(() => {
          if (
            within(article).queryByRole('button', { name: '儲存地點' }) !==
            null
          ) {
            return
          }
          observer.disconnect()
          const unload = new Event('beforeunload', {
            cancelable: true,
          }) as BeforeUnloadEvent
          window.dispatchEvent(unload)
          resolve(unload.defaultPrevented)
        })
        disconnectUnloadObserver = () => observer.disconnect()
        observer.observe(article, { childList: true, subtree: true })
      })

      try {
        await click(within(article).getByRole('button', { name: '儲存地點' }))
        await waitFor(() =>
          expect(
            within(article).queryByRole('button', { name: '儲存地點' }),
          ).toBeNull(),
        )

        expect(await unloadAfterHide).toBe(false)
      } finally {
        disconnectUnloadObserver()
      }
    })

    it('lets the back link leave at once when the page turned into no-permission', async () => {
      const { client } = await seeded()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      client.getPlan = vi
        .fn()
        .mockRejectedValue(new ManagementApiError(403, 'permission.denied'))
      renderWithoutRouter(
        <CurrentUserProvider
          value={{ user: currentUserFixture(), clear: vi.fn() }}
        >
          <DataMemoryRouter
            initialEntries={['/projects/project-demo-1/planning']}
          >
            <Routes>
              <Route
                element={
                  <PlanningPage
                    client={client}
                    initialProjectId="project-demo-1"
                  />
                }
                path="/projects/:projectId/planning/*"
              />
              <Route element={<p>我的首頁</p>} path="/settings" />
            </Routes>
          </DataMemoryRouter>
        </CurrentUserProvider>,
      )
      await openPlanCreationForm()
      fireEvent.change(await screen.findByLabelText(/計畫名稱/), {
        target: { value: '尚未儲存的計畫' },
      })
      await click(screen.getByRole('link', { name: '返回計畫清單' }))
      await click(screen.getByRole('button', { name: '捨棄變更' }))
      await click(await screen.findByRole('link', { name: /橋梁查核（/ }))
      await screen.findByRole('heading', { name: '無權限' })

      await click(screen.getByRole('link', { name: '回到我的首頁' }))

      expect(await screen.findByText('我的首頁')).toBeVisible()
      expect(screen.queryByRole('group')).toBeNull()
    })

    it('closes the rename form when another write turns the page read-only', async () => {
      const { client } = await seeded()
      client.archivePlan = vi
        .fn()
        .mockRejectedValue(new ManagementApiError(403, 'permission.denied'))
      await openPlan(client, 'plan')
      await click(screen.getByRole('button', { name: '修改計畫名稱' }))
      expect(formByContext('plan-rename')).not.toBeNull()
      await click(screen.getByRole('button', { name: '封存計畫' }))
      await click(
        within(await screen.findByRole('dialog')).getByRole('button', {
          name: '確認封存',
        }),
      )

      await waitFor(() => expect(formByContext('plan-rename')).toBeNull())
      expect(screen.getByRole('status')).toHaveTextContent(
        '你目前沒有可以對這個計畫執行的操作。',
      )
      expect(screen.queryByLabelText(/計畫名稱/)).toBeNull()
      const unload = new Event('beforeunload', {
        cancelable: true,
      }) as BeforeUnloadEvent
      window.dispatchEvent(unload)
      expect(unload.defaultPrevented).toBe(false)
    })

    it('closes the cancel dialog and keeps the reason visible when it returns 403', async () => {
      const { client } = await seeded(true)
      const assignees = vi.spyOn(client, 'listProjectAssignees')
      client.cancelTask = vi
        .fn()
        .mockRejectedValue(new ManagementApiError(403, 'permission.denied'))
      const article = await openPlan(client)
      await click(within(article).getByRole('button', { name: '取消任務' }))
      const dialog = await screen.findByRole('dialog')
      fireEvent.change(within(dialog).getByLabelText(/取消原因/), {
        target: { value: '現場順序調整' },
      })
      await click(within(dialog).getByRole('button', { name: '取消任務' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(await screen.findByRole('alert')).toBeVisible()
      expect(screen.getByRole('status')).toHaveTextContent(READ_ONLY_NOTICE)
      expect(assignees).toHaveBeenCalledOnce()
    })
  })

  describe('business 422 codes land on their fields (ADM-R28)', () => {
    function businessError(code: string) {
      return new ManagementApiError(422, code)
    }

    it.each([
      ['inspection_task.invalid_zone', /任務分區/, '所選分區不屬於這個專案'],
      [
        'inspection_task.invalid_assignee',
        '建議指派人',
        '建議指派人不是這個專案的成員',
      ],
      [
        'inspection_task.invalid_location',
        '補充地點',
        '補充地點內容不符合規則',
      ],
    ])(
      'maps %s from task creation beside its field and focuses it',
      async (code, label, message) => {
        const { client, zone } = await seeded()
        client.createTask = vi.fn().mockRejectedValue(businessError(code))
        await openPlan(client, 'new')
        const form = formByContext('task')
        await click(within(form).getByLabelText(/鋼筋保護層/))
        fireEvent.change(within(form).getByLabelText(/任務分區/), {
          target: { value: zone.id },
        })
        await click(within(form).getByRole('button', { name: '建立草稿任務' }))

        const field = within(form).getByLabelText(label)
        expect(await within(form).findByText(new RegExp(message))).toHaveClass(
          'field-error',
        )
        expect(field).toHaveAttribute('aria-invalid', 'true')
        await waitFor(() => expect(field).toHaveFocus())
        expect(within(form).queryByRole('alert')).toBeNull()
      },
    )

    it('maps items_required from task creation to the item field', async () => {
      const { client } = await seeded()
      client.createTask = vi
        .fn()
        .mockRejectedValue(businessError('inspection_task.items_required'))
      await openPlan(client, 'new')
      const form = formByContext('task')
      await click(within(form).getByLabelText(/鋼筋保護層/))
      fireEvent.change(within(form).getByLabelText(/任務分區/), {
        target: {
          value: (await client.listProjectZones('project-demo-1'))[0].id,
        },
      })
      await click(within(form).getByRole('button', { name: '建立草稿任務' }))

      const fieldset = within(form).getByRole('group', {
        name: /選擇一筆以上/,
      })
      await waitFor(() => expect(fieldset).toHaveFocus())
      expect(fieldset).toHaveAttribute('aria-invalid', 'true')
      expect(within(form).queryByRole('alert')).toBeNull()
    })

    it(
      [
        'maps item_without_points from task creation ',
        'to the item field',
      ].join(''),
      async () => {
        const { client, zone } = await seeded()
        client.createTask = vi
          .fn()
          .mockRejectedValue(
            businessError('inspection_task.item_without_points'),
          )
        await openPlan(client, 'new')
        const form = formByContext('task')
        await click(within(form).getByLabelText(/鋼筋保護層/))
        fireEvent.change(within(form).getByLabelText(/任務分區/), {
          target: { value: zone.id },
        })
        await click(within(form).getByRole('button', { name: '建立草稿任務' }))

        const fieldset = within(form).getByRole('group', {
          name: /選擇一筆以上/,
        })
        expect(
          await within(form).findByText(
            [
              '所選查核項目沒有查核項次，',
              '請先補上項次或改選其他項目。',
            ].join(''),
          ),
        ).toHaveClass('field-error')
        expect(fieldset).toHaveAttribute('aria-invalid', 'true')
        await waitFor(() => expect(fieldset).toHaveFocus())
        expect(within(form).queryByRole('alert')).toBeNull()
      },
    )

    it.each([
      ['inspection_task.invalid_zone', /分區/],
      ['inspection_task.invalid_location', '補充地點'],
    ] as const)(
      'maps %s from a location edit beside its field and focuses it',
      async (code, label) => {
        const { client } = await seeded()
        client.updateLocation = vi.fn().mockRejectedValue(businessError(code))
        const article = await openPlan(client)
        await click(within(article).getByRole('button', { name: '修改地點' }))
        const form = formByContext('location')
        await click(within(form).getByRole('button', { name: '儲存地點' }))

        const field = within(form).getByLabelText(label)
        await waitFor(() =>
          expect(field).toHaveAttribute('aria-invalid', 'true'),
        )
        await waitFor(() => expect(field).toHaveFocus())
        expect(within(form).queryByRole('alert')).toBeNull()
      },
    )

    it('maps invalid_assignee from an assignee edit beside the selector', async () => {
      const { client } = await seeded()
      client.setSuggestedAssignee = vi
        .fn()
        .mockRejectedValue(businessError('inspection_task.invalid_assignee'))
      const article = await openPlan(client)
      await click(
        within(article).getByRole('button', { name: '修改建議指派' }),
      )
      const form = formByContext('assignee')
      fireEvent.change(within(form).getByLabelText('建議指派人'), {
        target: { value: 'project-a-member-1' },
      })
      await click(within(form).getByRole('button', { name: '儲存建議指派' }))

      const selector = within(form).getByLabelText('建議指派人')
      expect(
        await within(form).findByText(/建議指派人不是這個專案的成員/),
      ).toHaveClass('field-error')
      expect(selector).toHaveAttribute('aria-invalid', 'true')
      await waitFor(() => expect(selector).toHaveFocus())
      expect(within(form).queryByRole('alert')).toBeNull()
    })
  })
})

describe('planning trial fixes (#634)', () => {
  async function setup(
    options: {
      dispatched?: boolean
      cancelledTwin?: boolean
      otherPlan?: boolean
    } = {},
  ) {
    const client = createMockPlanningClient()
    const zone = await client.createZone('project-demo-1', '北區')
    const plan = await client.createPlan('project-demo-1', {
      name: '橋梁查核',
    })
    const [item, item2] = await client.listProjectItems('project-demo-1')
    const task = await client.createTask(plan.id, {
      name: '混凝土外觀',
      item_ids: [item.id],
      suggested_assignee_id: options.dispatched ? 'project-a-member-1' : null,
      zone_id: zone.id,
      location_text: null,
    })
    if (options.dispatched) await client.dispatchTask(task.id)
    if (options.cancelledTwin) {
      const twin = await client.createTask(plan.id, {
        name: '混凝土外觀',
        item_ids: [item.id],
        suggested_assignee_id: 'project-a-member-1',
        zone_id: zone.id,
        location_text: null,
      })
      await client.dispatchTask(twin.id)
      await client.cancelTask(twin.id, '重複建立')
    }
    if (options.otherPlan) {
      await client.createPlan('project-demo-1', { name: '乙計畫' })
    }
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await click(await screen.findByRole('link', { name: /橋梁查核（/ }))
    const article = (
      await screen.findAllByRole('heading', { name: /混凝土外觀/ })
    )[0].closest('article') as HTMLElement
    return { client, plan, task, article, item, item2, zone }
  }

  const creationForm = () =>
    document.querySelector('#task-creation-form') as HTMLElement | null

  async function renameWithNotice() {
    await click(screen.getByRole('button', { name: '修改計畫名稱' }))
    const form = document.querySelector(
      '[data-error-context="plan-rename"]',
    ) as HTMLElement
    fireEvent.change(within(form).getByLabelText(/計畫名稱/), {
      target: { value: '橋梁查核乙' },
    })
    await click(within(form).getByRole('button', { name: '儲存計畫名稱' }))
    await expectNotice('已更新計畫名稱。')
  }

  it('focuses the first field on open and returns focus on cancel', async () => {
    const { article } = await setup()
    await openTaskDetail()
    await click(within(article).getByRole('button', { name: '修改建議指派' }))
    await click(screen.getByRole('button', { name: '取消' }))
    await click(screen.getByRole('link', { name: '返回計畫詳情' }))
    await click(screen.getByRole('button', { name: '＋ 新增任務' }))
    const form = creationForm() as HTMLElement
    await waitFor(() =>
      expect(within(form).getByLabelText(/任務名稱/)).toHaveFocus(),
    )

    // 沒有輸入就取消：返回計畫詳情，不帶回已離開的其他表單。
    await click(within(form).getByRole('button', { name: '取消' }))

    expect(creationForm()).toBeNull()
    expect(
      within(article).queryByRole('form', { name: /^修改建議指派｜/ }),
    ).not.toBeInTheDocument()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '＋ 新增任務' }),
      ).toHaveFocus(),
    )
  })

  it('returns focus to the add button after discarding input', async () => {
    await setup()
    await click(screen.getByRole('button', { name: '＋ 新增任務' }))
    const form = creationForm() as HTMLElement
    await click(within(form).getByLabelText(/鋼筋保護層/))
    await click(within(form).getByRole('button', { name: '取消' }))
    await click(screen.getByRole('button', { name: '捨棄變更' }))

    expect(creationForm()).toBeNull()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '＋ 新增任務' }),
      ).toHaveFocus(),
    )
  })

  it('drops a pending discard prompt once the task is created', async () => {
    const { zone } = await setup()
    await click(screen.getByRole('button', { name: '＋ 新增任務' }))
    const form = creationForm() as HTMLElement
    await click(within(form).getByLabelText(/鋼筋保護層/))
    fireEvent.change(within(form).getByLabelText(/任務分區/), {
      target: { value: zone.id },
    })
    await click(within(form).getByRole('button', { name: '取消' }))
    expect(screen.getByText(/新增任務內容尚未儲存/)).toBeVisible()

    await click(screen.getByRole('button', { name: '建立草稿任務' }))
    await expectNotice('已建立草稿任務，派出後現場才看得到。')
    expect(creationForm()).toBeNull()

    await click(screen.getByRole('link', { name: '返回計畫詳情' }))
    await click(screen.getByRole('button', { name: '＋ 新增任務' }))
    expect(screen.queryByText(/新增任務內容尚未儲存/)).toBeNull()
    expect(screen.queryByRole('button', { name: '捨棄變更' })).toBeNull()
  })

  it('shortcuts clear notices and return focus to their button', async () => {
    const { article } = await setup()
    await renameWithNotice()

    await openTaskDetail()
    const shortcut = within(article).getByRole('button', {
      name: '指定建議指派人',
    })
    await click(shortcut)
    expect(screen.queryByText('已更新計畫名稱。')).toBeNull()
    const form = within(article).getByRole('form', {
      name: /^修改建議指派｜/,
    })
    expect(form).toBeVisible()
    await waitFor(() =>
      expect(within(form).getByLabelText('建議指派人')).toHaveFocus(),
    )
    await click(
      within(form).getByRole('button', {
        name: '取消',
      }),
    )

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '指定建議指派人' }),
      ).toHaveFocus(),
    )
  })

  it('clears notices when renaming the plan again', async () => {
    await setup()
    await renameWithNotice()

    await click(screen.getByRole('button', { name: '修改計畫名稱' }))

    expect(screen.queryByText('已更新計畫名稱。')).toBeNull()
  })

  it('clears notices when opening the cancel-task dialog', async () => {
    const { article } = await setup({ dispatched: true })
    await renameWithNotice()

    await openTaskDetail()
    await click(within(article).getByRole('button', { name: '取消任務' }))

    expect(screen.queryByText('已更新計畫名稱。')).toBeNull()
  })

  it('does not count cancelled tasks in the per-item totals', async () => {
    await setup({ dispatched: true, cancelledTwin: true })
    expect(screen.getAllByRole('article')).toHaveLength(2)

    await click(screen.getByRole('button', { name: '＋ 新增任務' }))

    expect(screen.getAllByText('本計畫已有 1 筆任務')).toHaveLength(1)
    expect(screen.getAllByText('本計畫已有 0 筆任務')).toHaveLength(2)
  })

  it('resets the creation form when another plan is opened', async () => {
    await setup({ otherPlan: true })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await click(screen.getByRole('button', { name: '＋ 新增任務' }))
    await click(screen.getByLabelText(/鋼筋保護層/))
    expect(screen.getByLabelText(/鋼筋保護層/)).toBeChecked()

    await click(screen.getByRole('link', { name: '返回計畫詳情' }))
    await click(screen.getByRole('button', { name: '捨棄變更' }))
    await click(screen.getByRole('link', { name: '返回計畫清單' }))
    await click(await screen.findByRole('link', { name: '乙計畫（草稿）' }))
    await screen.findByRole('heading', { name: '乙計畫' })

    expect(creationForm()).toBeNull()
    await click(screen.getByRole('button', { name: '＋ 新增任務' }))
    expect(screen.getByLabelText(/鋼筋保護層/)).not.toBeChecked()
  })
})

describe('#727 唯讀身分', () => {
  it.each(['現場工程師', '外部協作'])(
    '%s 從進頁即無寫入表單',
    async (identity) => {
      const client = createMockPlanningClient()
      const plan = await client.createPlan('project-demo-1', {
        name: '既有計畫',
      })
      const assignees = vi.spyOn(client, 'listProjectAssignees')
      render(
        <PlanningPage
          client={client}
          initialProjectId="project-demo-1"
          viewerPermissions={['inspection_plan.read', 'inspection_task.read']}
        />,
        currentUserFixture({
          is_external_collaborator: identity === '外部協作',
          has_project_access: true,
          has_field_access: identity === '現場工程師',
          can_inspect_tasks: identity === '現場工程師',
        }),
      )
      await click(await screen.findByRole('link', { name: /既有計畫/ }))
      await screen.findByRole('heading', { name: plan.name })
      expect(screen.getByRole('status')).toHaveTextContent(
        '你目前沒有可以對這個計畫執行的操作。',
      )
      expect(screen.queryByRole('button', { name: '建立計畫' })).toBeNull()
      expect(screen.queryByRole('button', { name: '＋ 新增任務' })).toBeNull()
      expect(screen.queryByRole('button', { name: '修改計畫名稱' })).toBeNull()
      expect(screen.queryByText(/沒有讀取可指派帳號清單/)).toBeNull()
      expect(assignees).not.toHaveBeenCalled()
    },
  )
})

describe('#727c 各動作依實際權限', () => {
  const allWrites = [
    'inspection_plan.create',
    'inspection_plan.manage',
    'inspection_plan.archive',
    'inspection_plan.unarchive',
    'inspection_task.create',
    'inspection_task.manage',
    'inspection_task.assign',
    'inspection_task.dispatch',
    'inspection_task.delete_draft',
    'inspection_task.cancel',
  ]
  async function setup(permissions: string[]) {
    const client = createMockPlanningClient()
    const plan = await client.createPlan('project-demo-1', {
      name: '權限驗收',
    })
    const [item] = await client.listProjectItems('project-demo-1')
    const zone = await client.createZone('project-demo-1', '北區')
    const [person] = await client.listProjectAssignees('project-demo-1')
    const tasks = []
    for (const name of ['草稿案例', '待開始案例', '取消案例']) {
      tasks.push(
        await client.createTask(plan.id, {
          name,
          item_ids: [item.id],
          suggested_assignee_id: person.id,
          zone_id: zone.id,
          location_text: null,
        }),
      )
    }
    await client.dispatchTask(tasks[1].id)
    await client.dispatchTask(tasks[2].id)
    await client.cancelTask(tasks[2].id, '測試取消')
    const loadAssignees = vi.spyOn(client, 'listProjectAssignees')
    render(
      <PlanningPage
        client={client}
        initialProjectId="project-demo-1"
        viewerPermissions={permissions}
      />,
    )
    await click(await screen.findByRole('link', { name: /權限驗收/ }))
    await screen.findByRole('heading', { name: /草稿案例/ })
    return { client, plan, tasks, loadAssignees }
  }
  it('全權內業可見全部寫入入口，封存後可取消封存', async () => {
    await setup(allWrites)
    for (const name of [
      '建立計畫',
      '修改計畫名稱',
      '封存計畫',
      '＋ 新增任務',
      '修改查核項目',
      '派出任務',
      '刪除草稿',
      '修改名稱',
      '修改地點',
      '修改建議指派',
      '取消任務',
      '恢復任務',
    ]) {
      if (name === '建立計畫') {
        await click(screen.getByRole('link', { name: '返回計畫清單' }))
        expect(screen.getByRole('link', { name })).toBeVisible()
        await click(screen.getByRole('link', { name: /權限驗收/ }))
      } else if (['修改計畫名稱', '封存計畫', '＋ 新增任務'].includes(name)) {
        expect(screen.getAllByRole('button', { name })[0]).toBeVisible()
      } else {
        const taskName =
          name === '取消任務'
            ? '待開始案例'
            : name === '恢復任務'
              ? '取消案例'
              : '草稿案例'
        await click(screen.getByRole('link', { name: taskName }))
        expect(screen.getAllByRole('button', { name })[0]).toBeVisible()
        await click(screen.getByRole('link', { name: '返回計畫詳情' }))
      }
    }
    await click(screen.getByRole('button', { name: '封存計畫' }))
    await click(screen.getByRole('button', { name: '確認封存' }))
    expect(
      await screen.findByRole('button', { name: '取消封存' }),
    ).toBeVisible()
  })
  it('規劃與派出三碼可建立計畫、新增任務並實際派出', async () => {
    const { client, tasks, loadAssignees } = await setup([
      'inspection_plan.create',
      'inspection_task.create',
      'inspection_task.dispatch',
    ])
    const dispatch = vi.spyOn(client, 'dispatchTask')
    await click(screen.getByRole('link', { name: '返回計畫清單' }))
    expect(screen.getByRole('link', { name: '建立計畫' })).toBeVisible()
    await click(screen.getByRole('link', { name: /權限驗收/ }))
    await openTaskDetail()
    expect(loadAssignees).toHaveBeenCalledOnce()
    for (const name of [
      '修改計畫名稱',
      '封存計畫',
      '修改查核項目',
      '刪除草稿',
      '修改名稱',
      '修改地點',
      '修改建議指派',
      '取消任務',
      '恢復任務',
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    await click(screen.getByRole('link', { name: '返回計畫詳情' }))
    await click(screen.getByRole('button', { name: '＋ 新增任務' }))
    expect(screen.getByRole('button', { name: '建立草稿任務' })).toBeVisible()
    // 空表單返回後仍可在詳情派出既有完整草稿；不依賴 plan.manage。
    await click(screen.getByRole('button', { name: '取消' }))
    await openTaskDetail()
    await click(screen.getByRole('button', { name: '派出任務' }))
    await click(screen.getByRole('button', { name: '確認派出' }))
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith(tasks[0].id))
  })
  it.each([
    ['inspection_plan.manage', '修改計畫名稱'],
    ['inspection_plan.archive', '封存計畫'],
    ['inspection_task.create', '＋ 新增任務'],
    ['inspection_task.manage', '修改查核項目'],
    ['inspection_task.assign', '修改建議指派'],
    ['inspection_task.dispatch', '派出任務'],
    ['inspection_task.delete_draft', '刪除草稿'],
    ['inspection_task.cancel', '取消任務'],
  ])('只持 %s 時僅開放對應操作', async (code, button) => {
    const { loadAssignees } = await setup([code])
    if (
      code.startsWith('inspection_task.') &&
      code !== 'inspection_task.create'
    ) {
      await click(
        screen.getByRole('link', {
          name: code === 'inspection_task.cancel' ? '待開始案例' : '草稿案例',
        }),
      )
    }
    expect(screen.getAllByRole('button', { name: button })[0]).toBeVisible()
    expect(screen.queryByRole('button', { name: '建立計畫' })).toBeNull()
    const entryNames = [
      '修改計畫名稱',
      '封存計畫',
      '取消封存',
      '＋ 新增任務',
      '修改查核項目',
      '修改名稱',
      '修改地點',
      '修改建議指派',
      '派出任務',
      '刪除草稿',
      '取消任務',
    ]
    for (const name of entryNames) {
      const permitted =
        name === button ||
        (code === 'inspection_task.manage' &&
          ['修改名稱', '修改地點'].includes(name))
      if (!permitted) {
        expect(screen.queryByRole('button', { name })).toBeNull()
      }
    }
    if (
      code === 'inspection_task.create' ||
      code === 'inspection_task.assign'
    ) {
      expect(loadAssignees).toHaveBeenCalledOnce()
    } else {
      expect(loadAssignees).not.toHaveBeenCalled()
    }
  })

  it.each([
    [
      '封存中',
      'inspection_plan.archive',
      '這個計畫已封存。你沒有取消封存的權限，如需取消封存，請洽有權限的專案管理者。',
      true,
    ],
    [
      '尚未封存',
      'inspection_plan.unarchive',
      '你目前沒有可以對這個計畫執行的操作。',
      false,
    ],
  ])(
    '%s 時只有相反狀態權限會顯示原因',
    async (_label, permission, message, archived) => {
      const client = createMockPlanningClient()
      const plan = await client.createPlan('project-demo-1', {
        name: '唯讀原因計畫',
      })
      if (archived) await client.archivePlan(plan.id)
      render(
        <PlanningPage
          client={client}
          initialProjectId="project-demo-1"
          viewerPermissions={[permission]}
        />,
      )
      await click(await screen.findByRole('link', { name: /唯讀原因計畫/ }))

      expect(await screen.findByText(new RegExp(message))).toBeVisible()
      expect(screen.queryByRole('button', { name: '修改計畫名稱' })).toBeNull()
      expect(screen.queryByRole('button', { name: '封存計畫' })).toBeNull()
      expect(screen.queryByRole('button', { name: '取消封存' })).toBeNull()
    },
  )

  it('有其他計畫寫入權限時不顯示單一封存權限的唯讀說明', async () => {
    const client = createMockPlanningClient()
    await client.createPlan('project-demo-1', {
      name: '混合封存權限計畫',
    })
    render(
      <PlanningPage
        client={client}
        initialProjectId="project-demo-1"
        viewerPermissions={[
          'inspection_plan.unarchive',
          'inspection_plan.manage',
        ]}
      />,
    )
    await click(await screen.findByRole('link', { name: /混合封存權限計畫/ }))

    expect(screen.getByRole('button', { name: '修改計畫名稱' })).toBeVisible()
    expect(
      screen.queryByText('你目前沒有可以對這個計畫執行的操作。'),
    ).toBeNull()
  })

  it('只持取消封存權限時，已封存計畫僅開放取消封存', async () => {
    const client = createMockPlanningClient()
    const plan = await client.createPlan('project-demo-1', {
      name: '僅取消封存計畫',
    })
    await client.archivePlan(plan.id)
    render(
      <PlanningPage
        client={client}
        initialProjectId="project-demo-1"
        viewerPermissions={['inspection_plan.unarchive']}
      />,
    )
    await click(await screen.findByRole('link', { name: /僅取消封存計畫/ }))
    expect(screen.getByRole('button', { name: '取消封存' })).toBeVisible()
    for (const name of [
      '建立計畫',
      '修改計畫名稱',
      '封存計畫',
      '＋ 新增任務',
      '修改查核項目',
      '修改名稱',
      '修改地點',
      '修改建議指派',
      '派出任務',
      '刪除草稿',
      '取消任務',
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    expect(screen.queryByText(/你沒有取消封存的權限/)).toBeNull()
  })

  it.each([
    [true, ['inspection_plan.manage', 'inspection_task.create']],
    [false, ['inspection_plan.create']],
    [false, []],
  ])(
    '已封存 %s、權限 %j 時顯示單一無可用操作提示',
    async (archived, codes) => {
      const client = createMockPlanningClient()
      const plan = await client.createPlan('project-demo-1', {
        name: '無可用操作計畫',
      })
      if (archived) await client.archivePlan(plan.id)
      render(
        <PlanningPage
          client={client}
          initialProjectId="project-demo-1"
          viewerPermissions={codes}
        />,
      )
      await click(await screen.findByRole('link', { name: /無可用操作計畫/ }))
      const message = archived
        ? '這個計畫已封存。你沒有取消封存的權限，如需取消封存，請洽有權限的專案管理者。'
        : '你目前沒有可以對這個計畫執行的操作。'
      expect(screen.getByText(message)).toBeVisible()
      expect(
        screen.queryByText('計畫已封存。取消封存後才能新增、修改或派出任務。'),
      ).toBeNull()
      expect(screen.queryByText(/你在這個專案只能查看計畫與任務/)).toBeNull()
    },
  )
})

it('IP-AC24：新增不選停用項目，草稿只保留原有停用項目', async () => {
  const client = createMockPlanningClient()
  const projectId = 'project-demo-1'
  const items = await client.listProjectItems(projectId)
  const plan = await client.createPlan(projectId, { name: '停用保留計畫' })
  await client.createTask(plan.id, {
    name: '保留原項目',
    item_ids: [items[0].id],
    zone_id: null,
    location_text: '工地',
    suggested_assignee_id: null,
  })
  client.listProjectItems = vi.fn(async () => [
    { ...items[0], is_active: false },
    { ...items[1], is_active: true },
    {
      ...items[1],
      id: 'other-inactive',
      title: '其他停用項目',
      is_active: false,
    },
  ])
  const updateItems = vi.spyOn(client, 'updateTaskItems')
  render(<PlanningPage client={client} initialProjectId={projectId} />)
  await click(await screen.findByRole('link', { name: /停用保留計畫（/ }))
  await openTaskCreationForm()
  const newForm = document.querySelector(
    '[data-error-context="task"]',
  ) as HTMLFormElement
  expect(
    within(newForm).queryByLabelText(new RegExp(items[0].title)),
  ).toBeNull()
  expect(within(newForm).queryByLabelText(/其他停用項目/)).toBeNull()
  expect(
    within(newForm).getByLabelText(new RegExp(items[1].title)),
  ).not.toBeChecked()
  await click(screen.getByRole('button', { name: '取消' }))
  await openTaskDetail()
  const article = (
    await screen.findByRole('heading', { name: /保留原項目/ })
  ).closest('article')!
  await openTaskDetail()
  await click(within(article).getByRole('button', { name: '修改查核項目' }))
  const editForm = document.querySelector(
    '[data-error-context="items"]',
  ) as HTMLFormElement
  expect(
    within(editForm).getByLabelText(new RegExp(items[0].title)),
  ).toBeChecked()
  expect(
    within(editForm).getByLabelText(new RegExp(items[1].title)),
  ).not.toBeChecked()
  expect(within(editForm).queryByLabelText(/其他停用項目/)).toBeNull()
  expect(within(editForm).getByText(/已停用/)).toBeVisible()
  expect(within(editForm).getByText('取消勾選後無法再加回。')).toBeVisible()
  // 只加選啟用項目後送出：原有的停用項目仍在 item_ids 內（IP-R24）。
  await click(within(editForm).getByLabelText(new RegExp(items[1].title)))
  await click(within(editForm).getByRole('button', { name: '儲存查核項目' }))
  await waitFor(() =>
    expect(updateItems).toHaveBeenCalledWith(expect.any(String), {
      item_ids: [items[0].id, items[1].id],
    }),
  )
})

it('IP-AC24：項目重載裁除剛停用的勾選，提交只含啟用項目', async () => {
  const client = createMockPlanningClient()
  const projectId = 'project-demo-1'
  const items = await client.listProjectItems(projectId)
  const plan = await client.createPlan(projectId, { name: '重載測試' })
  const create = vi.spyOn(client, 'createTask')
  const view = render(
    <PlanningPage client={client} initialProjectId={projectId} />,
  )
  await click(await screen.findByRole('link', { name: /重載測試（/ }))
  await openTaskCreationForm()
  await click(screen.getByLabelText(new RegExp(items[0].title)))
  await click(screen.getByLabelText(new RegExp(items[1].title)))
  const reloaded = {
    ...client,
    listProjectItems: vi.fn(async () => [
      { ...items[0], is_active: false },
      items[1],
    ]),
  }
  view.rerender(
    <PlanningPage client={reloaded} initialProjectId={projectId} />,
  )
  expect(
    await screen.findByText(`已移除剛停用的項目：${items[0].title}`),
  ).toBeVisible()
  expect(screen.queryByLabelText(new RegExp(items[0].title))).toBeNull()
  expect(screen.getByLabelText(new RegExp(items[1].title))).toBeChecked()
  fireEvent.change(screen.getByLabelText('補充地點'), {
    target: { value: '工地' },
  })
  await click(screen.getByRole('button', { name: '建立草稿任務' }))
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(
      plan.id,
      expect.objectContaining({ item_ids: [items[1].id] }),
    ),
  )
})

it('停用的建議指派人顯示改派提醒並靠近修改入口', async () => {
  const client = createMockPlanningClient()
  const plan = await client.createPlan('project-demo-1', { name: '停用改派' })
  const [item] = await client.listProjectItems('project-demo-1')
  await client.createTask(plan.id, {
    name: '檢查管線',
    item_ids: [item.id],
    suggested_assignee_id: 'project-a-member-1',
    zone_id: null,
    location_text: '一樓',
  })
  const original = client.getPlan.bind(client)
  vi.spyOn(client, 'getPlan').mockImplementation(async (id) => {
    const result = await original(id)
    return {
      ...result,
      tasks: result.tasks?.map((task) => ({
        ...task,
        assignee: task.assignee
          ? { ...task.assignee, is_active: false }
          : null,
      })),
    }
  })
  render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
  await click(await screen.findByRole('link', { name: /停用改派（/ }))
  expect(await screen.findByText('（已停用，請改派）')).toBeVisible()
  await openTaskDetail()
  expect(
    screen.getByRole('button', {
      name: '修改建議指派（已停用，請改派）',
    }),
  ).toBeVisible()
})

it.each([
  ['COMPLETED', false],
  ['CANCELLED', false],
  ['PENDING', true],
] as const)(
  '停用建議人於 %s、封存 %s 只顯示中性狀態',
  async (status, archived) => {
    const client = createMockPlanningClient()
    const plan = await client.createPlan('project-demo-1', {
      name: '歷史計畫',
    })
    const [item] = await client.listProjectItems('project-demo-1')
    await client.createTask(plan.id, {
      name: '歷史任務',
      item_ids: [item.id],
      suggested_assignee_id: 'project-a-member-1',
      zone_id: null,
      location_text: '一樓',
    })
    const original = client.getPlan.bind(client)
    vi.spyOn(client, 'getPlan').mockImplementation(async (id) => {
      const result = await original(id)
      return {
        ...result,
        archived,
        tasks: result.tasks?.map((task) => ({
          ...task,
          status,
          plan: { ...task.plan, archived },
          assignee: task.assignee
            ? { ...task.assignee, is_active: false }
            : null,
        })),
      }
    })
    render(<PlanningPage client={client} initialProjectId="project-demo-1" />)
    await click(await screen.findByRole('link', { name: /歷史計畫（/ }))
    expect(await screen.findByText('（已停用）')).toBeVisible()
    expect(screen.queryByText(/請改派/)).toBeNull()
  },
)

async function seedDraftWithItems(planName: string) {
  const client = createMockPlanningClient()
  const projectId = 'project-demo-1'
  const items = await client.listProjectItems(projectId)
  const plan = await client.createPlan(projectId, { name: planName })
  return { client, projectId, items, plan }
}

it('IP-AC24：取消勾選停用項目後焦點移到選單群組，警告綁在勾選框', async () => {
  const { client, projectId, items } = await seedDraftWithItems('焦點計畫')
  await client.createTask((await client.listPlans(projectId)).items[0].id, {
    name: '保留停用',
    item_ids: [items[0].id],
    zone_id: null,
    location_text: '工地',
    suggested_assignee_id: null,
  })
  client.listProjectItems = vi.fn(async () => [
    { ...items[0], is_active: false },
    items[1],
  ])
  render(<PlanningPage client={client} initialProjectId={projectId} />)
  await click(await screen.findByRole('link', { name: /焦點計畫（/ }))
  const article = (
    await screen.findByRole('heading', { name: /保留停用/ })
  ).closest('article')!
  await openTaskDetail()
  await click(within(article).getByRole('button', { name: '修改查核項目' }))
  const editForm = document.querySelector(
    '[data-error-context="items"]',
  ) as HTMLFormElement
  const box = within(editForm).getByLabelText(new RegExp(items[0].title))
  const note = document.getElementById(box.getAttribute('aria-describedby')!)
  expect(note).toHaveTextContent('取消勾選後無法再加回。')
  await click(box)
  expect(
    within(editForm).queryByLabelText(new RegExp(items[0].title)),
  ).toBeNull()
  expect(
    within(editForm).getByRole('group', { name: /選擇一筆以上查核項目/ }),
  ).toHaveFocus()
})

it('IP-AC24：送出時項目剛被停用，自動重載並保留其他欄位', async () => {
  const { client, projectId, items } = await seedDraftWithItems('自動重載計畫')
  let deactivated = false
  client.listProjectItems = vi.fn(async () =>
    deactivated ? [{ ...items[0], is_active: false }, items[1]] : items,
  )
  client.createTask = vi.fn(async () => {
    deactivated = true
    throw new ManagementApiError(409, 'project_inspection_item.inactive')
  })
  render(<PlanningPage client={client} initialProjectId={projectId} />)
  await click(await screen.findByRole('link', { name: /自動重載計畫（/ }))
  await openTaskCreationForm()
  await click(screen.getByLabelText(new RegExp(items[0].title)))
  await click(screen.getByLabelText(new RegExp(items[1].title)))
  fireEvent.change(screen.getByLabelText('補充地點'), {
    target: { value: '工地北側' },
  })
  fireEvent.change(screen.getByLabelText(/任務名稱/), {
    target: { value: '我自己取的名稱' },
  })
  const before = vi.mocked(client.listProjectItems).mock.calls.length
  await click(screen.getByRole('button', { name: '建立草稿任務' }))
  // 不要求使用者手動重新載入：項目清單自動再讀一次。
  await waitFor(() =>
    expect(vi.mocked(client.listProjectItems).mock.calls.length).toBe(
      before + 1,
    ),
  )
  expect(
    await screen.findByText(
      '所選的查核項目剛被停用，清單已更新並取消勾選，請確認後再送出。',
    ),
  ).toBeVisible()
  expect(
    await screen.findByText(`已移除剛停用的項目：${items[0].title}`),
  ).toBeVisible()
  expect(screen.queryByLabelText(new RegExp(items[0].title))).toBeNull()
  expect(screen.getByLabelText(new RegExp(items[1].title))).toBeChecked()
  expect(screen.getByLabelText('補充地點')).toHaveValue('工地北側')
  expect(screen.getByLabelText(/任務名稱/)).toHaveValue('我自己取的名稱')
  // 重載只發生一次，沒有重載迴圈。
  expect(vi.mocked(client.listProjectItems).mock.calls.length).toBe(before + 1)
})

it('IP-AC24：修改草稿時新勾選的項目剛被停用，重載後裁掉並保留原有的停用項目', async () => {
  const { client, projectId, items, plan } =
    await seedDraftWithItems('草稿重載計畫')
  await client.createTask(plan.id, {
    name: '草稿重載任務',
    item_ids: [items[0].id],
    zone_id: null,
    location_text: '工地',
    suggested_assignee_id: null,
  })
  // items[0] 從頭就是停用（草稿原本已含），重載後仍須保留勾選。
  let deactivated = false
  client.listProjectItems = vi.fn(async () => [
    { ...items[0], is_active: false },
    deactivated ? { ...items[1], is_active: false } : items[1],
  ])
  const realUpdate = client.updateTaskItems.bind(client)
  client.updateTaskItems = vi.fn(async (taskId, body) => {
    if (!deactivated) {
      deactivated = true
      throw new ManagementApiError(409, 'project_inspection_item.inactive')
    }
    return realUpdate(taskId, body)
  })
  render(<PlanningPage client={client} initialProjectId={projectId} />)
  await click(await screen.findByRole('link', { name: /草稿重載計畫（/ }))
  const article = (
    await screen.findByRole('heading', { name: /草稿重載任務/ })
  ).closest('article')!
  await openTaskDetail()
  await click(within(article).getByRole('button', { name: '修改查核項目' }))
  const form = document.querySelector(
    '[data-error-context="items"]',
  ) as HTMLFormElement
  await click(within(form).getByLabelText(new RegExp(items[1].title)))
  const before = vi.mocked(client.listProjectItems).mock.calls.length
  await click(within(form).getByRole('button', { name: '儲存查核項目' }))
  await waitFor(() =>
    expect(vi.mocked(client.listProjectItems).mock.calls.length).toBe(
      before + 1,
    ),
  )
  expect(
    await within(form).findByText(
      '所選的查核項目剛被停用，清單已更新並取消勾選，請確認後再送出。',
    ),
  ).toBeVisible()
  await waitFor(() =>
    expect(
      within(form).queryByLabelText(new RegExp(items[1].title)),
    ).toBeNull(),
  )
  expect(within(form).getByLabelText(new RegExp(items[0].title))).toBeChecked()
  // 重載只發生一次，沒有重載迴圈。
  expect(vi.mocked(client.listProjectItems).mock.calls.length).toBe(before + 1)
  // 再送出：item_ids 仍含原有的停用項目、不含剛停用的新項目。
  await click(within(form).getByRole('button', { name: '儲存查核項目' }))
  await waitFor(() =>
    expect(client.updateTaskItems).toHaveBeenLastCalledWith(
      expect.any(String),
      { item_ids: [items[0].id] },
    ),
  )
})

it('IP-AC24：修改草稿重載後伺服器集合已不含某停用項目時，該項目被裁掉', async () => {
  const { client, projectId, items, plan } =
    await seedDraftWithItems('伺服器已改計畫')
  const task = await client.createTask(plan.id, {
    name: '伺服器已改任務',
    item_ids: [items[0].id, items[1].id],
    zone_id: null,
    location_text: '工地',
    suggested_assignee_id: null,
  })
  // 兩項都是停用的原有項目；編輯期間別人把 items[0] 從任務移除。
  client.listProjectItems = vi.fn(async () =>
    items.map((item) => ({ ...item, is_active: false })),
  )
  let serverChanged = false
  const realGetPlan = client.getPlan.bind(client)
  client.getPlan = vi.fn(async (planId) => {
    const detail = await realGetPlan(planId)
    if (!serverChanged) return detail
    return {
      ...detail,
      tasks: detail.tasks?.map((t) =>
        t.id === task.id
          ? { ...t, items: t.items.filter((i) => i.id !== items[0].id) }
          : t,
      ),
    }
  })
  client.updateTaskItems = vi.fn(async () => {
    serverChanged = true
    throw new ManagementApiError(409, 'project_inspection_item.inactive')
  })
  render(<PlanningPage client={client} initialProjectId={projectId} />)
  await click(await screen.findByRole('link', { name: /伺服器已改計畫（/ }))
  const article = (
    await screen.findByRole('heading', { name: /伺服器已改任務/ })
  ).closest('article')!
  await openTaskDetail()
  await click(within(article).getByRole('button', { name: '修改查核項目' }))
  const form = document.querySelector(
    '[data-error-context="items"]',
  ) as HTMLFormElement
  expect(within(form).getByLabelText(new RegExp(items[0].title))).toBeChecked()
  await click(within(form).getByRole('button', { name: '儲存查核項目' }))
  await waitFor(() =>
    expect(
      within(form).queryByLabelText(new RegExp(items[0].title)),
    ).toBeNull(),
  )
  expect(within(form).getByLabelText(new RegExp(items[1].title))).toBeChecked()
})

it('IP-AC24：專案項目全被停用時，新增任務提示先新增或恢復', async () => {
  const { client, projectId, items } = await seedDraftWithItems('全停用計畫')
  client.listProjectItems = vi.fn(async () =>
    items.map((item) => ({ ...item, is_active: false })),
  )
  render(<PlanningPage client={client} initialProjectId={projectId} />)
  await click(await screen.findByRole('link', { name: /全停用計畫（/ }))
  await openTaskCreationForm()
  expect(
    await screen.findByText(
      '目前沒有啟用的查核項目，請先到專案查核項目新增或恢復。',
    ),
  ).toBeVisible()
  expect(
    screen.queryByText('這個專案還沒有查核項目，請先到專案查核項目新增。'),
  ).toBeNull()
})

it('IP-AC24：專案沒有任何查核項目時用另一句提示', async () => {
  const { client, projectId } = await seedDraftWithItems('無項目計畫')
  client.listProjectItems = vi.fn(async () => [])
  render(<PlanningPage client={client} initialProjectId={projectId} />)
  await click(await screen.findByRole('link', { name: /無項目計畫（/ }))
  await openTaskCreationForm()
  expect(
    await screen.findByText(
      '這個專案還沒有查核項目，請先到專案查核項目新增。',
    ),
  ).toBeVisible()
  expect(screen.queryByText(/目前沒有啟用的查核項目/)).toBeNull()
})
