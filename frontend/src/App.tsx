import { lazy, Suspense } from 'react'
import { Link, Route, Routes } from 'react-router'

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
          path="/admin/*"
          element={
            <RequireAuth>
              <AdminPage />
            </RequireAuth>
          }
        />
        <Route
          path="/field/*"
          element={
            <RequireAuth>
              <FieldPage />
            </RequireAuth>
          }
        />
      </Routes>
    </Suspense>
  )
}
