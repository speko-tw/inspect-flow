import { describe, expect, it } from 'vitest'

import {
  completenessErrors,
  backendDifferences,
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

  it('照片需求完整往返，修改張數也不丟失其他設定', () => {
    const content = makeContent()
    content.inspection_points[0].evidence_requirements = [
      {
        evidence_type: 'photo',
        required: false,
        min_count: 1,
        max_count: 8,
      },
    ]
    content.inspection_points[1].evidence_requirements = [
      {
        evidence_type: 'photo',
        required: true,
        min_count: 2,
        max_count: null,
      },
    ]
    const item = toEditorItem(content)
    const back = fromEditorItem(item, photoDraftOf(item))
    expect(back).toEqual(content)
    expect(
      fromEditorItem(item, { '0': '3', '1': '2' }).inspection_points[0]
        .evidence_requirements,
    ).toEqual([
      {
        evidence_type: 'photo',
        required: false,
        min_count: 3,
        max_count: 8,
      },
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

describe('TPL-AC36 後端差異呈現', () => {
  it('只改序號、不搬陣列也呈現後端回報的重排', () => {
    const before = makeContent()
    const after = makeContent()
    after.inspection_points[0].sequence = 2
    after.inspection_points[1].sequence = 1
    const differences = backendDifferences({
      from: { content: before },
      to: { content: after },
      changes: before.inspection_points.map((point, index) => ({
        kind: 'modified',
        entity: 'inspection_point',
        logical_id: point.logical_id,
        parent_logical_id: null,
        before: point,
        after: after.inspection_points[index],
      })),
    })
    expect(differences).toEqual([
      expect.objectContaining({
        kind: 'reordered',
        pointId: IDS.spacing,
        before: '1',
        after: '2',
      }),
      expect.objectContaining({
        kind: 'reordered',
        pointId: IDS.coupler,
        before: '2',
        after: '1',
      }),
    ])
    expect(
      toEditorItem(after).inspection_points.map((p) => p.clientKey),
    ).toEqual([IDS.coupler, IDS.spacing])
  })

  it('後端未回報的差異不由前端自行補判', () => {
    expect(
      backendDifferences({
        from: { content: makeContent() },
        to: { content: makeContent({ title: '不同名稱' }) },
        changes: [],
      }),
    ).toEqual([])
  })

  it('欄位重排採後端識別順序，新增移除保留項次跳轉', () => {
    const content = makeContent()
    const point = content.inspection_points[0]
    const field = point.measurement_fields[0]
    const other = point.measurement_fields[1]
    const changes = backendDifferences({
      from: { content },
      to: { content },
      changes: [
        {
          kind: 'reordered',
          entity: 'measurement_field',
          logical_id: null,
          parent_logical_id: point.logical_id,
          before: [field.logical_id, other.logical_id],
          after: [other.logical_id, field.logical_id],
        },
        {
          kind: 'removed',
          entity: 'inspection_point',
          logical_id: point.logical_id,
          parent_logical_id: null,
          before: point,
          after: null,
        },
      ],
    })
    expect(changes[0]).toMatchObject({
      kind: 'reordered',
      before: '間距／備註',
      after: '備註／間距',
      pointId: IDS.spacing,
    })
    expect(changes[1]).toMatchObject({
      kind: 'removed',
      pointId: IDS.spacing,
    })
  })

  it('標準文字帶出綁定欄位的單位', () => {
    expect(standardText(makeContent().inspection_points[0])).toBe('≤ 200 mm')
  })
})
