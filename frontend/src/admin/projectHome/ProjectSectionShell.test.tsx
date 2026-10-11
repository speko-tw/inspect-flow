import { fireEvent, render, screen } from '@testing-library/react'
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
) {
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/admin/projects/project-1',
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
              activeSection="home"
              project={{ project_code: 'DEMO-001', name: '示範工程' }}
              projectId="project-1"
              viewerPermissions={viewerPermissions}
            >
              <p>專案首頁</p>
            </ProjectSectionShell>
          }
          path="/admin/projects/:projectId"
        />
        <Route element={<LocationState />} path={target} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('project section navigation state', () => {
  it('passes applied item highlights to the inspection items section only', () => {
    renderShell('/admin/projects/:projectId/inspection-items')

    fireEvent.click(screen.getByRole('link', { name: '查核項目' }))

    expect(screen.getByText('{"highlightedItemIds":["item-1"]}')).toBeVisible()
  })

  it('does not pass applied item highlights to other sections', () => {
    renderShell('/admin/projects/:projectId/members')

    fireEvent.click(screen.getByRole('link', { name: '成員' }))

    expect(screen.getByText('null')).toBeVisible()
  })

  it('shows the inspection items section to a read-only project member', () => {
    renderShell('/admin/projects/:projectId/inspection-items', [
      'inspection_plan.read',
    ])

    expect(screen.getByRole('link', { name: '查核項目' })).toBeInTheDocument()
  })

  it('shows the zones section to a member who can only manage zones', () => {
    // GET /projects/{id}/zones also allows project_zone.manage, so the
    // section is never visible to someone the API would answer with 403.
    renderShell('/admin/projects/:projectId/zones', ['project_zone.manage'])

    expect(screen.getByRole('link', { name: '分區' })).toBeInTheDocument()
  })

  it('shows the zones section to a member with zone read access', () => {
    renderShell('/admin/projects/:projectId/zones', ['project_zone.read'])

    expect(screen.getByRole('link', { name: '分區' })).toBeInTheDocument()
  })
})
