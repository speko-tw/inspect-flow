import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { IDS, makeContent } from './fixtures'
import { SuggestionContentView } from './SuggestionContentView'

afterEach(cleanup)

describe('TPL-AC36 完整內容依實際序號呈現', () => {
  it.each([
    [2, 1],
    [20, 5],
  ])('只改 sequence %i／%i，不改陣列位置', (first, second) => {
    const content = makeContent()
    content.inspection_points[0].sequence = first
    content.inspection_points[1].sequence = second
    render(<SuggestionContentView content={content} idPrefix="readonly" />)
    expect(
      screen.getAllByRole('heading', { level: 5 }).map((h) => h.textContent),
    ).toEqual([`項次 ${second}：續接器檢查`, `項次 ${first}：鋼筋間距`])
    expect(document.querySelectorAll('section')[0].id).toBe(
      `readonly-point-${IDS.coupler}`,
    )
    expect(content.inspection_points.map((p) => p.logical_id)).toEqual([
      IDS.spacing,
      IDS.coupler,
    ])
  })
})
