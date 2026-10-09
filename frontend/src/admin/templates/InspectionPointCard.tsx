import type { InspectionPoint } from './api'
import { formatInspectionStandard } from '../../ui/inspectionStandard'

export function InspectionPointCard({
  index,
  point,
}: {
  index: number
  point: InspectionPoint
}) {
  return (
    <article className="tpl-point-card">
      <h4>
        項次 {index + 1}：{point.title}
      </h4>
      <p>
        要記錄什麼：
        {point.measurement_fields
          .map(
            (field) => `${field.name}${field.unit ? `（${field.unit}）` : ''}`,
          )
          .join('、') || '無實測欄位'}
      </p>
      <p>
        判定標準：
        {formatInspectionStandard(point)}
      </p>
      <p>照片：至少 {point.evidence_requirements[0]?.min_count ?? 1} 張</p>
    </article>
  )
}
