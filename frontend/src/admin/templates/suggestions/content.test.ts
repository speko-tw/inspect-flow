import { describe, expect, it } from 'vitest'

import {
  completenessErrors,
  computeDifferences,
  fromEditorItem,
  photoDraftOf,
  sameContent,
  standardText,
  toEditorItem,
} from './content'
import { IDS, makeContent } from './fixtures'

describe('建議快照與編輯器模型互轉（TPL-R30）', () => {
  it('來回轉換保留穩定邏輯識別與綁定欄位', () => {
    const content = makeContent()
    const item = toEditorItem(content)
    expect(item.inspection_points.map((p) => p.clientKey)).toEqual([
      IDS.spacing,
      IDS.coupler,
    ])
    const back = fromEditorItem(item, photoDraftOf(item))
    expect(back.inspection_points[0].logical_id).toBe(IDS.spacing)
    expect(
      back.inspection_points[0].numeric_standard?.measurement_field_logical_id,
    ).toBe(IDS.spacingField)
    // 被數值標準綁定的欄位單位一律存 null，單位由標準帶入（TPL-R17）。
    expect(back.inspection_points[0].measurement_fields[0].unit).toBeNull()
    expect(back.inspection_points[1].evidence_requirements).toEqual([
      { min_count: 2 },
    ])
  })

  it('不帶來源資料庫主鍵、結果或照片', () => {
    const text = JSON.stringify(
      fromEditorItem(toEditorItem(makeContent()), { '0': '1', '1': '2' }),
    )
    expect(text).not.toMatch(/"id"|project_id|task|photo_url/)
  })

  it('內容相同時視為沒有變更，改一個字就是新版', () => {
    const content = makeContent()
    expect(sameContent(content, structuredClone(content))).toBe(true)
    expect(
      sameContent(content, makeContent({ title: '鋼筋綁紮與間距' })),
    ).toBe(false)
  })

  it('照片張數無法解析時存 0，留給重送前的完整檢查擋下', () => {
    const item = toEditorItem(makeContent())
    const content = fromEditorItem(item, { '0': '', '1': 'x' })
    expect(
      content.inspection_points[0].evidence_requirements[0].min_count,
    ).toBe(0)
    expect(
      content.inspection_points[1].evidence_requirements[0].min_count,
    ).toBe(0)
  })
})

describe('TPL-R32 重送前的完整性檢查', () => {
  it('合法內容沒有錯誤', () => {
    expect(completenessErrors(makeContent())).toEqual({})
  })

  it('名稱留白、照片張數不足與欄位未填都以穩定識別回報', () => {
    const content = makeContent({ title: ' ' })
    content.inspection_points[0].title = ''
    content.inspection_points[1].evidence_requirements = [{ min_count: 0 }]
    const errors = completenessErrors(content)
    expect(errors.title).toBe('請填寫查核項目名稱')
    expect(errors[`point:${IDS.spacing}:title`]).toBe('請填寫項次標題')
    expect(errors[`point:${IDS.coupler}:photos`]).toBe('照片至少需要 1 張')
  })
})

describe('TPL-AC36 相鄰兩版差異', () => {
  it('標準與標題的修改以項次為單位列出', () => {
    const before = makeContent()
    const after = makeContent({ title: '鋼筋綁紮與間距檢查' })
    after.inspection_points[0].numeric_standard!.value = '180'
    after.inspection_points[1].evidence_requirements = [{ min_count: 3 }]
    const kinds = computeDifferences(before, after).map(
      (d) => `${d.kind}:${d.label}`,
    )
    expect(kinds).toEqual([
      'modified:查核項目名稱',
      'modified:鋼筋間距／標準',
      'modified:續接器檢查／照片張數',
    ])
  })

  it('新增、刪除與重排項次，並帶可跳轉的項次識別', () => {
    const before = makeContent()
    const after = makeContent()
    after.inspection_points = [
      after.inspection_points[1],
      {
        ...structuredClone(before.inspection_points[0]),
        logical_id: 'new-point',
        title: '保護層厚度',
        measurement_fields: [],
        numeric_standard: null,
      },
    ]
    const differences = computeDifferences(before, after)
    expect(differences.map((d) => d.kind)).toEqual(['removed', 'added'])
    expect(differences[0].pointId).toBe(IDS.spacing)
    expect(differences[1].pointId).toBe('new-point')

    const swapped = makeContent()
    swapped.inspection_points.reverse()
    expect(computeDifferences(before, swapped)).toEqual([
      expect.objectContaining({ kind: 'reordered', label: '查核項次' }),
    ])
  })

  it('實測欄位的新增、刪除、修改、重排與綁定變更', () => {
    const before = makeContent()
    const after = makeContent()
    const point = after.inspection_points[0]
    point.measurement_fields = [
      { ...point.measurement_fields[1], sort_order: 0 },
      { ...point.measurement_fields[0], name: '鋼筋間距', sort_order: 1 },
      {
        logical_id: 'field-new',
        name: '覆核間距',
        field_type: 'number',
        unit: 'mm',
        sort_order: 2,
      },
    ]
    point.numeric_standard!.measurement_field_logical_id = 'field-new'
    const labels = computeDifferences(before, after).map(
      (d) => `${d.kind}:${d.label}`,
    )
    expect(labels).toEqual(
      expect.arrayContaining([
        'modified:鋼筋間距／綁定欄位',
        'reordered:鋼筋間距／實測欄位',
        'added:鋼筋間距／欄位',
        'modified:鋼筋間距／欄位',
      ]),
    )
  })

  it('兩版相同時沒有差異', () => {
    expect(computeDifferences(makeContent(), makeContent())).toEqual([])
  })

  it('標準文字帶出綁定欄位的單位', () => {
    expect(standardText(makeContent().inspection_points[0])).toBe('≤ 200 mm')
  })
})
