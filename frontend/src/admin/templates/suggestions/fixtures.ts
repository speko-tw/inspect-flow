import type {
  SuggestionDetail,
  SuggestionEvent,
  SuggestionRevision,
  SuggestionStatus,
  SuggestionSummary,
} from './api'
import type { SuggestionContent } from './content'

// 元件 mock 使用轉換後的畫面模型；HTTP 契約測試使用下方 Response 工廠。
// 人名只使用示範人物，不放真實公司或個人。

export const IDS = {
  suggestion: '0190a000-0000-7000-8000-000000000001',
  project: '0190a000-0000-7000-8000-0000000000a1',
  sourceItem: '0190a000-0000-7000-8000-0000000000b1',
  spacing: '0190a000-0000-7000-8000-0000000000c1',
  spacingField: '0190a000-0000-7000-8000-0000000000c2',
  notesField: '0190a000-0000-7000-8000-0000000000c3',
  coupler: '0190a000-0000-7000-8000-0000000000d1',
  couplerField: '0190a000-0000-7000-8000-0000000000d2',
  linUser: 'user-lin',
  wuUser: 'user-wu',
  chenUser: 'user-chen',
} as const

/** 鋼筋綁紮：一個數值標準項次（綁定間距欄位）與一個文字標準項次。 */
export function makeContent(
  overrides: Partial<SuggestionContent> = {},
): SuggestionContent {
  return {
    title: '鋼筋綁紮',
    instruction: '依核定施工圖檢查，澆置前完成查核。',
    inspection_points: [
      {
        logical_id: IDS.spacing,
        sequence: 1,
        title: '鋼筋間距',
        instruction: '檢查梁柱接頭與箍筋。',
        text_standard: null,
        numeric_standard: {
          value: '200',
          condition: '<=',
          unit: 'mm',
          tolerance: null,
          range_form: null,
          lower_bound: null,
          upper_bound: null,
          measurement_field_logical_id: IDS.spacingField,
        },
        measurement_fields: [
          {
            logical_id: IDS.spacingField,
            name: '間距',
            field_type: 'number',
            unit: null,
            sort_order: 0,
          },
          {
            logical_id: IDS.notesField,
            name: '備註',
            field_type: 'text',
            unit: null,
            sort_order: 1,
          },
        ],
        evidence_requirements: [{ min_count: 1 }],
      },
      {
        logical_id: IDS.coupler,
        sequence: 2,
        title: '續接器檢查',
        instruction: '逐一檢視鎖固與外露螺紋。',
        text_standard: { text: '續接器鎖固完成，外露螺紋符合施工圖規定。' },
        numeric_standard: null,
        measurement_fields: [
          {
            logical_id: IDS.couplerField,
            name: '外觀說明',
            field_type: 'text',
            unit: null,
            sort_order: 0,
          },
        ],
        evidence_requirements: [{ min_count: 2 }],
      },
    ],
    ...overrides,
  }
}

/** 狀態歷程的一筆事件。 */
export function event(
  status: SuggestionStatus,
  actor: { id: string; name: string },
  time: string,
  reason: string | null = null,
): SuggestionEvent {
  return {
    status,
    actor_id: actor.id,
    actor_name: actor.name,
    reason,
    created_at: time,
  }
}

/** 內業提議人。 */
export const LIN = { id: IDS.linUser, name: '林小姐' }
/** 範本管理者（審核人）。 */
export const WU = { id: IDS.wuUser, name: '吳經理' }

/** 一個不可覆寫的修訂；預設由林小姐編輯、尚無審核事件。 */
export function makeRevision(
  no: number,
  overrides: Partial<SuggestionRevision> = {},
): SuggestionRevision {
  return {
    id: `rev-${no}`,
    revision_no: no,
    based_on_revision_id: no > 1 ? `rev-${no - 1}` : null,
    content: makeContent(),
    editor_id: LIN.id,
    editor_name: LIN.name,
    created_at: `2026-10-31T0${no}:00:00Z`,
    events: [],
    ...overrides,
  }
}

/** 清單的一筆摘要；預設為林小姐提出的待審第 1 版。 */
export function makeSummary(
  overrides: Partial<SuggestionSummary> = {},
): SuggestionSummary {
  return {
    id: IDS.suggestion,
    status: 'PENDING',
    proposer_id: LIN.id,
    proposer_name: LIN.name,
    source_project_id: IDS.project,
    source_project_name: 'C-105／示範綜合大樓工程',
    source_item_id: IDS.sourceItem,
    source_item_title: '鋼筋綁紮',
    title: '鋼筋綁紮',
    current_revision_id: 'rev-1',
    revision_no: 1,
    last_editor_id: LIN.id,
    last_editor_name: LIN.name,
    last_submitted_at: '2026-10-31T01:00:00Z',
    latest_return: null,
    approval: null,
    ...overrides,
  }
}

