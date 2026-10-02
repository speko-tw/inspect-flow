import { Link, useLocation } from 'react-router'

import LogoutButton from '../auth/LogoutButton'

export default function FieldPage() {
  const location = useLocation()
  const from = `${location.pathname}${location.search}${location.hash}`
  // 從別頁導來時可帶一則提示（例如收回自己的管理者權限後）。
  const notice = (location.state as { notice?: unknown } | null)?.notice

  return (
    <main>
      <h1>Field</h1>
      {typeof notice === 'string' && <p role="status">{notice}</p>}
      <Link to="/change-password" state={{ from }}>
        變更密碼
      </Link>
      <LogoutButton />
    </main>
  )
}
