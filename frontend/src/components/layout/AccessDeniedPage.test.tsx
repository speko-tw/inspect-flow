import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { CurrentUserProvider } from '../../auth/useCurrentUser'
import { currentUserFixture } from '../../testing/contractFixtures'
import AccessDeniedPage from './AccessDeniedPage'

describe('AccessDeniedPage', () => {
  it.each([
    [currentUserFixture(), '/settings'],
    [currentUserFixture({ has_project_access: true }), '/projects'],
    [currentUserFixture({ can_inspect_tasks: true }), '/tasks'],
    [
      currentUserFixture({
        module_permissions: ['all_project_progress.read'],
      }),
      '/overview',
    ],
  ])('uses the user landing path %#', (user, expectedPath) => {
    render(
      <CurrentUserProvider value={{ user, clear: vi.fn() }}>
        <MemoryRouter>
          <AccessDeniedPage headingLevel={2} />
        </MemoryRouter>
      </CurrentUserProvider>,
    )

    expect(
      screen.getByRole('heading', { level: 2, name: '無權限' }),
    ).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent(
      '你沒有使用這個頁面的權限。如需使用，請洽系統管理者。',
    )
    expect(screen.getByRole('heading', { name: '無權限' })).toHaveClass(
      'access-denied-heading',
    )
    expect(screen.getByRole('status')).toHaveClass('notice-info')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('link', { name: '回到我的首頁' })).toHaveAttribute(
      'href',
      expectedPath,
    )
  })

  it('uses the supplied message without the default follow-up', () => {
    render(
      <CurrentUserProvider
        value={{ user: currentUserFixture(), clear: vi.fn() }}
      >
        <MemoryRouter>
          <AccessDeniedPage message="新增帳號只有系統管理者能操作。" />
        </MemoryRouter>
      </CurrentUserProvider>,
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      '新增帳號只有系統管理者能操作。',
    )
    expect(screen.getByRole('status')).not.toHaveTextContent(
      '如需使用，請洽系統管理者',
    )
  })

  it('treats an empty custom message as the default message', () => {
    render(
      <CurrentUserProvider
        value={{ user: currentUserFixture(), clear: vi.fn() }}
      >
        <MemoryRouter>
          <AccessDeniedPage message="" />
        </MemoryRouter>
      </CurrentUserProvider>,
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      '你沒有使用這個頁面的權限。如需使用，請洽系統管理者。',
    )
    expect(screen.getByRole('status')).not.toHaveTextContent(/^。/)
  })
})
