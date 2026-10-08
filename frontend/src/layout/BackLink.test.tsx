import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { BackButton, BackLink } from './BackLink'

describe('BackLink', () => {
  it('is a router link named 返回X, with the chevron hidden from readers', () => {
    render(
      <MemoryRouter>
        <BackLink to="/admin/projects">返回專案清單</BackLink>
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: '返回專案清單' })
    expect(link).toHaveAttribute('href', '/admin/projects')
    expect(link).toHaveClass('back-link')
    expect(link.querySelector('[aria-hidden="true"]')).toHaveTextContent('‹')
  })

  it('navigates inside the app and carries location state', () => {
    function Target() {
      return <p>上一層</p>
    }
    render(
      <MemoryRouter initialEntries={['/deep']}>
        <Routes>
          <Route
            element={
              <BackLink state={{ restoreTaskList: true }} to="/up">
                返回任務
              </BackLink>
            }
            path="/deep"
          />
          <Route element={<Target />} path="/up" />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('link', { name: '返回任務' }))
    expect(screen.getByText('上一層')).toBeInTheDocument()
  })
})

describe('BackButton', () => {
  it('looks like the link but switches a panel without changing the URL', () => {
    const onClick = vi.fn()
    render(<BackButton onClick={onClick}>返回清單</BackButton>)
    const button = screen.getByRole('button', { name: '返回清單' })
    expect(button).toHaveClass('back-link')
    expect(button).toHaveAttribute('type', 'button')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })
})
