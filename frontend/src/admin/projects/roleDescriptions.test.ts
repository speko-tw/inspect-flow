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
    ).toBe('可建立計畫、建立任務、指派任務給查核員、派出任務')
  })

  it('words each code only as far as the backend operation goes', () => {
    expect(describeRole(['inspection_plan.create'])).toBe('可建立計畫')
    expect(describeRole(['inspection_plan.manage'])).toBe('可修改計畫名稱')
    expect(describeRole(['inspection_task.create'])).toBe('可建立任務')
    expect(describeRole(['inspection_task.manage'])).toBe('可修改任務位置')
    expect(describeRole(['inspection_plan.archive'])).toBe('可封存計畫')
    expect(describeRole(['inspection_plan.unarchive'])).toBe('可取消封存計畫')
    expect(describeRole(['inspection_task.delete_draft'])).toBe(
      '可刪除草稿任務',
    )
    expect(describeRole(['inspection_task.cancel'])).toBe('可取消或恢復任務')
  })

  it('judges read and manage codes separately', () => {
    expect(describeRole(['project_zone.read', 'project_zone.manage'])).toBe(
      '可查看分區、新增、修改與刪除分區',
    )
    expect(describeRole(['project_zone.read'])).toBe('可查看分區')
  })

  it('never exposes a permission code', () => {
    expect(describeRole(['future.unknown_code'])).toBe('可使用部分功能')
    expect(describeRole(['future.unknown_code'])).not.toMatch(/future/)
    expect(describeRole([])).toBe(NO_PERMISSION_TEXT)
  })
})
