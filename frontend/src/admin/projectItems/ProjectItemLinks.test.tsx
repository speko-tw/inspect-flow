import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ProjectItemLinks from './ProjectItemLinks'

afterEach(() => vi.unstubAllGlobals())

describe('ProjectItemLinks', () => {
  it('shows source and applied time and highlights newly applied items', async () => {
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
            element={<ProjectItemLinks projectId="project-1" />}
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
    expect(
      screen.getByRole('link', { name: '修改「管線查核」' }),
    ).toHaveAttribute(
      'href',
      '/admin/projects/project-1/inspection-items/copy-1',
    )
  })
})
