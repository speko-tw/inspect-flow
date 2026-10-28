import { useId } from 'react'
import { Link } from 'react-router'

import { landingPath } from '../../auth/landing'
import { useCurrentUser } from '../../auth/useCurrentUser'

/**
 * 統一頁級無權限提示與符合使用者權限的返回落點（ADM-R25）。
 * 預設提示與補充說明分開呈現，保留提示文字可單獨定位；真值判斷
 * 讓空字串採預設提示，避免補充說明以句號開頭。
 */
export default function AccessDeniedPage({
  headingLevel = 1,
  message,
}: {
  headingLevel?: 1 | 2
  /** 覆蓋預設提示；空字串視為未提供。 */
  message?: string
}) {
  const { user } = useCurrentUser()
  const headingId = useId()
  const Heading = headingLevel === 1 ? 'h1' : 'h2'

  return (
    <section aria-labelledby={headingId}>
      <Heading className="access-denied-heading" id={headingId}>
        無權限
      </Heading>
      <p className="notice-info" role="status">
        {message || '你沒有使用這個頁面的權限'}
        {!message && <span>。如需使用，請洽系統管理者。</span>}
      </p>
      <Link className="btn" to={landingPath(user)}>
        回到我的首頁
      </Link>
    </section>
  )
}
