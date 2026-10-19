import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router'

import HomeRedirect from './auth/HomeRedirect'
import LoginPage from './auth/LoginPage'
import RequireAuth from './auth/RequireAuth'
import NotFoundPage from './NotFoundPage'
import RouteLoadErrorBoundary, {
  PageLoadError,
} from './ui/RouteLoadErrorBoundary'
import SetupGate from './setup/SetupGate'
import VersionFooter from './VersionFooter'
import { SESSION_EXPIRED_EVENT } from './http'
import { ROUTES } from './routes'

const AdminPage = lazy(() => import('./admin/AdminPage'))
const FieldPage = lazy(() => import('./field/FieldPage'))
const SetupPage = lazy(() => import('./setup/SetupPage'))

/** 管理登入、路由錯誤邊界與逾時提示，並呈現應用程式路由。 */
export default function App() {
  const [preloadFailed, setPreloadFailed] = useState(false)
  const [sessionExpiredKey, setSessionExpiredKey] = useState<string | null>(
    null,
  )
  const location = useLocation()

  useEffect(() => {
    const handlePreloadError = (event: Event) => {
      event.preventDefault()
      setPreloadFailed(true)
    }

    window.addEventListener('vite:preloadError', handlePreloadError)
    return () => {
      window.removeEventListener('vite:preloadError', handlePreloadError)
    }
  }, [])

  useEffect(() => {
    const handleSessionExpired = () => setSessionExpiredKey(location.key)
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired)
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired)
    }
  }, [location.key])

  if (preloadFailed) {
    return (
      <div className="app-root">
        <div className="app-content">
          <PageLoadError variant="updated" />
        </div>
        <VersionFooter />
      </div>
    )
  }

  return (
    <div className="app-root">
      <div className="app-content">
        {sessionExpiredKey === location.key &&
        location.pathname !== '/login' ? (
          <p className="session-expired-notice" role="alert">
            登入狀態已失效。
            <Link
              state={{
                from: `${location.pathname}${location.search}${location.hash}`,
              }}
              to="/login"
            >
              重新登入
            </Link>
          </p>
        ) : null}
        <Suspense fallback={null}>
          <Routes>
            <Route path="/admin/*" element={<NotFoundPage />} />
            <Route path="/field/*" element={<NotFoundPage />} />
            <Route path="/change-password/*" element={<NotFoundPage />} />
            <Route
              path={ROUTES.home.path}
              element={
                <SetupGate>
                  <HomeRedirect />
                </SetupGate>
              }
            />
            <Route
              path={ROUTES.login.path}
              element={
                <SetupGate>
                  <LoginPage />
                </SetupGate>
              }
            />
            <Route
              path={ROUTES.setup.path}
              element={
                <RouteLoadErrorBoundary>
                  <SetupPage />
                </RouteLoadErrorBoundary>
              }
            />
            <Route
              path={`${ROUTES.settings.path}/*`}
              element={
                <RequireAuth key="settings" route={ROUTES.settings}>
                  <RouteLoadErrorBoundary>
                    <AdminPage />
                  </RouteLoadErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path={ROUTES.adminShell.path}
              element={
                <RequireAuth key="product-pages" route={ROUTES.adminShell}>
                  <RouteLoadErrorBoundary>
                    <AdminPage />
                  </RouteLoadErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path={ROUTES.fieldShell.path}
              element={
                <RequireAuth key="field" route={ROUTES.fieldShell}>
                  <RouteLoadErrorBoundary>
                    <FieldPage />
                  </RouteLoadErrorBoundary>
                </RequireAuth>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </div>
      <VersionFooter />
    </div>
  )
}
