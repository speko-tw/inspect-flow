import { Link, useLocation } from 'react-router'

import LogoutButton from '../auth/LogoutButton'

export default function AdminPage() {
  const location = useLocation()
  const from = `${location.pathname}${location.search}${location.hash}`

  return (
    <main>
      <h1>Admin</h1>
      <Link to="/change-password" state={{ from }}>
        變更密碼
      </Link>
      <LogoutButton />
    </main>
  )
}
