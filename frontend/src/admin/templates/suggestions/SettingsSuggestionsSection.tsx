import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router'

import { listMySuggestions } from './api'
import { SUGGESTION_BASE, type SuggestionNavState } from './paths'

/**
 * 個人設定頁的「我的範本建議」區塊（TPL-R34）：只有曾提出建議者可見，
 * 不要求仍具來源專案編輯權或 template.use；從專案捷徑以外的另一個入口，
 * 返回時回設定頁。以未篩選的本人總數是否大於 0 決定顯示。
 */
export function SettingsSuggestionsSection() {
  const headingId = useId()
  const [count, setCount] = useState(0)

  useEffect(() => {
    let active = true
    listMySuggestions({ limit: 1 })
      .then((page) => {
        if (active && typeof page?.total_count === 'number') {
          setCount(page.total_count)
        }
      })
      .catch(() => {
        // 讀取失敗時不顯示區塊，避免對從未提議的人顯示空殼。
      })
    return () => {
      active = false
    }
  }, [])

  if (count <= 0) return null
  return (
    <section
      aria-labelledby={headingId}
      className="suggestions-settings"
      id="template-suggestions"
    >
      <h2 id={headingId}>我的範本建議</h2>
      <p>共 {count} 件。查看審核結果、退回原因與每一版內容。</p>
      <Link
        className="btn"
        state={{ origin: 'settings' } satisfies SuggestionNavState}
        to={SUGGESTION_BASE.mine}
      >
        開啟我的範本建議
      </Link>
    </section>
  )
}