/** 待審的第 1 版；`revisions` 是它的完整修訂清單。 */
export function makeDetail(
  overrides: Partial<SuggestionDetail> = {},
): SuggestionDetail {
  const revision = overrides.current_revision ?? makeRevision(1)
  return {
    ...makeSummary({
      current_revision_id: revision.id,
      revision_no: revision.revision_no,
      title: revision.content.title,
    }),
    current_revision: revision,
    ...overrides,
  }
}

/** 測試用真 HTTP 清單 DTO；元件顯示模型與原始回應必須分開。 */
export function summaryResponse(
  overrides: Partial<import('./wire').SummaryResponse> = {},
): import('./wire').SummaryResponse {
  const summary = makeSummary()
  return {
    id: summary.id,
    status: summary.status,
    proposer_id: LIN.id,
    proposer_name: LIN.name,
    source_project_id: IDS.project,
    source_project_name: summary.source_project_name,
    source_item_id: IDS.sourceItem,
    source_item_title: summary.source_item_title,
    title: summary.title,
    current_revision_id: 'rev-1',
    revision_no: 1,
    content_sha256: 'a'.repeat(64),
    last_editor_id: LIN.id,
    last_editor_name: LIN.name,
    last_submitted_at: summary.last_submitted_at,
    return_reason: null,
    latest_review: null,
    approval: null,
    approved_template_id: null,
    first_submitted_at: summary.last_submitted_at,
    created_at: summary.last_submitted_at,
    updated_at: summary.last_submitted_at,
    ...overrides,
  }
}

/** 真 revisions DTO：reviews 與 transitions 分開，不以 events 偽裝 HTTP。 */
export function revisionResponse(
  no: number,
  overrides: Partial<import('./wire').RevisionResponse> = {},
): import('./wire').RevisionResponse {
  const revision = makeRevision(no)
  return {
    id: revision.id,
    suggestion_id: IDS.suggestion,
    revision_no: no,
    based_on_revision_id: revision.based_on_revision_id,
    content: revision.content,
    content_sha256: 'a'.repeat(64),
    editor_id: LIN.id,
    editor_name: LIN.name,
    created_at: revision.created_at,
    status: 'PENDING',
    reviews: [],
    transitions: [],
    ...overrides,
  }
}

/** 真詳情與寫入回應為平面主件加 content。 */
export function detailResponse(
  overrides: Partial<import('./wire').DetailResponse> = {},
): import('./wire').DetailResponse {
  return { ...summaryResponse(), content: makeContent(), ...overrides }
}

/** 元件保存 mock 沿真寫入回應使用 current_revision_id，而非修訂 id。 */
export function saveResult(revision: SuggestionRevision) {
  return {
    id: IDS.suggestion,
    current_revision_id: revision.id,
    status: 'PENDING' as const,
    revision_no: revision.revision_no,
  }
}

/** 比較元件用的後端差異 fixture，不在產品程式重新計算差異。 */
export function comparisonResponse(
  from: SuggestionRevision,
  to: SuggestionRevision,
) {
  const changes: import('./wire').DifferenceResponse[] = []
  if (
    from.content.title !== to.content.title ||
    from.content.instruction !== to.content.instruction
  ) {
    changes.push({
      kind: 'modified',
      entity: 'item',
      logical_id: null,
      parent_logical_id: null,
      before: {
        title: from.content.title,
        instruction: from.content.instruction,
      },
      after: { title: to.content.title, instruction: to.content.instruction },
    })
  }
  for (const old of from.content.inspection_points) {
    const next = to.content.inspection_points.find(
      (p) => p.logical_id === old.logical_id,
    )
    if (!next)
      changes.push({
        kind: 'removed',
        entity: 'inspection_point',
        logical_id: old.logical_id,
        parent_logical_id: null,
        before: old,
        after: null,
      })
    else if (JSON.stringify(old) !== JSON.stringify(next))
      changes.push({
        kind: 'modified',
        entity: 'inspection_point',
        logical_id: old.logical_id,
        parent_logical_id: null,
        before: old,
        after: next,
      })
  }
  for (const next of to.content.inspection_points) {
    if (
      !from.content.inspection_points.some(
        (p) => p.logical_id === next.logical_id,
      )
    )
      changes.push({
        kind: 'added',
        entity: 'inspection_point',
        logical_id: next.logical_id,
        parent_logical_id: null,
        before: null,
        after: next,
      })
  }
  return { from, to, changes }
}
