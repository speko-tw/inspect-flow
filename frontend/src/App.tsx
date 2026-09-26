import { lazy, Suspense } from 'react'
import { Link, Route, Routes } from 'react-router'

import ChangePasswordPage from './auth/ChangePasswordPage'
import LoginPage from './auth/LoginPage'
import RequireAuth from './auth/RequireAuth'

const AdminPage = lazy(() => import('./admin/AdminPage'))
const FieldPage = lazy(() => import('./field/FieldPage'))

function HomePage() {
  return (
    <main>
      <h1>InspectFlow</h1>
      <nav>
        <ul>
          <li>
            <Link to="/admin">Admin</Link>
          </li>
          <li>
            <Link to="/field">Field</Link>
          </li>
        </ul>
      </nav>
    </main>
  )
}

export default function App() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/change-password"
          element={
            // key：見下方 /admin、/field 的說明。
            <RequireAuth key="change-password">
              <ChangePasswordPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/*"
          element={
            // 三個 RequireAuth 各給不同的 key：react-router 在同一
            // 個 <Routes> 位置切換相符的 Route 時，若前後兩個
            // element 是同一個元件型別（這裡都是 RequireAuth），
            // React 會沿用同一個 fiber、不會重新掛載，
            // useEffect（只在掛載時查一次目前使用者）就不會重
            // 跑，導致從 /change-password 導回 /admin 或 /field 時
            // 讀到的還是變更密碼前、`must_change_password` 仍為
            // true 的舊狀態，被誤判又導回 /change-password（在有
            // /change-password 這個目的地之前，三個守衛互不切換，
            // 這個問題不會出現）。給不同的 key 強制切換時視為不同
            // 元件，一律重新掛載並重新查詢。
            <RequireAuth key="admin">
              <AdminPage />
            </RequireAuth>
          }
        />
        <Route
          path="/field/*"
          element={
            <RequireAuth key="field">
              <FieldPage />
            </RequireAuth>
          }
        />
      </Routes>
    </Suspense>
  )
}
