import { Component, type ReactNode } from 'react'

type PageLoadErrorVariant = 'page' | 'updated'

/**
 * 顯示頁面載入失敗後的說明，並讓使用者自行重新載入。
 */
export function PageLoadError({
  variant = 'page',
  onReload,
}: {
  variant?: PageLoadErrorVariant
  onReload?: () => void
}) {
  const updated = variant === 'updated'
  const reload = onReload ?? (() => window.location.reload())

  return (
    <main className="page-load-error" role="alert">
      <h1>{updated ? '系統內容已更新' : '無法載入頁面'}</h1>
      <p>
        {updated
          ? '系統已更新，請重新載入頁面後繼續使用。'
          : '目前無法載入這個頁面，可能是網路中斷。' +
            '請重新載入後再試一次。'}
      </p>
      <button className="btn-primary" onClick={reload} type="button">
        重新載入
      </button>
    </main>
  )
}

interface RouteLoadErrorBoundaryProps {
  children: ReactNode
  onReload?: () => void
}

interface RouteLoadErrorBoundaryState {
  hasError: boolean
}

/** 捕捉 lazy route render 時的載入錯誤，避免整頁留白。 */
export default class RouteLoadErrorBoundary extends Component<
  RouteLoadErrorBoundaryProps,
  RouteLoadErrorBoundaryState
> {
  state: RouteLoadErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): RouteLoadErrorBoundaryState {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return <PageLoadError onReload={this.props.onReload} />
    }
    return this.props.children
  }
}
