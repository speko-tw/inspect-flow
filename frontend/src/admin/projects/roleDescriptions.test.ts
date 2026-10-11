import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  NO_PERMISSION_TEXT,
  ROLE_SUMMARY_PHRASE_CODES,
  UNKNOWN_PERMISSION_TEXT,
  describeRole,
  rolePermissionDetails,
  summarizeRole,
} from './roleDescriptions'

describe('describeRole', () => {
  it('turns permission codes into one plain sentence', () => {
    expect(describeRole(['inspection_task.inspect'])).toBe('可執行現場查核')
    expect(
      describeRole([
        'inspection_plan.create',
        'inspection_task.create',
        'inspection_task.dispatch',
        'inspection_task.assign',
      ]),
    ).toBe('可建立查核計畫、建立查核任務、派出查核任務、指派查核任務')
  })

  it('uses catalog descriptions in both summaries and details', () => {
    const descriptions = new Map([
      ['inspection_plan.manage', '後端查核計畫管理說明'],
    ])
    expect(
      rolePermissionDetails(['inspection_plan.manage'], descriptions),
    ).toEqual([
      { code: 'inspection_plan.manage', label: '後端查核計畫管理說明' },
    ])
    expect(summarizeRole(['inspection_plan.manage'], descriptions)).toBe(
      '可後端查核計畫管理說明',
    )
  })

  it('uses the documented fallback for unknown codes', () => {
    expect(describeRole(['future.unknown_code'])).toBe(UNKNOWN_PERMISSION_TEXT)
    expect(rolePermissionDetails(['future.unknown_code'])[0]?.label).toBe(
      UNKNOWN_PERMISSION_TEXT,
    )
  })

  it('formats mixed known and unknown codes without repeating 可', () => {
    expect(
      describeRole(['inspection_task.inspect', 'future.unknown_code']),
    ).toBe('可執行現場查核、可使用部分功能')
    expect(
      summarizeRole(['inspection_task.inspect', 'future.unknown_code']),
    ).toBe('可執行現場查核、可使用部分功能')
    expect(
      summarizeRole(['future.unknown_code', 'inspection_task.inspect']),
    ).toBe('可使用部分功能、可執行現場查核')
  })

  it('collapses multiple unknown codes to the documented fallback', () => {
    const unknownCodes = ['future.first_code', 'future.second_code']
    expect(describeRole(unknownCodes)).toBe(UNKNOWN_PERMISSION_TEXT)
    expect(summarizeRole(unknownCodes)).toBe(UNKNOWN_PERMISSION_TEXT)
  })

  it('maps project permission descriptions and excludes module codes', () => {
    const registry = readFileSync(
      resolve(process.cwd(), '../backend/app/permission_codes.py'),
      'utf8',
    )
    const enumSource = registry
      .split('class PermissionCode', 2)[1]
      ?.split('# Always', 1)[0]
    expect(enumSource).toBeDefined()
    const backendDescriptions = Object.fromEntries(
      [
        ...(enumSource ?? '').matchAll(
          /^\s+[A-Z][A-Z0-9_]*\s*=\s*\(\s*"([a-z_]+\.[a-z_]+)"\s*,\s*"([^"]+)"\s*,?\s*\)/gms,
        ),
      ].map(([, code, description]) => [code, description]),
    )
    expect(Object.keys(backendDescriptions)).toHaveLength(26)

    const projectSection = registry
      .split('_PROJECT_CODES = {', 2)[1]
      ?.split('}\n_MODULE_CODE_MODULES', 1)[0]
    expect(projectSection).toBeDefined()
    const projectCodes = new Set(
      [
        ...(projectSection ?? '').matchAll(/^\s*"([a-z_]+\.[a-z_]+)"\s*:/gm),
      ].map(([, code]) => code),
    )
    expect(projectCodes.size).toBe(20)
    expect(ROLE_SUMMARY_PHRASE_CODES).toEqual(projectCodes)

    const projectDescriptions = Object.fromEntries(
      Object.entries(backendDescriptions).filter(([code]) =>
        projectCodes.has(code),
      ),
    )
    expect(
      Object.fromEntries(
        rolePermissionDetails(Object.keys(backendDescriptions))
          .filter(({ code }) => projectCodes.has(code))
          .map(({ code, label }) => [code, label]),
      ),
    ).toEqual(projectDescriptions)

    const moduleSection = registry
      .split('_MODULE_CODE_MODULES = {', 2)[1]
      ?.split('}\n_EXTERNAL_ALLOWED_CODES', 1)[0]
    expect(moduleSection).toBeDefined()
    const moduleCodes = [
      ...(moduleSection ?? '').matchAll(/^\s*"([a-z_]+\.[a-z_]+)"\s*:/gm),
    ].map(([, code]) => code)
    expect(moduleCodes).toHaveLength(6)
    expect(moduleCodes.some((code) => projectCodes.has(code))).toBe(false)
    expect(
      rolePermissionDetails(moduleCodes).every(
        ({ label }) => label === UNKNOWN_PERMISSION_TEXT,
      ),
    ).toBe(true)
  })
})

describe('summarizeRole', () => {
  it('keeps at most three phrases and counts actual permission items', () => {
    const codes = [
      'project_member.manage',
      'project_inspection_item.edit',
      'inspection_plan.create',
      'inspection_task.create',
      'inspection_task.dispatch',
    ]
    const details = rolePermissionDetails(codes)

    expect(summarizeRole(codes)).toBe(
      '可管理專案成員與其角色、編輯專案查核項目、規劃與派出任務等共 5 項',
    )
    expect(details).toHaveLength(5)
    expect(summarizeRole([...codes, 'inspection_task.assign'])).toBe(
      '可管理專案成員與其角色、編輯專案查核項目、規劃與派出任務等共 6 項',
    )
  })

  it('keeps short and empty roles understandable', () => {
    expect(summarizeRole(['inspection_task.inspect'])).toBe('可執行現場查核')
    expect(summarizeRole(['project_member.manage'])).toBe(
      '可管理專案成員與其角色',
    )
    expect(summarizeRole(['project_inspection_item.edit'])).toBe(
      '可編輯專案查核項目',
    )
    expect(summarizeRole([])).toBe(NO_PERMISSION_TEXT)
  })
})
