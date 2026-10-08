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

describe('TemplateLibraryNav counts from the list responses', () => {
  const props = {
    selected: null,
    onSelect: vi.fn(),
    onToggle: vi.fn(),
    onAddCategory: vi.fn(),
    readOnly: false,
    mobile: false,
    mode: 'select' as const,
  }

  it('shows every node count, not only the visited ones (#492)', () => {
    render(
      <TemplateLibraryNav
        {...props}
        categories={[
          { id: 'category-1', name: '土木工程', system_count: 2 },
          { id: 'category-2', name: '建築工程', system_count: 0 },
        ]}
        systems={[
          {
            id: 'system-1',
            category_id: 'category-1',
            name: '給排水',
            item_count: 3,
          },
          {
            id: 'system-2',
            category_id: 'category-1',
            name: '電氣',
            item_count: 0,
          },
        ]}
        items={[
          {
            id: 'item-1',
            system_id: 'system-2',
            sequence: 1,
            title: '配電盤',
            instruction: '',
            inspection_points: [],
          },
        ]}
        loadedCategoryIds={new Set(['category-1'])}
        loadedSystemIds={new Set(['system-2'])}
        expanded={new Set(['category-1'])}
      />,
    )

    expect(screen.getByText('2 個系統')).toBeInTheDocument()
    expect(screen.getByText('0 個系統')).toBeInTheDocument()
    expect(screen.getByText('3 個查核項目')).toBeInTheDocument()
    expect(screen.getByText('1 個查核項目')).toBeInTheDocument()
  })

  it('prefers the loaded rows over the count from the list', () => {
    render(
      <TemplateLibraryNav
        {...props}
        categories={[{ id: 'category-1', name: '土木工程', system_count: 5 }]}
        systems={[
          {
            id: 'system-1',
            category_id: 'category-1',
            name: '電氣',
            item_count: 0,
          },
        ]}
        items={[
          {
            id: 'item-1',
            system_id: 'system-1',
            sequence: 1,
            title: '配電盤',
            instruction: '',
            inspection_points: [],
          },
        ]}
        loadedCategoryIds={new Set(['category-1'])}
        loadedSystemIds={new Set(['system-1'])}
        expanded={new Set(['category-1'])}
      />,
    )

    expect(screen.getByText('1 個系統')).toBeInTheDocument()
    expect(screen.getByText('1 個查核項目')).toBeInTheDocument()
  })
})
