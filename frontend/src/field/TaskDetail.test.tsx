import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import TaskDetail from './TaskDetail'

const field = {
  id: 'field-1',
  name: '長度',
  field_type: 'number',
  unit: 'mm',
}
const basePoint = {
  sequence: 1,
  title: '鋼筋間距',
  instruction: '現場實測',
  text_standard: null,
  numeric_standard: {
    value: null,
    condition: 'range',
    unit: 'mm',
    tolerance: null,
    range_form: 'interval',
    lower_bound: '3',
    upper_bound: '4',
    measurement_field_id: 'field-1',
  },
  measurement_fields: [field],
  evidence_requirements: [
    {
      evidence_type: 'photo',
      required: true,
      min_count: 2,
      max_count: null,
    },
  ],
}
const detail = {
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
      inspection_points: [basePoint],
    },
    {
      title: '混凝土查核',
      instruction: '核對澆置紀錄',
      inspection_points: [
        {
          ...basePoint,
          sequence: 2,
          title: '保護層厚度',
          numeric_standard: {
            ...basePoint.numeric_standard,
            value: '5',
            tolerance: '0.5',
            range_form: 'tolerance',
            lower_bound: null,
            upper_bound: null,
          },
        },
      ],
    },
  ],
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/field/tasks/task-1?scope=all']}>
      <Routes>
        <Route
          path="/field/tasks/:id"
          element={<TaskDetail taskId="task-1" />}
        />
        <Route path="/field/" element={<p>任務清單</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('現場任務詳情', () => {
  it('呈現快照順序、位置、指派、照片與兩種量測標準', async () => {
    const fetcher = vi.fn(async () => Response.json(detail))
    vi.stubGlobal('fetch', fetcher)
    renderDetail()
    expect(await screen.findByText('依圖面查核')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        name: '外牆鋼筋查核 等 2 項',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('示範工程甲')).toBeInTheDocument()
    expect(screen.getByText('分區：一樓')).toBeInTheDocument()
    expect(screen.getByText('東側')).toBeInTheDocument()
    expect(screen.getByText('示範查核員')).toBeInTheDocument()
    expect(screen.getByText(/派送時間/).parentElement).toHaveTextContent(
      /2026/,
    )
    const articles = document.querySelectorAll('.field-detail-item')
    expect(articles).toHaveLength(2)
    expect(
      within(articles[0] as HTMLElement).getByText('外牆鋼筋查核'),
    ).toBeInTheDocument()
    expect(
      within(articles[1] as HTMLElement).getByText('混凝土查核'),
    ).toBeInTheDocument()
    expect(screen.getAllByText('長度（mm）')).toHaveLength(2)
    expect(screen.getByText('3～4 mm')).toBeInTheDocument()
    expect(screen.getByText('5 ± 0.5 mm')).toBeInTheDocument()
    expect(screen.getAllByText('至少 2 張')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '開始查核' })).toBeEnabled()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('無分區與進行中任務只顯示可用資訊', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ...detail,
          status: 'IN_PROGRESS',
          location: { zone_name: null, location_text: '西側' },
          suggested_assignee: null,
          started_by: { name_zh: '示範查核員乙', is_me: false },
        }),
      ),
    )
    renderDetail()
    expect(await screen.findByText('西側')).toBeInTheDocument()
    expect(screen.queryByText(/分區：/)).not.toBeInTheDocument()
    expect(screen.getByText('未指定')).toBeInTheDocument()
    expect(screen.getByText('查核進行中')).toBeInTheDocument()
    expect(screen.getByText('實際開始者：示範查核員乙')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /開始查核/ }),
    ).not.toBeInTheDocument()
  })

  it.each([
    ['COMPLETED', '已完成', '查核已完成，可查看需求。'],
    ['CANCELLED', '已取消', '任務已取消，可查看需求。'],
  ])('終止狀態 %s 仍能唯讀查看需求', async (status, label, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ...detail, status })),
    )
    renderDetail()
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByText('3～4 mm')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /開始查核/ }),
    ).not.toBeInTheDocument()
  })

  it.each([
    [403, '無法查看任務'],
    [500, '無法載入任務詳情'],
  ])('狀態 %i 顯示對應錯誤與返回連結', async (status, heading) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'failed' }, { status })),
    )
    renderDetail()
    expect(
      await screen.findByRole('heading', { name: heading }),
    ).toBeInTheDocument()
    const back = screen.getByRole('link', { name: '返回任務清單' })
    expect(back).toHaveClass('button-link')
    fireEvent.click(back)
    expect(screen.getByText('任務清單')).toBeInTheDocument()
  })

  it.each([404, 422])(
    '狀態 %i（不存在或 id 格式不對）顯示找不到與回首頁',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ error: 'failed' }, { status })),
      )
      renderDetail()
      expect(
        await screen.findByRole('heading', { name: '找不到這筆任務' }),
      ).toBeInTheDocument()
      const home = screen.getByRole('link', { name: '回首頁' })
      expect(home).toHaveClass('button-link')
      expect(home).toHaveAttribute('href', '/field')
    },
  )

  it('其他錯誤的重試按鈕留在錯誤區', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({}, { status: 500 })),
    )
    renderDetail()
    const alert = await screen.findByRole('alert')
    expect(
      within(alert).getByRole('button', { name: '重試' }),
    ).toBeInTheDocument()
    expect(alert).toHaveClass('field-detail-error')
  })

  it.each([
    {
      ...basePoint.numeric_standard,
      lower_bound: null,
      upper_bound: null,
    },
    {
      ...basePoint.numeric_standard,
      lower_bound: '無效',
      upper_bound: null,
    },
    {
      ...basePoint.numeric_standard,
      range_form: 'tolerance',
      value: null,
      tolerance: '0.5',
      lower_bound: null,
      upper_bound: null,
    },
    {
      ...basePoint.numeric_standard,
      range_form: 'tolerance',
      value: '5',
      tolerance: null,
      lower_bound: null,
      upper_bound: null,
    },
  ])('拒絕缺少必要數值的標準 %j', async (standard) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ...detail,
          items: [
            {
              ...detail.items[0],
              inspection_points: [
                {
                  ...basePoint,
                  numeric_standard: standard,
                },
              ],
            },
          ],
        }),
      ),
    )
    renderDetail()
    expect(
      await screen.findByRole('heading', { name: '無法載入任務詳情' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/null～null/)).not.toBeInTheDocument()
  })

  it.each([
    [null, '4', '≤ 4 mm'],
    ['3', null, '≥ 3 mm'],
  ])('單側區間標準以界線表示，不顯示 null', async (lower, upper, label) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ...detail,
          items: [
            {
              ...detail.items[0],
              inspection_points: [
                {
                  ...basePoint,
                  numeric_standard: {
                    ...basePoint.numeric_standard,
                    lower_bound: lower,
                    upper_bound: upper,
                  },
                },
              ],
            },
          ],
        }),
      ),
    )
    renderDetail()
    expect(await screen.findByText(label)).toBeInTheDocument()
    expect(screen.queryByText(/null/)).not.toBeInTheDocument()
  })

  it('拒絕錯誤的詳情回應形狀', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ...detail,
          items: [{ title: '缺少快照欄位' }],
        }),
      ),
    )
    renderDetail()
    expect(
      await screen.findByRole('heading', {
        name: '無法載入任務詳情',
      }),
    ).toBeInTheDocument()
  })
})
