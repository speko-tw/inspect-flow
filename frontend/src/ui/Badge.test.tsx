import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Badge, StatusBadge } from './Badge'
import { STATUS_BADGES, activeStatus, type BadgeStatus } from './statusBadge'

const VARIANTS = ['neutral', 'success', 'warning', 'danger', 'info']

describe('status badge table', () => {
  it.each(Object.entries(STATUS_BADGES))(
    '%s maps to one label and one known variant',
    (_status, entry) => {
      expect(entry.label).not.toBe('')
      expect(VARIANTS).toContain(entry.variant)
    },
  )

  it('pins each status to its variant', () => {
    expect(
      Object.fromEntries(
        Object.entries(STATUS_BADGES).map(([key, { variant }]) => [
          key,
          variant,
        ]),
      ),
    ).toEqual({
      DRAFT: 'neutral',
      PENDING: 'warning',
      IN_PROGRESS: 'info',
      COMPLETED: 'success',
      CANCELLED: 'neutral',
      ARCHIVED: 'neutral',
      ACTIVE: 'success',
      INACTIVE: 'neutral',
    })
  })

  it('maps the active flag to ACTIVE or INACTIVE', () => {
    expect(activeStatus(true)).toBe('ACTIVE')
    expect(activeStatus(false)).toBe('INACTIVE')
  })
})

describe('Badge', () => {
  it.each(VARIANTS)('renders the %s variant', (variant) => {
    render(<Badge variant={variant as never}>文字</Badge>)
    expect(screen.getByText('文字')).toHaveClass('badge', `badge-${variant}`)
  })

  it('defaults to neutral', () => {
    render(<Badge>文字</Badge>)
    expect(screen.getByText('文字')).toHaveClass('badge-neutral')
  })
})

describe('StatusBadge', () => {
  it.each(Object.keys(STATUS_BADGES) as BadgeStatus[])(
    'renders %s from the table',
    (status) => {
      const { label, variant } = STATUS_BADGES[status]
      render(<StatusBadge status={status} />)
      expect(screen.getByText(label)).toHaveClass(`badge-${variant}`)
    },
  )

  it('keeps 名稱（狀態） as the accessible name when parenthesized', () => {
    render(
      <button type="button">
        橋梁查核
        <StatusBadge parenthesized status="DRAFT" />
      </button>,
    )
    expect(
      screen.getByRole('button', { name: '橋梁查核（草稿）' }),
    ).toBeInTheDocument()
  })
})
