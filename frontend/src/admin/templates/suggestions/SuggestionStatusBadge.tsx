import { Badge } from '../../../ui/Badge'
import type { SuggestionStatus } from './api'
import { SUGGESTION_STATUS } from './content'

/** 建議狀態標籤；顏色對照集中在 `SUGGESTION_STATUS`。 */
export function SuggestionStatusBadge({
  status,
}: {
  status: SuggestionStatus
}) {
  const { label, variant } = SUGGESTION_STATUS[status]
  return <Badge variant={variant}>{label}</Badge>
}
