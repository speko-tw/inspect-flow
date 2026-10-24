import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  auditLogEntryFixture,
  auditLogPageFixture,
} from '../../testing/contractFixtures'
import AuditLogPage from './AuditLogPage'
import auditContract from './fixtures/audit-log-contract.json'

const projectId = auditContract.query.project_id
const actorId = auditContract.query.actor_id

function mockFetch(
  auditResponse: (url: URL) => Response = (url) =>
    Response.json(
      url.searchParams.get('cursor')
        ? auditLogPageFixture({
            items: [auditLogEntryFixture({ id: 'third' })],
          })
        : auditLogPageFixture({ next_cursor: 'second-page' }),
    ),
) {
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname.endsWith('/projects')) {
        return Response.json({
          items: [{ id: projectId, name: '甲專案', project_code: 'P-1' }],
          next_cursor: null,
        })
      }
      if (url.pathname.endsWith('/users')) {
        return Response.json(
          url.searchParams.get('cursor')
            ? {
                items: [{ id: 'user-2', username: 'ben', name_zh: '班' }],
                next_cursor: null,
              }
            : {
                items: [{ id: actorId, username: 'anna', name_zh: '安娜' }],
                next_cursor: 'users-page-2',
              },
        )
      }
      if (url.pathname.endsWith('/audit-logs')) {
        if (init?.method && init.method !== 'GET') {
          return Response.json({}, { status: 405 })
        }
        return auditResponse(url)
      }
      return Response.json({}, { status: 404 })
    },
  )
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('稽核查詢頁', () => {
  it('套用四類篩選、翻頁與返回，僅送 GET 查詢', async () => {
    const fetcher = mockFetch()
    render(<AuditLogPage />)
    expect(
      await screen.findByText('建立分區', { selector: 'h2' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('option', { name: '班 (ben)' }),
    ).toBeInTheDocument()
    expect(screen.getAllByText('甲專案 (P-1)')).toHaveLength(2)
    expect(screen.getAllByText('安娜 (anna)')).toHaveLength(2)
    const userRequests = fetcher.mock.calls
      .map(([input]) => new URL(String(input), 'http://localhost'))
      .filter((url) => url.pathname.endsWith('/users'))
    expect(userRequests).toHaveLength(2)
    expect(userRequests[0].searchParams.get('limit')).toBe('100')
    expect(userRequests[1].searchParams.get('cursor')).toBe('users-page-2')
    fireEvent.change(screen.getByLabelText('專案'), {
      target: { value: projectId },
    })
    fireEvent.change(screen.getByLabelText('操作者'), {
      target: { value: actorId },
    })
    fireEvent.change(screen.getByLabelText('起始時間（含）'), {
      target: { value: auditContract.local_from },
    })
    fireEvent.change(screen.getByLabelText('結束時間（不含）'), {
      target: { value: auditContract.local_to },
    })
    fireEvent.change(screen.getByLabelText('事件類型'), {
      target: { value: auditContract.query.event_type },
    })
    fireEvent.click(screen.getByRole('button', { name: '查詢' }))
    await waitFor(() => {
      const urls = fetcher.mock.calls.map(([input]) => String(input))
      const search = urls.find(
        (url) => url.includes('/audit-logs?') && url.includes('project_id='),
      )
      expect(search).toBeDefined()
      const params = new URL(search!, 'http://localhost').searchParams
      expect(Object.fromEntries(params)).toEqual(auditContract.query)
    })
    fireEvent.click(screen.getByRole('button', { name: '下一頁' }))
    await waitFor(() => {
      const nextRequest = fetcher.mock.calls.find(([input]) =>
        String(input).includes('cursor=second-page'),
      )
      expect(nextRequest).toBeDefined()
      const params = new URL(String(nextRequest?.[0]), 'http://localhost')
        .searchParams
      expect(Object.fromEntries(params)).toEqual({
        ...auditContract.query,
        cursor: 'second-page',
      })
    })
    expect(screen.getByText('第 2 頁')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '上一頁' }))
    await waitFor(() => {
      expect(screen.getByText('第 1 頁')).toBeInTheDocument()
      const auditRequests = fetcher.mock.calls.filter(([input]) =>
        String(input).includes('/audit-logs?'),
      )
      const params = new URL(
        String(auditRequests.at(-1)?.[0]),
        'http://localhost',
      ).searchParams
      expect(params.has('cursor')).toBe(false)
      expect(params.get('project_id')).toBe(projectId)
    })
    expect(fetcher.mock.calls.every(([, init]) => !init?.method)).toBe(true)
  })

  it('事件與對象顯示白話，不露出事件碼與內部編號（#713）', async () => {
    const entityId = '00000000-0000-0000-0000-0000000000aa'
    mockFetch(() =>
      Response.json(
        auditLogPageFixture({
          items: [
            auditLogEntryFixture({
              id: 'a',
              event_type: 'user.active_changed',
              entity_type: 'user',
              entity_id: actorId,
              before: { is_active: true },
              after: { is_active: false },
            }),
            auditLogEntryFixture({
              id: 'b',
              event_type: 'module_permission.granted',
              entity_type: 'module_permission',
              entity_id: entityId,
              after: {
                user_id: actorId,
                permission_code: 'project.create',
                module: 'project',
                source: 'direct',
              },
            }),
            auditLogEntryFixture({
              id: 'c',
              event_type: 'role.created',
              entity_type: 'role',
              entity_id: entityId,
              after: { name: '現場工程師', permission_codes: [] },
            }),
            auditLogEntryFixture({
              id: 'd',
              event_type: 'future.unmapped_event',
              entity_type: 'future_thing',
              entity_id: entityId,
              after: null,
            }),
          ],
        }),
      ),
    )
    render(<AuditLogPage />)

    expect(await screen.findByText('停用帳號')).toBeVisible()
    expect(screen.getByText('開通權限', { selector: 'h2' })).toBeVisible()
    expect(screen.getByText('建立角色', { selector: 'h2' })).toBeVisible()
    expect(screen.getByText('其他操作')).toBeVisible()
    await waitFor(() =>
      expect(screen.getAllByText('帳號：安娜 (anna)')).toHaveLength(2),
    )
    expect(screen.getByText('角色：現場工程師')).toBeVisible()
    expect(screen.getByText('對象', { selector: 'dd' })).toBeVisible()
    // 收合的「改前與改後內容」是給稽核者看的原始資料，不在白話範圍。
    const page = document.body.cloneNode(true) as HTMLElement
    page.querySelectorAll('details').forEach((node) => node.remove())
    const visible = page.textContent ?? ''
    expect(visible).not.toContain(entityId)
    expect(visible).not.toContain(actorId)
    expect(visible).not.toContain('user.active_changed')
    expect(visible).not.toContain('future_thing')
  })

  it('拒絕反向時間範圍且不送出查詢', async () => {
    const fetcher = mockFetch()
    render(<AuditLogPage />)
    await screen.findByText('建立分區', { selector: 'h2' })
    const before = fetcher.mock.calls.length
    fireEvent.change(screen.getByLabelText('起始時間（含）'), {
      target: { value: '2026-10-11T08:00' },
    })
    const toInput = screen.getByLabelText('結束時間（不含）')
    fireEvent.change(toInput, {
      target: { value: '2026-10-10T08:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: '查詢' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      '起始時間不得晚於結束時間。',
    )
    expect(toInput).toHaveFocus()
    expect(toInput).toHaveAttribute('aria-invalid', 'true')
    expect(toInput).toHaveAttribute('aria-describedby', 'audit-to-error')
    expect(fetcher.mock.calls).toHaveLength(before)
    expect(
      screen.getByText('建立分區', { selector: 'h2' }),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('起始時間（含）'), {
      target: { value: '2026-10-09T08:00' },
    })
    expect(toInput).toHaveAttribute('aria-invalid', 'false')
    expect(toInput).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByText('起始時間不得晚於結束時間。')).toBeNull()
    expect(fetcher.mock.calls).toHaveLength(before)
  })

  it('頁面標題是「操作紀錄」，不再叫稽核紀錄', async () => {
    mockFetch()
    render(<AuditLogPage />)
    expect(
      await screen.findByRole('heading', { level: 1, name: '操作紀錄' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: '稽核紀錄' }),
    ).not.toBeInTheDocument()
  })

  it('事件類型是白話下拉，含「全部」，送出時仍傳事件碼', async () => {
    const fetcher = mockFetch()
    render(<AuditLogPage />)
    await screen.findByText('建立分區', { selector: 'h2' })
    const select = screen.getByRole('combobox', { name: '事件類型' })
    expect(select).toHaveValue('')
    const options = within(select).getAllByRole('option')
    expect(options[0]).toHaveTextContent('全部')
    expect(
      within(select).getByRole('option', { name: '建立分區' }),
    ).toHaveValue('project_zone.created')
    expect(
      within(select).getByRole('option', { name: '停用或啟用帳號' }),
    ).toHaveValue('user.active_changed')
    // 選項文字不得露出事件碼。
    options.forEach((option) =>
      expect(option.textContent).not.toMatch(/[a-z_]+\.[a-z_]+/),
    )
    expect(screen.queryByPlaceholderText(/project_zone/)).toBeNull()

    fireEvent.change(select, { target: { value: 'project_zone.updated' } })
    fireEvent.click(screen.getByRole('button', { name: '查詢' }))
    await waitFor(() => {
      const auditRequests = fetcher.mock.calls.filter(([input]) =>
        String(input).includes('/audit-logs?'),
      )
      const params = new URL(
        String(auditRequests.at(-1)?.[0]),
        'http://localhost',
      ).searchParams
      expect(params.get('event_type')).toBe('project_zone.updated')
    })

    fireEvent.change(select, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '查詢' }))
    await waitFor(() => {
      const auditRequests = fetcher.mock.calls.filter(([input]) =>
        String(input).includes('/audit-logs?'),
      )
      const params = new URL(
        String(auditRequests.at(-1)?.[0]),
        'http://localhost',
      ).searchParams
      expect(params.has('event_type')).toBe(false)
    })
  })

  it('在第二頁更改篩選後重新查第一頁', async () => {
    const fetcher = mockFetch()
    render(<AuditLogPage />)
    await screen.findByText('建立分區', { selector: 'h2' })
    fireEvent.click(screen.getByRole('button', { name: '下一頁' }))
    await screen.findByText('第 2 頁')
    fireEvent.change(screen.getByLabelText('事件類型'), {
      target: { value: 'project_zone.updated' },
    })
    fireEvent.click(screen.getByRole('button', { name: '查詢' }))

    await waitFor(() => {
      expect(screen.getByText('第 1 頁')).toBeInTheDocument()
      const auditRequests = fetcher.mock.calls.filter(([input]) =>
        String(input).includes('/audit-logs?'),
      )
      const params = new URL(
        String(auditRequests.at(-1)?.[0]),
        'http://localhost',
      ).searchParams
      expect(params.get('event_type')).toBe('project_zone.updated')
      expect(params.has('cursor')).toBe(false)
    })
  })

  it.each([
    [422, '操作失敗，請稍後再試。'],
    [500, '伺服器暫時無法處理，請稍後再試。'],
  ])('顯示查詢 API %i 錯誤並結束載入', async (status, message) => {
    mockFetch(() =>
      Response.json({ error: { code: 'request.invalid' } }, { status }),
    )
    render(<AuditLogPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByText('載入稽核紀錄中…')).toBeNull()
    expect(screen.queryByText('建立分區', { selector: 'h2' })).toBeNull()
  })

  it('顯示空結果狀態', async () => {
    mockFetch(() => Response.json(auditLogPageFixture({ items: [] })))
    render(<AuditLogPage />)

    expect(
      await screen.findByText('沒有符合條件的稽核紀錄。'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一頁' })).toBeDisabled()
  })
})

it('T13：範本快照先顯示白話欄位，識別碼只在進階原文', async () => {
  const systemId = '00000000-0000-0000-0000-000000000735'
  const before = { system_id: systemId, title: '排水管坡度檢查', sequence: 1 }
  const after = {
    system_id: systemId,
    title: '排水管坡度檢查（業主版）',
    sequence: 1,
    instruction: '確認排水方向。',
    inspection_points: {
      items: [
        {
          sequence: 1,
          title: '量測坡度',
          instruction: '以水平儀測量。',
          measurement_fields: [
            {
              name: '坡度',
              field_type: 'number',
              unit: '%',
              sort_order: 1,
            },
          ],
          numeric_standard: { value: '2', condition: '>=', unit: '%' },
        },
      ],
    },
  }
  mockFetch(() =>
    Response.json(
      auditLogPageFixture({
        items: [
          auditLogEntryFixture({
            event_type: 'template_item.updated',
            entity_type: 'template_item',
            before,
            after,
          }),
        ],
      }),
    ),
  )
  render(<AuditLogPage />)
  const heading = await screen.findByRole('heading', { name: '修改範本項目' })
  const card = heading.closest('article') as HTMLElement
  expect(
    within(card).getByText('範本項目：排水管坡度檢查（業主版）'),
  ).toBeVisible()
  fireEvent.click(within(card).getByText('查看改前與改後內容'))
  const column = within(card).getByRole('heading', { name: '改後' })
    .parentElement as HTMLElement
  expect(within(column).getByText('排水管坡度檢查（業主版）')).toBeVisible()
  expect(within(column).getByText('數值標準')).toBeVisible()
  expect(within(column).getByText('大於或等於')).toBeVisible()
  expect(within(column).getByText('數字')).toBeVisible()
  expect(column.textContent).not.toMatch(/system_id|field_type|title/)
  expect(column.textContent).not.toContain(systemId)
  const advanced = within(card)
    .getByText('進階：原始紀錄與識別碼')
    .closest('details') as HTMLDetailsElement
  expect(advanced).not.toHaveAttribute('open')
  fireEvent.click(within(advanced).getByText('進階：原始紀錄與識別碼'))
  const originals = advanced.querySelectorAll('pre')
  expect(originals[0]).toHaveTextContent(systemId)
  expect(originals[1].textContent).toBe(JSON.stringify(after, null, 2))
  expect(originals[1]).toBeVisible()
})
