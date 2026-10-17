import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  ConfirmationPanel,
  FormErrorSummary,
  ListDetailLayout,
  ListStatus,
  RecordFormLayout,
  ResourceState,
  SetupSteps,
} from './LayoutPatterns'

describe('ListDetailLayout', () => {
  it('shows list and detail with a mobile return action', () => {
    const onBack = vi.fn()
    render(
      <ListDetailLayout
        listTitle="專案清單"
        detailTitle="專案詳情"
        list={<h2>南港廠區</h2>}
        detail={<p>工作內容</p>}
        onBack={onBack}
      />,
    )

    expect(screen.getByRole('region', { name: '專案清單' })).toBeVisible()
    expect(screen.getByRole('region', { name: '專案詳情' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '返回專案清單' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('starts in the list pane when no detail is selected', () => {
    const { container } = render(
      <ListDetailLayout
        listTitle="任務清單"
        detailTitle="任務詳情"
        list={<p>待辦任務</p>}
        onBack={vi.fn()}
      />,
    )

    expect(container.firstElementChild).toHaveAttribute(
      'data-active-pane',
      'list',
    )
    expect(screen.queryByRole('region', { name: '任務詳情' })).toBeNull()
  })
})

describe('RecordFormLayout', () => {
  it.each([
    ['create', '新增專案'],
    ['edit', '修改專案'],
  ] as const)('labels the %s form as a separate task', (mode, heading) => {
    render(
      <RecordFormLayout mode={mode} recordName="專案">
        <label>
          專案名稱
          <input />
        </label>
      </RecordFormLayout>,
    )

    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    expect(screen.getByLabelText('專案名稱')).toBeInTheDocument()
  })
})

describe('ResourceState', () => {
  it('announces loading as a busy status without an action', () => {
    render(
      <ResourceState
        state="loading"
        title="載入專案中"
        message="正在取得最新資料。"
        actionLabel="重新載入"
        onAction={vi.fn()}
      />,
    )

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('provides an explicit empty state without requiring an action', () => {
    render(
      <ResourceState
        state="empty"
        title="目前沒有專案"
        message="建立第一個專案後，清單會顯示在這裡。"
      />,
    )

    expect(screen.getByText('目前沒有專案')).toBeInTheDocument()
    expect(screen.getByText(/建立第一個專案/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('clears a search from its empty-result state', () => {
    const onClear = vi.fn()
    render(
      <ResourceState
        state="empty"
        title="找不到符合的專案"
        message="請調整搜尋條件，或清除搜尋。"
        actionLabel="清除搜尋"
        onAction={onClear}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '清除搜尋' }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('offers a retry action for failures', () => {
    const onRetry = vi.fn()
    render(
      <ResourceState
        state="error"
        title="無法載入專案"
        message="連線中斷，搜尋條件已保留。"
        actionLabel="重新載入"
        onAction={onRetry}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('搜尋條件已保留')
    fireEvent.click(screen.getByRole('button', { name: '重新載入' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})

describe('ListStatus', () => {
  it('reports when all server-provided list items are visible', () => {
    render(<ListStatus state="complete" count={12} />)
    expect(screen.getByRole('status')).toHaveTextContent('已顯示全部 12 筆')
  })

  it('announces list loading as busy', () => {
    render(<ListStatus state="loading" />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('載入中…')
  })
})

describe('ConfirmationPanel', () => {
  it('uses a neutral primary confirmation for non-destructive changes', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    const { container } = render(
      <ConfirmationPanel
        tone="neutral"
        title="開始查核"
        subject="南港廠區查核"
        impact="現場人員會收到查核任務。"
        cancelLabel="取消"
        confirmLabel="開始查核"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByRole('alertdialog')).toHaveClass(
      'layout-confirmation-neutral',
    )
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      '對象：南港廠區查核',
    )
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '開始查核' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(container.querySelector('.layout-confirmation-danger')).toBeNull()
  })
})

describe('FormErrorSummary', () => {
  it('links an error to its field and focuses that field', () => {
    render(
      <>
        <FormErrorSummary
          errors={[
            {
              fieldId: 'project-code',
              fieldLabel: '專案代碼',
              message: '代碼已使用，請輸入尚未使用的代碼。',
            },
          ]}
        />
        <label htmlFor="project-code">專案代碼</label>
        <input id="project-code" />
      </>,
    )
    const link = screen.getByRole('link', { name: /代碼已使用/ })
    expect(link).toHaveAttribute('href', '#project-code')
    fireEvent.click(link)
    expect(screen.getByLabelText('專案代碼')).toHaveFocus()
  })
})

describe('SetupSteps', () => {
  it('marks each step with text and identifies the current step', () => {
    render(
      <SetupSteps
        steps={[
          { label: '基本資料', status: 'complete' },
          { label: '查核說明', status: 'current' },
          { label: '確認與送出', status: 'upcoming' },
        ]}
      />,
    )

    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(
      screen.getByRole('listitem', { current: 'step' }),
    ).toHaveTextContent('目前步驟')
    expect(screen.getByText('基本資料').nextSibling).toHaveTextContent(
      '已完成',
    )
    expect(screen.getByText('確認與送出').nextSibling).toHaveTextContent(
      '未開始',
    )
  })
})
