import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ProjectItemLinks from './ProjectItemLinks'

afterEach(() => vi.unstubAllGlobals())

describe('ProjectItemLinks', () => {
  it('shows source, applied time, and new-item highlight', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          items: [
            {
              id: 'copy-1',
              project_id: 'project-1',
              sequence: 1,
              title: '管線查核',
              instruction: '確認管線安裝',
              source_template_name: '給排水',
              applied_at: '2026-10-05T01:00:00Z',
              inspection_points: [],
            },
          ],
          next_cursor: null,
        }),
      ),
    )

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/admin/projects/project-1',
            state: { highlightedItemIds: ['copy-1'] },
          },
        ]}
      >
        <Routes>
          <Route
            element={
              <ProjectItemLinks
                projectId="project-1"
                viewerPermissions={['project_inspection_item.edit']}
              />
            }
            path="/admin/projects/:projectId"
          />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('來源範本：給排水')).toBeInTheDocument()
    expect(screen.getByText('剛套用')).toBeInTheDocument()
    expect(screen.getByText(/套用時間：/).closest('time')).toHaveAttribute(
      'datetime',
      '2026-10-05T01:00:00Z',
    )
    const editLinkName = '修改「管線查核」'
    const editLink = screen.getByRole('link', { name: editLinkName })
    expect(editLink).toHaveTextContent('修改')
    expect(editLink).toHaveAttribute(
      'href',
      '/admin/projects/project-1/inspection-items/copy-1',
    )
    expect(screen.getByText('0 個查核項次')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '從範本新增查核項目' }),
    ).toHaveAttribute(
      'href',
      '/admin/projects/project-1/inspection-items/templates',
    )
  })

  it('keeps project items read-only without edit permission', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          items: [
            {
              id: 'copy-1',
              project_id: 'project-1',
              sequence: 1,
              title: '管線查核',
              instruction: '確認管線安裝',
              inspection_points: [],
            },
          ],
          next_cursor: null,
        }),
      ),
    )

    render(
      <MemoryRouter
        initialEntries={['/admin/projects/project-1/inspection-items']}
      >
        <Routes>
          <Route
            element={
              <ProjectItemLinks
                projectId="project-1"
                viewerPermissions={['inspection_plan.read']}
              />
            }
            path="/admin/projects/:projectId/inspection-items"
          />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('管線查核')).toBeInTheDocument()
    const viewLinkName = '檢視「管線查核」'
    const viewLink = screen.getByRole('link', { name: viewLinkName })
    expect(viewLink).toHaveTextContent('檢視')
    expect(viewLink).toHaveAttribute(
      'href',
      '/admin/projects/project-1/inspection-items/copy-1',
    )
    expect(
      screen.queryByRole('link', { name: '從範本新增查核項目' }),
    ).toBeNull()
  })
})
