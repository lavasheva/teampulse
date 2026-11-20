import type { AnalyticsEvent, WorkKind } from '@teampulse/shared'
import { utcDate } from './period'

export interface PeriodEvent {
  event: AnalyticsEvent
  timestamp: number
  userId: string | null
}

export interface Credit {
  userId: string
  category: WorkKind
  timestamp: number
  eventIds: string[]
  /** Integer twentieths of an unweighted point. */
  units: number
}

// Stored IDs are unique. The object URL also identifies push/history compatibility
// duplicates and prevents duplicate PR lifecycle credit when rows are replayed.
function objectKey(row: PeriodEvent): string {
  const { event, timestamp } = row
  const url = event.payload.url
  if (!url) return event.id
  const issueDate = event.kind === 'issue_closed' ? utcDate(timestamp) : ''
  return JSON.stringify([event.kind, url, issueDate])
}

export function periodEvents(
  events: AnalyticsEvent[], roster: Set<string>, start: number, end: number,
): PeriodEvent[] {
  const candidates = events.map(event => ({
    event, timestamp: Date.parse(event.occurredAt),
    userId: event.actorId !== null && roster.has(event.actorId) ? event.actorId : null,
  })).filter(row => row.timestamp >= start && row.timestamp < end)
  candidates.sort((a, b) => a.timestamp - b.timestamp
    || (a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0))
  const ids = new Set<string>()
  const objects = new Set<string>()
  return candidates.filter(row => {
    const key = objectKey(row)
    if (ids.has(row.event.id) || objects.has(key)) return false
    ids.add(row.event.id)
    objects.add(key)
    return true
  })
}

export function actionCredit(row: PeriodEvent): Credit | null {
  const { event, userId, timestamp } = row
  if (userId === null) return null
  const base = { userId, timestamp, eventIds: [event.id] }
  switch (event.kind) {
    case 'pr_opened': return { ...base, category: 'pullRequests', units: 20 }
    case 'pr_merged': return { ...base, category: 'pullRequests', units: 40 }
    case 'issue_opened': return { ...base, category: 'issues', units: 10 }
    case 'issue_closed': return { ...base, category: 'issues', units: 20 }
    case 'review': {
      const state = event.details?.reviewState?.toUpperCase()
      if (state === 'DISMISSED' || state === 'PENDING') return null
      const units = event.details?.hasBody || state === 'CHANGES_REQUESTED' ? 40 : 20
      return { ...base, category: 'reviews', units }
    }
    default: return null
  }
}
