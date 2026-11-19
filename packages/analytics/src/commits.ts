import type { ChangeAdjustment } from '@teampulse/shared'
import type { Credit, PeriodEvent } from './events'

export interface CommitAssessment {
  measured: number
  excluded: number
  units: number
  incomplete: boolean
  adjustments: ChangeAdjustment[]
}

export function assessCommit(row: PeriodEvent): CommitAssessment {
  const { event } = row
  const detail = event.details
  const files = detail?.files
  const paths = event.payload.files
  const total = detail?.stats?.total
  const fileLines = files?.reduce((sum, file) => sum + file.changes, 0)
  const measured = Math.max(total ?? 0, fileLines ?? 0)
  const incomplete = detail?.filesTruncated === true
    || !files?.length && total !== 0 || total !== undefined && measured !== fileLines && files?.length !== undefined
  const hasPaths = !!paths && [paths.added, paths.removed, paths.modified].some(group => group.length > 0)
  return { measured, excluded: 0, incomplete, adjustments: [],
    units: measured || (total === undefined && hasPaths ? 5 : 0) }
}

export function codeCredits(rows: { row: PeriodEvent; assessment: CommitAssessment }[]): Credit[] {
  return rows.flatMap(({ row, assessment }) => row.userId !== null && assessment.units > 0
    ? [{ userId: row.userId, category: 'code', timestamp: row.timestamp, eventIds: [row.event.id], units: assessment.units }]
    : [])
}
