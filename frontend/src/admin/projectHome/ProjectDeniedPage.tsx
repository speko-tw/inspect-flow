import { Link } from 'react-router'

import { landingLabel, landingPath } from '../../auth/landing'
import { useCurrentUser } from '../../auth/useCurrentUser'

/** 依 ADM-R25 顯示專案拒絕頁，並提供符合使用者權限的返回連結。 */
export default function ProjectDeniedPage({
  headingLevel = 1,
}: {
  headingLevel?: 1 | 2
}) {
  const { user } = useCurrentUser()
  const target = landingPath(user)
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  return (
    <section aria-labelledby="project-denied-heading">
      <Heading id="project-denied-heading">無權限</Heading>
      <p role="alert">你沒有權限執行這項操作。</p>
      <Link className="btn" to={target}>
        返回{landingLabel(target)}
      </Link>
    </section>
  )
}
