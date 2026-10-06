import { Link } from 'react-router'

import { landingLabel, landingPath } from '../../auth/landing'
import { useCurrentUser } from '../../auth/useCurrentUser'

export default function ProjectDeniedPage() {
  const { user } = useCurrentUser()
  const target = landingPath(user)
  return (
    <section aria-labelledby="project-denied-heading">
      <h1 id="project-denied-heading">無權限</h1>
      <p role="alert">你沒有權限執行這項操作。</p>
      <Link className="button-link" to={target}>
        返回{landingLabel(target)}
      </Link>
    </section>
  )
}
