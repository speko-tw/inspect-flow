import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import styles from './components.module.css'
import {
  Badge,
  Button,
  Card,
  Field,
  IconButton,
  InfoRow,
  Input,
  SectionHeader,
  StatCard,
  Tag,
} from './index'

describe('Button', () => {
  it.each(['primary', 'secondary', 'tertiary', 'destructive'] as const)(
    'renders the %s hierarchy',
    (variant) => {
      render(<Button variant={variant}>執行</Button>)
      const button = screen.getByRole('button', { name: '執行' })
      expect(button).toHaveClass(styles[variant])
    },
  )

  it('can receive keyboard focus', () => {
    render(<Button>執行</Button>)
    const button = screen.getByRole('button')
    button.focus()
    expect(button).toHaveFocus()
  })

  it('does not invoke a disabled action', () => {
    const action = vi.fn()
    render(
      <Button disabled onClick={action}>
        執行
      </Button>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(action).not.toHaveBeenCalled()
  })

  it('announces loading and blocks repeated activation', () => {
    const action = vi.fn()
    render(
      <Button loading onClick={action}>
        儲存
      </Button>,
    )
    const button = screen.getByRole('button', { name: '載入中…' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()
    fireEvent.click(button)
    fireEvent.click(button)
    expect(action).not.toHaveBeenCalled()
  })
})

describe('IconButton', () => {
  it('uses its required accessible name', () => {
    render(<IconButton aria-label="關閉">×</IconButton>)
    expect(screen.getByRole('button', { name: '關閉' })).toBeInTheDocument()
  })

  it('defaults to type button inside forms', () => {
    render(
      <form>
        <IconButton aria-label="關閉">×</IconButton>
      </form>,
    )
    expect(screen.getByRole('button', { name: '關閉' })).toHaveAttribute(
      'type',
      'button',
    )
  })

  it('does not invoke a disabled action', () => {
    const action = vi.fn()
    render(
      <IconButton aria-label="關閉" disabled onClick={action}>
        ×
      </IconButton>,
    )
    fireEvent.click(screen.getByRole('button', { name: '關閉' }))
    expect(action).not.toHaveBeenCalled()
  })

  it('rejects an omitted accessible name at typecheck time', () => {
    // @ts-expect-error aria-label 是必要的可及名稱
    const invalid = <IconButton>×</IconButton>
    expect(invalid).toBeDefined()
  })

  it('announces loading and prevents repeat activation', () => {
    const action = vi.fn()
    render(
      <IconButton aria-label="重新整理" loading onClick={action}>
        ↻
      </IconButton>,
    )
    const button = screen.getByRole('button', { name: '重新整理' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()
    fireEvent.click(button)
    fireEvent.click(button)
    expect(action).not.toHaveBeenCalled()
  })
})

describe('static information components', () => {
  it.each(['neutral', 'success', 'warning', 'danger', 'info'] as const)(
    'renders the %s Badge variant',
    (variant) => {
      render(<Badge variant={variant}>{variant}</Badge>)
      expect(screen.getByText(variant)).toHaveClass(
        styles.badge,
        styles[variant],
      )
    },
  )

  it('keeps Badge and Tag outside the tab order', () => {
    const { container } = render(
      <>
        <Badge variant="warning">待處理</Badge>
        <Tag>工程</Tag>
      </>,
    )
    expect(container.querySelector('[tabindex]')).toBeNull()
    expect(screen.getByText('待處理')).toBeInTheDocument()
    expect(screen.getByText('工程')).toBeInTheDocument()
  })

  it('renders a static section heading with optional description', () => {
    const { container } = render(
      <SectionHeader title="工作清單" description="依狀態整理" />,
    )
    expect(
      screen.getByRole('heading', { name: '工作清單' }),
    ).toBeInTheDocument()
    expect(screen.getByText('依狀態整理')).toBeInTheDocument()
    expect(container.querySelector('[tabindex]')).toBeNull()
  })

  it('renders InfoRow and StatCard without interactive semantics', () => {
    const { container } = render(
      <>
        <InfoRow label="地點" value="臺北" />
        <StatCard label="待辦" value="3" description="尚未完成" />
      </>,
    )
    expect(screen.getByText('地點').tagName).toBe('DT')
    expect(screen.getByText('臺北').tagName).toBe('DD')
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(container.querySelector('[tabindex]')).toBeNull()
  })

  it('renders a static Card without hover or tab-order hooks', () => {
    const { container } = render(<Card>摘要內容</Card>)
    const card = screen.getByText('摘要內容')
    expect(card.tagName).toBe('DIV')
    expect(card).not.toHaveAttribute('tabindex')
    expect(card).not.toHaveClass('interactiveCard')
    expect(container.querySelector('[tabindex]')).toBeNull()
  })
})

describe('interactive Card', () => {
  it('uses a button for actions and exposes selected state in text', () => {
    const action = vi.fn()
    render(
      <Card onClick={action} selected>
        專案
      </Card>,
    )
    const card = screen.getByRole('button', { name: '目前選取專案' })
    expect(screen.getByText('目前選取')).toBeInTheDocument()
    expect(card).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(card)
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('uses a link when given a destination', () => {
    render(
      <Card href="/projects" selected>
        專案
      </Card>,
    )
    const link = screen.getByRole('link', { name: '目前選取專案' })
    expect(link).toHaveAttribute('href', '/projects')
    expect(screen.getByRole('link')).toHaveAttribute('aria-current', 'true')
  })

  it('keeps an empty destination as a native link', () => {
    const { container } = render(<Card href="">首頁</Card>)
    const link = container.querySelector('a')
    expect(link).toHaveTextContent('首頁')
    expect(link).toHaveAttribute('href', '')
  })

  it('treats an undefined action as a static card', () => {
    render(<Card onClick={undefined}>摘要</Card>)
    const card = screen.getByText('摘要')
    expect(card.tagName).toBe('DIV')
    expect(card).not.toHaveClass('interactiveCard')
  })

  it('does not report an ordinary action as a toggle button', () => {
    render(<Card onClick={() => undefined}>開啟詳情</Card>)
    expect(
      screen.getByRole('button', { name: '開啟詳情' }),
    ).not.toHaveAttribute('aria-pressed')
  })

  it('does not invoke a disabled button action', () => {
    const action = vi.fn()
    render(
      <Card disabled onClick={action}>
        專案
      </Card>,
    )
    fireEvent.click(screen.getByRole('button', { name: '專案' }))
    expect(action).not.toHaveBeenCalled()
  })
})

describe('Field and Input', () => {
  it('associates label, hint, required and error with the input', () => {
    render(
      <Field
        error="請輸入名稱"
        hint="最多 80 個字元"
        id="project-name"
        label="專案名稱"
        required
      >
        <Input />
      </Field>,
    )
    const input = screen.getByRole('textbox', {
      name: '專案名稱（必填）',
    })
    expect(input).toHaveAttribute('id', 'project-name')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toBeRequired()
    expect(input.getAttribute('aria-describedby')).toContain(
      'project-name-hint',
    )
    expect(input.getAttribute('aria-describedby')).toContain(
      'project-name-error',
    )
    expect(screen.getByRole('alert')).toHaveTextContent('請輸入名稱')
  })

  it('renders a default input when no child is provided', () => {
    const props = {
      error: '搜尋失敗',
      hint: '輸入關鍵字',
      id: 'search',
      label: '搜尋',
    }
    render(<Field {...props} />)
    const input = screen.getByRole('textbox', { name: '搜尋' })
    expect(input).toHaveAttribute('id', 'search')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toContain('search-hint')
    expect(input.getAttribute('aria-describedby')).toContain('search-error')
  })

  it('keeps disabled input non-editable', () => {
    render(<Input aria-label="搜尋" disabled />)
    expect(screen.getByRole('textbox', { name: '搜尋' })).toBeDisabled()
  })
})
