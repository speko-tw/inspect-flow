import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import RolePermissionSummary from './RolePermissionSummary'

describe('RolePermissionSummary', () => {
  it('shows a short default and toggles the full list', () => {
    render(
      <RolePermissionSummary
        codes={[
          'project_member.manage',
          'project_inspection_item.edit',
          'inspection_plan.create',
          'inspection_task.dispatch',
        ]}
        name="示範內業"
      />,
    )

    expect(screen.getByText(/等 4 項/)).toBeVisible()
    const button = screen.getByRole('button', {
      name: '展開「示範內業」完整權限',
    })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    const list = document.getElementById(button.getAttribute('aria-controls')!)
    expect(list).toHaveAttribute('hidden')

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(list).not.toHaveAttribute('hidden')
    expect(within(list!).getAllByRole('listitem')).toHaveLength(4)
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(list).toHaveAttribute('hidden')
  })
})
