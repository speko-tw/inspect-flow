import { Link } from 'react-router'

export default function ProjectDeniedPage() {
  return (
    <section aria-labelledby="project-denied-heading">
      <h1 id="project-denied-heading">無權限</h1>
      <p role="alert">你沒有權限執行這項操作。</p>
      <Link to="/field">返回工作台</Link>
    </section>
  )
}
