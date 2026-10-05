import { describe, expect, it } from 'vitest'

import { NO_PERMISSION_TEXT, describeRole } from './roleDescriptions'

describe('describeRole', () => {
  it('turns permission codes into one plain sentence', () => {
    expect(describeRole(['inspection_task.inspect'])).toBe('可到現場查核')
    expect(
      describeRole([
        'inspection_plan.create',
        'inspection_task.create',
        'inspection_task.dispatch',
        'inspection_task.assign',
      ]),
    ).toBe('可建立與修改計畫、建立與修改任務、指派人員、派出任務')
  })

  it('shows only the stronger phrase of a read/manage pair', () => {
    expect(describeRole(['project_zone.read', 'project_zone.manage'])).toBe(
      '可管理分區',
    )
    expect(describeRole(['project_zone.read'])).toBe('可查看分區')
  })

  it('never exposes a permission code', () => {
    expect(describeRole(['future.unknown_code'])).toBe('可使用部分功能')
    expect(describeRole(['future.unknown_code'])).not.toMatch(/future/)
    expect(describeRole([])).toBe(NO_PERMISSION_TEXT)
  })
})
