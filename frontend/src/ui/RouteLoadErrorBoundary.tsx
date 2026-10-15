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
  isChunkLoadError: boolean
}

function isLazyChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  const message = error.message.toLowerCase()
  return (
    error.name === 'ChunkLoadError' ||
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('importing a module script failed') ||
    message.includes('chunkloaderror') ||
    /loading (?:css )?chunk .+ failed/.test(message)
  )
}

/** 捕捉路由 render 錯誤，依錯誤類型提供合適的復原方式。 */
export default class RouteLoadErrorBoundary extends Component<
  RouteLoadErrorBoundaryProps,
  RouteLoadErrorBoundaryState
> {
  state: RouteLoadErrorBoundaryState = {
    hasError: false,
    isChunkLoadError: false,
  }

  static getDerivedStateFromError(
    error: unknown,
  ): RouteLoadErrorBoundaryState {
    return {
      hasError: true,
      isChunkLoadError: isLazyChunkLoadError(error),
    }
  }

  render() {
    if (this.state.hasError) {
      if (!this.state.isChunkLoadError) {
        return (
          <main className="page-load-error" role="alert">
            <h1>頁面發生錯誤</h1>
            <p>這個頁面發生錯誤，請重新載入；若持續發生請聯絡管理者。</p>
            <button
              className="btn-primary"
              onClick={this.props.onReload ?? (() => window.location.reload())}
              type="button"
            >
              重新載入
            </button>
            <a href="/">回首頁</a>
          </main>
        )
      }
      return <PageLoadError onReload={this.props.onReload} />
    }
    return this.props.children
  }
}
