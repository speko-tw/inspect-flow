import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import App from './App'

describe('App routing', () => {
  it('renders the Admin placeholder on /admin', async () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <App />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: 'Admin' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Field')).not.toBeInTheDocument()
  })

  it('renders the Field placeholder on /field', async () => {
    render(
      <MemoryRouter initialEntries={['/field']}>
        <App />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: 'Field' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
  })
})
