import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import TaskDetail from './TaskDetail'

type Detail = Record<string, unknown>

const PENDING: Detail = {
  id: 'task-1',
  project_id: 'project-1',
  project_name: '示範工程甲',
  status: 'PENDING',
  dispatched_at: '2026-10-05T08:00:00Z',
  location: { zone_name: '一樓', location_text: '東側' },
  suggested_assignee: { name_zh: '示範查核員', is_me: true },
  started_by: null,
  cancellation_reason: null,
  items: [
    {
      title: '外牆鋼筋查核',
      instruction: '依圖面查核',
      inspection_points: [],
    },
  ],
}

const STARTED_BY_ME: Detail = {
  ...PENDING,
  status: 'IN_PROGRESS',
  started_by: { name_zh: '示範查核員', is_me: true },
}

// 與後端 `_task_summary` 同形（開始端點回傳的 Task 摘要）。
const START_RESPONSE = {
  id: 'task-1',
  project_id: 'project-1',
  plan_id: 'plan-1',
  status: 'IN_PROGRESS',
  started_by: 'user-id',
  cancellation_reason: null,
  items: [],
}

const CANCELLED: Detail = {
  ...PENDING,
  status: 'CANCELLED',
  cancellation_reason: '施工順序調整，改日重派',
}

function errorBody(code: string) {
  return { error: { code } }
}

interface StartRoutes {
  /** 依序回傳的詳情（最後一筆重複使用）。 */
  details: Array<Detail | Response>
  start: () => Response | Promise<Response>
}

function setup(routes: StartRoutes) {
  let detailCalls = 0
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') {
        expect(url).toBe('/api/v1/inspection-tasks/task-1:start')
        return routes.start()
      }
      expect(url).toBe('/api/v1/field/inspection-tasks/task-1')
      const next =
        routes.details[Math.min(detailCalls, routes.details.length - 1)]
      detailCalls += 1
      return next instanceof Response ? next : Response.json(next)
    },
  )
  vi.stubGlobal('fetch', fetcher)
  const onListChange = vi.fn()
  render(
    <MemoryRouter initialEntries={['/field/tasks/task-1?scope=all']}>
      <Routes>
        <Route
          path="/field/tasks/:id"
          element={<TaskDetail taskId="task-1" onListChange={onListChange} />}
        />
        <Route path="/field/" element={<p>任務清單</p>} />
        <Route path="/login" element={<p>登入頁</p>} />
      </Routes>
    </MemoryRouter>,
  )
  const posts = () =>
    fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')
  return { fetcher, onListChange, posts }
}

async function openConfirm() {
  fireEvent.click(await screen.findByRole('button', { name: '開始查核' }))
}

async function confirm() {
  await openConfirm()
  fireEvent.click(screen.getByRole('button', { name: '確認開始查核' }))
}

afterEach(() => vi.unstubAllGlobals())

describe('開始查核：確認步驟', () => {
  it('按下開始查核只展開確認，不送出請求；返回查看需求可收起', async () => {
    const { posts } = setup({
      details: [PENDING],
      start: () => Response.json(START_RESPONSE),
    })
    await openConfirm()
    expect(
      screen.getByRole('heading', { name: '確認開始「外牆鋼筋查核」？' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('開始後會改為進行中，並記錄你是實際開始者。'),
    ).toBeInTheDocument()
    expect(posts()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '返回查看需求' }))
    expect(screen.queryByText(/確認開始/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '開始查核' })).toBeEnabled()
    expect(posts()).toHaveLength(0)
  })

  it('建議指派人本人不顯示「建議由某人執行」提示', async () => {
    setup({ details: [PENDING], start: () => Response.json(START_RESPONSE) })
    await openConfirm()
    expect(screen.queryByText(/這筆任務建議由/)).not.toBeInTheDocument()
    expect(
      screen.queryByText('你也可以協助開始此任務；會記錄實際開始者。'),
    ).not.toBeInTheDocument()
  })

  it('非建議指派者看到提示但仍可開始（STM-R11）', async () => {
    const other = {
      ...PENDING,
      suggested_assignee: { name_zh: '示範查核員乙', is_me: false },
    }
    const { posts } = setup({
      details: [other, STARTED_BY_ME],
      start: () => Response.json(START_RESPONSE),
    })
    expect(
      await screen.findByText('你也可以協助開始此任務；會記錄實際開始者。'),
    ).toBeInTheDocument()
    await openConfirm()
    expect(
      screen.getByText(
        '這筆任務建議由示範查核員乙執行。你仍可以開始，系統會記錄你是實際開始者。',
      ),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '確認開始查核' }))
    expect(await screen.findByText('查核進行中')).toBeInTheDocument()
    expect(posts()).toHaveLength(1)
  })

  it('未指定建議指派人時沒有提示', async () => {
    setup({
      details: [{ ...PENDING, suggested_assignee: null }],
      start: () => Response.json(START_RESPONSE),
    })
    await openConfirm()
    expect(screen.queryByText(/這筆任務建議由/)).not.toBeInTheDocument()
  })
})

