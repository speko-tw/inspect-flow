import { useEffect, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router'

import LogoutButton from '../auth/LogoutButton'
import { useCurrentUser } from '../auth/useCurrentUser'
import CompaniesPage from './CompaniesPage'
import RolesPage from './roles/RolesPage'
import ProjectDetailPage from './projects/ProjectDetailPage'
import ProjectsPage from './projects/ProjectsPage'
import UsersPage from './UsersPage'

const NAV_ITEMS = [
  { to: '/admin/users', label: '使用者' },
  { to: '/admin/companies', label: '公司' },
  { to: '/admin/roles', label: '角色' },
  { to: '/admin/projects', label: '專案' },
  { to: '/change-password', label: '變更密碼' },
]

export default function AdminPage() {
  const { user } = useCurrentUser()
  const location = useLocation()
  const [temporaryPassword, setTemporaryPassword] = useState<{
    username: string
    password: string
    locationKey: string
  } | null>(null)

  useEffect(() => {
    const clearTemporaryPassword = () => setTemporaryPassword(null)
    window.addEventListener('popstate', clearTemporaryPassword)
    return () => {
      window.removeEventListener('popstate', clearTemporaryPassword)
    }
  }, [])

  if (!user.is_admin) {
    return (
      <main>
        <h1>無權限</h1>
        <p role="alert">只有系統管理者可以使用管理頁面。</p>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="topbar-brand">InspectFlow 工程查核系統</span>
        <h1>Admin</h1>
        <nav aria-label="管理功能">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              onClick={() => setTemporaryPassword(null)}
              to={item.to}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <span className="topbar-user">
          登入者：{user.name_zh ?? user.username}
        </span>
        <LogoutButton />
      </header>
      <main>
        {temporaryPassword &&
          location.pathname === '/admin/users' &&
          location.key === temporaryPassword.locationKey && (
            <section
              aria-labelledby="temporary-password-heading"
              role="status"
            >
              <h2 id="temporary-password-heading">使用者已新增</h2>
              <p>
                請將以下臨時密碼交給 {temporaryPassword.username}
                。首次登入時必須變更密碼；關閉後無法再次查看。
              </p>
              <output aria-label="臨時密碼">
                {temporaryPassword.password}
              </output>
              <button onClick={() => setTemporaryPassword(null)} type="button">
                已抄下，關閉
              </button>
            </section>
          )}

        <Routes>
          <Route index element={<Navigate replace to="/admin/users" />} />
          <Route
            path="users"
            element={
              <UsersPage
                onTemporaryPassword={(username, password) =>
                  setTemporaryPassword({
                    username,
                    password,
                    locationKey: location.key,
                  })
                }
              />
            }
          />
          <Route path="companies" element={<CompaniesPage />} />
          <Route path="roles" element={<RolesPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="*" element={<p>這個管理頁面尚未提供。</p>} />
        </Routes>
      </main>
    </div>
  )
}
