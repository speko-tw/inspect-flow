import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'

import type { InspectionPoint } from './api'
import { MeasurementFieldEditor } from './MeasurementFieldEditor'
import { NumericStandardEditor } from './NumericStandardEditor'

const initial: InspectionPoint = {
  sequence: 1,
  title: '試壓',
  instruction: '',
  text_standard: null,
  numeric_standard: {
    tolerance: null,
    condition: '>=',
    value: '1.0',
    unit: 'MPa',
    measurement_field_client_key: 'pressure',
  },
  measurement_fields: [
    {
      clientKey: 'pressure',
      client_id: 'pressure',
      name: '保壓壓力',
      field_type: 'number',
      unit: 'MPa',
    },
  ],
  evidence_requirements: [{ min_count: 1 }],
}

function Editor({ stale = false }: { stale?: boolean }) {
  const [point, setPoint] = useState(initial)
  const [confirm, setConfirm] = useState(stale ? '0:0' : '')
  const updatePoint = (_: number, changes: Partial<InspectionPoint>) =>
    setPoint((current) => ({ ...current, ...changes }))
  return (
    <div>
      <MeasurementFieldEditor
        point={point}
        pointIndex={0}
        errors={{}}
        confirmField={confirm}
        setConfirmField={setConfirm}
        updateField={vi.fn()}
        updatePoint={updatePoint}
      />
      <NumericStandardEditor
        point={point}
        pointIndex={0}
        errors={{}}
        updateNumeric={vi.fn()}
        updatePoint={updatePoint}
      />
    </div>
  )
}

it('綁定欄位不顯示殘留確認，捷徑聚焦判定標準', () => {
  render(<Editor stale />)
  expect(screen.queryByRole('group', { name: '移除欄位確認' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '移除欄位' }))
  fireEvent.click(screen.getByRole('button', { name: '前往判定標準' }))
  expect(screen.getByRole('radio', { name: '數值' })).toHaveFocus()
  expect(screen.getByRole('radio', { name: '數值' })).toBeChecked()
  fireEvent.click(screen.getByRole('radio', { name: '無' }))
  fireEvent.click(screen.getByRole('button', { name: '移除欄位' }))
  expect(screen.getByRole('group', { name: '移除欄位確認' })).toBeVisible()
  expect(screen.queryByText(/這個欄位仍綁定數值標準/)).toBeNull()
})

it('切成無標準後立即清除先前的綁定錯誤', () => {
  render(<Editor />)
  fireEvent.click(screen.getByRole('button', { name: '移除欄位' }))
  expect(screen.getByText(/這個欄位仍綁定數值標準/)).toBeVisible()
  fireEvent.click(screen.getByRole('radio', { name: '無' }))
  expect(screen.queryByText(/這個欄位仍綁定數值標準/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '移除欄位' }))
  expect(screen.getByRole('group', { name: '移除欄位確認' })).toBeVisible()
})

it('解除再綁定不重現舊移除錯誤，主動失敗時聚焦警示', () => {
  render(<Editor />)
  fireEvent.click(screen.getByRole('button', { name: '移除欄位' }))
  expect(screen.getByRole('alert')).toHaveFocus()
  fireEvent.click(screen.getByRole('radio', { name: '無' }))
  fireEvent.click(screen.getByRole('radio', { name: '數值' }))
  expect(screen.queryByRole('alert')).toBeNull()
})

it('欄位插入與刪除後，錯誤維持在穩定欄位 key', () => {
  const props = {
    pointIndex: 0,
    errors: {},
    confirmField: '',
    setConfirmField: vi.fn(),
    updateField: vi.fn(),
    updatePoint: vi.fn(),
  }
  const view = render(<MeasurementFieldEditor {...props} point={initial} />)
  fireEvent.change(screen.getByLabelText('欄位型別'), {
    target: { value: 'text' },
  })
  const second = {
    clientKey: 'new-field',
    name: '新欄位',
    field_type: 'number' as const,
    unit: 'MPa',
  }
  view.rerender(
    <MeasurementFieldEditor
      {...props}
      point={{
        ...initial,
        measurement_fields: [second, ...initial.measurement_fields],
      }}
    />,
  )
  const bound = screen
    .getByDisplayValue('保壓壓力')
    .closest('.tpl-field-card')!
  const added = screen.getByDisplayValue('新欄位').closest('.tpl-field-card')!
  expect(within(bound as HTMLElement).getByRole('alert')).toHaveTextContent(
    '這個欄位用於數值標準',
  )
  expect(within(added as HTMLElement).queryByRole('alert')).toBeNull()
  view.rerender(<MeasurementFieldEditor {...props} point={initial} />)
  expect(screen.getByRole('alert')).toHaveTextContent('這個欄位用於數值標準')
})
