import { useId } from 'react'
import { Link } from 'react-router'

import { landingPath } from '../../auth/landing'
import { useCurrentUser } from '../../auth/useCurrentUser'

/** ADM-R25：統一頁級無權限提示與符合使用者權限的返回落點。 */
export default function AccessDeniedPage({
  headingLevel = 1,
}: {
  headingLevel?: 1 | 2
}) {
  const { user } = useCurrentUser()
  const headingId = useId()
  const Heading = headingLevel === 1 ? 'h1' : 'h2'

  return (
    <section aria-labelledby={headingId}>
      <Heading id={headingId}>無權限</Heading>
      <p className="notice-info" role="status">
        你沒有使用這個頁面的權限
      </p>
      <Link className="btn" to={landingPath(user)}>
        回到我的首頁
      </Link>
    </section>
  )
}
