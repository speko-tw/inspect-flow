import { Link } from 'react-router'

export default function ProjectDeniedPage() {
  return (
    <main>
      <h1>無權限</h1>
      <p role="alert">你沒有權限執行這項操作。</p>
      <Link to="/field">返回工作台</Link>
    </main>
  )
}
