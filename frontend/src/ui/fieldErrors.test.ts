import { describe, expect, it } from 'vitest'

import { fieldErrorMessage, mapFieldErrors } from './fieldErrors'

describe('mapFieldErrors', () => {
  it('maps errors in binding order and leaves unknown pointers unmatched', () => {
    const result = mapFieldErrors(
      [
        { path: '/items/2/title', code: 'field.required' },
        { path: '/items/2/inspection_points/1/title', code: 'field.invalid' },
        { path: '/items/2/private/key', code: 'field.invalid' },
      ],
      [
        { path: '/items/2/inspection_points/1/title', key: 'point:1:title' },
        { path: '/items/2/title', key: 'title' },
      ],
    )

    expect(result.errors).toEqual({
      'point:1:title': 'field.invalid',
      title: 'field.required',
    })
    expect(result.unmatched).toEqual([
      { path: '/items/2/private/key', code: 'field.invalid' },
    ])
  })

  it('uses screen binding order when the API returns errors in reverse order', () => {
    const result = mapFieldErrors(
      [
        { path: '/inspection_points/1/title', code: 'field.required' },
        { path: '/title', code: 'field.too_long' },
      ],
      [
        { path: '/title', key: 'title' },
        { path: '/inspection_points/1/title', key: 'point:1:title' },
      ],
    )

    expect(Object.keys(result.errors)).toEqual(['title', 'point:1:title'])
  })

  it('keeps the first API error when multiple paths share one field', () => {
    const result = mapFieldErrors(
      [
        {
          path: '/inspection_points/0/sequence',
          code: 'template.sequence_duplicate',
        },
        { path: '/inspection_points/0/title', code: 'field.required' },
      ],
      [
        { path: '/inspection_points/0/title', key: 'point:0:title' },
        { path: '/inspection_points/0/sequence', key: 'point:0:title' },
      ],
    )

    expect(result.errors).toEqual({
      'point:0:title': 'template.sequence_duplicate',
    })
    expect(result.unmatched).toEqual([])
  })

  it('supports an empty root pointer and rejects unsafe pointer escapes', () => {
    const result = mapFieldErrors(
      [
        { path: '', code: 'field.invalid' },
        { path: '/name~1unit', code: 'field.invalid' },
        { path: '/name~2unit', code: 'field.invalid' },
      ],
      [
        { path: '', key: 'form' },
        { path: '/name~1unit', key: 'unit' },
      ],
    )

    expect(result.errors).toEqual({
      form: 'field.invalid',
      unit: 'field.invalid',
    })
    expect(result.unmatched).toEqual([
      { path: '/name~2unit', code: 'field.invalid' },
    ])
  })
})

describe('fieldErrorMessage', () => {
  it('translates common field codes and falls back without echoing', () => {
    expect(fieldErrorMessage('field.too_long')).toBe('輸入內容太長。')
    expect(fieldErrorMessage('field.required')).toBe('請填寫此欄位。')
    expect(fieldErrorMessage('page.unknown_code')).toBe(
      '欄位內容不符合規則，請檢查後再試。',
    )
  })

  it('lets page-specific codes extend and override the common table', () => {
    const extra = {
      'template.sequence_duplicate': '項次順序重複。',
      'field.too_long': '專屬訊息。',
    }
    expect(fieldErrorMessage('template.sequence_duplicate', extra)).toBe(
      '項次順序重複。',
    )
    expect(fieldErrorMessage('field.too_long', extra)).toBe('專屬訊息。')
    expect(fieldErrorMessage('field.invalid', extra)).toBe(
      '欄位格式不正確，請檢查輸入內容。',
    )
  })
})
