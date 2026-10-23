import AccessDeniedPage from '../../components/layout/AccessDeniedPage'

/** 依 ADM-R25 顯示專案拒絕頁，並提供符合使用者權限的返回連結。 */
export default function ProjectDeniedPage({
  headingLevel = 1,
}: {
  headingLevel?: 1 | 2
}) {
  return <AccessDeniedPage headingLevel={headingLevel} />
}
