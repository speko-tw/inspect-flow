import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { VersionFooterDisplay } from './VersionFooter'

describe('VersionFooter', () => {
  it('shows the release version and injected commit tooltip', () => {
    render(
      <VersionFooterDisplay
        version={__INSPECTFLOW_VERSION__}
        commit="abc1234"
      />,
    )

    const footer = screen.getByText(`InspectFlow v${__INSPECTFLOW_VERSION__}`)
    expect(footer.getAttribute('title')).toBe('Commit abc1234')
  })

  it('shows only the release version when no commit is available', () => {
    render(
      <VersionFooterDisplay version={__INSPECTFLOW_VERSION__} commit="" />,
    )

    const footer = screen.getByText(`InspectFlow v${__INSPECTFLOW_VERSION__}`)
    expect(footer.hasAttribute('title')).toBe(false)
  })
})
