import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { listMySuggestions } from './api'
import { projectSuggestionsPath, type SuggestionNavState } from './paths'

/**
 * 專案查核項目頁的「我的範本建議（本案共 N 件）」（TPL-R34）：直接開
 * 本人清單並預設篩選本案；N 為 0 仍可進入並看到空白說明。N 是本人在
 * 本專案所有狀態的件數，不是管理頁的待審總數。
 */
export function ProjectSuggestionLink({
  projectId,
  refreshKey,
}: {
  projectId: string
  /** 提出成功後遞增，讓件數重讀。 */
  refreshKey: number
}) {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    listMySuggestions({ source_project_id: projectId, limit: 1 })
      .then((page) => {
        if (active) {
          setCount(
            typeof page?.total_count === 'number' ? page.total_count : null,
          )
        }
      })
      .catch(() => {
        // 讀不到件數時仍可進入清單，只是不顯示數字。
        if (active) setCount(null)
      })
    return () => {
      active = false
    }
  }, [projectId, refreshKey])

  return (
    <Link
      className="btn"
      state={{ origin: 'project' } satisfies SuggestionNavState}
      to={projectSuggestionsPath(projectId)}
    >
      我的範本建議{count === null ? '' : `（本案共 ${count} 件）`}
    </Link>
  )
}
