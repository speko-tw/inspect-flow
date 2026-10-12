import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { listMyProjects, type MyProject } from './api'
import MyProjectsPage from './MyProjectsPage'

vi.mock('./api', () => ({ listMyProjects: vi.fn() }))

const PROJECT: MyProject = {
  id: 'project-1',
  project_code: 'DEMO-001',
  name: '示範工程甲',
  client_name: '示範業主',
  site_location: '示範地點',
  planned_start_date: null,
  planned_completion_date: null,
  role_names: ['現場工程師'],
  has_office_access: true,
}

beforeEach(() => vi.mocked(listMyProjects).mockReset())

describe('我的專案頁', () => {
  it('以中性文字說明清單，不把專案描述為具內業權限', async () => {
    vi.mocked(listMyProjects).mockResolvedValue([PROJECT])
    render(
      <MemoryRouter>
        <MyProjectsPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('你參與的專案會列在這裡。')).toBeVisible()
    expect(screen.queryByText(/有內業權限的專案/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '示範工程甲' })).toBeVisible()
  })
})
