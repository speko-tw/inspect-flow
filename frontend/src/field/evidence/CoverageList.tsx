import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import type { Coverage, CoverageItem, CoveragePoint } from './types'

/** 按下拍照或相簿時要拍哪個目標；`pointIds` 是預先勾選的項次。 */
export interface CaptureTarget {
  itemId: string
  pointIds: string[]
  overview: boolean
}

/** 項次一行字，例如「1. 鋼筋間距」。 */
export function pointLabel(point: CoveragePoint): string {
  return `${point.sequence}. ${point.title}`
}

/** 還缺幾張；達標回 0。 */
function missing(point: CoveragePoint): number {
  return Math.max(0, point.min_count - point.covered_count)
}

function PointRow({
  item,
  point,
  canCapture,
  onCapture,
}: {
  item: CoverageItem
  point: CoveragePoint
  canCapture: boolean
  onCapture: (target: CaptureTarget, source: 'camera' | 'library') => void
}) {
  const target: CaptureTarget = {
    itemId: item.item_id,
    pointIds: [point.point_id],
    overview: false,
  }
  const label = pointLabel(point)
  return (
    <div
      aria-label={label}
      className="evidence-point"
      data-satisfied={point.satisfied}
      role="group"
    >
      <div>
        <h4>{label}</h4>
        <p>
          {point.satisfied ? '✓ 已齊全' : `尚需補拍 ${missing(point)} 張`}
          ・已有 {point.covered_count}／需要 {point.min_count} 張
        </p>
      </div>
      {canCapture && (
        <div className="evidence-actions">
          <Button
            aria-label={`拍照，${label}`}
            onClick={() => onCapture(target, 'camera')}
            type="button"
            variant={point.satisfied ? 'secondary' : 'primary'}
          >
            拍照
          </Button>
          <Button
            aria-label={`從相簿選，${label}`}
            onClick={() => onCapture(target, 'library')}
            type="button"
          >
            從相簿選
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * 每個查核項目的照片覆蓋狀態與拍照入口（FEV-R04）：項次顯示
 * 「已有 x／需要 y 張」，總覽照選拍、不計入需求。畫面只用項目標題與
 * 項次序號，不顯示任何識別碼（FEV-R15）。
 */
export function CoverageList({
  coverage,
  canCapture,
  onCapture,
}: {
  coverage: Coverage
  canCapture: boolean
  onCapture: (target: CaptureTarget, source: 'camera' | 'library') => void
}) {
  return (
    <>
      {coverage.all_points_satisfied && coverage.items.length > 0 && (
        <p className="evidence-all-done" role="status">
          ✓ 每個項次都已有足夠的照片。
        </p>
      )}
      {coverage.items.map((item) => {
        const overview: CaptureTarget = {
          itemId: item.item_id,
          pointIds: [],
          overview: true,
        }
        return (
          <Card className="evidence-item" key={item.item_id}>
            <h3>{item.title}</h3>
            {item.points.map((point) => (
              <PointRow
                canCapture={canCapture}
                item={item}
                key={point.point_id}
                onCapture={onCapture}
                point={point}
              />
            ))}
            <p className="evidence-hint">
              總覽照片選拍，已有 {item.overview_count} 張，不計入項次需求。
            </p>
            {canCapture && (
              <div className="evidence-actions">
                <Button
                  aria-label={`拍總覽照（選拍），${item.title}`}
                  onClick={() => onCapture(overview, 'camera')}
                  type="button"
                >
                  拍總覽照（選拍）
                </Button>
                <Button
                  aria-label={`從相簿選總覽照，${item.title}`}
                  onClick={() => onCapture(overview, 'library')}
                  type="button"
                >
                  從相簿選總覽照
                </Button>
              </div>
            )}
          </Card>
        )
      })}
    </>
  )
}
