import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TemplateLibraryNav } from './TemplateLibraryNav'

describe('TemplateLibraryNav counts', () => {
  it('hides child counts until each collection has loaded', () => {
    render(
      <TemplateLibraryNav
        categories={[{ id: 'category-1', name: '土木工程' }]}
        systems={[{ id: 'system-1', category_id: 'category-1', name: '護欄' }]}
        items={[]}
        loadedCategoryIds={new Set()}
        loadedSystemIds={new Set()}
        selected={null}
        expanded={new Set(['category-1', 'system-1'])}
        onSelect={vi.fn()}
        onToggle={vi.fn()}
        onAddCategory={vi.fn()}
        readOnly={false}
        mobile={false}
        mode="manage"
      />,
    )

    expect(screen.queryByText(/個系統/)).not.toBeInTheDocument()
    expect(screen.queryByText(/個查核項目/)).not.toBeInTheDocument()
    expect(screen.getByText('載入中…')).toBeInTheDocument()
  })

  it('shows counts after the category and system requests complete', () => {
    render(
      <TemplateLibraryNav
        categories={[{ id: 'category-1', name: '土木工程' }]}
        systems={[{ id: 'system-1', category_id: 'category-1', name: '護欄' }]}
        items={[]}
        loadedCategoryIds={new Set(['category-1'])}
        loadedSystemIds={new Set(['system-1'])}
        selected={null}
        expanded={new Set(['category-1', 'system-1'])}
        onSelect={vi.fn()}
        onToggle={vi.fn()}
        onAddCategory={vi.fn()}
        readOnly={false}
        mobile={false}
        mode="manage"
      />,
    )

    expect(screen.getByText('1 個系統')).toBeInTheDocument()
    expect(screen.getByText('0 個查核項目')).toBeInTheDocument()
  })
})
