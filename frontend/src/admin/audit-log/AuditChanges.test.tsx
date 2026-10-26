import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'

import { AuditChanges } from './AuditSnapshot'

const lookup = {
  userName: (id: string) => (id === 'known-user' ? '林承安' : null),
  projectName: (id: string) => (id === 'known-project' ? '辦公大樓' : null),
}

it('只列真的變更欄位，查核項次以數量呈現', () => {
  render(
    <AuditChanges
      lookup={lookup}
      before={{
        title: '坡度',
        sequence: 1,
        inspection_points: { items: [{}, {}] },
      }}
      after={{
        title: '排水坡度',
        sequence: 1,
        inspection_points: { items: [{}, {}, {}] },
      }}
    />,
  )
  const area = screen.getByRole('region', { name: '改了什麼' })
  const row = within(area).getByRole('row', { name: /名稱/ })
  expect(
    within(row)
      .getAllByRole('cell')
      .map((cell) => cell.textContent),
  ).toEqual(['坡度', '排水坡度'])
  const points = within(area).getByRole('row', { name: /查核項次/ })
  expect(points).toHaveTextContent('2 項')
  expect(points).toHaveTextContent('3 項')
  expect(within(area).queryByRole('row', { name: /順序/ })).toBeNull()
})

it('已知帳號與專案換名稱，未知識別碼整欄隱藏', () => {
  const unknown = '00000000-0000-0000-0000-000000000735'
  render(
    <AuditChanges
      lookup={lookup}
      before={{ user_id: 'known-user', project_id: 'known-project' }}
      after={{ user_id: unknown, project_id: unknown, company_id: unknown }}
    />,
  )
  const table = screen.getByRole('table')
  expect(table).toHaveTextContent('林承安')
  expect(table).toHaveTextContent('辦公大樓')
  expect(table.textContent).not.toContain(unknown)
  expect(within(table).queryByRole('row', { name: /公司/ })).toBeNull()
})

it.each([
  [null, { title: '新增範本', sequence: 2 }, '新增內容'],
  [{ title: '刪除範本', sequence: 3 }, null, '刪除前內容'],
])('新增或刪除使用內容摘要，而非空白對照表 %s', (before, after, title) => {
  render(<AuditChanges lookup={lookup} before={before} after={after} />)
  expect(screen.getByRole('heading', { name: String(title) })).toBeVisible()
  expect(screen.queryByRole('table')).toBeNull()
})

it('物件鍵順序不算變更，未知欄位與 UUID 不出現在白話區', () => {
  const id = '00000000-0000-0000-0000-000000000735'
  render(
    <AuditChanges
      lookup={lookup}
      before={{ title: '相同', unknown: { a: 1, b: 2 } }}
      after={{ unknown: { b: 2, a: 1 }, title: '相同', system_id: id }}
    />,
  )
  const area = screen.getByRole('region', { name: '改了什麼' })
  expect(area).toHaveTextContent('這次沒有可顯示的欄位變更')
  expect(area.textContent).not.toContain(id)
})

it('角色識別轉成專案角色名稱，遺失的角色不露 UUID', () => {
  render(
    <AuditChanges
      lookup={{
        ...lookup,
        roleName: (id) => (id === 'field' ? '現場工程師' : null),
      }}
      before={{ role_ids: ['field'] }}
      after={{ role_ids: ['field', 'deleted'] }}
    />,
  )
  expect(screen.getByRole('row', { name: /專案角色/ })).toHaveTextContent(
    '現場工程師、已刪除的角色',
  )
})

it('重設臨時密碼只說明事件，不顯示敏感內容', () => {
  render(
    <AuditChanges
      lookup={lookup}
      eventType="user.password_set"
      before={null}
      after={{}}
    />,
  )
  expect(screen.getByText('已重設臨時密碼（不記錄密碼內容）')).toBeVisible()
  expect(screen.queryByText('這次沒有可顯示的欄位變更。')).toBeNull()
})

it('本人更改非臨時密碼時使用符合事件語意的說明', () => {
  render(
    <AuditChanges
      lookup={lookup}
      eventType="user.password_set"
      before={{ is_temporary: true }}
      after={{ is_temporary: false }}
    />,
  )
  expect(screen.getByText('已變更密碼（不記錄密碼內容）')).toBeVisible()
})
