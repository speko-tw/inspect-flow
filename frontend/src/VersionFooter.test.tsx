import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import VersionFooter from './VersionFooter'

describe('VersionFooter', () => {
  it('shows the release version and commit tooltip when available', () => {
    render(<VersionFooter />)

    const footer = screen.getByText('InspectFlow v0.3.0')
    expect(footer.getAttribute('title')).toMatch(/^Commit /)
  })
})
