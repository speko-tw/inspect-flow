import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'

import ProjectSectionShell from './ProjectSectionShell'

function LocationState() {
  const location = useLocation()
  return <output>{JSON.stringify(location.state ?? null)}</output>
}

function renderShell(
  target: string,
  viewerPermissions = [
    'project_member.manage',
    'project_inspection_item.edit',
  ],
  activeSection:
    | 'home'
    | 'members'
    | 'inspection-items'
    | 'zones'
    | 'planning'
    | 'progress' = 'home',
) {
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/projects/project-1',
          state: {
            notice: '已新增項目',
            highlightedItemIds: ['item-1'],
          },
        },
      ]}
    >
      <Routes>
        <Route
          element={
            <ProjectSectionShell
              activeSection={activeSection}
              project={{ project_code: 'DEMO-001', name: '示範工程' }}
              projectId="project-1"
              viewerPermissions={viewerPermissions}
            >
              <p>專案首頁</p>
            </ProjectSectionShell>
          }
          path="/projects/:projectId"
        />
        <Route element={<LocationState />} path={target} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('project section navigation state', () => {
  it('shows the current section and toggles the mobile menu label', () => {
    renderShell(
      '/projects/:projectId/planning',
      ['inspection_plan.read'],
      'planning',
    )

    const button = screen.getByRole('button', {
      name: '切換專案頁面，目前在計畫與任務',
    })
    expect(button).toHaveTextContent('計畫與任務 ▾')
    expect(button).toHaveAttribute('aria-controls', 'project-mobile-sections')
    expect(button).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(button)

    expect(button).toHaveTextContent('計畫與任務 ▴')
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const drawer = document.getElementById('project-mobile-sections')
    expect(drawer).not.toBeNull()
    const planningLink = within(drawer as HTMLElement).getByRole('link', {
      name: '計畫與任務',
    })
    expect(planningLink).toBeVisible()
    expect(planningLink).toHaveAttribute(
      'href',
      '/projects/project-1/planning',
    )
  })

  it('uses the home section name in the accessible mobile menu label', () => {
    renderShell('/projects/:projectId/planning')

    expect(
      screen.getByRole('button', {
        name: '切換專案頁面，目前在專案首頁',
      }),
    ).toHaveTextContent('專案首頁 ▾')
  })

  it('passes applied item highlights to the inspection items section only', () => {
    renderShell('/projects/:projectId/inspection-items')

    fireEvent.click(screen.getByRole('link', { name: '查核項目' }))

    expect(screen.getByText('{"highlightedItemIds":["item-1"]}')).toBeVisible()
  })

  it('does not pass applied item highlights to other sections', () => {
    renderShell('/projects/:projectId/members')

    fireEvent.click(screen.getByRole('link', { name: '成員' }))

    expect(screen.getByText('null')).toBeVisible()
  })

  it('shows the inspection items section to a read-only project member', () => {
    renderShell('/projects/:projectId/inspection-items', [
      'inspection_plan.read',
    ])

    expect(screen.getByRole('link', { name: '查核項目' })).toBeInTheDocument()
  })

  it('shows member and planning sections to viewers with read access', () => {
    renderShell('/projects/:projectId/planning', [
      'project_member.manage',
      'inspection_plan.read',
    ])

    expect(screen.getByRole('link', { name: '成員' })).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '計畫與任務' }),
    ).toBeInTheDocument()
  })

  it('hides sections without their permissions', () => {
    renderShell('/projects/:projectId/planning', [])

    expect(screen.queryByRole('link', { name: '成員' })).toBeNull()
    expect(screen.queryByRole('link', { name: '計畫與任務' })).toBeNull()
  })

  it('hides the zones section from a member who can only manage zones', () => {
    // 該 API 只讓 project_zone.read 讀列表，只有 manage 的人看到入口
    // 會得到 403，所以導覽不顯示（ADM-R17）。
    renderShell('/projects/:projectId/zones', ['project_zone.manage'])

    expect(
      screen.queryByRole('link', { name: '分區' }),
    ).not.toBeInTheDocument()
  })

  it('shows the zones section to a member with zone read access', () => {
    renderShell('/projects/:projectId/zones', ['project_zone.read'])

    expect(screen.getByRole('link', { name: '分區' })).toBeInTheDocument()
  })
})
