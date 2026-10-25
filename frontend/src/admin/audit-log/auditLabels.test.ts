import { describe, expect, it } from 'vitest'

import { auditLogEntryFixture } from '../../testing/contractFixtures'
import { entityLabel, eventLabel, UNKNOWN_EVENT_LABEL } from './auditLabels'

const noLookup = { userName: () => null, projectName: () => null }

describe('稽核事件白話對照', () => {
  it.each([
    ['user.active_changed', { is_active: false }, '停用帳號'],
    ['user.active_changed', { is_active: true }, '啟用帳號'],
    ['module_permission.granted', null, '開通權限'],
    ['module_permission.revoked', null, '收回權限'],
    ['module_delegation.granted', null, '委派權限管理'],
    ['permission_bundle.applied', null, '套用權限組合'],
    ['project_member.roles_changed', null, '調整成員角色'],
    ['user.locked', null, '登入失敗過多，帳號被鎖定'],
    ['template_category.created', null, '建立範本工程類別'],
    ['template_system.updated', null, '修改範本系統'],
    ['template_item.deleted', null, '刪除範本項目'],
    ['project.template_applied', null, '套用範本'],
    ['project_inspection_item.deleted', null, '刪除查核項目'],
    ['project_inspection_item.deactivated', null, '停用查核項目'],
    ['project_inspection_item.reactivated', null, '恢復查核項目'],
    ['user.created', null, '建立帳號'],
    ['user.email_changed', null, '修改帳號電子郵件'],
    ['user.account_expiry_changed', null, '修改帳號到期日'],
  ])('把 %s 顯示成「%s」', (eventType, after, label) => {
    expect(
      eventLabel(auditLogEntryFixture({ event_type: eventType, after })),
    ).toBe(label)
  })

  it('停用與啟用的資料不全時仍給白話，不露出事件碼', () => {
    const label = eventLabel(
      auditLogEntryFixture({ event_type: 'user.active_changed', after: null }),
    )
    expect(label).toBe('停用或啟用帳號')
  })

  it('查不到對照的事件顯示「其他操作」', () => {
    expect(eventLabel(auditLogEntryFixture({ event_type: 'x.unknown' }))).toBe(
      UNKNOWN_EVENT_LABEL,
    )
  })

  it('對象沒有名稱時只顯示類型，不顯示編號', () => {
    const label = entityLabel(
      auditLogEntryFixture({
        entity_type: 'project_member',
        after: { project_id: 'p', role_ids: [] },
      }),
      noLookup,
    )
    expect(label).toBe('成員')
  })

  // 後端事件目錄（audit.py 與 inspection_planning.py）登記的全部事件碼；
  // 後端新增事件時，這份清單與對照表要一起補。
  it.each([
    'creator_role.changed',
    'inspection_task.cancelled',
    'inspection_task.deleted',
    'inspection_task.items_updated',
    'inspection_task.location_updated',
    'inspection_task.renamed',
    'inspection_task.restored',
    'module_delegation.granted',
    'module_delegation.revoked',
    'module_permission.grant_denied',
    'module_permission.granted',
    'module_permission.revoked',
    'permission_bundle.applied',
    'permission_bundle.created',
    'permission_bundle.deleted',
    'permission_bundle.updated',
    'project.created',
    'project.updated',
    'project_inspection_item.updated',
    'project_inspection_item.deleted',
    'project_member.assignment_denied',
    'project_member.removed',
    'project_member.roles_changed',
    'project_zone.created',
    'project_zone.deleted',
    'project_zone.updated',
    'project.template_applied',
    'role.created',
    'role.deleted',
    'role.updated',
    'template_item.created_from_project',
    'template_category.created',
    'template_category.deleted',
    'template_category.updated',
    'template_item.created',
    'template_item.deleted',
    'template_item.updated',
    'template_system.created',
    'template_system.deleted',
    'template_system.updated',
    'user.active_changed',
    'user.admin_changed',
    'user.company_changed',
    'user.external_flag_changed',
    'user.email_changed',
    'user.account_expiry_changed',
    'user.created',
    'user.locked',
    'user.password_set',
    'user.username_changed',
  ])('後端事件 %s 有白話對照', (code) => {
    const label = eventLabel(auditLogEntryFixture({ event_type: code }))
    expect(label).not.toBe(UNKNOWN_EVENT_LABEL)
    expect(label).not.toMatch(/[a-z_]+\.[a-z_]+/)
  })
})

it.each([
  { before: null, after: { title: '排水管坡度檢查' } },
  { before: { title: '排水管坡度檢查' }, after: null },
  { before: { title: '排水管坡度檢查' }, after: {} },
])('範本對象從既有 title 快照取得名稱', (payload) => {
  expect(
    entityLabel(
      auditLogEntryFixture({
        entity_type: 'template_item',
        ...payload,
      }),
      noLookup,
    ),
  ).toBe('範本項目：排水管坡度檢查')
})
