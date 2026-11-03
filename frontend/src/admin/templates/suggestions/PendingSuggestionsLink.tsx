import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { getPendingCount } from './api'
import { SUGGESTION_BASE } from './paths'

/**
 * 範本管理頁的「待審建議（N）」入口（TPL-R34）。N 是全部仍待審件數，
 * 只計 PENDING，不受範本庫目前頁次與搜尋影響；不做通知或未讀標記。
 */
export function PendingSuggestionsLink() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    getPendingCount()
      .then((value) => {
        if (active && typeof value?.pending_count === 'number') {
          setCount(value.pending_count)
        }
      })
      .catch(() => {
        // 讀不到時仍可進入審核清單，只是不顯示數字。
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <Link className="btn" to={SUGGESTION_BASE.review}>
      待審建議{count === null ? '' : `（${count}）`}
    </Link>
  )
}
