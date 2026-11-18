import type { ApiUser, CollectedEventResponse, LiveProjectSettings } from './api'

/** Proposed integration boundary. Percent shares are 0..100; UTC weeks start Monday. */
export interface WeeklyAnalyticsInput {
  teamId: string; projectId: string; weekStartsOn: string; weekEndsBefore: string; sourceVersion: number
  settings: LiveProjectSettings
  members: ApiUser[]
  events: { id: string; kind: CollectedEventResponse['kind']; occurredAt: string; actorId: string | null
    payload: CollectedEventResponse['payload']; details: CollectedEventResponse['details'] }[]
}
export interface WeeklyAnalyticsResult {
  engineVersion: string; teamId: string; weekStartsOn: string; sourceVersion: number
  members: { userId: string; work: Record<'code' | 'pullRequests' | 'reviews' | 'issues', number>
    sharePercent: number; activeDays: number; excludedChanges: number }[]
  flags: { kind: 'inactivity' | 'imbalance' | 'lateBurst' | 'excluded' | 'unknown'
    userId?: string; severity: 'warning' | 'risk'; explanation: string; evidenceEventIds: string[] }[]
}
export interface AnalyticsEngine {
  readonly version: string
  calculate(input: WeeklyAnalyticsInput): Promise<WeeklyAnalyticsResult>
}
