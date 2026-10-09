import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import RolePermissionSummary from './RolePermissionSummary'

describe('RolePermissionSummary', () => {
  it('shows a short default and toggles each permission item', () => {
    render(
      <RolePermissionSummary
        codes={[
          'project_member.manage',
          'project_inspection_item.edit',
          'inspection_plan.create',
          'inspection_task.create',
          'inspection_task.dispatch',
        ]}
        name="示範內業"
      />,
    )

    expect(screen.getByText(/等共 5 項/)).toBeVisible()
    const button = screen.getByRole('button', {
      name: '「示範內業」完整權限',
    })
    expect(button).toHaveTextContent('完整權限')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    const list = document.getElementById(button.getAttribute('aria-controls')!)
    expect(list).toHaveAttribute('hidden')

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-label', '「示範內業」完整權限')
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(list).not.toHaveAttribute('hidden')
    expect(within(list!).getAllByRole('listitem')).toHaveLength(5)
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(list).toHaveAttribute('hidden')
  })

  it('keeps two role expansion states independent', () => {
    render(
      <>
        <RolePermissionSummary
          codes={['inspection_task.inspect']}
          name="查核員"
        />
        <RolePermissionSummary
          codes={['inspection_plan.read']}
          name="檢視者"
        />
      </>,
    )

    const inspectorButton = screen.getByRole('button', {
      name: '「查核員」完整權限',
    })
    const viewerButton = screen.getByRole('button', {
      name: '「檢視者」完整權限',
    })
    fireEvent.click(inspectorButton)

    expect(inspectorButton).toHaveAttribute('aria-expanded', 'true')
    expect(viewerButton).toHaveAttribute('aria-expanded', 'false')
  })

  it('does not show an expand button when the role has no permissions', () => {
    render(<RolePermissionSummary codes={[]} name="檢視者" />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('uses the same safe fallback for unknown codes in summary and list', () => {
    render(
      <RolePermissionSummary codes={['future.unknown_code']} name="舊角色" />,
    )

    expect(screen.getAllByText('可使用部分功能')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '「舊角色」完整權限' }))
    expect(screen.getAllByText('可使用部分功能')).toHaveLength(2)
    expect(document.body.textContent).not.toContain('future.unknown_code')
  })
})