describe('開始查核：成功', () => {
  it('以後端回應更新，顯示實際開始者並通知清單', async () => {
    const { posts, onListChange, fetcher } = setup({
      details: [PENDING, STARTED_BY_ME],
      start: () => Response.json(START_RESPONSE),
    })
    await confirm()
    const ok = await screen.findByRole('status')
    expect(within(ok).getByText('查核進行中')).toBeInTheDocument()
    expect(
      within(ok).getByText('實際開始者：示範查核員（你）'),
    ).toBeInTheDocument()
    await waitFor(() => expect(ok).toHaveFocus())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /開始查核/ }),
    ).not.toBeInTheDocument()
    expect(screen.getAllByText('進行中')).toHaveLength(1)
    expect(posts()).toHaveLength(1)
    expect(posts()[0][1]).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
    })
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(onListChange).toHaveBeenCalledWith({
      id: 'task-1',
      status: 'IN_PROGRESS',
    })
  })

  it('不做樂觀更新：等後端回應前仍是待開始，且不能重複送出', async () => {
    let release: (value: Response) => void = () => undefined
    const pending = new Promise<Response>((resolve) => {
      release = resolve
    })
    const { posts } = setup({
      details: [PENDING, STARTED_BY_ME],
      start: () => pending,
    })
    await confirm()
    const busy = screen.getByRole('button', { name: '開始中…' })
    expect(busy).toBeDisabled()
    expect(screen.getByRole('button', { name: '返回查看需求' })).toBeDisabled()
    fireEvent.click(busy)
    expect(posts()).toHaveLength(1)
    expect(screen.getByText('待開始')).toBeInTheDocument()
    expect(screen.queryByText('查核進行中')).not.toBeInTheDocument()
    release(Response.json(START_RESPONSE))
    expect(await screen.findByText('查核進行中')).toBeInTheDocument()
    expect(screen.queryByText('待開始')).not.toBeInTheDocument()
  })

  it('開始成功但重抓詳情失敗時，只用後端確認的狀態與本人', async () => {
    setup({
      details: [PENDING, Response.json({}, { status: 500 })],
      start: () => Response.json(START_RESPONSE),
    })
    await confirm()
    expect(await screen.findByText('實際開始者：你')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('後端回應形狀不符時不顯示進行中', async () => {
    setup({
      details: [PENDING],
      start: () => Response.json({ ok: true }),
    })
    await confirm()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('這筆任務還沒有開始')
    expect(screen.queryByText('查核進行中')).not.toBeInTheDocument()
  })
})

describe('開始查核：失敗文案、位置與聚焦', () => {
  async function expectError(message: string) {
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(message)
    await waitFor(() => expect(alert).toHaveFocus())
    // 錯誤在操作區內，不是頁面頂端的通用訊息。
    expect(alert.closest('.field-action-panel')).not.toBeNull()
    return alert
  }

  it('任務已被內業取消：說明原因，詳情改為已取消並通知清單移除', async () => {
    const { onListChange, posts } = setup({
      details: [PENDING, CANCELLED],
      start: () =>
        Response.json(errorBody('inspection_task.invalid_transition'), {
          status: 409,
        }),
    })
    await confirm()
    await expectError(
      '內業已取消這筆任務，所以無法開始。取消原因：施工順序調整，改日重派。返回任務清單會看到最新內容。',
    )
    expect(screen.getByText('已取消')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /開始查核/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/任務已取消，可查看需求/),
    ).not.toBeInTheDocument()
    expect(onListChange).toHaveBeenCalledWith({
      id: 'task-1',
      removed: true,
    })
    fireEvent.click(screen.getByRole('link', { name: '返回任務清單' }))
    expect(screen.getByText('任務清單')).toBeInTheDocument()
    expect(posts()).toHaveLength(1)
  })

  it('已由他人開始：說明是誰開始，不重複開始', async () => {
    const byOther = {
      ...PENDING,
      status: 'IN_PROGRESS',
      started_by: { name_zh: '示範查核員乙', is_me: false },
    }
    const { onListChange } = setup({
      details: [PENDING, byOther],
      start: () =>
        Response.json(errorBody('inspection_task.invalid_transition'), {
          status: 409,
        }),
    })
    await confirm()
    await expectError(
      '這筆任務已由示範查核員乙開始，所以不需要再開始。返回任務清單會看到最新內容。',
    )
    expect(screen.getByText('實際開始者：示範查核員乙')).toBeInTheDocument()
    expect(onListChange).toHaveBeenCalledWith({
      id: 'task-1',
      status: 'IN_PROGRESS',
    })
  })

  it('其實是自己已開始（例如回應遺失）：直接顯示進行中，不報錯', async () => {
    setup({
      details: [PENDING, STARTED_BY_ME],
      start: () =>
        Response.json(errorBody('inspection_task.invalid_transition'), {
          status: 409,
        }),
    })
    await confirm()
    expect(
      await screen.findByText('實際開始者：示範查核員（你）'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('任務已完成', async () => {
    setup({
      details: [PENDING, { ...PENDING, status: 'COMPLETED' }],
      start: () =>
        Response.json(errorBody('inspection_task.invalid_transition'), {
          status: 409,
        }),
    })
    await confirm()
    await expectError(
      '這筆任務已經完成，所以無法開始。返回任務清單會看到最新內容。',
    )
  })

  it('狀態仍是待開始卻被拒絕：不假裝知道原因', async () => {
    setup({
      details: [PENDING],
      start: () =>
        Response.json(errorBody('inspection_task.invalid_transition'), {
          status: 409,
        }),
    })
    await confirm()
    await expectError('系統拒絕了這次操作，任務目前的狀態不能開始。')
    expect(
      screen.queryByRole('button', { name: /開始查核/ }),
    ).not.toBeInTheDocument()
  })

  it('計畫已封存（STM-R16）：說明封存，不重抓、不移出清單', async () => {
    const { fetcher, onListChange } = setup({
      details: [PENDING],
      start: () =>
        Response.json(errorBody('inspection_plan.archived'), { status: 409 }),
    })
    await confirm()
    await expectError(
      '這筆任務所屬的查核計畫已被內業封存，封存後任務只能查看，所以無法開始。請洽內業確認是否取消封存。返回任務清單會看到最新內容。',
    )
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(onListChange).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('button', { name: /開始查核/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回任務清單' })).toHaveClass(
      'button-link',
    )
  })

  it('權限不足', async () => {
    const { onListChange } = setup({
      details: [PENDING],
      start: () =>
        Response.json(errorBody('permission.denied'), { status: 403 }),
    })
    await confirm()
    await expectError(
      '你目前沒有開始這筆任務的權限，任務沒有被改動。請聯絡專案管理者確認你的現場查核權限。',
    )
    expect(onListChange).not.toHaveBeenCalled()
  })

  it('需先變更臨時密碼', async () => {
    setup({
      details: [PENDING],
      start: () =>
        Response.json(errorBody('auth.password_change_required'), {
          status: 403,
        }),
    })
    await confirm()
    await expectError('請先變更臨時密碼，再開始查核。任務沒有被改動。')
  })

  it('任務不存在或已看不到', async () => {
    const { onListChange } = setup({
      details: [PENDING],
      start: () =>
        Response.json(errorBody('resource.not_found'), { status: 404 }),
    })
    await confirm()
    await expectError(
      '找不到這筆任務，或你已無法查看它，所以無法開始。返回任務清單會看到最新內容。',
    )
    expect(onListChange).toHaveBeenCalledWith({
      id: 'task-1',
      removed: true,
    })
  })

  it.each([
    [
      '伺服器錯誤',
      () => Response.json(errorBody('server.internal_error'), { status: 500 }),
    ],
    [
      '網路中斷',
      () => {
        throw new TypeError('Failed to fetch')
      },
    ],
  ])('%s：任務未開始，保留確認並可再按一次', async (_name, failStart) => {
    let attempts = 0
    const { posts } = setup({
      details: [PENDING, STARTED_BY_ME],
      start: () => {
        attempts += 1
        return attempts === 1 ? failStart() : Response.json(START_RESPONSE)
      },
    })
    await confirm()
    await expectError(
      '網路或伺服器暫時出問題，這筆任務還沒有開始。請確認連線後再按一次「確認開始查核」。',
    )
    expect(screen.getByText('待開始')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '確認開始查核' }))
    expect(await screen.findByText('查核進行中')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(posts()).toHaveLength(2)
  })

  it('狀態已變但重抓失敗：誠實說明抓不到最新內容', async () => {
    setup({
      details: [PENDING, Response.json({}, { status: 500 })],
      start: () =>
        Response.json(errorBody('inspection_task.invalid_transition'), {
          status: 409,
        }),
    })
    await confirm()
    await expectError(
      '任務的狀態已經改變，所以無法開始，但目前抓不到最新內容。請返回任務清單重新確認。',
    )
  })

  it('狀態已變且重抓得到 404：說明找不到任務', async () => {
    setup({
      details: [PENDING, Response.json({}, { status: 404 })],
      start: () =>
        Response.json(errorBody('inspection_task.invalid_transition'), {
          status: 409,
        }),
    })
    await confirm()
    await expectError('找不到這筆任務')
  })

  it('其他 4xx 與重新送出時清掉舊訊息', async () => {
    let attempts = 0
    setup({
      details: [PENDING, STARTED_BY_ME],
      start: () => {
        attempts += 1
        return attempts === 1
          ? Response.json(errorBody('request.validation_failed'), {
              status: 422,
            })
          : Response.json(START_RESPONSE)
      },
    })
    await confirm()
    await expectError('這筆任務還沒有開始')
    fireEvent.click(screen.getByRole('button', { name: '返回查看需求' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('401 導向登入', async () => {
    setup({
      details: [PENDING],
      start: () =>
        Response.json(errorBody('auth.not_authenticated'), { status: 401 }),
    })
    await confirm()
    expect(await screen.findByText('登入頁')).toBeInTheDocument()
  })

  it('已取消任務直接開啟時顯示取消原因，且沒有開始操作', async () => {
    setup({ details: [CANCELLED], start: () => Response.json({}) })
    expect(
      await screen.findByText(
        '任務已取消，可查看需求。取消原因：施工順序調整，改日重派',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /開始查核/ }),
    ).not.toBeInTheDocument()
  })

  it('開始失敗後再次展開確認不殘留舊訊息', async () => {
    let attempts = 0
    setup({
      details: [PENDING],
      start: () => {
        attempts += 1
        return Response.json(errorBody('server.internal_error'), {
          status: 500,
        })
      },
    })
    await confirm()
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '返回查看需求' }))
    await openConfirm()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(attempts).toBe(1)
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '確認開始查核' }),
      ).toBeEnabled(),
    )
  })
})
